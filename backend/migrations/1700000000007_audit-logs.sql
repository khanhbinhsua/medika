-- Up Migration
-- Audit log bất biến (append-only) + hash chain để phát hiện giả mạo.
-- HIPAA §164.312(b) Audit controls, §164.312(c)(1) Integrity.

-- PostgreSQL yêu cầu mọi PRIMARY KEY / UNIQUE trên bảng partition phải chứa
-- cột partition key, nên khoá là (id, created_at) thay vì chỉ (id).
CREATE TABLE audit_logs (
  id          bigserial,
  request_id  uuid,
  actor_id    uuid REFERENCES users(id) ON DELETE RESTRICT,
  actor_email text,                    -- snapshot, phòng khi user bị đổi tên
  action      text NOT NULL,           -- 'LOGIN_SUCCESS' | 'PATIENT_CREATE' | ...
  entity_type text,
  entity_id   uuid,
  changes     jsonb,                   -- { field: { old, new } } — KHÔNG chứa PHI plaintext
  ip_address  inet,
  user_agent  text,
  outcome     audit_outcome NOT NULL DEFAULT 'success',
  reason      text,
  prev_hash   text NOT NULL,
  entry_hash  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at),
  UNIQUE (entry_hash, created_at)
) PARTITION BY RANGE (created_at);

CREATE INDEX audit_logs_actor_idx      ON audit_logs(actor_id, created_at DESC);
CREATE INDEX audit_logs_entity_idx     ON audit_logs(entity_type, entity_id, created_at DESC);
CREATE INDEX audit_logs_action_idx     ON audit_logs(action, created_at DESC);
CREATE INDEX audit_logs_request_id_idx ON audit_logs(request_id);

-- Partition ban đầu; job hàng tháng tạo partition mới (npm run audit:partition — src/jobs/create-audit-partition.ts)
CREATE TABLE audit_logs_default PARTITION OF audit_logs DEFAULT;

-- Ghi nhận riêng mọi lần chạm vào PHI, phục vụ "accounting of disclosures" (§164.528)
CREATE TABLE phi_access_logs (
  id             bigserial,
  request_id     uuid,
  patient_id     uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  accessed_by    uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  access_type    text NOT NULL,        -- 'view' | 'create' | 'modify' | 'export' | 'print'
  fields_accessed text[] NOT NULL DEFAULT '{}',
  purpose        text,                 -- 'treatment' | 'payment' | 'operations'
  ip_address     inet,
  accessed_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, accessed_at)
) PARTITION BY RANGE (accessed_at);

CREATE INDEX phi_access_logs_patient_idx ON phi_access_logs(patient_id, accessed_at DESC);
CREATE INDEX phi_access_logs_actor_idx   ON phi_access_logs(accessed_by, accessed_at DESC);

CREATE TABLE phi_access_logs_default PARTITION OF phi_access_logs DEFAULT;

-- ── Chặn UPDATE / DELETE ở tầng database ──────────────────────────────
-- Ngay cả tài khoản ứng dụng cũng không sửa được audit log.
CREATE OR REPLACE FUNCTION reject_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Audit log là append-only: không cho phép % trên bảng %',
    TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();
CREATE TRIGGER audit_logs_default_no_update BEFORE UPDATE OR DELETE ON audit_logs_default
  FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();
CREATE TRIGGER phi_access_logs_no_update BEFORE UPDATE OR DELETE ON phi_access_logs
  FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();
CREATE TRIGGER phi_access_logs_default_no_update BEFORE UPDATE OR DELETE ON phi_access_logs_default
  FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();

-- Down Migration

DROP FUNCTION IF EXISTS reject_audit_mutation() CASCADE;
DROP TABLE IF EXISTS phi_access_logs, audit_logs;
