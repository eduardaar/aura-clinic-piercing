# Fluxos de uso

Guia passo a passo dos principais fluxos da **Aura Clinic Piercing**, por perfil de uso. Para detalhes dos endpoints citados, veja `docs/API.md`; para arquitetura, `docs/ARQUITETURA.md`.

## Logins de teste (ambiente local)

Todos os valores abaixo são **defaults de desenvolvimento** — troque-os em produção.

| Contexto | Login | Origem |
| --- | --- | --- |
| **Super-admin da plataforma** (`/plataforma`) | `superadmin@aura.local` / `superadmin123` | Padrão de desenvolvimento usado por `ensurePlatform()` (`services/tenants.js`) quando `PLATFORM_ADMIN_EMAIL`/`PLATFORM_ADMIN_PASSWORD` não estão no `backend/.env`; semeado no primeiro boot se `platform.platform_users` estiver vazia. Em produção, sem as duas variáveis, o superadmin não é criado. |
| **Clínica padrão** (código/slug) | `aura` | `backend/.env` (`DEFAULT_TENANT=aura`); é o tenant criado pela migração multi-tenant. |
| **Admin da clínica migrada** (`/login`) | Usuários herdados do banco legado | Admin da clínica `aura`, se a base veio do modelo anterior (o seed antigo criava `admin@auraclinic.com` com senha padrão; se essa conta existir, **troque a senha**). Vem da base anterior: `backend/scripts/migrate-to-multitenant.mjs` só move as tabelas existentes para o schema da clínica, e nenhum seed do código atual cria esse usuário ou essa senha. O campo de e-mail do login vem pré-preenchido com o último e-mail usado naquele navegador (`aura-last-email`), não com um endereço fixo. Para devolver a função admin a uma conta existente, use `npm run restore-admin` ([GUIA-DEV.md](./GUIA-DEV.md)). |

Observação: em **desenvolvimento local** a API só dispensa o token se as três condições valerem juntas — `NODE_ENV != production`, `ALLOW_LOCAL_AUTH_BYPASS=true` e requisição vinda de `localhost`/`127.0.0.1`/`::1` (`isLocalDevRequest` em `backend/src/middleware/auth.js`). Nesse caso assume o admin ativo do tenant resolvido. Sem a variável (padrão), o login é obrigatório também em desenvolvimento; em produção o token é sempre obrigatório.

## (a) Cadastro de uma nova clínica

Fluxo de onboarding de um novo estúdio (novo tenant).

1. **Acesso à página de cadastro** — o interessado abre `/cadastro` (componente `Signup`). Requer que o cadastro público esteja habilitado (`ALLOW_PUBLIC_SIGNUP` diferente de `false`). Alternativamente, o super-admin cria a clínica pelo painel (ver fluxo (e)).
2. **Preenchimento** — nome da clínica e os dados do administrador inicial (e-mail e senha ≥ 8 caracteres, com confirmação). O identificador (slug) é derivado automaticamente do nome; a tela mostra o endereço previsto e, se já houver colisão, sugere o próximo disponível (`GET /api/signup/availability`). O e-mail do administrador é verificado antes de avançar e não pode abrir uma segunda clínica.
3. **Plano e aceite** — na etapa seguinte a pessoa escolhe o plano (o link `/cadastro?plano=<código>` já chega com ele marcado) e marca o aceite dos Termos de Uso e da Política de Privacidade, que abrem em modal.
4. **Envio** — o frontend chama `POST /api/signup` com `{ name, admin_email, admin_password, plan_code, legal_acceptances: { terms_of_use, privacy_policy } }` (as versões vigentes dos dois documentos). O slug não é enviado: o backend o deriva do nome. Sem aceite das versões vigentes a API responde `400 legal_acceptance_required`; sem plano existente, `400 plano_obrigatorio`; plano desativado, `400 plano_indisponivel`. Em nenhum desses casos a clínica é criada.
5. **Provisionamento** (backend, `services/tenants.js → provisionTenant`):
   - Valida os dados; rejeita slugs reservados (ex.: `platform`, `public`, `admin`), slugs já usados e e-mail de administrador que já abriu outra clínica (`409`).
   - Insere a clínica em `platform.tenants` (obtendo um `id`).
   - Cria o schema Postgres `tenant_<slug>` (com `_` no lugar de `-`, gravado em `platform.tenants.schema_name`) e aplica nele o `schema.sql` (todas as tabelas do app) mais todas as migrations de tenant.
   - Cria o usuário admin inicial (`role='admin'`, senha com bcrypt) e insere o tema padrão do catálogo (`catalog_theme` id=1).
   - Em caso de erro, faz **rollback completo** (dropa o schema e remove o registro) — nada de clínica meio-criada.
   - Abre a assinatura em teste (`trial_active`) no plano escolhido. Em seguida, já fora do provisionamento, a rota `POST /api/signup` grava os aceites em `platform.legal_acceptances`.
