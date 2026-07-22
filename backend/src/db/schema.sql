-- Schema unificado da Aura Clinic (Postgres).
-- Espelha o modelo que o frontend espera. Tipos: SERIAL para ids,
-- DOUBLE PRECISION para valores, INTEGER para flags 0/1, TEXT para datas/hora
-- armazenadas como string (compatível com o comportamento atual dos handlers).

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  user_email TEXT,
  tenant_slug TEXT,
  action TEXT NOT NULL,
  reset_type TEXT,
  result TEXT NOT NULL,
  removed_counts TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS clinic_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  default_price_multiplier DOUBLE PRECISION NOT NULL DEFAULT 3,
  price_rounding_mode TEXT NOT NULL DEFAULT 'exact',
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  updated_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS professionals (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  specialty TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  photo_url TEXT,
  phone TEXT,
  email TEXT,
  whatsapp TEXT,
  notification_opt_in INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS services (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 40,
  price DOUBLE PRECISION NOT NULL DEFAULT 0,
  deposit_value DOUBLE PRECISION NOT NULL DEFAULT 0,
  active_online_booking INTEGER NOT NULL DEFAULT 1,
  pre_service_notes TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS clients (
  id SERIAL PRIMARY KEY,
  full_name TEXT NOT NULL,
  whatsapp TEXT NOT NULL,
  instagram TEXT,
  notes TEXT,
  birth_date TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS jewelry_inventory (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  photo_url TEXT,
  image_url TEXT,
  gallery_urls TEXT,
  category TEXT NOT NULL,
  subcategory TEXT,
  variant_group TEXT,
  variation_label TEXT,
  material TEXT NOT NULL,
  color TEXT NOT NULL,
  stone TEXT,
  size TEXT,
  top_size_mm DOUBLE PRECISION,
  thickness TEXT,
  stem_length TEXT,
  thread_type TEXT,
  piercing_type TEXT,
  weight_grams DOUBLE PRECISION NOT NULL DEFAULT 0,
  package_length_cm DOUBLE PRECISION NOT NULL DEFAULT 0,
  package_width_cm DOUBLE PRECISION NOT NULL DEFAULT 0,
  package_height_cm DOUBLE PRECISION NOT NULL DEFAULT 0,
  package_type TEXT,
  virtual_store_active INTEGER NOT NULL DEFAULT 1,
  preparation_days INTEGER NOT NULL DEFAULT 1,
  shipping_info TEXT,
  seo_title TEXT,
  seo_description TEXT,
  freight_notes TEXT,
  quantity INTEGER NOT NULL DEFAULT 0,
  cost_value DOUBLE PRECISION NOT NULL DEFAULT 0,
  sale_value DOUBLE PRECISION NOT NULL DEFAULT 0,
  purchase_cost_cents INTEGER NOT NULL DEFAULT 0,
  allocated_freight_cents INTEGER NOT NULL DEFAULT 0,
  additional_cost_cents INTEGER NOT NULL DEFAULT 0,
  total_cost_cents INTEGER NOT NULL DEFAULT 0,
  price_multiplier DOUBLE PRECISION NOT NULL DEFAULT 3,
  price_rounding_mode TEXT NOT NULL DEFAULT 'exact',
    suggested_price_cents INTEGER NOT NULL DEFAULT 0,
    sale_price_cents INTEGER NOT NULL DEFAULT 0,
    price_manually_overridden INTEGER NOT NULL DEFAULT 0,
    cost_estimated INTEGER NOT NULL DEFAULT 0,
  supplier TEXT,
  physical_location TEXT,
  sku TEXT UNIQUE,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'disponível',
  low_stock_threshold INTEGER NOT NULL DEFAULT 3,
  critical_stock_threshold INTEGER NOT NULL DEFAULT 3,
  is_catalog_active INTEGER NOT NULL DEFAULT 1,
  is_featured INTEGER NOT NULL DEFAULT 0,
  is_new INTEGER NOT NULL DEFAULT 0,
  is_most_wanted INTEGER NOT NULL DEFAULT 0,
  is_promotion INTEGER NOT NULL DEFAULT 0,
  is_last_units INTEGER NOT NULL DEFAULT 0,
  is_published INTEGER NOT NULL DEFAULT 0
);

  CREATE TABLE IF NOT EXISTS jewelry_variants (
  id SERIAL PRIMARY KEY,
  jewelry_id INTEGER NOT NULL REFERENCES jewelry_inventory(id) ON DELETE CASCADE,
  sku TEXT NOT NULL UNIQUE,
  variation_name TEXT,
  material TEXT,
  color TEXT,
  stone_color TEXT,
  side TEXT,
  size TEXT,
  top_size_mm DOUBLE PRECISION,
  thickness TEXT,
  length TEXT,
  length_mm DOUBLE PRECISION,
  diameter TEXT,
  thread_type TEXT,
  supplier TEXT,
  cost_value DOUBLE PRECISION NOT NULL DEFAULT 0,
  sale_value DOUBLE PRECISION NOT NULL DEFAULT 0,
  purchase_cost_cents INTEGER NOT NULL DEFAULT 0,
  allocated_freight_cents INTEGER NOT NULL DEFAULT 0,
  additional_cost_cents INTEGER NOT NULL DEFAULT 0,
  total_cost_cents INTEGER NOT NULL DEFAULT 0,
  price_multiplier DOUBLE PRECISION NOT NULL DEFAULT 3,
  price_rounding_mode TEXT NOT NULL DEFAULT 'exact',
    suggested_price_cents INTEGER NOT NULL DEFAULT 0,
    sale_price_cents INTEGER NOT NULL DEFAULT 0,
    price_manually_overridden INTEGER NOT NULL DEFAULT 0,
    cost_estimated INTEGER NOT NULL DEFAULT 0,
  quantity INTEGER NOT NULL DEFAULT 0,
  low_stock_threshold INTEGER NOT NULL DEFAULT 5,
  status TEXT NOT NULL DEFAULT 'disponível',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  updated_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
  );

  CREATE TABLE IF NOT EXISTS product_images (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES jewelry_inventory(id) ON DELETE CASCADE,
    variation_id INTEGER REFERENCES jewelry_variants(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL,
    storage_key TEXT,
    alt_text TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_primary INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
    updated_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
  );

CREATE TABLE IF NOT EXISTS professional_services (
  id SERIAL PRIMARY KEY,
  professional_id INTEGER NOT NULL REFERENCES professionals(id),
  service_id INTEGER NOT NULL REFERENCES services(id),
  UNIQUE(professional_id, service_id)
);

CREATE TABLE IF NOT EXISTS professional_availability (
  id SERIAL PRIMARY KEY,
  professional_id INTEGER NOT NULL REFERENCES professionals(id),
  weekday INTEGER NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  start_time TEXT NOT NULL DEFAULT '09:00',
  end_time TEXT NOT NULL DEFAULT '18:00',
  lunch_start TEXT,
  lunch_end TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 40,
  buffer_minutes INTEGER NOT NULL DEFAULT 10,
  UNIQUE(professional_id, weekday)
);

CREATE TABLE IF NOT EXISTS schedule_blocks (
  id SERIAL PRIMARY KEY,
  professional_id INTEGER NOT NULL REFERENCES professionals(id),
  start_datetime TEXT NOT NULL,
  end_datetime TEXT NOT NULL,
  block_type TEXT NOT NULL DEFAULT 'block',
  reason TEXT NOT NULL,
  notes TEXT,
  is_full_day INTEGER NOT NULL DEFAULT 0,
  is_recurring INTEGER NOT NULL DEFAULT 0,
  lunch_start TEXT,
  lunch_end TEXT,
  duration_minutes INTEGER,
  buffer_minutes INTEGER
);

CREATE TABLE IF NOT EXISTS inventory_options (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  UNIQUE(type, name)
);

CREATE TABLE IF NOT EXISTS appointments (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  professional_id INTEGER NOT NULL REFERENCES professionals(id),
  jewelry_id INTEGER REFERENCES jewelry_inventory(id),
  jewelry_variant_id INTEGER,
  service_id INTEGER,
  procedure TEXT NOT NULL,
  description TEXT,
  piercing_region TEXT NOT NULL,
  appointment_date TEXT NOT NULL,
  appointment_time TEXT NOT NULL,
  end_time TEXT,
  total_value DOUBLE PRECISION NOT NULL DEFAULT 0,
  deposit_value DOUBLE PRECISION NOT NULL DEFAULT 0,
  remaining_value DOUBLE PRECISION NOT NULL DEFAULT 0,
  deposit_payment_method TEXT,
  remaining_payment_method TEXT,
  status TEXT NOT NULL DEFAULT 'pendente',
  source TEXT NOT NULL DEFAULT 'manual',
  public_booking_key TEXT,
  duration_minutes INTEGER,
  notes TEXT,
  reference_photo_url TEXT,
  payment_proof_url TEXT,
  stock_deducted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS appointment_items (
  id SERIAL PRIMARY KEY,
  appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  procedure_id INTEGER,
  service_id INTEGER,
  region TEXT,
  jewelry_id INTEGER REFERENCES jewelry_inventory(id),
  jewelry_variant_id INTEGER,
  quantity INTEGER NOT NULL DEFAULT 1,
  procedure_price DOUBLE PRECISION NOT NULL DEFAULT 0,
  jewelry_unit_price DOUBLE PRECISION NOT NULL DEFAULT 0,
  duration_minutes INTEGER NOT NULL DEFAULT 0,
  subtotal DOUBLE PRECISION NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  updated_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE INDEX IF NOT EXISTS idx_appointment_items_appointment ON appointment_items(appointment_id);
CREATE INDEX IF NOT EXISTS idx_appointment_items_jewelry ON appointment_items(jewelry_id, jewelry_variant_id);

CREATE TABLE IF NOT EXISTS notification_queue (
  id SERIAL PRIMARY KEY,
  professional_id INTEGER REFERENCES professionals(id),
  appointment_id INTEGER REFERENCES appointments(id),
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  destination TEXT,
  template TEXT NOT NULL,
  payload TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  scheduled_at TEXT,
  sent_at TEXT,
  unique_key TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_queue_unique_key ON notification_queue(unique_key) WHERE unique_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  appointment_id INTEGER REFERENCES appointments(id),
  client_id INTEGER NOT NULL REFERENCES clients(id),
  amount DOUBLE PRECISION NOT NULL,
  payment_type TEXT NOT NULL,
  method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pago',
  paid_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id SERIAL PRIMARY KEY,
  jewelry_id INTEGER NOT NULL REFERENCES jewelry_inventory(id),
  variant_id INTEGER,
  movement_type TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  notes TEXT,
  movement_date TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS sales_orders (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  appointment_id INTEGER REFERENCES appointments(id),
  order_type TEXT NOT NULL DEFAULT 'produto',
  source TEXT NOT NULL DEFAULT 'site',
  status TEXT NOT NULL DEFAULT 'aberta',
  payment_method TEXT,
  total_value DOUBLE PRECISION NOT NULL DEFAULT 0,
  notes TEXT,
  created_by_user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS sales_order_items (
  id SERIAL PRIMARY KEY,
  sales_order_id INTEGER NOT NULL REFERENCES sales_orders(id),
  item_type TEXT NOT NULL DEFAULT 'produto',
  product_id INTEGER REFERENCES jewelry_inventory(id),
  product_variant_id INTEGER REFERENCES jewelry_variants(id),
  service_id INTEGER REFERENCES services(id),
  item_name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price DOUBLE PRECISION NOT NULL DEFAULT 0,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS expenses (
  id SERIAL PRIMARY KEY,
  description TEXT NOT NULL,
  expense_type TEXT NOT NULL CHECK (expense_type IN ('fixa', 'variavel')),
  category TEXT,
  amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'paga',
  payment_method TEXT,
  paid_at TEXT,
  paid_by_user_id INTEGER REFERENCES users(id),
  payment_account TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS expense_audit_logs (
  id SERIAL PRIMARY KEY,
  expense_id INTEGER NOT NULL REFERENCES expenses(id) ON DELETE RESTRICT,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  previous_status TEXT,
  next_status TEXT,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS client_medical_records (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  appointment_id INTEGER REFERENCES appointments(id),
  record_date TEXT NOT NULL,
  piercing_history TEXT,
  jewelry_used TEXT,
  before_photo_url TEXT,
  after_photo_url TEXT,
  occurrences TEXT,
  guidance TEXT,
  allergies_notes TEXT,
  healing_evolution TEXT,
  returns_done TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS digital_terms (
  id SERIAL PRIMARY KEY,
  appointment_id INTEGER REFERENCES appointments(id),
  client_id INTEGER NOT NULL REFERENCES clients(id),
  full_name TEXT NOT NULL,
  social_name TEXT,
  document_number TEXT,
  birth_date TEXT,
  whatsapp TEXT,
  instagram TEXT,
  address TEXT,
  procedure TEXT,
  piercing_region TEXT,
  orientations_confirmed INTEGER NOT NULL DEFAULT 0,
  health_declaration TEXT,
  form_data TEXT NOT NULL DEFAULT '',
  signature_data_url TEXT NOT NULL,
  pdf_url TEXT,
  signed_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS post_care_followups (
  id SERIAL PRIMARY KEY,
  appointment_id INTEGER NOT NULL REFERENCES appointments(id),
  client_id INTEGER NOT NULL REFERENCES clients(id),
  reminder_day INTEGER NOT NULL,
  due_date TEXT NOT NULL,
  care_message TEXT NOT NULL,
  healing_status TEXT NOT NULL DEFAULT 'aguardando retorno',
  client_photo_url TEXT,
  client_notes TEXT,
  status TEXT NOT NULL DEFAULT 'pendente',
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  updated_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  UNIQUE(appointment_id, reminder_day)
);

CREATE TABLE IF NOT EXISTS loyalty_points (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  appointment_id INTEGER REFERENCES appointments(id),
  points INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  UNIQUE(appointment_id, event_type)
);

CREATE TABLE IF NOT EXISTS loyalty_redemptions (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  points_used INTEGER NOT NULL,
  discount_value DOUBLE PRECISION NOT NULL DEFAULT 0,
  notes TEXT,
  redeemed_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS catalog_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS catalog_banners (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  subtitle TEXT,
  image_url TEXT,
  button_text TEXT,
  button_link TEXT,
  banner_width INTEGER NOT NULL DEFAULT 0,
  banner_height INTEGER NOT NULL DEFAULT 340,
  banner_fit TEXT NOT NULL DEFAULT 'cover',
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS catalog_featured_categories (
  id SERIAL PRIMARY KEY,
  category_id TEXT NOT NULL,
  public_name TEXT NOT NULL,
  icon TEXT,
  image_url TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS catalog_featured_products (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES jewelry_inventory(id),
  badge TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS catalog_promotions (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  discount_type TEXT NOT NULL DEFAULT 'percent',
  discount_value DOUBLE PRECISION NOT NULL DEFAULT 0,
  start_date TEXT,
  end_date TEXT,
  applies_to TEXT NOT NULL DEFAULT 'products',
  product_ids TEXT,
  category_ids TEXT,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS catalog_theme (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  brand_name TEXT NOT NULL DEFAULT 'Aura Clinic',
  slogan TEXT,
  logo_url TEXT,
  primary_color TEXT NOT NULL DEFAULT '#C8A96A',
  secondary_color TEXT NOT NULL DEFAULT '#D8C3A5',
  background_color TEXT NOT NULL DEFAULT '#F8F5F0',
  button_color TEXT NOT NULL DEFAULT '#C8A96A',
  title_font TEXT NOT NULL DEFAULT 'Georgia',
  body_font TEXT NOT NULL DEFAULT 'Inter',
  theme TEXT NOT NULL DEFAULT 'premium',
  show_out_of_stock INTEGER NOT NULL DEFAULT 0,
  show_stock_quantity INTEGER NOT NULL DEFAULT 0,
  stock_display_mode TEXT NOT NULL DEFAULT 'status',
  show_whatsapp_button INTEGER NOT NULL DEFAULT 1,
  show_schedule_button INTEGER NOT NULL DEFAULT 1,
  show_buy_button INTEGER NOT NULL DEFAULT 0,
  show_favorites INTEGER NOT NULL DEFAULT 1,
  footer_text TEXT
);

-- Procedimentos: recurso nativo do backend Postgres, consumido pela tela de agenda/serviços.
CREATE TABLE IF NOT EXISTS procedures (
  id SERIAL PRIMARY KEY,
  service_id INTEGER REFERENCES services(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  body_area TEXT,
  description TEXT,
  price DOUBLE PRECISION NOT NULL DEFAULT 0,
  duration_minutes INTEGER NOT NULL DEFAULT 40,
  aftercare_instructions TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  updated_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

-- Índices de apoio
CREATE INDEX IF NOT EXISTS idx_clients_full_name ON clients(full_name);
CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(appointment_date, appointment_time);
CREATE INDEX IF NOT EXISTS idx_appointments_client ON appointments(client_id);
CREATE INDEX IF NOT EXISTS idx_jewelry_catalog ON jewelry_inventory(is_catalog_active, is_published);
CREATE INDEX IF NOT EXISTS idx_jewelry_variants_jewelry ON jewelry_variants(jewelry_id);
CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images(product_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_product_images_variation ON product_images(variation_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_stock_movements_jewelry ON stock_movements(jewelry_id);
CREATE INDEX IF NOT EXISTS idx_payments_appointment ON payments(appointment_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_points_client ON loyalty_points(client_id);
CREATE INDEX IF NOT EXISTS idx_medical_records_client ON client_medical_records(client_id);
CREATE INDEX IF NOT EXISTS idx_expenses_due ON expenses(due_date);

-- Log central de erros (backend + frontend) para diagnóstico. Só o admin lê
-- (via /api/error-logs). Ingestão do frontend é pública para capturar erros de
-- telas não autenticadas (login/catálogo).
CREATE TABLE IF NOT EXISTS error_logs (
  id SERIAL PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'backend',
  level TEXT NOT NULL DEFAULT 'error',
  message TEXT NOT NULL,
  stack TEXT,
  url TEXT,
  method TEXT,
  status_code INTEGER,
  user_id INTEGER,
  user_email TEXT,
  user_agent TEXT,
  context JSONB,
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_error_logs_created ON error_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_resolved ON error_logs(resolved, created_at DESC);

-- Correções idempotentes aplicadas a clínicas já existentes no boot (applySchemaToAllTenants).
ALTER TABLE jewelry_inventory ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE jewelry_inventory ADD COLUMN IF NOT EXISTS top_size_mm DOUBLE PRECISION;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS cpf TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS updated_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS');
ALTER TABLE professionals ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE professionals ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE professionals ADD COLUMN IF NOT EXISTS calendar_color TEXT DEFAULT '#C8A96A';
ALTER TABLE professionals ADD COLUMN IF NOT EXISTS whatsapp TEXT;
ALTER TABLE professionals ADD COLUMN IF NOT EXISTS notification_opt_in INTEGER NOT NULL DEFAULT 1;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS public_booking_key TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS duration_minutes INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_public_booking_key ON appointments(public_booking_key) WHERE public_booking_key IS NOT NULL;
ALTER TABLE inventory_options ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE inventory_options ADD COLUMN IF NOT EXISTS is_active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE schedule_blocks ADD COLUMN IF NOT EXISTS block_type TEXT NOT NULL DEFAULT 'block';
ALTER TABLE schedule_blocks ADD COLUMN IF NOT EXISTS lunch_start TEXT;
ALTER TABLE schedule_blocks ADD COLUMN IF NOT EXISTS lunch_end TEXT;
ALTER TABLE schedule_blocks ADD COLUMN IF NOT EXISTS duration_minutes INTEGER;
ALTER TABLE schedule_blocks ADD COLUMN IF NOT EXISTS buffer_minutes INTEGER;
ALTER TABLE payments ALTER COLUMN appointment_id DROP NOT NULL;
ALTER TABLE digital_terms ALTER COLUMN appointment_id DROP NOT NULL;
ALTER TABLE jewelry_inventory ADD COLUMN IF NOT EXISTS purchase_cost_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jewelry_inventory ADD COLUMN IF NOT EXISTS allocated_freight_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jewelry_inventory ADD COLUMN IF NOT EXISTS additional_cost_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jewelry_inventory ADD COLUMN IF NOT EXISTS total_cost_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jewelry_inventory ADD COLUMN IF NOT EXISTS price_multiplier DOUBLE PRECISION NOT NULL DEFAULT 3;
ALTER TABLE jewelry_inventory ADD COLUMN IF NOT EXISTS price_rounding_mode TEXT NOT NULL DEFAULT 'exact';
ALTER TABLE jewelry_inventory ADD COLUMN IF NOT EXISTS suggested_price_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jewelry_inventory ADD COLUMN IF NOT EXISTS sale_price_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jewelry_inventory ADD COLUMN IF NOT EXISTS price_manually_overridden INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jewelry_inventory ADD COLUMN IF NOT EXISTS cost_estimated INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jewelry_variants ADD COLUMN IF NOT EXISTS length_mm DOUBLE PRECISION;
ALTER TABLE jewelry_variants ADD COLUMN IF NOT EXISTS top_size_mm DOUBLE PRECISION;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS paid_at TEXT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS paid_by_user_id INTEGER REFERENCES users(id);
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS payment_account TEXT;
CREATE INDEX IF NOT EXISTS idx_expenses_status_due ON expenses(status, due_date);
CREATE INDEX IF NOT EXISTS idx_jewelry_top_size ON jewelry_inventory(top_size_mm);
CREATE INDEX IF NOT EXISTS idx_jewelry_variants_top_size ON jewelry_variants(top_size_mm);
ALTER TABLE jewelry_variants ADD COLUMN IF NOT EXISTS purchase_cost_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jewelry_variants ADD COLUMN IF NOT EXISTS allocated_freight_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jewelry_variants ADD COLUMN IF NOT EXISTS additional_cost_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jewelry_variants ADD COLUMN IF NOT EXISTS total_cost_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jewelry_variants ADD COLUMN IF NOT EXISTS price_multiplier DOUBLE PRECISION NOT NULL DEFAULT 3;
ALTER TABLE jewelry_variants ADD COLUMN IF NOT EXISTS price_rounding_mode TEXT NOT NULL DEFAULT 'exact';
ALTER TABLE jewelry_variants ADD COLUMN IF NOT EXISTS suggested_price_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jewelry_variants ADD COLUMN IF NOT EXISTS sale_price_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jewelry_variants ADD COLUMN IF NOT EXISTS price_manually_overridden INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jewelry_variants ADD COLUMN IF NOT EXISTS cost_estimated INTEGER NOT NULL DEFAULT 0;
ALTER TABLE product_images ADD COLUMN IF NOT EXISTS variation_id INTEGER REFERENCES jewelry_variants(id) ON DELETE CASCADE;
ALTER TABLE product_images ADD COLUMN IF NOT EXISTS storage_key TEXT;
ALTER TABLE product_images ADD COLUMN IF NOT EXISTS alt_text TEXT;
ALTER TABLE product_images ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE product_images ADD COLUMN IF NOT EXISTS is_primary INTEGER NOT NULL DEFAULT 0;
INSERT INTO clinic_settings (id, default_price_multiplier, price_rounding_mode)
VALUES (1, 3, 'exact')
ON CONFLICT (id) DO NOTHING;
UPDATE jewelry_inventory
SET
  purchase_cost_cents = CASE WHEN purchase_cost_cents = 0 AND cost_value > 0 THEN ROUND(cost_value * 100)::int ELSE purchase_cost_cents END,
  total_cost_cents = CASE WHEN total_cost_cents = 0 AND cost_value > 0 THEN ROUND(cost_value * 100)::int ELSE total_cost_cents END,
  suggested_price_cents = CASE WHEN suggested_price_cents = 0 AND cost_value > 0 THEN ROUND(cost_value * 100 * price_multiplier)::int ELSE suggested_price_cents END,
  sale_price_cents = CASE WHEN sale_price_cents = 0 AND sale_value > 0 THEN ROUND(sale_value * 100)::int ELSE sale_price_cents END,
  price_manually_overridden = CASE WHEN sale_value > 0 AND cost_value > 0 AND ROUND(sale_value * 100)::int != ROUND(cost_value * 100 * price_multiplier)::int THEN 1 ELSE price_manually_overridden END
WHERE cost_value > 0 OR sale_value > 0;
UPDATE jewelry_variants
SET
  purchase_cost_cents = CASE WHEN purchase_cost_cents = 0 AND cost_value > 0 THEN ROUND(cost_value * 100)::int ELSE purchase_cost_cents END,
  total_cost_cents = CASE WHEN total_cost_cents = 0 AND cost_value > 0 THEN ROUND(cost_value * 100)::int ELSE total_cost_cents END,
  suggested_price_cents = CASE WHEN suggested_price_cents = 0 AND cost_value > 0 THEN ROUND(cost_value * 100 * price_multiplier)::int ELSE suggested_price_cents END,
  sale_price_cents = CASE WHEN sale_price_cents = 0 AND sale_value > 0 THEN ROUND(sale_value * 100)::int ELSE sale_price_cents END,
  price_manually_overridden = CASE WHEN sale_value > 0 AND cost_value > 0 AND ROUND(sale_value * 100)::int != ROUND(cost_value * 100 * price_multiplier)::int THEN 1 ELSE price_manually_overridden END
WHERE cost_value > 0 OR sale_value > 0;
