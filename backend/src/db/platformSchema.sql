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
  session_version INTEGER NOT NULL DEFAULT 1,
  mfa_totp_secret_encrypted TEXT,
  mfa_enabled BOOLEAN NOT NULL DEFAULT false,
  role TEXT NOT NULL DEFAULT 'superadmin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE platform.platform_users ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE platform.platform_users ADD COLUMN IF NOT EXISTS mfa_totp_secret_encrypted TEXT;
ALTER TABLE platform.platform_users ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT false;

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
  ('start', 'Pacote Start', 4990, 'Para quem está organizando a operação solo', 7, '["clients","agenda","procedures","manual_reminders","basic_inventory","basic_catalog","whatsapp_link","basic_reports"]'::jsonb, false),
  ('profissional', 'Pacote Profissional', 8990, 'Para transformar atendimento em uma operação profissional', 7, '["clients","agenda","procedures","manual_reminders","basic_inventory","basic_catalog","whatsapp_link","basic_reports","online_booking","anamnesis","digital_terms","basic_finance","deposits","stock_alerts","automatic_followup","message_templates","public_catalog_customization"]'::jsonb, true),
  ('studio', 'Pacote Studio', 14990, 'Para estúdios com equipe, vendas e crescimento', 7, '["clients","agenda","procedures","manual_reminders","basic_inventory","basic_catalog","whatsapp_link","basic_reports","online_booking","anamnesis","digital_terms","basic_finance","deposits","stock_alerts","automatic_followup","message_templates","public_catalog_customization","multi_user","commissions","monthly_reports","coupons","returns","full_client_history","jewelry_sales_report","advanced_catalog","catalog_analytics","featured_products","promotional_banner","campaigns","advanced_finance","variation_inventory","visual_search","alert_center","courses","priority_support"]'::jsonb, false)
-- DO NOTHING, e não DO UPDATE.
--
-- Este INSERT é SEMENTE: popula os planos no primeiro boot e nunca mais toca
-- neles. Com DO UPDATE (como era antes), todo deploy reescreveria nome, preço e
-- features a partir daqui — desfazendo em silêncio tudo que o super-admin
-- tivesse editado no painel. Enquanto o código era a fonte da verdade isso era
-- inofensivo; agora seria destruição de dado a cada deploy.
ON CONFLICT (code) DO NOTHING;

-- O antigo plano de R$ 19,90 foi retirado do produto. Bases que já existiam
-- antes desta mudança ainda podem tê-lo gravado; removemos apenas quando ele
-- está completamente sem uso. Se houver cliente ou assinatura vinculada, não
-- trocamos preço, cobrança ou recursos em silêncio: a migração daquele cliente
-- deve ser uma decisão explícita da plataforma.
DELETE FROM platform.subscription_plans AS plan
 WHERE plan.code = 'essencial'
   AND NOT EXISTS (
     SELECT 1
       FROM platform.tenant_subscriptions AS subscription
      WHERE subscription.plan_code = plan.code
   )
   AND NOT EXISTS (
     SELECT 1
       FROM platform.tenants AS tenant
      WHERE tenant.plan = plan.code
   );

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
-- Como a clínica paga. A aplicação aceita somente UNDEFINED: PIX/boleto/cartão
-- são coletados na página hospedada do Asaas, nunca pela infraestrutura Aura.
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

