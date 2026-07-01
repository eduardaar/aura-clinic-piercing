# Modelo de dados

Este documento descreve o modelo de dados da **Aura Clinic Piercing**. O banco é PostgreSQL, organizado por schemas (multi-tenant): um schema de controle `platform` e um schema `tenant_<id>` por clínica.

- **Fonte do schema de controle**: `backend/src/db/platformSchema.sql`
- **Fonte do schema de clínica**: `backend/src/db/schema.sql`

Convenções do schema de clínica (herdadas da compatibilidade estilo SQLite):

- IDs são `SERIAL` (`id` como chave primária, salvo indicação em contrário).
- Valores monetários e físicos usam `DOUBLE PRECISION`.
- Flags booleanas são `INTEGER` com convenção `0`/`1`.
- Datas e horas são frequentemente armazenadas como `TEXT` (string), refletindo o comportamento dos handlers. `created_at` costuma ter default `to_char(now(), 'YYYY-MM-DD HH24:MI:SS')`.

> Observação: o schema de clínica **não** possui coluna `tenant_id`. O isolamento é físico, por schema Postgres (ver `docs/ARQUITETURA.md`).

---

## Schema `platform` (controle da plataforma)

### `platform.tenants` — clínicas cadastradas
Cadastro de cada clínica (tenant) da plataforma. O schema Postgres de cada clínica é derivado do `id` (`tenant_<id>`), nunca de input do usuário.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | SERIAL PK | Base do nome do schema (`tenant_<id>`). |
| `name` | TEXT | Nome da clínica. |
| `slug` | TEXT UNIQUE | Identificador público/URL (usado em `X-Tenant` e `?t=`). |
| `status` | TEXT | `ativo` ou `suspenso` (CHECK). Clínica suspensa → `403`. |
| `plan` | TEXT | Plano contratado (default `padrao`). |
| `created_at` | TIMESTAMPTZ | Default `now()`. |

### `platform.platform_users` — super-admins da plataforma
Usuários do painel de plataforma (super-admins). São separados dos usuários das clínicas: tokens de plataforma não acessam clínicas e vice-versa.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | SERIAL PK | |
| `name` | TEXT | |
| `email` | TEXT UNIQUE | Login do super-admin. |
| `password_hash` | TEXT | bcrypt. |
| `role` | TEXT | Default `superadmin`. |
| `created_at` | TIMESTAMPTZ | Default `now()`. |

---

## Schema de clínica (`tenant_<id>`)

Cada clínica tem o conjunto completo de tabelas abaixo, no seu próprio schema.

### Usuários e equipe

#### `users` — usuários da clínica
Contas de acesso ao sistema da clínica.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | SERIAL PK | |
| `name` | TEXT | |
| `email` | TEXT UNIQUE | Login. |
| `password_hash` | TEXT | bcrypt. |
| `role` | TEXT | `admin` (default), `reception`, `finance`, `piercer`. |
| `created_at` | TEXT | |

#### `professionals` — profissionais (piercers)
Profissionais que executam os atendimentos.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | SERIAL PK | |
| `name` | TEXT | |
| `specialty` | TEXT | Especialidade. |
| `active` | INTEGER | Flag 0/1 (default 1). |
| `photo_url` | TEXT | Foto. |

#### `professional_services` — profissional ↔ serviço (N:N)
Quais serviços cada profissional executa.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | SERIAL PK | |
| `professional_id` | INTEGER FK → `professionals(id)` | |
| `service_id` | INTEGER FK → `services(id)` | |
| — | UNIQUE(`professional_id`, `service_id`) | |

#### `professional_availability` — disponibilidade semanal
Janela de atendimento de cada profissional por dia da semana.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | SERIAL PK | |
| `professional_id` | INTEGER FK → `professionals(id)` | |
| `weekday` | INTEGER | Dia da semana. |
| `is_active` | INTEGER | Flag 0/1. |
| `start_time` / `end_time` | TEXT | Ex.: `09:00`/`18:00`. |
| `lunch_start` / `lunch_end` | TEXT | Intervalo de almoço. |
| `duration_minutes` | INTEGER | Duração padrão do slot. |
| `buffer_minutes` | INTEGER | Intervalo entre atendimentos. |
| — | UNIQUE(`professional_id`, `weekday`) | |

