-- Up Migration

-- Không có index nào phủ được `outcome` — cả màn hình lọc "chỉ xem bị từ chối"
-- (GET /audit/logs?outcome=denied) lẫn bộ phát hiện bất thường "nhiều lần bị
-- từ chối liên tiếp" đều WHERE outcome = 'denied'. Bảng này giữ dữ liệu 6 năm
-- theo yêu cầu HIPAA nên sẽ ngày càng lớn — thiếu index này nghĩa là seq scan
-- toàn bảng mỗi lần lọc, ngày càng chậm dần theo thời gian.
--
-- Index bán phần (WHERE outcome != 'success') vì phần lớn dòng là 'success'
-- (thao tác thành công là số đông) — chỉ số hoá phần thiểu số cần tra cứu,
-- giữ index nhỏ và nhanh, giống cách appointments_status_idx đã làm.
CREATE INDEX audit_logs_outcome_idx ON audit_logs(outcome, created_at DESC)
  WHERE outcome != 'success';

-- Down Migration

DROP INDEX IF EXISTS audit_logs_outcome_idx;
