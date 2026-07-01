# Auditoria de Modelagem de Dados e Banco — Backend Multi-tenant

Data: 2026-07-01
Escopo: backend Postgres multi-tenant (um schema por clínica, `tenant_<id>`).
Natureza: análise somente-leitura. Nenhuma alteração de código foi feita.

Arquivos analisados:
- `backend/src/db/schema.sql` (schema de cada clínica)
- `backend/src/db/platformSchema.sql` (schema de controle `platform`)
- `backend/src/database/connection.js` (pool)
- `backend/src/db/sqliteCompat.js` (adaptador `get/all/run` com placeholders `?`)
- `backend/src/middleware/withDb.js` (client por requisição + `search_path`)
- `backend/src/middleware/tenant.js` (resolução do tenant)
- `backend/src/routes/*.js` e `backend/src/services/*.js`

---

## 1. Sumário executivo

O isolamento multi-tenant por `search_path` está **bem construído** no caminho principal: o `withDb` valida o schema por regex (`^tenant_\d+$`), o schema é **sempre** derivado do id inteiro do banco (nunca de input do usuário), o `search_path` é resetado no `finally` e a conexão é **destruída** (`release(true)`) se o reset falhar. Todo o app passa pelo adaptador `createDbAdapter(client)`. Esse eixo do sistema é sólido.

Os problemas concentram-se em **três frentes**:

1. **Ausência total de transações** em operações multi-passo. Criar agendamento+pagamento, criar venda+itens+pagamento, dar baixa de estoque (update de variante + movimento + sync do produto) e provisionar tenant executam vários `INSERT/UPDATE` sem `BEGIN/COMMIT`. Uma falha no meio deixa dados inconsistentes (venda sem itens, estoque baixado sem movimento, agendamento sem sinal registrado).

2. **Integridade referencial incompleta / exclusões que quebram.** Quase nenhuma FK tem `ON DELETE`. `DELETE FROM clients` (e `users`) roda direto, sem checar vínculos, então excluir um cliente com histórico **lança erro de violação de FK (500)** em vez de comportamento previsível. Não há órfãos (a FK bloqueia), mas a UX quebra e a operação é imprevisível conforme a tabela.

3. **Condições de corrida no estoque.** A baixa de estoque lê a quantidade, calcula em JS e regrava, sem `SELECT ... FOR UPDATE` nem transação. Sob concorrência (duas vendas/atendimentos simultâneos da mesma joia) há lost update — estoque pode ficar acima do real e vender item inexistente.

Complementarmente há decisões de **tipagem por compatibilidade** (datas como `TEXT`, booleanos como `INTEGER` 0/1, dinheiro como `DOUBLE PRECISION`) que carregam riscos concretos de comparação/ordenação e imprecisão monetária, além de **constraints ausentes** (status válidos, quantidades e valores não-negativos, unicidade de SKU por tabela) e **índices faltando** em várias colunas de FK e de filtro frequente.

---

## 2. Tabela de achados priorizados

