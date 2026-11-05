import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { audit } from '../auth/audit';
import { Database } from '../db';
import { PhotoService } from './photo.service';

const due = "(deleted_at AT TIME ZONE 'UTC') + interval '1 month' <= (now() AT TIME ZONE 'UTC')";
const batchSize = 100;

@Injectable()
export class PurgeService {
  constructor(private readonly db: Database, private readonly photos: PhotoService) {}

  @Cron('0 3 * * *', { timeZone: 'UTC', waitForCompletion: true })
  async purge() {
    const context = { requestId: randomUUID(), method: 'WORKER', route: 'purge', started: Date.now() };
    const candidates = await this.db.pool.query<{ id: string }>(
      `SELECT id FROM reports WHERE ${due} ORDER BY deleted_at,id LIMIT $1`, [batchSize],
    );
    for (const { id } of candidates.rows) {
      try {
        await this.db.transaction(async client => {
          const result = await client.query<{ photo_key: string }>(
            `SELECT photo_key FROM reports WHERE id=$1 AND ${due} FOR UPDATE SKIP LOCKED`, [id],
          );
          if (!result.rows[0]) return;
          await this.photos.remove(result.rows[0].photo_key);
          await client.query('DELETE FROM reports WHERE id=$1', [id]);
          await audit(client, context, 'REPORT_PURGE', 204, undefined, undefined, { type: 'report', id });
        });
      } catch {
        Logger.error('Report purge failed and will be retried', 'Purge');
      }
    }
    await this.db.transaction(async client => {
      const accounts = await client.query<{ id: string }>(
        `SELECT u.id FROM users u WHERE ${due} AND NOT EXISTS (SELECT 1 FROM reports r WHERE r.reporter_id=u.id)
         AND NOT EXISTS (SELECT 1 FROM report_status_history h WHERE h.changed_by_id=u.id)
         ORDER BY u.deleted_at,u.id LIMIT $1 FOR UPDATE OF u SKIP LOCKED`, [batchSize],
      );
      for (const { id } of accounts.rows) {
        await client.query('DELETE FROM users WHERE id=$1', [id]);
        await audit(client, context, 'USER_PURGE', 204, undefined, undefined, { type: 'user', id });
      }
      await client.query('DELETE FROM refresh_sessions WHERE expires_at <= now()');
      await client.query('DELETE FROM email_verifications WHERE expires_at <= now()');
    });
  }
}
