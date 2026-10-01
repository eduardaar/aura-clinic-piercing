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
- **Frontend** — `frontend/`: SPA em React 18 + Vite 7, ícones `lucide-react`, cache de dados com TanStack Query e primitives comportamentais do Radix UI. Os componentes reutilizáveis e a identidade visual continuam próprios, centralizados em `components/common/` (`Ui.jsx`, `Crud.jsx`, `DataView.jsx` etc.). Todas as páginas — públicas e do painel em `/app/*` — são declaradas num registro único, `lib/appPages.js` (ver seção 7), com controle de acesso por permissão e por plano. As telas de cada feature são carregadas sob demanda (`React.lazy` + `Suspense`).

Scripts da raiz (`package.json`; Node `>=20.19.0`, fixado em `.nvmrc`):

| Script | O que faz |
| --- | --- |
| `npm run install:all` | Instala dependências da raiz, do backend e do frontend. |
| `npm run dev` | Sobe backend (`:4000`) e frontend (`:5174`) juntos via `concurrently`. |
| `npm run start` | Sobe apenas o backend em modo produção. |
| `npm run build` | Build de produção do frontend (Vite). |
| `npm run audit:security` | `npm audit --audit-level=low` na raiz, no backend e no frontend. |
| `npm run typecheck` / `npm run lint` | Checagem de tipos (`tsc` sobre JSDoc) e lint (Biome). |
| `npm run verify:static` / `npm run verify:full` | Biome nos arquivos alterados + typecheck + build; o `full` soma as suítes do backend e do frontend. |

## 2. Multi-tenancy por schema Postgres

O ponto central da arquitetura é o **isolamento físico de cada clínica em um schema Postgres próprio**. Não há coluna `tenant_id` espalhada pelas tabelas: cada clínica tem um schema dedicado com um conjunto completo de tabelas.

### Organização do banco

Um único banco de dados PostgreSQL (`aura_clinic`) é organizado em schemas:

- **`platform`** — schema de controle da plataforma: clínicas, planos, assinaturas, faturas, super-admins, auditoria, webhooks, landing, documentos legais (com histórico de versões), notícias e manual, configuração de SMTP, suporte e o ledger de migrations (`platform.schema_migrations`). Definido em `backend/src/db/platformSchema.sql` mais as migrations de plataforma.
- **`tenant_<slug>`** — um schema por clínica, criado no provisionamento. O nome é `"tenant_"` + o slug com `_` no lugar de `-` (`schemaNameForSlug`, em `services/tenants.js`), calculado **uma única vez** no provisionamento e gravado em `platform.tenants.schema_name`. Nunca é recalculado depois: se o slug um dia ganhar edição, o schema não pode sair andando atrás dele. O slug já chega validado por regex, então o nome nunca é input livre. Recebe as tabelas de `backend/src/db/schema.sql` mais as migrations de tenant.

Exemplo: a clínica de slug `aura-clinic` vive no schema `tenant_aura_clinic`, com suas próprias tabelas `users`, `clients`, `appointments`, etc., totalmente separadas das demais clínicas. A migration de plataforma `0005_tenant_schema_names` renomeou os schemas antigos (`tenant_<id>`) para o formato por slug sempre que o nome novo estava livre e gravou `schema_name` em todas as clínicas; o código sempre lê `schema_name` do registro e só usa o formato por id como fallback defensivo.

### Vantagens do modelo

- **Isolamento forte**: os dados de uma clínica nunca compartilham tabela com outra. Um `DROP SCHEMA tenant_aura_clinic CASCADE` remove tudo de uma clínica sem tocar nas demais.
- **Migrations versionadas por schema**: mudança nova de banco é uma migration imutável em `backend/src/db/migrations/tenant/`, aplicada uma vez em cada schema de clínica e registrada com checksum no ledger central (detalhes em [`backend/src/db/migrations/README.md`](../backend/src/db/migrations/README.md)). O `schema.sql` idempotente (`CREATE TABLE IF NOT EXISTS`) continua como base legada e não espelha todas as migrations.
- **Provisionamento/desprovisionamento simples**: criar uma clínica = criar um schema + aplicar `schema.sql` e as migrations de tenant; excluir = `DROP SCHEMA` + remoção do ledger do schema e do registro, numa única transação (`deprovisionTenant`).

### Boot do servidor

No arranque (`backend/src/index.js`), após montar os routers, o servidor executa em ordem:

0. **Portão de bootstrap** — `databaseBootstrapIsDisabled()` (`src/db/migrationPolicy.js`) decide se os passos abaixo rodam. Ele devolve `true` (ou seja, **pula tudo**) quando `SKIP_DATABASE_BOOTSTRAP=true` **ou** `RUN_DATABASE_MIGRATIONS=false`, e também em produção sem `ALLOW_LEGACY_GLOBAL_BOOTSTRAP=true`. Consequência prática: num banco vazio com `RUN_DATABASE_MIGRATIONS=false`, o servidor sobe normalmente e **não cria schema `platform` nem superadmin** — a API responde, mas nenhuma clínica existe nem pode ser criada.
1. `ensurePlatform()` — garante o schema `platform` (aplica `platformSchema.sql`, que já traz os planos-semente) e, se `platform.platform_users` estiver vazia, semeia o superadmin inicial (ver seção de autenticação).
2. `applyPlatformMigrations()` — só roda com `RUN_MIGRATIONS_ON_BOOT=true`, que é **proibido em produção** (o boot lança erro). O caminho normal é o CLI `npm --prefix backend run migrations:apply`. O deploy (`scripts/deploy.sh`) **não** aplica migrations: grava `RUN_DATABASE_MIGRATIONS=false`, `SKIP_DATABASE_BOOTSTRAP=true` e `RUN_MIGRATIONS_ON_BOOT=false` no `.env` do servidor; em produção as migrations rodam pelo workflow manual `.github/workflows/migrations-production.yml`.
3. `applySchemaToAllTenants()` — runner multi-schema: para cada tenant em `platform.tenants`, faz `SET search_path` para o schema da clínica e aplica o `schema.sql` idempotente (e as migrations de tenant, se `RUN_MIGRATIONS_ON_BOOT=true`).

