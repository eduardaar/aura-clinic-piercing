# Referência da API

Referência dos endpoints do backend da **Aura Clinic Piercing** (Node/Express), agrupados por domínio. Fonte: `backend/src/routes/*.js`.

## Convenções e regras globais

- **Base**: todos os caminhos vivem sob `/api` (ex.: `http://localhost:4000/api/...`).

- **Autenticação** (`backend/src/middleware/auth.js` → `requiresAuth`): toda rota sob `/api` exige token, **exceto** exatamente: `/api/login`, `/api/health`, `/api/catalog`, `/api/sales-orders/public` e qualquer rota que comece com `/api/booking`. O token vai no header `Authorization: Bearer <token>`.
  - **Dev local**: em `localhost`/`127.0.0.1`/`::1` fora de produção, a autenticação é **bypassada** (assume o admin do tenant). As marcações `[AUTH]` abaixo valem para produção.

- **Header `X-Tenant`** (multi-tenant): quase toda rota resolve o tenant antes do handler (via `withDb`), usando nesta ordem: token com `tslug` → header `X-Tenant` → env `DEFAULT_TENANT`. Portanto **praticamente todas as rotas precisam de tenant**, inclusive as públicas de catálogo/booking/venda. As **únicas** rotas que **não** resolvem tenant (não usam `X-Tenant`) são as de `health.js` e todas as de `platform.js` (que usam token de plataforma). O frontend injeta o `X-Tenant` automaticamente; links públicos aceitam `?t=<slug>` (mapeado para o header).

- **Papéis** (`requireRole`): quando um handler restringe por papel, indicamos "role: …". Papéis: `admin`, `reception`, `finance`, `piercer`.

- **Uploads**: rotas marcadas como **multipart** aceitam arquivos via `multipart/form-data` (multer). Uploads genéricos vão para `POST /api/uploads`.

- **Corpo validado por Zod**: vários POST/PATCH validam o corpo com schemas Zod (`backend/src/schemas/index.js`); em falha retornam `400` com a mensagem do erro.

Legenda de cada linha: **método + caminho — [AUTH|PÚBLICO] — tenant — principais campos do corpo — resposta**.

---

## Autenticação, cadastro e plataforma

### Login de clínica (`routes/auth.js`)
- `POST /api/login` — **PÚBLICO** (mas usa `X-Tenant`) — corpo: `{ email, password }` — resposta: `{ token, user:{id,name,email,role}, tenant:{id,name,slug} }`. Rate-limited (login). `401` para credenciais inválidas.

### Cadastro e plataforma (`routes/platform.js`, sem `X-Tenant`)
- `POST /api/signup` — cadastro **público** de clínica (bloqueado se `ALLOW_PUBLIC_SIGNUP=false`; rate-limit ~5/h) — corpo: `{ name, slug, admin_name, admin_email, admin_password }` — resposta: `201 { tenant:{id,name,slug} }`.
- `POST /api/platform/login` — **login do super-admin** (rate-limit) — corpo: `{ email, password }` — resposta: `{ token, user }` (token de plataforma, `plt:true`).
- `GET /api/platform/tenants` — **token de plataforma** — resposta: lista de clínicas `{ id, name, slug, status, plan, created_at }`.
- `POST /api/platform/tenants` — **token de plataforma** — corpo: `{ name, slug, admin_name, admin_email, admin_password }` — resposta: `201 { tenant }` (cria clínica).
- `PATCH /api/platform/tenants/:id` — **token de plataforma** — corpo: `{ status }` (`ativo`/`suspenso`) — resposta: tenant atualizado (suspender/reativar; invalida cache).
- `DELETE /api/platform/tenants/:id` — **token de plataforma** — corpo: `{ confirmation }` (deve ser igual ao **slug** da clínica) — resposta: `{ ok:true }` (exclui/deprovisiona; `400` se confirmação errada).
- `GET /api/platform/metrics` — **token de plataforma** — resposta: métricas por clínica ativa `[{ id, name, slug, clients, appointments }]`.

---

