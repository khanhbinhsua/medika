-- Up Migration

-- Module 10: Khảo sát hài lòng (Satisfaction Survey — NPS / CSAT / tùy chỉnh).
-- Tạo khảo sát, gửi link đa kênh (tái dùng Module 8) sau khám/điều trị, thu thập
-- phản hồi qua link công khai (token), phân tích điểm, cảnh báo phản hồi tiêu cực.
--
-- PHI: điểm số (score) là con số tổng hợp → lưu plaintext để báo cáo. Câu trả lời
-- chi tiết + góp ý tự do có thể chứa thông tin nhạy cảm → mã hoá bằng DEK của
-- bệnh nhân. Bảng invitations chỉ giữ token đã băm (HMAC), không giữ link thô.

CREATE TYPE survey_type AS ENUM ('nps', 'csat', 'custom');
CREATE TYPE survey_status AS ENUM ('draft', 'active', 'closed');
CREATE TYPE survey_invitation_status AS ENUM ('pending', 'sent', 'responded', 'failed');

CREATE TABLE surveys (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  type       survey_type NOT NULL,
  -- Cấu trúc câu hỏi (không PHI): [{id,text,type,options?}]. Câu hỏi chính là
  -- thang điểm (NPS 0-10 / CSAT 1-5); có thể kèm câu góp ý tự do.
  questions  jsonb NOT NULL DEFAULT '[]'::jsonb,
  status     survey_status NOT NULL DEFAULT 'draft',
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER surveys_set_updated_at BEFORE UPDATE ON surveys
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Lời mời khảo sát gửi tới một bệnh nhân. token_hash = HMAC của token trong link.
CREATE TABLE survey_invitations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id       uuid NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  patient_id      uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  appointment_id  uuid REFERENCES appointments(id) ON DELETE SET NULL,
  doctor_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  token_hash      text NOT NULL UNIQUE,
  status          survey_invitation_status NOT NULL DEFAULT 'pending',
  notification_id uuid REFERENCES notifications(id) ON DELETE SET NULL,
  sent_at         timestamptz,
  responded_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- Một lịch hẹn chỉ mời khảo sát một lần cho mỗi khảo sát (chống gửi trùng auto).
  UNIQUE (survey_id, appointment_id)
);
CREATE INDEX survey_invitations_survey_idx ON survey_invitations(survey_id);
CREATE INDEX survey_invitations_patient_idx ON survey_invitations(patient_id);

CREATE TABLE survey_responses (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id      uuid NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  invitation_id  uuid UNIQUE REFERENCES survey_invitations(id) ON DELETE SET NULL,
  patient_id     uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  appointment_id uuid REFERENCES appointments(id) ON DELETE SET NULL,
  doctor_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  score          integer,               -- điểm chính (NPS 0-10 / CSAT 1-5), plaintext
  answers_enc    bytea,                 -- câu trả lời chi tiết (PHI) — mã hoá
  comment_enc    bytea,                 -- góp ý tự do (PHI) — mã hoá
  is_negative    boolean NOT NULL DEFAULT false, -- cờ cảnh báo phản hồi tiêu cực
  submitted_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX survey_responses_survey_idx ON survey_responses(survey_id, submitted_at);
CREATE INDEX survey_responses_doctor_idx ON survey_responses(doctor_id);
CREATE INDEX survey_responses_negative_idx ON survey_responses(survey_id) WHERE is_negative;

-- ── Quyền ────────────────────────────────────────────────────────────────
INSERT INTO permissions (code, description) VALUES
  ('survey:read',   'Xem khảo sát, phản hồi, báo cáo hài lòng'),
  ('survey:manage', 'Tạo khảo sát và gửi lời mời khảo sát');
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'admin' AND p.code IN ('survey:read', 'survey:manage');
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'receptionist' AND p.code IN ('survey:read', 'survey:manage');
-- Bác sĩ xem điểm hài lòng của mình (chỉ đọc).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'doctor' AND p.code IN ('survey:read');

-- ── Template thông báo cho khảo sát (link đặt trong {{noi_dung}}) ─────────
INSERT INTO notification_templates (code, name, kind, channel, subject, content) VALUES
  ('survey_zalo', 'Khảo sát (Zalo)', 'survey', 'zalo', NULL, 'Chào {{ten}}, {{noi_dung}}'),
  ('survey_sms', 'Khảo sát (SMS)', 'survey', 'sms', NULL, '{{ten}} oi, {{noi_dung}}'),
  ('survey_email', 'Khảo sát (Email)', 'survey', 'email', 'Mời bạn đánh giá dịch vụ', 'Kính chào {{ten}},\n\n{{noi_dung}}\n\nCảm ơn bạn đã dành thời gian.');

-- Down Migration

DROP TABLE IF EXISTS survey_responses;
DROP TABLE IF EXISTS survey_invitations;
DROP TABLE IF EXISTS surveys;
DELETE FROM notification_templates WHERE code IN ('survey_zalo', 'survey_sms', 'survey_email');
DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE code IN ('survey:read', 'survey:manage'));
DELETE FROM permissions WHERE code IN ('survey:read', 'survey:manage');
DROP TYPE IF EXISTS survey_invitation_status;
DROP TYPE IF EXISTS survey_status;
DROP TYPE IF EXISTS survey_type;