As funções vivem em `backend/src/services/tenants.js`. Depois delas (com ou sem bootstrap), o boot carrega os planos do banco (`loadPlansFromDb`) e liga os workers opcionais (conciliação do Asaas, fila de jobs e ciclo de cobrança) antes de abrir a porta.

**Clínica nova não depende disso.** `provisionTenant()` cria o schema e aplica `schema.sql` + **todas** as migrations de tenant durante o cadastro; se algo falhar, o schema e o registro da clínica são desfeitos. Uma clínica criada hoje já nasce na versão corrente do schema.

## 3. Ciclo de vida de uma requisição

Todo handler de rota é embrulhado pelo middleware `withDb` (`backend/src/middleware/withDb.js`), que garante o isolamento por tenant. A sequência para cada requisição:

1. **Wrap de resposta** — `res.json` é substituído para passar o payload por `normalizeDbValue` (paliativo de encoding via `text-normalizer.js`). Antes de resolver a clínica, o corpo é varrido: qualquer texto com o caractere de substituição `U+FFFD` (sinal de conversão de encoding que perdeu o byte original) é recusado com `400`, indicando o campo.

2. **Resolução do tenant** — chama `resolveTenant(req)` (`backend/src/middleware/tenant.js`). O slug da clínica é resolvido nesta ordem de precedência:
   1. **Token Bearer válido** com `tslug` embutido. Se o header `X-Tenant` divergir do slug do token → `403` (tentativa de acessar outra clínica com token de uma).
   2. **Header `X-Tenant`** (ou `X-Clinic`).
   3. **Query** `t`, `tenant`, `clinic` ou `slug`; depois subdomínio elegível.
   4. **Env `DEFAULT_TENANT`** (conveniência para dev local).
   5. Nenhum → `400 tenant_required` ("Informe a clínica").

   O slug é validado por regex (`^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$`; fora dele → `400 tenant_invalid`), buscado em `platform.tenants` (com **cache em memória de 60s** por slug), e o schema vem da coluna `schema_name` do registro. Clínica inexistente → `404`; clínica **suspensa** → `403`. Falhas de resolução viram respostas de erro sem jamais tocar o banco da aplicação. Como defesa em profundidade, o `withDb` ainda valida o schema resolvido contra `^tenant_[a-z0-9_]{1,58}$` antes de usá-lo.

   > **Atenção no consumo:** clínica inexistente responde `404 tenant_not_found`; token de outra clínica responde `403 tenant_mismatch`; clínica suspensa responde `403 tenant_suspended`. O frontend usa esses códigos para encerrar a sessão sem confundir `403` de permissão ou `404` de recurso comum.

3. **Client dedicado do pool com `search_path`** — `withDb` pega **um client do pool** Postgres (`pool.connect()`) e executa `SET search_path TO "tenant_<slug>", public`. A partir daí toda query dessa requisição roda no schema da clínica.

4. **Camada `db`** — `createDb(client)` (`backend/src/db/postgres.js`) embrulha o client numa interface fina de acesso ao Postgres (`get` / `all` / `run` com placeholders `?`). Isso é injetado no handler como terceiro argumento (`handler(req, res, db)`).

5. **Autenticação (quando exigida)** — se `requiresAuth(req)` for verdadeiro (ver seção 4), chama `authenticateRequest(req, db)`. Sem usuário válido → `401`. O usuário resolvido passa por `hydrateUserPermissions` (perfil de acesso e exceções individuais, ver seção 4) e é anexado em `req.user`. Rotas embrulhadas por `withFeature(feature, handler)` ainda conferem, antes do handler, se o plano e a assinatura da clínica liberam o recurso (`402`/`403` caso contrário).

6. **Execução do handler** — a lógica de negócio roda usando o `db` (que já está apontando para o schema certo). Erros são capturados: uma transação deixada aberta é desfeita, o erro é gravado na central de erros (`error_logs`) e a resposta é um `500` padronizado (detalhe do erro só em dev; em produção mensagem genérica, para não vazar stack/SQL).

7. **Reset garantido do `search_path`** — no `finally`, **sempre** executa `SET search_path TO public` antes de devolver o client ao pool. Isso é **crítico**: um client devolvido "sujo" (ainda apontando para um tenant) vazaria dados entre clínicas na próxima requisição que o reutilizasse. Se o reset falhar, o client é **descartado** (`client.release(true)` destrói a conexão em vez de devolvê-la ao pool).

Esse padrão — client por requisição + `search_path` + reset garantido — é o que produz o isolamento multi-tenant e é validado pelo script `backend/scripts/test-isolation.mjs`.

## 4. Autenticação e autorização

Implementada em `backend/src/middleware/auth.js`. Usa **token HMAC próprio** (`crypto.createHmac("sha256", AUTH_SECRET)`), sem dependência de biblioteca de JWT.

