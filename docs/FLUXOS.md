# Fluxos de uso

Guia passo a passo dos principais fluxos da **Aura Clinic Piercing**, por perfil de uso. Para detalhes dos endpoints citados, veja `docs/API.md`; para arquitetura, `docs/ARQUITETURA.md`.

## Logins de teste (ambiente local)

Todos os valores abaixo são **defaults de desenvolvimento** — troque-os em produção.

| Contexto | Login | Origem |
| --- | --- | --- |
| **Super-admin da plataforma** (`/plataforma`) | `superadmin@aura.local` / `superadmin123` | `backend/.env` (`PLATFORM_ADMIN_EMAIL`/`PLATFORM_ADMIN_PASSWORD`); semeado por `ensurePlatform()` no primeiro boot se `platform.platform_users` estiver vazia. |
| **Clínica padrão** (código/slug) | `aura` | `backend/.env` (`DEFAULT_TENANT=aura`); é o tenant criado pela migração multi-tenant. |
| **Admin da clínica migrada** (`/login`) | `admin@auraclinic.com` / `aura123` | Admin da clínica `aura` (senha padrão; **troque em produção**). O campo de e-mail do login já vem pré-preenchido com esse endereço. |
| **Central Administrativa (frontend)** | senha `aura123` | `frontend/.env` (`VITE_ADMIN_PASSWORD`). |

Observação: em **desenvolvimento local** (`localhost`, `NODE_ENV != production`), a API dispensa o token nas rotas protegidas e assume o admin do tenant resolvido — útil para testar rapidamente sem login. Em produção o token é sempre obrigatório.

---

## (a) Cadastro de uma nova clínica

Fluxo de onboarding de um novo estúdio (novo tenant).

1. **Acesso à página de cadastro** — o interessado abre `/cadastro` (componente `Signup`). Requer que o cadastro público esteja habilitado (`ALLOW_PUBLIC_SIGNUP` diferente de `false`). Alternativamente, o super-admin cria a clínica pelo painel (ver fluxo (e)).
2. **Preenchimento** — nome da clínica, **identificador (slug)** único (minúsculas, números e hífens, 3–30 caracteres, ex.: `aura`), e os dados do administrador inicial (nome, e-mail, senha ≥ 8 caracteres).
3. **Envio** — o frontend chama `POST /api/signup` com `{ name, slug, admin_name, admin_email, admin_password }`.
4. **Provisionamento** (backend, `services/tenants.js → provisionTenant`):
   - Valida os dados; rejeita slugs reservados (ex.: `platform`, `public`, `admin`) e slugs já usados (`409`).
   - Insere a clínica em `platform.tenants` (obtendo um `id`).
   - Cria o schema Postgres `tenant_<id>` e aplica o `schema.sql` (todas as tabelas do app) nele.
   - Cria o usuário admin inicial (`role='admin'`, senha com bcrypt) e insere o tema padrão do catálogo (`catalog_theme` id=1).
   - Em caso de erro, faz **rollback completo** (dropa o schema e remove o registro) — nada de clínica meio-criada.
5. **Resposta** — `201 { tenant:{id,name,slug} }`. A clínica já pode ser acessada.
6. **Primeiro login** — o admin entra em `/login` informando o **código da clínica (slug)** + e-mail + senha definidos no cadastro. A partir daí o token carrega o tenant e o `X-Tenant` é injetado automaticamente.

---

## (b) Dia a dia da recepção

Perfil `reception` (ou `admin`). Páginas típicas: agenda, clientes, vendas.

1. **Login** — `/login` com código da clínica + e-mail + senha (`POST /api/login`). O token é guardado no navegador e usado nas chamadas seguintes.
2. **Cadastrar um cliente** — na tela de Clientes, criar via `POST /api/clients` com `full_name` e `whatsapp` (obrigatórios) e, opcionalmente, `instagram`, `birth_date`, `notes`.
3. **Agendar um atendimento** — na Agenda, criar o agendamento (`POST /api/appointments`): escolher profissional, data e hora (obrigatórios), o serviço/procedimento, região do piercing, a joia (e variação) se houver, e os valores (`total_value`, `deposit_value`, `remaining_value`). É possível anexar foto de referência (multipart). Se o horário já estiver ocupado, a API retorna `409`.
   - Alternativamente, o agendamento pode chegar pelo **booking público** (`POST /api/booking/requests`), aparecendo como solicitação `pendente` para a recepção confirmar.
