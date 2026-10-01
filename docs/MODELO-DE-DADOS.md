# Modelo de dados

O PostgreSQL é multi-tenant por schema: `platform` concentra os dados da
Monitence, e cada clínica possui um schema `tenant_<slug>` (o slug com `_` no
lugar de `-`, ex.: `tenant_aura_clinic`). O nome é calculado uma única vez no
provisionamento e gravado em `platform.tenants.schema_name` — o código sempre lê
essa coluna, nunca recalcula. Por isso as tabelas da clínica **não** precisam de
`tenant_id`.

> As **chaves do object storage** seguem outra convenção, de propósito:
> `tenant_<id>` com o id inteiro (ver `services/storage/keys.js`). Um caminho de
> arquivo não pode depender de algo que a clínica possa vir a trocar.

As fontes de verdade são [platformSchema.sql](../backend/src/db/platformSchema.sql),
[schema.sql](../backend/src/db/schema.sql) e as migrations versionadas em
[`backend/src/db/migrations/`](../backend/src/db/migrations/) (`platform/` e
`tenant/`). Várias tabelas recentes existem **só** nas migrations. Clínica nova
recebe o `schema.sql` e, logo em seguida, todas as migrations de tenant
durante o provisionamento (`services/tenants.js`); se algo falhar, o schema é
apagado. No boot, os dois schemas idempotentes só são reaplicados quando o
bootstrap de banco não está desligado — em produção, só com
`ALLOW_LEGACY_GLOBAL_BOOTSTRAP=true` (`db/migrationPolicy.js`); as migrations
rodam pelo CLI `backend/scripts/migrations.mjs`.

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
| Clínicas e assinatura | `tenants`, `subscription_plans`, `tenant_subscriptions`, `tenant_invoices` | Cadastro da clínica, oferta comercial, ciclo de trial/assinatura e faturas da plataforma. `tenants.signup_admin_email` tem índice único sobre `lower()` e impede o mesmo e-mail de abrir outra clínica pelo cadastro público. |
| Administração | `platform_users`, `admin_audit`, `blocked_ips`, `idempotency_keys` | Super-admins (com MFA TOTP opcional, segredo cifrado), trilha de ações, proteção de login e deduplicação de operações financeiras. |
| E-mail | `smtp_settings` | Configuração SMTP global. A senha é cifrada com AES-256-GCM antes de chegar ao banco e nunca volta pela API. |
| Gateway | `webhook_events` | Registro idempotente de webhooks do Asaas, para plataforma e clínicas. |
| Landing e jurídico | `landing_sections`, `legal_documents`, `legal_document_versions`, `legal_acceptances` | Conteúdo público editável, versão vigente de Termos de Uso/Privacidade, histórico imutável de cada versão publicada (para provar qual texto valia em cada aceite) e versão aceita no cadastro. |
| Notícias e manual | `content_articles` | Notícias (`news`) e capítulos do manual (`manual`) em texto simples, com status `draft`, `published` ou `archived`. |
| Suporte | `support_tickets`, `support_messages` | Chamados das clínicas, respostas e notas internas. |
| Cobrança | `billing_notifications` | Avisos de cobrança já enviados, para não repetir a mesma notificação. |
| Operação | `product_migrations`, `schema_migrations` | Marcadores de blocos de execução única do `platformSchema.sql` (`key`, `applied_at`) e o **ledger das migrations versionadas**: uma linha por versão aplicada, com escopo (`platform` ou `tenant`), schema alvo e checksum. É o que impede reaplicar ou editar uma migration já aplicada. |

Relações principais: cada linha de `tenant_subscriptions`, `tenant_invoices`,
`legal_acceptances` e `support_tickets` pertence a uma linha de `tenants`.
`support_messages` pertence a um chamado e `legal_document_versions`, a um
documento legal.

## Schema de clínica (`tenant_<slug>`)

### Administração, arquivos e integrações