6. **Resposta e entrada automática** — `201 { tenant:{id,name,slug,plan}, token, user }`, com o cookie de sessão. O frontend grava a sessão e abre direto `/app/onboarding`, sem passar pelo login.
7. **Onboarding** — a página Onboarding (menu Início, só para admin) mostra o checklist da clínica (`GET /api/booking/readiness`): o essencial (dados da clínica, tipos de atendimento, profissionais, vínculo serviço–profissional e horários) e as próximas etapas (primeiro produto, cliente, termo digital e catálogo), cada uma com um botão que abre a tela certa. Concluído o essencial ou 70% da jornada, o item desce para o grupo Configurações do menu; com tudo concluído, some.
8. **Logins seguintes** — o admin entra em `/login` informando o **código da clínica (slug)** + e-mail + senha definidos no cadastro. A partir daí o token carrega o tenant e o `X-Tenant` é injetado automaticamente.

---

## (b) Dia a dia da recepção

Perfil `reception` (ou `admin`). Páginas típicas: agenda, clientes, vendas. O botão **+ Novo** da barra superior abre direto Novo agendamento, Novo cliente, Nova venda ou Nova compra, conforme as permissões do usuário.

1. **Login** — `/login` com código da clínica + e-mail + senha (`POST /api/login`; o e-mail é comparado sem diferenciar maiúsculas). O token é guardado no navegador e usado nas chamadas seguintes. Quem esqueceu a senha usa **Esqueci minha senha**: `POST /api/auth/forgot-password` sempre responde de forma genérica e, se a conta existir e estiver ativa, envia por e-mail um link de uso único válido por 30 minutos (`/login?t=<slug>&reset=<token>`); a tela **Criar nova senha** chama `POST /api/auth/reset-password` (mínimo de 12 caracteres) e encerra as sessões abertas.
2. **Cadastrar um cliente** — em Clientes → **Novo cliente** (`POST /api/clients`), com nome e WhatsApp com DDD obrigatórios e os demais dados opcionais (CPF, e-mail, Instagram, data de nascimento, endereço, observações etc.). Se outro cliente ativo já tiver o mesmo CPF, WhatsApp ou e-mail, a API responde `409 duplicate_client` com os cadastros encontrados.
3. **Agendar um atendimento** — na Agenda, **Novo agendamento** (`POST /api/appointments`): escolher profissional, data e hora (obrigatórios), um ou mais tipos de atendimento, região do piercing, a joia (e variação) se houver, e os valores (`total_value`, `deposit_value`, `remaining_value`). É possível anexar foto de referência (multipart). Se o horário já estiver ocupado, a API retorna `409`; regras do tipo de atendimento (idade mínima, responsável legal, antecedência, intervalo) também podem recusar o horário.
   - Alternativamente, o agendamento pode chegar pelo **booking público** (`POST /api/booking/requests`), aparecendo como solicitação `pendente` para a recepção confirmar em Agenda → **Mais opções** → **Solicitações online**.
