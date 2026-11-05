BEGIN;

DELETE FROM email_verifications;

ALTER TABLE email_verifications
  ADD COLUMN failed_attempts smallint NOT NULL DEFAULT 0,
  ADD CONSTRAINT email_verifications_failed_attempts CHECK (failed_attempts BETWEEN 0 AND 5);

COMMIT;
