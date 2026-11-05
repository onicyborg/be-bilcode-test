BEGIN;

ALTER TABLE users ADD COLUMN email_verified_at timestamptz;

CREATE TABLE email_verifications (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) IS NOT DISTINCT FROM 7),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  token_digest text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL
);

CREATE TABLE refresh_sessions (
  id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(id) IS NOT DISTINCT FROM 7),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_digest text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX refresh_sessions_user ON refresh_sessions(user_id);

COMMIT;
