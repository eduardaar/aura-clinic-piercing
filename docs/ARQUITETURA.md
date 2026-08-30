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

- **Backend** — `backend/`: API REST em Node.js + Express 5, persistência em PostgreSQL. Autenticação por token HMAC próprio (sem JWT externo). Arquivos novos vão ao Cloudflare R2 quando as seis variáveis `R2_*` estão configuradas; o disco local é o fallback de desenvolvimento e de arquivos ainda não migrados.
- **Frontend** — `frontend/`: SPA em React 18 + Vite 5, ícones `lucide-react` e primitives comportamentais do Radix UI. Os componentes reutilizáveis e a identidade visual continuam próprios, centralizados em `components/common/Ui.jsx`. As telas públicas são escolhidas por `window.location.pathname`; o painel mantém URLs em `/app/*` por `appRoutes.js`, com controle de acesso por papel. As telas de cada feature são carregadas sob demanda (`React.lazy` + `Suspense`).

Scripts da raiz (`package.json`):

| Script | O que faz |
| --- | --- |
| `npm run install:all` | Instala dependências da raiz, do backend e do frontend. |
| `npm run dev` | Sobe backend (`:4000`) e frontend (`:5174`) juntos via `concurrently`. |
| `npm run start` | Sobe apenas o backend em modo produção. |
| `npm run build` | Build de produção do frontend (Vite). |

## 2. Multi-tenancy por schema Postgres

O ponto central da arquitetura é o **isolamento físico de cada clínica em um schema Postgres próprio**. Não há coluna `tenant_id` espalhada pelas tabelas: cada clínica tem um schema dedicado com um conjunto completo de tabelas.

### Organização do banco

Um único banco de dados PostgreSQL (`aura_clinic`) é organizado em schemas:

- **`platform`** — schema de controle da plataforma: clínicas, planos, assinaturas, faturas, super-admins, auditoria, webhooks, landing, documentos legais e suporte. Definido em `backend/src/db/platformSchema.sql`.
- **`tenant_<slug>`** — um schema por clínica, criado no provisionamento. O nome é `"tenant_"` + o slug com `_` no lugar de `-` (`schemaNameForSlug`, em `services/tenants.js`), calculado **uma única vez** no provisionamento e gravado em `platform.tenants.schema_name`. Nunca é recalculado depois: se o slug um dia ganhar edição, o schema não pode sair andando atrás dele. O slug já chega validado por regex, então o nome nunca é input livre. Recebe as tabelas de `backend/src/db/schema.sql` mais as migrations de tenant.

Exemplo: a clínica de slug `aura-clinic` vive no schema `tenant_aura_clinic`, com suas próprias tabelas `users`, `clients`, `appointments`, etc., totalmente separadas das demais clínicas. Schemas provisionados antes da migration `0005_tenant_schema_names` podem ainda seguir o formato antigo `tenant_<id>` — por isso o código sempre lê `schema_name` do registro e só usa o formato por id como fallback.

### Vantagens do modelo

- **Isolamento forte**: os dados de uma clínica nunca compartilham tabela com outra. Um `DROP SCHEMA tenant_aura_clinic CASCADE` remove tudo de uma clínica sem tocar nas demais.
- **Migrations idempotentes multi-schema**: o `schema.sql` usa `CREATE TABLE IF NOT EXISTS`, então aplicá-lo em todos os schemas no boot propaga novas tabelas/colunas para todas as clínicas.
- **Provisionamento/desprovisionamento simples**: criar uma clínica = criar um schema + rodar o schema; excluir = `DROP SCHEMA`.

### Boot do servidor

No arranque (`backend/src/index.js`), após montar os routers, o servidor executa em ordem:

