-- Mesclagem reversivelmente rastreável: a origem permanece como linha terminal
-- anonimizada, enquanto todo o histórico operacional aponta para o destino.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS merged_into_client_id INTEGER REFERENCES clients(id) ON DELETE RESTRICT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS merged_at TIMESTAMPTZ;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS merged_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS merge_reason TEXT;

DO $$ BEGIN
  ALTER TABLE clients ADD CONSTRAINT clients_merge_not_self_check
    CHECK (merged_into_client_id IS NULL OR merged_into_client_id <> id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_clients_merged_into ON clients(merged_into_client_id) WHERE merged_into_client_id IS NOT NULL;
