-- Up Migration

-- Tên xét nghiệm ("HIV", "Beta-hCG", "Đường huyết") và mã LOINC tiết lộ trực
-- tiếp loại xét nghiệm đang thực hiện — PHI nhạy cảm không kém mã ICD-10 (đã
-- mã hoá ở migration 009). Đơn vị đo, khoảng tham chiếu và cờ bất thường
-- thường đi kèm cụ thể với từng loại xét nghiệm, kết hợp lại vẫn có thể suy
-- luận ra loại xét nghiệm dù test_name đã mã hoá riêng — mã hoá luôn cho chắc.
--
-- Bảng lab_results đang RỖNG (module chưa từng được dùng) nên sửa ngay bây
-- giờ, không cần bước backfill.
ALTER TABLE lab_results DROP COLUMN test_name;
ALTER TABLE lab_results DROP COLUMN loinc_code;
ALTER TABLE lab_results DROP COLUMN unit;
ALTER TABLE lab_results DROP COLUMN reference_range;
ALTER TABLE lab_results DROP COLUMN abnormal_flag;

ALTER TABLE lab_results ADD COLUMN test_name_enc       bytea NOT NULL DEFAULT '\x';
ALTER TABLE lab_results ADD COLUMN loinc_code_enc      bytea;
ALTER TABLE lab_results ADD COLUMN unit_enc            bytea;
ALTER TABLE lab_results ADD COLUMN reference_range_enc bytea;
ALTER TABLE lab_results ADD COLUMN abnormal_flag_enc   bytea;

-- HMAC khoá riêng cho mã LOINC — cho phép thống kê "bao nhiêu ca xét nghiệm
-- loại X" bằng khớp chính xác mà không cần giải mã, giống cách ICD-10 đã làm.
ALTER TABLE lab_results ADD COLUMN loinc_search_hash text;
CREATE INDEX lab_results_loinc_hash_idx ON lab_results(loinc_search_hash)
  WHERE loinc_search_hash IS NOT NULL;

COMMENT ON COLUMN lab_results.test_name_enc IS 'Tên xét nghiệm, AES-256-GCM bằng DEK của bệnh nhân';
COMMENT ON COLUMN lab_results.abnormal_flag_enc IS 'Cờ bất thường (normal/low/high/critical), mã hoá cùng DEK';

-- Down Migration

DROP INDEX IF EXISTS lab_results_loinc_hash_idx;
ALTER TABLE lab_results DROP COLUMN test_name_enc;
ALTER TABLE lab_results DROP COLUMN loinc_code_enc;
ALTER TABLE lab_results DROP COLUMN unit_enc;
ALTER TABLE lab_results DROP COLUMN reference_range_enc;
ALTER TABLE lab_results DROP COLUMN abnormal_flag_enc;
ALTER TABLE lab_results DROP COLUMN loinc_search_hash;

ALTER TABLE lab_results ADD COLUMN test_name text NOT NULL DEFAULT '';
ALTER TABLE lab_results ADD COLUMN loinc_code text;
ALTER TABLE lab_results ADD COLUMN unit text;
ALTER TABLE lab_results ADD COLUMN reference_range text;
ALTER TABLE lab_results ADD COLUMN abnormal_flag text;
