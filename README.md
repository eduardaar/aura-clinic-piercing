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
- Banco: **PostgreSQL multi-tenant** — cada clínica vive em um schema próprio (`tenant_<slug>`), com isolamento físico dos dados
- Arquivos: Cloudflare R2 quando configurado; disco local apenas como fallback de desenvolvimento/migração
- Autenticação: access token HMAC de 15 min (carrega a clínica) via `Authorization: Bearer`, renovado por refresh token em cookie `HttpOnly` de 30 dias

## Multi-tenant (SaaS)

- **Cadastro da clínica**: página pública `/cadastro` (`POST /api/signup`) cria a clínica, provisiona o schema e o admin dela. Pode ser desabilitado com `ALLOW_PUBLIC_SIGNUP=false`.
- **Identificação da clínica**: toda chamada à API leva o header `X-Tenant: <slug>` (o frontend faz isso automaticamente) ou usa a clínica embutida no token; sem os dois, a API aceita o parâmetro `?t=<slug>`, o subdomínio e, por fim, `DEFAULT_TENANT`. Links públicos por clínica: `/catalogo?t=<slug>`.
- **Login**: informa o código da clínica + e-mail + senha em `/login`.
- **Painel da plataforma (super-admin)**: página `/plataforma` — áreas Financeiro (`/plataforma/dashboard`, a inicial), Clínicas (criar, gerir, suspender/reativar e excluir), Planos, Suporte e Conteúdo da plataforma (landing, notícias e manual, termos e privacidade); em "Mais opções" ficam Configuração de e-mail (SMTP) e Segurança da conta (MFA). Login separado (`platform.platform_users`).
- **Isolamento**: cada requisição usa uma conexão dedicada do pool com `search_path` apontando para o schema da clínica, com reset garantido antes de devolver ao pool. Verificado por `backend/scripts/test-isolation.mjs` (9 checagens, incluindo token cruzado e suspensão).
- **Migrations**: o bootstrap de banco no boot é **condicionado por env**. Com `RUN_DATABASE_MIGRATIONS=false` (ou `SKIP_DATABASE_BOOTSTRAP=true`) o backend sobe sem tocar no banco — num banco vazio isso significa **nenhum schema `platform` e nenhum superadmin**. Habilitado, o boot garante o schema `platform` e aplica o `schema.sql` (idempotente) em todos os schemas de clínica. As migrations versionadas (`src/db/migrations/`) só rodam no boot com `RUN_MIGRATIONS_ON_BOOT=true` (proibido em produção); o caminho normal é o CLI `npm --prefix backend run migrations:apply`. Em produção o CLI só aplica com `--tenant=<id|slug>` ou com `--all` + `ALLOW_GLOBAL_MIGRATIONS=true`, e o deploy **não** aplica migrations: elas rodam pelo workflow manual "Aplicar migrations em produção". Clínica nova recebe `schema.sql` + todas as migrations de tenant automaticamente no provisionamento.

## Pré-requisitos

- Node.js 20.19+
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

3. Configure o frontend — copie `frontend/.env.example` para `frontend/.env` (o padrão já aponta para `http://localhost:4000/api`; o build de produção ignora essa variável e chama `/api` no mesmo domínio).

4. Prepare a base local — o `.env.example` vem com `RUN_DATABASE_MIGRATIONS=false`, e assim o boot não cria nada num banco vazio. Rode:

   ```bash
   npm --prefix backend run db:reset-local
   ```

   O comando só aceita banco em `localhost`/`127.0.0.1`/`::1` e `NODE_ENV` diferente de `production`; apaga os schemas `tenant_*` e `platform` e recria a plataforma (schema, superadmin e migrations de plataforma). As clínicas são criadas depois pelo `/cadastro` ou pelo painel `/plataforma`.

Com o bootstrap habilitado (`RUN_DATABASE_MIGRATIONS` diferente de `false`), o boot cria o schema `platform`, semeia o superadmin e aplica o `schema.sql` em todos os schemas de clínica. **Banco legado** (dados no schema `public`): rode uma única vez `node backend/scripts/migrate-to-multitenant.mjs` para mover os dados para o tenant `aura`.

## Como rodar

Instale as dependências dos dois projetos e da raiz:

```bash
npm run install:all
```

Suba backend + frontend juntos:

```bash
npm run dev
```

Verificações disponíveis na raiz:

```bash
npm run check:changed   # Biome apenas nos arquivos alterados em relação à main
npm run verify:static   # Biome nos alterados, typecheck (backend e frontend) e build do frontend
npm run verify:full     # verificação estática e todas as suítes backend/frontend
```

Ou individualmente:

```bash
npm --prefix backend run dev     # API em :4000
npm --prefix frontend run dev    # SPA em :5174
```

Acesse:

- Frontend: `http://localhost:5174`
- Backend: `http://localhost:4000`
- Health check: `http://localhost:4000/api/health` e `/api/health/db`

## Login

