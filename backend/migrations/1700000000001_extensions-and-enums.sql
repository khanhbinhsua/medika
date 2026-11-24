-- Up Migration

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

CREATE TYPE user_status       AS ENUM ('active', 'suspended', 'disabled');
CREATE TYPE patient_status    AS ENUM ('active', 'inactive', 'deceased', 'merged');
CREATE TYPE appointment_status AS ENUM ('scheduled', 'confirmed', 'checked_in', 'in_progress', 'completed', 'cancelled', 'no_show');
CREATE TYPE record_type       AS ENUM ('consultation', 'diagnosis', 'progress_note', 'discharge_summary', 'referral', 'other');
CREATE TYPE prescription_status AS ENUM ('active', 'completed', 'cancelled', 'expired');
CREATE TYPE severity_level    AS ENUM ('mild', 'moderate', 'severe', 'life_threatening');
CREATE TYPE consent_type      AS ENUM ('treatment', 'privacy_notice', 'data_sharing', 'research', 'marketing');
CREATE TYPE audit_outcome     AS ENUM ('success', 'failure', 'denied');
CREATE TYPE key_status        AS ENUM ('active', 'rotating', 'retired', 'destroyed');
CREATE TYPE reminder_channel  AS ENUM ('email', 'sms');
CREATE TYPE reminder_status   AS ENUM ('pending', 'sent', 'failed', 'cancelled');

-- Hàm cập nhật updated_at tự động
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Down Migration

DROP FUNCTION IF EXISTS set_updated_at();
DROP TYPE IF EXISTS reminder_status, reminder_channel, key_status, audit_outcome,
  consent_type, severity_level, prescription_status, record_type,
  appointment_status, patient_status, user_status;