4. **Receber o sinal (depósito)** — informar o valor e a forma de pagamento do sinal no agendamento. No booking público o cliente pode anexar o comprovante (`payment_proof_url`). O saldo restante fica registrado para cobrança no atendimento.
5. **Acompanhar a agenda** — a Agenda abre na visão **Diário**; o seletor alterna Mensal, Semanal, Diário e Agendamentos, e a busca, o botão **Filtros** (profissional e status) e o botão **Período** valem para as quatro visões (`GET /api/appointments?search=&professional_id=&status=&from=&to=`). No detalhe do agendamento ficam **Confirmar**, **Registrar chegada**, **Iniciar atendimento** e **Reagendar** (`PATCH /api/appointments/:id`); mudar data ou hora exige o **Motivo do reagendamento**, gravado no histórico. Lista de espera, histórico de atendimentos e as configurações (procedimentos, profissionais, agenda semanal, salas e recursos, bloqueios) ficam em **Mais opções**.
6. **Cancelar** — o cancelamento não é uma troca de status: o botão **Cancelar** do detalhe chama `POST /api/appointments/:id/cancel` com motivo e uma resolução financeira (reter sinal, converter em crédito, reembolso manual ou sem pagamento recebido). **Não compareceu** usa a mesma rota com `outcome: "no_show"` e deixa o status `nao_compareceu`. `PATCH` com `status: "cancelado"` responde `409`. Atendimento concluído com pagamento final é recusado com a mensagem de fazer antes a "devolução/estorno da venda", mas esse fluxo não existe para atendimentos (que geram `service_executions`, não venda); ver [EVOLUCAO-OPERACIONAL-ESTOQUE-E-FINANCEIRO.md](./EVOLUCAO-OPERACIONAL-ESTOQUE-E-FINANCEIRO.md).
7. **Vendas de balcão** — registrar em Vendas → **Nova venda** (`POST /api/sales-orders`), em etapas Cliente → Itens → Pagamento. Vendas aceitam apenas produtos; serviços entram pela Agenda. Quando o recebimento for futuro, a tela gera automaticamente a grade de parcelas e permite editar valor, vencimento e método de cada linha antes de salvar. Uma venda concluída baixa os produtos do estoque e transforma essa grade em títulos individuais de Contas a receber. O estado operacional da venda é independente do estado financeiro: uma venda concluída pode continuar com parcelas em aberto. A tela alterna **Em aberto** e **Histórico**.

---

## (c) Piercer (atendimento e cuidados)

Perfil `piercer` (ou `admin`). Páginas típicas: agenda, clientes/prontuário, termos, pós-atendimento.

1. **Atendimento** — no detalhe do agendamento, **Revisar e finalizar** registra os pagamentos recebidos e as observações opcionais (clínicas, intercorrências e orientações pós-atendimento) e chama `POST /api/appointments/:id/complete` (o mesmo efeito vale para `PATCH /api/appointments/:id` com `status:"atendido"`). Se algum tipo de atendimento exigir termo assinado, a conclusão é recusada até haver um termo digital ligado ao agendamento. A conclusão dispara, na mesma transação:
   - **Baixa de estoque** da joia/variação usada (se houver) e dos materiais da **ficha técnica** do tipo de atendimento, com lotes consumidos por FEFO; reabrir ou cancelar devolve o que foi consumido.
   - Criação/atualização de uma única **execução do atendimento** (`service_executions`) ligada ao agendamento — não há mais ordem de serviço em Vendas.
   - Registro dos valores pagos e geração de **contas a receber** para o saldo pendente (títulos com origem `service_execution`), com forma e parcelas configuráveis.
   - Criação dos **lembretes de pós-atendimento** (`post_care_followups`) conforme o tipo de atendimento: só os dias configurados quando **Gerar pós-atendimento** está ligado, mais o **Retorno após dias**; agendamentos antigos, sem regras gravadas, mantêm 7/15/30 dias.
   - Crédito de **pontos de fidelidade** (10 pts pelo procedimento + 5 pts se houve compra de joia).
   Os atendimentos concluídos aparecem em Agenda → **Mais opções** → **Histórico de atendimentos**.
