# Fluxos de uso

Guia passo a passo dos principais fluxos da **Aura Clinic Piercing**, por perfil de uso. Para detalhes dos endpoints citados, veja `docs/API.md`; para arquitetura, `docs/ARQUITETURA.md`.

## Logins de teste (ambiente local)

Todos os valores abaixo são **defaults de desenvolvimento** — troque-os em produção.

| Contexto | Login | Origem |
| --- | --- | --- |
| **Super-admin da plataforma** (`/plataforma`) | `superadmin@aura.local` / `superadmin123` | `backend/.env` (`PLATFORM_ADMIN_EMAIL`/`PLATFORM_ADMIN_PASSWORD`); semeado por `ensurePlatform()` no primeiro boot se `platform.platform_users` estiver vazia. |
| **Clínica padrão** (código/slug) | `aura` | `backend/.env` (`DEFAULT_TENANT=aura`); é o tenant criado pela migração multi-tenant. |
| **Admin da clínica migrada** (`/login`) | `admin@auraclinic.com` / `aura123` | Admin da clínica `aura` (senha padrão; **troque em produção**). O campo de e-mail do login já vem pré-preenchido com esse endereço. |

Observação: em **desenvolvimento local** (`localhost`, `NODE_ENV != production`), a API dispensa o token nas rotas protegidas e assume o admin do tenant resolvido — útil para testar rapidamente sem login. Em produção o token é sempre obrigatório.

## (a) Cadastro de uma nova clínica

Fluxo de onboarding de um novo estúdio (novo tenant).

1. **Acesso à página de cadastro** — o interessado abre `/cadastro` (componente `Signup`). Requer que o cadastro público esteja habilitado (`ALLOW_PUBLIC_SIGNUP` diferente de `false`). Alternativamente, o super-admin cria a clínica pelo painel (ver fluxo (e)).
2. **Preenchimento** — nome da clínica e os dados do administrador inicial (e-mail e senha ≥ 8 caracteres, com confirmação). O identificador (slug) é derivado automaticamente do nome; a tela mostra o endereço previsto e, se já houver colisão, sugere o próximo disponível. O e-mail do administrador é verificado antes de avançar e não pode abrir uma segunda clínica.
3. **Envio** — o frontend chama `POST /api/signup` com `{ name, slug, admin_name, admin_email, admin_password }`.
4. **Provisionamento** (backend, `services/tenants.js → provisionTenant`):
   - Valida os dados; rejeita slugs reservados (ex.: `platform`, `public`, `admin`) e slugs já usados (`409`).
   - Insere a clínica em `platform.tenants` (obtendo um `id`).
   - Cria o schema Postgres `tenant_<slug>` e aplica nele o `schema.sql` (todas as tabelas do app) mais todas as migrations de tenant.
   - Cria o usuário admin inicial (`role='admin'`, senha com bcrypt) e insere o tema padrão do catálogo (`catalog_theme` id=1).
   - Em caso de erro, faz **rollback completo** (dropa o schema e remove o registro) — nada de clínica meio-criada.
5. **Resposta** — `201 { tenant:{id,name,slug} }`. A clínica já pode ser acessada.
6. **Primeiro login** — o admin entra em `/login` informando o **código da clínica (slug)** + e-mail + senha definidos no cadastro. A partir daí o token carrega o tenant e o `X-Tenant` é injetado automaticamente.

---

## (b) Dia a dia da recepção

Perfil `reception` (ou `admin`). Páginas típicas: agenda, clientes, vendas.

1. **Login** — `/login` com código da clínica + e-mail + senha (`POST /api/login`). O token é guardado no navegador e usado nas chamadas seguintes.
2. **Cadastrar um cliente** — na tela de Clientes, criar via `POST /api/clients` com `full_name` e `whatsapp` (obrigatórios) e, opcionalmente, `instagram`, `birth_date`, `notes`.
3. **Agendar um atendimento** — na Agenda, criar o agendamento (`POST /api/appointments`): escolher profissional, data e hora (obrigatórios), um ou mais serviços/procedimentos, região do piercing, a joia (e variação) se houver, e os valores (`total_value`, `deposit_value`, `remaining_value`). É possível anexar foto de referência (multipart). Se o horário já estiver ocupado, a API retorna `409`.
   - Alternativamente, o agendamento pode chegar pelo **booking público** (`POST /api/booking/requests`), aparecendo como solicitação `pendente` para a recepção confirmar.
4. **Receber o sinal (depósito)** — informar o valor e a forma de pagamento do sinal no agendamento; o comprovante pode ser anexado (`payment_proof_url`). O saldo restante fica registrado para cobrança no atendimento.
5. **Acompanhar a agenda** — visualizar/filtrar agendamentos (`GET /api/appointments?status=&professional_id=`), remarcar/atualizar status (`PATCH /api/appointments/:id`) e consultar disponibilidade/bloqueios.
6. **Vendas de balcão e serviços avulsos** — registrar em `POST /api/sales-orders`, usando as abas Produto, Serviço ou Mista. Quando o recebimento for futuro, a tela gera automaticamente a grade de parcelas e permite editar valor, vencimento e método de cada linha antes de salvar. Uma venda concluída baixa os produtos do estoque e transforma essa grade em títulos individuais de Contas a receber. O estado operacional da venda é independente do estado financeiro: uma venda concluída pode continuar com parcelas em aberto.

