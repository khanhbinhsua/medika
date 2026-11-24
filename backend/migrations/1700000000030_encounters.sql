-- Up Migration

-- F02 — Bệnh án ngoại trú 15/BV1 (MS 15/BV-01, TT 32/2023/TT-BYT). Module clinic-ops
-- opt-in (B3). Phần I HÀNH CHÍNH lấy tự động từ hồ sơ bệnh nhân (không lưu lại).
-- Các trường lâm sàng (II–IV) mã hoá field-level bằng DEK của bệnh nhân. Mã ICD-10
-- để plaintext (danh mục, phục vụ thống kê/segment). Hoàn tất = ký + khoá; sửa sau
-- khoá = bản bổ sung (amend) có lý do, giữ snapshot bản cũ.

CREATE TABLE encounters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  appointment_id uuid REFERENCES appointments(id) ON DELETE SET NULL,
  doctor_id uuid NOT NULL REFERENCES users(id),
  -- II. Lý do vào viện · III. Hỏi bệnh
  reason_enc bytea,                      -- II. Lý do vào viện
  history_enc bytea,                     -- III.1 Quá trình bệnh lý (bệnh sử)
  past_personal_enc bytea,               -- III.2 Tiền sử bản thân
  past_family_enc bytea,                 -- III.2 Tiền sử gia đình
  -- IV. Khám bệnh
  vitals jsonb NOT NULL DEFAULT '{}',    -- mạch, nhiệt độ, huyết áp, nhịp thở, cân nặng
  exam_general_enc bytea,                -- IV.1 Toàn thân
  exam_organs_enc bytea,                 -- IV.2 Các bộ phận
  labs_summary_enc bytea,               -- IV.3 Tóm tắt kết quả cận lâm sàng
  treatment_enc bytea,                   -- IV.5 Đã xử lý / hướng điều trị / lời dặn
  dx_note_enc bytea,                     -- diễn giải chẩn đoán (nếu có)
  -- IV.6 Chẩn đoán khi ra viện + mã
  dx_primary_icd10 text REFERENCES icd10_codes(code),
  dx_secondary_icd10 text[] NOT NULL DEFAULT '{}',
  -- IV.7 Điều trị ngoại trú từ..đến
  treatment_from date,
  treatment_to date,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','signed','amended')),
  signed_at timestamptz,
  signed_by uuid REFERENCES users(id),
  locked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX encounters_patient_idx ON encounters(patient_id, created_at DESC);
CREATE INDEX encounters_branch_idx ON encounters(branch_id, created_at DESC);

-- Lịch sử sửa bổ sung sau khi ký (giữ snapshot ciphertext bản cũ).
CREATE TABLE encounter_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id uuid NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
  version int NOT NULL,
  snapshot_enc bytea NOT NULL,           -- JSON toàn bộ trường lâm sàng bản cũ (mã hoá DEK)
  changed_by uuid NOT NULL REFERENCES users(id),
  change_reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX encounter_versions_idx ON encounter_versions(encounter_id, version);

-- Đơn thuốc gắn với lượt khám (kê đơn từ bệnh án).
ALTER TABLE prescriptions ADD COLUMN encounter_id uuid REFERENCES encounters(id) ON DELETE SET NULL;

-- ── Quyền ──
INSERT INTO permissions (code, description) VALUES
  ('encounter:read',  'Xem bệnh án ngoại trú'),
  ('encounter:write', 'Ghi/sửa/ký bệnh án ngoại trú')
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name IN ('admin','doctor','nurse') AND p.code IN ('encounter:read','encounter:write');
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'auditor' AND p.code = 'encounter:read';

-- Down Migration

DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE code IN ('encounter:read','encounter:write'));
DELETE FROM permissions WHERE code IN ('encounter:read','encounter:write');
ALTER TABLE prescriptions DROP COLUMN IF EXISTS encounter_id;
DROP TABLE IF EXISTS encounter_versions;
DROP TABLE IF EXISTS encounters;
