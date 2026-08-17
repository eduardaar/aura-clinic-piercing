# Auditoria RBAC — etapa 2

Data da revisão: 2026-08-14. Nenhuma migration foi aplicada e nenhum dado foi alterado.

## Inventário anterior à migração

Foram encontradas **146 chamadas `requireRole`** em rotas e decisões diretas adicionais em agenda, clientes, jobs e uploads. A matriz abaixo registra método, rota, papel anterior, ação e permissão recomendada. Rotas na mesma linha possuem exatamente a mesma decisão semântica.

| Arquivo | Método e rota | Papel anterior | Ação | Permissão recomendada | Resultado |
|---|---|---|---|---|---|
| `finance.js` | `GET /finance`, `GET /finance/ledger`, `GET /finance/entries/:id/details`, `GET /finance/cost-centers`, `GET /finance/goals` | admin, finance | consulta financeira | `finance.view` | migrada |
| `finance.js` | `POST /finance/entries`, `POST /finance/recurrences/process` | admin, finance | criar lançamento | `finance.create` | migrada |
| `finance.js` | `PATCH /finance/entries/:id`, `POST /finance/cost-centers`, `POST /finance/entries/:id/reconcile`, `POST /finance/goals` | admin, finance | alterar/consolidar financeiro | `finance.edit` | migrada |
| `finance.js` | `POST /expenses`, `PATCH /expenses/:id` | admin, finance | administrar despesas | `finance.expenses` | migrada |
| `finance.js` | `DELETE /expenses/:id` | admin, finance | cancelar despesa | `finance.cancel` | migrada |
| `finance.js` | `POST /finance/entries/:id/lifecycle`, `POST /finance/entries/bulk-lifecycle` | admin, finance | testar/cancelar/restaurar | `finance.mark_test` ou `finance.cancel`, conforme ação | migrada |
| `finance.js` | `GET /finance/export.csv`, `.pdf`, `.xlsx` | admin, finance | exportar relatório financeiro | `reports.view_financial` | migrada |
| `payments.js` | `GET /payment-intents` | admin, finance, reception | consultar cobranças | `cash.view` | migrada |
| `payments.js` | `PATCH /payment-intents/:id/status`, `POST /payment-intents/:id/public-token` | admin, finance | alterar cobrança | `finance.edit` | migrada |
| `payments.js` | `POST /payment-intents/:id/cancel` | admin, finance | cancelar cobrança | `finance.cancel` | migrada |
| `payments.js` | `POST /payment-intents/:id/refund` | admin, finance | estornar | `finance.refund` | migrada |
| `terms.js` | `GET /digital-terms`, `POST /digital-terms` | admin, piercer | ler/gravar documento clínico completo | `clinical_files.view`, `clinical_files.edit` | migrada |
| `postcare.js` | `GET /post-care`, `PATCH /post-care/:id` | admin, piercer | ler/alterar acompanhamento clínico | `clinical_files.view`, `clinical_files.edit` | migrada |
| `notifications.js` | `GET /communication-credits`, `GET /notifications`, `GET /communication-templates`, `GET /automation-rules` | admin, reception | consultar comunicação | `communication.view` | migrada |
| `notifications.js` | `POST /automations/process` | admin, reception | disparar comunicação | `communication.send` | migrada |
| `catalog.js` | `GET /coupons`, `POST /coupons`, `PATCH /coupons/:id`, `DELETE /coupons/:id` | admin/reception ou admin | consultar/criar/editar/excluir cupom | `coupons.view/create/edit/delete` | migrada |
| `jewelry.js` | `GET /inventory/intelligence`, `GET /inventory/suggestions`, `GET /inventory/counts`, `GET /inventory/counts/:id`, `GET /inventory/labels`, `POST /jewelry/visual-search`, `GET /jewelry/:id/movements` | admin, reception ou sem guarda específica | consultar estoque | `inventory.view` | migrada |
| `jewelry.js` | `POST /jewelry` | admin, reception | cadastrar produto | `inventory.create` | migrada |
| `jewelry.js` | `PATCH /jewelry/:id` | admin, reception | alterar produto | `inventory.edit` | migrada |
| `jewelry.js` | sugestões, contagens e movimentações de estoque (8 ações) | admin/reception ou admin | ajustar estoque | `inventory.adjust` | migrada |
| `jewelry.js` | `DELETE /jewelry/:id` | admin | excluir/arquivar produto | `inventory.delete` | migrada |
| `availability.js` | `GET /availability` | qualquer autenticado | consultar disponibilidade | `appointments.view` | migrada |
| `availability.js` | `POST /availability`, `POST /availability/generate-weekly`, `PATCH /availability/:id` | admin, reception | configurar disponibilidade | `appointments.edit` | migrada |
| `scheduleBlocks.js` | `GET /schedule-blocks` | qualquer autenticado | consultar bloqueios | `appointments.view` | migrada |
| `scheduleBlocks.js` | `POST/PATCH/DELETE /schedule-blocks...` | admin, reception | alterar bloqueios | `appointments.edit` | migrada |
| `appointments.js` | alteração de fechamento concluído | admin direto | corrigir financeiro fechado | `finance.edit` | migrada |
| `clients.js` | ocultação de conteúdo clínico por papel | reception direto | limitar prontuário | `clinical_files.view` | migrada |

