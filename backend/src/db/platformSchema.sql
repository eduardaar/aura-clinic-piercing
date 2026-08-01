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
-- Listar (ou não) a clínica no diretório público de catálogos (/catalogo sem ?t).
ALTER TABLE platform.tenants ADD COLUMN IF NOT EXISTS listed BOOLEAN NOT NULL DEFAULT true;

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

-- ---------------------------------------------------------------------------
-- Cobrança da assinatura das clínicas (Monitence -> clínica) via Asaas.
-- ---------------------------------------------------------------------------

-- Identidade da clínica como PAGADORA na conta Asaas da Monitence.
ALTER TABLE platform.tenants ADD COLUMN IF NOT EXISTS asaas_customer_id TEXT;
-- Dados fiscais do responsável: o Asaas recusa criar cliente sem CPF/CNPJ.
ALTER TABLE platform.tenants ADD COLUMN IF NOT EXISTS tax_id TEXT;
ALTER TABLE platform.tenants ADD COLUMN IF NOT EXISTS email TEXT;

-- Um customer do Asaas pertence a uma clínica só. Parcial porque a coluna é
-- nula enquanto a clínica não tiver passado pelo primeiro checkout.
CREATE UNIQUE INDEX IF NOT EXISTS ux_tenants_asaas_customer
  ON platform.tenants (asaas_customer_id)
  WHERE asaas_customer_id IS NOT NULL;

-- Assinatura recorrente no Asaas que espelha a linha de tenant_subscriptions.
ALTER TABLE platform.tenant_subscriptions ADD COLUMN IF NOT EXISTS asaas_subscription_id TEXT;
-- Como a clínica paga: UNDEFINED (link: PIX/boleto/cartão na página do Asaas)
-- ou CREDIT_CARD (débito automático mensal no cartão tokenizado).
ALTER TABLE platform.tenant_subscriptions ADD COLUMN IF NOT EXISTS billing_type TEXT;
ALTER TABLE platform.tenant_subscriptions ADD COLUMN IF NOT EXISTS canceled_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS ux_tenant_subscriptions_asaas
  ON platform.tenant_subscriptions (asaas_subscription_id)
  WHERE asaas_subscription_id IS NOT NULL;

-- Faturas mensais da assinatura. Uma linha por cobrança do Asaas; é o registro
-- que o webhook procura para marcar paga/atrasada.
CREATE TABLE IF NOT EXISTS platform.tenant_invoices (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  subscription_id INTEGER REFERENCES platform.tenant_subscriptions(id) ON DELETE SET NULL,
  -- id da cobrança no Asaas ("pay_..."). É a CHAVE da idempotência: o webhook
  -- só sabe casar o evento com a fatura por aqui.
  asaas_payment_id TEXT,
  asaas_subscription_id TEXT,
  plan_code TEXT,
  -- Reais, não centavos: o Asaas trabalha com decimal ("value": 149.90).
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'paga', 'atrasada', 'cancelada', 'estornada')),
  billing_type TEXT,
  due_date DATE,
  paid_at TIMESTAMPTZ,
  invoice_url TEXT,
  competencia DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- O alicerce da idempotência: um payment.id do Asaas <-> uma fatura.
CREATE UNIQUE INDEX IF NOT EXISTS ux_tenant_invoices_asaas_payment
  ON platform.tenant_invoices (asaas_payment_id)
  WHERE asaas_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_tenant_invoices_tenant ON platform.tenant_invoices (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_tenant_invoices_status ON platform.tenant_invoices (status, due_date);

-- Log de TODO webhook recebido (plataforma e clínicas), inclusive os
-- rejeitados. Serve a três coisas: idempotência, auditoria de tentativa de
-- fraude e diagnóstico quando "a cobrança não baixou".
--
-- Fica no schema `platform` mesmo para eventos de clínica: o webhook chega
-- ANTES de qualquer resolução de tenant, e é justamente por não confiar no
-- remetente que ele não pode escrever no schema da clínica antes de validado.
CREATE TABLE IF NOT EXISTS platform.webhook_events (
  id SERIAL PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'asaas',
  -- Escopo: 'platform' (assinatura das clínicas) ou 'tenant' (cliente final).
  scope TEXT NOT NULL DEFAULT 'platform',
  tenant_id INTEGER REFERENCES platform.tenants(id) ON DELETE SET NULL,
  -- `id` do evento no corpo ("evt_..."). O Asaas entrega AO MENOS uma vez:
  -- PAYMENT_CONFIRMED e PAYMENT_RECEIVED chegam para a mesma cobrança, e
  -- reentregas acontecem. Sem esta chave, uma fatura seria processada 2x.
  provider_event_id TEXT,
  event_type TEXT,
  asaas_payment_id TEXT,
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'processed', 'ignored', 'rejected', 'failed')),
  detail TEXT,
  payload JSONB,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