## Clientes (`routes/clients.js`)
- `GET /api/clients` — **AUTH** — X-Tenant: sim — resposta: lista de clientes com detalhes (histórico, pagamentos, prontuários, fidelidade).
- `POST /api/clients` — **AUTH** — corpo: `full_name`, `whatsapp` (obrigatórios), `instagram`, `birth_date`, `notes` — resposta: `201` cliente.
- `PUT /api/clients/:id` — **AUTH** — corpo: `full_name`, `whatsapp`, `instagram`, `birth_date`, `notes` — resposta: cliente atualizado.
- `PATCH /api/clients/:id` — **AUTH** — corpo: mesmos campos — resposta: cliente atualizado.
- `DELETE /api/clients/:id` — **AUTH** (role: admin, reception) — resposta: `{ ok:true }`.
- `POST /api/clients/:id/loyalty-redemptions` — **AUTH** — corpo: `points_used`, `discount_value`, `notes` — resposta: `201` fidelidade do cliente (`400` se pontos insuficientes).
- `POST /api/clients/:id/medical-records` — **AUTH** — **multipart** (`before_photo`, `after_photo`) — corpo: `appointment_id`, `record_date`, `piercing_history`, `jewelry_used`, `occurrences`, `guidance`, `allergies_notes`, `healing_evolution`, `returns_done` — resposta: `201` prontuário.
- `DELETE /api/clients/:clientId/medical-records/:recordId` — **AUTH** — resposta: `{ ok:true }`.

## Agendamentos (`routes/appointments.js`)
- `GET /api/appointments` — **AUTH** — query: `professional_id`, `status` (filtros) — resposta: lista de agendamentos.
- `POST /api/appointments` — **AUTH** — **multipart** (`reference_photo` opcional) — corpo: `professional_id`, `appointment_date`, `appointment_time` (obrigatórios), `service_id`, `jewelry_id`, `jewelry_variant_id`, `procedure`, `description`, `piercing_region`, valores (`total_value`, `deposit_value`, `remaining_value`), formas de pagamento e dados do cliente para upsert — resposta: `201` agendamento (`409` se horário ocupado).
- `PATCH /api/appointments/:id` — **AUTH** — corpo: quaisquer campos do agendamento (`status`, data/hora, valores, etc.) — resposta: agendamento atualizado. Marcar `status:"atendido"` dispara baixa de estoque, pagamento do saldo, criação de pós-atendimento e pontos de fidelidade.

## Serviços (`routes/services.js`)
- `GET /api/services` — **AUTH** — resposta: lista de serviços.
- `POST /api/services` — **AUTH** (role: admin, reception) — corpo: `name` (obrigatório), `description`, `duration_minutes`, `price`, `deposit_value`, `active_online_booking`, `pre_service_notes`, `professional_ids[]` — resposta: `201` serviço.
- `PATCH /api/services/:id` — **AUTH** (role: admin, reception) — corpo: mesmos campos — resposta: serviço atualizado.
- `DELETE /api/services/:id` — **AUTH** (role: admin) — resposta: `{ ok:true }` (soft-delete: desativa booking online).

## Procedimentos (`routes/procedures.js`)
- `GET /api/procedures` — **AUTH** — resposta: lista de procedimentos (com `service_name`).
- `GET /api/procedures/:id` — **AUTH** — resposta: procedimento (`404` se inexistente).
- `POST /api/procedures` — **AUTH** (role: admin, reception) — corpo: `service_id`, `name` (obrigatórios), `body_area`, `description`, `price`, `duration_minutes`, `aftercare_instructions`, `is_active` — resposta: `201` procedimento.
- `PUT /api/procedures/:id` — **AUTH** (role: admin, reception) — corpo: mesmos campos — resposta: procedimento atualizado.
- `DELETE /api/procedures/:id` — **AUTH** (role: admin) — resposta: `{ ok:true }`.

## Joalherias e estoque (`routes/jewelry.js`)
- `GET /api/jewelry` — **AUTH** — query: `search` e filtros (`category`, `subcategory`, `status`, `physical_location`, e por variante `material`, `color`, `size`, `thickness`, `length`, `diameter`, `thread_type`, `supplier`) — resposta: lista de joias com variantes.
- `POST /api/jewelry` — **AUTH** (role: admin, reception) — corpo: `name`, `category` (obrigatórios) + ~40 campos de produto (atributos físicos, estoque, catálogo/SEO/frete, flags) e `variants[]` — resposta: `201` joia com variantes.
- `PATCH /api/jewelry/:id` — **AUTH** (role: admin, reception) — corpo: mesmos campos + `image_url`, `is_published`, `variants[]` — resposta: joia atualizada.
- `GET /api/jewelry/:id/movements` — **AUTH** — resposta: últimas movimentações (limit 20).
- `POST /api/jewelry/:id/movements` — **AUTH** (role: admin, reception) — corpo: `quantity`, `movement_type`, `notes`, `movement_date` — resposta: `{ ok:true, jewelry, movements[] }`.
- `POST /api/jewelry/:id/variants/:variantId/movements` — **AUTH** (role: admin, reception) — corpo: `quantity`, `movement_type`, `notes`, `movement_date` — resposta: `{ ok:true, product }`.
- `DELETE /api/jewelry/:id` — **AUTH** (role: admin) — resposta: `{ ok:true, archived:true|false }` (arquiva se houver vínculos; senão apaga).

