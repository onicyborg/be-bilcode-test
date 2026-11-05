# Smart Waste API

Requires Node.js 24, pnpm 10.33.1, and PostgreSQL 18. SMTP is required to deliver verification codes. The API can start with SMTP unset. For an existing database initialized with the old runner, complete the baseline steps below before deploying.

```sh
pnpm install --frozen-lockfile
test -f .env || cp .env.example .env
```

Set DATABASE_URL and both JWT secrets in .env. If secrets are empty, generate a different value for each with `openssl rand -hex 32`. Configure CORS_ORIGINS as a comma-separated list of browser origins.

For Gmail, fill SMTP_GOOGLE_USER with the Gmail address and SMTP_GOOGLE_APP_PASSWORD with the app password. Leave SMTP_URL empty. MAIL_FROM defaults to the configured Gmail address. For a local SMTP catcher, leave both Gmail fields empty and set SMTP_URL to a full URL such as `smtp://localhost:1025`, plus MAIL_FROM.

Set ML_URL to the base URL of the FastAPI service. Failed predictions leave reports usable with a null prediction.

```sh
pnpm exec prisma migrate deploy
pnpm run build
pnpm start
```

Swagger UI is at http://localhost:3001/api/docs and OpenAPI JSON at http://localhost:3001/api/docs/openapi.json. Swagger covers authentication, reports, dashboard, and users. The [project API contract](../docs/API.md) also documents the internal prediction request and the audit and retention rules.

Register, read the verification code in the mailbox, call verify-email with email and the six-digit code as a string, then log in. Codes expire after 10 minutes. Codes issued before migration 003 must be requested again. A new verification code invalidates the previous one. If the email is missing, request a new code with resend-verification. Set ADMIN_EMAIL and ADMIN_PASSWORD in the command environment and run `pnpm run seed:admin` to create a verified demo admin. Use the access token in the Swagger Authorize dialog and the refresh token in the refresh or logout body.

The purge job runs daily at 03:00 UTC and processes up to 100 eligible reports and 100 eligible accounts per run. Keep the API running for scheduled purges. Audit rows remain after purge.

## Cloudflare R2

Create a private R2 bucket and a bucket scoped API token with Object Read & Write permissions. Set `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY` in .env, then restart NestJS. Leave `R2_ENDPOINT` empty for the standard Cloudflare endpoint. Set it to the S3 API endpoint shown by Cloudflare if the bucket uses a jurisdiction-specific endpoint. Keep these credentials on the backend.

The API stores JPEGs in R2 and serves them through the existing authenticated photo endpoint. The purge job deletes the R2 object before deleting its report and retries failed deletions on a later run. If upgrading an existing local deployment, copy its JPEG files to the bucket using their existing filenames as object keys before switching.

## Prisma ORM

Build and dev generate Prisma Client automatically. To generate it directly, run `pnpm run prisma:generate`. Run `pnpm run prisma:validate` to validate the schema. `pnpm exec prisma studio` opens the configured database for local inspection.

Prisma Migrate manages the history in `prisma/migrations/`. To create a migration locally, update `prisma/schema.prisma`, run `pnpm exec prisma migrate dev --name <change>`, then generate Prisma Client. When adding PostgreSQL features such as check constraints, use `--create-only` to review or extend the SQL before applying it. Use `pnpm exec prisma migrate deploy` in deployment. PostgreSQL 18 is required for UUIDv7 defaults.

### Baseline an existing database

Run this once per database that was initialized with the old migration runner. Back up the database and query the legacy tracker using the same connection configured in `.env`:

```sql
SELECT filename FROM public.schema_migrations ORDER BY filename;
```

Confirm that the entries form a prefix of the three migrations below and that the database schema reflects those entries. Run **only** the matching commands. For example, if only the first two SQL files are listed, run only the first two resolve commands.

| Legacy filename | Command |
| --- | --- |
| `001_initial.sql` | `pnpm exec prisma migrate resolve --applied 001_initial` |
| `002_auth.sql` | `pnpm exec prisma migrate resolve --applied 002_auth` |
| `003_verification_code.sql` | `pnpm exec prisma migrate resolve --applied 003_verification_code` |

Then run `pnpm exec prisma migrate deploy` and `pnpm exec prisma migrate status`. Deploy applies pending migrations and retires the legacy tracker. Migration 003 invalidates outstanding verification codes if it has not already been applied. A fresh database can go straight to `migrate deploy`. If the database already uses Prisma Migrate, skip the baseline.

NestJS exposes a shared Prisma client via `Database.prisma`. Dashboard reads use Prisma. Existing transactions that use row locks, audit writes, and purge SQL continue to use the same PostgreSQL pool.

### Reset demo credentials for existing accounts

Run `pnpm exec prisma generate` first. Set `DEMO_PASSWORD` in the command environment and run `pnpm exec prisma db seed`. The seeder updates exactly one active, verified Admin and one active, verified User. It selects the sole eligible account per role by default. Set `DEMO_ADMIN_EMAIL` or `DEMO_USER_EMAIL` to pick a specific account when there are multiple. The seeder resets both passwords in one transaction and revokes their refresh sessions.

Demo seeding: set DEMO_ADMIN_EMAIL, DEMO_USER_EMAIL and DEMO_PASSWORD in the local environment, then run `pnpm exec prisma db seed`. Explicit emails create missing active, verified accounts; matching existing active/verified roles are reset and their refresh sessions revoked. Conflicting, inactive, deleted or unverified accounts are rejected rather than silently reactivated. Account changes and audit events share one transaction. Optional DEMO_ADMIN_NAME / DEMO_USER_NAME apply on creation only. Never use demo credentials for a production system.
