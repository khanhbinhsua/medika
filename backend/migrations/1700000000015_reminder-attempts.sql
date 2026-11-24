-- Up Migration

-- Đếm số lần đã thử gửi để giới hạn retry (REMINDER_MAX_ATTEMPTS). Không có
-- cột này thì một reminder gửi lỗi vĩnh viễn (email sai, SMTP chết) sẽ bị bộ
-- điều phối thử lại vô hạn ở mỗi lần chạy.
ALTER TABLE appointment_reminders ADD COLUMN attempts integer NOT NULL DEFAULT 0;

-- last_attempt_at để giãn cách các lần thử (không dồn dập) và để giám sát.
ALTER TABLE appointment_reminders ADD COLUMN last_attempt_at timestamptz;

COMMENT ON COLUMN appointment_reminders.attempts IS
  'Số lần đã thử gửi — dừng retry khi đạt REMINDER_MAX_ATTEMPTS, chuyển status=failed';

-- Down Migration

ALTER TABLE appointment_reminders DROP COLUMN attempts;
ALTER TABLE appointment_reminders DROP COLUMN last_attempt_at;
