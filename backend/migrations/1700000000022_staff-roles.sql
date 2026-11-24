-- Up Migration

-- Thêm hai vai trò nhân viên: Sale (kinh doanh) và CSKH (chăm sóc khách hàng).
-- Cả hai phục vụ Module 8/9/10 (thông báo, marketing, khảo sát). Cấp quyền theo
-- nguyên tắc tối thiểu-cần-thiết:
--   - sales: chỉ chiến dịch marketing + khảo sát (đọc) + báo cáo. KHÔNG có
--     patient:read → không xem PHI từng bệnh nhân (làm việc trên nhóm/tổng hợp).
--   - customer_care: có tiếp xúc bệnh nhân trực tiếp nên thêm patient:read,
--     appointment:read, quản lý khảo sát + thông báo.

INSERT INTO roles (name, description) VALUES
  ('sales', 'Nhân viên kinh doanh — chiến dịch marketing, báo cáo'),
  ('customer_care', 'Chăm sóc khách hàng (CSKH) — marketing, khảo sát, thông báo, chăm sóc bệnh nhân');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'sales' AND p.code IN (
  'marketing:read', 'marketing:manage', 'survey:read', 'report:read'
);

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'customer_care' AND p.code IN (
  'patient:read', 'appointment:read', 'report:read',
  'marketing:read', 'marketing:manage', 'survey:read', 'survey:manage', 'notification:manage'
);

-- Down Migration

DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE name IN ('sales', 'customer_care'));
DELETE FROM roles WHERE name IN ('sales', 'customer_care');
