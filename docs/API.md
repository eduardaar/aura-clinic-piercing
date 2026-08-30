# Referência da API

Catálogo da API Express atual. A fonte executável é `backend/src/routes/`; esta
referência descreve os recursos expostos, não substitui as validações Zod e as
regras de negócio implementadas em cada rota.

## Convenções

- Todas as rotas usam o prefixo `/api` e JSON, exceto onde indicado como
  `multipart`.
- Rotas da **clínica** resolvem o tenant pelo token, `X-Tenant`, query
  (`t`, `tenant`, `clinic` ou `slug`), subdomínio ou `DEFAULT_TENANT`, nessa
  ordem. Um token de clínica só funciona no próprio tenant.
- Salvo indicação de **pública**, as rotas da clínica exigem
  `Authorization: Bearer <token>`. A autorização de papel e de plano é feita
  pela rota; os papéis são `admin`, `reception`, `finance` e `piercer`.
- Rotas `/api/platform/*` exigem token de plataforma, obtido em
  `POST /api/platform/login`; elas não usam `X-Tenant`.
- Listagens que recebem `limit` e `offset` respondem no envelope
  `{ items, total, limit, offset }`. Sem paginação, algumas rotas preservam a
  resposta em array por compatibilidade.
- Erros usam `{ error, code? }`. Conflitos de versão, idempotência ou estoque
  retornam `409`; recurso do plano indisponível retorna `402` ou `403`.
- Falhas de resolução da clínica usam códigos estáveis: `tenant_required`,
  `tenant_invalid`, `tenant_mismatch`, `tenant_not_found` e
  `tenant_suspended`. O frontend encerra a sessão somente nos três últimos;
  um `403` de permissão ou `404` de recurso comum não derruba o usuário.

### Autorização por assinatura

Uma feature só é barreira técnica quando a rota usa `withFeature` ou o serviço
faz validação equivalente. Ocultar menu não protege a API. As chaves e cotas
existentes refletem o estado atual do código e não constituem, por si só, uma
oferta comercial definitiva.

`402 subscription_inactive` indica assinatura sem acesso. `403
plan_upgrade_required` informa a chave ausente no campo `feature`. Recursos
comuns usam `withDb` e permissões de papel; cotas de criação são verificadas
separadamente por `requireWithinLimit`.

## Rotas públicas e autenticação

| Método | Rota | Uso |
| --- | --- | --- |
| `POST` | `/api/login` | Login da clínica (envie `X-Tenant`). Devolve access token de 15 min e grava o refresh em cookie `HttpOnly`. |
| `POST` | `/api/auth/refresh` | Rotaciona o refresh do cookie e devolve um access token novo. Pública porque o access token já expirou quando ela é chamada. |
| `POST` | `/api/signup` | Cadastro de clínica, sujeito a `ALLOW_PUBLIC_SIGNUP`. |
| `GET` | `/api/signup/availability?name=&email=` | Disponibilidade do nome/endereço sugerido e do e-mail de administrador durante o cadastro. |
| `POST` | `/api/platform/login` | Login do super-admin. |
| `GET` | `/api/health`, `/api/health/db` | Saúde da API e do banco. |
| `GET` | `/api/plans`, `/api/clinics` | Vitrine de planos e diretório público de clínicas. |
| `GET` | `/api/landing`, `/api/legal-documents` | Landing da plataforma e documentos legais vigentes. |
| `GET` | `/api/catalog` | Catálogo público do tenant. |
| `POST` | `/api/catalog/events`, `/api/catalog/coupon-quote`, `/api/catalog/promotion-quote`, `/api/catalog/price-quote` | Telemetria e cálculo público do catálogo. |
| `GET`, `POST` | `/api/booking/*` | Readiness, configuração, horários e solicitações de agendamento. |
| `POST` | `/api/sales-orders/public` | Checkout público do catálogo. |
| `GET`, `POST` | `/api/payment-intents/:token/pix`, `/api/payment-intents/:token/sync` | Consulta pública de PIX/status por token UUID não sequencial, com validade finita. |
| `POST` | `/api/error-logs` | Ingestão de erro do frontend. |
| `GET`, `POST` | `/api/webhooks/asaas`, `/api/webhooks/asaas/:slug` | Webhooks autenticados pelo token do Asaas. |

## Operação da clínica