## Pedidos de venda (`routes/sales.js`)
- `GET /api/sales-orders` — **AUTH** (role: admin, finance, reception, piercer) — resposta: lista de pedidos.
- `POST /api/sales-orders` — **AUTH** (role: admin, finance, reception, piercer) — corpo: pedido (itens, cliente, pagamento) — resposta: `201` pedido.
- `POST /api/sales-orders/public` — **PÚBLICO** (usa `X-Tenant`) — corpo: pedido (sem usuário autenticado) — resposta: `201` pedido.
- `PATCH /api/sales-orders/:id` — **AUTH** (role: admin, finance, reception) — corpo: `status`, `payment_method`, `notes` — resposta: pedido atualizado.

## Financeiro e despesas (`routes/finance.js`)
- `GET /api/finance` — **AUTH** (role: admin, finance) — resposta: relatório financeiro.
- `POST /api/expenses` — **AUTH** (role: admin, finance) — corpo: `description`, `expense_type` (`fixa`/`variavel`), `due_date` (obrigatórios), `category`, `amount`, `status`, `payment_method`, `notes` — resposta: `201` despesa.
- `DELETE /api/expenses/:id` — **AUTH** (role: admin, finance) — resposta: `{ ok:true }`.
- `GET /api/finance/export.csv` — **AUTH** (role: admin, finance) — resposta: **arquivo CSV** (`relatorio-aura-clinic.csv`).
- `GET /api/finance/export.pdf` — **AUTH** (role: admin, finance) — resposta: **arquivo PDF**.
- `GET /api/finance/export.xlsx` — **AUTH** (role: admin, finance) — resposta: **arquivo XLSX**.

## Termos digitais (`routes/terms.js`)
- `GET /api/digital-terms` — **AUTH** — resposta: lista de termos.
- `POST /api/digital-terms` — **AUTH** — corpo: `appointment_id`, `client_id`, `full_name`, `signature_data_url`, `orientations_confirmed` (obrigatórios) + dados do assinante (`social_name`, `document_number`, `birth_date`, `whatsapp`, `instagram`, `address`, `procedure`, `piercing_region`, `health_declaration`, `form_data`) — resposta: `201` termo (gera PDF e salva `pdf_url`).

## Pós-atendimento (`routes/postcare.js`)
- `GET /api/post-care` — **AUTH** — resposta: lista de acompanhamentos (garante followups pendentes).
- `PATCH /api/post-care/:id` — **AUTH** — **multipart** (`client_photo`) — corpo: `care_message`, `healing_status`, `client_notes`, `status` — resposta: acompanhamento atualizado.

## Catálogo público e customização (`routes/catalog.js`)
- `GET /api/catalog` — **PÚBLICO** (aceita `?t=<slug>`/`X-Tenant`) — resposta: catálogo público (`settings`, `theme`, `banners`, destaques, promoções, categorias, `items[]`; campos privados ocultos).
- `GET /api/catalog-customization` — **AUTH** (role: admin, reception) — resposta: customização + `products` + `inventoryOptions`.
- `PATCH /api/catalog-customization` — **AUTH** (role: admin, reception) — corpo: objeto de customização — resposta: customização atualizada.
- `POST /api/catalog-customization/publish` — **AUTH** (role: admin, reception) — corpo: customização — resposta: `{ ok:true, published_at, ... }`.
- `POST /api/catalog-customization/reset` — **AUTH** (role: admin) — resposta: customização resetada.
- `GET /api/catalog-settings` — **AUTH** (role: admin, reception) — resposta: settings + categorias.
- `PATCH /api/catalog-settings` — **AUTH** (role: admin, reception) — corpo (allowlist): `title`, `subtitle`, `hero_*`, `categories`, `whatsapp_phone`, `whatsapp_message`, `company_*`, `layout_style` — resposta: settings atualizados.

## Booking público (`routes/booking.js`, prefixo `/api/booking`, todas PÚBLICAS)
- `GET /api/booking/config` — **PÚBLICO** (usa `X-Tenant`) — resposta: `{ services, professionals, rules }`.
- `GET /api/booking/slots` — **PÚBLICO** — query: `service_id`, `professional_id`, `date` — resposta: `{ date, slots:[] }`.
- `POST /api/booking/requests` — **PÚBLICO** — **multipart** (`reference_photo`, `payment_proof`) — corpo: `service_id`, `professional_id`, `appointment_date`, `appointment_time`, `full_name`, `whatsapp` (obrigatórios), `instagram`, `notes` — resposta: `201` agendamento (status `pendente`).

