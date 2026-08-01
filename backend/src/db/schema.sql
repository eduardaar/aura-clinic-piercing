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

CREATE TABLE IF NOT EXISTS inventory_reservations (
  id SERIAL PRIMARY KEY,
  reservation_key TEXT NOT NULL,
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE CASCADE,
  client_id INTEGER REFERENCES clients(id),
  jewelry_id INTEGER NOT NULL REFERENCES jewelry_inventory(id),
  jewelry_variant_id INTEGER REFERENCES jewelry_variants(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'confirmed', 'released', 'expired', 'cancelled')),
  expires_at TIMESTAMP NOT NULL,
  confirmed_at TIMESTAMP,
  released_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(reservation_key, jewelry_id, jewelry_variant_id)
);
ALTER TABLE professionals ADD COLUMN IF NOT EXISTS commission_percentage DOUBLE PRECISION NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_inventory_reservations_stock ON inventory_reservations(jewelry_id, jewelry_variant_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_inventory_reservations_expiry ON inventory_reservations(status, expires_at);

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
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS client_id INTEGER REFERENCES clients(id);
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS automation_rule_id INTEGER;

CREATE TABLE IF NOT EXISTS communication_templates (
  id SERIAL PRIMARY KEY,
  template_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  subject TEXT,
  body TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS automation_rules (
  id SERIAL PRIMARY KEY,
  rule_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  event_type TEXT NOT NULL,
  template_key TEXT REFERENCES communication_templates(template_key),
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  offset_minutes INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS automation_runs (
  id SERIAL PRIMARY KEY,
  rule_id INTEGER REFERENCES automation_rules(id),
  entity_type TEXT,
  entity_id INTEGER,
  status TEXT NOT NULL,
  details JSONB,
  executed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO communication_templates (template_key, name, body) VALUES
  ('booking_received', 'Solicitação recebida', 'Olá, {{cliente}}. Recebemos sua solicitação no {{estudio}} para {{data}} às {{horario}}. Protocolo: {{protocolo}}.'),
  ('booking_confirmed', 'Agendamento confirmado', 'Olá, {{cliente}}. Seu agendamento no {{estudio}} está confirmado para {{data}} às {{horario}} com {{profissional}}.'),
  ('booking_rescheduled', 'Reagendamento', 'Olá, {{cliente}}. Seu atendimento foi reagendado para {{data}} às {{horario}}.'),
  ('booking_cancelled', 'Cancelamento', 'Olá, {{cliente}}. Seu agendamento de {{data}} às {{horario}} foi cancelado.'),
  ('reminder_24h', 'Lembrete de 24 horas', 'Olá, {{cliente}}. Lembrete do seu atendimento amanhã, {{data}}, às {{horario}}, no {{estudio}}.'),
  ('reminder_2h', 'Lembrete de 2 horas', 'Olá, {{cliente}}. Seu atendimento no {{estudio}} será às {{horario}}. Endereço: {{endereco}}.'),
  ('postcare', 'Pós-atendimento', 'Olá, {{cliente}}. Como está sua evolução após o atendimento? Se precisar, fale com o {{estudio}}.'),
  ('payment_pending', 'Pagamento pendente', 'Olá, {{cliente}}. O sinal de {{sinal}} do protocolo {{protocolo}} ainda está pendente.'),
  ('stock_available', 'Produto disponível', 'Olá, {{cliente}}. A joia {{joias}} está disponível novamente no {{estudio}}.'),
  ('promotion', 'Promoção', 'Olá, {{cliente}}. Confira a promoção {{promocao}} no catálogo do {{estudio}}.'),
  ('coupon', 'Cupom', 'Olá, {{cliente}}. Use o cupom {{cupom}} no catálogo do {{estudio}}.'),
  ('birthday', 'Aniversário', 'Feliz aniversário, {{cliente}}! O {{estudio}} deseja um dia especial para você.')
ON CONFLICT (template_key) DO NOTHING;

INSERT INTO automation_rules (rule_key, name, event_type, template_key, offset_minutes, is_active) VALUES
  ('booking_received', 'Solicitação recebida', 'booking_created', 'booking_received', 0, 1),
  ('reminder_24h', 'Lembrete 24h', 'appointment_upcoming', 'reminder_24h', -1440, 1),
  ('reminder_2h', 'Lembrete 2h', 'appointment_upcoming', 'reminder_2h', -120, 1),
  ('payment_pending', 'Pagamento pendente', 'payment_pending', 'payment_pending', 60, 1),
  ('reservation_expired', 'Reserva expirada', 'reservation_expired', 'payment_pending', 0, 1),
  ('postcare', 'Pós-atendimento', 'appointment_completed', 'postcare', 10080, 1),
  ('birthday', 'Aniversariantes', 'client_birthday', 'birthday', 0, 0)
ON CONFLICT (rule_key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_automation_rules_event ON automation_rules(event_type, is_active);
CREATE INDEX IF NOT EXISTS idx_automation_runs_entity ON automation_runs(entity_type, entity_id, executed_at);

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
ALTER TABLE payments ADD COLUMN IF NOT EXISTS installments INTEGER NOT NULL DEFAULT 1;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS fee_amount DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS net_amount DOUBLE PRECISION;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS expected_receipt_date TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER REFERENCES users(id);

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS service_value DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS jewelry_value DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS subtotal_value DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS discount_value DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS coupon_id INTEGER;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS coupon_code TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS coupon_snapshot JSONB;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS deposit_status TEXT NOT NULL DEFAULT 'pendente';
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS deposit_paid_at TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS financial_notes TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS financial_closed_at TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS financial_closed_by INTEGER REFERENCES users(id);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS updated_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS');

CREATE TABLE IF NOT EXISTS appointment_financial_audit (
  id SERIAL PRIMARY KEY,
  appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  reason TEXT,
  before_snapshot JSONB,
  after_snapshot JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_appointment_financial_audit ON appointment_financial_audit(appointment_id, created_at DESC);

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
  mobile_image_url TEXT,
  original_image_url TEXT,
  alt_text TEXT,
  image_transform JSONB,
  button_text TEXT,
  button_link TEXT,
  banner_width INTEGER NOT NULL DEFAULT 0,
  banner_height INTEGER NOT NULL DEFAULT 340,
  banner_fit TEXT NOT NULL DEFAULT 'cover',
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);
ALTER TABLE catalog_banners ADD COLUMN IF NOT EXISTS mobile_image_url TEXT;
ALTER TABLE catalog_banners ADD COLUMN IF NOT EXISTS original_image_url TEXT;
ALTER TABLE catalog_banners ADD COLUMN IF NOT EXISTS alt_text TEXT;
ALTER TABLE catalog_banners ADD COLUMN IF NOT EXISTS image_transform JSONB;

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

CREATE TABLE IF NOT EXISTS financial_cost_centers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS financial_entries (
  id SERIAL PRIMARY KEY,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('payable', 'receivable', 'income', 'expense')),
  description TEXT NOT NULL,
  category TEXT,
  amount DOUBLE PRECISION NOT NULL CHECK (amount >= 0),
  paid_amount DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  due_date TEXT NOT NULL,
  competence_date TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'overdue', 'canceled', 'partially_paid', 'refunded')),
  payment_method TEXT,
  payment_account TEXT,
  paid_at TEXT,
  cost_center_id INTEGER REFERENCES financial_cost_centers(id),
  responsible_user_id INTEGER REFERENCES users(id),
  attachment_url TEXT,
  notes TEXT,
  recurrence TEXT,
  recurrence_end_date TEXT,
  installment_number INTEGER,
  installment_count INTEGER,
  parent_entry_id INTEGER REFERENCES financial_entries(id),
  source_type TEXT,
  source_id INTEGER,
  source_key TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  updated_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS financial_entry_audit (
  id SERIAL PRIMARY KEY,
  entry_id INTEGER NOT NULL REFERENCES financial_entries(id) ON DELETE RESTRICT,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  before_data TEXT,
  after_data TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS financial_goals (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  target_amount DOUBLE PRECISION NOT NULL CHECK (target_amount >= 0),
  goal_type TEXT NOT NULL DEFAULT 'revenue',
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS financial_reconciliations (
  id SERIAL PRIMARY KEY,
  entry_id INTEGER NOT NULL REFERENCES financial_entries(id),
  external_reference TEXT,
  statement_amount DOUBLE PRECISION NOT NULL,
  statement_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'matched' CHECK (status IN ('matched', 'divergent', 'ignored')),
  reconciled_by INTEGER REFERENCES users(id),
  reconciled_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  UNIQUE(entry_id, external_reference)
);

CREATE INDEX IF NOT EXISTS idx_financial_entries_due ON financial_entries(status, due_date, entry_type);
CREATE INDEX IF NOT EXISTS idx_financial_entries_period ON financial_entries(competence_date, entry_type, status);
CREATE INDEX IF NOT EXISTS idx_financial_entries_source ON financial_entries(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_financial_audit_entry ON financial_entry_audit(entry_id, created_at);
CREATE INDEX IF NOT EXISTS idx_financial_goals_period ON financial_goals(period_start, period_end);

CREATE TABLE IF NOT EXISTS inventory_suggestions (
  id SERIAL PRIMARY KEY,
  jewelry_id INTEGER NOT NULL REFERENCES jewelry_inventory(id) ON DELETE CASCADE,
  suggestion_type TEXT NOT NULL,
  current_value TEXT,
  suggested_value TEXT NOT NULL,
  reason TEXT NOT NULL,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  updated_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS inventory_counts (
  id SERIAL PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'completed', 'canceled')),
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  completed_by INTEGER REFERENCES users(id),
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS inventory_count_items (
  id SERIAL PRIMARY KEY,
  count_id INTEGER NOT NULL REFERENCES inventory_counts(id) ON DELETE CASCADE,
  jewelry_id INTEGER NOT NULL REFERENCES jewelry_inventory(id),
  variant_id INTEGER REFERENCES jewelry_variants(id),
  expected_quantity INTEGER NOT NULL DEFAULT 0,
  counted_quantity INTEGER,
  difference INTEGER NOT NULL DEFAULT 0,
  UNIQUE(count_id, jewelry_id, variant_id)
);

CREATE TABLE IF NOT EXISTS inventory_audit_log (
  id SERIAL PRIMARY KEY,
  jewelry_id INTEGER REFERENCES jewelry_inventory(id),
  action TEXT NOT NULL,
  before_data TEXT,
  after_data TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE INDEX IF NOT EXISTS idx_inventory_suggestions_status ON inventory_suggestions(status, suggestion_type, jewelry_id);
CREATE INDEX IF NOT EXISTS idx_inventory_counts_status ON inventory_counts(status, created_at);
CREATE INDEX IF NOT EXISTS idx_inventory_count_items_count ON inventory_count_items(count_id);
CREATE INDEX IF NOT EXISTS idx_inventory_audit_product ON inventory_audit_log(jewelry_id, created_at);
CREATE INDEX IF NOT EXISTS idx_stock_movements_date_type ON stock_movements(movement_date, movement_type, jewelry_id);

CREATE TABLE IF NOT EXISTS payment_intents (
  id SERIAL PRIMARY KEY,
  appointment_id INTEGER REFERENCES appointments(id),
  client_id INTEGER NOT NULL REFERENCES clients(id),
  provider TEXT NOT NULL DEFAULT 'manual',
  external_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  amount DOUBLE PRECISION NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL DEFAULT 'BRL',
  payment_type TEXT NOT NULL DEFAULT 'deposit',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'awaiting_payment', 'under_review', 'confirmed', 'failed', 'cancelled', 'refunded', 'expired')),
  pix_copy_paste TEXT,
  qr_code_url TEXT,
  expires_at TIMESTAMP,
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payment_events (
  id SERIAL PRIMARY KEY,
  payment_intent_id INTEGER NOT NULL REFERENCES payment_intents(id) ON DELETE CASCADE,
  provider_event_id TEXT,
  event_type TEXT NOT NULL,
  payload JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(payment_intent_id, provider_event_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_intents_appointment ON payment_intents(appointment_id, status);
CREATE INDEX IF NOT EXISTS idx_payment_events_intent ON payment_events(payment_intent_id, created_at);

CREATE TABLE IF NOT EXISTS catalog_layouts (
  id SERIAL PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('draft', 'published')),
  version INTEGER NOT NULL DEFAULT 1,
  published_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(status)
);

CREATE TABLE IF NOT EXISTS catalog_sections (
  id SERIAL PRIMARY KEY,
  layout_id INTEGER NOT NULL REFERENCES catalog_layouts(id) ON DELETE CASCADE,
  section_key TEXT NOT NULL,
  section_type TEXT NOT NULL,
  title TEXT,
  subtitle TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  alignment TEXT NOT NULL DEFAULT 'left',
  background TEXT,
  spacing INTEGER NOT NULL DEFAULT 24,
  item_limit INTEGER NOT NULL DEFAULT 8,
  display_mode TEXT NOT NULL DEFAULT 'grid',
  width_mode TEXT NOT NULL DEFAULT 'contained',
  height INTEGER,
  columns_count INTEGER NOT NULL DEFAULT 4,
  image_ratio TEXT NOT NULL DEFAULT '1:1',
  card_size TEXT NOT NULL DEFAULT 'medium',
  product_sort TEXT NOT NULL DEFAULT 'recent',
  category_filter TEXT,
  media_url TEXT,
  button_text TEXT,
  button_link TEXT,
  body_text TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(layout_id, section_key)
);

CREATE TABLE IF NOT EXISTS catalog_layout_history (
  id SERIAL PRIMARY KEY,
  version INTEGER NOT NULL,
  action TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id),
  snapshot JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS catalog_events (
  id SERIAL PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (event_type IN ('catalog_view', 'product_view', 'product_selected', 'checkout_started', 'booking_created')),
  product_id INTEGER REFERENCES jewelry_inventory(id) ON DELETE SET NULL,
  session_key TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'catalog',
  metadata TEXT,
  occurred_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS private_files (
  id SERIAL PRIMARY KEY,
  filename TEXT NOT NULL UNIQUE,
  original_name TEXT,
  mime_type TEXT NOT NULL,
  purpose TEXT NOT NULL,
  uploaded_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE INDEX IF NOT EXISTS idx_catalog_events_period ON catalog_events(occurred_at, event_type);
CREATE INDEX IF NOT EXISTS idx_catalog_events_product ON catalog_events(product_id, event_type, occurred_at);

CREATE TABLE IF NOT EXISTS product_visual_hashes (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES jewelry_inventory(id) ON DELETE CASCADE,
  variation_id INTEGER REFERENCES jewelry_variants(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  perceptual_hash TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  file_size INTEGER,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_id, variation_id, image_url)
);

ALTER TABLE catalog_featured_categories ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE catalog_featured_categories ADD COLUMN IF NOT EXISTS display_mode TEXT NOT NULL DEFAULT 'grid';
ALTER TABLE catalog_featured_categories ADD COLUMN IF NOT EXISTS product_limit INTEGER NOT NULL DEFAULT 12;
ALTER TABLE catalog_featured_categories ADD COLUMN IF NOT EXISTS color TEXT;
ALTER TABLE catalog_featured_categories ADD COLUMN IF NOT EXISTS banner_url TEXT;
ALTER TABLE catalog_featured_categories ADD COLUMN IF NOT EXISTS is_featured INTEGER NOT NULL DEFAULT 0;

ALTER TABLE catalog_promotions ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE catalog_promotions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE catalog_promotions ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 0;
ALTER TABLE catalog_promotions ADD COLUMN IF NOT EXISTS start_time TEXT;
ALTER TABLE catalog_promotions ADD COLUMN IF NOT EXISTS end_time TEXT;
ALTER TABLE catalog_promotions ADD COLUMN IF NOT EXISTS usage_limit INTEGER;
ALTER TABLE catalog_promotions ADD COLUMN IF NOT EXISTS usage_limit_per_client INTEGER;
ALTER TABLE catalog_promotions ADD COLUMN IF NOT EXISTS minimum_amount DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE catalog_promotions ADD COLUMN IF NOT EXISTS maximum_discount DOUBLE PRECISION;
ALTER TABLE catalog_promotions ADD COLUMN IF NOT EXISTS minimum_quantity INTEGER NOT NULL DEFAULT 1;
ALTER TABLE catalog_promotions ADD COLUMN IF NOT EXISTS variation_ids TEXT;
ALTER TABLE catalog_promotions ADD COLUMN IF NOT EXISTS excluded_product_ids TEXT;
ALTER TABLE catalog_promotions ADD COLUMN IF NOT EXISTS excluded_category_ids TEXT;
ALTER TABLE catalog_promotions ADD COLUMN IF NOT EXISTS excluded_variation_ids TEXT;
ALTER TABLE catalog_promotions ADD COLUMN IF NOT EXISTS colors TEXT;
ALTER TABLE catalog_promotions ADD COLUMN IF NOT EXISTS materials TEXT;
ALTER TABLE catalog_promotions ADD COLUMN IF NOT EXISTS stones TEXT;
ALTER TABLE catalog_promotions ADD COLUMN IF NOT EXISTS service_ids TEXT;
ALTER TABLE catalog_promotions ADD COLUMN IF NOT EXISTS buy_quantity INTEGER;
ALTER TABLE catalog_promotions ADD COLUMN IF NOT EXISTS pay_quantity INTEGER;
ALTER TABLE catalog_promotions ADD COLUMN IF NOT EXISTS fixed_promotional_price DOUBLE PRECISION;
ALTER TABLE catalog_promotions ADD COLUMN IF NOT EXISTS is_stackable INTEGER NOT NULL DEFAULT 0;
ALTER TABLE catalog_promotions ADD COLUMN IF NOT EXISTS stackable_with_coupon INTEGER NOT NULL DEFAULT 0;
ALTER TABLE catalog_promotions ADD COLUMN IF NOT EXISTS badge TEXT;
ALTER TABLE catalog_promotions ADD COLUMN IF NOT EXISTS legal_text TEXT;
ALTER TABLE catalog_promotions ADD COLUMN IF NOT EXISTS visible_in_catalog INTEGER NOT NULL DEFAULT 1;
ALTER TABLE catalog_promotions ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE catalog_promotions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE catalog_promotions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS promotion_usages (
  id SERIAL PRIMARY KEY,
  promotion_id INTEGER NOT NULL REFERENCES catalog_promotions(id),
  client_id INTEGER REFERENCES clients(id),
  appointment_id INTEGER REFERENCES appointments(id),
  sale_id INTEGER REFERENCES sales_orders(id),
  original_amount DOUBLE PRECISION NOT NULL CHECK (original_amount >= 0),
  discount_amount DOUBLE PRECISION NOT NULL CHECK (discount_amount >= 0),
  final_amount DOUBLE PRECISION NOT NULL CHECK (final_amount >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS promotion_audit_logs (
  id SERIAL PRIMARY KEY,
  promotion_id INTEGER,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  previous_data JSONB,
  next_data JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS coupons (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL,
  internal_name TEXT NOT NULL,
  description TEXT,
  discount_type TEXT NOT NULL DEFAULT 'percent' CHECK (discount_type IN ('percent', 'fixed')),
  discount_value DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (discount_value >= 0),
  starts_at TIMESTAMP,
  ends_at TIMESTAMP,
  usage_limit INTEGER CHECK (usage_limit IS NULL OR usage_limit >= 0),
  usage_limit_per_client INTEGER CHECK (usage_limit_per_client IS NULL OR usage_limit_per_client >= 0),
  minimum_amount DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (minimum_amount >= 0),
  maximum_discount DOUBLE PRECISION CHECK (maximum_discount IS NULL OR maximum_discount >= 0),
  product_ids TEXT,
  category_ids TEXT,
  excluded_product_ids TEXT,
  excluded_category_ids TEXT,
  service_ids TEXT,
  first_purchase_only INTEGER NOT NULL DEFAULT 0,
  selected_client_ids TEXT,
  is_stackable INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'inactive')),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP,
  UNIQUE(code)
);

CREATE TABLE IF NOT EXISTS coupon_usages (
  id SERIAL PRIMARY KEY,
  coupon_id INTEGER NOT NULL REFERENCES coupons(id),
  client_id INTEGER REFERENCES clients(id),
  appointment_id INTEGER REFERENCES appointments(id),
  sale_id INTEGER REFERENCES sales_orders(id),
  original_amount DOUBLE PRECISION NOT NULL CHECK (original_amount >= 0),
  discount_amount DOUBLE PRECISION NOT NULL CHECK (discount_amount >= 0),
  final_amount DOUBLE PRECISION NOT NULL CHECK (final_amount >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_coupon_usages_appointment_unique ON coupon_usages(coupon_id, appointment_id) WHERE appointment_id IS NOT NULL;

-- Checkout público: colunas aditivas e idempotentes. Mantêm pedidos legados
-- intactos e guardam o preço/cupom aceitos no momento da compra.
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS subtotal_value DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS discount_value DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS coupon_id INTEGER REFERENCES coupons(id);
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS coupon_code TEXT;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS coupon_snapshot JSONB;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS fulfillment_method TEXT NOT NULL DEFAULT 'pickup';
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS delivery_address TEXT;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS customer_email TEXT;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS customer_cpf TEXT;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS accepted_policies_at TIMESTAMP;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_orders_idempotency ON sales_orders(idempotency_key) WHERE idempotency_key IS NOT NULL;
ALTER TABLE inventory_reservations ADD COLUMN IF NOT EXISTS sales_order_id INTEGER REFERENCES sales_orders(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_inventory_reservations_order ON inventory_reservations(sales_order_id, status);

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
CREATE INDEX IF NOT EXISTS idx_catalog_promotions_active_dates ON catalog_promotions(is_active, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_catalog_sections_layout_order ON catalog_sections(layout_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_catalog_categories_public_order ON catalog_featured_categories(is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_product_visual_hashes_product ON product_visual_hashes(product_id, variation_id);
CREATE INDEX IF NOT EXISTS idx_catalog_promotions_rules ON catalog_promotions(status, priority DESC, start_date, end_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_promotion_usages_promotion ON promotion_usages(promotion_id, created_at);
CREATE INDEX IF NOT EXISTS idx_promotion_audit_promotion ON promotion_audit_logs(promotion_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_coupons_status_dates ON coupons(status, starts_at, ends_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_coupon_usages_coupon ON coupon_usages(coupon_id, created_at);
CREATE INDEX IF NOT EXISTS idx_coupon_usages_client ON coupon_usages(client_id, created_at);

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

-- Índices de apoio à paginação/ordenação das listagens. Sem eles, paginar
-- apenas troca "carregar tudo" por "varrer tudo e ordenar a cada página".
CREATE INDEX IF NOT EXISTS idx_sales_orders_created ON sales_orders(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_notification_queue_status_created ON notification_queue(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_digital_terms_signed ON digital_terms(signed_at DESC);
CREATE INDEX IF NOT EXISTS idx_post_care_followups_due ON post_care_followups(due_date, reminder_day);
CREATE INDEX IF NOT EXISTS idx_jewelry_category_name ON jewelry_inventory(category, name);
CREATE INDEX IF NOT EXISTS idx_appointments_status_date ON appointments(status, appointment_date);
CREATE INDEX IF NOT EXISTS idx_clients_created ON clients(created_at);

-- Segunda leva: ordenação/filtro das listagens que passaram a paginar agora.
-- A ordenação padrão de cada lista vem primeiro; os filtros comuns (status,
-- período, chave estrangeira) entram como prefixo ou coluna adicional.
CREATE INDEX IF NOT EXISTS idx_post_care_followups_status_due ON post_care_followups(status, due_date, reminder_day);
CREATE INDEX IF NOT EXISTS idx_post_care_followups_client ON post_care_followups(client_id);
CREATE INDEX IF NOT EXISTS idx_post_care_followups_appointment ON post_care_followups(appointment_id);
CREATE INDEX IF NOT EXISTS idx_digital_terms_client ON digital_terms(client_id);
CREATE INDEX IF NOT EXISTS idx_digital_terms_appointment ON digital_terms(appointment_id);
CREATE INDEX IF NOT EXISTS idx_notification_queue_created ON notification_queue(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_coupons_created ON coupons(created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_catalog_promotions_priority ON catalog_promotions(priority DESC, created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_financial_entries_competence_due ON financial_entries(competence_date, due_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_procedures_service_name ON procedures(service_id, name);
CREATE INDEX IF NOT EXISTS idx_procedures_name ON procedures(name);
CREATE INDEX IF NOT EXISTS idx_professionals_active_name ON professionals(active DESC, name);
CREATE INDEX IF NOT EXISTS idx_professional_services_service ON professional_services(service_id);
CREATE INDEX IF NOT EXISTS idx_services_active_name ON services(active_online_booking DESC, name);
CREATE INDEX IF NOT EXISTS idx_users_name ON users(name);
CREATE INDEX IF NOT EXISTS idx_schedule_blocks_start ON schedule_blocks(start_datetime DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_schedule_blocks_professional_start ON schedule_blocks(professional_id, start_datetime DESC);

-- ---------------------------------------------------------------------------
-- Integração com gateway de pagamento (Asaas): cofre de credenciais da clínica
-- e rastro dos ids do provedor. Cada clínica cobra o cliente final com a
-- PRÓPRIA conta Asaas — o dinheiro cai direto na conta dela, sem split nem
-- subconta.
-- ---------------------------------------------------------------------------

-- Cofre de credenciais por clínica. A chave da API NUNCA é gravada em claro:
-- `secret_encrypted` guarda AES-256-GCM (ver services/asaas/vault.js) e as
-- rotas devolvem apenas `secret_hint` (últimos 4 dígitos), nunca o segredo.
--
-- Tabela dedicada, e não `catalog_settings`: aquela vaza inteira na rota
-- pública GET /api/catalog. Uma credencial de pagamento não pode viver ao lado
-- de dado que é servido sem autenticação.
CREATE TABLE IF NOT EXISTS tenant_integrations (
  id SERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  environment TEXT NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox', 'production')),
  -- Chave da API (access_token) cifrada. Formato: v1:<iv>:<tag>:<ciphertext>.
  secret_encrypted TEXT,
  -- Dica para a interface confirmar QUAL chave está salva sem exibi-la.
  secret_hint TEXT,
  -- Token que a clínica cadastra no painel do Asaas e que volta no header
  -- `asaas-access-token` de cada webhook. Também cifrado: quem o lê consegue
  -- forjar "pagamento confirmado" para essa clínica.
  webhook_token_encrypted TEXT,
  enabled INTEGER NOT NULL DEFAULT 0,
  -- Diagnóstico do último handshake com o provedor (exibido na tela de ajustes).
  last_check_at TIMESTAMP,
  last_check_status TEXT,
  last_check_detail TEXT,
  updated_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider)
);

-- Identidade do cliente da clínica como pagador na conta Asaas DELA.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS asaas_customer_id TEXT;
-- O Asaas recusa criar cliente sem CPF/CNPJ; guardamos para não pedir de novo.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS tax_id TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS email TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_clients_asaas_customer
  ON clients (asaas_customer_id)
  WHERE asaas_customer_id IS NOT NULL;

-- payment_intents já existia com `external_id` genérico; o índice único abaixo
-- é o que torna o webhook idempotente de verdade (um payment.id <-> um intent).
ALTER TABLE payment_intents ADD COLUMN IF NOT EXISTS invoice_url TEXT;
ALTER TABLE payment_intents ADD COLUMN IF NOT EXISTS billing_type TEXT;
ALTER TABLE payment_intents ADD COLUMN IF NOT EXISTS due_date DATE;
ALTER TABLE payment_intents ADD COLUMN IF NOT EXISTS sales_order_id INTEGER;
ALTER TABLE payment_intents ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP;
-- O sinal do agendamento existia; a venda de joias no catálogo público não.
ALTER TABLE payment_intents ADD COLUMN IF NOT EXISTS description TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_intents_external
  ON payment_intents (provider, external_id)
  WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_intents_client ON payment_intents(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_intents_order ON payment_intents(sales_order_id) WHERE sales_order_id IS NOT NULL;

-- Contagem de agendamentos do mês corrente, usada pela cota `appointments_month`
-- (services/planLimits.js). Sem este índice a checagem faz seq scan na tabela
-- inteira — e ela roda a cada agendamento criado, que é o caminho mais quente
-- do sistema.
CREATE INDEX IF NOT EXISTS idx_appointments_created ON appointments(created_at);
