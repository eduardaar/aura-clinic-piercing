# Modelo de dados

O PostgreSQL é multi-tenant por schema: `platform` concentra os dados da
Monitence, e cada clínica possui um schema `tenant_<id>`. O nome do schema vem
exclusivamente de `platform.tenants.id`; por isso as tabelas da clínica **não**
precisam de `tenant_id`.

As fontes de verdade são [platformSchema.sql](../backend/src/db/platformSchema.sql)
e [schema.sql](../backend/src/db/schema.sql). O backend aplica os dois schemas
de forma idempotente no boot.

## Convenções

- Chaves primárias usam `SERIAL`, exceto tabelas de configuração de linha única
  ou chave natural.
- Valores financeiros de clínica usam `NUMERIC(12,2)`; preços de planos e de
  créditos usam centavos inteiros (`*_cents`). Medidas físicas permanecem em
  `DOUBLE PRECISION`.
- Flags históricas usam `INTEGER` (`0`/`1`); novos fluxos também usam `BOOLEAN`
  e `JSONB` quando o dado é estruturalmente variável.
- Datas operacionais mais antigas ainda são `TEXT`; novos registros de
  plataforma usam `TIMESTAMPTZ`/`TIMESTAMP` quando o instante é relevante.

## Schema `platform`

| Grupo | Tabelas | Responsabilidade |
| --- | --- | --- |
| Clínicas e assinatura | `tenants`, `subscription_plans`, `tenant_subscriptions`, `tenant_invoices` | Cadastro da clínica, oferta comercial, ciclo de trial/assinatura e faturas da plataforma. |
| Administração | `platform_users`, `admin_audit`, `blocked_ips`, `idempotency_keys` | Super-admins, trilha de ações, proteção de login e deduplicação de operações financeiras. |
| Gateway | `webhook_events` | Registro idempotente de webhooks do Asaas, para plataforma e clínicas. |
| Landing e jurídico | `landing_sections`, `legal_documents`, `legal_acceptances` | Conteúdo público editável e versão aceita de Termos de Uso/Privacidade. |
| Suporte | `support_tickets`, `support_messages` | Chamados das clínicas, respostas e notas internas. |
| Operação | `product_migrations` | Registro de migrações/importações de produto administradas pela plataforma. |

Relações principais: cada linha de `tenant_subscriptions`, `tenant_invoices`,
`legal_acceptances`, `support_tickets` e `product_migrations` pertence a uma
linha de `tenants`. `support_messages` pertence a um chamado.

## Schema de clínica (`tenant_<id>`)

### Administração, arquivos e integrações

| Tabelas | Responsabilidade |
| --- | --- |
| `users` | Contas da clínica, papéis `admin`, `reception`, `finance` e `piercer`, e `session_version` para revogar tokens após troca de senha/papel. |
| `clinic_settings`, `catalog_theme` | Identidade e preferências da clínica e da vitrine. |
| `admin_audit_logs`, `administrative_audit_logs` | Auditoria de resets e exclusões administrativas. |
| `tenant_integrations` | Credenciais cifradas de integrações da clínica, como Asaas. |
| `private_files` | Metadados de arquivos privados; o objeto fica no R2 ou no fallback de disco. |
| `error_logs` | Erros de frontend e backend associados à clínica. |
| `privacy_audit_logs`, `data_subject_requests`, `privacy_retention_policies` | Metadados de acesso a dados pessoais, atendimento de solicitações de titulares e política explícita de retenção de logs. Não armazenam cópias de prontuários ou anexos. |

### Agenda, pessoas e atendimento

| Tabelas | Responsabilidade |
| --- | --- |
| `clients` | Cadastro, estado de anonimização/arquivamento e dados de contato. |
| `professionals`, `services`, `procedures`, `professional_services` | Equipe, serviços, procedimentos e a relação N:N entre profissional e serviço. |
| `professional_availability`, `schedule_blocks` | Regras semanais de disponibilidade e indisponibilidades pontuais. |
| `appointments`, `appointment_items`, `inventory_reservations` | Agendamento, vários itens por atendimento e reserva temporária de estoque. |
| `payments`, `payment_intents`, `payment_events`, `appointment_financial_audit` | Liquidações, cobranças online, token público não sequencial, eventos recebidos e auditoria financeira do atendimento. |
| `client_medical_records`, `digital_terms`, `post_care_followups` | Prontuário, consentimento assinado (incluindo assinatura separada do responsável por menor) e acompanhamento pós-atendimento. |
| `loyalty_points`, `loyalty_redemptions` | Crédito e resgate de pontos de fidelidade. |

