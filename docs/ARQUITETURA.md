# Arquitetura

Este documento descreve a arquitetura geral da **Aura Clinic Piercing**, um SaaS de gestão para estúdios de piercing (agenda, estoque de joalherias, catálogo público, clientes, financeiro, prontuários, termos digitais, pós-atendimento, fidelidade e acessos administrativos).

## 1. Visão geral do monorepo

O repositório é um **monorepo com dois projetos independentes**, coordenados por um `package.json` na raiz:

```text
aura-clinic-piercing/
├── backend/     API Node.js + Express, banco PostgreSQL (multi-tenant por schema)
├── frontend/    SPA React + Vite
├── docs/        Esta documentação
└── package.json Scripts de orquestração (dev, build, install:all)
```

- **Backend** — `backend/`: API REST em Node.js + Express 5, persistência em PostgreSQL. Autenticação por token HMAC próprio (sem JWT externo). Uploads locais em `backend/src/data/uploads`.
- **Frontend** — `frontend/`: SPA em React 18 + Vite 5, ícones `lucide-react`. Sem framework de UI externo — os componentes reutilizáveis são próprios. O roteamento **não** usa uma biblioteca: as telas públicas são escolhidas inspecionando `window.location.pathname` e a navegação interna do painel é feita por estado React (`page`) com controle de acesso por papel. As telas de cada feature são carregadas sob demanda (`React.lazy` + `Suspense`).

Scripts da raiz (`package.json`):

| Script | O que faz |
| --- | --- |
| `npm run install:all` | Instala dependências da raiz, do backend e do frontend. |
| `npm run dev` | Sobe backend (`:4000`) e frontend (`:5173`) juntos via `concurrently`. |
| `npm run start` | Sobe apenas o backend em modo produção. |
| `npm run build` | Build de produção do frontend (Vite). |

## 2. Multi-tenancy por schema Postgres

O ponto central da arquitetura é o **isolamento físico de cada clínica em um schema Postgres próprio**. Não há coluna `tenant_id` espalhada pelas tabelas: cada clínica tem um schema dedicado com um conjunto completo de tabelas.

### Organização do banco

Um único banco de dados PostgreSQL (`aura_clinic`) é organizado em schemas:

- **`platform`** — schema de controle da plataforma. Contém apenas duas tabelas: `platform.tenants` (cadastro das clínicas) e `platform.platform_users` (super-admins do painel). Definido em `backend/src/db/platformSchema.sql`.
- **`tenant_<id>`** — um schema por clínica, criado no provisionamento. O nome é sempre derivado do `id` inteiro do registro em `platform.tenants` (`"tenant_" || id`), **nunca de input do usuário**. Recebe todas as tabelas do app definidas em `backend/src/db/schema.sql`.

Exemplo: a clínica de `id = 3` vive no schema `tenant_3`, com suas próprias tabelas `users`, `clients`, `appointments`, etc., totalmente separadas das demais clínicas.

### Vantagens do modelo

- **Isolamento forte**: os dados de uma clínica nunca compartilham tabela com outra. Um `DROP SCHEMA tenant_3 CASCADE` remove tudo de uma clínica sem tocar nas demais.
- **Migrations idempotentes multi-schema**: o `schema.sql` usa `CREATE TABLE IF NOT EXISTS`, então aplicá-lo em todos os schemas no boot propaga novas tabelas/colunas para todas as clínicas.
- **Provisionamento/desprovisionamento simples**: criar uma clínica = criar um schema + rodar o schema; excluir = `DROP SCHEMA`.

### Boot do servidor

No arranque (`backend/src/index.js`), após montar os routers, o servidor executa em ordem:

1. `ensurePlatform()` — garante o schema `platform` (aplica `platformSchema.sql`) e, se não houver nenhum super-admin, semeia o inicial (ver seção de autenticação).
2. `applySchemaToAllTenants()` — runner de migrations multi-schema: para cada tenant em `platform.tenants`, faz `SET search_path` para o schema da clínica e aplica o `schema.sql` idempotente. Assim, subir o servidor após alterar `schema.sql` migra todas as clínicas.