#### `schedule_blocks` — bloqueios de agenda
Períodos em que um profissional não atende (folga, ausência, feriado).

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | SERIAL PK | |
| `professional_id` | INTEGER FK → `professionals(id)` | |
| `start_datetime` / `end_datetime` | TEXT | Início/fim do bloqueio. |
| `reason` | TEXT | Motivo. |
| `notes` | TEXT | |
| `is_full_day` | INTEGER | Flag 0/1. |
| `is_recurring` | INTEGER | Flag 0/1. |

### Serviços e procedimentos

#### `services` — serviços oferecidos
Serviços da clínica (base para agendamento online e preço).

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | SERIAL PK | |
| `name` | TEXT | |
| `description` | TEXT | |
| `duration_minutes` | INTEGER | Default 40. |
| `price` | DOUBLE | |
| `deposit_value` | DOUBLE | Valor do sinal. |
| `active_online_booking` | INTEGER | Flag 0/1 — disponível no agendamento online. |
| `pre_service_notes` | TEXT | Orientações pré-serviço. |
| `created_at` | TEXT | |

#### `procedures` — procedimentos
Procedimentos consumidos pela tela de agenda/serviços (pode vincular-se a um serviço).

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | SERIAL PK | |
| `service_id` | INTEGER FK → `services(id)` ON DELETE CASCADE | Opcional. |
| `name` | TEXT | |
| `body_area` | TEXT | Região do corpo. |
| `description` | TEXT | |
| `price` | DOUBLE | |
| `duration_minutes` | INTEGER | Default 40. |
| `aftercare_instructions` | TEXT | Cuidados pós. |
| `is_active` | INTEGER | Flag 0/1. |
| `created_at` / `updated_at` | TEXT | |

### Clientes e agenda

#### `clients` — clientes
Cadastro de clientes.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | SERIAL PK | |
| `full_name` | TEXT | Indexado. |
| `whatsapp` | TEXT | |
| `instagram` | TEXT | |
| `notes` | TEXT | |
| `birth_date` | TEXT | |
| `created_at` | TEXT | |

#### `appointments` — agendamentos/atendimentos
Núcleo operacional: um agendamento vincula cliente, profissional, joia/serviço e valores.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | SERIAL PK | |
| `client_id` | INTEGER FK → `clients(id)` | |
| `professional_id` | INTEGER FK → `professionals(id)` | |
| `jewelry_id` | INTEGER FK → `jewelry_inventory(id)` | Opcional. |
| `jewelry_variant_id` | INTEGER | Variação da joia (sem FK formal). |
| `service_id` | INTEGER | Serviço (sem FK formal). |
| `procedure` | TEXT | Nome do procedimento. |
| `description` | TEXT | |
| `piercing_region` | TEXT | Região do piercing. |
| `appointment_date` / `appointment_time` | TEXT | Data/hora (indexados). |
| `end_time` | TEXT | |
| `total_value` / `deposit_value` / `remaining_value` | DOUBLE | Total, sinal e saldo. |
| `deposit_payment_method` / `remaining_payment_method` | TEXT | Formas de pagamento. |
| `status` | TEXT | `pendente` (default), `atendido`, etc. |
| `notes` | TEXT | |
| `reference_photo_url` / `payment_proof_url` | TEXT | Comprovantes/fotos. |
| `stock_deducted` | INTEGER | Flag 0/1 — se já baixou estoque. |
| `created_at` | TEXT | |

#### `payments` — pagamentos
Registros de pagamento associados a um agendamento.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | SERIAL PK | |
| `appointment_id` | INTEGER FK → `appointments(id)` | Indexado. |
| `client_id` | INTEGER FK → `clients(id)` | |
| `amount` | DOUBLE | |
| `payment_type` | TEXT | Ex.: sinal/saldo. |
| `method` | TEXT | Forma de pagamento. |
| `status` | TEXT | Default `pago`. |
| `paid_at` | TEXT | |

### Estoque de joalherias

#### `jewelry_inventory` — produtos (joias)
Produto "pai" do estoque/catálogo. Tabela ampla, com dados de estoque, catálogo público, SEO e frete.

