-- Documentation snapshot, checked against PostgreSQL 18.6 on 2026-11-06.
-- Apply backend/prisma/migrations with prisma migrate deploy to create the database.
-- Auth foreign keys are NOT DEFERRABLE; report/history foreign keys are DEFERRABLE INITIALLY IMMEDIATE.

CREATE TYPE "user_role" AS ENUM (
  'USER',
  'ADMIN'
);

CREATE TYPE "report_status" AS ENUM (
  'PENDING',
  'IN_PROGRESS',
  'COMPLETED',
  'REJECTED'
);

CREATE TYPE "waste_category" AS ENUM (
  'ORGANIC',
  'PLASTIC',
  'PAPER',
  'GLASS',
  'METAL',
  'CARDBOARD',
  'CLOTHES',
  'FOOTWEAR',
  'BATTERY',
  'OTHER'
);

CREATE TABLE "users" (
  "id" uuid PRIMARY KEY DEFAULT (uuidv7()),
  "email" varchar(254) UNIQUE NOT NULL,
  "name" varchar(100) NOT NULL,
  "password_hash" text NOT NULL,
  "email_verified_at" timestamptz,
  "role" user_role NOT NULL DEFAULT 'USER',
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT (now()),
  "updated_at" timestamptz NOT NULL DEFAULT (now()),
  "deleted_at" timestamptz,
  CONSTRAINT "users_id_v7" CHECK (uuid_extract_version(id) IS NOT DISTINCT FROM 7),
  CONSTRAINT "users_normalized_email" CHECK (email = lower(btrim(email)))
);

CREATE TABLE "reports" (
  "id" uuid PRIMARY KEY DEFAULT (uuidv7()),
  "reporter_id" uuid NOT NULL,
  "description" varchar(1000) NOT NULL,
  "latitude" decimal(9,6) NOT NULL,
  "longitude" decimal(9,6) NOT NULL,
  "photo_key" text NOT NULL,
  "predicted_category" waste_category,
  "prediction_confidence" decimal(5,4),
  "prediction_model" varchar(100),
  "status" report_status NOT NULL DEFAULT 'PENDING',
  "created_at" timestamptz NOT NULL DEFAULT (now()),
  "updated_at" timestamptz NOT NULL DEFAULT (now()),
  "deleted_at" timestamptz,
  CONSTRAINT "reports_id_v7" CHECK (uuid_extract_version(id) IS NOT DISTINCT FROM 7),
  CONSTRAINT "reports_gps_range" CHECK (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180),
  CONSTRAINT "reports_prediction_fields" CHECK ((predicted_category IS NULL AND prediction_confidence IS NULL AND prediction_model IS NULL) OR (predicted_category IS NOT NULL AND prediction_confidence IS NOT NULL AND prediction_confidence BETWEEN 0 AND 1 AND prediction_model IS NOT NULL))
);

CREATE TABLE "report_status_history" (
  "id" uuid PRIMARY KEY DEFAULT (uuidv7()),
  "report_id" uuid NOT NULL,
  "changed_by_id" uuid NOT NULL,
  "from_status" report_status,
  "to_status" report_status NOT NULL,
  "reason" varchar(500),
  "created_at" timestamptz NOT NULL DEFAULT (now()),
  CONSTRAINT "status_history_id_v7" CHECK (uuid_extract_version(id) IS NOT DISTINCT FROM 7),
  CONSTRAINT "status_history_transition" CHECK (((from_status IS NULL AND to_status = 'PENDING') OR (from_status = 'PENDING' AND to_status IN ('IN_PROGRESS', 'REJECTED')) OR (from_status = 'IN_PROGRESS' AND to_status IN ('COMPLETED', 'REJECTED'))) IS TRUE),
  CONSTRAINT "status_history_rejection_reason" CHECK (to_status <> 'REJECTED' OR (reason IS NOT NULL AND length(btrim(reason)) > 0))
);

CREATE TABLE "audit_logs" (
  "id" uuid PRIMARY KEY DEFAULT (uuidv7()),
  "request_id" uuid,
  "actor_id" uuid,
  "actor_role" user_role,
  "action" varchar(80) NOT NULL,
  "resource_type" varchar(50),
  "resource_id" uuid,
  "http_method" varchar(10),
  "route_template" varchar(200),
  "http_status" smallint,
  "outcome" varchar(20) NOT NULL,
  "request_payload" jsonb NOT NULL DEFAULT ('{}'::jsonb),
  "response_payload" jsonb NOT NULL DEFAULT ('{}'::jsonb),
  "duration_ms" integer,
  "created_at" timestamptz NOT NULL DEFAULT (now()),
  CONSTRAINT "audit_logs_id_v7" CHECK (uuid_extract_version(id) IS NOT DISTINCT FROM 7),
  CONSTRAINT "audit_logs_outcome" CHECK (outcome IN ('SUCCESS', 'FAILURE')),
  CONSTRAINT "audit_logs_http_status" CHECK (http_status BETWEEN 100 AND 599),
  CONSTRAINT "audit_logs_duration" CHECK (duration_ms >= 0)
);