| Domínio | Rotas |
| --- | --- |
| Identidade e assinatura | `GET/PATCH /api/store-identity`; `PATCH /api/subscription`; `GET /api/billing/subscription`; `PUT /api/billing/profile`; `POST /api/billing/checkout`; `GET /api/billing/invoices`. As escritas exigem `admin`. O checkout aceita somente `billing_type: "UNDEFINED"`, usa a página hospedada do Asaas e sempre exige `Idempotency-Key`. A troca direta de plano pela clínica só é permitida durante o trial e sem recorrência criada; depois disso exige suporte. |
| Dashboard e análises | `GET /api/dashboard`; `GET /api/alerts`; `GET /api/erp`; `GET /api/reports/:type`; `GET /api/ai-assistant/status`; `POST /api/ai-assistant`. `GET /api/erp` é administrativo e fornece apenas agregados reais. |
| Usuários e sessão | `GET/POST /api/users`; `PATCH/DELETE /api/users/:id`; `PATCH /api/account/profile`; `GET /api/permissions` (catálogo de permissões atribuíveis); `POST /api/auth/logout`; `GET /api/account/sessions`; `POST /api/account/sessions/:id/revoke`; `POST /api/account/sessions/revoke-all`. Gestão de usuários exige `admin`. Cada usuário pode ter permissões concedidas ou revogadas individualmente sobre o papel. |
| Clientes e prontuários | `GET/POST /api/clients`; `GET/PUT/PATCH/DELETE /api/clients/:id`; `GET /api/clients/:id/deletion-impact`; `POST /api/clients/:id/loyalty-redemptions`; `POST /api/clients/:id/medical-records`; `DELETE /api/clients/:clientId/medical-records/:recordId`. Exclusão exige confirmação e motivo; quando há histórico o cliente é anonimizado/arquivado. |
| Agenda | `GET/POST /api/appointments`; `PATCH/DELETE /api/appointments/:id`; `POST /api/appointments/:id/complete`; `GET /api/appointments/:id/deletion-impact`; `GET/POST /api/availability`; `PATCH /api/availability/:id`; `POST /api/availability/generate-weekly`; `GET/POST/PATCH/DELETE /api/schedule-blocks[/:id]`. |
| Serviços e procedimentos | `GET/POST /api/services`; `PUT/PATCH/DELETE /api/services/:id`; `GET/POST /api/procedures`; `GET/PUT/DELETE /api/procedures/:id`; `GET/POST /api/professionals`; `PATCH/DELETE /api/professionals/:id`. |
| Produtos e estoque | `GET/POST /api/jewelry`; `PATCH/DELETE /api/jewelry/:id`; `GET/POST /api/jewelry/:id/movements`; `POST /api/jewelry/:id/variants/:variantId/movements`; `POST /api/jewelry/visual-search`; `GET /api/inventory/intelligence`; `GET/POST/PATCH /api/inventory/suggestions[/refresh|/:id]`; `GET/POST /api/inventory/counts`; `GET /api/inventory/counts/:id`; `PATCH /api/inventory/counts/:id/items`; `POST /api/inventory/counts/:id/complete`; `GET /api/inventory/labels`. |
| Categorias e precificação | `GET/POST /api/inventory-categories`; `PATCH/DELETE /api/inventory-categories/:id`; `POST /api/inventory-categories/:id/move-products`; `POST /api/inventory-categories/merge`; `POST /api/jewelry/move-category`; `GET/POST /api/inventory-options`; `PATCH/DELETE /api/inventory-options/:id`; `GET /api/options`; `PATCH /api/pricing-settings`. |
| Compras | `GET/POST /api/purchases`; `GET /api/purchases/:id`; `POST /api/purchases/:id/confirm`; `DELETE /api/purchases/:id` somente para rascunho. A criação exige `Idempotency-Key` no header ou body e, quando confirmada, gera estoque e parcelas a pagar atomicamente. Pode receber `installments: [{ installment_number, amount, due_date, payment_method }]`; sem essa lista, gera o cronograma mensal usando `installment_count`, `first_due_date` e `payment_method`. |
| Vendas e cobranças do cliente | `GET/POST /api/sales-orders`; `PATCH /api/sales-orders/:id`; `GET /api/payment-intents`; `PATCH /api/payment-intents/:id/status`; `POST /api/payment-intents/:id/public-token`; `POST /api/payment-intents/:id/cancel`; `POST /api/payment-intents/:id/refund`; `GET /api/payment-intents/:token/pix`; `POST /api/payment-intents/:token/sync`. Vendas internas aceitam `receivable_mode: "paid"|"pending"` e um cronograma explícito em `installments: [{ installment_number, amount, due_date, payment_method }]`; sem a lista, usam `installment_count`, `first_due_date` e `payment_method`. Venda concluída baixa estoque mesmo quando o recebimento ficou pendente. Cancelar venda com estoque baixado ou valor recebido exige antes um fluxo explícito de devolução/estorno e retorna `409`. Ordens originadas na agenda são corrigidas pelo atendimento, não pela tela de vendas. |
| Financeiro | `GET /api/finance/ledger`, `/api/finance/cost-centers`, `/api/finance/categories`, `/api/finance/suppliers`, `/api/finance/entries/:id/details`; CRUD de lançamentos em `/api/finance/entries`; lifecycle individual/em lote; criação e edição de centros, categorias e fornecedores; `GET /api/finance/export.{csv,pdf,xlsx}`. `POST /api/finance/entries` aceita a mesma lista `installments` de compras e vendas — útil para empréstimos e outras obrigações — e admite `Idempotency-Key` para impedir duplicidade. Razão, cadastros, pagar e receber usam `basic_finance`. `advanced_finance` e a experiência Financeiro 2.0 não integram mais a oferta; `/api/finance` e `/api/expenses` permanecem apenas como compatibilidade histórica. |
| Materiais de consumo | `GET/POST /api/consumables`; `PATCH/DELETE /api/consumables/:id`; `POST /api/consumables/:id/movements`; `GET/POST /api/consumables/:id/lots`; `GET/PUT /api/services/:id/consumables` (ficha técnica). Material operacional não aparece em produtos, vendas ou catálogo. Saída acima do saldo retorna `409`. A soma dos lotes nunca pode exceder o saldo do material, e a baixa segue FEFO. |
| Ficha técnica e consumo | Concluir um atendimento congela a receita em `appointment_consumptions`, gera a movimentação de saída e reduz o saldo. Reabrir ou cancelar devolve exatamente o que foi consumido. |
| Reversões operacionais | `POST /api/appointments/:id/cancel` exige `reason` e `resolution` (`no_payment`, `retain_deposit`, `client_credit`, `manual_refund` — este último exige `refund_method`); o `PATCH` direto para `status = cancelado` retorna `409`. `POST /api/sales-orders/:id/returns` recebe `items`, `reason` e `financial_action` (`none`, `client_credit`, `manual_refund`), com `return_to_stock` e `condition` por item. `POST /api/appointments/:id/apply-client-credit` e `POST /api/sales-orders/:id/apply-client-credit` consomem crédito do cliente. |
| Saúde do estoque | `GET /api/inventory/health`: estoque baixo, cadastro incompleto, lotes vencidos ou a vencer e serviços com ficha técnica. |
| Jobs em segundo plano | `GET /api/jobs`; `GET /api/jobs/metrics`; `GET /api/jobs/:id/download`; `POST /api/jobs/report-exports`. Fila persistente consumida pelo worker; a exportação pesada roda fora da requisição. |
| Termos e pós-atendimento | `GET/POST /api/digital-terms`; `GET /api/post-care`; `PATCH /api/post-care/:id` (`multipart`, foto do cliente opcional). Todas exigem `admin` ou `piercer`; termos de menor exigem identificação e assinatura separada do responsável. |
| Privacidade/LGPD | Exclusivo de `admin`: `GET /api/privacy/audit`; `GET/POST /api/privacy/data-subject-requests`; `PATCH /api/privacy/data-subject-requests/:id`; `GET /api/privacy/data-subject-requests/:id/export`; `GET/PATCH /api/privacy/retention-policies[/:category]`; `POST /api/privacy/retention/:category/{preview,run}`. A exportação exige identidade previamente validada. Retenção automática começa desativada e só cobre logs internos; não elimina dados clínicos, anexos, R2 ou backups. |
| Comunicações | `GET /api/communication-credits`; `POST /api/communication-credits/purchase`; `GET /api/notifications`; `GET /api/communication-templates`; `PATCH /api/communication-templates/:id`; `GET /api/automation-rules`; `PATCH /api/automation-rules/:id`; `POST /api/automations/process`; `GET /api/automation-runs`. Templates e automações dependem da feature do plano. |
| Integrações | `GET/PUT/DELETE /api/integrations/asaas`; `POST /api/integrations/asaas/test`; `POST /api/integrations/asaas/webhook-token`; `GET/PUT/DELETE /api/integrations/whatsapp`; `POST /api/integrations/whatsapp/test`. Somente `admin`. |
| Arquivos e administração | `POST /api/uploads` (`multipart`); `GET /api/private-files/:filename`; `POST/GET /api/error-logs`; `PATCH/DELETE /api/error-logs/:id`. |
| Suporte | `GET/POST /api/support/tickets`; `GET /api/support/tickets/:id`; `POST /api/support/tickets/:id/messages`; `POST /api/support/tickets/:id/close`. |