| Tabelas | Responsabilidade |
| --- | --- |
| `users` | Contas da clínica, papéis `admin`, `reception`, `finance` e `piercer`, `status` (`active`/`inactive`; inativo não autentica), perfil de acesso e profissional vinculados, MFA TOTP opcional e `session_version` para revogar tokens após troca de senha/papel. |
| `user_permissions` | Overrides de permissão por usuário sobre o papel ou o perfil: `allowed = true` concede, `false` revoga. A revogação vence a concessão (`services/permissionService.js`). |
| `access_profiles`, `access_profile_permissions` | Perfis de acesso reutilizáveis (`base_role` `piercer`, `reception` ou `finance`). Perfil ativo substitui as permissões padrão do papel do usuário. |
| `audit_events` | Trilha central de auditoria: ator, módulo, ação, entidade, motivo, `before_data`/`after_data`/`metadata` (JSONB, com chaves sensíveis mascaradas), severidade `info`/`warning`/`critical`, IP e user agent. |
| `password_reset_tokens` | Recuperação de senha: hash do token de uso único, validade, uso e IP de quem pediu. |
| `user_sessions` | Uma linha por sessão ativa: hash do refresh token, expiração e revogação. É o que torna a sessão revogável de verdade — logout, "encerrar todas" e troca de senha atuam aqui. |
| `background_jobs` | Fila persistente de execução assíncrona consumida pelo `jobWorker`. |
| `clinic_settings`, `catalog_theme` | Identidade e preferências da clínica e da vitrine. |
| `administrative_audit_logs` | Auditoria de exclusões administrativas (hoje, a exclusão de cliente). A antiga `admin_audit_logs`, sem escritor, saiu do `schema.sql`. |
| `tenant_integrations` | Credenciais cifradas de integrações da clínica (Asaas e WhatsApp Cloud API); identificadores não secretos ficam em `settings` (JSONB). |
| `private_files` | Metadados de arquivos privados; o objeto fica no R2 ou no fallback de disco. |
| `error_logs` | Erros de frontend e backend associados à clínica. |
| `privacy_audit_logs`, `data_subject_requests`, `privacy_retention_policies` | Metadados de acesso a dados pessoais, atendimento de solicitações de titulares e política explícita de retenção de logs. Não armazenam cópias de prontuários ou anexos. |

### Agenda, pessoas e atendimento

| Tabelas | Responsabilidade |
| --- | --- |
| `clients` | Cadastro, estado de anonimização/arquivamento, dados de contato e endereço, nome social, canal preferido, origem e indicação, tags, `lifecycle_status`, consentimentos, contato de emergência, responsável legal e o rastro de mesclagem (`merged_into_client_id`, `merged_at`, `merged_by_user_id`, `merge_reason`). |
| `professionals`, `services`, `procedures`, `professional_services` | Equipe, cadastro único de tipos de atendimento (`services`, com categoria, área do corpo e regras opcionais: idade mínima, responsável, termo assinado, antecedência, intervalo, retorno e pós-atendimento), procedimentos antigos mantidos só para leitura do histórico e a relação N:N entre profissional e serviço. |
| `service_compatible_inventory_items`, `service_operational_settings` | Itens de estoque marcados como compatíveis com o serviço e configuração única da clínica para checklist e biossegurança (opt-in). |
| `professional_availability`, `schedule_blocks` | Regras semanais de disponibilidade e indisponibilidades pontuais. |
| `appointments`, `appointment_items`, `inventory_reservations` | Agendamento, vários itens por atendimento e reserva temporária de estoque. O agendamento guarda os horários de chegada, início e ausência (`arrived_at`, `started_at`, `no_show_at`) e snapshots das regras do serviço e dos requisitos operacionais. |
| `appointment_reschedule_history` | Data e horário anteriores e novos, motivo e autor de cada reagendamento. |
| `appointment_waitlist`, `agenda_resources` | Lista de espera (cliente ou contato avulso, período preferido, prioridade 0–5, status) e cadastro de salas, cadeiras, estações e equipamentos. Nenhuma coluna liga um recurso a um agendamento. |
| `service_executions`, `service_execution_items`, `service_execution_operational_revisions` | Fechamento do atendimento concluído, 1:1 com o agendamento e separado das vendas: snapshot, subtotais, pago, a receber, parcelas, notas clínicas, checklist e biossegurança, com as revisões desses dois registros. |
| `payments`, `payment_intents`, `payment_events`, `payment_operations`, `appointment_financial_audit` | Liquidações, cobranças online, token público não sequencial, eventos recebidos, operações do gateway e auditoria financeira do atendimento. |
| `appointment_cancellations` | Cancelamento auditável do atendimento: motivo e a resolução financeira escolhida (`no_payment`, `retain_deposit`, `client_credit`, `manual_refund`). O `PATCH` direto para `status = cancelado` é bloqueado justamente para forçar o registro aqui. |
| `appointment_consumptions` | Consumo de itens de estoque (`inventory_item_id`) congelado no momento da conclusão do atendimento. Guarda o que foi realmente baixado, não a receita atual — é o que permite estornar exatamente a mesma quantidade ao reabrir ou cancelar. |
| `client_credits`, `client_credit_usages` | Crédito rastreável do cliente (origem: sinal retido ou devolução) e cada uso dele, para que o saldo nunca seja um número solto em observação. |
| `client_medical_records`, `digital_terms`, `post_care_followups` | Prontuário, consentimento assinado (incluindo assinatura separada do responsável por menor) e acompanhamento pós-atendimento. O termo guarda modelo, canal (`staff`, `in_studio`, `remote`), texto aceito, IP, user agent e `content_hash`; o gatilho `trg_digital_terms_immutable` impede alterar o que foi assinado. |
| `term_templates`, `term_requests` | Modelos de termo da clínica (`consent`, `authorization`, `procedure`, `other`) e solicitações de assinatura por link, que guardam só o hash do token, canal, status e validade. |
| `loyalty_points`, `loyalty_redemptions` | Crédito e resgate de pontos de fidelidade. |

