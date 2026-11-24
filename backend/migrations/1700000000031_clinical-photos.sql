-- Up Migration

-- S12 — Ảnh trước/sau (before/after). Đặc thù phòng khám thẩm mỹ/da liễu: lưu ảnh
-- tiến triển điều trị theo từng vùng cơ thể để tư vấn & theo dõi kết quả. Ảnh là
-- PHI nhạy cảm → mã hoá tại chỗ (per-file DEK wrap bằng KMS), lưu storage-provider,
-- kiểm tra sha256 toàn vẹn — dùng lại đúng mô hình của bảng documents. Chú thích
-- (caption) mã hoá; category + vùng cơ thể + ngày chụp để plaintext phục vụ nhóm/lọc.

CREATE TABLE clinical_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  encounter_id uuid REFERENCES encounters(id) ON DELETE SET NULL,
  category text NOT NULL CHECK (category IN ('before','after','progress')),
  body_area text,                          -- vùng điều trị: "Mặt", "Mũi", "Cằm"…
  caption_enc bytea,                        -- chú thích (mã hoá DEK riêng của ảnh)
  taken_at date NOT NULL DEFAULT current_date,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  storage_key uuid NOT NULL UNIQUE,
  file_dek_enc bytea NOT NULL,
  sha256 text NOT NULL,
  uploaded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX clinical_photos_patient_idx ON clinical_photos(patient_id, body_area, taken_at);
CREATE INDEX clinical_photos_encounter_idx ON clinical_photos(encounter_id);

-- ── Quyền ──
-- Ghi: bác sĩ/điều dưỡng chụp & tải lên. Xem: thêm tư vấn viên (customer_care, sales)
-- vì bộ ảnh trước/sau là công cụ tư vấn khách hàng. auditor xem để đối soát.
INSERT INTO permissions (code, description) VALUES
  ('photo:read',  'Xem ảnh trước/sau của bệnh nhân'),
  ('photo:write', 'Tải lên/xoá ảnh trước/sau')
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name IN ('admin','doctor','nurse') AND p.code IN ('photo:read','photo:write');
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name IN ('customer_care','sales','auditor') AND p.code = 'photo:read';

-- Down Migration

DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE code IN ('photo:read','photo:write'));
DELETE FROM permissions WHERE code IN ('photo:read','photo:write');
DROP TABLE IF EXISTS clinical_photos;
