-- Relacionamento e controles opcionais do perfil do cliente.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS acquisition_source TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS referred_by_client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS lifecycle_status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS blocked_reason TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS operational_consent BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS marketing_consent BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS emergency_contact_name TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS guardian_client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS guardian_relationship TEXT;

DO $$ BEGIN
  ALTER TABLE clients ADD CONSTRAINT clients_lifecycle_status_check
    CHECK (lifecycle_status IN ('active', 'inactive', 'blocked'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_clients_lifecycle_status ON clients(lifecycle_status, full_name);
CREATE INDEX IF NOT EXISTS idx_clients_tags ON clients USING GIN(tags);