Campos principais:
- **Identificação**: `name`, `sku` (UNIQUE), `category`, `subcategory`, `variant_group`, `variation_label`.
- **Atributos físicos**: `material`, `color`, `stone`, `size`, `thickness`, `stem_length`, `thread_type`, `piercing_type`, `weight_grams`, dimensões de pacote (`package_length_cm`, `package_width_cm`, `package_height_cm`, `package_type`).
- **Mídia**: `photo_url`, `image_url`, `gallery_urls`.
- **Estoque**: `quantity`, `cost_value`, `sale_value`, `supplier`, `physical_location`, `status` (default `disponível`), `low_stock_threshold`, `critical_stock_threshold`.
- **Catálogo/virtual store**: `virtual_store_active`, `preparation_days`, `shipping_info`, `seo_title`, `seo_description`, `freight_notes`, `is_catalog_active`, `is_featured`, `is_new`, `is_most_wanted`, `is_promotion`, `is_last_units`, `is_published` (flags 0/1).
- **Notas**: `notes`.

#### `jewelry_variants` — variações de produto
Variações (SKU por combinação de atributos) de um produto. O estoque real fica nas variações e é sincronizado de volta ao produto pai.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | SERIAL PK | |
| `jewelry_id` | INTEGER FK → `jewelry_inventory(id)` ON DELETE CASCADE | Indexado. |
| `sku` | TEXT UNIQUE | |
| `variation_name` | TEXT | |
| `material`, `color`, `stone_color`, `side`, `size`, `thickness`, `length`, `diameter`, `thread_type`, `supplier` | TEXT | Atributos. |
| `cost_value` / `sale_value` | DOUBLE | |
| `quantity` | INTEGER | Estoque da variação. |
| `low_stock_threshold` | INTEGER | Default 5. |
| `status` | TEXT | Default `disponível`. |
| `is_active` | INTEGER | Flag 0/1. |
| `created_at` / `updated_at` | TEXT | |

#### `stock_movements` — movimentações de estoque
Histórico de entradas/saídas de estoque.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | SERIAL PK | |
| `jewelry_id` | INTEGER FK → `jewelry_inventory(id)` | Indexado. |
| `variant_id` | INTEGER | Variação (sem FK formal). |
| `movement_type` | TEXT | Tipo (entrada/saída/ajuste). |
| `quantity` | INTEGER | |
| `notes` | TEXT | |
| `movement_date` / `created_at` | TEXT | |

#### `inventory_options` — opções de inventário
Listas auxiliares (categorias, tamanhos, espessuras) editáveis por clínica.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | SERIAL PK | |
| `type` | TEXT | Ex.: `category`, `size`, `thickness`. |
| `name` | TEXT | |
| `created_at` | TEXT | |
| — | UNIQUE(`type`, `name`) | |

### Vendas e financeiro

#### `sales_orders` — pedidos de venda
Ordens de venda (produtos e/ou serviços), podendo originar-se do site ou balcão.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | SERIAL PK | |
| `client_id` | INTEGER FK → `clients(id)` | |
| `appointment_id` | INTEGER FK → `appointments(id)` | Opcional. |
| `order_type` | TEXT | Default `produto`. |
| `source` | TEXT | Default `site`. |
| `status` | TEXT | Default `aberta`. |
| `payment_method` | TEXT | |
| `total_value` | DOUBLE | |
| `notes` | TEXT | |
| `created_by_user_id` | INTEGER FK → `users(id)` | Quem criou. |
| `created_at` | TEXT | |

#### `sales_order_items` — itens do pedido
Linhas de um pedido de venda.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | SERIAL PK | |
| `sales_order_id` | INTEGER FK → `sales_orders(id)` | |
| `item_type` | TEXT | Default `produto`. |
| `product_id` | INTEGER FK → `jewelry_inventory(id)` | Opcional. |
| `product_variant_id` | INTEGER | Variação (sem FK formal). |
| `service_id` | INTEGER FK → `services(id)` | Opcional. |
| `item_name` | TEXT | |
| `quantity` | INTEGER | Default 1. |
| `unit_price` | DOUBLE | |
| `notes` | TEXT | |

#### `expenses` — despesas
Despesas da clínica (fixas e variáveis).

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | SERIAL PK | |
| `description` | TEXT | |
| `expense_type` | TEXT | `fixa` ou `variavel` (CHECK). |
| `category` | TEXT | |
| `amount` | DOUBLE | |
| `due_date` | TEXT | Indexado. |
| `status` | TEXT | Default `paga`. |
| `payment_method` | TEXT | |
| `notes` | TEXT | |
| `created_at` | TEXT | |