## Rotas que permanecem legadas

As **89 chamadas restantes** não foram substituídas por permissões genéricas. Precisam de novos domínios ou de decisão de produto:

| Arquivo | Rotas restantes | Ação | Permissão futura recomendada | Motivo |
|---|---|---|---|---|
| `catalog.js` | customização, mídia, checklist, publicar, reset, histórico, rollback, settings e promoções (19) | administrar catálogo público/promoções | `catalog.view/edit/publish/reset`, `promotions.view/create/edit/delete` | catálogo atual só possui permissões de cupom |
| `billing.js` | quatro rotas de checkout/assinatura | administrar cobrança da própria clínica | `billing.view/edit` | credenciais e assinatura exigem domínio separado |
| `auth.js` | quatro rotas MFA | administrar MFA da própria conta | `account.mfa` | não deve ser confundida com `settings.edit` global |
| `erp.js` | `GET /erp` | visão administrativa agregada | `dashboard.financial` ou `erp.view` após revisão do payload | pode conter custo e lucro |
| `professionals.js` | criar, editar e excluir profissional (3) | equipe/profissionais | `professionals.create/edit/delete` | ausência de catálogo próprio e futuro vínculo com usuário |
| `services.js` | criar, editar e excluir serviços (3 chamadas) | catálogo clínico de serviços | `services.create/edit/delete` | não equivale a editar atendimento |
| `errorLogs.js` | listar, resolver e excluir erros (3) | observabilidade | `audit.view`, mais `audit.manage` | exclusão/gestão não deve herdar apenas leitura |
| `privacy.js` | auditoria, solicitações LGPD e retenção (9) | privacidade e retenção | `privacy.view/manage/export/retention` | ações potencialmente destrutivas exigem granularidade própria |
| `jobs.js` | criar/listar/baixar jobs e métricas (4) | exportações assíncronas | `jobs.create/view/download/metrics` | há escopo “somente o próprio job” ainda baseado em papel |
| `procedures.js` | criar, editar e excluir procedimentos (3) | catálogo clínico | `procedures.create/edit/delete` | não equivale a anamnese ou atendimento |
| `store.js` | identidade e assinatura (2) | identidade/assinatura | `settings.edit`, `billing.edit`, separadamente | uma rota muda marca; outra muda plano |
| `support.js` | listar/criar/ler/responder/fechar chamados (5) | suporte da conta | `support.view/create/reply/close` | política atual admin-only precisa decisão de produto |
| `aiAssistant.js` | status/execução e resumo clínico (3 guardas) | IA operacional/clínica | `ai.use`, `clinical_files.view` | tarefa clínica precisa composição de permissões |
| `uploads.js` | upload e arquivo privado (2) | arquivo genérico/privado | permissão por `purpose` | uma guarda única permitiria leitura clínica indevida |
| `notifications.js` | compra de créditos, edição de templates/regras e histórico (4) | administração de comunicação | `communication.manage/billing` | `communication.send` seria amplo demais |
| `integrations.js` | Asaas e WhatsApp (9) | segredos e integrações | `integrations.view/edit/test/rotate/delete` | contém credenciais; permanece admin-only |
| `options.js` | categorias, precificação e opções estruturais (10) | estrutura de estoque/preço | `inventory.manage_structure`, `settings.pricing` | `inventory.edit` não deve permitir apagar taxonomias |
| `clients.js` | resgate de fidelidade (1) | aplicar benefício | `loyalty.redeem` | não há domínio de fidelidade no catálogo atual |

## Resultado quantitativo

- Encontradas inicialmente: **146** chamadas `requireRole`.
- Migradas nesta etapa: **57**.
- Permaneceram legadas: **89**.
- Novas permissões efetivamente adicionadas nesta etapa: **0**; evitou-se expandir o catálogo sem fechar a semântica dos domínios acima.

## Migrations pendentes — somente leitura

| Migration | Objetivo | Classificação | Estado/tenants | Risco |
|---|---|---|---|---|
| `platform/0001_baseline.sql` | registrar adoção do ledger da plataforma | LEGADA | pendente no schema `platform` | baixo; `SELECT 1`, mas altera o ledger |
| `tenant/0001_baseline.sql` | registrar baseline de schemas de clínica | LEGADA | pendente em 17 tenants; aplicada em `tenant_2452` e `tenant_2455` | baixo; `SELECT 1` |
| `tenant/0002_tenant_jobs.sql` | criar fila persistente `background_jobs` | NÃO RELACIONADA | pendente nos mesmos 17; aplicada nos tenants 2452/2455 | médio; tabela/índices e dependência de `users` |
| `tenant/0003_user_permissions.sql` | status de usuário, `user_permissions` e tenant explícito na auditoria administrativa | OBRIGATÓRIA PARA RBAC | pendente nos 19 tenants | médio; expansão não destrutiva, mas deve ser aplicada antes do código em ambiente onde `schema.sql` não rode |