| # | Severidade | Área | Achado | Local | Recomendação |
|---|-----------|------|--------|-------|--------------|
| 1 | **Alta** | Transações | `createSalesOrder` faz INSERT do pedido + N INSERTs de itens + INSERT de pagamento sem transação. Falha parcial → pedido sem itens / sem pagamento. | `services/sales.js:26-73` | Envolver em transação no client da requisição (`BEGIN`/`COMMIT`/`ROLLBACK`). |
| 2 | **Alta** | Race condition | Baixa de estoque lê quantidade, calcula em JS e regrava, sem lock nem transação. Lost update sob concorrência. | `services/appointments.js:117-143`; `routes/jewelry.js:126-148,158-184` | `SELECT ... FOR UPDATE` + transação; ou `UPDATE ... SET quantity = quantity - ?` atômico com `CHECK`. |
| 3 | **Alta** | Integridade / exclusão | `DELETE FROM clients` sem checar vínculos; FKs `appointments/payments/…→clients` sem `ON DELETE`. Excluir cliente com histórico → erro 500 (violação de FK). | `routes/clients.js:38`; `schema.sql:160,187,208,248,266,287,302,313` | Definir política explícita: arquivar (soft-delete) como em profissionais/joias, ou `ON DELETE` coerente por FK. |
| 4 | **Alta** | Transações | Provisionamento de tenant mistura dois clients: DDL/seed no `client` dedicado, mas o `DELETE` de rollback roda em `query()` (outro client do pool). Se o rollback falhar, sobra tenant "meio-criado". | `services/tenants.js:79-115` (esp. 102) | Executar todo o fluxo (incl. registro e rollback) de forma coordenada; idealmente transação única ou compensação garantida. |
| 5 | **Alta** | Transações | `POST /api/appointments`: INSERT do agendamento + INSERT do pagamento de sinal sem transação. Mesma coisa no fluxo de "atendido" (baixa+pagamento+followup+loyalty encadeados). | `routes/appointments.js:53-64,81-86`; `routes/booking.js:69-93` | Transação por operação de negócio. |
| 6 | **Média** | Dinheiro (tipo) | Todos os valores monetários são `DOUBLE PRECISION`. Somatórios financeiros (`buildFinanceReport`) acumulam erro de ponto flutuante. | `schema.sql` (price, *_value, amount, unit_price, cost/sale_value); `services/finance.js` | Migrar para `NUMERIC(12,2)` (registrar que hoje é escolha de compatibilidade SQLite). |
| 7 | **Média** | Datas (tipo) | Datas/horas são `TEXT`. Filtros usam `substr()`, `LIKE '2026-07%'`, comparação de string e `CAST(... AS date/timestamp)`. Frágil a formatos divergentes (`ISO com T` vs `espaço`, `paid_at` gravado como `slice(0,19)`). | `schema.sql` (appointment_date/time, paid_at, due_date, created_at…); `services/finance.js:5-71` | `DATE`/`TIME`/`TIMESTAMPTZ`. Registrar trade-off de compatibilidade. |
| 8 | **Média** | Constraints | Sem `CHECK` de status válidos em quase todas as tabelas (appointments.status, payments.status/payment_type, sales_orders.status, jewelry.status, etc.). Enums são texto livre. | `schema.sql` (status TEXT em várias) | `CHECK (status IN (...))` ou tabela de domínio. Único `CHECK` existente: `expenses.expense_type`, `platform.tenants.status`. |
| 9 | **Média** | Constraints | Sem `CHECK` de não-negatividade: `quantity`, `points`, `points_used`, `amount`, `*_value`, `discount_value`. Estoque negativo só é contido em JS (`Math.max(0, …)`), não no banco. | `schema.sql`; `routes/jewelry.js` | `CHECK (quantity >= 0)`, `CHECK (amount >= 0)` etc. |
| 10 | **Média** | Índices | FKs sem índice: `appointments.professional_id`, `appointments.service_id`, `appointments.jewelry_id`, `payments.client_id`, `sales_order_items.sales_order_id`, `sales_order_items.product_id`, `sales_orders.client_id/appointment_id`, `stock_movements.variant_id`, `professional_services.*`, `digital_terms.*`, `post_care_followups.*`, `catalog_featured_products.product_id`. | `schema.sql:407-417` (índices existentes) | Criar índices nas FKs e colunas de filtro/JOIN quentes. |
| 11 | **Média** | Booleanos (tipo) | Flags booleanas modeladas como `INTEGER` 0/1 (`active`, `is_active`, `is_*`, `stock_deducted`, `virtual_store_active`…). Perde validação (aceita 2, -1), depende de `boolNumber()` em JS. | `schema.sql` (múltiplas) | `BOOLEAN`. Registrar trade-off de compatibilidade. |
| 12 | **Média** | Modelagem | `procedure` textual duplica `service_id` em `appointments` (procedure copiado de `service.name` no booking). Denormalização sem sincronização: renomear serviço não atualiza o histórico. | `schema.sql:165`; `routes/booking.js:77` | Ao menos documentar como snapshot intencional; ou derivar via JOIN. |
| 13 | **Média** | JSON em TEXT | `gallery_urls`, `form_data`, `product_ids`/`category_ids` (promoções) guardam JSON serializado em `TEXT`. Sem validação, sem query estruturada. | `schema.sql:50,278,365-366`; `routes/jewelry.js:59,117` | `JSONB` onde fizer sentido; ou tabela filha para `product_ids`. |
| 14 | **Baixa** | N+1 | `listServices` roda 1 query por serviço para buscar `professional_ids`. | `services/appointments.js:29-35` | Buscar todos os vínculos em uma query e agrupar em memória (padrão já usado em `listClientsWithDetails`). |
| 15 | **Baixa** | N+1 / consistência | `ensureFollowupsForCompletedAppointments` percorre todos os atendimentos "atendido" e roda 3 INSERTs por atendimento em loop (chamado no `listPostCareFollowups`?). | `services/postcare.js:26-46` | Batch/`INSERT ... SELECT` com `ON CONFLICT DO NOTHING`. |
| 16 | **Baixa** | UNIQUE | `loyalty_points` UNIQUE por `(appointment_id, event_type)` — porém `appointment_id` é NULLable; eventos sem appointment não são desduplicados (NULL nunca colide). | `schema.sql:303,308` | Ciente do comportamento de NULL em UNIQUE; usar índice parcial se precisar dedupe global. |
| 17 | **Baixa** | Constraints | SKU: `jewelry_inventory.sku UNIQUE` e `jewelry_variants.sku UNIQUE` são unicidades **separadas** — um SKU pode existir na variação e em produto de outra linha sem colidir. Como cada tenant é um schema, a unicidade "por clínica" está OK, mas não há unicidade cruzada produto↔variante. | `schema.sql:79,96` | Se SKU deve ser único no catálogo inteiro, considerar unicidade unificada. |
| 18 | **Baixa** | Modelagem | `catalog_settings`/`catalog_theme` como key-value / linha única (`id=1`) — aceitável, mas `catalog_settings.value TEXT` guarda tipos variados sem tipagem. | `schema.sql:320-323,370-390` | OK para config; documentar. |

