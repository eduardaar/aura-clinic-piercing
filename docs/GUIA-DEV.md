# Guia do desenvolvedor

Como configurar, rodar, testar e evoluir a **Aura Clinic Piercing** localmente. Complementa `docs/ARQUITETURA.md` (visão geral) e `docs/API.md` (endpoints).

## Pré-requisitos

- **Node.js 20.19+**
- **PostgreSQL 14+** em execução
- Cliente PostgreSQL (`createdb`, `psql`, `pg_dump`) no PATH — necessário para o script de backup.

## Configuração

### 1. Banco de dados

Crie o banco (nome padrão `aura_clinic`):

```bash
createdb aura_clinic
# ou: psql -U postgres -c "CREATE DATABASE aura_clinic;"
```

Um único banco atende todas as clínicas: o schema de controle `platform` e um schema `tenant_<slug>` por clínica são criados pelo backend (ver `docs/ARQUITETURA.md`). O bootstrap no boot depende de `RUN_DATABASE_MIGRATIONS`: com `false`, o servidor sobe sem tocar no banco e num banco vazio nada é criado — nem o schema `platform`, nem o superadmin.

Como o `backend/.env.example` vem com `RUN_DATABASE_MIGRATIONS=false`, prepare a base local com o reset seguro (ver [Scripts úteis](#reset-da-base-local--npm---prefix-backend-run-dbreset-local)):

```bash
npm --prefix backend run db:reset-local
```

### 2. `.env` do backend

Copie `backend/.env.example` para `backend/.env` e ajuste. Variáveis principais:

| Variável | Papel |
| --- | --- |
| `NODE_ENV` | `development` (dev) ou `production`. Em produção o boot passa a exigir as guardas desta tabela e recusa o bypass local (`ALLOW_LOCAL_AUTH_BYPASS`); o token é obrigatório nos dois casos. |
| `PORT` | Porta da API (default `4000`). |
| `API_BIND_HOST` | Interface em que a API escuta (default `127.0.0.1` fora de produção e `0.0.0.0` em produção). |
| `DATABASE_URL` | Conexão Postgres, ex.: `postgres://postgres:SENHA@localhost:5432/aura_clinic` (obrigatória). |
| `DATABASE_SSL` | `true` para exigir SSL na conexão. Obrigatória em produção, com validação do certificado (`DATABASE_SSL_REJECT_UNAUTHORIZED`, `DATABASE_SSL_CA`). `DATABASE_POOL_MAX` ajusta o pool (default `10`). |
| `AUTH_SECRET` | Segredo dos tokens HMAC. Obrigatório em produção; o boot recusa o default de dev e valores com menos de 32 bytes em produção. Gere com `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. |
| `CORS_ORIGIN` | Origem(ns) do frontend permitida(s) no CORS (separadas por vírgula), ex.: `http://localhost:5174`. Obrigatória em produção e sem `*`; fora de produção `localhost:5174` e `127.0.0.1:5174` são sempre aceitas. |
| `TRUST_PROXY_HOPS` | Número de proxies confiáveis até o Node (0 a 5; default `2` em produção e `0` fora dela). Define o IP usado pelo rate limit e pelo bloqueio de login. |
| `RUN_DATABASE_MIGRATIONS` / `SKIP_DATABASE_BOOTSTRAP` | Bootstrap de banco no boot (ver acima). Em produção o bootstrap só roda com `ALLOW_LEGACY_GLOBAL_BOOTSTRAP=true`. |
| `RUN_MIGRATIONS_ON_BOOT` | `true` aplica as migrations versionadas no boot. Proibida em produção (o boot falha). |
| `PUBLIC_API_URL` / `PUBLIC_APP_URL` | Endereços públicos da API e do painel, usados em URLs de webhook e em links enviados (recuperação de senha, termos por link). Em produção `PUBLIC_API_URL` precisa ser `https://`. |
| `REDIS_URL` | Redis dos contadores de bloqueio do login da plataforma; sem ele, contadores em memória. |
| **Multi-tenant** | |
| `DEFAULT_TENANT` | Clínica assumida quando a requisição não traz token, `X-Tenant`, `?t=` nem subdomínio de clínica (ex.: `aura`). Útil em dev; **omita** em produção multi-clínica para exigir `X-Tenant` explícito. |
| `PLATFORM_ADMIN_EMAIL` / `PLATFORM_ADMIN_PASSWORD` | Super-admin da plataforma, semeado no primeiro boot se não houver nenhum. **Obrigatórias em produção** (sem elas o boot não cria credenciais padrão). |
| `ALLOW_PUBLIC_SIGNUP` | `false` desabilita `POST /api/signup` (só o super-admin cria clínicas). Qualquer outro valor mantém o cadastro público ativo. |
| `SMTP_VAULT_KEY` | Chave dedicada que cifra a senha SMTP salva pelo painel. Recomendada em todos os ambientes persistentes para permitir rotacionar `AUTH_SECRET` sem perder a credencial. Defini-la depois é seguro (a senha antiga é regravada ao abrir a tela de e-mail), mas o deploy não a sincroniza: vai à mão no `.env` do servidor. Ver [SMTP.md](SMTP.md). |

As integrações (Asaas, Cloudflare R2, Resend, WhatsApp Cloud API, assistente de IA) e os workers em segundo plano (`ASAAS_RECONCILE_*`, `JOBS_WORKER_*`, `BILLING_LIFECYCLE_*`) estão comentados, com valores de exemplo, no próprio `backend/.env.example`. Em produção o R2 é obrigatório.

### 3. `.env` do frontend

Copie `frontend/.env.example` para `frontend/.env`. O padrão já aponta para a API local:

| Variável | Papel |
| --- | --- |
| `VITE_API_URL` | Base da API em desenvolvimento (default `http://localhost:4000/api`). O build de produção ignora a variável e chama sempre `/api` no mesmo domínio (`frontend/src/lib/api.js`). |
| `VITE_DEV_API_TARGET` | Destino do proxy do Vite para `/api` e `/uploads` em desenvolvimento (default `http://localhost:4000`). |

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
npm --prefix frontend run dev    # SPA em :5174 (vite, escutando em 127.0.0.1)
```

Acesse:

- Frontend: `http://localhost:5174`
- API: `http://localhost:4000`
- Health check: `http://localhost:4000/api/health` e `/api/health/db`

Com o bootstrap habilitado (`RUN_DATABASE_MIGRATIONS` diferente de `false`), o boot garante o schema `platform`, semeia o super-admin (em dev) e aplica o `schema.sql` (idempotente) em todos os schemas de clínica; as migrations versionadas só entram com `RUN_MIGRATIONS_ON_BOOT=true` ou pelo CLI. Com o `.env.example` como está, o boot não toca no banco e quem prepara a base é o `db:reset-local`. Logins de teste locais: ver `docs/FLUXOS.md`.

## Testes

Testes de integração de endpoint (caixa-preta via HTTP), com o runner nativo `node --test` + `fetch`. Não usam mocks: sobem um servidor Express real com autenticação real.

```bash
npm --prefix backend test
```

Durante o desenvolvimento, use os atalhos da raiz conforme o alcance da mudança:

```bash
npm run check:changed   # Biome apenas nos arquivos alterados em relação à main
npm run verify:static   # Biome nos alterados, typecheck (backend e frontend) e build do frontend
npm run verify:full     # verificação estática e todas as suítes backend/frontend
```

O runner aceita vários testes backend com uma única subida da API:

```bash
npm --prefix backend test -- tests/security.test.mjs tests/permissions.test.mjs
```

O runner (`backend/tests/run-suite.mjs`):

1. Sobe o servidor com `NODE_ENV=production` (auth **real**, sem bypass de dev) numa porta dedicada (`TEST_PORT`, default `4199`), com `ALLOW_INSECURE_TEST_ENV=true`, `DISABLE_RATE_LIMIT=true` e o bootstrap legado ligado só para esse processo.
2. Aguarda `/api/health` responder.
3. Cria um super-admin efêmero em `platform.platform_users` (removido no encerramento).
4. Roda os testes de `backend/tests/*.test.mjs` (ou os arquivos passados), um de cada vez.
5. Derruba o servidor e propaga o código de saída.

Cobrem, entre outros: autorização das rotas de plataforma, ciclo de vida do tenant (criar/suspender/reativar/excluir), autenticação e **isolamento entre clínicas** (token cruzado → 403, dados de A invisíveis em B), e validação Zod dos corpos.

**Requisitos**: PostgreSQL acessível via `DATABASE_URL` (o servidor sobe de verdade e cria/derruba schemas de tenants de teste). O restante da env de teste é autoconfigurado pelo runner (super-admin efêmero e `ALLOW_PUBLIC_SIGNUP=true`).

> **Atenção:** o runner carrega o mesmo `backend/.env` (e o `.env` da raiz, se existir) e repassa tudo ao servidor de teste. Credenciais reais nesse arquivo (Asaas, R2, Resend, IA) passam a valer no servidor de teste e podem ser usadas pela suíte. Mantenha o `.env` local sem chaves de produção.

Para rodar um arquivo específico (a partir de `backend/`):

```bash
node tests/run-suite.mjs tests/security.test.mjs
```

O frontend combina testes unitários do Node com testes de componentes do Vitest:

```bash
npm --prefix frontend test
```

Para um arquivo só (a partir de `frontend/`): `node --test tests/appPages.test.mjs` para os unitários ou `npx vitest run tests/DataView.test.jsx` para os de componente.

## Scripts úteis

Todos em `backend/scripts/`.

### Backup — `npm --prefix backend run backup`

Executa `backup.sh`: carrega o `.env`, valida `DATABASE_URL` e `pg_dump`, e gera um dump SQL em `backend/backups/aura_clinic_<TIMESTAMP>.sql`. Inclui todos os schemas (`platform` e `tenant_*`). Agende num cron em produção.

Os anexos em disco têm backup próprio (`npm --prefix backend run backup:uploads`), pré-requisito da migração para o R2 (`npm --prefix backend run migrate:r2`); o passo a passo está em [R2.md](R2.md).

### Reset da base local — `npm --prefix backend run db:reset-local`

Executa `reset-local-data.mjs`. Recusa rodar com `NODE_ENV=production` ou com `DATABASE_URL` fora de `localhost`, `127.0.0.1` ou `::1`. Numa transação, apaga **todos** os schemas `tenant_*` e o schema `platform`; depois recria a plataforma (`platformSchema.sql`, super-admin inicial e migrations de plataforma) e informa quantas clínicas e administradores da plataforma restaram. Serve para começar do zero e para preparar um banco vazio.

### Migração para multi-tenant — `node backend/scripts/migrate-to-multitenant.mjs`

Migração **única** que converte um banco legado single-tenant (tabelas no schema `public`) para o modelo multi-tenant. Passos: garante o schema `platform`; cria (se não existir) o tenant inicial `aura` e o schema dele; **move** todas as tabelas de `public` para o schema do tenant via `ALTER TABLE ... SET SCHEMA` (sem copiar dados). É idempotente: se `aura` já existir, não faz nada. Rode apenas se você tiver dados legados no `public`.

### Migrations versionadas — `npm --prefix backend run migrations:apply`

As mudanças novas de banco ficam em `backend/src/db/migrations/{platform,tenant}`
no formato `NNNN_descricao.sql`. O runner mantém o ledger central
`platform.schema_migrations`, valida SHA-256 de versões já aplicadas e usa lock
transacional por schema. Antes de publicar, rode na base local:

```bash
npm --prefix backend run migrations:apply
npm --prefix backend run migrations:verify
```

`verify` falha se houver migration pendente ou se um arquivo aplicado tiver
mudado; `npm --prefix backend run migrations:status` só lista. O CLI exige o
schema `platform` já criado. O boot mantém os schemas idempotentes legados na
transição e só executa o runner para tenants existentes quando
`RUN_MIGRATIONS_ON_BOOT=true` (proibido em produção). Em produção, `apply` só
roda com `--tenant=<id|slug>` ou com `--all` e `ALLOW_GLOBAL_MIGRATIONS=true`; o
deploy não aplica migrations — o rollout é feito pelo workflow manual "Aplicar
migrations em produção" (ver [CI e deploy](#ci-e-deploy)). Não edite migration
aplicada: crie a próxima versão. Veja também `backend/src/db/migrations/README.md`.

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

### Recuperação de admin — `npm run restore-admin -- --email=<e-mail>`

Devolve o papel `admin` a uma conta existente, sem criar usuário; `--tenant=<slug>` restringe a uma clínica. Detalhes no README da raiz ("Recuperação administrativa").

### Homologação crítica — `node backend/scripts/qa-homologation-critical.mjs`

Homologação **destrutiva** por HTTP: cria uma clínica QA pelo cadastro público, exercita os fluxos contra a API em `TEST_API_URL` (default `http://localhost:4000/api`), confere o resultado direto no banco e preserva a clínica para inspeção. Não tem script npm. Foi escrita para a rodada registrada em [RELATORIO-HOMOLOGACAO-CRITICA-2026-08-27.md](RELATORIO-HOMOLOGACAO-CRITICA-2026-08-27.md) e ainda chama `/api/consumables` e confere a ordem de serviço gerada pelo atendimento, que saíram depois (`48e5bfa1`; `c1176101` e `8584be9d`): atualize antes de rodar de novo.

## Estrutura de pastas

Resumo (detalhes completos em `docs/ARQUITETURA.md`):

```text
backend/src/
  index.js         Bootstrap (middlewares, routers, boot multi-tenant)
  config/          Env e constantes de domínio; permissions.js (catálogo de permissões) e roles.js (permissões por cargo)
  database/        Pool PostgreSQL (pg)
  db/              schema.sql (clínica), platformSchema.sql (controle), postgres.js (camada db), migrations/ (platform e tenant) + migrations.js
  middleware/      withDb, tenant, auth, requirePermission, rateLimit, upload, validate
  routes/          Um router por domínio (+ platform.js: signup e painel de plataforma)
  services/        Regras de negócio (tenants, finance, sales, inventory, loyalty, ...)
  schemas/         Schemas de validação Zod
  data/uploads/    Fallback local de arquivos (o R2 é o armazenamento de produção)
frontend/src/
  main.jsx         App shell (rotas por pathname + estado; lazy por feature)
  lib/             appPages.js (registro único de páginas), appRoutes.js, api.js (cliente HTTP), permissions, defaultForms, utils, calendarUtils
  components/      common (Ui, Crud, DataView, Feedback, AppErrorBoundary), auth (Login), layout (Sidebar, PublicTopNav, PublicFooter)
  features/        Telas por domínio (+ platform: Signup, PlatformAdmin)
  pages/           PublicExperience (catálogo/booking/checkout), CatalogCustomization, Landing, LegalDocument, News, PublicDirectory, PublicTerm
```

## Convenções

- **Camada `db`**: os handlers/services recebem um `db` (`db.get/all/run/transaction`) com placeholders posicionais `?` — a convenção de parâmetro do projeto, traduzida posicionalmente para `$1, $2, ...` antes de chegar ao driver. Não use o driver `pg` diretamente no código de negócio — isso quebraria o isolamento por `search_path`. Nada é acrescentado à sua query: para obter o id gerado por um `INSERT`, escreva `RETURNING id` e leia `result.returnedId` (`result.changes` traz as linhas afetadas).
- **Isolamento por tenant**: nunca abra conexão fora do `withDb` para atender uma requisição de clínica. O `withDb` garante o `search_path` correto e o reset ao devolver o client ao pool.
- **Validação Zod**: valide o corpo dos POST/PATCH com os schemas de `backend/src/schemas/index.js`. Os schemas são permissivos (`.passthrough()`), validando presença/tipo dos campos obrigatórios e preservando extras do frontend.
- **Autorização por permissão**: restrinja handlers sensíveis com `authorizePermission(req, res, P.X)` (`backend/src/middleware/requirePermission.js`), usando as chaves do catálogo `P` de `backend/src/config/permissions.js` — nunca string literal. As permissões padrão de cada papel (`admin`, `reception`, `finance`, `piercer`) ficam em `backend/src/config/roles.js`; perfis de acesso e exceções por usuário são resolvidos em `services/permissionService.js`. `requireRole(req, res, [...])` ainda existe em rotas legadas; nelas, perfil de acesso e exceções individuais não fazem diferença.
- **Rotas públicas**: se criar uma rota sem autenticação, adicione-a explicitamente à allowlist de `requiresAuth` (`PUBLIC_ROUTE_METHODS` ou uma regra própria em `backend/src/middleware/auth.js`). Estar sob `/api/booking` não basta: só as rotas de booking listadas ali são públicas. Lembre que ela ainda resolve o tenant.
- **Componentes compartilhados**: reutilize `Modal`, `CrudHeader`, `RowActions`, `ConfirmDeleteModal` (em `Crud.jsx`), `DataView` (listagens com busca, filtros e paginação), `Button`, `StatusBadge`, `Input`/`Select`/`Textarea`/`Checkbox`/`Tabs`/`Switch` (em `Ui.jsx`), todos em `frontend/src/components/common/`, ao montar telas novas. `frontend/tests/UiArchitecture.test.mjs` recusa `<select>`, `<dialog>`, `<details>` e checkbox/radio nativos em `components/`, `features/` e `pages/`, import direto de `@radix-ui` em `features/` e `pages/` (use `components/common`) e CSS de `src/styles/` sem `@layer`.
- **RBAC no frontend**: rota, menu, permissão e feature de plano de cada página vêm do registro `frontend/src/lib/appPages.js`; `frontend/src/lib/permissions.js` deriva dele `canAccessPage` e `defaultPageForRole` e usa a lista `user.permissions` devolvida pelo login.
- **Cliente de API**: use `apiFetch`/`useFetch` de `frontend/src/lib/api.js` (injetam `X-Tenant` e `Authorization` automaticamente); não faça `fetch` cru para a API.
- **Segurança em produção**: `NODE_ENV=production`, `AUTH_SECRET` forte, `PLATFORM_ADMIN_*` definidos, `CORS_ORIGIN` restrito, HTTPS via proxy reverso, e trocar a senha de contas herdadas do banco legado. Rode `test-isolation.mjs` como sanidade. Ver também `SECURITY.md` na raiz.

## CI e deploy

| Workflow | Disparo | O que faz |
| --- | --- | --- |
| `.github/workflows/deploy.yml` ("CI e Deploy") | PR para `main`, push na `main` e manual | Job "Testes, tipos e build": `npm run audit:security`, `npm run typecheck`, `npm --prefix backend test` (Postgres de serviço, sem credenciais do Asaas), testes e build do frontend e `npm run lint`. Em push/manual, o job "Pré-requisitos do deploy" exige o secret da chave SSH (sem ele o deploy é pulado), recusa `ASAAS_API_KEY` sem `ASAAS_WEBHOOK_TOKEN` e exige as seis `R2_*`; depois o job de deploy chama `scripts/deploy.sh`. PR nunca publica. A execução manual aceita `rollback`. |
| `.github/workflows/migrations-production.yml` ("Aplicar migrations em produção") | Só manual, digitando `APLICAR` | Gera e valida um `pg_dump` de restauração, roda `migrations.mjs status`, `apply --all` (com `ALLOW_GLOBAL_MIGRATIONS=true`) e `verify`, recria a API e confere `/api/health/db`. |
| `.github/workflows/verificar-producao.yml` ("Verificar produção") | Só manual | Consultas somente leitura na base de produção. |
| `.github/workflows/inventory-dry-run.yml` ("Estoque - Dry Run tenant_2") | Só manual | Auditoria somente leitura do estoque de uma clínica com `reconcile-physical-inventory.mjs` (inventário físico de 12/08/2026). O script ainda monta o schema como `tenant_<id>` e exige `tenant_2`, sem ler `platform.tenants.schema_name`; desde a migration platform `0005`, que renomeia o schema para `tenant_<slug>`, tende a não encontrar as tabelas. |

`scripts/deploy.sh` (6 etapas) faz o build do frontend, sincroniza o backend (sem `.env` nem os uploads em disco), envia o frontend para uma release inativa (`<front>.next`), sincroniza os secrets de Asaas e R2 (e `PUBLIC_API_URL`) no `.env` do servidor sem sobrescrever valor com vazio, gera um restore point do banco (falha se o `pg_dump` falhar), grava `RUN_DATABASE_MIGRATIONS=false`, `SKIP_DATABASE_BOOTSTRAP=true` e `RUN_MIGRATIONS_ON_BOOT=false`, recria a API (`--force-recreate`), espera `/api/health/db` com banco conectado e só então troca o frontend de forma atômica, guardando a release anterior em `<front>.previous`. **O deploy não aplica migrations**: quando houver migration nova, rode o workflow manual depois de publicar. `ROLLBACK=true` (input `rollback` do workflow) volta a imagem anterior da API e a release anterior do frontend; migrations e `.env` não voltam. `SSH_COMMAND` permite usar um wrapper no lugar de `ssh`.

## Bloqueio de IP no login de plataforma

O login de `/plataforma` tem, além do rate limit por janela, uma escalada de bloqueio
por IP (`backend/src/services/loginGuard.js`):

| evento | efeito |
| --- | --- |
| 5 falhas em 15 min | IP bloqueado por 15 min (`429`, com `Retry-After`) |
| 2º bloqueio (novo ciclo de 5 falhas) | IP **banido permanentemente** (`403`) |
| login correto | zera a contagem daquele IP |

Os *strikes* expiram em 24 h de bom comportamento — dois erros com meses de
distância não banem ninguém.

**Contadores** ficam no Redis (`REDIS_URL`), sem persistência: são efêmeros de
propósito. **Bans permanentes** ficam no Postgres, em `platform.blocked_ips`.
Sem `REDIS_URL`, o guard cai para contadores em memória do processo — mais fraco
(não é compartilhado entre réplicas e zera no restart), mas o login continua
funcionando. Falhar fechado derrubaria o acesso ao painel junto com o Redis.

### Desbloquear um IP

O ban só sai por remoção manual — é a válvula de escape consciente:

```sql
-- listar
SELECT ip, strikes, blocked_at, reason, last_email FROM platform.blocked_ips ORDER BY blocked_at DESC;

-- desbloquear
DELETE FROM platform.blocked_ips WHERE ip = '203.0.113.9';
```

Em produção (container):

```bash
docker exec monitence-postgres psql -U aura -d aura_clinic \
  -c "DELETE FROM platform.blocked_ips WHERE ip = '203.0.113.9';"
```

Para limpar também o bloqueio temporário de 15 min do mesmo IP:

```bash
docker exec aura-redis redis-cli DEL "plat:block:203.0.113.9" "plat:fail:203.0.113.9" "plat:strike:203.0.113.9"
```

> **Atenção:** o IP considerado é o `req.ip` calculado pelo Express a partir da
> cadeia de proxies confiáveis (`TRUST_PROXY_HOPS`); o código nunca lê
> `CF-Connecting-IP` diretamente. Se o seu acesso sair de um IP compartilhado (NAT corporativo,
> operadora móvel), o ban atinge todo mundo que compartilha aquele IP — inclusive
> você. Por isso o desbloqueio exige acesso ao banco, não à interface.
