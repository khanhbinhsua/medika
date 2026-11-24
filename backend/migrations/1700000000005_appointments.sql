-- Up Migration

CREATE TABLE appointments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id      uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  doctor_id       uuid NOT NULL REFERENCES users(id)    ON DELETE RESTRICT,
  scheduled_start timestamptz NOT NULL,
  scheduled_end   timestamptz NOT NULL,
  room            text,
  status          appointment_status NOT NULL DEFAULT 'scheduled',
  reason          text,
  checked_in_at   timestamptz,
  completed_at    timestamptz,
  cancelled_at    timestamptz,
  cancel_reason   text,
  created_by      uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT appointments_time_order CHECK (scheduled_end > scheduled_start)
);

CREATE INDEX appointments_patient_id_idx ON appointments(patient_id);
CREATE INDEX appointments_doctor_time_idx ON appointments(doctor_id, scheduled_start);
CREATE INDEX appointments_status_idx ON appointments(status)
  WHERE status IN ('scheduled', 'confirmed', 'checked_in');
CREATE TRIGGER appointments_set_updated_at BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Chặn double-booking: một bác sĩ không thể có 2 lịch hẹn chồng giờ.
-- Lịch đã huỷ / no_show không tính.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE appointments ADD CONSTRAINT appointments_no_doctor_overlap
  EXCLUDE USING gist (
    doctor_id WITH =,
    tstzrange(scheduled_start, scheduled_end) WITH &&
  ) WHERE (status NOT IN ('cancelled', 'no_show'));

CREATE TABLE appointment_notes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  note_enc       bytea NOT NULL,
  author_id      uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX appointment_notes_appointment_id_idx ON appointment_notes(appointment_id);

CREATE TABLE appointment_reminders (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  channel        reminder_channel NOT NULL DEFAULT 'email',
  scheduled_for  timestamptz NOT NULL,
  sent_at        timestamptz,
  status         reminder_status NOT NULL DEFAULT 'pending',
  failure_reason text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX appointment_reminders_due_idx ON appointment_reminders(scheduled_for)
  WHERE status = 'pending';

CREATE TABLE waitlist (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id       uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  doctor_id        uuid REFERENCES users(id) ON DELETE SET NULL,
  preferred_window text,
  priority         integer NOT NULL DEFAULT 0,
  status           text NOT NULL DEFAULT 'waiting',  -- 'waiting' | 'offered' | 'booked' | 'expired'
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX waitlist_queue_idx ON waitlist(doctor_id, priority DESC, created_at)
  WHERE status = 'waiting';
CREATE TRIGGER waitlist_set_updated_at BEFORE UPDATE ON waitlist
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration

DROP TABLE IF EXISTS waitlist, appointment_reminders, appointment_notes, appointments;
