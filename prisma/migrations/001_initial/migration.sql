BEGIN;

-- SQL dump generated using DBML (dbml.dbdiagram.io)
-- Database: PostgreSQL
-- Generated at: 2026-11-04T17:55:44.576Z

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
  'PAPER'
);

CREATE TABLE "users" (
  "id" uuid PRIMARY KEY DEFAULT (uuidv7()),
  "email" varchar(254) UNIQUE NOT NULL,
  "name" varchar(100) NOT NULL,
  "password_hash" text NOT NULL,
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

CREATE INDEX ON "users" ("deleted_at");

CREATE INDEX ON "reports" ("reporter_id", "created_at", "id");

CREATE INDEX ON "reports" ("status", "created_at", "id");

CREATE INDEX ON "reports" ("created_at", "id");

CREATE INDEX ON "reports" ("deleted_at");

CREATE INDEX ON "report_status_history" ("report_id", "created_at", "id");

CREATE INDEX ON "audit_logs" ("actor_id", "created_at", "id");

CREATE INDEX ON "audit_logs" ("resource_type", "resource_id", "created_at", "id");

CREATE INDEX ON "audit_logs" ("created_at", "id");

COMMENT ON COLUMN "audit_logs"."request_id" IS 'Korelasi antarperistiwa dalam satu request';

COMMENT ON COLUMN "audit_logs"."actor_id" IS 'Snapshot ID tanpa FK agar log tetap ada setelah purge';

ALTER TABLE "reports" ADD FOREIGN KEY ("reporter_id") REFERENCES "users" ("id") ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "report_status_history" ADD FOREIGN KEY ("report_id") REFERENCES "reports" ("id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "report_status_history" ADD FOREIGN KEY ("changed_by_id") REFERENCES "users" ("id") ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;

COMMIT;