`appointments` referencia cliente e profissional. Seus itens podem referenciar
serviços, procedimentos, produtos ou variações. Pagamentos, termos, prontuários
e follow-ups se ligam ao cliente e/ou ao agendamento conforme o fluxo.

### Estoque e catálogo de produtos

| Tabelas | Responsabilidade |
| --- | --- |
| `jewelry_inventory`, `jewelry_variants`, `product_images` | Produto pai, variações com estoque/preço e imagens por produto ou variação. |
| `stock_movements`, `inventory_reservations`, `inventory_audit_log` | Histórico de entrada/saída, reservas e trilha de ajustes. |
| `inventory_options`, `inventory_suggestions` | Categorias/atributos administráveis e sugestões de reposição. |
| `inventory_counts`, `inventory_count_items` | Inventário físico em rascunho e itens contados. |
| `product_visual_hashes` | Hashes perceptuais usados na busca visual. |

Uma variação pertence a `jewelry_inventory`; `sales_order_items`, itens de
agendamento, movimentos, contagens e reservas podem apontar para a variação.
O produto pai mantém os dados compartilhados e o resumo de estoque.

### Vendas e financeiro

| Tabelas | Responsabilidade |
| --- | --- |
| `sales_orders`, `sales_order_items` | Pedidos internos ou do checkout público e suas linhas. |
| `coupons`, `coupon_usages`, `catalog_promotions`, `promotion_usages`, `promotion_audit_logs` | Regras comerciais, aplicação e auditoria de cupons/promoções. |
| `expenses`, `expense_audit_logs` | Despesas e alterações relevantes. |
| `financial_cost_centers`, `financial_entries`, `financial_entry_audit` | Plano de contas, razão e trilha do lançamento. |
| `financial_goals`, `financial_reconciliations` | Metas e conciliação de extratos. |

Pedidos podem referenciar cliente e agendamento. Os itens podem apontar para
produto, variação ou serviço; cupons registram o snapshot aplicado para que o
histórico não dependa de uma regra que foi editada depois.

### Comunicações

| Tabelas | Responsabilidade |
| --- | --- |
| `notification_queue` | Fila de mensagens e lembretes. |
| `communication_templates`, `automation_rules`, `automation_runs` | Templates, regras de automação e execuções. |
| `communication_credit_wallets`, `communication_credit_ledger`, `communication_credit_reservations`, `communication_credit_purchase_intents` | Saldo, extrato, reserva e intenção de compra de créditos por canal. |

### Catálogo público e builder

| Tabelas | Responsabilidade |
| --- | --- |
| `catalog_settings`, `catalog_banners`, `catalog_featured_categories`, `catalog_featured_products` | Configurações e destaques mantidos para leitura e compatibilidade. |
| `catalog_layouts`, `catalog_sections`, `catalog_layout_history` | Layouts e seções estruturadas da vitrine. |
| `catalog_customization_drafts`, `catalog_customization_revisions` | Rascunho com lock otimista e revisões publicadas imutáveis. |
| `catalog_media_assets` | Biblioteca de mídia pública isolada por clínica. |
| `catalog_events` | Telemetria pública da vitrine. |

O builder grava no rascunho e só altera a vitrine após publicar uma revisão.
As tabelas `catalog_*` tradicionais continuam disponíveis para leitura de
instalações que ainda não têm snapshot v2. O contrato de publicação está em
[CATALOGO-BUILDER.md](./CATALOGO-BUILDER.md).

## Integridade e índices

O schema declara FKs nas relações centrais e índices para os caminhos de maior
uso, como cliente/agendamento, variação de joia, pagamentos, prontuário,
estoque e vencimento de despesas. Algumas colunas históricas de variação e
serviço são mantidas como inteiros sem FK formal; as rotas de estoque, vendas e
agenda validam seus vínculos antes de gravar.

Para mudanças de tipo, coluna ou índice, altere o SQL idempotente em vez de
criar migrations paralelas: o boot aplica `schema.sql` a todos os tenants antes
de aceitar tráfego.
