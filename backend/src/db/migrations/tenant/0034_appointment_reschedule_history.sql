CREATE TABLE appointment_reschedule_history (
  id BIGSERIAL PRIMARY KEY,
  appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE RESTRICT,
  previous_date DATE NOT NULL,
  previous_time TEXT NOT NULL,
  new_date DATE NOT NULL,
  new_time TEXT NOT NULL,
  reason TEXT NOT NULL,
  changed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_appointment_reschedule_history_appointment
  ON appointment_reschedule_history(appointment_id, changed_at DESC, id DESC);