- **Clínica** (código/slug) + e-mail + senha em `/login` (o e-mail é comparado sem diferenciar maiúsculas). "Esqueci minha senha" envia um link de uso único com validade de 30 minutos. Banco legado migrado: clínica `aura`, com os usuários que já existiam no schema `public` — o seed antigo que criava `admin@auraclinic.com` com senha padrão não existe mais no código; se essa conta veio do legado, **troque a senha**.
- **Plataforma**: `/plataforma` com o superadmin definido em `PLATFORM_ADMIN_EMAIL`/`PLATFORM_ADMIN_PASSWORD` (sem elas, só em desenvolvimento, o seed usa credenciais padrão e avisa no log). MFA por TOTP opcional em "Segurança da conta".
- O token é obrigatório em todas as rotas protegidas, **inclusive em desenvolvimento**. Existe um bypass local opcional (`ALLOW_LOCAL_AUTH_BYPASS=true`, só fora de produção e só para requisições de `localhost`), **desligado por padrão** — mantenha assim para exercitar o mesmo fluxo da produção.

## Estrutura

```text
backend/
  src/
    index.js                 Bootstrap (middlewares globais, routers, boot multi-tenant)
    config/                  Env e constantes (+ permissions.js: catálogo de permissões; roles.js: permissões por cargo)
    middleware/              withDb (conexão por requisição + search_path), auth, tenant, requirePermission, uploads, rate-limit, validação
    routes/                  Um router por domínio (+ routes/platform.js: signup e painel da plataforma)
    services/                Regras de negócio (finance, terms/PDF, loyalty, tenants/provisionamento, ...)
    db/
      schema.sql             Schema de cada clínica (aplicado por tenant)
      platformSchema.sql     Schema de controle (tenants, platform_users)
      migrations/            Migrations versionadas (platform/ e tenant/)
      migrations.js          Runner das migrations (ledger platform.schema_migrations)
      postgres.js            Camada de acesso ao Postgres (get/all/run) por client
    database/connection.js   Pool PostgreSQL
    data/uploads/            Fallback local de arquivos públicos
    data/private-uploads/    Fallback local de arquivos privados
  scripts/                   Backup, migrations, reset local, importação e auditorias operacionais
  tests/                     Testes de endpoint (node --test) + run-suite.mjs
  .env                       Config do backend (não versionado)
frontend/
  src/
    main.jsx                 App shell (telas lazy por feature)
    features/                Telas por domínio (+ features/platform: Signup e PlatformAdmin)
    lib/                     api.js, appPages.js (registro único de páginas: rota, menu, permissão, plano), permissions.js, ...
    components/, pages/
    styles.css, styles/      Identidade visual e responsividade
  tests/                     Testes unitários (node --test) e de componentes (Vitest)
  .env                       Config do frontend (não versionado)
scripts/deploy.sh            Deploy de produção (chamado pela CI)
.github/workflows/           CI e deploy, migrations de produção e verificações manuais
```

## Banco de dados

PostgreSQL (`aura_clinic`), organizado em schemas: `platform` (controle da plataforma) e um `tenant_<slug>` por clínica (slug com `_` no lugar de `-`, ex.: `tenant_aura_clinic`). Tabelas principais de cada clínica:

- `users`, `user_permissions`, `access_profiles`, `user_sessions`
- `professionals`, `services` (cadastro único de tipos de atendimento; `procedures` ficou só para leitura do histórico)
- `clients`, `appointments`, `service_executions`, `payments`
- `jewelry_inventory`, `jewelry_variants`, `stock_movements`, `inventory_options`
- `sales_orders`, `sales_order_items`, `expenses`, `financial_entries`
- `suppliers`, `purchase_orders`, `purchase_order_items`
- `client_medical_records`, `digital_terms`, `term_templates`, `term_requests`, `post_care_followups`
- `audit_events`
- `loyalty_points`, `loyalty_redemptions`
- `catalog_settings`, `catalog_banners`, `catalog_featured_categories`, `catalog_promotions`, `catalog_theme`
- `catalog_customization_drafts`, `catalog_customization_revisions` (personalização versionada da vitrine)

### Recuperação administrativa

Se uma conta administradora geral perder acesso por engano, restaure a função `admin` sem criar usuário duplicado:

```bash
npm run restore-admin -- --email=email-da-conta
```

Opcionalmente restrinja a uma clínica:

```bash
npm run restore-admin -- --email=email-da-conta --tenant=slug-da-clinica
```

O comando localiza a conta existente no tenant, preserva nome/senha/demais dados e altera somente a função para `admin`.

## Níveis de acesso

O acesso é decidido em camadas, nesta ordem. As permissões são as chaves do catálogo `backend/src/config/permissions.js` (ex.: `finance.view`, `users.permissions`):

1. **Papel do usuário** (cargo) — a base, definida em `backend/src/config/roles.js`:

   - `admin`: acessa tudo (`*`; ignora as demais checagens de permissão)
   - `reception`: agenda (sem finalizar atendimento), clientes e anamnese, estoque (consulta e venda), vendas, caixa (abrir e receber), comunicações e cupons
   - `finance`: dashboard financeiro, contas a pagar/receber, compras, fornecedores, categorias, centros de custo, relatórios, vendas (editar concluída e cancelar), caixa, estoque com custo, comissões e auditoria
   - `piercer`: agenda e atendimentos (inclusive finalizar), clientes, anamnese, arquivos clínicos (termos e pós-atendimento), vendas, estoque (inclusive ajuste), caixa e comunicações