---

## (c) Piercer (atendimento e cuidados)

Perfil `piercer` (ou `admin`). Páginas típicas: agenda, clientes/prontuário, termos, pós-atendimento.

1. **Atendimento** — ao realizar o procedimento, atualizar o agendamento para `status:"atendido"` (`PATCH /api/appointments/:id`). Isso dispara automaticamente:
   - **Baixa de estoque** da joia/variação usada (se houver).
   - Criação/atualização de uma única **ordem de serviço** ligada ao agendamento.
   - Registro dos valores pagos e geração de **contas a receber** para o saldo pendente, com forma e parcelas configuráveis.
   - Criação dos **lembretes de pós-atendimento** (`post_care_followups`).
   - Crédito de **pontos de fidelidade** (10 pts pelo procedimento + 5 pts se houve compra de joia).
2. **Prontuário do cliente** — registrar o prontuário (`POST /api/clients/:id/medical-records`): histórico, joia usada, ocorrências, orientações, alergias, evolução de cicatrização, e fotos antes/depois (multipart).
3. **Termo digital** — colher o termo de consentimento assinado (`POST /api/digital-terms`): dados do cliente, confirmação das orientações, declaração de saúde e a **assinatura digital** (data URL). O backend gera um **PDF** e salva o `pdf_url`.
4. **Pós-atendimento** — acompanhar os followups (`GET /api/post-care`) e, a cada retorno, atualizar (`PATCH /api/post-care/:id`) com o status de cicatrização, notas e foto enviada pelo cliente (multipart), e enviar a mensagem de cuidado.

---

## (d) Compras e financeiro

Perfil `finance` (ou `admin`). Páginas: Compras, Fornecedores, Contas a pagar e Contas a receber.

1. **Preparar os cadastros** — manter fornecedores PF/PJ na tela Fornecedores. Categorias ficam disponíveis por atalho em Compras, Contas a pagar e Contas a receber; centros de custo aparecem somente em Compras e Contas a pagar.
2. **Registrar uma compra** — `POST /api/purchases` recebe fornecedor, produtos/variações, quantidades, custos e uma grade de parcelas. O modo automático distribui os centavos e vencimentos mensalmente; cada linha pode ter valor, data e método de pagamento alterados antes da confirmação. A confirmação ocorre em uma transação única: atualiza estoque e custo médio, registra movimentos de entrada e gera exatamente essas linhas em Contas a pagar. Reenvios com a mesma `Idempotency-Key` não duplicam efeitos.
3. **Controlar contas a pagar** — a tela reúne parcelas originadas por compras e lançamentos manuais do razão (`financial_entries`). Empréstimos e outras obrigações parceladas usam a mesma grade editável e cada parcela recebe sua própria baixa. Uma compra confirmada não pode ser apagada diretamente, pois já movimentou estoque e financeiro.
4. **Controlar contas a receber** — a tela reúne títulos gerados por vendas/serviços e lançamentos manuais. A baixa registra o valor efetivamente recebido sem duplicar o pagamento da origem.
5. **Exportar relatórios** — baixar os relatórios em três formatos:
   - CSV: `GET /api/finance/export.csv`
   - PDF: `GET /api/finance/export.pdf`
   - Excel (XLSX): `GET /api/finance/export.xlsx`
   O frontend usa `downloadApiFile` para baixar o arquivo autenticado.

A antiga tela agregadora “Financeiro 2.0” não faz mais parte da aplicação da clínica. A rota antiga `/app/financeiro` redireciona para Contas a receber; as rotas históricas de despesas permanecem apenas para compatibilidade dos dados existentes.

---

## (e) Super-admin da plataforma

Perfil super-admin (login separado dos usuários de clínica). Página: `/plataforma` (`PlatformAdmin`).

1. **Login de plataforma** — em `/plataforma`, autenticar com o super-admin (`POST /api/platform/login`). O token de plataforma (`plt:true`) só acessa `/api/platform/*` — não entra em clínicas, e tokens de clínica não entram no painel. Essas rotas **não** usam `X-Tenant`.
2. **Listar clínicas** — `GET /api/platform/tenants` mostra todas as clínicas com `status`/`plan`.
3. **Criar uma clínica** — `POST /api/platform/tenants` com os mesmos campos do signup (nome, slug, admin). Provisiona o schema e o admin (igual ao fluxo (a), porém iniciado pelo super-admin).
4. **Suspender / reativar** — `PATCH /api/platform/tenants/:id` com `{ status: "suspenso" }` (ou `"ativo"`). Clínica suspensa passa a receber `403` em suas rotas e no login; o cache de tenant é invalidado.
5. **Excluir uma clínica** — `DELETE /api/platform/tenants/:id` com `{ confirmation: "<slug>" }` (a confirmação deve ser exatamente o slug). Isso **deprovisiona** a clínica: `DROP SCHEMA tenant_<slug> CASCADE` (remove todos os dados), apaga o registro em `platform.tenants` e limpa o ledger de migrations daquele schema — as três exclusões na mesma transação.
6. **Métricas** — `GET /api/platform/metrics` traz clientes e agendamentos por clínica ativa.

> Cuidado: a exclusão é destrutiva e irreversível. Garanta backups (`npm --prefix backend run backup`) antes de remover uma clínica em produção.