---

## 3. Detalhamento por eixo

### 3.1 Integridade referencial

**FKs presentes.** A maioria das relações centrais tem FK declarada (ver `schema.sql`):
`appointments→clients/professionals/jewelry_inventory`, `payments→appointments/clients`, `sales_orders→clients/appointments/users`, `sales_order_items→sales_orders/jewelry_inventory/services`, `client_medical_records→clients/appointments`, `digital_terms→appointments/clients`, `post_care_followups→appointments/clients`, `loyalty_points→clients/appointments`, `loyalty_redemptions→clients`, `procedures→services`.

**FKs ausentes (colunas que apontam para ids mas não são FK):**
- `appointments.jewelry_variant_id` — sem FK para `jewelry_variants(id)` (`schema.sql:163`).
- `appointments.service_id` — sem FK para `services(id)` (`schema.sql:164`).
- `stock_movements.variant_id` — sem FK para `jewelry_variants(id)` (`schema.sql:198`).
- `sales_order_items.product_variant_id` — sem FK (`schema.sql:225`).
- `loyalty_redemptions` — não vincula ao evento/appointment.

Consequência: esses campos podem apontar para variantes/serviços inexistentes sem que o banco reclame. `replaceJewelryVariants` (`services/inventory.js:162-174`) tenta compensar em JS checando uso antes de deletar variante, mas é defesa em software, não no banco.

**`ON DELETE` — só existe em 2 lugares:**
- `jewelry_variants.jewelry_id … ON DELETE CASCADE` (`schema.sql:95`).
- `procedures.service_id … ON DELETE CASCADE` (`schema.sql:395`).

Todas as demais FKs usam o padrão `NO ACTION`/`RESTRICT` implícito. **O que acontece ao excluir:**

- **Excluir cliente** (`routes/clients.js:38`): `DELETE FROM clients` direto, sem checagem. Se houver appointment/payment/medical_record/term/loyalty apontando, o Postgres **rejeita com erro de FK → 500** ("Erro interno"). Não vira órfão (bom), mas é comportamento imprevisível e sem mensagem clara. Contraste com profissionais (`routes/professionals.js:24-33`) e joias (`routes/jewelry.js:186-200`), que **checam vínculos e arquivam** (soft-delete). Cliente e usuário (`routes/users.js:56`) não seguem esse padrão.
- **Excluir serviço** (`routes/services.js:49-53`): não deleta, só desativa (`active_online_booking = 0`). Bom — mas `procedures.service_id` tem CASCADE, então uma exclusão real (se existisse) apagaria procedimentos silenciosamente.
- **Excluir joia com vínculo** (`routes/jewelry.js:186-200`): checa e arquiva. Sem vínculo, `DELETE` real dispara `ON DELETE CASCADE` das variantes — remove variantes junto (intencional).

**Recomendação:** padronizar exclusão como soft-delete (arquivar) onde há histórico clínico/financeiro (clientes sobretudo, por prontuário e fidelidade), e definir `ON DELETE` explícito e coerente em cada FK (`RESTRICT` para dados financeiros, `SET NULL` para vínculos opcionais como `sales_orders.appointment_id`).

### 3.2 Índices