4. **Receber o sinal (depósito)** — informar o valor e a forma de pagamento do sinal no agendamento; o comprovante pode ser anexado (`payment_proof_url`). O saldo restante fica registrado para cobrança no atendimento.
5. **Acompanhar a agenda** — visualizar/filtrar agendamentos (`GET /api/appointments?status=&professional_id=`), remarcar/atualizar status (`PATCH /api/appointments/:id`) e consultar disponibilidade/bloqueios.
6. **Vendas de balcão** (opcional) — registrar venda de produtos/serviços em `POST /api/sales-orders`.

---

## (c) Piercer (atendimento e cuidados)

Perfil `piercer` (ou `admin`). Páginas típicas: agenda, clientes/prontuário, termos, pós-atendimento.

1. **Atendimento** — ao realizar o procedimento, atualizar o agendamento para `status:"atendido"` (`PATCH /api/appointments/:id`). Isso dispara automaticamente:
   - **Baixa de estoque** da joia/variação usada (se houver).
   - Registro do **pagamento do saldo** restante.
   - Criação dos **lembretes de pós-atendimento** (`post_care_followups`).
   - Crédito de **pontos de fidelidade** (10 pts pelo procedimento + 5 pts se houve compra de joia).
2. **Prontuário do cliente** — registrar o prontuário (`POST /api/clients/:id/medical-records`): histórico, joia usada, ocorrências, orientações, alergias, evolução de cicatrização, e fotos antes/depois (multipart).
3. **Termo digital** — colher o termo de consentimento assinado (`POST /api/digital-terms`): dados do cliente, confirmação das orientações, declaração de saúde e a **assinatura digital** (data URL). O backend gera um **PDF** e salva o `pdf_url`.
4. **Pós-atendimento** — acompanhar os followups (`GET /api/post-care`) e, a cada retorno, atualizar (`PATCH /api/post-care/:id`) com o status de cicatrização, notas e foto enviada pelo cliente (multipart), e enviar a mensagem de cuidado.

---

## (d) Financeiro

Perfil `finance` (ou `admin`). Página: Financeiro.

1. **Relatório financeiro** — abrir a tela de Financeiro (`GET /api/finance`): receita por período, formas de pagamento, resumo de despesas e previsão de lucro.
2. **Lançar despesas** — cadastrar despesas (`POST /api/expenses`) informando descrição, tipo (`fixa`/`variavel`), vencimento (obrigatórios), categoria, valor, status e forma de pagamento. Remover com `DELETE /api/expenses/:id`.
3. **Exportar relatórios** — baixar os relatórios em três formatos:
   - CSV: `GET /api/finance/export.csv`
   - PDF: `GET /api/finance/export.pdf`
   - Excel (XLSX): `GET /api/finance/export.xlsx`
   O frontend usa `downloadApiFile` para baixar o arquivo autenticado.

---

## (e) Super-admin da plataforma

Perfil super-admin (login separado dos usuários de clínica). Página: `/plataforma` (`PlatformAdmin`).

1. **Login de plataforma** — em `/plataforma`, autenticar com o super-admin (`POST /api/platform/login`). O token de plataforma (`plt:true`) só acessa `/api/platform/*` — não entra em clínicas, e tokens de clínica não entram no painel. Essas rotas **não** usam `X-Tenant`.
2. **Listar clínicas** — `GET /api/platform/tenants` mostra todas as clínicas com `status`/`plan`.
3. **Criar uma clínica** — `POST /api/platform/tenants` com os mesmos campos do signup (nome, slug, admin). Provisiona o schema e o admin (igual ao fluxo (a), porém iniciado pelo super-admin).
4. **Suspender / reativar** — `PATCH /api/platform/tenants/:id` com `{ status: "suspenso" }` (ou `"ativo"`). Clínica suspensa passa a receber `403` em suas rotas e no login; o cache de tenant é invalidado.
5. **Excluir uma clínica** — `DELETE /api/platform/tenants/:id` com `{ confirmation: "<slug>" }` (a confirmação deve ser exatamente o slug). Isso **deprovisiona** a clínica: `DROP SCHEMA tenant_<id> CASCADE` (remove todos os dados) e apaga o registro em `platform.tenants`.
6. **Métricas** — `GET /api/platform/metrics` traz clientes e agendamentos por clínica ativa.

> Cuidado: a exclusão é destrutiva e irreversível. Garanta backups (`npm --prefix backend run backup`) antes de remover uma clínica em produção.