Ambas as funções vivem em `backend/src/services/tenants.js`.

## 3. Ciclo de vida de uma requisição

Todo handler de rota é embrulhado pelo middleware `withDb` (`backend/src/middleware/withDb.js`), que garante o isolamento por tenant. A sequência para cada requisição:

1. **Wrap de resposta** — `res.json` é substituído para passar o payload por `normalizeDbValue` (paliativo de encoding via `text-normalizer.js`).

2. **Resolução do tenant** — chama `resolveTenant(req)` (`backend/src/middleware/tenant.js`). O slug da clínica é resolvido nesta ordem de precedência:
   1. **Token Bearer válido** com `tslug` embutido. Se o header `X-Tenant` divergir do slug do token → `403` (tentativa de acessar outra clínica com token de uma).
   2. **Header `X-Tenant`**.
   3. **Env `DEFAULT_TENANT`** (conveniência para dev local).
   4. Nenhum → `400` ("Informe a clínica").

   O slug é validado por regex (`^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$`), buscado em `platform.tenants` (com **cache em memória de 60s** por slug), e o schema é derivado do id (`tenant_<id>`). Clínica inexistente → `404`; clínica **suspensa** → `403`. Falhas de resolução viram respostas de erro sem jamais tocar o banco da aplicação. Como defesa em profundidade, o `withDb` ainda valida o schema resolvido contra `^tenant_\d+$` antes de usá-lo.

3. **Client dedicado do pool com `search_path`** — `withDb` pega **um client do pool** Postgres (`pool.connect()`) e executa `SET search_path TO "tenant_<id>", public`. A partir daí toda query dessa requisição roda no schema da clínica.

4. **Adaptador `db`** — `createDbAdapter(client)` (`backend/src/db/sqliteCompat.js`) embrulha o client numa interface estilo SQLite (`get` / `all` / `run` com placeholders `?`). Isso é injetado no handler como terceiro argumento (`handler(req, res, db)`).

5. **Autenticação (quando exigida)** — se `requiresAuth(req)` for verdadeiro (ver seção 4), chama `authenticateRequest(req, db)`. Sem usuário válido → `401`. O usuário resolvido é anexado em `req.user`.

6. **Execução do handler** — a lógica de negócio roda usando o adaptador `db` (que já está apontando para o schema certo). Erros são capturados e devolvidos como `500` padronizado (detalhe do erro só em dev; em produção mensagem genérica, para não vazar stack/SQL).

7. **Reset garantido do `search_path`** — no `finally`, **sempre** executa `SET search_path TO public` antes de devolver o client ao pool. Isso é **crítico**: um client devolvido "sujo" (ainda apontando para um tenant) vazaria dados entre clínicas na próxima requisição que o reutilizasse. Se o reset falhar, o client é **descartado** (`client.release(true)` destrói a conexão em vez de devolvê-la ao pool).

Esse padrão — client por requisição + `search_path` + reset garantido — é o que produz o isolamento multi-tenant e é validado pelo script `backend/scripts/test-isolation.mjs`.

## 4. Autenticação e autorização

Implementada em `backend/src/middleware/auth.js`. Usa **token HMAC próprio** (`crypto.createHmac("sha256", AUTH_SECRET)`), sem dependência de biblioteca de JWT.

### Formato do token

`payload.assinatura`, onde `payload` é um JSON base64url e `assinatura` é o HMAC-SHA256 do payload. A verificação (`decodeToken`) confere a assinatura com `crypto.timingSafeEqual` e a expiração (`exp`). Nenhuma consulta ao banco é feita na decodificação.

### Dois tipos de token

