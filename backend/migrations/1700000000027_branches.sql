-- Up Migration

-- Mốc 0 — Nền đa chi nhánh (Quyết định B3: nhân CRM đa chi nhánh; clinic-ops là
-- module tùy chọn thêm sau). Thêm branches + user_branches + users.locale và gắn
-- branch_id vào appointments (bảng vận hành lõi). Rooms/machines đi cùng module
-- lịch hẹn nâng cao (Mốc 1).

CREATE TABLE branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE,
  name text NOT NULL,
  address text,
  phone text,
  geo_radius_m int,                       -- cho chấm công theo bán kính (HRM, sau)
  opening_hours jsonb NOT NULL DEFAULT '{}',
  holidays jsonb NOT NULL DEFAULT '[]',
  slot_capacity int,
  is_default boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Chỉ một chi nhánh mặc định.
CREATE UNIQUE INDEX branches_one_default ON branches (is_default) WHERE is_default;

CREATE TABLE user_branches (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, branch_id)
);
CREATE INDEX user_branches_branch_idx ON user_branches (branch_id);

-- Ngôn ngữ nhân viên (VI/EN/KO — recon S02).
ALTER TABLE users ADD COLUMN locale text NOT NULL DEFAULT 'vi';

-- Gắn chi nhánh vào lịch hẹn (nullable + backfill để không vỡ dữ liệu cũ).
ALTER TABLE appointments ADD COLUMN branch_id uuid REFERENCES branches(id);
CREATE INDEX appointments_branch_start_idx ON appointments (branch_id, scheduled_start);

-- ── Seed: chi nhánh mặc định + gán mọi nhân viên + backfill lịch hẹn ──
INSERT INTO branches (code, name, is_default) VALUES ('MAIN', 'Chi nhánh chính', true);

INSERT INTO user_branches (user_id, branch_id)
SELECT u.id, b.id FROM users u CROSS JOIN branches b WHERE b.is_default;

UPDATE appointments SET branch_id = (SELECT id FROM branches WHERE is_default)
WHERE branch_id IS NULL;

-- ── Quyền ──
INSERT INTO permissions (code, description) VALUES
  ('branch:read',   'Xem danh sách chi nhánh'),
  ('branch:manage', 'Tạo/sửa chi nhánh và phân công nhân viên')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name IN ('admin','doctor','nurse','receptionist','auditor','sales','customer_care')
  AND p.code = 'branch:read';
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'admin' AND p.code = 'branch:manage';

-- Down Migration

DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE code IN ('branch:read','branch:manage'));
DELETE FROM permissions WHERE code IN ('branch:read','branch:manage');
ALTER TABLE appointments DROP COLUMN IF EXISTS branch_id;
ALTER TABLE users DROP COLUMN IF EXISTS locale;
DROP TABLE IF EXISTS user_branches;
DROP TABLE IF EXISTS branches;
