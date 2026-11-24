-- Up Migration

-- Tên file người dùng tự đặt có thể chứa PHI ("ket-qua-HIV-NguyenVanA.pdf",
-- "sieu-am-thai-15-tuan.jpg") — mặc định phải mã hoá, giống mọi trường PHI
-- khác trong hệ thống. Bảng documents đang RỖNG (module chưa từng được dùng)
-- nên sửa ngay, không cần backfill.
ALTER TABLE documents DROP COLUMN file_name;
ALTER TABLE documents ADD COLUMN file_name_enc bytea NOT NULL DEFAULT '\x';

COMMENT ON COLUMN documents.file_name_enc IS 'Tên file gốc, AES-256-GCM bằng DEK riêng của file (không dùng chung DEK bệnh nhân)';

-- Down Migration

ALTER TABLE documents DROP COLUMN file_name_enc;
ALTER TABLE documents ADD COLUMN file_name text NOT NULL DEFAULT '';
