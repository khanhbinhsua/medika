-- Up Migration

-- Tiêu huỷ vĩnh viễn (crypto-shredding): huỷ DEK của bệnh nhân khiến MỌI
-- ciphertext dùng khoá đó — hồ sơ nhân khẩu học, lý do khám mọi lịch hẹn, nội
-- dung mọi hồ sơ bệnh án, hướng dẫn mọi đơn thuốc — vĩnh viễn không giải mã
-- được, kể cả trong bản backup cũ. Đáp ứng "secure deletion" §164.310(d)(2)(i).
--
-- Đây LÀ HÀNH ĐỘNG KHÔNG THỂ HOÀN TÁC nên bắt buộc hai bước: phải soft-delete
-- (deleted_at) trước, rồi mới purge được — CHECK constraint chặn thao tác một
-- bước. purged_reason bắt buộc ghi lý do, purged_by ghi rõ ai ra quyết định.
ALTER TABLE patients ADD COLUMN purged_at     timestamptz;
ALTER TABLE patients ADD COLUMN purged_by     uuid REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE patients ADD COLUMN purged_reason text;

ALTER TABLE patients ADD CONSTRAINT patients_purge_requires_prior_delete
  CHECK (purged_at IS NULL OR deleted_at IS NOT NULL);
ALTER TABLE patients ADD CONSTRAINT patients_purge_consistency
  CHECK ((purged_at IS NOT NULL) = (purged_by IS NOT NULL) AND (purged_at IS NOT NULL) = (purged_reason IS NOT NULL));

COMMENT ON COLUMN patients.purged_at IS
  'Thời điểm DEK bị huỷ (crypto-shredded) — NULL nghĩa là dữ liệu vẫn giải mã được';

-- Quyền riêng, tách khỏi patient:delete (soft-delete). Chỉ admin được cấp —
-- một nhân viên xoá nhầm (soft-delete) không đồng nghĩa được phép tiêu huỷ
-- vĩnh viễn.
INSERT INTO permissions (code, description) VALUES
  ('patient:purge', 'Tiêu huỷ vĩnh viễn (crypto-shredding) hồ sơ bệnh nhân');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'admin' AND p.code = 'patient:purge';

-- Down Migration

DELETE FROM role_permissions WHERE permission_id = (SELECT id FROM permissions WHERE code = 'patient:purge');
DELETE FROM permissions WHERE code = 'patient:purge';

ALTER TABLE patients DROP CONSTRAINT patients_purge_consistency;
ALTER TABLE patients DROP CONSTRAINT patients_purge_requires_prior_delete;
ALTER TABLE patients DROP COLUMN purged_reason;
ALTER TABLE patients DROP COLUMN purged_by;
ALTER TABLE patients DROP COLUMN purged_at;
