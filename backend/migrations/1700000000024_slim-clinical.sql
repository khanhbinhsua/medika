-- Up Migration

-- Rút gọn lớp lâm sàng về đúng phần CRM dùng: bỏ bệnh án SOAP (medical_records
-- + lịch sử phiên bản) và kết quả xét nghiệm (lab_results + tiếp nhận HL7/FHIR).
-- GIỮ: đơn thuốc (nhắc tái khám), tài liệu, bệnh lý & dị ứng (cá nhân hoá/segment).
--
-- CẢNH BÁO: đây là thao tác phá huỷ, xoá dữ liệu lâm sàng. Không thể phục hồi
-- bằng migrate down — chỉ khôi phục được từ bản sao lưu database.

-- prescriptions/documents chỉ liên kết TUỲ CHỌN tới bệnh án → bỏ cột record_id,
-- chúng vẫn gắn trực tiếp với bệnh nhân qua patient_id.
ALTER TABLE prescriptions DROP COLUMN IF EXISTS record_id;
ALTER TABLE documents      DROP COLUMN IF EXISTS record_id;

-- lab_results tham chiếu medical_records → phải bỏ trước. medical_record_versions
-- cũng tham chiếu medical_records.
DROP TABLE IF EXISTS lab_results;
DROP TABLE IF EXISTS medical_record_versions;
DROP TABLE IF EXISTS medical_records;

-- Tiếp nhận HL7/FHIR chỉ phục vụ đẩy kết quả xét nghiệm → bỏ cùng lab.
DROP TABLE IF EXISTS integration_credentials;

-- Bỏ quyền không còn dùng. record:read GIỮ lại (đơn thuốc vẫn dùng để xem).
DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE code IN ('record:write', 'lab:read', 'lab:write'));
DELETE FROM permissions WHERE code IN ('record:write', 'lab:read', 'lab:write');

-- ── Quyền quản lý Bệnh lý & Dị ứng (thay cho hồ sơ SOAP) ────────────────────
INSERT INTO permissions (code, description) VALUES
  ('condition:read',  'Xem bệnh lý & dị ứng của bệnh nhân'),
  ('condition:write', 'Ghi/sửa bệnh lý & dị ứng của bệnh nhân')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name IN ('admin', 'doctor', 'nurse') AND p.code IN ('condition:read', 'condition:write');
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name IN ('receptionist', 'sales', 'customer_care', 'auditor') AND p.code = 'condition:read';

-- Down Migration

-- KHÔNG khôi phục được dữ liệu bệnh án/xét nghiệm đã xoá — phải phục hồi từ backup.
-- Down chỉ hoàn lại phần quyền + cột liên kết để migrate không lỗi.
DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE code IN ('condition:read', 'condition:write'));
DELETE FROM permissions WHERE code IN ('condition:read', 'condition:write');

INSERT INTO permissions (code, description) VALUES
  ('record:write', 'Tạo/sửa hồ sơ y tế'),
  ('lab:read',     'Xem kết quả xét nghiệm'),
  ('lab:write',    'Ghi/duyệt kết quả xét nghiệm')
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'admin' AND p.code IN ('record:write', 'lab:read', 'lab:write');

ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS record_id uuid;
ALTER TABLE documents      ADD COLUMN IF NOT EXISTS record_id uuid;
