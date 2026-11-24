-- Up Migration

-- Hệ thống máy xét nghiệm / LIS bên ngoài KHÔNG đăng nhập bằng người dùng +
-- MFA — chúng xác thực bằng API key riêng (webhook credential). Key được lưu
-- dạng HASH (SHA-256), không bao giờ lưu key thô: lộ DB không dùng lại được.
CREATE TABLE integration_credentials (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,                 -- 'Máy sinh hoá Cobas c311', 'LIS trung tâm'
  key_hash      text NOT NULL UNIQUE,          -- sha256(raw key)
  key_prefix    text NOT NULL,                 -- 8 ký tự đầu để nhận diện trong log/UI
  scopes        text[] NOT NULL DEFAULT '{}',  -- ví dụ 'lab:ingest'
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);

CREATE INDEX integration_credentials_active_idx ON integration_credentials(key_hash) WHERE active;

-- Down Migration

DROP TABLE IF EXISTS integration_credentials;
