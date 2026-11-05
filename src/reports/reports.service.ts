import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { audit } from '../auth/audit';
import { UserDto } from '../auth/dto';
import { AuthenticatedRequest } from '../common';
import { Database } from '../db';
import { Category, CreateReport, Report, ReportQuery, Stats, Status, StatusEvent, UpdateReport, UpdateStatus } from './dto';
import { PhotoService } from './photo.service';

type Row = Omit<Report, 'photoUrl' | 'prediction'> & {
  photoKey: string; category: Category | null; confidence: number | null; modelVersion: string | null;
};
const columns = `id, reporter_id AS "reporterId", description, latitude::float8, longitude::float8,
  photo_key AS "photoKey", status, predicted_category AS category, prediction_confidence::float8 AS confidence,
  prediction_model AS "modelVersion", created_at AS "createdAt", updated_at AS "updatedAt"`;
const scope = '(reporter_id=$1 OR $2::boolean) AND deleted_at IS NULL';
const params = (user: UserDto) => [user.id, user.role === 'ADMIN'] as const;
const serialize = ({ photoKey, category, confidence, modelVersion, ...row }: Row): Report => ({
  ...row, photoUrl: `/api/v1/reports/${row.id}/photo`,
  prediction: category && confidence !== null && modelVersion ? { category, confidence, modelVersion } : null,
});

@Injectable()
export class ReportsService {
  constructor(private readonly db: Database, private readonly photos: PhotoService) {}

  async create(input: CreateReport, file: Express.Multer.File | undefined, req: AuthenticatedRequest) {
    if (!file) throw new BadRequestException({ code: 'PHOTO_REQUIRED', message: 'A photo is required' });
    const photo = await this.photos.validate(file);
    const prediction = await this.photos.predict(photo);
    const key = await this.photos.save(photo);
    try {
      return await this.db.transaction(async client => {
        const active = await client.query(
          'SELECT id FROM users WHERE id=$1 AND is_active AND deleted_at IS NULL AND email_verified_at IS NOT NULL FOR UPDATE',
          [req.user.id],
        );
        if (!active.rowCount) throw new UnauthorizedException();
        const { rows: [row] } = await client.query<Row>(
          `INSERT INTO reports (reporter_id,description,latitude,longitude,photo_key,predicted_category,prediction_confidence,prediction_model)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${columns}`,
          [req.user.id, input.description, input.latitude, input.longitude, key, prediction?.category,
            prediction?.confidence, prediction?.modelVersion],
        );
        await client.query(
          "INSERT INTO report_status_history (report_id,changed_by_id,to_status) VALUES ($1,$2,'PENDING')",
          [row.id, req.user.id],
        );
        await audit(client, req.audit, 'REPORT_CREATE', 201, req.user, undefined, {
          type: 'report', id: row.id, request: { bytes: file.size, contentType: 'image/jpeg' },
          response: { id: row.id, status: row.status, category: row.category },
        });
        await audit(client, req.audit, 'REPORT_PREDICTION', prediction ? 200 : 503, req.user,
          prediction ? undefined : 'PREDICTION_UNAVAILABLE', {
            type: 'report', id: row.id, response: { category: prediction?.category },
          });
        return serialize(row);
      });
    } catch (error) {
      await this.photos.remove(key).catch(() => Logger.error('Failed to clean up report photo', 'Reports'));
      throw error;
    }
  }

  async list(query: ReportQuery, req: AuthenticatedRequest) {
    const { page, limit, q, status, category } = query;
    const where = `${scope} AND ($3::text IS NULL OR strpos(lower(description),lower($3)) > 0 OR id::text=lower($3))
      AND ($4::report_status IS NULL OR status=$4) AND ($5::waste_category IS NULL OR predicted_category=$5)`;
    const values = [...params(req.user), q || null, status, category];
    const result = await this.db.pool.query<Row>(
      `SELECT ${columns} FROM reports WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT $6 OFFSET $7`,
      [...values, limit, (page - 1) * limit],
    );
    const count = await this.db.pool.query<{ total: number }>(`SELECT count(*)::int AS total FROM reports WHERE ${where}`, values);
    const total = count.rows[0].total;
    await audit(this.db.pool, req.audit, 'REPORT_LIST', 200, req.user, undefined, {
      request: { page, limit, status, category }, response: { count: result.rows.length, total },
    });
    return { items: result.rows.map(serialize), total, page, limit };
  }

  private async find(id: string, user: UserDto, client?: PoolClient) {
    const result = await (client ?? this.db.pool).query<Row>(
      `SELECT ${columns} FROM reports WHERE ${scope} AND id=$3 ${client ? 'FOR UPDATE' : ''}`,
      [...params(user), id],
    );
    if (!result.rows[0]) throw new NotFoundException();
    return result.rows[0];
  }

