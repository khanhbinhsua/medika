-- Up Migration

-- Lý do khám là PHI lâm sàng ("đau ngực", "khám thai", "tái khám ung thư").
-- Ở migration 005 hai cột này còn là text thường, lệch với nguyên tắc mã hoá
-- cấp trường áp dụng cho mọi PHI khác trong hệ thống.
--
-- Không mang theo dữ liệu cũ: bảng đang rỗng (hệ thống chưa go-live). Nếu về
-- sau cần chạy trên dữ liệu thật thì phải viết bước backfill mã hoá riêng,
-- vì SQL thuần không truy cập được KEK.

ALTER TABLE appointments DROP COLUMN reason;
ALTER TABLE appointments DROP COLUMN cancel_reason;

-- Dùng chung DEK của bệnh nhân: huỷ khoá bệnh nhân (crypto-shredding) là mọi
-- lý do khám của họ cũng vĩnh viễn không giải mã được.
ALTER TABLE appointments ADD COLUMN reason_enc        bytea;
ALTER TABLE appointments ADD COLUMN cancel_reason_enc bytea;

COMMENT ON COLUMN appointments.reason_enc IS
  'Lý do khám, AES-256-GCM bằng DEK của bệnh nhân (patients.dek_id)';
COMMENT ON COLUMN appointments.cancel_reason_enc IS
  'Lý do huỷ, AES-256-GCM bằng DEK của bệnh nhân';

-- Down Migration

ALTER TABLE appointments DROP COLUMN reason_enc;
ALTER TABLE appointments DROP COLUMN cancel_reason_enc;
ALTER TABLE appointments ADD COLUMN reason text;
ALTER TABLE appointments ADD COLUMN cancel_reason text;