## Opções, profissionais, disponibilidade e bloqueios
### Opções de inventário (`routes/options.js`)
- `GET /api/options` — **AUTH** — resposta: `{ professionals, jewelry, jewelryCategories, jewelrySubcategories, inventoryOptions }`.
- `POST /api/inventory-options` — **AUTH** (role: admin) — corpo: `type` (`category`/`size`/`thickness`), `name` — resposta: `201` opção.
- `PATCH /api/inventory-options/:id` — **AUTH** (role: admin) — corpo: `name` — resposta: opção atualizada (`409` duplicado).
- `DELETE /api/inventory-options/:id` — **AUTH** (role: admin) — resposta: `{ ok:true }` (`409` se em uso).

### Profissionais (`routes/professionals.js`)
- `POST /api/professionals` — **AUTH** (role: admin) — corpo: `name` (obrigatório), `specialty` — resposta: `201` profissional.
- `PATCH /api/professionals/:id` — **AUTH** (role: admin) — corpo: `name`, `specialty` — resposta: profissional atualizado.
- `DELETE /api/professionals/:id` — **AUTH** (role: admin) — resposta: `{ ok:true, archived:true|false }`.

### Disponibilidade (`routes/availability.js`)
- `GET /api/availability` — **AUTH** — resposta: disponibilidades por profissional.
- `PATCH /api/availability/:id` — **AUTH** (role: admin, reception) — corpo: `is_active`, `start_time`, `end_time`, `lunch_start`, `lunch_end`, `duration_minutes`, `buffer_minutes` — resposta: disponibilidade atualizada.

### Bloqueios de agenda (`routes/scheduleBlocks.js`)
- `GET /api/schedule-blocks` — **AUTH** — resposta: bloqueios (com `professional_name`).
- `POST /api/schedule-blocks` — **AUTH** (role: admin, reception) — corpo: `professional_id`, `start_datetime`, `end_datetime`, `reason`, `notes`, `is_full_day`, `is_recurring` — resposta: `201` bloqueio.
- `DELETE /api/schedule-blocks/:id` — **AUTH** (role: admin, reception) — resposta: `{ ok:true }`.

## Usuários (`routes/users.js`, todas role: admin)
- `GET /api/users` — **AUTH** (role: admin) — resposta: lista `{ id, name, email, role, created_at }`.
- `POST /api/users` — **AUTH** (role: admin) — corpo: `name`, `email`, `password` (mín. 8), `role` — resposta: `201` usuário (sem hash).
- `PATCH /api/users/:id` — **AUTH** (role: admin) — corpo: `name`, `email`, `role`, `password` (opcional, mín. 8) — resposta: usuário atualizado.
- `DELETE /api/users/:id` — **AUTH** (role: admin) — resposta: `{ ok:true }` (`409` se auto-exclusão ou último admin).

## Uploads (`routes/uploads.js`)
- `POST /api/uploads` — **AUTH** (role: admin, reception) — **multipart** (campo `file`) — resposta: `201 { url: "/uploads/<filename>" }` (`400` sem arquivo). Arquivos servidos em `/uploads/...`.

## Admin (`routes/admin.js`)
- `POST /api/admin/reset-demo-data` — **AUTH** (role: admin) — corpo: `{ confirmation: "RESETAR" }` — resposta: `{ ok:true, message, removed:{<tabela>:count} }`. Limpa dados de demonstração preservando usuários e configurações. **Bloqueado em produção** (`403`) salvo `ALLOW_DEMO_RESET=true`.

## Dashboard, ERP e alertas
- `GET /api/dashboard` (`routes/dashboard.js`) — **AUTH** — resposta: objeto agregado (estatísticas, agendamentos do dia, alertas, painel admin com rankings/finanças/aniversários).
- `GET /api/erp` (`routes/erp.js`) — **AUTH** (role: admin) — resposta: visão geral do produto/SaaS (métricas, módulos, CRM, itens de catálogo, mapa corporal, etc.).
- `GET /api/alerts` (`routes/alerts.js`) — **AUTH** — resposta: `{ count, items:[] }` (estoque baixo, aniversários, clientes frequentes).

## Health (`routes/health.js`, sem `X-Tenant`)
- `GET /api/health` — **PÚBLICO** — resposta: `{ ok:true, app, timestamp }`.
- `GET /api/health/db` — resposta: `{ ok, database }` (checa conexão com o banco; detalhes de erro só fora de produção).
