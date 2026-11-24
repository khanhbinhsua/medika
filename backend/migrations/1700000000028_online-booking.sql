-- Up Migration

-- F06 — Đặt lịch online (recon S09). Public KHÔNG ghi thẳng vào bảng PHI: ghi vào
-- booking_requests (staging, staff-only). Lễ tân xác nhận → tạo/khớp bệnh nhân +
-- lịch hẹn. Tên/SĐT lưu plaintext để gọi lại; chỉ nhân sự đọc; nên purge sau khi
-- xử lý/hết hạn (job dọn — giai đoạn sau).

CREATE TABLE booking_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  requested_start timestamptz NOT NULL,
  requested_end timestamptz NOT NULL,
  full_name text NOT NULL,
  phone text NOT NULL,
  note text,                              -- nhu cầu/dịch vụ mong muốn (chưa có danh mục dịch vụ)
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rejected')),
  source text NOT NULL DEFAULT 'online',
  confirmed_appointment_id uuid REFERENCES appointments(id) ON DELETE SET NULL,
  reject_reason text,
  handled_by uuid REFERENCES users(id),
  handled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_requests_time CHECK (requested_end > requested_start)
);
CREATE INDEX booking_requests_pending_idx ON booking_requests (branch_id, requested_start) WHERE status = 'pending';

-- Nguồn lịch hẹn (prebooked|phone|online|walkin) — đánh dấu lịch tạo từ đặt online.
ALTER TABLE appointments ADD COLUMN source text NOT NULL DEFAULT 'walkin'
  CHECK (source IN ('prebooked','phone','online','walkin'));

-- Giờ mở cửa + sức chứa khung giờ cho chi nhánh mặc định (để slot hiển thị ngay).
-- opening_hours: {"mon":[["08:00","12:00"],["13:30","17:00"]], ...}; sun nghỉ.
UPDATE branches SET
  opening_hours = '{"mon":[["08:00","12:00"],["13:30","17:00"]],"tue":[["08:00","12:00"],["13:30","17:00"]],"wed":[["08:00","12:00"],["13:30","17:00"]],"thu":[["08:00","12:00"],["13:30","17:00"]],"fri":[["08:00","12:00"],["13:30","17:00"]],"sat":[["08:00","12:00"]]}'::jsonb,
  slot_capacity = COALESCE(slot_capacity, 5)
WHERE is_default;

-- ── Quyền ── (public endpoint không cần quyền)
INSERT INTO permissions (code, description) VALUES
  ('booking:manage', 'Xem và xác nhận yêu cầu đặt lịch online')
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name IN ('admin','receptionist') AND p.code = 'booking:manage';

-- Down Migration

DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE code = 'booking:manage');
DELETE FROM permissions WHERE code = 'booking:manage';
ALTER TABLE appointments DROP COLUMN IF EXISTS source;
DROP TABLE IF EXISTS booking_requests;