**Existentes** (`schema.sql:407-417`): `clients(full_name)`, `appointments(appointment_date, appointment_time)`, `appointments(client_id)`, `jewelry_inventory(is_catalog_active, is_published)`, `jewelry_variants(jewelry_id)`, `stock_movements(jewelry_id)`, `payments(appointment_id)`, `loyalty_points(client_id)`, `client_medical_records(client_id)`, `expenses(due_date)`.

**Faltando** (colunas usadas em JOIN/WHERE quentes):
- `appointments.professional_id` — filtro em `GET /api/appointments` e em `availableBookingSlots` (`routes/appointments.js:22`, `services/appointments.js:54-58`).
- `appointments.service_id`, `appointments.jewelry_id`, `appointments.jewelry_variant_id` — JOINs de `listAppointments`.
- `payments.client_id` — usado em `buildFinanceReport`, `getClientLoyalty` e export CSV (`services/finance.js`, `routes/finance.js:40-47`).
- `sales_order_items.sales_order_id` — JOIN/`IN (...)` em `listSalesOrders` (`services/sales.js:95-100`).
- `sales_orders.client_id`, `sales_orders.appointment_id` — JOINs e filtros financeiros.
- `stock_movements.variant_id` — subquery de uso em `replaceJewelryVariants` (`services/inventory.js:165`).
- `professional_services(service_id)` e `(professional_id)` — `booking/config`, `listServices`.
- `schedule_blocks.professional_id`, `professional_availability` já tem UNIQUE(que serve de índice).
- `digital_terms.appointment_id/client_id`, `post_care_followups.client_id`, `loyalty_redemptions.client_id`.

Impacto: seq scans em tabelas que crescem (appointments, payments, stock_movements) por tenant. Como é multi-tenant por schema, cada clínica paga o custo isoladamente, mas continua sendo scan desnecessário.

### 3.3 Constraints (NOT NULL / UNIQUE / CHECK)

- **CHECK de status ausente** em praticamente tudo. Status é `TEXT` livre: `appointments.status` ('pendente'/'confirmado'/'atendido'/'cancelado'/'remarcado'/'recusado' — usados espalhados no código, sem enforcement), `payments.status`/`payment_type`, `sales_orders.status`/`order_type`/`source`, `jewelry.status`, `jewelry_variants.status`, `post_care_followups.status`/`healing_status`, `stock_movements.movement_type`. Único enforcement de enum: `expenses.expense_type CHECK IN ('fixa','variavel')` e `platform.tenants.status`.
- **CHECK de faixa/positividade ausente**: `quantity`, `low_stock_threshold`, `critical_stock_threshold`, `points`, `points_used`, `amount`, `price`, `*_value`, `discount_value` podem ser negativos no banco. A não-negatividade do estoque só existe em JS (`Math.max(0, …)` em `routes/jewelry.js:136,167` e `services/appointments.js:130`).
- **UNIQUE**: bem usados onde há intenção (`professional_services(professional_id, service_id)`, `professional_availability(professional_id, weekday)`, `inventory_options(type, name)`, `loyalty_points(appointment_id, event_type)`, `post_care_followups(appointment_id, reminder_day)`, `sku`). Ponto de atenção: `loyalty_points(appointment_id, event_type)` com `appointment_id` NULLable não desduplica eventos sem appointment.
- **NOT NULL**: majoritariamente presente. `signature_data_url NOT NULL` em `digital_terms` é adequado. `form_data TEXT NOT NULL DEFAULT ''` guarda JSON como string obrigatória — melhor `JSONB`.

### 3.4 Tipos (trade-offs de compatibilidade)

O cabeçalho de `schema.sql:1-4` declara explicitamente a escolha: `SERIAL` para ids, `DOUBLE PRECISION` para valores, `INTEGER` para flags 0/1, `TEXT` para datas/hora — "compatível com o comportamento atual dos handlers" (herança do SQLite). É uma **decisão consciente de compatibilidade**, mas com riscos concretos:

- **Dinheiro em `DOUBLE PRECISION`**: erro de ponto flutuante em somas (`buildFinanceReport` soma `amount`/`total_value` de muitas linhas; UNION ALL de receitas). Recomendação: `NUMERIC(12,2)`.
- **Datas/horas em `TEXT`**: comparação e ordenação como string funcionam só enquanto o formato for rigorosamente `YYYY-MM-DD`/`HH:MM`. O código mistura formatos: `paid_at` às vezes `new Date().toISOString().slice(0,19)` (com `T`), às vezes `${date}T${time}:00`; `movement_date` grava `slice(0,10)`. `buildFinanceReport` compensa com `substr()`, `LIKE`, `CAST(... AS date/timestamp)` — frágil. Sem validação temporal (o banco aceita `appointment_date = 'amanhã'`). Recomendação: `DATE`/`TIME`/`TIMESTAMPTZ`.
- **Booleanos em `INTEGER`**: aceita valores fora de {0,1}; depende de `boolNumber()`. Recomendação: `BOOLEAN`.