`appointments` referencia cliente e profissional. Seus itens podem referenciar
serviços, procedimentos, produtos ou variações. Pagamentos, termos, prontuários
e follow-ups se ligam ao cliente e/ou ao agendamento conforme o fluxo; a
execução do serviço se liga ao agendamento e `payments.service_execution_id`,
à execução.

### Estoque e catálogo de produtos

| Tabelas | Responsabilidade |
| --- | --- |
| `jewelry_inventory`, `jewelry_variants`, `product_images` | Item de estoque (produto pai), variações com estoque/preço e imagens por produto ou variação. Desde a migration tenant 0025, produtos para venda e materiais de procedimento são itens da mesma tabela, diferenciados por `can_sell`, `can_use_in_service`, `track_stock`, `track_lots` e `can_publish`, com unidades de estoque/compra/consumo, fator de conversão da compra e fornecedor (`supplier_id`). `gtin` e `supplier_item_code` servem à importação de NF-e. |
| `stock_movements`, `inventory_reservations`, `inventory_audit_log` | Histórico de entrada/saída, reservas e trilha de ajustes. |
| `inventory_options`, `inventory_suggestions` | Categorias/atributos administráveis e sugestões de reposição. |
| `inventory_counts`, `inventory_count_items` | Inventário físico em rascunho e itens contados. |
| `product_visual_hashes` | Hashes perceptuais usados na busca visual. |

Uma variação pertence a `jewelry_inventory`; `sales_order_items`, itens de
agendamento, movimentos, contagens e reservas podem apontar para a variação.
O produto pai mantém os dados compartilhados e o resumo de estoque.

### Lotes e ficha técnica

Materiais operacionais (luva, agulha, gaze, antisséptico) são itens de
`jewelry_inventory` com `can_use_in_service` ligado. Um item só entra em
Vendas com `can_sell` e só aparece no catálogo público com `can_publish` (além
das marcas de publicação do catálogo).

| Tabela | Papel |
| --- | --- |
| `inventory_item_lots` | Lotes do item (código, validade, quantidade recebida e restante, custo), opcionalmente ligados à variação e ao item de compra. A soma dos lotes nunca pode exceder o saldo do item — invariante validada com lock na escrita. |
| `inventory_item_lot_allocations` | Qual lote saiu em cada consumo de atendimento. A baixa segue FEFO: vence primeiro, sai primeiro. Na conclusão do atendimento, item com `track_lots` precisa de lotes suficientes (senão a conclusão é recusada); na movimentação manual, o que faltar em lote sai do saldo sem lote. |
| `service_inventory_recipes` | A ficha técnica: item de estoque e quantidade por serviço. É o que faz concluir um atendimento baixar material sozinho. |