### Formato do token

`payload.assinatura`, onde `payload` é um JSON base64url e `assinatura` é o HMAC-SHA256 do payload. A verificação (`decodeToken`) confere a assinatura com `crypto.timingSafeEqual` e a expiração (`exp`). Nenhuma consulta ao banco é feita na decodificação.

### Dois tipos de token

- **Token de clínica** (`createToken`): carrega `iss`/`aud`/`typ` (`aura-clinic-api`, `aura-clinic`, `clinic_access`), `sub` (id do usuário), `role`, `sv` (`users.session_version`), `tid` (id do tenant), `tslug` (slug do tenant) e `sid` (id da sessão). **Validade de 15 minutos** (`ACCESS_TOKEN_MS`, em `services/sessions.js`). **Amarrado ao tenant**: na autenticação, o token só vale se `decoded.tid === req.tenant.id` — token de outra clínica é recusado. A autenticação também consulta o usuário: ele precisa estar com `status = 'active'`, com o mesmo `session_version` do token e com a sessão `sid` ainda ativa. Trocar senha, cargo, status ou perfil de acesso do usuário incrementa `session_version` e derruba os tokens já emitidos.
- **Token de plataforma** (`createPlatformToken`): carrega `aud: "aura-platform"`, `typ: "platform_access"`, `sub`, `role: "superadmin"`, `sv` e a flag `plt: true`. Tokens de plataforma **nunca** autenticam em rotas de clínica (`authenticateRequest` rejeita `plt === true`), e tokens de clínica não têm `plt`, então nunca são aceitos no painel de plataforma (`verifyPlatformToken` exige `plt === true`). O guard `requirePlatformAuth` ainda relê `platform.platform_users` a cada requisição e compara o `session_version`.

Essa separação garante que o super-admin da plataforma e os usuários de clínica vivem em domínios de segurança distintos.

### Sessão: access token curto + refresh em cookie

O access token de 15 minutos é curto de propósito — ele fica acessível ao JavaScript da página. A credencial duradoura é o **refresh token**, entregue num cookie `HttpOnly` (`aura_refresh`) com validade de **30 dias** (`REFRESH_TOKEN_MS`), que o JavaScript não consegue ler.

Cada sessão tem uma linha em `user_sessions` no schema da clínica, guardando o **hash** do refresh token, `expires_at` e `revoked_at`. Isso torna a sessão revogável de verdade, coisa que um token HMAC puro não permite:

| Rota | Efeito |
| --- | --- |
| `POST /api/auth/refresh` | rotaciona o refresh token e devolve um access token novo |
| `POST /api/auth/logout` | revoga a sessão atual |
| `GET /api/account/sessions` | lista as sessões ativas do usuário |
| `DELETE /api/account/sessions/:id` | revoga uma sessão específica do usuário |
| `POST /api/account/sessions/revoke-all` | derruba todas as sessões do usuário |

No frontend, `apiFetch` (`lib/api.js`) faz esse ciclo sozinho: recebeu `401`, chama `/auth/refresh`, repete a requisição **uma vez** e, se ainda falhar, limpa a sessão e emite o evento `aura:session-ended`, que o `main.jsx` escuta para voltar ao login (sem recarregar a página). O mesmo acontece quando a API responde `tenant_mismatch`, `tenant_not_found` ou `tenant_suspended`. Sem `?t=` na URL nem slug guardado, `tenantSlug()` devolve vazio e o `X-Tenant` não é enviado — não há clínica padrão no frontend.

Há também **MFA por TOTP** (`services/totp.js`): segredo cifrado em repouso, verificação com janela de tolerância e URI `otpauth://` para o QR do autenticador. Na clínica, o MFA é exclusivo do `admin` (`/api/account/mfa`, `/setup`, `/verify`, `/disable`) e hoje só existe na API — nenhuma tela do painel o configura. Na plataforma, o super-admin ativa e desativa o MFA em `/plataforma/seguranca` ("Segurança da conta", `/api/platform/mfa/setup|verify|disable`). Nos dois logins, conta com MFA ligado recebe `401` com `code: "mfa_required"` até enviar `mfa_code` válido no corpo.

### Login de clínica x login de plataforma

- **Login de clínica** (`POST /api/login`, com header `X-Tenant`, definido em `routes/auth.js`): valida e-mail + senha (bcrypt) contra a tabela `users` **do schema da clínica** resolvida — o e-mail é comparado sem diferenciar maiúsculas (`lower(email) = lower(?)`, com a grafia exata como desempate). Usuário inativo recebe `403`. A resposta traz o token de clínica e o `user` com `permissions` já resolvidas (ver "Papéis, permissões e planos"); `POST /api/auth/refresh` devolve um token novo e o `user` com a mesma lista de `permissions`.
- **Login de plataforma** (`POST /api/platform/login`, definido em `routes/platform.js`): valida contra `platform.platform_users` e devolve um token de plataforma.
- **Recuperação de senha** (`POST /api/auth/forgot-password` e `POST /api/auth/reset-password`, em `routes/auth.js`, com o limite do login): link de uso único com validade de 30 minutos, guardado só como hash em `password_reset_tokens`; a troca incrementa `session_version` e revoga as sessões.

