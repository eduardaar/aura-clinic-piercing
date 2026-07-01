# Guia do desenvolvedor

Como configurar, rodar, testar e evoluir a **Aura Clinic Piercing** localmente. Complementa `docs/ARQUITETURA.md` (visão geral) e `docs/API.md` (endpoints).

## Pré-requisitos

- **Node.js 18+**
- **PostgreSQL 14+** em execução
- Cliente PostgreSQL (`createdb`, `psql`, `pg_dump`) no PATH — necessário para o script de backup.

## Configuração

### 1. Banco de dados

Crie o banco (nome padrão `aura_clinic`):

```bash
createdb aura_clinic
# ou: psql -U postgres -c "CREATE DATABASE aura_clinic;"
```

Um único banco atende todas as clínicas: o schema de controle `platform` e um schema `tenant_<id>` por clínica são criados automaticamente pelo backend (ver `docs/ARQUITETURA.md`).

### 2. `.env` do backend

Copie `backend/.env.example` para `backend/.env` e ajuste. Variáveis principais:

| Variável | Papel |
| --- | --- |
| `NODE_ENV` | `development` (dev) ou `production`. Em produção o token vira obrigatório e o bypass de dev é desativado. |
| `PORT` | Porta da API (default `4000`). |
| `DATABASE_URL` | Conexão Postgres, ex.: `postgres://postgres:SENHA@localhost:5432/aura_clinic` (obrigatória). |
| `DATABASE_SSL` | `true` para exigir SSL na conexão. |
| `AUTH_SECRET` | Segredo dos tokens HMAC. Obrigatório em produção; o boot recusa o default de dev em produção. Gere com `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. |
| `CORS_ORIGIN` | Origem(ns) do frontend permitida(s) no CORS (separadas por vírgula), ex.: `http://localhost:5173`. |
| **Multi-tenant** | |
| `DEFAULT_TENANT` | Clínica assumida quando a requisição não traz token nem `X-Tenant` (ex.: `aura`). Útil em dev; **omita** em produção multi-clínica para exigir `X-Tenant` explícito. |
| `PLATFORM_ADMIN_EMAIL` / `PLATFORM_ADMIN_PASSWORD` | Super-admin da plataforma, semeado no primeiro boot se não houver nenhum. **Obrigatórias em produção** (sem elas o boot não cria credenciais padrão). |
| `ALLOW_PUBLIC_SIGNUP` | `false` desabilita `POST /api/signup` (só o super-admin cria clínicas). Qualquer outro valor mantém o cadastro público ativo. |
| `ALLOW_DEMO_RESET` | `true` libera `POST /api/admin/reset-demo-data` em produção (bloqueado por padrão). |

### 3. `.env` do frontend

Copie `frontend/.env.example` para `frontend/.env`. O padrão já aponta para a API local:

| Variável | Papel |
| --- | --- |
| `VITE_API_URL` | Base da API (default `http://localhost:4000/api`). |
| `VITE_ADMIN_PASSWORD` | Senha da Central Administrativa do frontend (default `aura123`). |

## Como rodar

Instale as dependências da raiz, do backend e do frontend:

```bash
npm run install:all
```

Suba backend + frontend juntos:

```bash
npm run dev
```

Ou individualmente:

```bash
npm --prefix backend run dev     # API em :4000 (node --watch)
npm --prefix frontend run dev    # SPA em :5173 (vite)
```

Acesse:

- Frontend: `http://localhost:5173`
- API: `http://localhost:4000`
- Health check: `http://localhost:4000/api/health` e `/api/health/db`

No boot, o backend garante o schema `platform`, semeia o super-admin (em dev) e aplica o `schema.sql` (idempotente) em todos os schemas de clínica. Logins de teste locais: ver `docs/FLUXOS.md`.

## Testes

Testes de integração de endpoint (caixa-preta via HTTP), com o runner nativo `node --test` + `fetch`. Não usam mocks: sobem um servidor Express real com autenticação real.

```bash
npm --prefix backend test
```

O runner (`backend/tests/run-suite.mjs`):

1. Sobe o servidor com `NODE_ENV=production` (auth **real**, sem bypass de dev) numa porta dedicada (`TEST_PORT`, default `4199`).
2. Aguarda `/api/health` responder.
3. Roda os testes de `backend/tests/*.test.mjs`.
4. Derruba o servidor e propaga o código de saída.

Cobrem, entre outros: autorização das rotas de plataforma, ciclo de vida do tenant (criar/suspender/reativar/excluir), autenticação e **isolamento entre clínicas** (token cruzado → 403, dados de A invisíveis em B), e validação Zod dos corpos.

**Requisitos**: PostgreSQL acessível via `DATABASE_URL` (o servidor sobe de verdade e cria/derruba schemas de tenants de teste). A env de teste é autoconfigurada pelo runner (super-admin default e `ALLOW_PUBLIC_SIGNUP=true`), sem setup manual além do banco.

Para rodar um arquivo específico (a partir de `backend/`):

```bash
node tests/run-suite.mjs tests/security.test.mjs
```

## Scripts úteis

Todos em `backend/scripts/`.

### Backup — `npm --prefix backend run backup`

