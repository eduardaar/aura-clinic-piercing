# Aura Clinic Piercing

Sistema de gestão da Aura Clinic Piercing: agenda, estoque de joalherias, catálogo público, clientes, financeiro, prontuários, termos digitais, pós-atendimento, fidelidade e acessos administrativos.

O repositório é um **monorepo com dois projetos independentes**:

```text
backend/    API Node.js + Express, banco PostgreSQL
frontend/   SPA React + Vite
```

## Tecnologias

- Frontend: React + Vite
- Backend: Node.js + Express
- Banco: **PostgreSQL**
- Uploads locais: `backend/src/data/uploads`
- Autenticação: token HMAC assinado no login, enviado via `Authorization: Bearer`

## Pré-requisitos

- Node.js 18+
- PostgreSQL 14+ em execução

## Configuração

1. Crie o banco:

   ```bash
   createdb aura_clinic   # ou: psql -U postgres -c "CREATE DATABASE aura_clinic;"
   ```

2. Configure o backend — copie `backend/.env.example` para `backend/.env` e ajuste:

   ```env
   DATABASE_URL=postgres://postgres:SUA_SENHA@localhost:5432/aura_clinic
   AUTH_SECRET=<gere com: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
   ```

3. Configure o frontend — copie `frontend/.env.example` para `frontend/.env` (o padrão já aponta para `http://localhost:4000/api`).

O schema (`backend/src/db/schema.sql`) é aplicado automaticamente no boot do backend.

## Como rodar

Instale as dependências dos dois projetos e da raiz:

```bash
npm run install:all
```

Suba backend + frontend juntos:

```bash
npm run dev
```

Ou individualmente:

```bash
npm --prefix backend run dev     # API em :4000
npm --prefix frontend run dev    # SPA em :5173
```

Acesse:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:4000`
- Health check: `http://localhost:4000/api/health` e `/api/health/db`

## Login

- Usuário admin: `admin@auraclinic.com` — senha padrão `aura123` (**troque em produção**).
- Em desenvolvimento local a API libera acesso administrativo sem token para agilizar; em produção (`NODE_ENV=production`) o token é obrigatório em todas as rotas protegidas.

## Estrutura

```text
backend/
  src/
    index.js              API Express, rotas, autenticação e regras de negócio
    database/connection.js Pool PostgreSQL
    db/
      schema.sql          Schema unificado do PostgreSQL
      sqliteCompat.js     Camada de acesso (get/all/run) sobre o pool
    text-normalizer.js    Normalização de texto em respostas
    data/uploads/         PDFs e imagens enviadas
  .env                    Config do backend (não versionado)
frontend/
  src/
    main.jsx              Aplicação React (telas e componentes)
    lib/, components/, features/, pages/
    styles.css            Identidade visual e responsividade
  index.html, vite.config.js
  .env                    Config do frontend (não versionado)
```

## Banco de dados

PostgreSQL (`aura_clinic`). Tabelas principais:

- `users`, `professionals`, `services`, `procedures`
- `clients`, `appointments`, `payments`
- `jewelry_inventory`, `jewelry_variants`, `stock_movements`, `inventory_options`
- `sales_orders`, `sales_order_items`, `expenses`
- `client_medical_records`, `digital_terms`, `post_care_followups`
- `loyalty_points`, `loyalty_redemptions`
- `catalog_settings`, `catalog_banners`, `catalog_featured_categories`, `catalog_promotions`, `catalog_theme`

Para limpar os dados de demonstração preservando usuários e configurações, use o endpoint administrativo `POST /api/admin/reset-demo-data`.

## Níveis de acesso

- `admin`: acessa tudo
- `reception`: agenda, agendamentos e clientes
- `finance`: financeiro e relatórios
- `piercer`: atendimentos, clientes, prontuários e pós-atendimento

## Rotas principais

- `POST /api/login`
- `GET /api/health`, `GET /api/health/db`
- `GET /api/dashboard`, `GET /api/erp`, `GET /api/alerts`
- `GET/POST/PATCH/DELETE /api/appointments`
- `GET/POST/PATCH/DELETE /api/jewelry` e `/api/jewelry/:id/movements`
- `GET/POST/PUT/DELETE /api/procedures`
- `GET/POST/PUT/DELETE /api/clients`
- `GET /api/catalog`, `GET /api/booking/slots`
- `GET /api/finance`, `GET /api/finance/export.{csv,pdf,xlsx}`
- `GET/POST/PATCH/DELETE /api/users`

## Segurança e acesso

### Rotas públicas (sem autenticação)
- `/catalogo`, `/agendar`, `/comprar` (e os endpoints `GET /api/catalog`, `/api/booking/*`, `POST /api/sales-orders/public`)

### Proteção de dados
O catálogo público expõe apenas nome, foto, categoria, material, tamanho, cor, preço final e disponibilidade. Ficam **ocultos**: custo, lucro, fornecedor, observações internas, localização física, dados de clientes e financeiro.

### Produção
- Use HTTPS.
- Defina `AUTH_SECRET` forte e `NODE_ENV=production` (torna o token obrigatório).
- Restrinja `CORS_ORIGIN` ao domínio do frontend.
- Troque a senha do admin.