> Nota: `routes/auth.js` concentra a sessão de clínica (login, refresh, logout, recuperação de senha, sessões e MFA da conta). O cadastro público de clínica (`POST /api/signup`), o login de plataforma, o MFA do super-admin (`/api/platform/mfa*`) e a gestão de clínicas (`/api/platform/tenants`, `/api/platform/metrics`) ficam em `routes/platform.js`; as demais rotas `/api/platform/*` se espalham pelos routers do painel (`planAdmin.js`, `accountAdmin.js`, `platformFinance.js`, `platformEmail.js`, `landing.js`, `contentHub.js`, `support.js`, `billing.js`), todas protegidas por `requirePlatformAuth`.

### Rotas públicas

Além de login, refresh, recuperação de senha e health, são públicas a vitrine de planos/diretório de clínicas,
landing, documentos legais, notícias e manual, catálogo e seus cálculos/eventos, checkout público,
rotas de booking, consulta pública de PIX/status, termo digital por link (`/api/public/terms/:token`, em que o token da URL é a credencial),
ingestão de erro do frontend e webhooks autenticados pelo provedor. A lista completa está em [API.md](./API.md).

### Bypass de desenvolvimento local

**Desligado por padrão, inclusive em desenvolvimento.** `isLocalDevRequest` só devolve `true` com as três condições juntas: `NODE_ENV !== "production"`, `ALLOW_LOCAL_AUTH_BYPASS === "true"` e requisição vinda de `localhost`/`127.0.0.1`/`::1`. Nesse caso `authenticateRequest` dispensa o token e retorna o admin do tenant resolvido.

Sem a env explícita — que é a configuração recomendada, inclusive local — o token é obrigatório em toda rota protegida. Em produção a válvula é proibida: o boot lança erro se ela estiver ligada.

### Papéis, permissões e planos

A autorização tem **três camadas**, e confundi-las é a fonte mais comum de "por que esse usuário não vê a tela?".

**1. Cargo (role).** Todo usuário tem um de quatro cargos, e cada cargo tem um conjunto padrão de permissões em `backend/src/config/roles.js` (`ROLE_PERMISSIONS`):

- `admin` — curinga `*`: acessa tudo; `hasPermission` devolve `true` sem consultar mais nada.
- `piercer` — agenda e atendimento completos (inclusive revisar, finalizar e alterar o valor final), clientes, anamnese, arquivos clínicos (termos e pós-atendimento), vendas, estoque (vender e ajustar), caixa, comunicação e cupons.
- `reception` — agenda (sem revisar nem finalizar atendimento), clientes, anamnese, vendas, estoque (ver e vender), caixa (sem fechar), comunicação e cupons.
- `finance` — financeiro e caixa completos, dados financeiros do dashboard, vendas concluídas e cancelamento, estoque com custo, relatórios financeiros e gerais (`reports.view_all`), comissões, cupons (consulta) e auditoria.

Todos os cargos têm `dashboard.view` e `settings.view`.

**2. Permissões granulares.** O catálogo de permissões é fechado (`config/permissions.js`: constantes `P` e `PERMISSION_CATALOG`, com rótulo e risco) — permissão fora dele é rejeitada na validação. `services/permissionService.js` resolve o conjunto efetivo:

```text
base    = permissões do perfil de acesso ativo (access_profiles), se houver; senão ROLE_PERMISSIONS[cargo]
efetivo = (base ∪ concedidas) − revogadas
```

- **Perfis de acesso** (migration tenant `0017_access_profiles_audit`): `access_profiles` + `access_profile_permissions`, com `base_role` `piercer`, `reception` ou `finance`; o usuário aponta para um perfil por `users.access_profile_id`. Perfil ativo **substitui** as permissões do cargo. Gestão em `/api/access-profiles` (`routes/accessProfiles.js`), com a permissão `users.permissions`.
- **Exceções por usuário** (migration tenant `0003_user_permissions`): `user_permissions` grava concessões e revogações individuais (`GET/PUT /api/users/:id/permissions`, com motivo). A revogação vence a concessão. A mesma migration criou `users.status`: usuário inativo não autentica.

`hydrateUserPermissions` carrega perfil e exceções em cada requisição autenticada, e `effectivePermissions` devolve a lista resolvida (`["*"]` para admin) no login e no refresh. No frontend, `can()` (`lib/permissions.js`) usa essa lista; a tabela local por cargo só serve de fallback para sessão antiga, sem a lista.

Nas rotas, a checagem é `authorizePermission(req, res, P.X)` (`middleware/requirePermission.js`), já usada pela maior parte das rotas operacionais (agenda, clientes, termos, estoque, vendas, compras, financeiro, usuários, auditoria). Parte dos routers ainda usa `requireRole(req, res, [cargos])` (`middleware/auth.js`) com lista explícita de cargos — por exemplo catálogo, opções, integrações, cobrança, privacidade, suporte, jobs e o MFA da conta. Em rota que usa `requireRole`, perfil de acesso e exceções individuais não fazem diferença.

**3. Recursos do plano.** Acima das duas camadas, o plano contratado pode travar a página ou a ação. No backend, `withFeature`/`requireFeature` (`middleware/withDb.js`, `services/subscriptions.js`) responde `402`/`403` quando a feature não está no plano ou a assinatura não está ativa, e `services/planLimits.js` controla as cotas de criação. No frontend, a feature de cada página vem do registro `lib/appPages.js` (`PAGE_FEATURE`, derivado em `lib/permissions.js`). É por isso que um `admin` pode ver um item com cadeado: não falta permissão, falta plano.

### Segredo e produção

