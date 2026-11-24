-- Up Migration

-- Tiêu đề hồ sơ và mã ICD-10 đều là PHI lâm sàng:
--   * icd10_code CHÍNH LÀ mã chẩn đoán (E11.9 tiểu đường, F32 trầm cảm,
--     B20 HIV). Nằm cạnh patient_id ở dạng plaintext thì chỉ cần đọc được
--     bảng là biết bệnh của từng người.
--   * title kiểu "Khám tim mạch lần đầu" cũng để lộ chuyên khoa và tình trạng.
-- Ở migration 006 hai cột này còn là text thường, lệch với nguyên tắc mã hoá
-- cấp trường áp dụng cho mọi PHI khác.
--
-- Không mang theo dữ liệu cũ: bảng mới chỉ có dữ liệu thử nghiệm và hệ thống
-- chưa go-live. Trên dữ liệu thật cần một bước backfill riêng ở tầng ứng dụng,
-- vì SQL thuần không truy cập được KEK để mã hoá.

ALTER TABLE medical_records DROP COLUMN title;
ALTER TABLE medical_records DROP COLUMN icd10_code;
ALTER TABLE medical_records ADD COLUMN title_enc      bytea NOT NULL DEFAULT '\x';
ALTER TABLE medical_records ADD COLUMN icd10_code_enc bytea;

-- HMAC khoá riêng: cho phép thống kê "bao nhiêu ca I20.9" bằng khớp chính xác
-- mà không cần giải mã, giống cách tìm kiếm bệnh nhân.
ALTER TABLE medical_records ADD COLUMN icd10_search_hash text;
CREATE INDEX medical_records_icd10_hash_idx ON medical_records(icd10_search_hash)
  WHERE icd10_search_hash IS NOT NULL;

ALTER TABLE medical_record_versions DROP COLUMN title;
ALTER TABLE medical_record_versions DROP COLUMN icd10_code;
ALTER TABLE medical_record_versions ADD COLUMN title_enc      bytea NOT NULL DEFAULT '\x';
ALTER TABLE medical_record_versions ADD COLUMN icd10_code_enc bytea;

COMMENT ON COLUMN medical_records.title_enc IS
  'Tiêu đề hồ sơ, AES-256-GCM bằng DEK của bệnh nhân';
COMMENT ON COLUMN medical_records.icd10_code_enc IS
  'Mã chẩn đoán ICD-10, AES-256-GCM bằng DEK của bệnh nhân';
COMMENT ON COLUMN medical_records.icd10_search_hash IS
  'HMAC-SHA256 của mã ICD-10, phục vụ thống kê khớp chính xác';

-- Down Migration

DROP INDEX IF EXISTS medical_records_icd10_hash_idx;
ALTER TABLE medical_records DROP COLUMN title_enc;
ALTER TABLE medical_records DROP COLUMN icd10_code_enc;
ALTER TABLE medical_records DROP COLUMN icd10_search_hash;
ALTER TABLE medical_records ADD COLUMN title text NOT NULL DEFAULT '';
ALTER TABLE medical_records ADD COLUMN icd10_code text;

ALTER TABLE medical_record_versions DROP COLUMN title_enc;
ALTER TABLE medical_record_versions DROP COLUMN icd10_code_enc;
ALTER TABLE medical_record_versions ADD COLUMN title text NOT NULL DEFAULT '';
ALTER TABLE medical_record_versions ADD COLUMN icd10_code text;