- **Token de clínica** (`createToken`): carrega `sub` (id do usuário), `role`, `tid` (id do tenant) e `tslug` (slug do tenant). Validade de 12 horas. **Amarrado ao tenant**: na autenticação, o token só vale se `decoded.tid === req.tenant.id` — token de outra clínica resulta em `401`.
- **Token de plataforma** (`createPlatformToken`): carrega `sub`, `role: "superadmin"` e a flag `plt: true`. Tokens de plataforma **nunca** autenticam em rotas de clínica (`authenticateRequest` rejeita `plt === true`), e tokens de clínica não têm `plt`, então nunca são aceitos no painel de plataforma (`verifyPlatformToken` exige `plt === true`).

Essa separação garante que o super-admin da plataforma e os usuários de clínica vivem em domínios de segurança distintos.

### Login de clínica x login de plataforma

- **Login de clínica** (`POST /api/login`, com header `X-Tenant`, definido em `routes/auth.js`): valida e-mail + senha (bcrypt) contra a tabela `users` **do schema da clínica** resolvida, e devolve um token de clínica.
- **Login de plataforma** (`POST /api/platform/login`, definido em `routes/platform.js`): valida contra `platform.platform_users` e devolve um token de plataforma.

> Nota: o cadastro público de clínica (`POST /api/signup`), o login de plataforma e todas as rotas `/api/platform/*` ficam em `routes/platform.js`. O `routes/auth.js` contém apenas o login de clínica.

### Rotas públicas

`requiresAuth(req)` retorna `false` (não exige token) para: `/api/login`, `/api/health`, `/api/catalog`, `/api/sales-orders/public` e qualquer rota que comece com `/api/booking`. Todas as demais rotas sob `/api` exigem autenticação.

### Bypass de desenvolvimento local

Fora de produção (`NODE_ENV !== "production"`) e quando a requisição vem de `localhost`/`127.0.0.1`/`::1`, `authenticateRequest` **dispensa o token** e retorna o admin do tenant resolvido (`isLocalDevRequest`). Isso agiliza o desenvolvimento; em produção o token é sempre obrigatório.

### Papéis (roles)

Verificados por `requireRole(req, res, roles)`. Os níveis de acesso das clínicas são:

- `admin` — acessa tudo.
- `reception` — agenda, agendamentos e clientes.
- `finance` — financeiro e relatórios.
- `piercer` — atendimentos, clientes, prontuários e pós-atendimento.

### Segredo e produção

`AUTH_SECRET` é obrigatório em produção (o boot lança erro sem ele). Em dev usa o default `aura-clinic-dev-secret`; o boot **recusa** subir em produção com esse default (ver `backend/src/config/index.js`).

## 5. Segurança de borda

Configurada em `backend/src/index.js`:

- **Helmet** — cabeçalhos de segurança; `crossOriginResourcePolicy` relaxado apenas para permitir que o frontend consuma as imagens servidas em `/uploads`.
- **CORS** — restrito à(s) origem(ns) de `CORS_ORIGIN` (separadas por vírgula).
- **Rate limit global** — `apiLimiter` aplicado em toda a `/api` (`backend/src/middleware/rateLimit.js`); o `/login` mantém um limite estrito próprio no router de auth.
- **Body limit** — `express.json({ limit: "8mb" })` (uploads via base64/JSON e multer para arquivos).

## 6. Estrutura de pastas do backend