## Catálogo e builder

| Método | Rota | Uso |
| --- | --- | --- |
| `GET` | `/api/catalog-customization` | Rascunho, catálogo de produtos e metadados de versão. |
| `PATCH` | `/api/catalog-customization` | Salva rascunho parcial ou completo com lock otimista. |
| `GET/POST/PATCH` | `/api/catalog-media[/:id]` | Biblioteca de mídia pública do tenant (`POST` é `multipart`). |
| `GET` | `/api/catalog-customization/checklist` | Erros bloqueantes e avisos da publicação. |
| `POST` | `/api/catalog-customization/publish`, `/reset`, `/rollback/:version` | Publica, restaura rascunho ou cria revisão a partir do histórico. |
| `GET` | `/api/catalog-customization/history[/:version]` | Lista ou lê revisões imutáveis. |
| `GET/PATCH` | `/api/catalog-settings` | Atalho compatível para configurações permitidas do rascunho. |
| `GET/POST/PATCH/DELETE` | `/api/coupons` e `/api/promotions` | `GET/POST` usam a coleção; `PATCH/DELETE` usam `/:id`. `POST /api/promotions/:id/duplicate` duplica uma promoção. |

Todas as rotas administrativas do builder exigem a feature
`public_catalog_customization`, papel `admin` ou `reception` (reset: `admin`).
Veja [CATALOGO-BUILDER.md](./CATALOGO-BUILDER.md) para o contrato de versões e
segurança de conteúdo.

