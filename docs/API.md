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

## Rotas públicas e autenticação

| Método | Rota | Uso |
| --- | --- | --- |
| `POST` | `/api/login` | Login da clínica (envie `X-Tenant`). |
| `POST` | `/api/signup` | Cadastro de clínica, sujeito a `ALLOW_PUBLIC_SIGNUP`. |
| `POST` | `/api/platform/login` | Login do super-admin. |
| `GET` | `/api/health`, `/api/health/db` | Saúde da API e do banco. |
| `GET` | `/api/plans`, `/api/clinics` | Vitrine de planos e diretório público de clínicas. |
| `GET` | `/api/landing`, `/api/legal-documents` | Landing da plataforma e documentos legais vigentes. |
| `GET` | `/api/catalog` | Catálogo público do tenant. |
| `POST` | `/api/catalog/events`, `/api/catalog/coupon-quote`, `/api/catalog/promotion-quote`, `/api/catalog/price-quote` | Telemetria e cálculo público do catálogo. |
| `GET`, `POST` | `/api/booking/*` | Readiness, configuração, horários e solicitações de agendamento. |
| `POST` | `/api/sales-orders/public` | Checkout público do catálogo. |
| `GET`, `POST` | `/api/payment-intents/:token/pix`, `/api/payment-intents/:token/sync` | Consulta pública de PIX/status por token UUID não sequencial. |
| `POST` | `/api/error-logs` | Ingestão de erro do frontend. |
| `GET`, `POST` | `/api/webhooks/asaas`, `/api/webhooks/asaas/:slug` | Webhooks autenticados pelo token do Asaas. |

## Operação da clínica

| Domínio | Rotas |
| --- | --- |
| Identidade e assinatura | `GET/PATCH /api/store-identity`; `PATCH /api/subscription`; `GET /api/billing/subscription`; `PUT /api/billing/profile`; `POST /api/billing/checkout`; `GET /api/billing/invoices`. As escritas exigem `admin`. O checkout aceita somente `billing_type: "UNDEFINED"`, usa a página hospedada do Asaas e sempre exige `Idempotency-Key`. A troca direta de plano pela clínica só é permitida durante o trial e sem recorrência criada; depois disso exige suporte. |
| Dashboard e análises | `GET /api/dashboard`; `GET /api/alerts`; `GET /api/erp`; `GET /api/reports/:type`; `GET /api/ai-assistant/status`; `POST /api/ai-assistant`. `GET /api/erp` é administrativo e fornece apenas agregados reais. |
| Usuários | `GET/POST /api/users`; `PATCH/DELETE /api/users/:id`; `PATCH /api/account/profile`. Gestão de usuários exige `admin`. |
| Clientes e prontuários | `GET/POST /api/clients`; `GET/PUT/PATCH/DELETE /api/clients/:id`; `GET /api/clients/:id/deletion-impact`; `POST /api/clients/:id/loyalty-redemptions`; `POST /api/clients/:id/medical-records`; `DELETE /api/clients/:clientId/medical-records/:recordId`. Exclusão exige confirmação e motivo; quando há histórico o cliente é anonimizado/arquivado. |
| Agenda | `GET/POST /api/appointments`; `PATCH/DELETE /api/appointments/:id`; `POST /api/appointments/:id/complete`; `GET /api/appointments/:id/deletion-impact`; `GET/POST /api/availability`; `PATCH /api/availability/:id`; `POST /api/availability/generate-weekly`; `GET/POST/PATCH/DELETE /api/schedule-blocks[/:id]`. |
| Serviços e procedimentos | `GET/POST /api/services`; `PUT/PATCH/DELETE /api/services/:id`; `GET/POST /api/procedures`; `GET/PUT/DELETE /api/procedures/:id`; `GET/POST /api/professionals`; `PATCH/DELETE /api/professionals/:id`. |
| Produtos e estoque | `GET/POST /api/jewelry`; `PATCH/DELETE /api/jewelry/:id`; `GET/POST /api/jewelry/:id/movements`; `POST /api/jewelry/:id/variants/:variantId/movements`; `POST /api/jewelry/visual-search`; `GET /api/inventory/intelligence`; `GET/POST/PATCH /api/inventory/suggestions[/refresh|/:id]`; `GET/POST /api/inventory/counts`; `GET /api/inventory/counts/:id`; `PATCH /api/inventory/counts/:id/items`; `POST /api/inventory/counts/:id/complete`; `GET /api/inventory/labels`. |
| Categorias e precificação | `GET/POST /api/inventory-categories`; `PATCH/DELETE /api/inventory-categories/:id`; `POST /api/inventory-categories/:id/move-products`; `POST /api/inventory-categories/merge`; `POST /api/jewelry/move-category`; `GET/POST /api/inventory-options`; `PATCH/DELETE /api/inventory-options/:id`; `GET /api/options`; `PATCH /api/pricing-settings`. |
| Vendas e cobranças do cliente | `GET/POST /api/sales-orders`; `PATCH /api/sales-orders/:id`; `GET /api/payment-intents`; `PATCH /api/payment-intents/:id/status`; `GET /api/payment-intents/:token/pix`; `POST /api/payment-intents/:token/sync`. IDs internos aparecem apenas nas rotas autenticadas; o cliente final recebe um token público UUID. |
| Financeiro | `GET /api/finance`, `/api/finance/ledger`, `/api/finance/cost-centers`, `/api/finance/goals`, `/api/finance/entries/:id/details`; `POST /api/expenses`, `/api/finance/cost-centers`, `/api/finance/entries`, `/api/finance/entries/:id/lifecycle`, `/api/finance/entries/:id/reconcile`, `/api/finance/entries/bulk-lifecycle`, `/api/finance/recurrences/process`, `/api/finance/goals`; `PATCH /api/expenses/:id`, `/api/finance/entries/:id`; `DELETE /api/expenses/:id`; `GET /api/finance/export.{csv,pdf,xlsx}`. |
| Termos e pós-atendimento | `GET/POST /api/digital-terms`; `GET /api/post-care`; `PATCH /api/post-care/:id` (`multipart`, foto do cliente opcional). Todas exigem `admin` ou `piercer`; termos de menor exigem identificação e assinatura separada do responsável. |
| Comunicações | `GET /api/communication-credits`; `POST /api/communication-credits/purchase`; `GET /api/notifications`; `GET /api/communication-templates`; `PATCH /api/communication-templates/:id`; `GET /api/automation-rules`; `PATCH /api/automation-rules/:id`; `POST /api/automations/process`; `GET /api/automation-runs`. Templates e automações dependem da feature do plano. |
| Integrações | `GET/PUT/DELETE /api/integrations/asaas`; `POST /api/integrations/asaas/test`; `POST /api/integrations/asaas/webhook-token`; `GET/PUT/DELETE /api/integrations/whatsapp`; `POST /api/integrations/whatsapp/test`. Somente `admin`. |
| Arquivos e administração | `POST /api/uploads` (`multipart`); `GET /api/private-files/:filename`; `POST/GET /api/error-logs`; `PATCH/DELETE /api/error-logs/:id`; `POST /api/admin/reset-demo-data`; `POST /api/admin/reset-clinic-data`. Reset exige confirmação e, em produção, depende de configuração explícita. |
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