0. **Portão de bootstrap** — `databaseBootstrapIsDisabled()` (`src/db/migrationPolicy.js`) decide se os passos abaixo rodam. Ele devolve `true` (ou seja, **pula tudo**) quando `SKIP_DATABASE_BOOTSTRAP=true` **ou** `RUN_DATABASE_MIGRATIONS=false`, e também em produção sem `ALLOW_LEGACY_GLOBAL_BOOTSTRAP=true`. Consequência prática: num banco vazio com `RUN_DATABASE_MIGRATIONS=false`, o servidor sobe normalmente e **não cria schema `platform` nem superadmin** — a API responde, mas nenhuma clínica existe nem pode ser criada.
1. `ensurePlatform()` — garante o schema `platform` (aplica `platformSchema.sql`, que já traz os planos-semente) e, se `platform.platform_users` estiver vazia, semeia o superadmin inicial (ver seção de autenticação).
2. `applyPlatformMigrations()` — só roda com `RUN_MIGRATIONS_ON_BOOT=true`, que é **proibido em produção** (o boot lança erro). O caminho normal é o CLI `npm --prefix backend run migrations:apply`, chamado pelo pipeline de deploy antes de subir a API.
3. `applySchemaToAllTenants()` — runner multi-schema: para cada tenant em `platform.tenants`, faz `SET search_path` para o schema da clínica e aplica o `schema.sql` idempotente.

As funções vivem em `backend/src/services/tenants.js`.

**Clínica nova não depende disso.** `provisionTenant()` cria o schema e aplica `schema.sql` + **todas** as migrations de tenant na mesma transação do cadastro. Uma clínica criada hoje já nasce na versão corrente do schema.

## 3. Ciclo de vida de uma requisição

Todo handler de rota é embrulhado pelo middleware `withDb` (`backend/src/middleware/withDb.js`), que garante o isolamento por tenant. A sequência para cada requisição:

1. **Wrap de resposta** — `res.json` é substituído para passar o payload por `normalizeDbValue` (paliativo de encoding via `text-normalizer.js`).