## Plataforma (super-admin)

| Domínio | Rotas |
| --- | --- |
| Clínicas | `GET/POST /api/platform/tenants`; `PATCH/DELETE /api/platform/tenants/:id`; `PATCH /api/platform/tenants/:id/plan`; `GET /api/platform/metrics`. |
| Contas e uso | `GET /api/platform/accounts/:id`, `/usage`, `/limits-preview`; `PATCH /api/platform/accounts/:id/plan`, `/status`, `/trial`, `/subscription-status`; `POST /api/platform/accounts/:id/suspend`, `/reactivate`, `/cancel-subscription`, `/sync-subscription`. |
| Planos | `GET/POST /api/platform/plans`; `GET /api/platform/plans/:code/usage`; `PUT/DELETE /api/platform/plans/:code`; `PATCH /api/platform/plans/:code/active`; `PATCH /api/platform/plans/order`. |
| Cobrança | `GET /api/platform/invoices`; `POST /api/platform/invoices/:id/sync`; `GET /api/platform/finance/summary`, `/overdue`, `/upcoming`, `/monthly`, `/by-plan`. |
| Suporte | `GET /api/platform/support/tickets`, `/open-count`, `/tickets/:id`; `POST /api/platform/support/tickets/:id/messages`; `PATCH /api/platform/support/tickets/:id`. |
| Conteúdo público | `GET /api/platform/landing`; `PUT /api/platform/landing/sections/:key`; `PATCH /api/platform/landing/order`; `POST /api/platform/landing/uploads`; `GET /api/platform/legal-documents`; `PUT /api/platform/legal-documents/:key`. |

## Referências de implementação

- Os contratos de entrada validados por Zod estão em `backend/src/schemas/index.js`.
- O ciclo de tenant, autenticação e `search_path` está em
  [ARQUITETURA.md](./ARQUITETURA.md).
- Cobranças recorrentes e webhooks do Asaas estão em [ASAAS.md](./ASAAS.md).
