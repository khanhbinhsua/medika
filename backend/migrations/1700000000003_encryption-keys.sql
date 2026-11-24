-- Up Migration

-- Lưu DEK đã được wrap bởi KEK (KMS ở prod, file key ở dev).
-- Bản thân DEK plaintext KHÔNG BAO GIỜ nằm trong DB.
CREATE TABLE encryption_keys (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_type      text NOT NULL,                 -- 'patient' | 'document' | 'system'
  wrapped_dek   bytea NOT NULL,
  kek_reference text NOT NULL,                 -- ARN của KMS key hoặc id khoá dev
  version       integer NOT NULL DEFAULT 1,
  status        key_status NOT NULL DEFAULT 'active',
  created_at    timestamptz NOT NULL DEFAULT now(),
  rotated_at    timestamptz,
  destroyed_at  timestamptz,
  CONSTRAINT encryption_keys_destroyed_consistency
    CHECK ((status = 'destroyed') = (destroyed_at IS NOT NULL))
);

CREATE INDEX encryption_keys_status_idx ON encryption_keys(status);
CREATE INDEX encryption_keys_kek_reference_idx ON encryption_keys(kek_reference);

-- Secret TOTP cũng được mã hoá bằng DEK riêng
ALTER TABLE mfa_secrets
  ADD COLUMN dek_id uuid NOT NULL REFERENCES encryption_keys(id) ON DELETE RESTRICT;

-- Down Migration

ALTER TABLE mfa_secrets DROP COLUMN IF EXISTS dek_id;
DROP TABLE IF EXISTS encryption_keys;