CREATE TABLE "email_verifications" (
  "id" uuid PRIMARY KEY DEFAULT (uuidv7()),
  "user_id" uuid UNIQUE NOT NULL,
  "token_digest" text UNIQUE NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "failed_attempts" smallint NOT NULL DEFAULT 0,
  CONSTRAINT "email_verifications_failed_attempts" CHECK (failed_attempts BETWEEN 0 AND 5),
  CONSTRAINT "email_verifications_id_check" CHECK (uuid_extract_version(id) IS NOT DISTINCT FROM 7)
);

CREATE TABLE "refresh_sessions" (
  "id" uuid PRIMARY KEY DEFAULT (uuidv7()),
  "user_id" uuid NOT NULL,
  "token_digest" text UNIQUE NOT NULL,
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "refresh_sessions_id_check" CHECK (uuid_extract_version(id) IS NOT DISTINCT FROM 7)
);

CREATE INDEX ON "users" ("deleted_at");

CREATE INDEX ON "reports" ("reporter_id", "created_at", "id");

CREATE INDEX ON "reports" ("status", "created_at", "id");

CREATE INDEX ON "reports" ("created_at", "id");

CREATE INDEX ON "reports" ("deleted_at");

CREATE INDEX ON "report_status_history" ("report_id", "created_at", "id");

CREATE INDEX ON "audit_logs" ("actor_id", "created_at", "id");

CREATE INDEX ON "audit_logs" ("resource_type", "resource_id", "created_at", "id");

CREATE INDEX ON "audit_logs" ("created_at", "id");

CREATE INDEX "refresh_sessions_user" ON "refresh_sessions" ("user_id");

COMMENT ON TABLE "users" IS 'Akun Admin/User. Soft delete memakai deleted_at. Akses memerlukan akun aktif, email terverifikasi, dan belum dihapus.';

COMMENT ON COLUMN "users"."email_verified_at" IS 'NULL berarti email belum terverifikasi';

COMMENT ON TABLE "reports" IS 'Satu laporan memiliki satu foto di R2 dan maksimal satu prediksi kategori utama. Prediksi boleh seluruhnya NULL jika ML tidak tersedia. Purge setelah satu bulan kalender UTC sejak deleted_at, diproses job harian.';

COMMENT ON COLUMN "reports"."photo_key" IS 'Object key bucket R2 privat; bukan isi foto atau URL publik';

COMMENT ON COLUMN "reports"."prediction_model" IS 'Versi model saat laporan dibuat; hasil historis tidak otomatis dihitung ulang';

COMMENT ON TABLE "report_status_history" IS 'Riwayat status laporan. FK report_id dan changed_by_id bersifat DEFERRABLE INITIALLY IMMEDIATE. Alasan wajib untuk status REJECTED.';

COMMENT ON COLUMN "report_status_history"."from_status" IS 'NULL hanya untuk peristiwa awal menuju PENDING';

COMMENT ON TABLE "audit_logs" IS 'Log dipertahankan setelah purge akun/laporan. actor_id dan resource_id adalah snapshot tanpa FK. Payload memakai allowlist, tanpa password, token/kode mentah, email, koordinat, atau isi foto. Mutasi sukses dan audit terkait berada dalam satu transaksi.';

COMMENT ON COLUMN "audit_logs"."request_id" IS 'Korelasi antarperistiwa dalam satu request';

COMMENT ON COLUMN "audit_logs"."actor_id" IS 'Snapshot ID tanpa FK agar log tetap ada setelah purge';

COMMENT ON COLUMN "audit_logs"."resource_id" IS 'Snapshot resource; sengaja tanpa FK';

COMMENT ON TABLE "email_verifications" IS 'Setiap user memiliki 0 atau 1 record verifikasi karena user_id UNIQUE. Menyimpan digest kode 6 digit, bukan kode mentah. Berlaku 10 menit, maksimal 5 percobaan gagal; resend mengganti kode lama. FK tidak deferrable.';

COMMENT ON COLUMN "email_verifications"."token_digest" IS 'Digest verifikasi; tidak menyimpan kode mentah';

COMMENT ON TABLE "refresh_sessions" IS 'Satu user dapat memiliki banyak sesi. Refresh JWT berlaku 7 hari dan dirotasi sekali pakai; hanya digest yang disimpan. Access JWT 15 menit tidak memiliki tabel tersendiri. FK tidak deferrable.';

COMMENT ON COLUMN "refresh_sessions"."token_digest" IS 'Digest refresh token; bukan JWT mentah';

ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "report_status_history" ADD CONSTRAINT "report_status_history_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "report_status_history" ADD CONSTRAINT "report_status_history_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "email_verifications" ADD CONSTRAINT "email_verifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "refresh_sessions" ADD CONSTRAINT "refresh_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;