2. **Prontuário do cliente** — no perfil do cliente (Clientes → **Ver perfil**), aba **Histórico e atendimentos**, registrar o prontuário (`POST /api/clients/:id/medical-records`): histórico, joia usada, ocorrências, orientações, alergias, evolução de cicatrização, e fotos antes/depois (multipart).
3. **Termo digital** — na aba **Termos digitais** do perfil:
   - **Novo termo** abre o modal em etapas (Dados, Saúde, Consentimento, Assinatura) com os dados do cliente já preenchidos e vínculo opcional a um agendamento, e envia a `POST /api/digital-terms`: confirmação das orientações, declaração de saúde e a **assinatura digital** (data URL). Cliente menor de 18 anos exige responsável legal com nome, documento e assinatura própria. O backend gera um **PDF** e salva o `pdf_url`; o termo assinado não pode ser alterado depois.
   - **Enviar para assinar** gera um link individual (`POST /api/term-requests`) a partir de um modelo de termo, com canal “no estúdio” ou “à distância” e validade de 6 horas a 7 dias. O link pode ser copiado, enviado pelo WhatsApp ou aberto no celular/tablet do estúdio; o cliente lê, preenche e assina em `/termo/<token>?t=<slug>`, sem login (`GET/POST /api/public/terms/:token`).
   - A página Termos digitais (`/app/clientes/termos`, aberta pelo Onboarding) reúne as abas Assinados, Solicitações (gerar novo link ou cancelar) e Modelos.
4. **Pós-atendimento** — em Clientes → **Mais opções** → **Pós-atendimento**, acompanhar os followups (`GET /api/post-care`), com filtros por prioridade, profissional, prazo do retorno e foto, e, a cada retorno, atualizar (`PATCH /api/post-care/:id`) com o status de cicatrização, notas e foto enviada pelo cliente (multipart), e enviar a mensagem de cuidado.

---

## (d) Compras e financeiro

Perfil `finance` (ou `admin`). Páginas: Compras, Fornecedores, Contas a pagar e Contas a receber. No menu, Compras e Fornecedores ficam em **Estoque e compras**, e o item **Financeiro** abre Contas a receber; Contas a pagar, **Visão financeira**, **Caixa**, Categorias e Centros de custo abrem pelo **Mais opções** do cabeçalho dessas telas.

1. **Preparar os cadastros** — manter fornecedores PF/PJ na tela Fornecedores. Categorias e centros de custo ficam disponíveis por atalho (**Mais opções**) em Compras, Contas a pagar e Contas a receber.
2. **Registrar uma compra** — Compras → **Nova compra**, em etapas Dados → Itens → Pagamento. Cada item é “Produto para revenda” ou “Material de consumo” (ambos itens do Estoque). Em **Importar XML da NF-e** a tela lê a nota (`POST /api/purchases/nfe/preview`) e permite associar cada linha a um item existente ou cadastrar um novo produto ou material na própria compra. `POST /api/purchases` recebe fornecedor, itens/variações, quantidades, custos e uma grade de parcelas. O modo automático distribui os centavos e vencimentos mensalmente; cada linha pode ter valor, data e método de pagamento alterados antes da confirmação. A confirmação ocorre em uma transação única: atualiza estoque e custo médio, registra movimentos de entrada e gera exatamente essas linhas em Contas a pagar. Reenvios com a mesma `Idempotency-Key` não duplicam efeitos.
3. **Controlar contas a pagar** — a tela reúne parcelas originadas por compras e lançamentos manuais do razão (`financial_entries`). Empréstimos e outras obrigações parceladas usam a mesma grade editável e cada parcela recebe sua própria baixa. Uma compra confirmada não pode ser apagada diretamente, pois já movimentou estoque e financeiro.
4. **Controlar contas a receber** — a tela reúne títulos gerados por vendas, atendimentos concluídos e lançamentos manuais (**Novo recebível**). A baixa registra o valor efetivamente recebido sem duplicar o pagamento da origem. O período é um filtro da listagem; **Visão financeira** e **Caixa** mostram o resumo do ano corrente a partir do razão (`GET /api/finance/ledger?from=<ano>-01-01&to=<ano>-12-31`), e Caixa considera só valores pagos.
5. **Exportar relatórios** — na tela Relatórios, escolher o relatório no seletor da barra, ajustar os filtros no botão **Filtros** e baixar em PDF, XLSX, CSV ou TXT (`GET /api/reports/:type?format=`). A lista de relatórios (`GET /api/reports`) mostra só o que as permissões e o plano liberam. O frontend usa `downloadApiFile` para baixar o arquivo autenticado. As rotas antigas `GET /api/finance/export.csv|pdf|xlsx` continuam no backend, mas a tela não as usa.

