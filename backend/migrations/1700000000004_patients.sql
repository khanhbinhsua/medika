-- Up Migration

CREATE TABLE patients (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mrn               text NOT NULL UNIQUE,          -- Medical Record Number nội bộ
  first_name_enc    bytea NOT NULL,
  last_name_enc     bytea NOT NULL,
  name_search_hash  text NOT NULL,                 -- HMAC(lower(unaccent(first || ' ' || last)))
  dob_enc           bytea NOT NULL,
  gender            text,
  email_enc         bytea,
  email_search_hash text,
  phone_enc         bytea,
  phone_search_hash text,
  insurance_id_enc  bytea,
  address_enc       bytea,
  dek_id            uuid NOT NULL REFERENCES encryption_keys(id) ON DELETE RESTRICT,
  status            patient_status NOT NULL DEFAULT 'active',
  created_by        uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);

CREATE INDEX patients_name_search_hash_idx  ON patients(name_search_hash)  WHERE deleted_at IS NULL;
CREATE INDEX patients_email_search_hash_idx ON patients(email_search_hash) WHERE deleted_at IS NULL;
CREATE INDEX patients_phone_search_hash_idx ON patients(phone_search_hash) WHERE deleted_at IS NULL;
CREATE INDEX patients_status_idx            ON patients(status)            WHERE deleted_at IS NULL;
CREATE INDEX patients_created_at_idx        ON patients(created_at DESC);
CREATE TRIGGER patients_set_updated_at BEFORE UPDATE ON patients
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE patient_contacts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id       uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  contact_type     text NOT NULL,        -- 'emergency' | 'guardian' | 'next_of_kin'
  name_enc         bytea NOT NULL,
  value_enc        bytea NOT NULL,
  relationship_enc bytea,
  is_primary       boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX patient_contacts_patient_id_idx ON patient_contacts(patient_id);
CREATE UNIQUE INDEX patient_contacts_one_primary_idx
  ON patient_contacts(patient_id) WHERE is_primary;

CREATE TABLE patient_allergies (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id   uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  allergy_name text NOT NULL,
  reaction     text,
  severity     severity_level NOT NULL DEFAULT 'moderate',
  notes_enc    bytea,
  recorded_by  uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recorded_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX patient_allergies_patient_id_idx ON patient_allergies(patient_id);

CREATE TABLE patient_medical_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id  uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  condition   text NOT NULL,
  icd10_code  text,
  status      text NOT NULL DEFAULT 'active',   -- 'active' | 'resolved' | 'chronic'
  notes_enc   bytea,
  onset_date  date,
  recorded_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX patient_medical_history_patient_id_idx ON patient_medical_history(patient_id);
CREATE TRIGGER patient_medical_history_set_updated_at BEFORE UPDATE ON patient_medical_history
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE patient_consents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id       uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  consent_type     consent_type NOT NULL,
  granted          boolean NOT NULL,
  document_version text NOT NULL,
  granted_at       timestamptz NOT NULL DEFAULT now(),
  revoked_at       timestamptz,
  witnessed_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  notes            text
);

CREATE INDEX patient_consents_patient_id_idx ON patient_consents(patient_id);
CREATE UNIQUE INDEX patient_consents_active_idx
  ON patient_consents(patient_id, consent_type) WHERE revoked_at IS NULL;

-- Down Migration

DROP TABLE IF EXISTS patient_consents, patient_medical_history, patient_allergies, patient_contacts, patients;