Registrar em ADR que a migração de tipos exige adaptar os handlers (que hoje assumem strings/números crus).

### 3.5 Isolamento multi-tenant

**Pontos fortes (confirmados):**
- `withDb` **reseta** `search_path TO public` no `finally` antes de `client.release()`, e se o reset falhar **destrói** a conexão com `client.release(true)` (`middleware/withDb.js:63-72`). Evita vazamento entre clínicas por client sujo.
- Schema **validado por regex** `^tenant_\d+$` antes de interpolar (`middleware/withDb.js:19,38-41`) e **sempre derivado do id inteiro** (`middleware/tenant.js:86`), nunca de input.
- Token amarra o tenant (`tslug`); header `X-Tenant` divergente → 403 (`middleware/tenant.js:57-62`).
- Todo o app passa pelo adaptador `createDbAdapter(client)` — não há `db` singleton global.

**Pontos de atenção:**
- **`services/tenants.js` e `routes/platform.js` usam `query()`** (client anônimo do pool, `search_path` public) **e** `pool.connect()` diretamente. É legítimo (operações de plataforma), mas convivem no mesmo fluxo: em `provisionTenant`, o DDL/seed roda no `client` dedicado enquanto o `DELETE` de rollback roda em `query()` (outro client) — não é o mesmo caminho transacional (ver achado #4).
- `routes/platform.js:179-193` faz `SET search_path TO "tenant_${tenant.id}"` com o **id numérico do registro do banco** (seguro), roda contagens e reseta no `finally` — padrão correto, replicado à mão fora do `withDb`. Consistente, porém duplicado; qualquer novo caminho manual precisa lembrar do reset.
- Não encontrei SELECT/INSERT do app rodando fora do adaptador dentro das rotas de tenant. As únicas queries fora do adaptador são as de plataforma (`platform.tenants`, `platform.platform_users`) e o provisionamento, que por natureza operam em `public`/DDL.

Conclusão: **isolamento sólido no caminho de requisição**. Risco residual está nos caminhos manuais de plataforma/provisionamento (duplicação da lógica de reset e ausência de transação no provisionamento).

### 3.6 Condições de corrida / consistência

- **Baixa de estoque** (`deductJewelryStock` `services/appointments.js:117-143`; movements em `routes/jewelry.js:126-184`): padrão *read-modify-write* em JS (`SELECT quantity` → `Math.max(0, q-1)` → `UPDATE quantity = ?`). Sem `FOR UPDATE` nem transação → **lost update** sob concorrência: duas requisições leem `q=1`, ambas gravam `q=0` mas só uma unidade real existia; ou vendem além do estoque. Recomendação: `UPDATE ... SET quantity = quantity - ?` atômico dentro de transação, com `CHECK (quantity >= 0)` para abortar se estourar.
- **`syncProductInventory`** (`services/inventory.js:179-206`) recalcula o agregado do produto a partir das variantes — se rodar concorrentemente com um movimento, pode gravar um agregado obsoleto. Deve fazer parte da mesma transação da baixa.
- **UNIQUE anti-duplicidade**: `loyalty_points(appointment_id, event_type)` e `post_care_followups(appointment_id, reminder_day)` com `ON CONFLICT DO NOTHING` (`services/loyalty.js`, `services/postcare.js`) — protegem bem contra reprocessamento do "atendido". Ressalva do NULL em loyalty (achado #16).
- **Multi-passo sem transação**: criar venda (achado #1), criar agendamento+sinal (achado #5), provisionar tenant (achado #4). Todos deixam janelas de inconsistência em falha parcial.
- **Registro do pagamento restante** (`registerRemainingPayment` `services/appointments.js:145-165`) checa existência antes de inserir — mas o par check-then-insert também é corrida (duas chamadas simultâneas podem inserir dois pagamentos "restante"). Não há UNIQUE em `payments(appointment_id, payment_type)`.

### 3.7 N+1 e queries pesadas

- **`listServices`** (`services/appointments.js:29-35`): 1 query base + 1 query por serviço para `professional_ids`. N+1. (achado #14)
- **`ensureFollowupsForCompletedAppointments`** (`services/postcare.js:26-31`): itera todos os atendimentos "atendido" chamando `ensurePostCareFollowups` (3 INSERTs cada) em loop. Cresce com o histórico. (achado #15)
- **`buildFinanceReport`** (`services/finance.js`): ~12 queries com `substr()`/`LIKE`/`UNION ALL` sobre `payments`+`sales_orders` sem índice em `paid_at`/`created_at` (são `TEXT`, e índices em `expenses.due_date` existe mas não em payments). Pesado à medida que os pagamentos crescem.
- **Positivo**: `listClientsWithDetails` (`services/clients.js`) já elimina o N+1 antigo com queries em batch — bom padrão a replicar.

### 3.8 Modelagem

- **Denormalização não sincronizada**: `appointments.procedure`/`description`/`piercing_region` são preenchidos com `service.name`/`service.description` no booking (`routes/booking.js:77-79`) além de existir `service_id`. Renomear o serviço não reflete no histórico. Se for snapshot intencional, documentar; senão derivar por JOIN.
- **Enums como texto livre**: ver 3.3 — status/tipos sem `CHECK`.
- **JSON em `TEXT`**: `gallery_urls`, `form_data`, `product_ids`/`category_ids` (achado #13). `catalog_promotions.product_ids/category_ids` como CSV/JSON impede JOIN e integridade — deveria ser tabela de junção.
- **`image_url` vs `photo_url`** coexistem em `jewelry_inventory` (`schema.sql:48-49`) — possível redundância/legado.

---

## 4. Recomendações priorizadas (resumo acionável)

1. **Introduzir transações** no client da requisição para todas as operações multi-passo: venda+itens+pagamento, agendamento+sinal, fluxo "atendido" (baixa+pagamento+followup+loyalty), provisionamento de tenant. O adaptador já opera sobre um único `client` — basta expor `BEGIN/COMMIT/ROLLBACK` (ou um helper `withTransaction(db, fn)`).
2. **Tornar a baixa de estoque atômica**: `UPDATE ... SET quantity = quantity - ?` dentro de transação + `CHECK (quantity >= 0)`, eliminando o read-modify-write em JS.
3. **Padronizar exclusões**: soft-delete/arquivar para clientes e usuários (como já em profissionais/joias) e definir `ON DELETE` explícito em cada FK.
4. **Adicionar índices** nas FKs e colunas de filtro/JOIN listadas em 3.2.
5. **Adicionar `CHECK`** de status válidos e de não-negatividade (quantidades, valores, pontos).
6. **Planejar migração de tipos** (ADR): `NUMERIC(12,2)` para dinheiro, `DATE/TIME/TIMESTAMPTZ` para tempo, `BOOLEAN` para flags, `JSONB` para os campos JSON — adaptando os handlers.
7. **Eliminar N+1 residuais** (`listServices`, `ensureFollowupsForCompletedAppointments`).
8. **Adicionar UNIQUE** em `payments(appointment_id, payment_type)` (ou equivalente) para blindar duplicidade de sinal/restante.

---

## 5. Os 5 achados mais críticos

1. **Ausência de transações em operações multi-passo** — venda+itens+pagamento (`services/sales.js:26-73`), agendamento+sinal (`routes/appointments.js`), provisionamento de tenant (`services/tenants.js`). Falha parcial deixa dados inconsistentes.
2. **Race condition na baixa de estoque** — read-modify-write em JS sem lock/transação (`services/appointments.js:117-143`, `routes/jewelry.js:126-184`). Lost update; venda acima do estoque real.
3. **Exclusão de cliente sem checagem + FKs sem `ON DELETE`** — `DELETE FROM clients` (`routes/clients.js:38`) quebra com 500 quando há histórico; comportamento imprevisível e divergente do soft-delete usado em profissionais/joias.
4. **Rollback de provisionamento inconsistente** — DDL/seed no client dedicado, `DELETE` de rollback em outro client (`services/tenants.js:102`); sem transação única, pode restar tenant "meio-criado".
5. **Dinheiro em `DOUBLE PRECISION` + datas em `TEXT`** — imprecisão monetária nos relatórios financeiros e fragilidade de filtros temporais baseados em `substr`/`LIKE`/`CAST` sobre string (`services/finance.js`), agravada por formatos de data inconsistentes gravados pelos handlers.
