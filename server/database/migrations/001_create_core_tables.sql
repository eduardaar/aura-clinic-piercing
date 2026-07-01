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
  base_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE services ADD COLUMN IF NOT EXISTS base_price NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE services ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE services ADD COLUMN IF NOT EXISTS duration_minutes INTEGER NOT NULL DEFAULT 40;
ALTER TABLE services ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE services ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE services ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'services' AND column_name = 'price'
  ) THEN
    EXECUTE 'UPDATE services SET base_price = COALESCE(base_price, price)';
    EXECUTE 'ALTER TABLE services DROP COLUMN price';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'services' AND column_name = 'active'
  ) THEN
    EXECUTE 'UPDATE services SET is_active = COALESCE(is_active, active)';
    EXECUTE 'ALTER TABLE services DROP COLUMN active';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS procedures (
  id SERIAL PRIMARY KEY,
  service_id INTEGER REFERENCES services(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  body_area TEXT,
  description TEXT,
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  duration_minutes INTEGER NOT NULL DEFAULT 40,
  aftercare_instructions TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE procedures ADD COLUMN IF NOT EXISTS service_id INTEGER REFERENCES services(id) ON DELETE CASCADE;
ALTER TABLE procedures ADD COLUMN IF NOT EXISTS body_area TEXT;
ALTER TABLE procedures ADD COLUMN IF NOT EXISTS price NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE procedures ADD COLUMN IF NOT EXISTS duration_minutes INTEGER NOT NULL DEFAULT 40;
ALTER TABLE procedures ADD COLUMN IF NOT EXISTS aftercare_instructions TEXT;
ALTER TABLE procedures ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE procedures ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE procedures ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'procedures' AND column_name = 'region'
  ) THEN
    EXECUTE 'UPDATE procedures SET body_area = COALESCE(body_area, region)';
    EXECUTE 'ALTER TABLE procedures DROP COLUMN region';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'procedures' AND column_name = 'base_price'
  ) THEN
    EXECUTE 'UPDATE procedures SET price = COALESCE(price, base_price)';
    EXECUTE 'ALTER TABLE procedures DROP COLUMN base_price';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'procedures' AND column_name = 'active'
  ) THEN
    EXECUTE 'UPDATE procedures SET is_active = COALESCE(is_active, active)';
    EXECUTE 'ALTER TABLE procedures DROP COLUMN active';
  END IF;
END $$;

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

CREATE TABLE IF NOT EXISTS professionals (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  specialty TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS professional_availability (
  id SERIAL PRIMARY KEY,
  professional_id INTEGER REFERENCES professionals(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  start_time TEXT NOT NULL DEFAULT '08:30',
  end_time TEXT NOT NULL DEFAULT '18:00',
  lunch_start TEXT,
  lunch_end TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 40,
  buffer_minutes INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS schedule_blocks (
  id SERIAL PRIMARY KEY,
  professional_id INTEGER REFERENCES professionals(id) ON DELETE SET NULL,
  reason TEXT,
  start_datetime TIMESTAMPTZ NOT NULL,
  end_datetime TIMESTAMPTZ NOT NULL,
  is_full_day BOOLEAN NOT NULL DEFAULT FALSE,
  is_recurring BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory_options (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(type, name)
);

CREATE TABLE IF NOT EXISTS sales_orders (
  id SERIAL PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  full_name TEXT,
  whatsapp TEXT,
  instagram TEXT,
  order_type TEXT NOT NULL DEFAULT 'produto',
  source TEXT NOT NULL DEFAULT 'interno',
  payment_method TEXT,
  status TEXT NOT NULL DEFAULT 'concluida',
  total_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales_order_items (
  id SERIAL PRIMARY KEY,
  sales_order_id INTEGER REFERENCES sales_orders(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL DEFAULT 'produto',
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
  item_name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS post_care (
  id SERIAL PRIMARY KEY,
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  full_name TEXT,
  whatsapp TEXT,
  procedure TEXT,
  piercing_region TEXT,
  appointment_date DATE,
  reminder_day INTEGER NOT NULL DEFAULT 7,
  due_date DATE,
  care_message TEXT,
  healing_status TEXT NOT NULL DEFAULT 'pendente',
  client_photo_url TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pendente',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS digital_terms (
  id SERIAL PRIMARY KEY,
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  whatsapp TEXT,
  instagram TEXT,
  procedure TEXT,
  piercing_region TEXT,
  orientations_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  health_declaration TEXT,
  form_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  signature_data_url TEXT,
  pdf_url TEXT,
  signed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS catalog_customization (
  id INTEGER PRIMARY KEY DEFAULT 1,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS companies (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  document TEXT,
  plan TEXT NOT NULL DEFAULT 'local',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS crm_interactions (
  id SERIAL PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'aberto',
  due_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS courses (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  format TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS consultancies (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  format TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  actor TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS integrations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT,
  status TEXT NOT NULL DEFAULT 'inativo',
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
CREATE INDEX IF NOT EXISTS idx_products_catalog ON products(is_catalog_active, is_published);
CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(appointment_date, appointment_time);
CREATE INDEX IF NOT EXISTS idx_financial_date ON financial_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_sales_orders_created ON sales_orders(created_at);
CREATE INDEX IF NOT EXISTS idx_post_care_due ON post_care(due_date);

INSERT INTO users (name, email, role)
VALUES ('Administrador Aura', 'admin@auraclinic.com', 'admin')
ON CONFLICT (email) DO NOTHING;
