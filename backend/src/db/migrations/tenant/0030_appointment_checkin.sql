ALTER TABLE appointments ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMPTZ;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS no_show_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_appointments_operational_status
  ON appointments(appointment_date, status, appointment_time);
