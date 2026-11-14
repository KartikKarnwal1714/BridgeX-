-- Additive persistent idempotency storage for authenticated API and integration creation.
-- This migration creates a new table only; it does not alter or delete application data.
CREATE TABLE IF NOT EXISTS idempotency_records (
  id BIGSERIAL PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation VARCHAR(120) NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  request_fingerprint CHAR(64) NOT NULL,
  response_status SMALLINT,
  response_headers JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_body JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours',
  CONSTRAINT idempotency_owner_operation_key UNIQUE (owner_id, operation, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idempotency_records_expiry_idx ON idempotency_records (expires_at);
