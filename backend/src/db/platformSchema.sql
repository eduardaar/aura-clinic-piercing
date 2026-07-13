-- Schema de controle da plataforma (multi-tenant).
-- Guarda o cadastro das clínicas (tenants) e os usuários do painel de
-- plataforma (super-admins). Cada clínica vive num schema próprio
-- ("tenant_<id>") criado no provisionamento. Idempotente.

CREATE SCHEMA IF NOT EXISTS platform;

-- Clínicas cadastradas na plataforma. O schema Postgres de cada uma é
-- derivado do id ("tenant_" || id) e nunca de input do usuário.
CREATE TABLE IF NOT EXISTS platform.tenants (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'suspenso')),
  plan TEXT NOT NULL DEFAULT 'padrao',
  store_short_name TEXT,
  responsible_name TEXT,
  phone TEXT,
  city TEXT,
  state TEXT,
  logo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform.subscription_plans (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL DEFAULT 0,
  audience TEXT,
  trial_days INTEGER NOT NULL DEFAULT 7,
  features JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_recommended BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform.tenant_subscriptions (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  plan_code TEXT NOT NULL REFERENCES platform.subscription_plans(code),
  status TEXT NOT NULL DEFAULT 'trial_active' CHECK (status IN ('trial_active', 'trial_expired', 'active', 'overdue', 'canceled', 'suspended')),
  trial_started_at TIMESTAMPTZ,
  trial_ends_at TIMESTAMPTZ,
  current_period_ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id)
);

-- Usuários do painel de plataforma (super-admins). Separados dos usuários
-- das clínicas: tokens de plataforma não acessam tenants e vice-versa.
CREATE TABLE IF NOT EXISTS platform.platform_users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'superadmin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE platform.tenants ADD COLUMN IF NOT EXISTS store_short_name TEXT;
ALTER TABLE platform.tenants ADD COLUMN IF NOT EXISTS responsible_name TEXT;
ALTER TABLE platform.tenants ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE platform.tenants ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE platform.tenants ADD COLUMN IF NOT EXISTS state TEXT;
ALTER TABLE platform.tenants ADD COLUMN IF NOT EXISTS logo_url TEXT;

INSERT INTO platform.subscription_plans (code, name, price_cents, audience, trial_days, features, is_recommended)
VALUES
  ('essencial', 'Pacote Essencial', 1990, 'Piercers iniciantes', 7, '["clients","agenda","procedures","manual_reminders","basic_inventory"]'::jsonb, false),
  ('start', 'Pacote Start', 3990, 'Piercers iniciantes ou autônomos', 7, '["clients","agenda","procedures","manual_reminders","basic_inventory","basic_catalog","whatsapp_link","basic_reports"]'::jsonb, false),
  ('profissional', 'Pacote Profissional', 6990, 'Estúdios que querem agendamento online e ficha digital', 7, '["clients","agenda","procedures","manual_reminders","basic_inventory","basic_catalog","whatsapp_link","basic_reports","online_booking","anamnesis","digital_terms","basic_finance","deposits","stock_alerts","automatic_followup","message_templates","public_catalog_customization"]'::jsonb, true),
  ('studio', 'Pacote Studio', 9990, 'Estúdios com equipe e venda de joias', 7, '["clients","agenda","procedures","manual_reminders","basic_inventory","basic_catalog","whatsapp_link","basic_reports","online_booking","anamnesis","digital_terms","basic_finance","deposits","stock_alerts","automatic_followup","message_templates","public_catalog_customization","multi_user","commissions","monthly_reports","coupons","returns","full_client_history","jewelry_sales_report"]'::jsonb, false),
  ('premium', 'Pacote Premium', 14990, 'Operações completas com catálogo avançado', 7, '["clients","agenda","procedures","manual_reminders","basic_inventory","basic_catalog","whatsapp_link","basic_reports","online_booking","anamnesis","digital_terms","basic_finance","deposits","stock_alerts","automatic_followup","message_templates","public_catalog_customization","multi_user","commissions","monthly_reports","coupons","returns","full_client_history","jewelry_sales_report","advanced_catalog","featured_products","promotional_banner","campaigns","advanced_finance","variation_inventory","alert_center","courses","priority_support"]'::jsonb, false)
ON CONFLICT (code) DO UPDATE SET
  name = excluded.name,
  price_cents = excluded.price_cents,
  audience = excluded.audience,
  trial_days = excluded.trial_days,
  features = excluded.features,
  is_recommended = excluded.is_recommended;