```text
backend/src/
├── index.js                 Bootstrap: middlewares globais, montagem dos routers, boot multi-tenant
├── config/
│   └── index.js             Env, constantes de domínio (categorias de joia), caminho de uploads, AUTH_SECRET
├── database/
│   └── connection.js        Pool PostgreSQL (pg) + helper query()
├── db/
│   ├── schema.sql           Schema de CADA clínica (aplicado por tenant, idempotente)
│   ├── platformSchema.sql   Schema de controle: platform.tenants, platform.platform_users
│   └── sqliteCompat.js      Adaptador db estilo SQLite (get/all/run) sobre um client + applySchemaSql
├── middleware/
│   ├── withDb.js            Wrapper de todo handler: resolve tenant, client+search_path, auth, reset
│   ├── tenant.js            Resolução do tenant (token/X-Tenant/DEFAULT_TENANT) + cache
│   ├── auth.js              Tokens HMAC (clínica e plataforma), requiresAuth, requireRole, bypass dev
│   ├── rateLimit.js         Limites de requisição (global e de login)
│   ├── upload.js            Configuração do multer (uploads de imagens/arquivos)
│   └── validate.js          Integração de validação (Zod)
├── routes/                  Um router por domínio (cada um declara seus caminhos /api/...)
│   ├── auth.js, clients.js, appointments.js, services.js, procedures.js,
│   ├── jewelry.js, sales.js, finance.js, expenses (em finance/erp), terms.js,
│   ├── postcare.js, catalog.js, booking.js, options.js, professionals.js,
│   ├── availability.js, scheduleBlocks.js, users.js, admin.js, dashboard.js,
│   ├── erp.js, alerts.js, uploads.js, health.js
│   └── platform.js          Signup público + painel da plataforma (super-admin)
├── services/                Regras de negócio (sem HTTP)
│   ├── tenants.js           Provisionamento/desprovisionamento, ensurePlatform, migrations multi-schema
│   ├── finance.js, sales.js, inventory.js, loyalty.js, catalog.js,
│   ├── appointments.js, clients.js, postcare.js, terms.js, utils.js
├── schemas/
│   └── index.js             Schemas de validação Zod
├── text-normalizer.js       Normalização de encoding das respostas
└── data/uploads/            Arquivos enviados (imagens, PDFs de termos)

backend/scripts/
├── backup.sh                Backup (pg_dump)
├── migrate-to-multitenant.mjs   Migra banco legado (schema public) para o modelo por tenant
└── test-isolation.mjs       Validação do isolamento entre clínicas (9 checagens)

backend/tests/
├── run-suite.mjs            Suíte de testes (npm --prefix backend test)
└── helpers.mjs              Utilitários de teste
```

### Adaptador `db` estilo SQLite

Uma convenção importante: os handlers e services **não** usam o driver `pg` diretamente. Eles recebem o adaptador `db` (`createDbAdapter`), que expõe `get(sql, params)`, `all(sql, params)` e `run(sql, params)` com **placeholders posicionais `?`** (estilo SQLite). O adaptador converte `?` em `$1, $2, ...` e, em `INSERT` sem `RETURNING`, acrescenta `RETURNING id` automaticamente para popular `lastID` (exceto tabelas cuja PK não é `id`, como `catalog_settings` e `catalog_theme`). Isso mantém o código de negócio agnóstico e simples.

## 7. Estrutura de pastas do frontend

```text
frontend/src/
├── main.jsx                 App shell: roteamento por pathname/estado, code-splitting (lazy) por feature, error boundary
├── styles.css               Identidade visual e responsividade
├── lib/
│   ├── api.js               Cliente HTTP: base URL, injeção de X-Tenant e Bearer, storage do token/slug
│   ├── permissions.js       Regras de visibilidade por papel (role): páginas permitidas e página default
│   ├── defaultForms.js      Estados iniciais dos formulários e listas de opções
│   ├── utils.js             Utilidades gerais (datas, moeda, strings)
│   └── calendarUtils.js     Helpers de calendário/agenda
├── components/
│   ├── auth/Login.jsx       Login de clínica (código/slug + e-mail + senha)
│   ├── common/
│   │   ├── Ui.jsx           Componentes de UI reutilizáveis (Modal, Button, StatusBadge, ...)
│   │   ├── Crud.jsx         DataTable, CrudHeader e helpers de CRUD
│   │   ├── Feedback.jsx     ConfirmDeleteModal e feedback ao usuário
│   │   └── AppErrorBoundary.jsx
│   └── layout/Sidebar.jsx   Navegação lateral
├── features/                Telas por domínio de negócio
│   ├── agenda/Agenda.jsx
│   ├── clients/ClientsMedical.jsx
│   ├── dashboard/Dashboard.jsx
│   ├── finance/Finance.jsx
│   ├── inventory/Inventory.jsx
│   ├── sales/Sales.jsx
│   ├── terms/DigitalTerms.jsx
│   ├── postcare/PostCare.jsx
│   ├── access/AccessAdmin.jsx
│   ├── catalog/catalogUtils.js
│   ├── shared/helpers.jsx
│   └── platform/
│       ├── Signup.jsx        Cadastro público de clínica (/cadastro)
│       └── PlatformAdmin.jsx Painel do super-admin (/plataforma)
└── pages/
    ├── PublicExperience.jsx  Catálogo público / agendamento
    └── CatalogCustomization.jsx  Personalização do catálogo
```

