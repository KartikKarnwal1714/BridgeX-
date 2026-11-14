-- BridgeX Phase 5: protocol configuration, encrypted credentials and verification results for integrations.
-- ADDITIVE AND IDEMPOTENT: only adds columns/constraints; no existing column, row or table is dropped,
-- rewritten or truncated. Existing integrations keep working (all new columns have safe defaults).
-- Reverse with: migrations/006_integration_protocols.down.sql
ALTER TABLE integrations
  ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}'::jsonb,   -- protocol settings: wsdlUrl, soapVersion, healthPath ...
  ADD COLUMN IF NOT EXISTS auth_mode VARCHAR(10) NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS auth_header VARCHAR(100),
  ADD COLUMN IF NOT EXISTS credential_enc TEXT,                          -- AES-256-GCM ciphertext (utils/secretBox), never plaintext
  ADD COLUMN IF NOT EXISTS timeout_ms INT,
  ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_verification_status VARCHAR(20),
  ADD COLUMN IF NOT EXISTS last_verification_error VARCHAR(300),
  ADD COLUMN IF NOT EXISTS last_verification_ms INT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'integrations_auth_mode_valid') THEN
    ALTER TABLE integrations ADD CONSTRAINT integrations_auth_mode_valid CHECK (auth_mode IN ('none', 'bearer', 'header'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'integrations_timeout_range') THEN
    ALTER TABLE integrations ADD CONSTRAINT integrations_timeout_range CHECK (timeout_ms IS NULL OR timeout_ms BETWEEN 100 AND 60000);
  END IF;
END $$;