-- Um evento do provedor é processado uma vez só, por escopo. Índice único =
-- a garantia vale até sob entrega concorrente (dois POSTs simultâneos).
CREATE UNIQUE INDEX IF NOT EXISTS ux_webhook_events_provider_event
  ON platform.webhook_events (provider, scope, provider_event_id)
  WHERE provider_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_webhook_events_received ON platform.webhook_events (received_at DESC);
CREATE INDEX IF NOT EXISTS ix_webhook_events_payment ON platform.webhook_events (asaas_payment_id);

-- IPs banidos permanentemente do login de plataforma. O ban só sai daqui por
-- remoção manual, de propósito: é a válvula de escape consciente.
--   Desbloquear:  DELETE FROM platform.blocked_ips WHERE ip = '203.0.113.9';
--   Listar:       SELECT ip, strikes, blocked_at, reason FROM platform.blocked_ips ORDER BY blocked_at DESC;
CREATE TABLE IF NOT EXISTS platform.blocked_ips (
  ip TEXT PRIMARY KEY,
  reason TEXT,
  strikes INTEGER NOT NULL DEFAULT 0,
  user_agent TEXT,
  last_email TEXT,
  blocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Idempotência de requisições que movem dinheiro (Idempotency-Key).
-- ---------------------------------------------------------------------------
--
-- Substitui o mapa em memória do checkout de cartão, que era por processo: com
-- duas instâncias atrás do balanceador, as duas metades de um duplo-clique
-- caíam em processos diferentes e viravam duas assinaturas e duas cobranças.
--
-- NÃO guarda o corpo da requisição, e sim um SHA-256 dele. O corpo do checkout
-- carrega número de cartão e CVV: persisti-lo para comparar repetições
-- transformaria esta tabela num repositório de dados de cartão.
CREATE TABLE IF NOT EXISTS platform.idempotency_keys (
  id SERIAL PRIMARY KEY,
  -- Escopo por clínica: duas podem gerar o mesmo UUID por acaso, e uma jamais
  -- pode receber o resultado do checkout da outra.
  tenant_id INTEGER NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  -- Rota lógica ("billing.checkout"). A mesma chave em endpoints diferentes são
  -- requisições diferentes.
  endpoint TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  -- SHA-256 do corpo. Mesma chave com hash diferente = chave reusada para outra
  -- coisa, e a requisição é recusada com 409 em vez de cobrar errado.
  request_hash TEXT NOT NULL,
  -- 'in_progress' é a RESERVA, gravada antes de executar: é ela que faz a
  -- segunda requisição simultânea enxergar a primeira. Vira 'completed' com a
  -- resposta guardada; o caminho de erro APAGA a linha, porque cartão recusado
  -- precisa poder ser corrigido e reenviado com a mesma chave.
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
  -- Resposta devolvida na repetição. Só ids, status e URL de fatura — filtrada
  -- em services/idempotency.js contra qualquer campo com cara de cartão.
  response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  -- TTL de 24h, com limpeza preguiçosa na própria chamada (sem job novo).
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '24 hours'
);

-- O alicerce: é o índice único, e não um SELECT antes do INSERT, que garante
-- uma execução só sob concorrência real (duplo-clique em instâncias distintas).
CREATE UNIQUE INDEX IF NOT EXISTS ux_idempotency_keys_scope
  ON platform.idempotency_keys (tenant_id, endpoint, idempotency_key);
CREATE INDEX IF NOT EXISTS ix_idempotency_keys_expires
  ON platform.idempotency_keys (expires_at);