### Prontuário, termos e pós-atendimento

#### `client_medical_records` — prontuário do cliente
Histórico clínico/piercing do cliente (opcionalmente ligado a um atendimento).

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | SERIAL PK | |
| `client_id` | INTEGER FK → `clients(id)` | Indexado. |
| `appointment_id` | INTEGER FK → `appointments(id)` | Opcional. |
| `record_date` | TEXT | |
| `piercing_history` | TEXT | |
| `jewelry_used` | TEXT | |
| `before_photo_url` / `after_photo_url` | TEXT | |
| `occurrences` | TEXT | Ocorrências. |
| `guidance` | TEXT | Orientações. |
| `allergies_notes` | TEXT | |
| `healing_evolution` | TEXT | |
| `returns_done` | TEXT | Retornos realizados. |
| `created_at` | TEXT | |

#### `digital_terms` — termos digitais assinados
Termo de consentimento assinado digitalmente (gera PDF).

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | SERIAL PK | |
| `appointment_id` | INTEGER FK → `appointments(id)` | |
| `client_id` | INTEGER FK → `clients(id)` | |
| `full_name`, `social_name`, `document_number`, `birth_date`, `whatsapp`, `instagram`, `address` | TEXT | Dados do assinante. |
| `procedure` / `piercing_region` | TEXT | |
| `orientations_confirmed` | INTEGER | Flag 0/1. |
| `health_declaration` | TEXT | |
| `form_data` | TEXT | Dados do formulário (serializados). |
| `signature_data_url` | TEXT | Assinatura (data URL). |
| `pdf_url` | TEXT | PDF gerado. |
| `signed_at` | TEXT | |

#### `post_care_followups` — pós-atendimento
Lembretes de cuidado pós-procedimento e retorno do cliente.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | SERIAL PK | |
| `appointment_id` | INTEGER FK → `appointments(id)` | |
| `client_id` | INTEGER FK → `clients(id)` | |
| `reminder_day` | INTEGER | Dia do lembrete. |
| `due_date` | TEXT | |
| `care_message` | TEXT | Mensagem de cuidado. |
| `healing_status` | TEXT | Default `aguardando retorno`. |
| `client_photo_url` / `client_notes` | TEXT | Retorno do cliente. |
| `status` | TEXT | Default `pendente`. |
| `created_at` / `updated_at` | TEXT | |
| — | UNIQUE(`appointment_id`, `reminder_day`) | |

### Fidelidade (Aura Rewards)

#### `loyalty_points` — pontos ganhos
Créditos de pontos de fidelidade (ex.: 10 pts por procedimento atendido, 5 pts por compra de joia).

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | SERIAL PK | |
| `client_id` | INTEGER FK → `clients(id)` | Indexado. |
| `appointment_id` | INTEGER FK → `appointments(id)` | Opcional. |
| `points` | INTEGER | |
| `event_type` | TEXT | Ex.: `procedimento`, `compra_joia`. |
| `description` | TEXT | |
| `created_at` | TEXT | |
| — | UNIQUE(`appointment_id`, `event_type`) | Evita pontuar duas vezes o mesmo evento. |

#### `loyalty_redemptions` — resgates
Resgates de pontos (desconto).

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | SERIAL PK | |
| `client_id` | INTEGER FK → `clients(id)` | |
| `points_used` | INTEGER | |
| `discount_value` | DOUBLE | |
| `notes` | TEXT | |
| `redeemed_at` | TEXT | |

### Catálogo público (`catalog_*`)

#### `catalog_settings` — configurações chave-valor
Configurações genéricas do catálogo.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `key` | TEXT PK | Chave (PK — não é `id`). |
| `value` | TEXT | Valor. |

#### `catalog_banners` — banners
Banners do catálogo público.

Campos: `id`, `title`, `subtitle`, `image_url`, `button_text`, `button_link`, `banner_width`, `banner_height`, `banner_fit` (default `cover`), `is_active`, `sort_order`.

#### `catalog_featured_categories` — categorias em destaque
Campos: `id`, `category_id` (TEXT), `public_name`, `icon`, `image_url`, `is_active`, `sort_order`.

#### `catalog_featured_products` — produtos em destaque
Campos: `id`, `product_id` (FK → `jewelry_inventory(id)`), `badge`, `is_active`, `sort_order`.

