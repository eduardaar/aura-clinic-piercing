# Referência da API

Atualização de 09/10/2026 — edição e finalização:

- `POST /api/appointments/:id/complete` valida a lista de pagamentos antes das
  escritas: valores/taxas não negativos com até duas casas, parcelas inteiras a
  partir de 1 e status `pago`, `confirmado` ou `pendente`. A soma das linhas,
  inclusive pendentes, não pode superar o saldo disponível após sinal/crédito.
  Pagamentos pendentes novos têm `paid_at = NULL` (migration tenant `0044`);
  recebimentos confirmados têm data e usuário. Os métodos de transferência e
  outra forma são registros manuais, sem confirmação automática de operadora.
- No fechamento, `financial_notes: ""` apaga a observação; omitir o campo a
  preserva. A mesma distinção vale para mensagem/notas de pós-atendimento e
  motivo/notas de bloqueios. Datas opcionais da lista de espera e vínculos
  opcionais dos lançamentos aceitam limpeza explícita.
- `/api/catalog` mantém publicados esgotados disponíveis para consulta, sem
  liberar a compra de saldo inexistente. A interface não usa mais a antiga
  configuração `show_out_of_stock` para ocultá-los.

Atualização de 06/10/2026 — sinal e rastreabilidade:

- `POST /api/appointments`: `deposit_value` aceita o valor manual e `deposit_status` determina se houve recebimento. `deposit_expected_value` preserva a sugestão do serviço (ou o valor esperado explicitamente enviado). Integrações legadas sem status mantêm a semântica anterior de recebido; telas atuais sempre enviam o status.
- `PATCH /api/appointments/:id`: alterar o sinal recalcula pagamentos e saldo, preserva o ID do pagamento e gera `deposit_correction` nas auditorias financeira e central. A expectativa não muda na conferência do recebido.
- Listagem de agendamentos e relatório `appointments`: `deposit_received_value` é a soma dos sinais pagos/confirmados; pendentes e cancelados não entram. Relatório distingue sinal esperado, informado e recebido, inclusive nas quatro exportações.
- `GET /api/appointments/:id/value-adjustments`: `financial.depositExpected` e `financial.depositPaid` distinguem expectativa e caixa.
- `PATCH /api/finance/entries/:id`: baixa de título integrado mantém um pagamento único vinculado pelo `financial_entry_id`, atualiza Agenda/execução e alimenta Dashboard e relatórios de pagamentos. Alterar tipo ou valor de um título integrado exige o módulo de origem. Valores monetários inválidos retornam 400.
- `GET /api/dashboard`: `adminDashboard.nextAppointment.starts_at` é ISO UTC calculado a partir do horário civil de São Paulo. Próximos excluem horários passados e estados encerrados, remarcados ou em atendimento; a tela atualiza a contagem e consulta novamente no horário e ao voltar ao navegador.

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
  pela rota; os papéis são `admin`, `reception`, `finance` e `piercer`. A
  maior parte das rotas confere permissões granulares (`authorizePermission`,
  catálogo em `backend/src/config/permissions.js`); as demais ainda usam
  `requireRole`. `admin` tem todas as permissões; para os outros papéis, a
  base é o cargo ou o perfil de acesso ativo, somada às concessões e menos as
  revogações individuais (`services/permissionService.js`).
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
| `POST` | `/api/login` | Login da clínica (envie `X-Tenant`). Devolve access token de 15 min e grava o refresh em cookie `HttpOnly`. O e-mail é comparado sem diferenciar maiúsculas; usuário inativo recebe `403` e conta com MFA ativo sem código válido recebe `401 mfa_required`. A resposta traz `user.permissions` já resolvidas. |
| `POST` | `/api/auth/refresh` | Rotaciona o refresh do cookie e devolve um access token novo. Pública porque o access token já expirou quando ela é chamada. |
| `POST` | `/api/auth/forgot-password`, `/api/auth/reset-password` | Recuperação de senha por link de uso único (30 min, só o hash do token é gravado). A solicitação responde sempre de forma genérica; a redefinição exige senha com 12+ caracteres e revoga as sessões. Usam o limitador de login. |
| `POST` | `/api/signup` | Cadastro de clínica, sujeito a `ALLOW_PUBLIC_SIGNUP`. Exige `plan_code` de um plano existente e ativo (`400 plano_obrigatorio` / `plano_indisponivel`) e `legal_acceptances` com as versões vigentes dos documentos legais (`400 legal_acceptance_required`). |
| `GET` | `/api/signup/availability?name=&email=` | Disponibilidade do nome/endereço sugerido e do e-mail de administrador durante o cadastro. |
| `POST` | `/api/platform/login` | Login do super-admin. |
| `GET` | `/api/health`, `/api/health/db` | Saúde da API e do banco. |
| `GET` | `/api/plans`, `/api/clinics` | Vitrine de planos e diretório público de clínicas. |
| `GET` | `/api/landing`, `/api/legal-documents` | Landing da plataforma e documentos legais vigentes. |
| `GET` | `/api/news`, `/api/news/:slug`, `/api/manual` | Notícias e capítulos do manual do usuário publicados pela plataforma. |
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
| Identidade e assinatura | `GET/PATCH /api/store-identity`; `PATCH /api/subscription`; `GET /api/billing/subscription`; `PUT /api/billing/profile`; `POST /api/billing/checkout`; `GET /api/billing/schedule`; `GET /api/billing/invoices`; `GET /api/billing/invoices/:id/pix`; `POST /api/billing/subscription/cancel`. As rotas de cobrança e as escritas exigem `admin`. O checkout aceita `billing_type` `CREDIT_CARD` (padrão, página hospedada do Asaas) ou `PIX`, recusa dados de cartão no corpo e sempre exige `Idempotency-Key`. A troca direta de plano pela clínica só é permitida durante o trial e sem recorrência criada; depois disso responde `409 plan_change_requires_support`. |
| Dashboard e análises | `GET /api/dashboard`; `GET /api/alerts`; `GET /api/erp`; `GET /api/reports` (catálogo de relatórios liberados pela permissão e pelo plano); `GET /api/reports/:type` (JSON por padrão; `format` `pdf`, `xlsx`, `csv` ou `txt`); `GET /api/ai-assistant/status`; `POST /api/ai-assistant`. `GET /api/erp` é administrativo e fornece apenas agregados reais. Relatórios exigem `basic_reports`; quem só tem `reports.view_own` precisa estar vinculado a um profissional (`409`). |
| Usuários e sessão | `GET/POST /api/users`; `PATCH/DELETE /api/users/:id` (o `DELETE` exige `reason`); `GET /api/permissions` (catálogo de permissões atribuíveis); `GET/PUT /api/users/:id/permissions` (exceções individuais, `PUT` exige `reason`); `PATCH /api/account/profile`; `POST /api/auth/logout`; `GET /api/account/sessions`; `DELETE /api/account/sessions/:id`; `POST /api/account/sessions/revoke-all`; `GET /api/account/mfa`, `POST /api/account/mfa/{setup,verify,disable}`. Gestão de usuários usa as permissões `users.*`; o perfil próprio (`/api/account/profile`) vale para qualquer usuário autenticado e nunca altera o papel; MFA da conta é só de `admin`. Cada usuário pode ter permissões concedidas ou revogadas individualmente sobre o papel ou o perfil. |
| Perfis de acesso e auditoria | `GET/POST /api/access-profiles`; `GET/PATCH/DELETE /api/access-profiles/:id` (`PATCH` e `DELETE` exigem `reason`; perfil com usuários vinculados não é excluído, `409`); `GET /api/access-profile-templates`; `GET /api/audit-events` (filtros, busca e paginação); `GET /api/audit-events/:id`. Perfis exigem `users.permissions`; a auditoria exige `audit.view`. |
| Clientes e prontuários | `GET/POST /api/clients`; `GET/PUT/PATCH/DELETE /api/clients/:id`; `GET /api/clients/:id/deletion-impact`; `GET /api/clients/:id/credits`; `POST /api/clients/:id/merge`; `POST /api/clients/:id/loyalty-redemptions`; `POST /api/clients/:id/medical-records`; `DELETE /api/clients/:clientId/medical-records/:recordId`. Exclusão exige confirmação e motivo; quando há histórico o cliente é anonimizado/arquivado. Criar ou editar com CPF, WhatsApp ou e-mail de outro cliente ativo responde `409 duplicate_client`. A mesclagem exige `clients.delete`, `target_client_id`, `reason` e `confirmation: "MESCLAR CLIENTES"`. |
| Agenda | `GET/POST /api/appointments`; `PATCH/DELETE /api/appointments/:id`; `POST /api/appointments/:id/complete`; `GET /api/appointments/:id/deletion-impact`; `GET/POST /api/availability`; `PATCH /api/availability/:id`; `POST /api/availability/generate-weekly`; `GET/POST/PATCH/DELETE /api/schedule-blocks[/:id]`. O `PATCH` recusa status fora da lista (inclui `chegou`, `em_atendimento` e `nao_compareceu`) e exige `reason` quando data ou horário mudam, gravando o histórico de reagendamento. |
| Operações da agenda | `GET/POST /api/agenda/waitlist`; `PATCH /api/agenda/waitlist/:id`; `GET/POST /api/agenda/resources`; `PATCH /api/agenda/resources/:id`. Lista de espera e cadastro de salas e recursos (feature `agenda`, `appointments.view`/`appointments.edit`). |
| Execuções de serviço | `GET /api/service-executions`; `GET /api/service-executions/:id`. Fechamento do atendimento concluído, separado das vendas (feature `agenda`, `appointments.view`). |
| Serviços e procedimentos | `GET/POST /api/services`; `PUT/PATCH/DELETE /api/services/:id`; `GET/PUT /api/services/:id/inventory-items` (ficha técnica; `/api/services/:id/consumables` é alias); `GET /api/service-catalog-options`; `GET/PUT /api/service-operational-settings` (checklist e biossegurança da clínica); `GET/POST /api/professionals`; `PATCH/DELETE /api/professionals/:id`. `services` é o cadastro único de tipos de atendimento: `POST`/`PUT` aceitam `inventory_items` e `compatible_jewelry_ids`. `GET /api/procedures` e `GET /api/procedures/:id` ficaram como leitura do histórico (header `Deprecation: true`); `POST`, `PUT`, `PATCH` e `DELETE` em `/api/procedures` respondem `410`. |
| Produtos e estoque | `GET/POST /api/jewelry`; `PATCH/DELETE /api/jewelry/:id`; `GET/POST /api/jewelry/:id/movements`; `POST /api/jewelry/:id/variants/:variantId/movements`; `POST /api/jewelry/:id/lots`; `GET /api/inventory/lots`; `GET /api/inventory/movements`; `POST /api/jewelry/visual-search`; `GET /api/inventory/intelligence`; `GET/POST/PATCH /api/inventory/suggestions[/refresh\|/:id]`; `GET/POST /api/inventory/counts`; `GET /api/inventory/counts/:id`; `PATCH /api/inventory/counts/:id/items`; `POST /api/inventory/counts/:id/complete`; `GET /api/inventory/labels`. Produtos para venda e materiais de procedimento são o mesmo item de estoque, diferenciado por `can_sell`, `can_use_in_service`, `track_stock`, `track_lots` e `can_publish`. Movimentação exige quantidade inteira positiva e recusa saída acima do saldo (`409`); saída de item com `track_lots` baixa lotes por FEFO. Lote acima do saldo ainda sem lote responde `400`, salvo com `increase_stock: true`. |
| Categorias e precificação | `GET/POST /api/inventory-categories`; `PATCH/DELETE /api/inventory-categories/:id`; `POST /api/inventory-categories/:id/move-products`; `POST /api/inventory-categories/merge`; `POST /api/jewelry/move-category`; `POST /api/inventory-options`; `PATCH/DELETE /api/inventory-options/:id`; `GET /api/options`; `PATCH /api/pricing-settings`. |
| Compras | `GET/POST /api/purchases`; `GET /api/purchases/:id`; `POST /api/purchases/:id/confirm`; `DELETE /api/purchases/:id` somente para rascunho; `POST /api/purchases/nfe/preview` (prévia do XML da NF-e, auditada). A criação exige `Idempotency-Key` no header ou body e, quando confirmada, gera estoque e parcelas a pagar atomicamente. Pode receber `installments: [{ installment_number, amount, due_date, payment_method }]`; sem essa lista, gera o cronograma mensal usando `installment_count`, `first_due_date` e `payment_method`. Também aceita `nfe_xml` (NF-e já importada responde `409`) e, por item, `new_inventory_item` para cadastrar o item durante a conferência. Fornecedor bloqueado é recusado. |
| Vendas e cobranças do cliente | `GET/POST /api/sales-orders`; `GET/PATCH /api/sales-orders/:id`; `GET/POST /api/sales-orders/:id/returns`; `GET /api/payment-intents`; `PATCH /api/payment-intents/:id/status`; `POST /api/payment-intents/:id/public-token`; `POST /api/payment-intents/:id/cancel`; `POST /api/payment-intents/:id/refund`; `GET /api/payment-intents/:token/pix`; `POST /api/payment-intents/:token/sync`. Vendas internas aceitam `receivable_mode: "paid"\|"pending"` e um cronograma explícito em `installments: [{ installment_number, amount, due_date, payment_method }]`; sem a lista, usam `installment_count`, `first_due_date` e `payment_method`. Venda concluída baixa estoque mesmo quando o recebimento ficou pendente. Cancelar venda com estoque baixado ou valor recebido exige antes um fluxo explícito de devolução/estorno e retorna `409`. Ordens originadas na agenda são corrigidas pelo atendimento, não pela tela de vendas. Vendas registram apenas produtos: `appointment_id` responde `409` e `order_type: "ordem_servico"` ou item de serviço são recusados; a listagem oculta as ordens antigas de origem `agenda`, salvo `include_agenda=true`. |
| Financeiro | `GET /api/finance/ledger`, `/api/finance/cost-centers`, `/api/finance/categories`, `/api/finance/suppliers`, `/api/finance/entries/:id/details`; CRUD de lançamentos em `/api/finance/entries`; lifecycle individual/em lote; criação e edição de centros, categorias e fornecedores; `GET /api/finance/export.{csv,pdf,xlsx}` (mantidas por compatibilidade: a interface exporta pela central de relatórios, `GET /api/reports/:type?format=`). `POST /api/finance/entries` aceita a mesma lista `installments` de compras e vendas — útil para empréstimos e outras obrigações — e admite `Idempotency-Key` para impedir duplicidade. Razão, cadastros, pagar e receber usam `basic_finance`. `advanced_finance` e a experiência Financeiro 2.0 não integram mais a oferta; `/api/finance` e `/api/expenses` permanecem apenas como compatibilidade histórica. |
| Ficha técnica e consumo | A ficha técnica do serviço (`/api/services/:id/inventory-items`) lista itens de estoque e quantidades. Concluir um atendimento congela a receita em `appointment_consumptions`, baixa os lotes por FEFO quando o item controla lotes (sem lote suficiente, a conclusão é recusada) e reduz o saldo; também gera a execução do serviço. Reabrir ou cancelar devolve exatamente o que foi consumido. As antigas rotas `/api/consumables*` foram removidas na unificação do estoque. |
| Reversões operacionais | `POST /api/appointments/:id/cancel` exige `reason` e `resolution` (`no_payment`, `retain_deposit`, `client_credit`, `manual_refund` — este último exige `refund_method`); o `PATCH` direto para `status = cancelado` retorna `409`. `POST /api/sales-orders/:id/returns` recebe `items`, `reason` e `financial_action` (`none`, `client_credit`, `manual_refund`), com `return_to_stock` e `condition` por item. `POST /api/appointments/:id/apply-client-credit` e `POST /api/sales-orders/:id/apply-client-credit` consomem crédito do cliente. |
| Saúde do estoque | `GET /api/inventory/health`: estoque baixo, cadastro incompleto (sem SKU ou categoria), lotes vencidos ou a vencer em 30 dias e serviços com ficha técnica. |
| Jobs em segundo plano | `GET /api/jobs`; `GET /api/jobs/metrics`; `GET /api/jobs/:id/download`; `POST /api/jobs/report-exports`. Fila persistente consumida pelo worker; a exportação pesada roda fora da requisição. Exigem `basic_reports` (menos `metrics`, só de `admin`) e as features de cada relatório; a recepção só vê e baixa os próprios jobs. A fila usa a mesma resolução de permissões e escopo próprio da rota síncrona, aceita só CSV e exporta todo o conjunto filtrado (`paginated: false`), com rótulos em português e auditoria; nenhuma tela usa a fila hoje. Ver [JOBS-EM-SEGUNDO-PLANO.md](./JOBS-EM-SEGUNDO-PLANO.md). |
| Termos e pós-atendimento | `GET/POST /api/digital-terms`; `GET /api/post-care`; `PATCH /api/post-care/:id` (`multipart`, foto do cliente opcional). Exigem as permissões `clinical_files.view` (leitura) e `clinical_files.edit` (escrita) — por padrão, `admin` e `piercer`; termos de menor exigem identificação e assinatura separada do responsável. Termo concluído é imutável (gatilho no banco) e carrega `template_name`, `channel` (`staff`, `in_studio`, `remote`) e `content_hash`. |
| Modelos de termo | `GET /api/term-templates[?include_inactive=1]`; `POST /api/term-templates`; `PATCH/DELETE /api/term-templates/:id` (modelo já usado é arquivado, não apagado). Tipos: `consent`, `authorization`, `procedure`, `other`. Clínica nova nasce com dois modelos. |
| Termos por link | `GET /api/term-requests[?client_id&status]`; `POST /api/term-requests` (`client_id`, `template_id`, `appointment_id?`, `channel` = `in_studio` ou `remote`, `expires_in_hours?`, `message?`) devolve `url`, `whatsapp_url` e `message_text` uma única vez; `POST /api/term-requests/:id/{cancel,renew}`. Só o hash do token é gravado. |
| Termo público (cliente) | `GET/POST /api/public/terms/:token` — sem sessão, com `X-Tenant`. `GET` devolve modelo, dados básicos do cliente e clínica; `POST` recebe dados, histórico de saúde, aceite e assinatura (PNG data URL), grava o termo, gera o PDF e conclui a solicitação. Link inválido `404`, expirado/cancelado `410`, já assinado `409`. Página: `/termo/<token>?t=<slug>`. |
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

