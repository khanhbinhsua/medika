-- Up Migration

-- F03 — POS / Gói / Thanh toán (module clinic-ops opt-in, B3). TIỀN = bigint VND
-- (đồng nguyên, không cent). Đơn (orders) gồm nhiều dòng (dịch vụ/gói), thu bằng
-- nhiều phương thức, cho thu một phần → công nợ. Mua gói đã thanh toán → thẻ buổi.

CREATE TABLE services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,   -- null = dùng chung
  code text,
  name text NOT NULL,
  category text,
  price_vnd bigint NOT NULL CHECK (price_vnd >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX services_active_idx ON services(active) WHERE active;

CREATE TABLE packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  unit text NOT NULL CHECK (unit IN ('session','shot')),
  qty int NOT NULL CHECK (qty > 0),
  price_vnd bigint NOT NULL CHECK (price_vnd >= 0),
  validity_days int,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Mã đơn DH-000001 tăng dần.
CREATE SEQUENCE order_code_seq START 1;

CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE DEFAULT ('DH-' || lpad(nextval('order_code_seq')::text, 6, '0')),
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  appointment_id uuid REFERENCES appointments(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','unpaid','partial','paid','cancelled')),
  total_vnd bigint NOT NULL DEFAULT 0,
  note text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orders_patient_idx ON orders(patient_id, created_at DESC);
CREATE INDEX orders_status_idx ON orders(status) WHERE status IN ('unpaid','partial');

CREATE TABLE order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('service','package','other')),
  ref_id uuid,                               -- services.id / packages.id (null nếu nhập tay)
  name text NOT NULL,                        -- chụp tên tại thời điểm bán
  qty int NOT NULL DEFAULT 1 CHECK (qty > 0),
  unit_price_vnd bigint NOT NULL CHECK (unit_price_vnd >= 0),
  discount_vnd bigint NOT NULL DEFAULT 0 CHECK (discount_vnd >= 0),
  amount_vnd bigint NOT NULL CHECK (amount_vnd >= 0),   -- qty*unit_price - discount
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_lines_order_idx ON order_lines(order_id);

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  method text NOT NULL CHECK (method IN ('cash','transfer','card','prepaid','other')),
  amount_vnd bigint NOT NULL CHECK (amount_vnd > 0),
  received_by uuid NOT NULL REFERENCES users(id),
  paid_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_order_idx ON payments(order_id);
CREATE INDEX payments_paid_idx ON payments(paid_at);

CREATE TABLE customer_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  package_id uuid NOT NULL REFERENCES packages(id),
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  name text NOT NULL,
  total int NOT NULL CHECK (total > 0),
  used int NOT NULL DEFAULT 0,
  expires_at date,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customer_packages_patient_idx ON customer_packages(patient_id);

-- ── Quyền ──
INSERT INTO permissions (code, description) VALUES
  ('billing:read',   'Xem đơn, sổ thanh toán, công nợ'),
  ('billing:manage', 'Tạo đơn và thu tiền')
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name IN ('admin','receptionist') AND p.code IN ('billing:read','billing:manage');
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name IN ('doctor','sales','customer_care','auditor') AND p.code = 'billing:read';

-- ── Seed danh mục (phòng khám thẩm mỹ/da liễu) ──
INSERT INTO services (code, name, category, price_vnd) VALUES
  ('KHAM',   'Khám da liễu',        'kham',      200000),
  ('SOI',    'Soi da công nghệ',    'kham',      150000),
  ('PEEL',   'Peel da',             'thu_thuat', 800000),
  ('MUN',    'Điều trị mụn',        'thu_thuat', 500000),
  ('LASER',  'Laser trị nám',       'thu_thuat', 1500000),
  ('BOTOX',  'Tiêm Botox',          'thu_thuat', 3000000);

INSERT INTO packages (name, unit, qty, price_vnd, validity_days) VALUES
  ('Liệu trình trị mụn 10 buổi', 'session', 10, 4500000, 180),
  ('Peel da 5 buổi',             'session', 5,  3500000, 180),
  ('Laser trị nám 6 buổi',       'session', 6,  8000000, 365);

-- Down Migration

DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE code IN ('billing:read','billing:manage'));
DELETE FROM permissions WHERE code IN ('billing:read','billing:manage');
DROP TABLE IF EXISTS customer_packages;
DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS order_lines;
DROP TABLE IF EXISTS orders;
DROP SEQUENCE IF EXISTS order_code_seq;
DROP TABLE IF EXISTS packages;
DROP TABLE IF EXISTS services;
