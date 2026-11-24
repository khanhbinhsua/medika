-- Up Migration

-- Chống dùng lại mã TOTP (RFC 6238 khuyến nghị). Không có cột này, một mã 6 số
-- hợp lệ bị lộ (quay màn hình, nhìn trộm, phần mềm gián điệp) có thể bị dùng
-- lại trong suốt cửa sổ ±1 bước (~90 giây) kể cả sau khi chủ tài khoản đã
-- đăng nhập bằng chính mã đó.
--
-- Lưu STEP (Unix time / 30), không lưu timestamp — so sánh số nguyên đơn giản
-- và không phụ thuộc múi giờ server.
ALTER TABLE mfa_secrets ADD COLUMN last_used_step bigint;

COMMENT ON COLUMN mfa_secrets.last_used_step IS
  'Bước TOTP (unix_time/30) đã dùng gần nhất — chặn tái sử dụng mã trong cùng cửa sổ';

-- Down Migration

ALTER TABLE mfa_secrets DROP COLUMN last_used_step;
