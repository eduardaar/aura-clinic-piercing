CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS clients (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  whatsapp TEXT,
  instagram TEXT,
  email TEXT,
  birth_date DATE,
  cpf TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE clients ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS whatsapp TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS instagram TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS birth_date DATE;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS cpf TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE clients ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'clients' AND column_name = 'full_name'
  ) THEN
    EXECUTE 'UPDATE clients SET name = COALESCE(name, full_name) WHERE name IS NULL';
    EXECUTE 'ALTER TABLE clients DROP COLUMN full_name';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS services (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 40,
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS procedures (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  region TEXT,
  service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
  base_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  subcategory TEXT,
  material TEXT,
  color TEXT,
  size TEXT,
  thickness TEXT,
  length TEXT,
  diameter TEXT,
  thread_type TEXT,
  sku TEXT UNIQUE,
  image_url TEXT,
  photo_url TEXT,
  sale_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  cost_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  quantity INTEGER NOT NULL DEFAULT 0,
  min_stock INTEGER NOT NULL DEFAULT 1,
  supplier TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'disponível',
  is_catalog_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_published BOOLEAN NOT NULL DEFAULT TRUE,
  is_featured BOOLEAN NOT NULL DEFAULT FALSE,
  is_new BOOLEAN NOT NULL DEFAULT FALSE,
  is_most_wanted BOOLEAN NOT NULL DEFAULT FALSE,
  is_promotion BOOLEAN NOT NULL DEFAULT FALSE,
  is_last_units BOOLEAN NOT NULL DEFAULT FALSE,
  variants JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS appointments (
  id SERIAL PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
  procedure_id INTEGER REFERENCES procedures(id) ON DELETE SET NULL,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  professional_id INTEGER,
  client_name TEXT,
  whatsapp TEXT,
  procedure TEXT,
  description TEXT,
  piercing_region TEXT,
  appointment_date DATE NOT NULL,
  appointment_time TIME NOT NULL,
  end_time TIME,
  total_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  deposit_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  remaining_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  deposit_payment_method TEXT,
  remaining_payment_method TEXT,
  status TEXT NOT NULL DEFAULT 'pendente',
  notes TEXT,
  reference_photo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS financial_transactions (
  id SERIAL PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('receita', 'despesa')),
  category TEXT,
  description TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_method TEXT,
  status TEXT NOT NULL DEFAULT 'pago',
  transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  message TEXT,
  type TEXT NOT NULL DEFAULT 'info',
  priority TEXT NOT NULL DEFAULT 'normal',
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  related_type TEXT,
  related_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
CREATE INDEX IF NOT EXISTS idx_products_catalog ON products(is_catalog_active, is_published);
CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(appointment_date, appointment_time);
CREATE INDEX IF NOT EXISTS idx_financial_date ON financial_transactions(transaction_date);

INSERT INTO users (name, email, role)
VALUES ('Administrador Aura', 'admin@auraclinic.com', 'admin')
ON CONFLICT (email) DO NOTHING;