As tabelas `consumables`, `consumable_stock_movements`, `consumable_lots`,
`consumable_lot_allocations` e `service_consumable_recipes` foram removidas pela
migration tenant 0025, que também tirou `purchase_order_items.consumable_id`.
O `schema.sql` ainda declara o bloco legado de `consumables`,
`consumable_stock_movements` e a coluna `purchase_order_items.consumable_id`;
nenhuma rota os usa.

### Vendas e financeiro

| Tabelas | Responsabilidade |
| --- | --- |
| `sales_orders`, `sales_order_items` | Pedidos internos ou do checkout público e suas linhas. `installments_json` preserva o cronograma editável enquanto a venda está aberta; ao concluir, ele é materializado no razão. |
| `purchase_orders`, `purchase_order_items`, `suppliers` | Compras, itens recebidos e fornecedores PF/PJ. `installments_json` preserva o cronograma no rascunho; a confirmação é a origem da entrada de estoque e das parcelas a pagar. O total da compra é `products_value + freight_value − discount_value`. O fornecedor guarda cadastro completo, condições comerciais e `quality_status` (`approved`, `review`, `blocked`); fornecedor bloqueado não entra em compra. |
| `purchase_fiscal_documents` | NF-e importada na compra: chave de acesso (44 dígitos) e `xml_hash` únicos, número, série, protocolo, status de autorização, emitente e XML original. |
| `coupons`, `coupon_usages`, `catalog_promotions`, `promotion_usages`, `promotion_audit_logs` | Regras comerciais, aplicação e auditoria de cupons/promoções. |
| `expenses`, `expense_audit_logs` | Despesas e alterações relevantes. Reembolso manual de agenda ou de venda vira uma despesa paga aqui, rastreável até a origem. |
| `sales_returns`, `sales_return_items` | Devolução de venda por item, com `return_to_stock` e `condition`. Só item `sellable` volta ao estoque; danificado ou descartado fica registrado sem voltar a ficar disponível. A API impede devolver mais do que foi vendido e preserva as devoluções anteriores. |
| `financial_categories`, `financial_cost_centers`, `financial_entries`, `financial_entry_audit` | Categorias, centros de custo, razão de contas a pagar/receber (com `supplier_id` opcional) e trilha do lançamento. |
| `financial_goals`, `financial_reconciliations` | Metas e conciliação de extratos. Continuam no `schema.sql`, mas não têm rota desde a remoção do Financeiro 2.0. |

Pedidos podem referenciar cliente e agendamento. Os itens podem apontar para
produto, variação ou serviço; cupons registram o snapshot aplicado para que o
histórico não dependa de uma regra que foi editada depois.

`financial_entries.source_type/source_id/source_key` liga cada título à sua
origem e garante idempotência. Compras confirmadas usam `purchase_order` para
as contas a pagar; vendas usam `sales_order` e atendimentos concluídos usam
`service_execution` para contas a receber. `payments` se liga à venda
(`sales_order_id`) ou à execução do serviço (`service_execution_id`). `stock_movements` guarda também os ids do item de compra ou venda que
originou a movimentação, impedindo uma segunda baixa/entrada por reenvio.

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

Mudanças de tipo, coluna ou índice entram primeiro nas migrations versionadas
de `backend/src/db/migrations/tenant/`. O estado de referência de uma clínica
é o `schema.sql` seguido de todas as migrations de tenant, na ordem — é o que
`provisionTenant()` aplica a uma clínica nova —, enquanto o ledger de
migrations atualiza instalações existentes de forma ordenada e verificável. O
`schema.sql` é legado e incompleto: nem toda migration está espelhada nele
(por exemplo `term_templates`, `appointment_waitlist`, `password_reset_tokens`
e `inventory_item_lots` só existem nas migrations), e ele ainda declara o
bloco de `consumables` que a 0025 apaga. Não há versões tenant `0026`
e `0027` no repositório: a numeração pula de `0025` para `0028`.
