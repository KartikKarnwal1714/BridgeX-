-- Reverses 006_integration_protocols.sql (drops only the columns it added).
ALTER TABLE integrations
  DROP CONSTRAINT IF EXISTS integrations_auth_mode_valid,
  DROP CONSTRAINT IF EXISTS integrations_timeout_range,
  DROP COLUMN IF EXISTS config,
  DROP COLUMN IF EXISTS auth_mode,
  DROP COLUMN IF EXISTS auth_header,
  DROP COLUMN IF EXISTS credential_enc,
  DROP COLUMN IF EXISTS timeout_ms,
  DROP COLUMN IF EXISTS last_verified_at,
  DROP COLUMN IF EXISTS last_verification_status,
  DROP COLUMN IF EXISTS last_verification_error,
  DROP COLUMN IF EXISTS last_verification_ms;