## 8. Componentes de UI reutilizáveis

O frontend não usa biblioteca de componentes externa; a UI compartilhada vive em `frontend/src/components/common/`. Os principais:

- **`Modal`** (`Crud.jsx`) — janela sobreposta genérica usada por formulários e diálogos. Props: `open`, `title`, `subtitle`, `onClose`, `children`, `footer`, `size` (`sm`/`md`/…). Fecha com Escape e clique no backdrop, trava o scroll do body enquanto aberta e é acessível (`role="dialog"`, `aria-modal`).
- **`Button`** (`Ui.jsx`) — botão padronizado. Prop `variant` ∈ `primary | secondary | ghost | danger`, mapeada para as classes visuais correspondentes; repassa demais props ao `<button>`.
- **`StatusBadge`** (`Ui.jsx`) — selo colorido de status (ex.: agendamento pendente/atendido/cancelado, estoque disponível/baixo/crítico). Normaliza o `status` (minúsculas, sem acentos) e o mapeia para um tom (`ok | warn | info | danger | neutral`); aceita `tone` explícito.
- **`DataTable`** (`Crud.jsx`) — tabela reutilizável das telas de listagem/CRUD. Props: `columns` (`[{ key, label, render?, align? }]`), `rows`, `actions?(row)` (botões por linha), `rowKey` e `empty` (estado vazio). Suporta layout responsivo por célula.
- **`CrudHeader`** (`Crud.jsx`) — cabeçalho padrão das telas de gestão: `title`, `subtitle` e botão primário (`actionLabel`, default "Novo") via `onAction`, ligando a listagem ao formulário/modal.
- **`ConfirmDeleteModal`** (`Feedback.jsx`) — modal de confirmação de exclusão que **exige digitar uma palavra** (`confirmWord`, default "sim") para habilitar o botão Excluir, evitando remoções acidentais. Props: `open`, `onClose`, `onConfirm`, `title`, `message`, `confirmWord`, `loading`.

Complementam a UI base: `Input`, `Select`, `Textarea`, `Checkbox`, `PaymentSelect`, `StatusSelect`, `Metric`, `AlertBlock` (em `Ui.jsx`) e `Loading`, `ApiError` (em `Feedback.jsx`). Esses blocos são combinados em cada tela de `features/` para compor as interfaces de CRUD (listar, criar, editar, excluir) de forma consistente. Consulte `docs/API.md` para os endpoints que essas telas consomem e `docs/FLUXOS.md` para os fluxos de uso.

## 9. Referências de código

- Bootstrap e montagem dos routers: `backend/src/index.js`
- Ciclo de requisição / isolamento: `backend/src/middleware/withDb.js`
- Resolução de tenant: `backend/src/middleware/tenant.js`
- Autenticação: `backend/src/middleware/auth.js`
- Provisionamento e migrations multi-schema: `backend/src/services/tenants.js`
- Schema de controle: `backend/src/db/platformSchema.sql`
- Schema de clínica: `backend/src/db/schema.sql`
- Adaptador de banco: `backend/src/db/sqliteCompat.js`
