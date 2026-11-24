-- Up Migration

-- #30 — Trừ buổi gói khi hoàn tất lịch hẹn (S13, docs/10-gap-analysis.md). Lịch hẹn hiện
-- không liên kết dịch vụ/gói, nên "tự trừ khi hoàn tất" cần một liên kết tường minh: gắn
-- lịch hẹn với một thẻ buổi (customer_packages). Khi lịch chuyển sang 'completed', backend
-- trừ 1 buổi của thẻ này (nếu còn buổi và chưa hết hạn). ON DELETE SET NULL để xoá thẻ
-- không làm hỏng lịch sử lịch hẹn.

ALTER TABLE appointments
  ADD COLUMN customer_package_id uuid REFERENCES customer_packages(id) ON DELETE SET NULL;

CREATE INDEX appointments_customer_package_idx
  ON appointments(customer_package_id) WHERE customer_package_id IS NOT NULL;

-- Down Migration

ALTER TABLE appointments DROP COLUMN IF EXISTS customer_package_id;
