-- Up Migration
-- Tích hợp DK-link: nhận webhook "bệnh nhân mới" và tạo bản ghi trong CRM.

-- Liên kết 1-1 với id bệnh nhân bên DK-link để upsert idempotent (webhook có
-- thể gửi lại). Unique một phần: chỉ áp cho hàng đã liên kết.
ALTER TABLE patients ADD COLUMN dklink_patient_id text;
CREATE UNIQUE INDEX patients_dklink_patient_id_idx
  ON patients(dklink_patient_id) WHERE dklink_patient_id IS NOT NULL;

-- User hệ thống dùng làm created_by cho bệnh nhân được đẩy từ DK-link.
-- KHÔNG đăng nhập được: status 'disabled' + password_hash không hợp lệ (argon2
-- verify sẽ luôn thất bại), quyền thấp nhất (auditor, chỉ đọc). UUID cố định để
-- code integration tham chiếu.
INSERT INTO users (id, email, password_hash, full_name, role_id, status)
VALUES (
  '00000000-0000-0000-0000-0000000d11a1',
  'dklink-integration@system.local',
  'DISABLED-NO-LOGIN',
  'DK-link Integration',
  (SELECT id FROM roles WHERE name = 'auditor' LIMIT 1),
  'disabled'
)
ON CONFLICT (id) DO NOTHING;

-- Down Migration
DELETE FROM users WHERE id = '00000000-0000-0000-0000-0000000d11a1';
DROP INDEX IF EXISTS patients_dklink_patient_id_idx;
ALTER TABLE patients DROP COLUMN IF EXISTS dklink_patient_id;
