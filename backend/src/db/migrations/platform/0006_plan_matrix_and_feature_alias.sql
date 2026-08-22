-- Consolida a matriz comercial vigente e remove recursos que deixaram de ser
-- ofertados. Esta migration é apenas a fonte versionada; sua execução pertence
-- ao fluxo normal de deploy/migrations.

-- Anamnese e termos passaram a ser uma única feature. Planos personalizados
-- antigos continuam com acesso, agora pela chave canônica `digital_terms`.
UPDATE platform.subscription_plans
   SET features = (COALESCE(features, '[]'::jsonb) - 'anamnese' - 'anamnesis') ||
       CASE WHEN COALESCE(features, '[]'::jsonb) ? 'digital_terms'
            THEN '[]'::jsonb ELSE '["digital_terms"]'::jsonb END,
       updated_at = now()
 WHERE COALESCE(features, '[]'::jsonb) ?| ARRAY['anamnese', 'anamnesis'];

-- Chaves aposentadas não podem reaparecer no painel nem conceder acesso por
-- acidente. Preserva somente o catálogo comercial atual em planos customizados.
UPDATE platform.subscription_plans AS plan
   SET features = COALESCE((
         SELECT jsonb_agg(item.value ORDER BY item.ordinality)
           FROM jsonb_array_elements_text(COALESCE(plan.features, '[]'::jsonb))
                WITH ORDINALITY AS item(value, ordinality)
          WHERE item.value IN (
            'clients', 'agenda', 'procedures', 'basic_inventory', 'basic_catalog',
            'whatsapp_link', 'basic_reports', 'online_booking', 'digital_terms',
            'basic_finance', 'deposits', 'automatic_followup', 'message_templates',
            'public_catalog_customization', 'commissions', 'coupons', 'campaigns',
            'catalog_analytics', 'visual_search'
          )
       ), '[]'::jsonb),
       updated_at = now();

UPDATE platform.subscription_plans
   SET name = 'Start',
       price_cents = 3990,
       audience = 'Para quem está organizando a operação solo',
       description = 'Agenda, clientes, vendas à vista, estoque, catálogo e relatórios essenciais.',
       trial_days = 7,
       features = '["clients","agenda","procedures","basic_inventory","basic_catalog","whatsapp_link","basic_reports"]'::jsonb,
       limits = '{"users":1,"clients":300,"appointments_month":100,"jewelry_items":100,"storage_mb":1024,"catalog_plugins":0}'::jsonb,
       is_recommended = false,
       badge = '',
       is_active = true,
       sort_order = 10,
       updated_at = now()
 WHERE code = 'start';

UPDATE platform.subscription_plans
   SET name = 'Profissional',
       price_cents = 6990,
       audience = 'Para transformar atendimento em uma operação profissional',
       description = 'Compras, contas a pagar e receber, parcelas, sinais, agendamento online e catálogo personalizado.',
       trial_days = 7,
       features = '["clients","agenda","procedures","basic_inventory","basic_catalog","whatsapp_link","basic_reports","online_booking","digital_terms","basic_finance","deposits","automatic_followup","message_templates","public_catalog_customization"]'::jsonb,
       limits = '{"users":3,"jewelry_items":500,"storage_mb":5120,"catalog_plugins":3}'::jsonb,
       is_recommended = true,
       badge = 'Melhor custo-benefício',
       is_active = true,
       sort_order = 20,
       updated_at = now()
 WHERE code = 'profissional';

UPDATE platform.subscription_plans
   SET name = 'Studio',
       price_cents = 11990,
       audience = 'Para estúdios com equipe, vendas e crescimento',
       description = 'Comissões, campanhas, cupons, Analytics e busca visual para crescer com controle.',
       trial_days = 7,
       features = '["clients","agenda","procedures","basic_inventory","basic_catalog","whatsapp_link","basic_reports","online_booking","digital_terms","basic_finance","deposits","automatic_followup","message_templates","public_catalog_customization","commissions","coupons","campaigns","catalog_analytics","visual_search"]'::jsonb,
       limits = '{"users":10,"storage_mb":20480,"catalog_plugins":12}'::jsonb,
       is_recommended = false,
       badge = '',
       is_active = true,
       sort_order = 30,
       updated_at = now()
 WHERE code = 'studio';