O `schema.sql` idempotente já cria parte dessas estruturas no boot atual. Isso significa que objetos podem existir mesmo quando o ledger mostra a migration pendente; não é “aplicação parcial” da migration, mas uma transição entre schema legado e ledger versionado. Antes do deploy, deve-se executar `migrations:verify`, inspecionar objetos existentes e aplicar pelo pipeline explícito. Nada foi aplicado nesta revisão.

## Proposta arquitetural de caixa — sem implementação

### Estruturas

- `cash_registers`: cadastro lógico do caixa (`id`, nome, ativo, moeda, conta financeira associada).
- `cash_sessions`: abertura/fechamento (`cash_register_id`, `opened_by`, `opened_at`, `opening_balance`, `closed_by`, `closed_at`, `expected_balance`, `reported_balance`, `difference`, `status`, observações). Índice único parcial deve impedir mais de uma sessão aberta por caixa.
- `cash_movements`: ledger imutável (`session_id`, tipo, direção, valor, método, origem, `source_type/source_id`, usuário, ocorrido_em, motivo, reversão_de, idempotency_key, metadata sem dados sensíveis).

### Regras

- Abertura cria uma única sessão `open`; reenvio usa idempotency key.
- Sinais, pagamentos complementares e vendas geram movimentos de entrada referenciando `payments.id`; nunca duplicam a receita financeira.
- Dinheiro afeta saldo físico. Pix/cartão são registrados para conciliação, mas não aumentam o numerário da gaveta.
- Sangria é saída; suprimento é entrada; ambos exigem motivo e `cash.withdraw`/`cash.adjust`.
- Despesa paga em dinheiro gera saída ligada a `expenses.id`.
- Estorno cria movimento inverso ligado ao original; não apaga nem reescreve movimentos.
- Fechamento bloqueia a sessão, calcula esperado por método, recebe saldo informado e grava diferença. Segunda tentativa retorna 409 e não cria lançamentos.
- `payments` continua fonte do recebido e `financial_entries` continua ledger contábil. `cash_movements` é a visão operacional por sessão, ligada às fontes por IDs e chaves idempotentes.

### Riscos antes de implementar

- pagamentos existentes não possuem `cash_session_id`; backfill confiável exigiria data, usuário, método e caixa, portanto muitos registros permaneceriam “sem sessão histórica”;
- nomes livres de métodos precisam ser normalizados (`Dinheiro`, `Pix`, débito/crédito);
- fechamento precisa definir fuso horário e corte operacional;
- webhooks e reprocessamentos exigem idempotência para não duplicar movimentos;
- deve ser decidido se haverá um ou vários caixas simultâneos por clínica.

## Associação definitiva usuário/profissional — sem migration

Estado atual:

- `users` não possui vínculo com profissional;
- `professionals` não possui `user_id`;
- `appointments.professional_id` referencia `professionals.id`;
- vendas vinculadas a atendimento chegam ao profissional por `sales_orders.appointment_id -> appointments.professional_id`;
- comissões não têm tabela própria: são calculadas em relatório com `professionals.commission_percentage` e produção/vendas do período;
- `financial_entries.responsible_user_id` referencia usuário, mas não identifica o profissional do atendimento.

Proposta:

```text
users.id 1 ─── 0..1 professionals.user_id
                    ↑
appointments.professional_id
```

- adicionar `professionals.user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL`;
- índice `UNIQUE (user_id) WHERE user_id IS NOT NULL`;
- por cada clínica viver em schema próprio, a FK só pode alcançar `users` do mesmo tenant; não aceitar `tenant_id` vindo do cliente;
- endpoint administrativo de vínculo deve consultar usuário e profissional no mesmo `db` já tenant-scoped, exigir permissão própria e auditar antes/depois;
- `reports.view_own` deve ignorar qualquer `professional_id` enviado e derivá-lo exclusivamente de `professionals.user_id = req.user.id`;
- usuário sem vínculo recebe relatório vazio/409 configurável, nunca relatório global;
- backfill deve ser manual/assistido, sem comparação por nome ou e-mail.

Até essa associação existir, filtro próprio por texto permanece proibido.

Pelo mesmo motivo, `finance.view`, `reports.view_own` e `commission.view_own` não foram mantidas no papel padrão do Body Piercer nesta etapa: as rotas existentes devolvem indicadores globais e ainda não existe uma projeção operacional segura por profissional. As permissões continuam no catálogo para as futuras rotas limitadas, mas concedê-las hoje deve ser tratado como override administrativo consciente e não cria, por si só, um filtro seguro.