#### `catalog_promotions` — promoções
Campos: `id`, `name`, `discount_type` (default `percent`), `discount_value`, `start_date`, `end_date`, `applies_to` (default `products`), `product_ids` (TEXT), `category_ids` (TEXT), `is_active`.

#### `catalog_theme` — tema do catálogo (linha única)
Aparência do catálogo público. Linha única (`id INTEGER PK CHECK (id = 1)`), criada no provisionamento.

Campos principais: `brand_name`, `slogan`, `logo_url`, cores (`primary_color`, `secondary_color`, `background_color`, `button_color`), fontes (`title_font`, `body_font`), `theme` (default `premium`), flags de exibição de estoque (`show_out_of_stock`, `show_stock_quantity`, `stock_display_mode`), botões (`show_whatsapp_button`, `show_schedule_button`, `show_buy_button`, `show_favorites`) e `footer_text`.

---

## Índices de apoio (schema de clínica)

Definidos ao final de `schema.sql`:

- `idx_clients_full_name` em `clients(full_name)`
- `idx_appointments_date` em `appointments(appointment_date, appointment_time)`
- `idx_appointments_client` em `appointments(client_id)`
- `idx_jewelry_catalog` em `jewelry_inventory(is_catalog_active, is_published)`
- `idx_jewelry_variants_jewelry` em `jewelry_variants(jewelry_id)`
- `idx_stock_movements_jewelry` em `stock_movements(jewelry_id)`
- `idx_payments_appointment` em `payments(appointment_id)`
- `idx_loyalty_points_client` em `loyalty_points(client_id)`
- `idx_medical_records_client` em `client_medical_records(client_id)`
- `idx_expenses_due` em `expenses(due_date)`

---

## Diagrama ER (descrição textual)

Relações do schema de controle:

- Cada **clínica** (`platform.tenants`) corresponde a um schema `tenant_<id>` com todas as tabelas abaixo. **`platform.platform_users`** é independente (super-admins), sem FK para tenants.

Relações dentro de um schema de clínica (quem referencia quem):

- **`clients`** é o hub de relacionamento do cliente. É referenciado por: `appointments`, `payments`, `sales_orders`, `client_medical_records`, `digital_terms`, `post_care_followups`, `loyalty_points`, `loyalty_redemptions`.
- **`appointments`** é o hub operacional. Referencia `clients` e `professionals` (obrigatórios) e `jewelry_inventory` (opcional). É referenciado por: `payments`, `sales_orders`, `client_medical_records`, `digital_terms`, `post_care_followups`, `loyalty_points` (todos via `appointment_id`).
- **`professionals`** é referenciado por `appointments`, `professional_services`, `professional_availability` e `schedule_blocks`.
- **`services`** é referenciado por `procedures` (ON DELETE CASCADE), `professional_services`, `sales_order_items` e, informalmente, por `appointments.service_id`.
- **`jewelry_inventory`** (produto pai) é referenciado por `jewelry_variants` (ON DELETE CASCADE), `stock_movements`, `catalog_featured_products`, `sales_order_items.product_id` e `appointments.jewelry_id`. As variações de estoque (`jewelry_variants`) são referenciadas informalmente por `appointments.jewelry_variant_id`, `stock_movements.variant_id` e `sales_order_items.product_variant_id` (sem FK formal).
- **`sales_orders`** referencia `clients`, `appointments` (opcional) e `users` (`created_by_user_id`); é referenciado por `sales_order_items`.
- **`users`** é referenciado por `sales_orders.created_by_user_id`.
- **Fidelidade**: `loyalty_points` e `loyalty_redemptions` referenciam `clients`; `loyalty_points` também referencia `appointments` (opcional) com UNIQUE(`appointment_id`, `event_type`).
- **Catálogo**: `catalog_featured_products` referencia `jewelry_inventory`; `catalog_theme`, `catalog_settings`, `catalog_banners`, `catalog_featured_categories` e `catalog_promotions` são independentes (configuração), sem FKs para as tabelas de negócio.

> Nota: várias colunas de "variação" (`jewelry_variant_id`, `variant_id`, `product_variant_id`) e alguns `service_id` são inteiros **sem constraint FK formal** no schema; a integridade dessas ligações é mantida na camada de aplicação (services de inventário/vendas).