`AUTH_SECRET` é obrigatório em produção (o boot lança erro sem ele) e precisa ter pelo menos 32 bytes. Em dev usa o default `aura-clinic-dev-secret`; o boot **recusa** subir em produção com esse default (ver `backend/src/config/index.js`). O mesmo arquivo concentra as demais guardas de produção (CORS, `PUBLIC_API_URL` em HTTPS, `DISABLE_RATE_LIMIT` e `ALLOW_LOCAL_AUTH_BYPASS` proibidos, R2 completo); a exigência de TLS validado no banco fica em `backend/src/database/connection.js`; o checklist está em [SECURITY.md](../SECURITY.md).

## 5. Segurança de borda

Configurada em `backend/src/index.js`:

- **Helmet** — cabeçalhos de segurança no padrão do `helmet()`; só o static `/uploads` devolve `Cross-Origin-Resource-Policy: cross-origin`, para o frontend consumir as imagens antigas ainda servidas do disco.
- **CORS** — allowlist exata das origens de `CORS_ORIGIN` (separadas por vírgula), com credenciais (cookie de refresh); em dev, `localhost:5174` e `127.0.0.1:5174` entram sempre. Requisição sem `Origin` (servidor-servidor, webhooks) passa.
- **Rate limit** (`backend/src/middleware/rateLimit.js`) — `apiLimiter` (300 req/min por IP) em toda a `/api`; o login, a recuperação de senha e o termo digital público usam `loginLimiter` (10 requisições em 15 min); os webhooks têm `webhookLimiter` próprio, montado antes do limite global; a ingestão de erros do frontend tem `publicErrorLogLimiter`. O IP vem de `req.ip`, com `TRUST_PROXY_HOPS` (0 a 5; padrão 2 em produção).
- **Body limit** — `express.json({ limit: "1mb" })`; arquivos sobem por multipart (multer, `middleware/upload.js`).
- **Respostas** — `Cache-Control: no-store` em `/api`, `404` e `500` em JSON (sem página de erro do Express) e timeouts de requisição, cabeçalhos e keep-alive no servidor HTTP.

## 6. Estrutura de pastas do backend

