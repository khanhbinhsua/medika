-- Up Migration

-- Sổ chi tiêu khách hàng (CRM) — KHÔNG phải hệ thống thu ngân/hoá đơn của HIS.
-- Mục tiêu: theo dõi chi tiêu của bệnh nhân để chăm sóc khách hàng tốt hơn
-- (tổng chi tiêu, lịch sử, khách VIP, nhắm chiến dịch marketing theo chi tiêu).
--
-- Tiền + loại để plaintext (cần cộng dồn/thống kê/segment); ghi chú mã hoá bằng
-- DEK của bệnh nhân (có thể lộ thông tin điều trị = PHI).

CREATE TABLE patient_transactions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id  uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  occurred_at timestamptz NOT NULL DEFAULT now(),  -- thời điểm phát sinh chi tiêu
  amount      numeric(12,2) NOT NULL CHECK (amount >= 0),
  category    text NOT NULL DEFAULT 'khac',         -- kham | thuoc | cls | thu_thuat | khac
  note_enc    bytea,                                -- ghi chú (mã hoá DEK bệnh nhân)
  source      text NOT NULL DEFAULT 'manual',       -- manual | import
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE INDEX patient_transactions_patient_idx ON patient_transactions(patient_id) WHERE deleted_at IS NULL;
CREATE INDEX patient_transactions_occurred_idx ON patient_transactions(occurred_at) WHERE deleted_at IS NULL;

-- Hạng khách theo tổng chi tiêu (VIP) — cấu hình được, xếp hạng cao nhất mà
-- tổng chi tiêu ≥ min_total. Ngưỡng tính bằng VND.
CREATE TABLE spending_tiers (
  code      text PRIMARY KEY,
  name      text NOT NULL,
  min_total numeric(12,2) NOT NULL,
  sort      int NOT NULL
);
INSERT INTO spending_tiers (code, name, min_total, sort) VALUES
  ('thuong',     'Thường',    0,          0),
  ('bac',        'Bạc',       5000000,    1),
  ('vang',       'Vàng',      20000000,   2),
  ('kim_cuong',  'Kim cương', 50000000,   3);

-- ── Quyền ────────────────────────────────────────────────────────────────
INSERT INTO permissions (code, description) VALUES
  ('spending:read',  'Xem chi tiêu khách hàng (tổng chi, lịch sử, khách VIP)'),
  ('spending:write', 'Ghi/sửa khoản chi tiêu của khách hàng');

-- read: hầu hết vai trò lâm sàng + CSKH/sale + kiểm toán. write: lễ tân + CSKH +
-- sale + admin (những người thực sự nhập khoản chi khi khách thanh toán).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'admin' AND p.code IN ('spending:read', 'spending:write');
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'receptionist' AND p.code IN ('spending:read', 'spending:write');
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'sales' AND p.code IN ('spending:read', 'spending:write');
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'customer_care' AND p.code IN ('spending:read', 'spending:write');
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name IN ('doctor', 'nurse', 'auditor') AND p.code = 'spending:read';

-- Down Migration

DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE code IN ('spending:read', 'spending:write'));
DELETE FROM permissions WHERE code IN ('spending:read', 'spending:write');
DROP TABLE IF EXISTS spending_tiers;
DROP TABLE IF EXISTS patient_transactions;