Executa `backup.sh`: carrega o `.env`, valida `DATABASE_URL` e `pg_dump`, e gera um dump SQL em `backend/backups/aura_clinic_<TIMESTAMP>.sql`. Inclui todos os schemas (`platform` e `tenant_*`). Agende num cron em produção.

### Migração para multi-tenant — `node backend/scripts/migrate-to-multitenant.mjs`

Migração **única** que converte um banco legado single-tenant (tabelas no schema `public`) para o modelo multi-tenant. Passos: garante o schema `platform`; cria (se não existir) o tenant inicial `aura` e seu schema `tenant_<id>`; **move** todas as tabelas de `public` para o schema do tenant via `ALTER TABLE ... SET SCHEMA` (sem copiar dados). É idempotente: se `aura` já existir, não faz nada. Rode apenas se você tiver dados legados no `public`.

### Teste de isolamento — `node backend/scripts/test-isolation.mjs`

Prova de isolamento entre clínicas por HTTP (**exige o servidor já rodando**). Cria dois tenants de teste, executa 9 checagens e imprime `PASS/FAIL`:

1. Login de plataforma (super-admin).
2. Criação dos tenants A e B.
3. Login em A e B.
4. Criação de cliente no A.
5. B não enxerga o cliente do A.
6. Token de A com `X-Tenant` de B → `403`.
7. Tenant B suspenso → rotas de B retornam `403` (e reativa depois).
8. 30 requisições alternando A/B — A sempre vê 1 cliente, B sempre 0 (prova que nenhum client volta ao pool "sujo").
9. Exclusão dos tenants de teste.

Bom rodar como sanidade pós-deploy. Config por env: `TEST_BASE_URL`, `PLATFORM_ADMIN_EMAIL`, `PLATFORM_ADMIN_PASSWORD`.

## Estrutura de pastas

Resumo (detalhes completos em `docs/ARQUITETURA.md`):

```text
backend/src/
  index.js         Bootstrap (middlewares, routers, boot multi-tenant)
  config/          Env e constantes de domínio
  database/        Pool PostgreSQL (pg)
  db/              schema.sql (clínica), platformSchema.sql (controle), sqliteCompat.js (adaptador)
  middleware/      withDb, tenant, auth, rateLimit, upload, validate
  routes/          Um router por domínio (+ platform.js: signup e painel de plataforma)
  services/        Regras de negócio (tenants, finance, sales, inventory, loyalty, ...)
  schemas/         Schemas de validação Zod
  data/uploads/    Arquivos enviados
frontend/src/
  main.jsx         App shell (rotas por pathname + estado; lazy por feature)
  lib/             api.js (cliente HTTP), permissions, defaultForms, utils, calendarUtils
  components/      common (Ui, Crud, Feedback, AppErrorBoundary), auth (Login), layout (Sidebar)
  features/        Telas por domínio (+ platform: Signup, PlatformAdmin)
  pages/           PublicExperience (catálogo/booking/checkout), CatalogCustomization
```

## Convenções

- **Adaptador `db` estilo SQLite**: os handlers/services recebem um adaptador `db` (`db.get/all/run`) com placeholders posicionais `?` (convertidos para `$1, $2, ...`). Não use o driver `pg` diretamente no código de negócio — isso quebraria o isolamento por `search_path`. Em `INSERT` sem `RETURNING`, o adaptador acrescenta `RETURNING id` automaticamente para popular `lastID`.
- **Isolamento por tenant**: nunca abra conexão fora do `withDb` para atender uma requisição de clínica. O `withDb` garante o `search_path` correto e o reset ao devolver o client ao pool.
- **Validação Zod**: valide o corpo dos POST/PATCH com os schemas de `backend/src/schemas/index.js`. Os schemas são permissivos (`.passthrough()`), validando presença/tipo dos campos obrigatórios e preservando extras do frontend.
- **Autorização por papel**: restrinja handlers sensíveis com `requireRole(req, res, [...])`. Papéis: `admin`, `reception`, `finance`, `piercer`.
- **Rotas públicas**: se criar uma rota sem autenticação, adicione-a explicitamente à allowlist de `requiresAuth` (`backend/src/middleware/auth.js`) ou coloque-a sob `/api/booking`. Lembre que ela ainda resolve o tenant.
- **Componentes compartilhados**: reutilize `Modal`, `DataTable`, `CrudHeader`, `ConfirmDeleteModal`, `Button`, `StatusBadge`, `Input`/`Select`/`Textarea` (em `frontend/src/components/common/`) ao montar telas novas, mantendo a consistência visual e de comportamento.
- **RBAC no frontend**: a navegação e a página inicial por papel vêm de `frontend/src/lib/permissions.js` (`canAccessPage`, `defaultPageForRole`).
- **Cliente de API**: use `apiFetch`/`useFetch` de `frontend/src/lib/api.js` (injetam `X-Tenant` e `Authorization` automaticamente); não faça `fetch` cru para a API.
- **Segurança em produção**: `NODE_ENV=production`, `AUTH_SECRET` forte, `PLATFORM_ADMIN_*` definidos, `CORS_ORIGIN` restrito, HTTPS via proxy reverso, e trocar a senha padrão do admin da clínica migrada. Rode `test-isolation.mjs` como sanidade.