As rotas do builder (`/api/catalog-customization*`, `/api/catalog-media*` e
`/api/catalog-settings`) exigem a feature `public_catalog_customization`, papel
`admin` ou `reception` (reset: `admin`). Cupons exigem a feature `coupons` e as
permissões `coupons.*`; promoções exigem a feature `campaigns`, com leitura para
`admin` ou `reception` e escrita só para `admin`. Todas dependem também de
`basic_catalog`.
Veja [CATALOGO-BUILDER.md](./CATALOGO-BUILDER.md) para o contrato de versões e
segurança de conteúdo.

## Plataforma (super-admin)

| Domínio | Rotas |
| --- | --- |
| Acesso do super-admin | `GET /api/platform/mfa`; `POST /api/platform/mfa/{setup,verify,disable}`. Ativar e desativar o MFA exigem senha atual e código; `verify` e `disable` devolvem token novo. |
| Clínicas | `GET/POST /api/platform/tenants`; `PATCH/DELETE /api/platform/tenants/:id`; `PATCH /api/platform/tenants/:id/plan`; `GET /api/platform/metrics` (mantida, mas o painel não a consome mais). |
| Contas e uso | `GET /api/platform/accounts/:id`, `/usage`, `/limits-preview`; `PATCH /api/platform/accounts/:id/plan`, `/status`, `/trial`, `/subscription-status`; `POST /api/platform/accounts/:id/suspend`, `/reactivate`, `/cancel-subscription`, `/sync-subscription`. |
| Planos | `GET/POST /api/platform/plans`; `GET /api/platform/plans/:code/usage`; `PUT/DELETE /api/platform/plans/:code`; `PATCH /api/platform/plans/:code/active`; `PATCH /api/platform/plans/order`. |
| Cobrança | `GET /api/platform/invoices`; `POST /api/platform/invoices/:id/sync`; `GET /api/platform/finance/summary`, `/overdue`, `/upcoming`, `/monthly`, `/by-plan`. |
| Suporte | `GET /api/platform/support/tickets`, `/open-count`, `/tickets/:id`; `POST /api/platform/support/tickets/:id/messages`; `PATCH /api/platform/support/tickets/:id`. |
| E-mail | `GET/PUT/DELETE /api/platform/email-settings`; `POST /api/platform/email-settings/verify`; `POST /api/platform/email-settings/test`. A senha SMTP é somente de escrita: a API devolve apenas `password_configured`. |
| Conteúdo público | `GET /api/platform/landing`; `PUT /api/platform/landing/sections/:key`; `PATCH /api/platform/landing/order`; `POST /api/platform/landing/uploads`; `GET /api/platform/legal-documents`; `PUT /api/platform/legal-documents/:key` (incrementa a versão e grava o histórico); `GET /api/platform/legal-documents/:key/versions`; `GET/POST /api/platform/content`; `PUT/DELETE /api/platform/content/:id` (notícias e manual em texto simples; o `DELETE` arquiva). |