  async detail(id: string, req: AuthenticatedRequest) {
    const row = await this.find(id, req.user);
    const history = await this.db.pool.query<StatusEvent>(
      `SELECT id, changed_by_id AS "changedById", from_status AS "fromStatus", to_status AS "toStatus",
       reason, created_at AS "createdAt" FROM report_status_history WHERE report_id=$1 ORDER BY created_at,id`, [id],
    );
    await audit(this.db.pool, req.audit, 'REPORT_READ', 200, req.user, undefined,
      { type: 'report', id, response: { id, status: row.status } });
    return { ...serialize(row), statusHistory: history.rows };
  }

  async photo(id: string, req: AuthenticatedRequest) {
    const row = await this.find(id, req.user);
    const data = await this.photos.read(row.photoKey);
    await audit(this.db.pool, req.audit, 'REPORT_PHOTO', 200, req.user, undefined,
      { type: 'report', id, response: { bytes: data.length, contentType: 'image/jpeg' } });
    return data;
  }

  async update(id: string, input: UpdateReport, req: AuthenticatedRequest) {
    if (input.description === undefined && input.latitude === undefined && input.longitude === undefined) {
      throw new BadRequestException();
    }
    return this.db.transaction(async client => {
      this.requirePending(await this.find(id, req.user, client));
      const { rows: [row] } = await client.query<Row>(
        `UPDATE reports SET description=coalesce($2,description), latitude=coalesce($3,latitude),
         longitude=coalesce($4,longitude), updated_at=now() WHERE id=$1 RETURNING ${columns}`,
        [id, input.description, input.latitude, input.longitude],
      );
      await audit(client, req.audit, 'REPORT_UPDATE', 200, req.user, undefined, {
        type: 'report', id, request: { descriptionChanged: input.description !== undefined,
          locationChanged: input.latitude !== undefined || input.longitude !== undefined },
        response: { id, status: row.status },
      });
      return serialize(row);
    });
  }

  async remove(id: string, req: AuthenticatedRequest) {
    await this.db.transaction(async client => {
      this.requirePending(await this.find(id, req.user, client));
      await client.query('UPDATE reports SET deleted_at=now(),updated_at=now() WHERE id=$1', [id]);
      await audit(client, req.audit, 'REPORT_DELETE', 204, req.user, undefined, { type: 'report', id });
    });
  }

  async changeStatus(id: string, input: UpdateStatus, req: AuthenticatedRequest) {
    return this.db.transaction(async client => {
      const current = await this.find(id, req.user, client);
      const allowed = current.status === Status.PENDING ? [Status.IN_PROGRESS, Status.REJECTED]
        : current.status === Status.IN_PROGRESS ? [Status.COMPLETED, Status.REJECTED] : [];
      if (!allowed.includes(input.status)) {
        throw new ConflictException({ code: 'INVALID_STATUS_TRANSITION', message: 'Status transition is not allowed' });
      }
      const { rows: [row] } = await client.query<Row>(
        `UPDATE reports SET status=$2,updated_at=now() WHERE id=$1 RETURNING ${columns}`, [id, input.status],
      );
      await client.query(
        'INSERT INTO report_status_history (report_id,changed_by_id,from_status,to_status,reason) VALUES ($1,$2,$3,$4,$5)',
        [id, req.user.id, current.status, input.status, input.reason],
      );
      await audit(client, req.audit, 'REPORT_STATUS', 200, req.user, undefined, {
        type: 'report', id, request: { status: input.status, reasonProvided: !!input.reason },
        response: { id, status: row.status },
      });
      return serialize(row);
    });
  }

  async stats(req: AuthenticatedRequest): Promise<Stats> {
    const rows = await this.db.prisma.reports.groupBy({
      by: ['status'],
      where: { deleted_at: null, reporter_id: req.user.role === 'ADMIN' ? undefined : req.user.id },
      _count: { _all: true },
    });
    const byStatus = { PENDING: 0, IN_PROGRESS: 0, COMPLETED: 0, REJECTED: 0 };
    for (const row of rows) byStatus[row.status] = row._count._all;
    const total = rows.reduce((sum, row) => sum + row._count._all, 0);
    await audit(this.db.pool, req.audit, 'DASHBOARD_STATS', 200, req.user, undefined, { response: { total, byStatus } });
    return { total, byStatus };
  }

  private requirePending(row: Row) {
    if (row.status !== Status.PENDING) {
      throw new ConflictException({ code: 'REPORT_NOT_PENDING', message: 'Only pending reports can be changed' });
    }
  }
}