2. **Resolução do tenant** — chama `resolveTenant(req)` (`backend/src/middleware/tenant.js`). O slug da clínica é resolvido nesta ordem de precedência:
   1. **Token Bearer válido** com `tslug` embutido. Se o header `X-Tenant` divergir do slug do token → `403` (tentativa de acessar outra clínica com token de uma).
   2. **Header `X-Tenant`**.
   3. **Query** `t`, `tenant`, `clinic` ou `slug`; depois subdomínio elegível.
   4. **Env `DEFAULT_TENANT`** (conveniência para dev local).
   5. Nenhum → `400` ("Informe a clínica").

   O slug é validado por regex (`^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]# Arquitetura

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

- **Backend** — `backend/`: API REST em Node.js + Express 5, persistência em PostgreSQL. Autenticação por token HMAC próprio (sem JWT externo). Arquivos novos vão ao Cloudflare R2 quando as seis variáveis `R2_*` estão configuradas; o disco local é o fallback de desenvolvimento e de arquivos ainda não migrados.
- **Frontend** — `frontend/`: SPA em React 18 + Vite 5, ícones `lucide-react` e primitives comportamentais do Radix UI. Os componentes reutilizáveis e a identidade visual continuam próprios, centralizados em `components/common/Ui.jsx`. As telas públicas são escolhidas por `window.location.pathname`; o painel mantém URLs em `/app/*` por `appRoutes.js`, com controle de acesso por papel. As telas de cada feature são carregadas sob demanda (`React.lazy` + `Suspense`).

Scripts da raiz (`package.json`):

| Script | O que faz |
| --- | --- |
| `npm run install:all` | Instala dependências da raiz, do backend e do frontend. |
| `npm run dev` | Sobe backend (`:4000`) e frontend (`:5174`) juntos via `concurrently`. |
| `npm run start` | Sobe apenas o backend em modo produção. |
| `npm run build` | Build de produção do frontend (Vite). |

## 2. Multi-tenancy por schema Postgres

O ponto central da arquitetura é o **isolamento físico de cada clínica em um schema Postgres próprio**. Não há coluna `tenant_id` espalhada pelas tabelas: cada clínica tem um schema dedicado com um conjunto completo de tabelas.

### Organização do banco

Um único banco de dados PostgreSQL (`aura_clinic`) é organizado em schemas:

- **`platform`** — schema de controle da plataforma: clínicas, planos, assinaturas, faturas, super-admins, auditoria, webhooks, landing, documentos legais e suporte. Definido em `backend/src/db/platformSchema.sql`.
- **`tenant_<slug>`** — um schema por clínica, criado no provisionamento. O nome é `"tenant_"` + o slug com `_` no lugar de `-` (`schemaNameForSlug`, em `services/tenants.js`), calculado **uma única vez** no provisionamento e gravado em `platform.tenants.schema_name`. Nunca é recalculado depois: se o slug um dia ganhar edição, o schema não pode sair andando atrás dele. O slug já chega validado por regex, então o nome nunca é input livre. Recebe as tabelas de `backend/src/db/schema.sql` mais as migrations de tenant.

Exemplo: a clínica de slug `aura-clinic` vive no schema `tenant_aura_clinic`, com suas próprias tabelas `users`, `clients`, `appointments`, etc., totalmente separadas das demais clínicas. Schemas provisionados antes da migration `0005_tenant_schema_names` podem ainda seguir o formato antigo `tenant_<id>` — por isso o código sempre lê `schema_name` do registro e só usa o formato por id como fallback.

### Vantagens do modelo

- **Isolamento forte**: os dados de uma clínica nunca compartilham tabela com outra. Um `DROP SCHEMA tenant_aura_clinic CASCADE` remove tudo de uma clínica sem tocar nas demais.
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
   3. **Query** `t`, `tenant`, `clinic` ou `slug`; depois subdomínio elegível.
   4. **Env `DEFAULT_TENANT`** (conveniência para dev local).
   5. Nenhum → `400` ("Informe a clínica").

), buscado em `platform.tenants` (com **cache em memória de 60s** por slug), e o schema vem da coluna `schema_name` do registro. Clínica inexistente → `404`; clínica **suspensa** → `403`. Falhas de resolução viram respostas de erro sem jamais tocar o banco da aplicação. Como defesa em profundidade, o `withDb` ainda valida o schema resolvido contra `^tenant_[a-z0-9_]{1,58}# Arquitetura

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

- **Backend** — `backend/`: API REST em Node.js + Express 5, persistência em PostgreSQL. Autenticação por token HMAC próprio (sem JWT externo). Arquivos novos vão ao Cloudflare R2 quando as seis variáveis `R2_*` estão configuradas; o disco local é o fallback de desenvolvimento e de arquivos ainda não migrados.
- **Frontend** — `frontend/`: SPA em React 18 + Vite 5, ícones `lucide-react` e primitives comportamentais do Radix UI. Os componentes reutilizáveis e a identidade visual continuam próprios, centralizados em `components/common/Ui.jsx`. As telas públicas são escolhidas por `window.location.pathname`; o painel mantém URLs em `/app/*` por `appRoutes.js`, com controle de acesso por papel. As telas de cada feature são carregadas sob demanda (`React.lazy` + `Suspense`).

Scripts da raiz (`package.json`):

| Script | O que faz |
| --- | --- |
| `npm run install:all` | Instala dependências da raiz, do backend e do frontend. |
| `npm run dev` | Sobe backend (`:4000`) e frontend (`:5174`) juntos via `concurrently`. |
| `npm run start` | Sobe apenas o backend em modo produção. |
| `npm run build` | Build de produção do frontend (Vite). |

## 2. Multi-tenancy por schema Postgres

O ponto central da arquitetura é o **isolamento físico de cada clínica em um schema Postgres próprio**. Não há coluna `tenant_id` espalhada pelas tabelas: cada clínica tem um schema dedicado com um conjunto completo de tabelas.

### Organização do banco

Um único banco de dados PostgreSQL (`aura_clinic`) é organizado em schemas:

- **`platform`** — schema de controle da plataforma: clínicas, planos, assinaturas, faturas, super-admins, auditoria, webhooks, landing, documentos legais e suporte. Definido em `backend/src/db/platformSchema.sql`.
- **`tenant_<slug>`** — um schema por clínica, criado no provisionamento. O nome é `"tenant_"` + o slug com `_` no lugar de `-` (`schemaNameForSlug`, em `services/tenants.js`), calculado **uma única vez** no provisionamento e gravado em `platform.tenants.schema_name`. Nunca é recalculado depois: se o slug um dia ganhar edição, o schema não pode sair andando atrás dele. O slug já chega validado por regex, então o nome nunca é input livre. Recebe as tabelas de `backend/src/db/schema.sql` mais as migrations de tenant.

Exemplo: a clínica de slug `aura-clinic` vive no schema `tenant_aura_clinic`, com suas próprias tabelas `users`, `clients`, `appointments`, etc., totalmente separadas das demais clínicas. Schemas provisionados antes da migration `0005_tenant_schema_names` podem ainda seguir o formato antigo `tenant_<id>` — por isso o código sempre lê `schema_name` do registro e só usa o formato por id como fallback.

### Vantagens do modelo

- **Isolamento forte**: os dados de uma clínica nunca compartilham tabela com outra. Um `DROP SCHEMA tenant_aura_clinic CASCADE` remove tudo de uma clínica sem tocar nas demais.
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
   3. **Query** `t`, `tenant`, `clinic` ou `slug`; depois subdomínio elegível.
   4. **Env `DEFAULT_TENANT`** (conveniência para dev local).
   5. Nenhum → `400` ("Informe a clínica").

 antes de usá-lo.

   > **Atenção no consumo:** clínica inexistente responde `404` e token de outra clínica responde `403` — nenhum dos dois é `401`. Cliente que só trata `401` para derrubar sessão fica preso numa sessão inválida. Ver a pendência **P-01** em [ESTADO-ATUAL.md](./ESTADO-ATUAL.md).

3. **Client dedicado do pool com `search_path`** — `withDb` pega **um client do pool** Postgres (`pool.connect()`) e executa `SET search_path TO "tenant_<slug>", public`. A partir daí toda query dessa requisição roda no schema da clínica.

4. **Camada `db`** — `createDb(client)` (`backend/src/db/postgres.js`) embrulha o client numa interface fina de acesso ao Postgres (`get` / `all` / `run` com placeholders `?`). Isso é injetado no handler como terceiro argumento (`handler(req, res, db)`).

5. **Autenticação (quando exigida)** — se `requiresAuth(req)` for verdadeiro (ver seção 4), chama `authenticateRequest(req, db)`. Sem usuário válido → `401`. O usuário resolvido é anexado em `req.user`.

6. **Execução do handler** — a lógica de negócio roda usando o `db` (que já está apontando para o schema certo). Erros são capturados e devolvidos como `500` padronizado (detalhe do erro só em dev; em produção mensagem genérica, para não vazar stack/SQL).

7. **Reset garantido do `search_path`** — no `finally`, **sempre** executa `SET search_path TO public` antes de devolver o client ao pool. Isso é **crítico**: um client devolvido "sujo" (ainda apontando para um tenant) vazaria dados entre clínicas na próxima requisição que o reutilizasse. Se o reset falhar, o client é **descartado** (`client.release(true)` destrói a conexão em vez de devolvê-la ao pool).

Esse padrão — client por requisição + `search_path` + reset garantido — é o que produz o isolamento multi-tenant e é validado pelo script `backend/scripts/test-isolation.mjs`.

## 4. Autenticação e autorização

Implementada em `backend/src/middleware/auth.js`. Usa **token HMAC próprio** (`crypto.createHmac("sha256", AUTH_SECRET)`), sem dependência de biblioteca de JWT.

### Formato do token

`payload.assinatura`, onde `payload` é um JSON base64url e `assinatura` é o HMAC-SHA256 do payload. A verificação (`decodeToken`) confere a assinatura com `crypto.timingSafeEqual` e a expiração (`exp`). Nenhuma consulta ao banco é feita na decodificação.

### Dois tipos de token

- **Token de clínica** (`createToken`): carrega `sub` (id do usuário), `role`, `tid` (id do tenant), `tslug` (slug do tenant) e `sid` (id da sessão). **Validade de 15 minutos** (`ACCESS_TOKEN_MS`, em `services/sessions.js`). **Amarrado ao tenant**: na autenticação, o token só vale se `decoded.tid === req.tenant.id` — token de outra clínica é recusado.
- **Token de plataforma** (`createPlatformToken`): carrega `sub`, `role: "superadmin"` e a flag `plt: true`. Tokens de plataforma **nunca** autenticam em rotas de clínica (`authenticateRequest` rejeita `plt === true`), e tokens de clínica não têm `plt`, então nunca são aceitos no painel de plataforma (`verifyPlatformToken` exige `plt === true`).

Essa separação garante que o super-admin da plataforma e os usuários de clínica vivem em domínios de segurança distintos.

### Sessão: access token curto + refresh em cookie

O access token de 15 minutos é curto de propósito — ele fica acessível ao JavaScript da página. A credencial duradoura é o **refresh token**, entregue num cookie `HttpOnly` (`aura_refresh`) com validade de **30 dias** (`REFRESH_TOKEN_MS`), que o JavaScript não consegue ler.

Cada sessão tem uma linha em `user_sessions` no schema da clínica, guardando o **hash** do refresh token, `expires_at` e `revoked_at`. Isso torna a sessão revogável de verdade, coisa que um token HMAC puro não permite:

| Rota | Efeito |
| --- | --- |
| `POST /api/auth/refresh` | rotaciona o refresh token e devolve um access token novo |
| `POST /api/auth/logout` | revoga a sessão atual |
| `GET /api/account/sessions` | lista as sessões ativas do usuário |
| `POST /api/account/sessions/revoke-all` | derruba todas as sessões do usuário |

No frontend, `apiFetch` faz esse ciclo sozinho: recebeu `401`, chama `/auth/refresh`, repete a requisição **uma vez** e, se ainda falhar, limpa a sessão e recarrega a página.

Há também **MFA por TOTP** (`services/totp.js`): segredo cifrado em repouso, verificação com janela de tolerância e URI `otpauth://` para o QR do autenticador. O login de plataforma aceita `mfa_code` no corpo.

### Login de clínica x login de plataforma

- **Login de clínica** (`POST /api/login`, com header `X-Tenant`, definido em `routes/auth.js`): valida e-mail + senha (bcrypt) contra a tabela `users` **do schema da clínica** resolvida, e devolve um token de clínica.
- **Login de plataforma** (`POST /api/platform/login`, definido em `routes/platform.js`): valida contra `platform.platform_users` e devolve um token de plataforma.

> Nota: o cadastro público de clínica (`POST /api/signup`), o login de plataforma e todas as rotas `/api/platform/*` ficam em `routes/platform.js`. O `routes/auth.js` contém apenas o login de clínica.

### Rotas públicas

Além de login e health, são públicas a vitrine de planos/diretório de clínicas,
landing e documentos legais, catálogo e seus cálculos/eventos, checkout público,
rotas de booking, consulta pública de PIX/status, ingestão de erro do frontend e
webhooks autenticados pelo provedor. A lista completa está em [API.md](./API.md).

### Bypass de desenvolvimento local

**Desligado por padrão, inclusive em desenvolvimento.** `isLocalDevRequest` só devolve `true` com as três condições juntas: `NODE_ENV !== "production"`, `ALLOW_LOCAL_AUTH_BYPASS === "true"` e requisição vinda de `localhost`/`127.0.0.1`/`::1`. Nesse caso `authenticateRequest` dispensa o token e retorna o admin do tenant resolvido.

Sem a env explícita — que é a configuração recomendada, inclusive local — o token é obrigatório em toda rota protegida. Em produção a válvula é proibida: o boot lança erro se ela estiver ligada.

### Papéis, permissões e planos

A autorização tem **três camadas**, e confundi-las é a fonte mais comum de "por que esse usuário não vê a tela?".

**1. Papel (role).** A base, verificada por `requireRole(req, res, roles)`:

- `admin` — acessa tudo; `hasPermission` devolve `true` sem consultar mais nada.
- `reception` — agenda, serviços, clientes, produtos, vendas e relatórios.
- `finance` — contas a pagar/receber, compras, fornecedores, categorias, centros de custo, relatórios e vendas.
- `piercer` — agenda, atendimentos, clientes, prontuários, termos e pós-atendimento.

**2. Permissões granulares por usuário.** `services/permissionService.js` resolve o conjunto efetivo a partir do papel mais os overrides gravados em `user_permissions` (tabela do schema da clínica, criada pela migration `0003_user_permissions`):

```text
efetivo = (ROLE_PERMISSIONS[papel] ∪ granted_permissions) − denied_permissions
```

A revogação vence a concessão, e o catálogo de permissões válidas é fechado (`config/permissions.js`) — permissão fora dele é rejeitada na validação. `hydrateUserPermissions` carrega os overrides na requisição.

**3. Recursos do plano.** Acima das duas camadas, o plano contratado pode travar a página ou a ação (`services/planLimits.js`, e o mapa de features em `frontend/src/lib/permissions.js`). É por isso que um `admin` pode ver um item com cadeado: não falta permissão, falta plano.

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
│   └── postgres.js          Camada db (get/all/run + transaction) sobre um client + applySchemaSql
├── middleware/
│   ├── withDb.js            Wrapper de todo handler: resolve tenant, client+search_path, auth, reset
│   ├── tenant.js            Resolução do tenant (token/X-Tenant/DEFAULT_TENANT) + cache
│   ├── auth.js              Tokens HMAC (clínica e plataforma), requiresAuth, requireRole, bypass dev
│   ├── rateLimit.js         Limites de requisição (global e de login)
│   ├── upload.js            Configuração do multer (uploads de imagens/arquivos)
│   └── validate.js          Integração de validação (Zod)
├── routes/                  39 routers; cada um declara seus próprios caminhos /api/...
│   ├── Agenda e atendimento    appointments.js, availability.js, scheduleBlocks.js,
│   │                           professionals.js, services.js, procedures.js,
│   │                           terms.js, postcare.js
│   ├── Clientes                clients.js, privacy.js
│   ├── Estoque e compras       jewelry.js, consumables.js, purchases.js, options.js, erp.js
│   ├── Vendas e financeiro     sales.js, finance.js, payments.js, reports.js, billing.js
│   ├── Público                 catalog.js, booking.js, store.js, landing.js
│   ├── Acesso                  auth.js, users.js
│   ├── Plataforma              platform.js, planAdmin.js, platformFinance.js, accountAdmin.js
│   ├── Integrações             integrations.js, webhooks.js, notifications.js, aiAssistant.js
│   └── Operação                health.js, dashboard.js, alerts.js, uploads.js,
│                               jobs.js, errorLogs.js, support.js
├── services/                Regras de negócio (sem HTTP) — ~60 módulos
│   ├── tenants.js              Provisionamento/desprovisionamento, ensurePlatform, migrations
│   ├── sessions.js             Access token curto + refresh em cookie, revogação
│   ├── permissionService.js    Papel + overrides por usuário (user_permissions)
│   ├── plans.js, planLimits.js Planos e gates de recurso por assinatura
│   ├── Operacional             appointments.js, appointmentCancellations.js,
│   │                           consumableUsage.js, salesReturns.js, clientCredits.js,
│   │                           inventory.js, inventoryIntelligence.js, purchases.js
│   ├── Financeiro              finance.js, financeLedger.js, receivables.js, sales.js,
│   │                           pricing.js, discounts.js, promotions.js, idempotency.js
│   ├── Plataforma              platformBilling.js, platformFinance.js, subscriptions.js,
│   │                           billingLifecycle.js, tenantCharges.js, planAdmin.js
│   ├── Integrações             asaas/, whatsappCloud.js, emailProvider.js,
│   │                           communications.js, communicationCredits.js, storage/
│   └── Infra                   jobs.js, jobWorker.js, pagination.js, loginGuard.js,
│                               totp.js, errorLogs.js, privacy.js, support.js
├── schemas/
│   └── index.js             Schemas de validação Zod
├── db/migrations/           Migrations versionadas com ledger e checksum
│   ├── platform/            0001–0006
│   └── tenant/              0001–0016
├── text-normalizer.js       Normalização de encoding das respostas
└── data/uploads/            Arquivos enviados (fallback local, quando o R2 está desligado)

backend/scripts/
├── migrations.mjs           CLI das migrations (status | verify | apply)
├── test-isolation.mjs       Validação do isolamento entre clínicas (9 checagens)
├── qa-homologation-critical.mjs  Homologação crítica ponta a ponta (HTTP + conciliação SQL)
├── backup.sh, backup-uploads.sh  Backup (pg_dump) e dos arquivos
├── migrate-to-multitenant.mjs    Migra banco legado (schema public) para o modelo por tenant
├── migrate-uploads-to-r2.mjs     Move anexos do disco local para o R2
├── restore-admin.mjs             Restaura a função admin de uma conta existente
├── seed-demo-data.mjs            Dados de demonstração
└── audit-*.mjs, validate-*.mjs   Auditorias pontuais de estoque, imagens, RBAC e financeiro

backend/tests/                58 arquivos .test.mjs
├── run-suite.mjs            Runner da suíte (npm --prefix backend test)
└── helpers.mjs              Utilitários de teste
```

### A camada `db`

Uma convenção importante: os handlers e services **não** usam o driver `pg` diretamente. Eles recebem o `db` (`createDb`), que expõe `get(sql, params)`, `all(sql, params)`, `run(sql, params)` e `transaction(fn)`.

- **Placeholders posicionais `?`** são a convenção de parâmetro do projeto: o n-ésimo `?` vira `$n` antes de ir ao driver. A tradução é puramente posicional, o que permite montar cláusulas condicionais (`clauses.push("a.status = ?")`) sem renumerar nada à mão. Um `?` dentro de literal de string ou de operador `jsonb` também seria trocado — nesse caso escreva `$n` direto, sem misturar os dois estilos na mesma query.
- **Nada é acrescentado à sua query.** Quem precisa do id gerado escreve `RETURNING id` explicitamente e lê `result.returnedId`; `result.changes` traz as linhas afetadas e `result.rows`, o que o `RETURNING` devolveu.
- Passar pelo `db` é o que mantém o isolamento por `search_path`: o client é o da requisição, já apontado para o schema da clínica.

## 7. Estrutura de pastas do frontend

```text
frontend/src/
├── main.jsx                 App shell: roteamento por pathname/estado, code-splitting (lazy) por feature, error boundary
├── styles.css               Identidade visual e responsividade
├── lib/
│   ├── api.js               Cliente HTTP: base URL, X-Tenant, Bearer, refresh em 401, storage do token/slug
│   ├── appRoutes.js         Mapa página <-> URL /app/* (canonicalização e navegação)
│   ├── permissions.js       Páginas por papel, permissões granulares e features de plano
│   ├── queryClient.js       Cache de dados das telas
│   ├── errorReporter.js     Captura de erro do frontend e envio à API
│   ├── uiTheme.js           Tema por usuário
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
├── features/                21 domínios de negócio, carregados sob demanda
│   ├── dashboard/            Visão geral e alertas
│   ├── agenda/               Agenda, atendimento e cancelamento com resolução financeira
│   ├── services/             Serviços executados e a ficha técnica de materiais
│   ├── clients/              Clientes e prontuário
│   ├── terms/                Termos digitais
│   ├── postcare/             Pós-atendimento
│   ├── inventory/            Produtos, variações e catálogo interno
│   ├── consumables/          Materiais operacionais, lotes e validade
│   ├── purchases/            Compras e entrada de estoque
│   ├── sales/                Vendas avulsas e devoluções
│   ├── finance/              Receber, pagar, categorias, centros de custo e fornecedores
│   ├── reports/              Relatórios e exportações
│   ├── catalog/              Utilidades da vitrine pública
│   ├── communications/       Mensagens e créditos de envio
│   ├── integrations/         Chaves de gateway e WhatsApp da clínica
│   ├── onboarding/           Configuração inicial da clínica
│   ├── settings/             Preferências e conta
│   ├── support/              Suporte e privacidade
│   ├── access/               Usuários, papéis e permissões
│   ├── shared/               Helpers compartilhados entre telas
│   └── platform/
│       ├── Signup.jsx        Cadastro público de clínica (/cadastro)
│       ├── PlatformAdmin.jsx Painel do super-admin (/plataforma)
│       └── LandingEditor.jsx Editor da landing pública
└── pages/
    ├── PublicExperience.jsx  Catálogo público / agendamento
    └── CatalogCustomization.jsx  Personalização do catálogo
```

## 8. Componentes de UI reutilizáveis

O frontend não usa um framework visual externo; a UI compartilhada vive em `frontend/src/components/common/` e usa Radix apenas para comportamentos acessíveis. Os principais:

- **`Modal`** (`Crud.jsx`) — janela sobreposta genérica usada por formulários e diálogos. Props: `open`, `title`, `subtitle`, `onClose`, `children`, `footer`, `size` (`sm`/`md`/…). Fecha com Escape e clique no backdrop, trava o scroll do body enquanto aberta e é acessível (`role="dialog"`, `aria-modal`).
- **`Button`** (`Ui.jsx`) — botão padronizado. Prop `variant` ∈ `primary | secondary | ghost | danger`, mapeada para as classes visuais correspondentes; repassa atributos HTML e `ref` ao `<button>`.
- **`Tabs` / `Accordion` / `Switch`** (`Ui.jsx`) — primitives Radix para abas, conteúdo expansível e toggles. Use a composição `Tabs.List`/`Trigger`/`Content` e `Accordion.Item`/`Header`/`Trigger`/`Content`; os callbacks entregam valores, não eventos.
- **`StatusBadge`** (`Ui.jsx`) — selo colorido de status (ex.: agendamento pendente/atendido/cancelado, estoque disponível/baixo/crítico). Normaliza o `status` (minúsculas, sem acentos) e o mapeia para um tom (`ok | warn | info | danger | neutral`); aceita `tone` explícito.
- **`DataTable`** (`Crud.jsx`) — tabela reutilizável das telas de listagem/CRUD. Props: `columns` (`[{ key, label, render?, align? }]`), `rows`, `actions?(row)` (botões por linha), `rowKey` e `empty` (estado vazio). Suporta layout responsivo por célula.
- **`CrudHeader`** (`Crud.jsx`) — cabeçalho padrão das telas de gestão: `title`, `subtitle` e botão primário (`actionLabel`, default "Novo") via `onAction`, ligando a listagem ao formulário/modal.
- **`ConfirmDeleteModal`** (`Feedback.jsx`) — modal de confirmação de exclusão que **exige digitar uma palavra** (`confirmWord`, default "sim") para habilitar o botão Excluir, evitando remoções acidentais. Props: `open`, `onClose`, `onConfirm`, `title`, `message`, `confirmWord`, `loading`.

Complementam a UI base: `Input`, `Select`, `Textarea`, `Checkbox`, `PaymentSelect`, `StatusSelect`, `Metric`, `AlertBlock` (em `Ui.jsx`) e `Loading`, `ApiError` (em `Feedback.jsx`). `Input` e `Textarea` encaminham atributos HTML ao controle nativo; `className` é do controle e `fieldClassName` do invólucro. Esses blocos são combinados em cada tela de `features/` para compor as interfaces de CRUD (listar, criar, editar, excluir) de forma consistente. Consulte `docs/API.md` para os endpoints que essas telas consomem e `docs/FLUXOS.md` para os fluxos de uso.

## 9. Referências de código

- Bootstrap e montagem dos routers: `backend/src/index.js`
- Ciclo de requisição / isolamento: `backend/src/middleware/withDb.js`
- Resolução de tenant: `backend/src/middleware/tenant.js`
- Autenticação: `backend/src/middleware/auth.js`
- Provisionamento e migrations multi-schema: `backend/src/services/tenants.js`
- Schema de controle: `backend/src/db/platformSchema.sql`
- Schema de clínica: `backend/src/db/schema.sql`
- Camada de acesso ao banco: `backend/src/db/postgres.js`