## Filtros, exportações e origem financeira

- `GET /api/reports/:type` aplica os filtros declarados no catálogo, `search` e
  `sort=campo:asc|desc` antes de calcular `total_rows`. Relatórios detalhados
  também aceitam `limit`/`offset`; os agregados devolvem todo o conjunto filtrado.
  PDF, XLSX, CSV e TXT usam `buildReport` e as mesmas colunas autorizadas; o formato
  exportado remove somente a paginação. Totais de comissões/ajustes respeitam a
  busca. Datas explicitamente vazias removem o limite correspondente; sem datas
  informadas, permanece o padrão do mês corrente. Período invertido responde `400`.
- Agendamentos, cancelamentos, vendas, pagamentos, recebíveis e lançamentos
  financeiros admitem `client_id`; pagamentos, recebíveis e lançamentos também
  oferecem `professional_id` quando ligados a atendimento. A Agenda admite
  `id` para abrir um registro específico e sua busca inclui profissional,
  serviço e joia. A contagem paginada usa os mesmos filtros da consulta.
- `GET /api/finance/ledger` admite `client_id`, `professional_id`, `source_type`
  e `date_field=due_date`; o padrão continua sendo competência. Consulta, contagem
  e indicadores usam o mesmo campo de data. Contas a pagar/receber enviam
  `date_field=due_date`. A busca textual é literal, sem diferenciar acentos/caixa.
- `GET /api/finance/entries/:id/details` acrescenta `origin` (`null` para uma
  origem manual ou indisponível). O objeto traz cliente, data/hora, profissional,
  procedimento, itens, pagamentos com status, parcelas, `total_value`,
  `deposit_paid`, `other_paid`, `credit_applied`, `paid_value`, `remaining_value`
  e `href` para o registro. Somente sinal pago/confirmado entra em `deposit_paid`;
  título reduzido não é recebimento e pagamentos de venda espelhados nos títulos
  não são somados duas vezes. Dados clínicos e notas de anamnese não fazem parte
  desse objeto. A autorização continua sendo `finance.view`.

## Referências de implementação

- Os contratos de entrada validados por Zod estão em `backend/src/schemas/index.js`.
- O ciclo de tenant, autenticação e `search_path` está em
  [ARQUITETURA.md](./ARQUITETURA.md).
- Cobranças recorrentes e webhooks do Asaas estão em [ASAAS.md](./ASAAS.md).
