-- Up Migration

CREATE TABLE roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  is_system   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE permissions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT ''
);

CREATE TABLE role_permissions (
  role_id       uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE users (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 citext NOT NULL UNIQUE,
  password_hash         text NOT NULL,
  full_name             text NOT NULL,
  role_id               uuid NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  status                user_status NOT NULL DEFAULT 'active',
  mfa_enabled           boolean NOT NULL DEFAULT false,
  failed_login_attempts integer NOT NULL DEFAULT 0,
  locked_until          timestamptz,
  password_changed_at   timestamptz NOT NULL DEFAULT now(),
  last_login_at         timestamptz,
  created_by            uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_lowercase CHECK (email = lower(email::text)::citext)
);

CREATE INDEX users_role_id_idx ON users(role_id);
CREATE INDEX users_status_idx   ON users(status) WHERE status = 'active';
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE mfa_secrets (
  user_id               uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_enc            bytea NOT NULL,
  recovery_codes_hashed text[] NOT NULL DEFAULT '{}',
  confirmed_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash text NOT NULL UNIQUE,
  ip_address         inet,
  user_agent         text,
  last_activity_at   timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL,
  revoked_at         timestamptz,
  revoked_reason     text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sessions_user_id_idx ON sessions(user_id) WHERE revoked_at IS NULL;
CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);

-- Token đặt lại mật khẩu (một lần dùng, hết hạn 30 phút)
CREATE TABLE password_reset_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX password_reset_tokens_user_id_idx ON password_reset_tokens(user_id);

-- Seed roles
INSERT INTO roles (name, description, is_system) VALUES
  ('admin',        'Quản trị hệ thống, quản lý người dùng và cấu hình', true),
  ('doctor',       'Bác sĩ: toàn quyền trên hồ sơ y tế bệnh nhân được phân công', true),
  ('nurse',        'Y tá: hỗ trợ khám, ghi chú, xem hồ sơ hạn chế', true),
  ('receptionist', 'Lễ tân: quản lý lịch hẹn và thông tin hành chính', true),
  ('auditor',      'Kiểm toán viên: chỉ đọc audit log, không xem PHI nội dung', true);

-- Seed permissions
INSERT INTO permissions (code, description) VALUES
  ('patient:read',        'Xem hồ sơ bệnh nhân'),
  ('patient:write',       'Tạo/sửa hồ sơ bệnh nhân'),
  ('patient:delete',      'Xoá (soft) hồ sơ bệnh nhân'),
  ('appointment:read',    'Xem lịch hẹn'),
  ('appointment:write',   'Tạo/sửa lịch hẹn'),
  ('appointment:cancel',  'Huỷ lịch hẹn'),
  ('record:read',         'Xem hồ sơ y tế'),
  ('record:write',        'Tạo/sửa hồ sơ y tế'),
  ('prescription:write',  'Kê đơn thuốc'),
  ('lab:read',            'Xem kết quả xét nghiệm'),
  ('lab:write',           'Nhập kết quả xét nghiệm'),
  ('document:read',       'Tải tài liệu y tế'),
  ('document:write',      'Tải lên tài liệu y tế'),
  ('user:read',           'Xem danh sách người dùng'),
  ('user:write',          'Tạo/sửa người dùng'),
  ('audit:read',          'Xem audit log'),
  ('report:read',         'Xem báo cáo và dashboard'),
  ('report:export',       'Xuất báo cáo PDF/Excel');

-- Gán permission cho từng role
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'admin';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'doctor' AND p.code IN (
  'patient:read','patient:write','appointment:read','appointment:write','appointment:cancel',
  'record:read','record:write','prescription:write','lab:read','lab:write',
  'document:read','document:write','report:read'
);

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'nurse' AND p.code IN (
  'patient:read','patient:write','appointment:read','appointment:write',
  'record:read','lab:read','lab:write','document:read','document:write'
);

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'receptionist' AND p.code IN (
  'patient:read','patient:write','appointment:read','appointment:write','appointment:cancel','report:read'
);

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'auditor' AND p.code IN ('audit:read','report:read','report:export');

-- Down Migration

DROP TABLE IF EXISTS password_reset_tokens, sessions, mfa_secrets, users, role_permissions, permissions, roles;
