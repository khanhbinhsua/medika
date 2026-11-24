-- Up Migration

-- Tài khoản cổng bệnh nhân — TÁCH HOÀN TOÀN khỏi bảng users (nhân viên). Bệnh
-- nhân không có role, không truy cập được bất kỳ endpoint nhân viên nào; và
-- ngược lại token nhân viên không dùng được ở cổng bệnh nhân (khác JWT audience).
--
-- Email đăng nhập lưu dạng HMAC (login_email_hash) để tra cứu mà không lưu
-- thêm bản plaintext PHI — email thật đã nằm trong patients.email_enc.
CREATE TABLE patient_portal_accounts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id            uuid NOT NULL UNIQUE REFERENCES patients(id) ON DELETE CASCADE,
  login_email_hash      text NOT NULL UNIQUE,       -- HMAC-SHA256 của email đăng nhập
  password_hash         text NOT NULL,              -- Argon2id
  status                text NOT NULL DEFAULT 'active',   -- 'active' | 'disabled'
  failed_login_attempts integer NOT NULL DEFAULT 0,
  locked_until          timestamptz,
  last_login_at         timestamptz,
  must_change_password  boolean NOT NULL DEFAULT true,
  created_by            uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX patient_portal_accounts_email_idx ON patient_portal_accounts(login_email_hash);
CREATE TRIGGER patient_portal_accounts_set_updated_at BEFORE UPDATE ON patient_portal_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Phiên đăng nhập của bệnh nhân — tách khỏi sessions của nhân viên.
CREATE TABLE patient_portal_sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_account_id  uuid NOT NULL REFERENCES patient_portal_accounts(id) ON DELETE CASCADE,
  refresh_token_hash text NOT NULL UNIQUE,
  ip_address         inet,
  user_agent         text,
  last_activity_at   timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL,
  revoked_at         timestamptz,
  revoked_reason     text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX patient_portal_sessions_account_idx ON patient_portal_sessions(portal_account_id);

-- Quyền cho nhân viên tạo/quản lý tài khoản cổng bệnh nhân.
INSERT INTO permissions (code, description) VALUES
  ('portal:manage', 'Tạo và quản lý tài khoản cổng bệnh nhân');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name IN ('admin', 'receptionist') AND p.code = 'portal:manage';

-- Down Migration

DELETE FROM role_permissions WHERE permission_id = (SELECT id FROM permissions WHERE code = 'portal:manage');
DELETE FROM permissions WHERE code = 'portal:manage';
DROP TABLE IF EXISTS patient_portal_sessions;
DROP TABLE IF EXISTS patient_portal_accounts;