```text
backend/src/
├── index.js                 Bootstrap: middlewares globais, montagem dos routers, boot multi-tenant
├── config/
│   ├── index.js             Env, guardas de produção, constantes de domínio, caminho de uploads, AUTH_SECRET
│   ├── permissions.js       Catálogo fechado de permissões (P, PERMISSION_CATALOG)
│   └── roles.js             Permissões padrão de cada cargo (ROLE_PERMISSIONS)
├── database/
│   └── connection.js        Pool PostgreSQL (pg) + helper query() + exigência de TLS em produção
├── db/
│   ├── schema.sql           Schema-base de CADA clínica (legado idempotente; mudanças novas vão em migrations/)
│   ├── platformSchema.sql   Schema de controle: platform.tenants, platform.platform_users, planos, landing...
│   ├── postgres.js          Camada db (get/all/run + transaction) sobre um client + applySchemaSql
│   ├── tenantSession.js     Acesso ao schema de uma clínica fora do ciclo de requisição (webhooks, workers)
│   ├── migrations.js        Runner das migrations versionadas (ledger, checksum, lock)
│   ├── migrationPolicy.js   Regras de produção do CLI e do bootstrap no boot
│   └── migrationStructure.js  Fingerprint estrutural para adoção controlada de migrations
├── middleware/
│   ├── withDb.js            Wrapper de todo handler: resolve tenant, client+search_path, auth, reset; withFeature
│   ├── tenant.js            Resolução do tenant (token/X-Tenant/query/subdomínio/DEFAULT_TENANT) + cache
│   ├── auth.js              Tokens HMAC (clínica e plataforma), requiresAuth, requireRole, requirePlatformAuth, bypass dev
│   ├── requirePermission.js authorizePermission / requirePermission (permissões granulares)
│   ├── rateLimit.js         Limites de requisição (global, login, webhooks, erros do frontend)
│   ├── upload.js            Configuração do multer (uploads de imagens/arquivos)
│   └── validate.js          Integração de validação (Zod)
├── routes/                  46 routers; cada um declara seus próprios caminhos /api/...
│   ├── Agenda e atendimento    appointments.js, availability.js, scheduleBlocks.js,
│   │                           agendaOperations.js, professionals.js, services.js,
│   │                           procedures.js, serviceExecutions.js, terms.js, postcare.js
│   ├── Clientes                clients.js, privacy.js
│   ├── Estoque e compras       jewelry.js, purchases.js, options.js, erp.js
│   ├── Vendas e financeiro     sales.js, finance.js, payments.js, reports.js, billing.js
│   ├── Público                 catalog.js, booking.js, store.js, landing.js, contentHub.js
│   ├── Acesso                  auth.js, users.js, accessProfiles.js, audit.js
│   ├── Plataforma              platform.js, planAdmin.js, platformFinance.js, accountAdmin.js,
│   │                           platformEmail.js
│   ├── Integrações             integrations.js, webhooks.js, notifications.js, aiAssistant.js
│   └── Operação                health.js, dashboard.js, alerts.js, uploads.js,
│                               jobs.js, errorLogs.js, support.js
├── services/                Regras de negócio (sem HTTP) — ~70 módulos
│   ├── tenants.js              Provisionamento/desprovisionamento, ensurePlatform, migrations
│   ├── sessions.js             Access token curto + refresh em cookie, revogação
│   ├── permissionService.js    Cargo ou perfil de acesso + exceções por usuário
│   ├── audit.js                Auditoria central (audit_events) com mascaramento de dados sensíveis
│   ├── plans.js, planLimits.js Planos e gates de recurso por assinatura
│   ├── Operacional             appointments.js, appointmentCancellations.js, serviceExecutions.js,
│   │                           serviceRules.js, consumableUsage.js, salesReturns.js, clientCredits.js,
│   │                           inventory.js, inventoryIntelligence.js, purchases.js, terms.js, termRequests.js
│   ├── Financeiro              finance.js, financeLedger.js, receivables.js, sales.js,
│   │                           pricing.js, discounts.js, promotions.js, idempotency.js
│   ├── Plataforma              platformBilling.js, platformFinance.js, subscriptions.js,
│   │                           billingLifecycle.js, tenantCharges.js, planAdmin.js, contentHub.js
│   ├── Integrações             asaas/, whatsappCloud.js, emailProvider.js, smtpSettings.js,
│   │                           smtpVault.js, communications.js, communicationCredits.js, storage/
│   └── Infra                   jobs.js, jobWorker.js, pagination.js, loginGuard.js,
│                               totp.js, errorLogs.js, privacy.js, support.js
├── schemas/
│   └── index.js             Schemas de validação Zod
├── db/migrations/           Migrations versionadas com ledger e checksum
│   ├── platform/            0001–0008
│   └── tenant/              0001–0025 e 0028–0042 (0026 e 0027 não existem)
├── text-normalizer.js       Normalização de encoding das respostas
└── data/uploads/            Arquivos enviados (fallback local, quando o R2 está desligado)

backend/scripts/
├── migrations.mjs           CLI das migrations (status | verify | apply)
├── reset-local-data.mjs     Zera a base LOCAL (npm --prefix backend run db:reset-local; recusa produção e host remoto)
├── test-isolation.mjs       Validação do isolamento entre clínicas (9 checagens)
├── qa-homologation-critical.mjs  Homologação crítica ponta a ponta (HTTP + conciliação SQL); desatualizado: ainda chama /api/consumables
├── backup.sh, backup-uploads.sh  Backup (pg_dump) e dos arquivos
├── migrate-to-multitenant.mjs    Migra banco legado (schema public) para o modelo por tenant
├── migrate-uploads-to-r2.mjs     Move anexos do disco local para o R2
├── migrate-landing-assets-to-r2.mjs  Envia as imagens padrão da landing ao R2
├── restore-admin.mjs             Restaura a função admin de uma conta existente
├── seed-demo-data.mjs            Dados de demonstração
└── audit-*.mjs, validate-*.mjs   Auditorias pontuais de estoque, imagens, RBAC e financeiro

backend/tests/                73 arquivos .test.mjs (contagem de arquivos em 30/09/2026)
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
├── main.jsx                 App shell: roteamento por URL (History API), sessão, topo e menu da conta, error boundary
├── styles.css               Identidade visual (tokens, componentes base)
├── styles/                  CSS por área; appshell.css define o layout do painel e responsive.css é a última camada
├── lib/
│   ├── appPages.js          Registro único de páginas (rota, aliases, título, menu, ícone, permissão, feature, componente)
│   ├── appRoutes.js         Mapa página <-> URL /app/*, derivado de appPages.js
│   ├── api.js               Cliente HTTP: base URL, X-Tenant, Bearer, refresh em 401, fim de sessão, storage do token/slug
│   ├── permissions.js       can(), páginas por cargo, permissão e feature de plano por página (derivadas de appPages.js)
│   ├── queryClient.js       Cache de dados das telas (TanStack Query)
│   ├── errorReporter.js     Captura de erro do frontend, filtro de ruído e envio à API
│   ├── useFormDraft.js      Rascunho local de formulários longos
│   ├── uiTheme.js           Tema por usuário
│   ├── defaultForms.js      Estados iniciais dos formulários e listas de opções
│   ├── publicRoutes.js      Links públicos por clínica (?t=<slug>)
│   ├── utils.js             Utilidades gerais (datas, moeda, strings)
│   └── calendarUtils.js     Helpers de calendário/agenda
├── components/
│   ├── auth/Login.jsx       Login de clínica (código/slug + e-mail + senha), código do autenticador e recuperação de senha
│   ├── common/
│   │   ├── Ui.jsx           Primitivos de UI (Button, Input, Select, Tabs, Accordion, Switch, StatusBadge, ...)
│   │   ├── Crud.jsx         Modal, ConfirmDeleteModal, CrudHeader, RowActions e DropdownMenu
│   │   ├── DataView.jsx     Listagem com busca, filtros em modal, ordenação e paginação
│   │   ├── FormWorkflow.jsx Base de formulários longos (etapas, seções, campos avançados, revisão)
│   │   ├── Feedback.jsx     Loading e ApiError
│   │   ├── SmartCombobox.jsx, SignaturePad.jsx, CollapsibleIndicators.jsx, TransactionFields.jsx, ...
│   │   └── AppErrorBoundary.jsx
│   └── layout/
│       ├── Sidebar.jsx      Navegação lateral do painel
│       ├── PublicTopNav.jsx Topo das páginas públicas
│       └── PublicFooter.jsx Rodapé das páginas públicas
├── features/                21 domínios de negócio, carregados sob demanda
│   ├── dashboard/            Visão geral e alertas
│   ├── agenda/               Agenda, atendimento e cancelamento com resolução financeira
│   ├── services/             Procedimentos e tipos de atendimento, com a ficha técnica de materiais
│   ├── clients/              Clientes e prontuário
│   ├── terms/                Termos digitais, modelos e solicitações de assinatura por link
│   ├── postcare/             Pós-atendimento
│   ├── inventory/            Itens de estoque (produtos e materiais), lotes e movimentações
│   ├── purchases/            Compras e entrada de estoque
│   ├── sales/                Vendas avulsas e devoluções
│   ├── finance/              Receber, pagar, visão financeira, categorias, centros de custo e fornecedores
│   ├── reports/              Relatórios e exportações
│   ├── catalog/              Utilidades da vitrine pública
│   ├── communications/       Mensagens e créditos de envio
│   ├── integrations/         Chaves de gateway e WhatsApp da clínica
│   ├── onboarding/           Configuração inicial da clínica
│   ├── settings/             Preferências e conta
│   ├── support/              Chamados de suporte
│   ├── help/                 Manual do usuário e novidades dentro do app
│   ├── access/               Usuários, perfis de acesso, permissões e auditoria
│   ├── shared/               Helpers compartilhados entre telas
│   └── platform/
│       ├── Signup.jsx        Cadastro público de clínica (/cadastro)
│       ├── PlatformAdmin.jsx Painel do super-admin (/plataforma)
│       ├── MyPlan.jsx        Meu plano (assinatura da clínica, /app/meu-plano)
│       └── LandingEditor.jsx, ContentAdmin.jsx, LegalEditor.jsx, ...  Áreas do painel da plataforma
└── pages/
    ├── Landing.jsx           Landing pública (/) e página Sobre (/sobre)
    ├── PublicExperience.jsx  Catálogo público / agendamento / checkout
    ├── PublicDirectory.jsx   Diretório de clínicas
    ├── PublicTerm.jsx        Assinatura de termo digital por link (/termo/<token>)
    ├── LegalDocument.jsx, News.jsx  Termos de uso, privacidade e novidades
    └── CatalogCustomization.jsx  Personalização do catálogo
```

