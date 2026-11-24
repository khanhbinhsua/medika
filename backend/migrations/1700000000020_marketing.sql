-- Up Migration

-- Module 9: Marketing & Chăm Sóc Khách Hàng (CSKH).
-- Phân nhóm khách hàng (segment động theo tiêu chí SQL trên trường KHÔNG phải
-- PHI), chiến dịch chăm sóc/khuyến mãi gửi đa kênh (tái dùng Module 8), chăm
-- sóc hậu điều trị tự động (nối Module 7), chúc mừng sinh nhật, báo cáo hiệu quả.
--
-- TUÂN THỦ: tin nhắn MARKETING chỉ gửi cho bệnh nhân đã đồng ý nhận marketing
-- (patient_consents type='marketing', chưa thu hồi) — ép ở tầng service khi chốt
-- danh sách nhận. Nội dung chiến dịch là văn bản quảng bá chung, KHÔNG chứa PHI;
-- cá nhân hoá chỉ qua placeholder {{ten}} (ghép lúc gửi, không lưu).

CREATE TYPE campaign_status AS ENUM ('draft', 'scheduled', 'sending', 'sent', 'cancelled');
CREATE TYPE campaign_recipient_status AS ENUM ('pending', 'sent', 'failed', 'skipped', 'read');
CREATE TYPE care_status AS ENUM ('pending', 'sent', 'cancelled');

-- Nhóm khách hàng động: tiêu chí lưu dạng jsonb, thành viên tính lại lúc truy vấn.
CREATE TABLE customer_segments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  description text,
  criteria    jsonb NOT NULL DEFAULT '{}'::jsonb,
  active      boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER customer_segments_set_updated_at BEFORE UPDATE ON customer_segments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE campaigns (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  segment_id   uuid REFERENCES customer_segments(id) ON DELETE SET NULL,
  kind         notification_kind NOT NULL DEFAULT 'marketing',
  message      text NOT NULL,          -- văn bản quảng bá, KHÔNG PHI, có thể chứa {{ten}}
  status       campaign_status NOT NULL DEFAULT 'draft',
  scheduled_at timestamptz,
  sent_at      timestamptz,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX campaigns_status_idx ON campaigns(status);
CREATE TRIGGER campaigns_set_updated_at BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Ảnh chụp danh sách nhận tại thời điểm gửi (đã lọc theo consent marketing).
CREATE TABLE campaign_recipients (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  patient_id      uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  notification_id uuid REFERENCES notifications(id) ON DELETE SET NULL,
  status          campaign_recipient_status NOT NULL DEFAULT 'pending',
  sent_at         timestamptz,
  opened_at       timestamptz,
  error           text,
  UNIQUE (campaign_id, patient_id)
);
CREATE INDEX campaign_recipients_campaign_idx ON campaign_recipients(campaign_id);

-- Chăm sóc hậu điều trị: tạo tự động khi hoàn thành phác đồ (Module 7) hoặc thủ công.
CREATE TABLE post_treatment_care (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id        uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  treatment_plan_id uuid REFERENCES treatment_plans(id) ON DELETE SET NULL,
  care_type         text NOT NULL,     -- 'follow_up' | 'home_care' | ...
  message           text NOT NULL,     -- hướng dẫn chung, KHÔNG PHI
  status            care_status NOT NULL DEFAULT 'pending',
  scheduled_at      timestamptz NOT NULL DEFAULT now(),
  sent_at           timestamptz,
  notification_id   uuid REFERENCES notifications(id) ON DELETE SET NULL,
  created_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX post_treatment_care_due_idx ON post_treatment_care(scheduled_at) WHERE status = 'pending';
CREATE INDEX post_treatment_care_patient_idx ON post_treatment_care(patient_id);

-- ── Quyền ────────────────────────────────────────────────────────────────
INSERT INTO permissions (code, description) VALUES
  ('marketing:read',   'Xem nhóm khách hàng, chiến dịch, báo cáo CSKH'),
  ('marketing:manage', 'Tạo/gửi chiến dịch, quản lý chăm sóc khách hàng');
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'admin' AND p.code IN ('marketing:read', 'marketing:manage');
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'receptionist' AND p.code IN ('marketing:read', 'marketing:manage');

-- ── Template thông báo cho marketing + chăm sóc hậu điều trị ─────────────
-- Nội dung thật do chiến dịch/chăm sóc cung cấp qua {{noi_dung}}; template chỉ
-- là khung có lời chào cá nhân hoá {{ten}}.
INSERT INTO notification_templates (code, name, kind, channel, subject, content) VALUES
  ('marketing_zalo', 'Marketing (Zalo)', 'marketing', 'zalo', NULL, 'Chào {{ten}}, {{noi_dung}}'),
  ('marketing_sms', 'Marketing (SMS)', 'marketing', 'sms', NULL, '{{ten}} oi, {{noi_dung}}'),
  ('marketing_email', 'Marketing (Email)', 'marketing', 'email', 'Thông tin từ phòng khám', 'Kính chào {{ten}},\n\n{{noi_dung}}\n\nTrân trọng.'),
  ('care_zalo', 'Chăm sóc hậu điều trị (Zalo)', 'treatment_next', 'zalo', NULL, 'Chào {{ten}}, {{noi_dung}}'),
  ('care_sms', 'Chăm sóc hậu điều trị (SMS)', 'treatment_next', 'sms', NULL, '{{ten}} oi, {{noi_dung}}'),
  ('care_email', 'Chăm sóc hậu điều trị (Email)', 'treatment_next', 'email', 'Chăm sóc sau điều trị', 'Kính chào {{ten}},\n\n{{noi_dung}}\n\nChúc bạn mau khoẻ.');

-- Down Migration

DROP TABLE IF EXISTS post_treatment_care;
DROP TABLE IF EXISTS campaign_recipients;
DROP TABLE IF EXISTS campaigns;
DROP TABLE IF EXISTS customer_segments;
DELETE FROM notification_templates WHERE code IN
  ('marketing_zalo','marketing_sms','marketing_email','care_zalo','care_sms','care_email');
DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE code IN ('marketing:read', 'marketing:manage'));
DELETE FROM permissions WHERE code IN ('marketing:read', 'marketing:manage');
DROP TYPE IF EXISTS care_status;
DROP TYPE IF EXISTS campaign_recipient_status;
DROP TYPE IF EXISTS campaign_status;
