import { randomBytes, randomUUID, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { Database, required } from '../src/db';

const derive = promisify(scrypt);

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const hash = await derive(password, salt, 64) as Buffer;
  return `${salt}:${hash.toString('hex')}`;
}

async function seed() {
  const password = required('DEMO_PASSWORD');
  if (password.length < 8 || password.length > 128) throw new Error('DEMO_PASSWORD must be 8–128 characters');

  const targets = [
    { role: 'ADMIN', email: process.env.DEMO_ADMIN_EMAIL?.trim().toLowerCase() },
    { role: 'USER', email: process.env.DEMO_USER_EMAIL?.trim().toLowerCase() },
  ] as const;
  const hashes = await Promise.all(targets.map(() => hashPassword(password)));
  const db = new Database();
  const requestId = randomUUID();
  try {
    const accounts = await db.prisma.$transaction(async client => {
      const selected = [];
      for (const target of targets) {
        const matches = await client.users.findMany({
          where: { role: target.role, email: target.email || undefined, deleted_at: null,
            is_active: true, email_verified_at: { not: null } },
          select: { id: true, email: true, role: true },
          take: 2,
        });
        if (matches.length !== 1) {
          throw new Error(`Expected exactly one active, verified ${target.role}. Set the corresponding DEMO_*_EMAIL.`);
        }
        selected.push(matches[0]);
      }

      for (const [index, account] of selected.entries()) {
        await client.users.update({
          where: { id: account.id, role: account.role, deleted_at: null, is_active: true, email_verified_at: { not: null } },
          data: { password_hash: hashes[index], updated_at: new Date() },
        });
        await client.refresh_sessions.deleteMany({ where: { user_id: account.id } });
        await client.audit_logs.create({
          data: { request_id: requestId, action: 'DEMO_PASSWORD_RESET', resource_type: 'user',
            resource_id: account.id, outcome: 'SUCCESS', response_payload: { role: account.role } },
        });
      }
      return selected;
    });
    for (const account of accounts) console.log(`${account.role}: ${account.email}`);
  } finally {
    await db.onApplicationShutdown();
  }
}

void seed().catch(error => {
  console.error(error instanceof Error ? error.message : 'Demo seeding failed');
  process.exitCode = 1;
});