### Registro de páginas e roteamento

Toda página — do painel (`/app/*`) e pública (`/`, `/sobre`, `/planos` (redireciona para `/#planos`), `/login`, `/catalogo`, `/agendar`, `/comprar`, `/cadastro`, `/plataforma`, `/termos-de-uso`, `/politica-de-privacidade`, `/novidades`, `/termo`) — é declarada uma única vez em `frontend/src/lib/appPages.js` (`APP_PAGES`). Os consumidores só derivam visões desse registro: `appRoutes.js` (URL ↔ página), `permissions.js` (`PAGE_PERMISSION`, `PAGE_FEATURE`, `canAccessPage`, `pageTitle`), `Sidebar.jsx` (via `menuPages()`, exportada pelo próprio `appPages.js`, com os grupos Início, Atendimento, Comercial, Estoque e compras, Financeiro, Gestão e Configurações; o menu não tem submenus) e `main.jsx` (`publicPageForPath` e o componente lazy de cada página). Página nova entra no registro, não em listas espalhadas.

O `main.jsx` navega com `history.pushState`, trata voltar/avançar (`popstate`) e corrige com `replaceState` — sem criar histórico — uma URL inválida ou uma página que o usuário não pode abrir (`resolveAccessiblePage`, que leva em conta permissão e plano). `/plataforma` tem roteamento próprio por área dentro de `PlatformAdmin.jsx` (`/plataforma/dashboard`, `/contas`, `/planos`, `/suporte`, `/landing`, `/conteudo`, `/legal`, `/email`, `/seguranca`).

## 8. Componentes de UI reutilizáveis

O frontend não usa um framework visual externo; a UI compartilhada vive em `frontend/src/components/common/` e usa Radix apenas para comportamentos acessíveis. Os principais:

