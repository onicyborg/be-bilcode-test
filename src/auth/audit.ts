import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';

export type AuditContext = {
  requestId: string;
  method: string;
  route: string;
  started: number;
};

export async function audit(
  db: Pool | PoolClient, context: AuditContext, action: string, status: number,
  actor?: { id: string; role: string }, code?: string,
  details?: { type?: string; id?: string; request?: object; response?: object },
) {
  try {
    await db.query(
      `INSERT INTO audit_logs
        (request_id, actor_id, actor_role, action, http_method, route_template,
         http_status, outcome, response_payload, duration_ms, resource_type, resource_id, request_payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [context.requestId, actor?.id, actor?.role, action, context.method, context.route,
        status, status < 400 ? 'SUCCESS' : 'FAILURE', code ? { code } : details?.response ?? {},
        Date.now() - context.started, details?.type, details?.id, details?.request ?? {}],
    );
  } catch {
    Logger.error('Audit write failed', 'Audit');
    throw new ServiceUnavailableException({ code: 'AUDIT_UNAVAILABLE', message: 'Audit unavailable' });
  }
}
