import { Body, Controller, Delete, Get, HttpCode, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';
import { AccessGuard, Document } from '../auth/auth.controller';
import { audit } from '../auth/audit';
import { AuthModule } from '../auth/auth.module';
import { UserDto } from '../auth/dto';
import { AdminGuard, AuthenticatedRequest, PageQuery, PageResult } from '../common';
import { Database } from '../db';

class UserPage extends PageResult {
  @ApiProperty({ type: [UserDto] }) items!: UserDto[];
}

class UpdateUser {
  @ApiProperty() @IsBoolean() isActive!: boolean;
}

const userColumns = 'id, email, name, role, is_active AS "isActive", created_at AS "createdAt"';
const adminErrors = { 400: 'Invalid input', 401: 'Valid access JWT required', 403: 'Admin required' };
const uuid = new ParseUUIDPipe({ version: '7' });

@Injectable()
class UsersService {
  constructor(private readonly db: Database) {}

  async list({ page, limit, q }: PageQuery, req: AuthenticatedRequest) {
    const where = 'deleted_at IS NULL AND ($1::text IS NULL OR strpos(lower(email),lower($1)) > 0 OR strpos(lower(name),lower($1)) > 0)';
    const result = await this.db.pool.query<UserDto>(
      `SELECT ${userColumns} FROM users WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3`,
      [q || null, limit, (page - 1) * limit],
    );
    const count = await this.db.pool.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM users WHERE ${where}`, [q || null],
    );
    const total = count.rows[0].total;
    await audit(this.db.pool, req.audit, 'USER_LIST', 200, req.user, undefined, {
      request: { page, limit }, response: { count: result.rows.length, total },
    });
    return { items: result.rows, page, limit, total };
  }

  async update(id: string, isActive: boolean, req: AuthenticatedRequest) {
    return this.db.transaction(async client => {
      const { rows: [user] } = await client.query<UserDto>(
        `UPDATE users SET is_active=$2,updated_at=now() WHERE id=$1 AND role='USER'
         AND deleted_at IS NULL RETURNING ${userColumns}`, [id, isActive],
      );
      if (!user) throw new NotFoundException();
      if (!isActive) await client.query('DELETE FROM refresh_sessions WHERE user_id=$1', [id]);
      await audit(client, req.audit, 'USER_UPDATE', 200, req.user, undefined,
        { type: 'user', id, request: { isActive }, response: { id, isActive } });
      return user;
    });
  }

  async remove(id: string, req: AuthenticatedRequest) {
    await this.db.transaction(async client => {
      const user = await client.query(
        "UPDATE users SET deleted_at=now(),is_active=false,updated_at=now() WHERE id=$1 AND role='USER' AND deleted_at IS NULL", [id],
      );
      if (!user.rowCount) throw new NotFoundException();
      await client.query('UPDATE reports SET deleted_at=now(),updated_at=now() WHERE reporter_id=$1 AND deleted_at IS NULL', [id]);
      await client.query('DELETE FROM refresh_sessions WHERE user_id=$1', [id]);
      await client.query('DELETE FROM email_verifications WHERE user_id=$1', [id]);
      await audit(client, req.audit, 'USER_DELETE', 204, req.user, undefined, { type: 'user', id });
    });
  }
}

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(AccessGuard, AdminGuard)
@Controller('users')
class UsersController {
  constructor(private readonly service: UsersService) {}

  @Get()
  @Document('Search users as an admin', 200, UserPage, adminErrors)
  list(@Query() query: PageQuery, @Req() req: AuthenticatedRequest) {
    return this.service.list(query, req);
  }

  @Patch(':id')
  @Document('Activate or deactivate a User account', 200, UserDto, { ...adminErrors, 404: 'User not found' })
  update(@Param('id', uuid) id: string, @Body() body: UpdateUser, @Req() req: AuthenticatedRequest) {
    return this.service.update(id, body.isActive, req);
  }

  @Delete(':id')
  @HttpCode(204)
  @Document('Soft delete a User account and its reports', 204, undefined, { ...adminErrors, 404: 'User not found' })
  remove(@Param('id', uuid) id: string, @Req() req: AuthenticatedRequest) {
    return this.service.remove(id, req);
  }
}

@Module({ imports: [AuthModule], controllers: [UsersController], providers: [AdminGuard, UsersService] })
export class UsersModule {}