-- ---------------------------------------------------------------------------
-- Conteúdo editável da landing (a página pública da plataforma, em "/").
-- ---------------------------------------------------------------------------
--
-- Fica no schema `platform`, e não em nenhum tenant: é a página de marketing da
-- Monitence, uma só para toda a plataforma. Quem edita é o super-admin.
--
-- Cada linha é um BLOCO da página. O tipo é fixo (`section_key`), porque o
-- layout de cada um é código React — o editor controla conteúdo, ordem e
-- ligado/desligado, não a estrutura. Isso é o que impede a página de ser
-- quebrada por engano a partir do painel.
--
-- `content` é JSONB porque cada bloco tem campos próprios (o hero tem título e
-- dois botões; o de recursos tem uma lista de cards). Uma coluna por campo
-- viraria uma tabela larga e cheia de NULL, e cada campo novo exigiria
-- migration.
CREATE TABLE IF NOT EXISTS platform.landing_sections (
  section_key TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by INTEGER REFERENCES platform.platform_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS ix_landing_sections_order ON platform.landing_sections (sort_order);

-- Documentos legais da plataforma. O conteúdo é texto simples para que o
-- painel seja seguro de editar: a página pública nunca interpreta HTML vindo
-- do banco. Cada edição relevante incrementa `version` no endpoint.
CREATE TABLE IF NOT EXISTS platform.legal_documents (
  document_key TEXT PRIMARY KEY CHECK (document_key IN ('terms_of_use', 'privacy_policy')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by INTEGER REFERENCES platform.platform_users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS platform.legal_acceptances (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL,
  document_key TEXT NOT NULL CHECK (document_key IN ('terms_of_use', 'privacy_policy')),
  document_version INTEGER NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address INET,
  user_agent TEXT,
  UNIQUE (tenant_id, user_email, document_key, document_version)
);

CREATE INDEX IF NOT EXISTS ix_legal_acceptances_tenant ON platform.legal_acceptances (tenant_id, accepted_at DESC);

INSERT INTO platform.legal_documents (document_key, title, content, version) VALUES
  ('terms_of_use', 'Termos de Uso', 'Estes Termos de Uso regulam o acesso e a utilização da plataforma Aura. Ao criar uma conta, você declara que leu e concorda com estas condições.\n\nA conta deve ser usada de forma lícita e com informações verdadeiras. Você é responsável por proteger suas credenciais e pelos dados inseridos por sua equipe.\n\nA Aura pode atualizar recursos, preços e estes termos mediante aviso pelos canais oficiais. O uso continuado após a publicação de uma nova versão representa a concordância com ela.', 1),
  ('privacy_policy', 'Política de Privacidade', 'A Aura trata os dados necessários para operar a plataforma, prestar suporte, processar cobranças e manter a segurança do serviço.\n\nOs dados dos clientes da sua clínica permanecem sob sua responsabilidade. A Aura atua como operadora quando processa esses dados para disponibilizar os recursos contratados.\n\nVocê pode solicitar informações sobre seus dados pelos canais oficiais. Mantemos medidas técnicas e organizacionais adequadas para proteger os dados contra acesso não autorizado.', 1)
ON CONFLICT (document_key) DO NOTHING;

-- Semente com EXATAMENTE o conteúdo que hoje está fixo no Landing.jsx.
--
-- `ON CONFLICT DO NOTHING` é o que torna isto seguro: a semente popula o banco
-- no primeiro boot e, a partir daí, nunca mais sobrescreve o que o super-admin
-- editou. Sem essa cláusula, todo deploy desfaria as edições dele.
--
INSERT INTO platform.landing_sections (section_key, enabled, sort_order, content) VALUES
  ('hero', true, 10, '{
    "kicker": "Para estúdios de piercing",
    "title": "Gestão premium para quem vive da perfuração.",
    "subtitle": "Agenda, catálogo de joias, ficha digital e financeiro — num sistema só.",
    "primary_label": "Criar minha clínica",
    "primary_href": "/cadastro",
    "secondary_label": "Já tenho conta",
    "secondary_href": "/login",
    "note": "7 dias grátis · sem cartão de crédito",
    "image": "/assets/landing/hero-studio.jpg",
    "image_alt": "Close de orelha com piercings de joias douradas no lóbulo",
    "caption": "Agenda, catálogo e ficha digital num link só seu"
  }'::jsonb),

  ('features', true, 20, '{
    "title": "Tudo que o estúdio precisa",
    "subtitle": "",
    "items": [
      {"title": "Agendamento online", "text": "Seus clientes marcam horário sozinhos por um link só seu.", "image": "/assets/landing/aura-portfolio/portfolio-01.jpeg", "image_alt": "Orelha com composição de piercings em joias prateadas"},
      {"title": "Catálogo de joias", "text": "Uma vitrine online da sua marca, pronta pra compartilhar.", "image": "/assets/landing/aura-portfolio/portfolio-02.jpeg", "image_alt": "Composição de piercing em orelha com joias"},
      {"title": "Ficha digital", "text": "Anamnese e termo de consentimento assinados sem papel.", "image": "/assets/landing/aura-portfolio/portfolio-03.jpeg", "image_alt": "Detalhe de piercing em orelha"},
      {"title": "Financeiro e estoque", "text": "Caixa, vendas e alertas de estoque baixo no mesmo lugar.", "image": "/assets/landing/aura-portfolio/portfolio-04.jpeg", "image_alt": "Joias de piercing em composição autoral"}
    ]
  }'::jsonb),

  ('carousel', false, 30, '{
    "title": "Piercing é identidade",
    "subtitle": "Resultados reais de quem transforma detalhes em expressão.",
    "autoplay_seconds": 6,
    "items": [
      {"image": "/assets/landing/aura-portfolio/portfolio-01.jpeg", "image_alt": "Orelha com composição de piercings em joias prateadas", "caption": ""},
      {"image": "/assets/landing/aura-portfolio/portfolio-02.jpeg", "image_alt": "Composição de piercing em orelha com joias", "caption": ""},
      {"image": "/assets/landing/aura-portfolio/portfolio-03.jpeg", "image_alt": "Detalhe de piercing em orelha", "caption": ""},
      {"image": "/assets/landing/aura-portfolio/portfolio-04.jpeg", "image_alt": "Joias de piercing em composição autoral", "caption": ""},
      {"image": "/assets/landing/aura-portfolio/portfolio-05.jpeg", "image_alt": "Detalhe de piercing com joias", "caption": ""},
      {"image": "/assets/landing/aura-portfolio/portfolio-06.jpeg", "image_alt": "Composição final de piercings", "caption": ""}
    ]
  }'::jsonb),

  ('plans', true, 40, '{
    "title": "Planos para cada fase",
    "subtitle": "Todos começam com 7 dias grátis. Troque quando quiser.",
    "cta_label": "Começar grátis",
    "cta_href": "/cadastro"
  }'::jsonb),

  ('about', true, 30, '{
    "kicker": "Sobre nós",
    "title": "Tecnologia feita para a rotina de quem atende.",
    "aura_title": "Aura Clinic",
    "aura_text": "A Aura Clinic é a plataforma de gestão criada para estúdios de piercing organizarem agenda, clientes, catálogo, estoque, financeiro e comunicação em um só lugar.",
    "monitence_title": "Monitence",
    "monitence_text": "A Monitence desenvolve produtos digitais que tornam operações de serviço mais simples, conectadas e preparadas para crescer."
  }'::jsonb),

  ('showcase_links', true, 50, '{
    "title": "Veja quem já usa",
    "subtitle": "Explore as vitrines públicas das clínicas na plataforma.",
    "items": [
      {"title": "Catálogo online", "text": "Veja as clínicas usando e abra a vitrine de joias de cada uma.", "href": "/catalogo"},
      {"title": "Agendamento online", "text": "Encontre um estúdio e marque horário direto na agenda dele.", "href": "/agendar"}
    ]
  }'::jsonb),

  ('closing', true, 60, '{
    "title": "Pronto para profissionalizar seu estúdio?",
    "primary_label": "Criar minha clínica",
    "primary_href": "/cadastro",
    "note": "7 dias grátis · sem cartão de crédito",
    "images": [
      {"image": "/assets/landing/aura-portfolio/eduarda.jpeg", "image_alt": "Eduarda, body piercer e criadora da Aura Clinic"}
    ],
    "footer_text": "Plataforma de gestão para estúdios de piercing.",
    "footer_link_label": "Entrar na minha conta",
    "footer_link_href": "/login"
  }'::jsonb)
ON CONFLICT (section_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Planos editáveis pelo painel: limites, ordem e ativação.
-- ---------------------------------------------------------------------------
--
-- `platform.subscription_plans` já existia como espelho do que estava fixo em
-- services/plans.js. A partir daqui o BANCO passa a ser a fonte da verdade, e o
-- código vira semente e rede de segurança (ver o comentário em plans.js).

-- Cotas do plano. `{}` = sem limite nenhum; chave ausente = aquele limite não
-- se aplica. JSONB porque o conjunto de limites vai mudar com o produto, e uma
-- coluna por limite exigiria migration a cada ideia nova.
ALTER TABLE platform.subscription_plans ADD COLUMN IF NOT EXISTS limits JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Limites iniciais do Catalog Builder. Só completa uma chave ausente: um valor
-- definido no painel pelo super-admin continua sendo a fonte da verdade.
-- Plano desativado some da vitrine e do cadastro, mas continua valendo para
-- quem já assina. É o "excluir" seguro: apagar de verdade um plano com
-- assinante quebraria a FK de tenant_subscriptions — e, pior, deixaria clínicas
-- pagantes sem plano.
ALTER TABLE platform.subscription_plans ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- Ordem de exibição na landing e no cadastro. Sem isto a ordem é o preço, e o
-- super-admin não consegue destacar um plano fora dessa sequência.
ALTER TABLE platform.subscription_plans ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

ALTER TABLE platform.subscription_plans ADD COLUMN IF NOT EXISTS badge TEXT;
ALTER TABLE platform.subscription_plans ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE platform.subscription_plans ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Ordem inicial derivada do preço, que é como a vitrine já os exibia.
UPDATE platform.subscription_plans SET sort_order = price_cents WHERE sort_order = 0;

CREATE INDEX IF NOT EXISTS ix_subscription_plans_ativo ON platform.subscription_plans (is_active, sort_order);

-- Trilha de auditoria das mudanças de plano e de conta.
--
-- Existe porque estas ações movem dinheiro e cortam acesso: trocar o plano de
-- uma clínica, suspender uma conta, alterar o preço de um plano com assinantes.
-- Quando alguém perguntar "por que esta clínica caiu para o plano básico?", a
-- resposta precisa estar registrada.
CREATE TABLE IF NOT EXISTS platform.admin_audit (
  id SERIAL PRIMARY KEY,
  actor_id INTEGER REFERENCES platform.platform_users(id) ON DELETE SET NULL,
  actor_email TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  detail JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_admin_audit_created ON platform.admin_audit (created_at DESC);
CREATE INDEX IF NOT EXISTS ix_admin_audit_target ON platform.admin_audit (target_type, target_id);

-- ---------------------------------------------------------------------------
-- Suporte: chamados entre as clínicas e a Monitence.
-- ---------------------------------------------------------------------------
--
-- Fica no schema `platform`, e não no schema de cada clínica, porque o chamado
-- CRUZA a fronteira: quem escreve é a clínica, quem responde é o super-admin.
-- Guardado dentro de `tenant_<id>`, a caixa de entrada do suporte teria de
-- varrer um schema por clínica a cada abertura de tela — e o super-admin, que
-- não pertence a tenant nenhum, não tem search_path para chegar lá.
CREATE TABLE IF NOT EXISTS platform.support_tickets (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,

  -- Autor DESNORMALIZADO de propósito: o usuário vive em `tenant_<id>.users` e
  -- o Postgres não aceita FK entre schemas por nome dinâmico. Copiar nome e
  -- e-mail no momento da abertura tem um efeito colateral desejável: o suporte
  -- continua sabendo quem abriu mesmo depois de a clínica desligar o usuário.
  opened_by_user_id INTEGER,
  opened_by_name TEXT NOT NULL DEFAULT '',
  opened_by_email TEXT,

  subject TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'duvida'
    CHECK (category IN ('duvida', 'problema', 'sugestao', 'financeiro', 'outro')),
  -- A prioridade é do SUPORTE, não da clínica: se a clínica escolhesse, tudo
  -- seria 'alta' e a fila perderia a serventia. Nasce 'normal' e só o painel de
  -- plataforma muda.
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('baixa', 'normal', 'alta')),
  status TEXT NOT NULL DEFAULT 'aberto'
    CHECK (status IN ('aberto', 'em_andamento', 'aguardando_cliente', 'resolvido', 'fechado')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,

  -- Instante da última mensagem de CADA LADO. É o que permite calcular "tem
  -- resposta não lida" nos dois sentidos sem varrer a tabela de mensagens:
  -- para a clínica, resposta nova é last_support_message_at > last_clinic_...;
  -- para o suporte, o contrário.
  last_clinic_message_at TIMESTAMPTZ,
  last_support_message_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS platform.support_messages (
  id SERIAL PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES platform.support_tickets(id) ON DELETE CASCADE,
  -- Lado que escreveu, não o id de quem escreveu: é o lado que decide a cor da
  -- bolha na tela e, sobretudo, quem pode ler a mensagem.
  author_side TEXT NOT NULL CHECK (author_side IN ('clinica', 'suporte')),
  author_name TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  -- Nota interna: rascunho do suporte sobre o caso, invisível para a clínica.
  -- O CHECK abaixo é a garantia no nível do banco de que ela só pode existir do
  -- lado do suporte — a rota da clínica nunca escreve 'suporte', então nenhum
  -- caminho da API consegue criar uma nota interna atribuída à clínica.
  internal_note BOOLEAN NOT NULL DEFAULT false CHECK (NOT internal_note OR author_side = 'suporte'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Os três acessos que existem: a lista da clínica (por tenant), a fila do
-- suporte (por status) e a conversa de um chamado (em ordem cronológica).
CREATE INDEX IF NOT EXISTS ix_support_tickets_tenant
  ON platform.support_tickets (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_support_tickets_status
  ON platform.support_tickets (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS ix_support_messages_ticket
  ON platform.support_messages (ticket_id, created_at);

-- Mudança comercial de agosto/2026: o produto passa a ter três planos. Ela é
-- registrada uma única vez para que futuras edições pelo painel continuem sendo
-- respeitadas e não sejam sobrescritas a cada reinicialização.
CREATE TABLE IF NOT EXISTS platform.product_migrations (
  key TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM platform.product_migrations WHERE key = 'three-commercial-plans-2026-08') THEN
    -- Premium vira Studio: mesmo preço final, mais nome Premium fora da oferta.
    -- Só o plano atual muda; faturas históricas permanecem como foram emitidas.
    UPDATE platform.tenant_subscriptions SET plan_code = 'studio', updated_at = now() WHERE plan_code = 'premium';
    UPDATE platform.tenants SET plan = 'studio' WHERE plan = 'premium';
    DELETE FROM platform.subscription_plans WHERE code = 'premium';

    UPDATE platform.subscription_plans
       SET name = 'Pacote Start',
           price_cents = 4990,
           audience = 'Para quem está organizando a operação solo',
           description = 'Agenda, clientes, estoque e catálogo para começar com controle.',
           features = '["clients","agenda","procedures","manual_reminders","basic_inventory","basic_catalog","whatsapp_link","basic_reports"]'::jsonb,
           limits = '{"users":1,"clients":300,"appointments_month":100,"jewelry_items":100,"storage_mb":1024,"catalog_plugins":0}'::jsonb,
           is_recommended = false,
           badge = '',
           is_active = true,
           sort_order = 10,
           updated_at = now()
     WHERE code = 'start';

    UPDATE platform.subscription_plans
       SET name = 'Pacote Profissional',
           price_cents = 8990,
           audience = 'Para transformar atendimento em uma operação profissional',
           description = 'Agendamento online, financeiro, documentos digitais e catálogo personalizado.',
           features = '["clients","agenda","procedures","manual_reminders","basic_inventory","basic_catalog","whatsapp_link","basic_reports","online_booking","anamnesis","digital_terms","basic_finance","deposits","stock_alerts","automatic_followup","message_templates","public_catalog_customization"]'::jsonb,
           limits = '{"users":3,"jewelry_items":500,"storage_mb":5120,"catalog_plugins":3}'::jsonb,
           is_recommended = true,
           badge = 'Mais recomendado',
           is_active = true,
           sort_order = 20,
           updated_at = now()
     WHERE code = 'profissional';

    UPDATE platform.subscription_plans
       SET name = 'Pacote Studio',
           price_cents = 14990,
           audience = 'Para estúdios com equipe, vendas e crescimento',
           description = 'Automação, campanhas, catálogo avançado, Analytics e gestão completa da equipe.',
           features = '["clients","agenda","procedures","manual_reminders","basic_inventory","basic_catalog","whatsapp_link","basic_reports","online_booking","anamnesis","digital_terms","basic_finance","deposits","stock_alerts","automatic_followup","message_templates","public_catalog_customization","multi_user","commissions","monthly_reports","coupons","returns","full_client_history","jewelry_sales_report","advanced_catalog","catalog_analytics","featured_products","promotional_banner","campaigns","advanced_finance","variation_inventory","visual_search","alert_center","courses","priority_support"]'::jsonb,
           limits = '{"users":10,"storage_mb":20480,"catalog_plugins":12}'::jsonb,
           is_recommended = false,
           badge = '',
           is_active = true,
           sort_order = 30,
           updated_at = now()
     WHERE code = 'studio';

    INSERT INTO platform.product_migrations (key) VALUES ('three-commercial-plans-2026-08');
  END IF;
END $$;

-- Recebimentos por período: "recebido no mês", a série mensal e a receita por
-- plano (services/platformFinance.js) filtram por faixa de `paid_at`, e não
-- havia índice nenhum nessa coluna. Parcial porque só fatura PAGA tem `paid_at`
-- preenchido — o índice fica pequeno e cabe em memória.
CREATE INDEX IF NOT EXISTS ix_tenant_invoices_paid_at
  ON platform.tenant_invoices (paid_at)
  WHERE status = 'paga';
