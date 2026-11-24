-- Up Migration

CREATE TABLE medical_records (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id     uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  appointment_id uuid REFERENCES appointments(id) ON DELETE SET NULL,
  provider_id    uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  record_type    record_type NOT NULL DEFAULT 'consultation',
  title          text NOT NULL,
  content_enc    bytea NOT NULL,
  icd10_code     text,
  version        integer NOT NULL DEFAULT 1,
  is_signed      boolean NOT NULL DEFAULT false,
  signed_at      timestamptz,
  record_date    timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT medical_records_signed_consistency
    CHECK (is_signed = (signed_at IS NOT NULL))
);

CREATE INDEX medical_records_patient_date_idx ON medical_records(patient_id, record_date DESC);
CREATE INDEX medical_records_appointment_id_idx ON medical_records(appointment_id);
CREATE INDEX medical_records_provider_id_idx ON medical_records(provider_id);
CREATE TRIGGER medical_records_set_updated_at BEFORE UPDATE ON medical_records
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Lịch sử phiên bản: mỗi lần sửa, bản CŨ được đẩy vào đây.
CREATE TABLE medical_record_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id     uuid NOT NULL REFERENCES medical_records(id) ON DELETE CASCADE,
  version       integer NOT NULL,
  content_enc   bytea NOT NULL,
  title         text NOT NULL,
  icd10_code    text,
  changed_by    uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  change_reason text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (record_id, version)
);

CREATE INDEX medical_record_versions_record_id_idx ON medical_record_versions(record_id, version DESC);

CREATE TABLE prescriptions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id       uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  record_id        uuid REFERENCES medical_records(id) ON DELETE SET NULL,
  prescriber_id    uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  medication       text NOT NULL,
  rxnorm_code      text,
  dosage           text NOT NULL,
  frequency        text NOT NULL,
  duration_days    integer,
  quantity         text,
  instructions_enc bytea,
  status           prescription_status NOT NULL DEFAULT 'active',
  prescribed_at    timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz,
  cancelled_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX prescriptions_patient_id_idx ON prescriptions(patient_id, prescribed_at DESC);
CREATE INDEX prescriptions_active_idx ON prescriptions(patient_id) WHERE status = 'active';
CREATE TRIGGER prescriptions_set_updated_at BEFORE UPDATE ON prescriptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE lab_results (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id        uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  record_id         uuid REFERENCES medical_records(id) ON DELETE SET NULL,
  ordered_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  test_name         text NOT NULL,
  loinc_code        text,
  result_value_enc  bytea NOT NULL,
  unit              text,
  reference_range   text,
  abnormal_flag     text,          -- 'normal' | 'low' | 'high' | 'critical'
  test_date         timestamptz NOT NULL,
  received_at       timestamptz NOT NULL DEFAULT now(),
  reviewed_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at       timestamptz
);

CREATE INDEX lab_results_patient_id_idx ON lab_results(patient_id, test_date DESC);
CREATE INDEX lab_results_unreviewed_idx ON lab_results(received_at) WHERE reviewed_at IS NULL;

CREATE TABLE documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id   uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  record_id    uuid REFERENCES medical_records(id) ON DELETE SET NULL,
  file_name    text NOT NULL,
  mime_type    text NOT NULL,
  size_bytes   bigint NOT NULL,
  storage_key  text NOT NULL UNIQUE,   -- S3 key hoặc đường dẫn local
  file_dek_enc bytea NOT NULL,         -- DEK riêng cho file, đã wrap
  sha256       text NOT NULL,
  uploaded_by  uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  CONSTRAINT documents_size_positive CHECK (size_bytes > 0)
);

CREATE INDEX documents_patient_id_idx ON documents(patient_id) WHERE deleted_at IS NULL;
CREATE INDEX documents_record_id_idx ON documents(record_id) WHERE deleted_at IS NULL;

-- Down Migration

DROP TABLE IF EXISTS documents, lab_results, prescriptions, medical_record_versions, medical_records;
