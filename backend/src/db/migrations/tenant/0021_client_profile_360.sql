-- Cadastro brasileiro e base do perfil 360 de clientes.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS social_name TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS preferred_contact TEXT NOT NULL DEFAULT 'whatsapp';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS postal_code TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS address_line TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS address_number TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS address_complement TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS neighborhood TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS state TEXT;

CREATE INDEX IF NOT EXISTS idx_clients_active_social_name
  ON clients(social_name) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_clients_active_cpf
  ON clients(cpf) WHERE deleted_at IS NULL AND cpf IS NOT NULL AND cpf <> '';
CREATE INDEX IF NOT EXISTS idx_clients_active_whatsapp
  ON clients(whatsapp) WHERE deleted_at IS NULL;
