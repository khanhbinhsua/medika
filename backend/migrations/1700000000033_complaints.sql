-- Up Migration

-- #5 / #63 — Phiếu khiếu nại khách hàng (complaints). Phục vụ banner "khiếu nại mở" trên
-- hồ sơ + quản lý loại/mức độ/trạng thái/người xử lý. Nội dung chi tiết và cách xử lý là
-- PHI → mã hoá field-level bằng DEK của bệnh nhân. Loại/mức độ/trạng thái/tiêu đề để
-- plaintext phục vụ lọc + hiển thị danh sách (tiêu đề nên là nhãn ngắn, tránh PHI nhạy cảm).

CREATE SEQUENCE complaint_code_seq START 1;

CREATE TABLE complaints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE DEFAULT ('KN-' || lpad(nextval('complaint_code_seq')::text, 6, '0')),
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  category text NOT NULL CHECK (category IN ('service','attitude','price','result','wait_time','other')),
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','closed')),
  title text NOT NULL,
  detail_enc bytea,                 -- nội dung chi tiết (mã hoá DEK bệnh nhân)
  assigned_to uuid REFERENCES users(id),
  resolution_enc bytea,             -- cách xử lý/kết luận (mã hoá)
  resolved_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX complaints_patient_idx ON complaints(patient_id, created_at DESC);
CREATE INDEX complaints_open_idx ON complaints(status) WHERE status IN ('open','in_progress');

-- ── Quyền ──
INSERT INTO permissions (code, description) VALUES
  ('complaint:read',  'Xem khiếu nại khách hàng'),
  ('complaint:write', 'Tạo và xử lý khiếu nại')
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name IN ('admin','customer_care','receptionist') AND p.code IN ('complaint:read','complaint:write');
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name IN ('doctor','nurse','sales','auditor') AND p.code = 'complaint:read';

-- Down Migration

DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE code IN ('complaint:read','complaint:write'));
DELETE FROM permissions WHERE code IN ('complaint:read','complaint:write');
DROP TABLE IF EXISTS complaints;
DROP SEQUENCE IF EXISTS complaint_code_seq;
