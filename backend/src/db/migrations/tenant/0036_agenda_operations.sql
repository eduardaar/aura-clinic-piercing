CREATE TABLE IF NOT EXISTS appointment_waitlist (
  id BIGSERIAL PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
  professional_id INTEGER REFERENCES professionals(id) ON DELETE SET NULL,
  client_name TEXT NOT NULL,
  contact TEXT,
  preferred_date_from DATE,
  preferred_date_to DATE,
  preferred_period TEXT NOT NULL DEFAULT 'qualquer' CHECK (preferred_period IN ('manha', 'tarde', 'noite', 'qualquer')),
  priority INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 5),
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'contacted', 'scheduled', 'closed')),
  notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_appointment_waitlist_operational
  ON appointment_waitlist(status, priority DESC, preferred_date_from, created_at);

CREATE TABLE IF NOT EXISTS agenda_resources (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  resource_type TEXT NOT NULL DEFAULT 'station' CHECK (resource_type IN ('room', 'chair', 'station', 'equipment')),
  capacity INTEGER NOT NULL DEFAULT 1 CHECK (capacity BETWEEN 1 AND 100),
  active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agenda_resources_name
  ON agenda_resources(lower(name));
