# Aura Clinic Piercing

Sistema de gestão (SaaS) para estúdios de piercing: agenda, estoque de joalherias, catálogo público, clientes, financeiro, prontuários, termos digitais, pós-atendimento, fidelidade e acessos administrativos.

O repositório é um **monorepo com dois projetos independentes**:

```text
backend/    API Node.js + Express, banco PostgreSQL (multi-tenant por schema)
frontend/   SPA React + Vite
```

## Tecnologias

- Frontend: React + Vite
- Backend: Node.js + Express
- Banco: **PostgreSQL multi-tenant** — cada clínica vive em um schema próprio (`tenant_<id>`), com isolamento físico dos dados
- Uploads locais: `backend/src/data/uploads`
- Autenticação: token HMAC assinado no login (carrega a clínica), enviado via `Authorization: Bearer`

## Multi-tenant (SaaS)

- **Cadastro da clínica**: página pública `/cadastro` (`POST /api/signup`) cria a clínica, provisiona o schema e o admin dela. Pode ser desabilitado com `ALLOW_PUBLIC_SIGNUP=false`.
- **Identificação da clínica**: toda chamada à API leva o header `X-Tenant: <slug>` (o frontend faz isso automaticamente) ou usa a clínica embutida no token. Links públicos por clínica: `/catalogo?t=<slug>`.
- **Login**: informa o código da clínica + e-mail + senha em `/login`.
- **Painel da plataforma (super-admin)**: página `/plataforma` — listar, criar, suspender/reativar e excluir clínicas, além de métricas. Login separado (`platform.platform_users`).
- **Isolamento**: cada requisição usa uma conexão dedicada do pool com `search_path` apontando para o schema da clínica, com reset garantido antes de devolver ao pool. Verificado por `backend/scripts/test-isolation.mjs` (9 checagens, incluindo token cruzado e suspensão).
- **Migrations**: no boot, o backend garante o schema `platform` e aplica o `schema.sql` (idempotente) em todos os schemas de clínica.

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

   # Multi-tenant
   DEFAULT_TENANT=aura                      # clínica assumida quando não há X-Tenant (omita em produção multi-clínica)
   PLATFORM_ADMIN_EMAIL=voce@dominio.com    # superadmin da plataforma (obrigatório em produção)
   PLATFORM_ADMIN_PASSWORD=senha-forte
   ALLOW_PUBLIC_SIGNUP=true                 # "false" desabilita o cadastro público de clínicas
   ```

3. Configure o frontend — copie `frontend/.env.example` para `frontend/.env` (o padrão já aponta para `http://localhost:4000/api`).

No boot o backend cria o schema `platform`, semeia o superadmin e aplica o `schema.sql` em todos os schemas de clínica. **Banco legado** (dados no schema `public`): rode uma única vez `node backend/scripts/migrate-to-multitenant.mjs` para mover os dados para o tenant `aura`.

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

- **Clínica** (código/slug) + e-mail + senha em `/login`. Clínica migrada: `aura`, admin `admin@auraclinic.com`, senha padrão `aura123` (**troque em produção**).
- **Plataforma**: `/plataforma` com o superadmin definido em `PLATFORM_ADMIN_EMAIL`/`PLATFORM_ADMIN_PASSWORD`.
- Em desenvolvimento local a API libera acesso administrativo sem token para agilizar; em produção (`NODE_ENV=production`) o token é obrigatório em todas as rotas protegidas.

## Estrutura

```text
backend/
  src/
    index.js                 Bootstrap (middlewares globais, routers, boot multi-tenant)
    config/                  Env e constantes
    middleware/              withDb (conexão por requisição + search_path), auth, tenant, uploads, rate-limit, validação
    routes/                  Um router por domínio (+ routes/platform.js: signup e painel da plataforma)
    services/                Regras de negócio (finance, terms/PDF, loyalty, tenants/provisionamento, ...)
    db/
      schema.sql             Schema de cada clínica (aplicado por tenant)
      platformSchema.sql     Schema de controle (tenants, platform_users)
      sqliteCompat.js        Adaptador de acesso (get/all/run) por client
    database/connection.js   Pool PostgreSQL
    data/uploads/            PDFs e imagens enviadas
  scripts/                   backup.sh, migrate-to-multitenant.mjs, test-isolation.mjs
  .env                       Config do backend (não versionado)
frontend/
  src/
    main.jsx                 App shell (telas lazy por feature)
    features/                Telas por domínio (+ features/platform: Signup e PlatformAdmin)
    lib/, components/, pages/
    styles.css               Identidade visual e responsividade
  .env                       Config do frontend (não versionado)
```

## Banco de dados

PostgreSQL (`aura_clinic`), organizado em schemas: `platform` (controle da plataforma) e um `tenant_<id>` por clínica. Tabelas principais de cada clínica:

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

- `POST /api/login` (com header `X-Tenant`)
- `POST /api/signup` — cadastro público de clínica
- `POST /api/platform/login`, `GET/POST/PATCH/DELETE /api/platform/tenants`, `GET /api/platform/metrics` — plataforma (superadmin)
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

### Produção (checklist de deploy)
- Use HTTPS (proxy reverso Nginx/Caddy na frente da API).
- Defina `NODE_ENV=production` (torna o token obrigatório e desativa o bypass de dev).
- Defina `AUTH_SECRET` forte (o boot recusa o default de dev em produção).
- Defina `PLATFORM_ADMIN_EMAIL`/`PLATFORM_ADMIN_PASSWORD` fortes (sem elas o superadmin não é criado).
- Restrinja `CORS_ORIGIN` ao domínio do frontend.
- Omita `DEFAULT_TENANT` se a instância atender várias clínicas (exige `X-Tenant` explícito).
- Decida `ALLOW_PUBLIC_SIGNUP` (`false` = só o superadmin cria clínicas).
- Troque a senha do admin da clínica migrada (`aura123`).
- Agende `npm --prefix backend run backup` (pg_dump) num cron.
- Banco legado no schema `public`: rode `node backend/scripts/migrate-to-multitenant.mjs` uma única vez.
- Sanidade pós-deploy: rode `node backend/scripts/test-isolation.mjs` contra a API para validar o isolamento entre clínicas.