2. **Perfil de acesso** — opcional: um perfil ativo (`access_profiles`, gerido em "Usuários e permissões") **substitui** as permissões do papel.

3. **Exceções por usuário** — a tabela `user_permissions` concede (`allowed = true`) ou revoga (`allowed = false`) permissões individuais sobre o papel ou perfil. Resolvido em `services/permissionService.js`; a revogação vence a concessão. O login e o refresh devolvem a lista já resolvida (`user.permissions`), usada pelo frontend.

4. **Recursos do plano** — mesmo com permissão, a página ou ação pode estar travada pelo plano contratado da clínica (`withFeature` em `middleware/withDb.js`, cotas em `services/planLimits.js`; no frontend, a feature de cada página está em `frontend/src/lib/appPages.js`). Item com cadeado na UI é limitação de plano, não falta de permissão.

Usuário com `status` inativo não autentica.

## API e documentação

O catálogo de endpoints, convenções de autenticação e rotas públicas está em
[docs/API.md](docs/API.md). A documentação técnica viva fica reunida em
[docs/README.md](docs/README.md).

## Segurança e acesso

### Rotas públicas (sem autenticação)
- `/catalogo`, `/agendar`, `/comprar` (e os endpoints `GET /api/catalog`, `/api/booking/*`, `POST /api/sales-orders/public`)
- `/termo` — termo digital assinado pelo cliente por link individual (`GET/POST /api/public/terms/:token`)
- Páginas da plataforma: `/` (landing), `/sobre`, `/planos` (redireciona para `/#planos`), `/novidades`, `/termos-de-uso`, `/politica-de-privacidade`, `/cadastro` (`GET /api/signup/availability`, `POST /api/signup`, que exige plano válido e o aceite das versões vigentes dos documentos legais) e `/login`
- As rotas de clínica liberadas sem sessão ficam declaradas em `requiresAuth` (`backend/src/middleware/auth.js`)

### Proteção de dados
O catálogo público expõe apenas nome, foto, categoria, material, tamanho, cor, preço final e disponibilidade. Ficam **ocultos**: custo, lucro, fornecedor, observações internas, localização física, dados de clientes e financeiro.

### Personalização do catálogo

Cada clínica pode escolher um dos templates iniciais, configurar a identidade,
banners e blocos da vitrine. **Salvar rascunho não altera a produção**;
**Publicar** cria uma revisão imutável. O editor oferece histórico e rollback.
Também há integrações nativas versionadas (WhatsApp, Instagram, FAQ, SEO e
link de Maps), validadas por allowlists e pelos recursos do plano. Conteúdo
configurável não aceita JavaScript/HTML/CSS arbitrário; links e embeds são
limitados a formatos seguros. Veja [docs/CATALOGO-BUILDER.md](docs/CATALOGO-BUILDER.md).

### Produção (checklist de deploy)
- Use HTTPS (proxy reverso Nginx/Caddy na frente da API).
- Defina `NODE_ENV=production` (ativa as guardas de boot abaixo e proíbe o bypass local `ALLOW_LOCAL_AUTH_BYPASS`).
- Defina `AUTH_SECRET` forte (o boot recusa o default de dev e valores com menos de 32 bytes em produção).
- Defina `PLATFORM_ADMIN_EMAIL`/`PLATFORM_ADMIN_PASSWORD` fortes (sem elas o superadmin não é criado).
- Restrinja `CORS_ORIGIN` ao domínio do frontend (obrigatória em produção; `*` derruba o boot).
- Defina `PUBLIC_API_URL` com `https://` e `DATABASE_SSL=true` com validação do certificado (o boot falha sem eles).
- Omita `DEFAULT_TENANT` se a instância atender várias clínicas (exige `X-Tenant` explícito).
- Decida `ALLOW_PUBLIC_SIGNUP` (`false` = só o superadmin cria clínicas).
- Troque a senha de contas administrativas herdadas do banco legado.
- Agende `npm --prefix backend run backup` (pg_dump) num cron.
- Banco legado no schema `public`: rode `node backend/scripts/migrate-to-multitenant.mjs` uma única vez.
- O R2 é obrigatório em produção: configure as seis variáveis `R2_*` juntas (sem elas o boot falha) e siga o runbook em [docs/R2.md](docs/R2.md) antes de migrar anexos antigos.
- Migrations não são aplicadas pelo deploy: rode o workflow manual "Aplicar migrations em produção" quando houver migration nova (ver "CI e deploy" em [docs/GUIA-DEV.md](docs/GUIA-DEV.md)).
- Sanidade pós-deploy: rode `node backend/scripts/test-isolation.mjs` contra a API para validar o isolamento entre clínicas.