- **`Modal`** (`Crud.jsx`) — janela sobreposta genérica (Radix Dialog) usada por formulários e diálogos. Props: `open`, `title`, `subtitle`, `onClose`, `children`, `footer`, `dismissible`, `confirmClose`, `dirty` e `formId`. Todos os modais têm a mesma largura (`modal-md`; `size` só é aceito por compatibilidade). **Não fecha no clique fora** por padrão (`dismissible` libera, para modais sem dados a perder); fecha pelo X, pelo Esc e pelos botões do rodapé. Com formulário alterado, essas saídas — inclusive botões "Cancelar"/"Fechar" ou marcados com `data-modal-cancel` — abrem a guarda "Existem alterações não salvas" (Sair sem salvar, Salvar, Continuar editando). `confirmClose={false}` desliga a guarda; `useModal()` dá acesso a `requestClose` e `markDirty` dentro do modal.
- **`Button`** (`Ui.jsx`) — botão padronizado. Prop `variant` ∈ `primary | secondary | ghost | danger`, mapeada para as classes visuais correspondentes; repassa atributos HTML e `ref` ao `<button>`.
- **`Tabs` / `Accordion` / `Switch`** (`Ui.jsx`) — primitives Radix para abas, conteúdo expansível e toggles. Use a composição `Tabs.List`/`Trigger`/`Content` e `Accordion.Item`/`Header`/`Trigger`/`Content`; os callbacks entregam valores, não eventos.
- **`StatusBadge`** (`Ui.jsx`) — selo colorido de status (ex.: agendamento pendente/atendido/cancelado, estoque disponível/baixo/crítico). Normaliza o `status` (minúsculas, sem acentos) e o mapeia para um tom (`ok | warn | info | danger | neutral`); aceita `tone` explícito.
- **`DataView`** (`DataView.jsx`) — padrão das listagens: `columns`, `rows`, `rowKey`, `actions(row)`, busca, filtros avançados abertos em modal ("Aplicar filtros", com os filtros ativos em chips), ordenação e paginação, em modo `client` ou `server`. A tabela rola dentro do próprio bloco, com cabeçalho fixo. (O antigo `DataTable` de `Crud.jsx` foi removido.)
- **`RowActions`** (`Crud.jsx`) — ações de uma linha: sempre um único botão de três pontos ("Mais ações") que abre um `DropdownMenu` com todas as ações (`{ label, onClick, href, target, rel, danger, disabled }`; itens falsos são ignorados).
- **`CrudHeader`** (`Crud.jsx`) — cabeçalho padrão das telas de gestão: `title`, `subtitle`, botão primário (`actionLabel`, default "Novo") via `onAction` e `actions` secundárias (`[{ label, icon, onClick }]`) agrupadas no menu "Mais opções".
- **`ConfirmDeleteModal`** (`Crud.jsx`) — modal de confirmação de exclusão que **exige digitar uma palavra** (`confirmWord`, padrão "SIM", comparada sem diferenciar maiúsculas) para habilitar o botão Excluir, evitando remoções acidentais. Props: `open`, `onClose`, `onConfirm`, `title`, `message`, `confirmWord`, `loading`.
- **`FormWorkflow`** (`FormWorkflow.jsx` + `form-workflow.css`) — base dos formulários longos: `FormWorkflow`, `FormPage`, `FormSection`, `StepNavigator` (etapas), `AdvancedFields` (campos recolhidos), `ValidationSummary` e `ReviewSummary`. Combina com o hook `useFormDraft` (`lib/useFormDraft.js`), que guarda rascunho no `localStorage` por clínica, usuário e formulário (`aura:form-draft:<clínica>:<usuário>:<formulário>`) e só volta a gravar depois que a pessoa restaura ou descarta o rascunho anterior — nada é criado no backend antes de salvar. `TransactionFields.jsx` (`ResponsiveEditableList`, `TransactionTotals`) completa o padrão para itens e totais de compras e vendas.
- **`SmartCombobox`** (`SmartCombobox.jsx`) — seletor com busca (padrão: joias por nome, SKU ou medida, com situação do estoque); dentro de um `Modal`, a lista monta no próprio diálogo e, até 640px, vira folha inferior com busca própria.
- **`SignaturePad`** (`SignaturePad.jsx`) — assinatura desenhada em canvas (mouse, caneta ou dedo), devolvida como data URL PNG; usada nos termos digitais, inclusive na página pública `/termo`.
- **`CollapsibleIndicators`** (`CollapsibleIndicators.jsx`) — envolve os cartões de métricas com "Ocultar/Mostrar indicadores" e lembra a escolha por clínica, usuário e tela no `localStorage`.

Complementam a UI base: `Input`, `Select`, `Textarea`, `Checkbox`, `PaymentSelect`, `StatusSelect`, `Metric`, `AlertBlock` (em `Ui.jsx`) e `Loading`, `ApiError` (em `Feedback.jsx`). `Input` e `Textarea` encaminham atributos HTML ao controle nativo; `className` é do controle e `fieldClassName` do invólucro. Esses blocos são combinados em cada tela de `features/` para compor as interfaces de CRUD (listar, criar, editar, excluir) de forma consistente. Consulte `docs/API.md` para os endpoints que essas telas consomem e `docs/FLUXOS.md` para os fluxos de uso.

### Central de erros do frontend

`installGlobalErrorReporting()` (`lib/errorReporter.js`, chamado no `main.jsx`) escuta `error` e `unhandledrejection` da janela, e o `AppErrorBoundary` reporta erros de renderização. `reportError` envia a `POST /api/error-logs` (rota pública, com limite próprio) com no máximo 30 envios por sessão e sem repetir a mesma mensagem na mesma URL. Antes de enviar, classifica:

- "ResizeObserver loop…" é ruído do navegador e é descartado;
- falha de import dinâmico ("Importing a module script failed", "Failed to fetch dynamically imported module", `ChunkLoadError` e afins) é tratada como chunk defasado por deploy: vai como `warn` e o app recarrega sozinho uma vez (`reloadOnceForStaleChunk`, chave `aura:stale-chunk-reload` no `sessionStorage`, com 60 s de intervalo mínimo contra laço);
- falha de rede do visitante ("Load failed", "Failed to fetch") vai como `warn`;
- o resto vai como `error`.

## 9. Referências de código

- Bootstrap e montagem dos routers: `backend/src/index.js`
- Ciclo de requisição / isolamento: `backend/src/middleware/withDb.js`
- Resolução de tenant: `backend/src/middleware/tenant.js`
- Autenticação: `backend/src/middleware/auth.js`
- Sessões (access + refresh): `backend/src/services/sessions.js`
- Permissões: `backend/src/config/permissions.js`, `backend/src/config/roles.js`, `backend/src/services/permissionService.js`, `backend/src/middleware/requirePermission.js`
- Provisionamento e migrations multi-schema: `backend/src/services/tenants.js`
- Migrations versionadas: `backend/src/db/migrations.js`, `backend/scripts/migrations.mjs` e [`backend/src/db/migrations/README.md`](../backend/src/db/migrations/README.md)
- Schema de controle: `backend/src/db/platformSchema.sql`
- Schema de clínica: `backend/src/db/schema.sql`
- Camada de acesso ao banco: `backend/src/db/postgres.js`
- Registro de páginas do frontend: `frontend/src/lib/appPages.js`
- Cliente HTTP e sessão no frontend: `frontend/src/lib/api.js`
