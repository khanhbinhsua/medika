-- Up Migration

-- Module 7: Phác đồ điều trị (Treatment Plans).
-- Phác đồ = kế hoạch điều trị nhiều bước cho một bệnh nhân, có ước tính chi phí,
-- theo dõi tiến độ, phê duyệt bởi bác sĩ trưởng, và có thể tạo từ template mẫu.
--
-- Mã hoá chọn lọc (theo triết lý sẵn có của hệ thống):
--   - Nội dung LÂM SÀNG (tiêu đề phác đồ, mô tả bước, lý do huỷ) = PHI → mã hoá
--     bằng DEK của bệnh nhân (bytea *_enc).
--   - Chi phí (numeric) = dữ liệu tài chính, KHÔNG mã hoá → phục vụ tổng hợp/báo cáo.
--   - Template mẫu KHÔNG gắn bệnh nhân cụ thể → KHÔNG phải PHI → lưu plaintext.

CREATE TYPE treatment_plan_status AS ENUM ('draft', 'pending_approval', 'active', 'completed', 'cancelled');
CREATE TYPE treatment_step_status AS ENUM ('pending', 'scheduled', 'completed', 'skipped', 'cancelled');

-- ── Template mẫu (blueprint theo bệnh lý, tái sử dụng, không PHI) ─────────
CREATE TABLE treatment_plan_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  condition   text,                    -- bệnh lý áp dụng (nhãn/ICD-10), không PHI
  description text,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER treatment_plan_templates_set_updated_at BEFORE UPDATE ON treatment_plan_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE treatment_plan_template_steps (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id    uuid NOT NULL REFERENCES treatment_plan_templates(id) ON DELETE CASCADE,
  step_order     integer NOT NULL,
  title          text NOT NULL,        -- generic, không PHI
  description    text,
  estimated_cost numeric(12,2) NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, step_order)
);

-- ── Phác đồ của bệnh nhân ────────────────────────────────────────────────
CREATE TABLE treatment_plans (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id        uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  doctor_id         uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, -- bác sĩ phụ trách
  template_id       uuid REFERENCES treatment_plan_templates(id) ON DELETE SET NULL,
  title_enc         bytea NOT NULL,     -- PHI
  status            treatment_plan_status NOT NULL DEFAULT 'draft',
  total_cost        numeric(12,2) NOT NULL DEFAULT 0, -- = tổng cost các bước (đồng bộ trong service)
  approved_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at       timestamptz,
  cancel_reason_enc bytea,              -- PHI
  cancelled_at      timestamptz,
  created_by        uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX treatment_plans_patient_idx ON treatment_plans(patient_id, created_at DESC);
CREATE INDEX treatment_plans_status_idx ON treatment_plans(status);
CREATE TRIGGER treatment_plans_set_updated_at BEFORE UPDATE ON treatment_plans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE treatment_steps (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  treatment_plan_id uuid NOT NULL REFERENCES treatment_plans(id) ON DELETE CASCADE,
  step_order        integer NOT NULL,
  title_enc         bytea NOT NULL,     -- PHI
  description_enc   bytea,              -- PHI
  cost              numeric(12,2) NOT NULL DEFAULT 0,
  status            treatment_step_status NOT NULL DEFAULT 'pending',
  scheduled_date    timestamptz,
  completed_at      timestamptz,
  -- Liên kết "lịch điều trị tiếp theo" tới một lịch hẹn cụ thể.
  appointment_id    uuid REFERENCES appointments(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (treatment_plan_id, step_order)
);
CREATE INDEX treatment_steps_plan_idx ON treatment_steps(treatment_plan_id, step_order);
CREATE TRIGGER treatment_steps_set_updated_at BEFORE UPDATE ON treatment_steps
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Quyền ────────────────────────────────────────────────────────────────
INSERT INTO permissions (code, description) VALUES
  ('treatment:read',    'Xem phác đồ điều trị'),
  ('treatment:write',   'Tạo/sửa phác đồ và các bước điều trị'),
  ('treatment:approve', 'Phê duyệt phác đồ điều trị (bác sĩ trưởng)');

-- admin: mọi quyền treatment. doctor/nurse: đọc+ghi. Chỉ doctor có quyền phê
-- duyệt (và service ép tách vai trò: người duyệt PHẢI khác bác sĩ phụ trách).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'admin' AND p.code IN ('treatment:read', 'treatment:write', 'treatment:approve');
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'doctor' AND p.code IN ('treatment:read', 'treatment:write', 'treatment:approve');
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'nurse' AND p.code IN ('treatment:read', 'treatment:write');
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'receptionist' AND p.code IN ('treatment:read');

-- ── Template mẫu sẵn (nha khoa — ngành hay dùng phác đồ nhiều bước) ───────
INSERT INTO treatment_plan_templates (code, name, condition, description) VALUES
  ('endo_molar', 'Điều trị tuỷ răng hàm', 'K04.0 Viêm tuỷ',
   'Phác đồ điều trị tuỷ răng hàm 3 lần hẹn, kèm phục hình.');
INSERT INTO treatment_plan_template_steps (template_id, step_order, title, description, estimated_cost)
SELECT id, s.step_order, s.title, s.description, s.cost
FROM treatment_plan_templates t,
  (VALUES
    (1, 'Khám, chụp X-quang & mở tuỷ', 'Đánh giá, gây tê, mở buồng tuỷ, đặt thuốc', 500000),
    (2, 'Sửa soạn & trám bít ống tuỷ', 'Làm sạch, tạo hình, trám bít hệ thống ống tuỷ', 1200000),
    (3, 'Phục hình thân răng', 'Tái tạo cùi, bọc mão sứ', 3000000)
  ) AS s(step_order, title, description, cost)
WHERE t.code = 'endo_molar';

-- Down Migration

DROP TABLE IF EXISTS treatment_steps;
DROP TABLE IF EXISTS treatment_plans;
DROP TABLE IF EXISTS treatment_plan_template_steps;
DROP TABLE IF EXISTS treatment_plan_templates;
DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE code IN ('treatment:read', 'treatment:write', 'treatment:approve'));
DELETE FROM permissions WHERE code IN ('treatment:read', 'treatment:write', 'treatment:approve');
DROP TYPE IF EXISTS treatment_step_status;
DROP TYPE IF EXISTS treatment_plan_status;
