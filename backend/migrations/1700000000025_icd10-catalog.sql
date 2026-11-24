-- Up Migration

-- Danh mục ICD-10 để tra cứu/gợi ý khi ghi bệnh lý. `search` là tên+mã đã chuẩn
-- hoá không dấu (phục vụ tìm kiếm không phân biệt dấu). Dữ liệu nạp bằng
-- `npm run seed:icd10` (bộ mã thường dùng — phòng khám mở rộng/nhập thêm sau).
CREATE TABLE icd10_codes (
  code   text PRIMARY KEY,
  name   text NOT NULL,
  search text NOT NULL
);
CREATE INDEX icd10_search_idx ON icd10_codes (search text_pattern_ops);

-- Down Migration

DROP TABLE IF EXISTS icd10_codes;