A antiga tela agregadora “Financeiro 2.0” não faz mais parte da aplicação da clínica. A rota antiga `/app/financeiro` é um alias de Contas a receber; as rotas históricas de despesas permanecem apenas para compatibilidade dos dados existentes.

---

## (e) Super-admin da plataforma

Perfil super-admin (login separado dos usuários de clínica). Página: `/plataforma` (`PlatformAdmin`).

1. **Login de plataforma** — em `/plataforma`, autenticar com o super-admin (`POST /api/platform/login`); com MFA ativo, a API responde `mfa_required` e a tela pede o **Código do autenticador**. O token de plataforma (`plt:true`) só acessa `/api/platform/*` — não entra em clínicas, e tokens de clínica não entram no painel. Essas rotas **não** usam `X-Tenant`. O painel abre na área **Financeiro** (`/plataforma/dashboard`); as demais áreas são **Clínicas** (`/plataforma/contas`), **Planos**, **Suporte** e **Conteúdo da plataforma** (Landing, Notícias e manual, Termos e privacidade). **Mais opções** traz Configuração de e-mail (`/plataforma/email`), Segurança da conta (`/plataforma/seguranca`, ativar ou desativar o MFA) e Sair.
2. **Listar clínicas** — a área Clínicas usa `GET /api/platform/tenants`, que mostra todas as clínicas com `status`/`plan` e a situação da assinatura. **Abrir gestão** mostra resumo, uso x cotas, troca de plano, ações e faturas da clínica.
3. **Criar uma clínica** — **Nova clínica** chama `POST /api/platform/tenants` com os campos do signup (nome, slug opcional e dados do admin; a API também aceita `plan_code`, e sem ele usa o plano padrão). Provisiona o schema e o admin (igual ao fluxo (a), porém iniciado pelo super-admin, sem exigir aceite dos documentos legais e sem recusar plano desativado).
4. **Suspender / reativar** — ação **Suspender clínica** / **Reativar clínica** da lista: `PATCH /api/platform/tenants/:id` com `{ status: "suspenso" }` (ou `"ativo"`). Clínica suspensa passa a receber `403` em suas rotas e no login; o cache de tenant é invalidado. Suspender não cancela a cobrança da assinatura. **Ativar / renovar** (`PATCH /api/platform/tenants/:id/plan`) troca o plano e ativa a assinatura por 30 dias sem exigir pagamento; o reajuste da recorrência no gateway é feito depois, em melhor esforço.
5. **Excluir uma clínica** — ação **Excluir clínica**: `DELETE /api/platform/tenants/:id` com `{ confirmation: "<slug>" }` (a confirmação deve ser exatamente o slug). Isso **deprovisiona** a clínica: `DROP SCHEMA` do schema da clínica com `CASCADE` (remove todos os dados), apaga o registro em `platform.tenants` e limpa o ledger de migrations daquele schema — as três exclusões na mesma transação.
6. **Métricas** — `GET /api/platform/metrics` continua no backend (clientes e agendamentos por clínica ativa), mas o painel não a usa mais: os números da plataforma ficam na área Financeiro e o uso de cada clínica em Clínicas → Abrir gestão.

> Cuidado: a exclusão é destrutiva e irreversível. Garanta backups (`npm --prefix backend run backup`) antes de remover uma clínica em produção.
