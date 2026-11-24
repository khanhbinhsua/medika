-- Up Migration

-- Hệ thống thông báo đa kênh (Zalo ZNS / SMS Brandname / Email) với fallback.
-- Mở rộng khái niệm nhắc lịch (appointment_reminders) thành thông báo tổng quát
-- theo template, dùng cho nhắc lịch, xác nhận, tái khám, khảo sát, marketing.

CREATE TYPE notification_channel AS ENUM ('zalo', 'sms', 'email');
CREATE TYPE notification_status  AS ENUM ('pending', 'sent', 'failed', 'read');
CREATE TYPE notification_kind    AS ENUM (
  'appointment_reminder', 'appointment_confirm', 'appointment_cancel',
  'rebooking_reminder', 'treatment_next', 'survey', 'marketing', 'custom'
);

-- Số Zalo của bệnh nhân — PII liên hệ, mã hoá như email/phone.
ALTER TABLE patients ADD COLUMN zalo_id_enc bytea;

-- Template thông báo. content chứa placeholder {{ten_bien}} thay lúc gửi.
-- KHÔNG chứa PHI trong bảng template (chỉ khung), PHI được ghép lúc render.
CREATE TABLE notification_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text NOT NULL UNIQUE,          -- 'appointment_reminder', ...
  name            text NOT NULL,
  kind            notification_kind NOT NULL,
  channel         notification_channel NOT NULL, -- template riêng cho từng kênh
  subject         text,                          -- chỉ dùng cho email
  content         text NOT NULL,                 -- có {{placeholder}}
  zalo_template_id text,                          -- template ZNS đã duyệt với Zalo
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX notification_templates_kind_channel_idx
  ON notification_templates(kind, channel) WHERE active;
CREATE TRIGGER notification_templates_set_updated_at BEFORE UPDATE ON notification_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Mỗi thông báo gửi tới một bệnh nhân. KHÔNG lưu nội dung đã render (chứa PHI) —
-- chỉ lưu bệnh nhân, loại, kênh ĐÃ gửi thành công (sau fallback), trạng thái.
CREATE TABLE notifications (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id       uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  kind             notification_kind NOT NULL,
  status           notification_status NOT NULL DEFAULT 'pending',
  channel_sent     notification_channel,         -- kênh thực sự gửi được (sau fallback)
  provider_message_id text,                       -- id bên nhà cung cấp (Zalo msg_id, SMS id)
  scheduled_at     timestamptz NOT NULL DEFAULT now(),
  sent_at          timestamptz,
  read_at          timestamptz,
  attempts         integer NOT NULL DEFAULT 0,
  last_error       text,
  related_type     text,                          -- 'appointment' | 'treatment' | ...
  related_id       uuid,
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_patient_idx ON notifications(patient_id, created_at DESC);
CREATE INDEX notifications_due_idx ON notifications(scheduled_at) WHERE status = 'pending';

-- Nhật ký từng bước fallback (thử Zalo → SMS → Email). detail KHÔNG chứa PHI,
-- chỉ tên kênh + mã lỗi.
CREATE TABLE notification_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  channel         notification_channel NOT NULL,
  event           text NOT NULL,                 -- 'attempt' | 'sent' | 'failed' | 'read'
  detail          text,
  at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notification_logs_notification_idx ON notification_logs(notification_id, at);

-- Quyền quản lý template + gửi thông báo thủ công.
INSERT INTO permissions (code, description) VALUES
  ('notification:manage', 'Quản lý template và gửi thông báo đa kênh');
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name IN ('admin', 'receptionist') AND p.code = 'notification:manage';

-- Template mặc định (song ngữ placeholder). Nội dung tối thiểu PHI: tên + giờ +
-- phòng khám (thông báo TỚI chính bệnh nhân, không kèm chẩn đoán).
INSERT INTO notification_templates (code, name, kind, channel, subject, content, zalo_template_id) VALUES
  ('appt_reminder_zalo', 'Nhắc lịch (Zalo)', 'appointment_reminder', 'zalo', NULL,
   'Chào {{ten}}, bạn có lịch hẹn khám vào {{thoi_gian}}{{phong}}. Vui lòng đến trước 15 phút.', 'ZNS_TEMPLATE_PLACEHOLDER'),
  ('appt_reminder_sms', 'Nhắc lịch (SMS)', 'appointment_reminder', 'sms', NULL,
   '{{ten}} co lich hen kham luc {{thoi_gian}}{{phong}}. Vui long den truoc 15 phut.', NULL),
  ('appt_reminder_email', 'Nhắc lịch (Email)', 'appointment_reminder', 'email', 'Nhắc lịch hẹn khám',
   'Kính chào {{ten}},\n\nBạn có lịch hẹn khám vào {{thoi_gian}}{{phong}}.\nVui lòng đến trước giờ hẹn 15 phút.\n\nTrân trọng.', NULL);

-- Down Migration

DROP TABLE IF EXISTS notification_logs;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS notification_templates;
ALTER TABLE patients DROP COLUMN IF EXISTS zalo_id_enc;
DELETE FROM role_permissions WHERE permission_id = (SELECT id FROM permissions WHERE code = 'notification:manage');
DELETE FROM permissions WHERE code = 'notification:manage';
DROP TYPE IF EXISTS notification_kind;
DROP TYPE IF EXISTS notification_status;
DROP TYPE IF EXISTS notification_channel;
