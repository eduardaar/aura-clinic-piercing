# Integração com o Asaas

Gateway de pagamento da Aura Clinic. Este documento cobre o desenho, as
decisões que não são óbvias no código e o passo a passo de configuração.

---

## 1. Dois níveis de credencial

A pergunta que define tudo aqui é **de quem é o dinheiro**. São dois fluxos
distintos, com contas Asaas distintas:

| | Quem cobra | Quem paga | Credencial | Onde fica |
| --- | --- | --- | --- | --- |
| **Plataforma** | Monitence | a clínica | `ASAAS_API_KEY` | variável de ambiente |
| **Clínica** | a clínica | o cliente final | a chave da própria clínica | cofre cifrado no schema dela |

O dinheiro **sempre cai na conta de quem cobrou**. Não há split nem subconta.

Isso é uma decisão de produto: o modelo de subcontas do Asaas exigiria que a
conta raiz da Monitence fosse CNPJ. Com cada clínica usando a própria conta, a
clínica recebe direto, sem intermediação de recebíveis.

A chave da plataforma **nunca vem do banco**. Se viesse, uma clínica com acesso
de escrita ao próprio schema poderia, em tese, influenciar a conta que recebe o
dinheiro da assinatura.

---

## 2. Cofre de credenciais da clínica

`tenant_integrations`, no schema de cada clínica. Implementado em
`backend/src/services/asaas/vault.js` e `credentials.js`.

- Cifra **AES-256-GCM**. GCM e não CBC porque ele também **autentica**: uma
  linha adulterada no banco falha na verificação da tag em vez de decifrar para
  lixo silencioso.
- Chave derivada por `scrypt` de `ASAAS_VAULT_KEY` (recomendado) ou, na falta
  dela, do `AUTH_SECRET`. **Atenção:** sem `ASAAS_VAULT_KEY`, rotacionar o
  `AUTH_SECRET` torna ilegíveis todas as credenciais salvas e cada clínica
  precisa recadastrar a chave.
- O formato armazenado é `v1:<iv>:<tag>:<ciphertext>`. O prefixo de versão é o
  que permitirá trocar de algoritmo sem adivinhar o formato das linhas antigas.
- A API **nunca** devolve o segredo — só `secret_hint` (`••••1a2b`) e booleanos.
  A única exceção é o token de webhook recém-gerado, que aparece uma vez para
  ser colado no painel do Asaas.

Tabela dedicada, e não `catalog_settings`: aquela **vaza inteira** na rota
pública `GET /api/catalog`. Uma credencial de pagamento não pode viver ao lado
de dado servido sem autenticação.

---

## 3. Webhook

```
POST /api/webhooks/asaas            conta da Monitence (assinatura das clínicas)
POST /api/webhooks/asaas/<slug>     conta da própria clínica (cliente final)
```

A clínica é identificada pelo **slug na URL**, não por header: o Asaas posta sem
sessão, sem `X-Tenant` e sem noção do que é multi-tenant. Cada clínica cadastra
a própria URL no painel dela.

O slug sozinho **não autoriza nada** — a autenticidade vem do token.

### Autenticidade

O Asaas ecoa, em todo webhook, o token cadastrado no painel dele, no header
`asaas-access-token`. Não é assinatura HMAC do corpo: é um segredo
compartilhado.

Duas guardas:

1. **Fail-closed.** Sem token configurado do nosso lado, o webhook fica
   *desligado*, não aberto. Um endpoint público que aceita qualquer POST é o
   mesmo que dar a qualquer pessoa na internet o poder de marcar cobrança como
   paga.
2. **Comparação em tempo constante** (`timingSafeEqual`). Um `===` vazaria o
   token caractere a caractere pelo tempo de resposta.

### Contrato de status HTTP

Esta é a parte mais fácil de errar. O Asaas **reentrega em qualquer resposta
fora da faixa 2xx** e, após falhas consecutivas, **pausa a fila de webhooks da
conta inteira** — o que congela todas as cobranças daquele cliente até alguém
reativar no painel.

| Situação | Status | Por quê |
| --- | --- | --- |
| Processado | 200 | — |
| Evento duplicado | 200 | Caminho normal, não excepcional |
| Evento não tratado | 200 | Repetir dá o mesmo resultado |
| Cobrança desconhecida | 200 | Criada direto no painel; não é nossa |
| Clínica inexistente | 200 | Slug errado não passa a existir por reentrega |
| Token ausente/inválido | 401 | Reentrega é *desejável*: é fraude ou config quebrada |
| Falha nossa (banco fora) | 500 | Reentrega é exatamente o que queremos |

### Idempotência

O Asaas entrega **ao menos uma vez**, e `PAYMENT_CONFIRMED` e `PAYMENT_RECEIVED`
chegam ambos para a mesma cobrança. Idempotência aqui não é refinamento: é o
caminho normal de execução.

Três camadas:

1. `platform.webhook_events` com índice único
   `(provider, scope, provider_event_id)`. O evento é **reivindicado antes de
   ser processado** — é o índice único, não um `SELECT`, que serializa duas
   entregas simultâneas.
2. Índices únicos nas cobranças: `ux_tenant_invoices_asaas_payment` e
   `ux_payment_intents_external`. Um `payment.id` ↔ uma linha.
3. Guarda de estado em cada handler (não reprocessa fatura já paga).

**A armadilha que isso resolve:** reivindicar o evento antes de processar cria
um risco de perda silenciosa de dinheiro — se o processamento falhar depois da
reivindicação, a reentrega do Asaas seria descartada como duplicata e o
pagamento nunca baixaria. Por isso o caminho de erro chama `releaseEvent`, que
anula o `provider_event_id`: a linha fica para auditoria, mas sai do índice
único e a reentrega volta a ser tratada como evento novo.

### Eventos tratados

| Evento | Ação |
| --- | --- |
| `PAYMENT_CREATED` | materializa a fatura do mês (pendente) |
| `PAYMENT_CONFIRMED` / `PAYMENT_RECEIVED` / `PAYMENT_RECEIVED_IN_CASH` / `PAYMENT_APPROVED_BY_RISK_ANALYSIS` | marca paga |
| `PAYMENT_OVERDUE` | marca atrasada |
| `PAYMENT_DELETED` / `PAYMENT_REFUNDED` / `PAYMENT_CHARGEBACK_*` / `PAYMENT_REPROVED_BY_RISK_ANALYSIS` | cancela ou estorna |
| qualquer outro | no-op explícito |

Ignorar o resto explicitamente é o que faz cada evento novo que o Asaas invente
chegar aqui e virar no-op, sem quebrar nada.

### Rate limit

Os webhooks têm limite **próprio e generoso** (`webhookLimiter`, 600/min) e são
montados **antes** do rate limit global. Motivo concreto: o Asaas entrega de
poucos IPs fixos, então todas as clínicas caem no mesmo bucket; sob o teto
global (300/min) uma rajada devolveria 429 — e 429 não é 2xx, o que reentrega e
acaba pausando a fila.

---

## 4. Endpoints

### Assinatura da clínica (admin da clínica)

| Método | Rota | Observação |
| --- | --- | --- |
| `GET` | `/api/billing/subscription` | Plano, faturas recentes, `gateway_enabled` e `billing_profile` |
| `PUT` | `/api/billing/profile` | CPF/CNPJ e e-mail do responsável — **pré-requisito do checkout** |
| `POST` | `/api/billing/checkout` | `{ plan_code, billing_type, credit_card? }` |
| `GET` | `/api/billing/invoices` | Paginado |

`billing_type` é `UNDEFINED` (link de fatura: o Asaas hospeda a página e o
pagador escolhe PIX/boleto/cartão) ou `CREDIT_CARD` (débito automático mensal).

**`Idempotency-Key` é obrigatório em `CREDIT_CARD`.** Sem ele um duplo-clique —
ou uma repetição por timeout de rede — geraria uma segunda assinatura recorrente
e uma segunda cobrança no cartão. A rota devolve a *mesma promessa* para a mesma
chave, inclusive a que ainda está em voo.

> Limitação conhecida: a deduplicação é **por processo**. Com mais de uma
> instância atrás de um balanceador, duas requisições podem escapar. A solução
> definitiva é persistir a chave numa tabela com índice único.

`billing_profile.complete: false` é o sinal para a tela pedir o CPF/CNPJ **antes**
de oferecer o botão de assinar: o Asaas recusa criar pagador sem documento, e o
erro dele (`invalid_cpfCnpj`) não diz onde preencher.

### Cofre da clínica (admin da clínica)

| Método | Rota | Observação |
| --- | --- | --- |
| `GET` | `/api/integrations/asaas` | Status + `webhook_url` a cadastrar no painel |
| `PUT` | `/api/integrations/asaas` | Campos ausentes são preservados |
| `POST` | `/api/integrations/asaas/webhook-token` | Gera e devolve **uma única vez** |
| `POST` | `/api/integrations/asaas/test` | Handshake com o gateway |
| `DELETE` | `/api/integrations/asaas` | Exige `{ confirm: true }` |

Todas exigem papel `admin` — nem `finance`. Quem troca esta chave redireciona o
faturamento inteiro da clínica.

### Cobrança do cliente final (público, sem sessão)

| Método | Rota | Observação |
| --- | --- | --- |
| `POST` | `/api/booking` | Devolve `payment_url` e `online_payment_available` |
| `POST` | `/api/sales-orders/public` | Idem |
| `GET` | `/api/payment-intents/:id/pix` | QR code + copia-e-cola |
| `POST` | `/api/payment-intents/:id/sync` | "Paguei e não confirmou" |

As duas últimas são **públicas de propósito**: quem chama é o cliente final, na
tela de agendamento ou de checkout, onde não existe sessão. O que protege é o id
do intent ser um serial que só quem acabou de criar o pedido conhece — e o PIX
não revelar nada além do valor. O `sync` devolve **só o status**, nunca o intent
inteiro.

A cobrança é criada **fora da transação** do agendamento/pedido, e é
best-effort: se o Asaas estiver fora, o agendamento continua de pé e a resposta
traz `online_payment_available: false`, caindo no fluxo manual de sempre.
Trocar o agendamento de um cliente por uma indisponibilidade do gateway seria
péssimo negócio.

#### PIX obrigatório quando há estoque

Cobrança que reserva **joia física** sai como `PIX` com janela de 30 minutos
(`chargeModeForStock`), casando exatamente com a validade da reserva de estoque.

Com `UNDEFINED` o pagador poderia escolher **boleto** e pagar dois dias depois —
mas a joia é peça única, reservada agora. As duas saídas eram segurar o estoque
por 48h (perdendo venda de balcão em cima de um pedido que talvez nunca seja
pago) ou liberar a reserva antes do boleto vencer (recebendo o dinheiro de uma
peça já vendida a outra pessoa). O boleto simplesmente não é oferecido quando há
estoque em jogo.

Sinal de agendamento **sem joia** continua `UNDEFINED`: ali não há peça presa e
a flexibilidade de pagamento vale mais.

### Conciliação periódica

Worker opt-in (`ASAAS_RECONCILE_ENABLED=true`) que relê no gateway as cobranças
em aberto e aplica o efeito do webhook que se perdeu. É **rede de segurança** —
quem confirma pagamento no caminho normal é o webhook.

Desligado por padrão inclusive em produção, e deliberadamente **não** amarrado ao
`NODE_ENV`: a suíte de testes sobe o servidor com `NODE_ENV=production`, e o
worker acabaria batendo no gateway a cada `npm test`.

### Plataforma (super-admin)

| Método | Rota |
| --- | --- |
| `GET` | `/api/platform/invoices` |
| `POST` | `/api/platform/invoices/:id/sync` |

O `sync` é a saída para o webhook que se perdeu ("paguei e continua atrasada"):
relê a cobrança no Asaas e reaplica o efeito.

#### Troca de plano propaga o preço no gateway

A propagação evita a divergência em que promover uma clínica mudava o acesso
**na hora** e deixava a assinatura recorrente no Asaas cobrando o valor do
plano antigo.

`syncSubscriptionPrice()` (`services/platformBilling.js`) é o **único** ponto de
propagação, sempre com a credencial da **plataforma**, e está ligado nos **três**
caminhos que trocam plano — o levantamento achou três, não um:

| Caminho | Onde |
| --- | --- |
| `PATCH /api/platform/accounts/:id/plan` | `services/accountAdmin.js` |
| `PATCH /api/platform/tenants/:id/plan` (botão de ativar/renovar) | `routes/platform.js` |
| `PATCH /api/subscription` (self-service da própria clínica) | `routes/store.js` |

Propriedades que importam:

- **Nunca lança.** O acesso já mudou; gateway fora do ar não pode desfazer nem
  travar a troca. O resultado vira `warning` na resposta e a tela exibe.
- **Idempotente:** lê a assinatura antes de escrever e não escreve se o valor já
  bate.
- Existe **"Reenviar ajuste ao Asaas"** no painel para o caso de falha.
- Não usa `runIdempotent`: ele serve a requisição que **cria** cobrança, e aqui
  só há `POST /subscriptions/{id}` com valor absoluto sobre assinatura existente.

Plano com `price_cents = 0` devolve `plano_sem_preco`, pois o Asaas não aceita
assinatura de valor zero. Exercite a propagação no sandbox antes de uma virada
de preço em produção.

---

## 5. Armadilhas do Asaas que o código já trata

1. **Valores em REAIS, não centavos.** `"value": 149.90`, ao contrário de
   Stripe/Pagar.me. Os planos guardam `price_cents` e são divididos por 100.
   Errar isso cobra 100× o valor.
2. **`dueDate` no passado é rejeitado.** O piso é sempre amanhã
   (`minimumDueDate()`), e não "hoje": o Asaas usa horário de Brasília e o
   servidor pode estar em UTC.
3. **CPF/CNPJ, telefone e CEP só com dígitos** (`onlyDigits`). O formulário
   entrega `(11) 99999-8888`.
4. **`expiryYear` do cartão tem 4 dígitos** (`"2030"`). O formulário coleta
   `MM/AA`.
5. **`remoteIp` é obrigatório na cobrança de cartão.** Sem ele o antifraude
   recusa. Resolvido com o helper `clientIp` (que já trata Cloudflare/proxy).
6. **Atualizar assinatura é `POST /subscriptions/{id}`**, não PUT nem PATCH.
7. **Não existe webhook de assinatura.** Todo o ciclo recorrente chega como
   eventos de *cobrança*, com `payment.subscription` apontando de volta.

---

## 6. Configuração

### Ambiente (`backend/.env`)

```bash
ASAAS_BASE_URL=https://api-sandbox.asaas.com/v3   # produção: https://api.asaas.com/v3
ASAAS_API_KEY=                # chave da conta da Monitence
ASAAS_WEBHOOK_TOKEN=          # obrigatório junto da chave
ASAAS_VAULT_KEY=              # cifra o cofre das clínicas
PUBLIC_API_URL=https://seu-dominio.com   # SEM /api no final
```

Gere os segredos com:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Guardas de boot (`backend/src/config/index.js`) — os três comportamentos abaixo
foram **verificados executando o boot** com cada combinação:

| Cenário | Efeito |
| --- | --- |
| `ASAAS_API_KEY` sem `ASAAS_WEBHOOK_TOKEN`, em produção | **derruba o boot** |
| `ASAAS_BASE_URL=https://api.asaas.com/v3`, em produção | silêncio (correto) |
| `ASAAS_BASE_URL` contendo `sandbox` (ou ausente), em produção | **aviso alto** |
| `PUBLIC_API_URL` ausente, em produção | aviso |

O par chave+token é indivisível: sem o token, o webhook seria uma rota pública
capaz de marcar assinatura como paga. Já o sandbox só avisa, sem derrubar,
porque homologação em produção é caso legítimo.

> **Limite conhecido da guarda de sandbox:** ela testa `includes("sandbox")`, ou
> seja, só reconhece o *engano típico*. Uma URL simplesmente errada
> (`https://api.asaas.com.br/v3`, um proxy interno, um domínio com typo) passa
> calada — o boot só descobre na primeira cobrança recusada. A guarda estrita
> seria comparar com a URL de produção. O pipeline cobre parte disso: o job
> `guard` do workflow avisa quando há `ASAAS_API_KEY` e `ASAAS_BASE_URL` não é
> exatamente `https://api.asaas.com/v3`.

> **`ASAAS_VAULT_KEY` não tem guarda nenhuma.** Ausente, o cofre das clínicas
> deriva do `AUTH_SECRET` e uma rotação futura desse segredo torna ilegíveis
> todas as chaves guardadas — sem aviso no boot e sem erro até a primeira
> cobrança falhar. Trate como obrigatória em produção.

### Produção (pipeline)

Os segredos são **secrets do GitHub Actions** e o `scripts/deploy.sh` faz upsert
deles no `.env` **do servidor** (o rsync exclui `.env` de propósito, para o
repositório nunca virar fonte de credencial).

Configure em *Settings > Secrets and variables > Actions*:

- em **Variables**: `ASAAS_BASE_URL`;
- em **Secrets**: `ASAAS_API_KEY`, `ASAAS_WEBHOOK_TOKEN` e `ASAAS_VAULT_KEY`.

O mesmo laço da etapa `[3.5/5]` sincroniza também os segredos do **Cloudflare
R2** (`R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
`R2_BUCKET_PUBLIC`, `R2_BUCKET_PRIVATE`, `R2_PUBLIC_BASE_URL`) — mesma
mecânica, mesma regra conservadora. Ver `backend/.env.example`.

O upsert é **conservador**: secret vazio ou ausente é *pulado*, nunca escrito.
Rodar o deploy sem os secrets configurados não apaga uma chave que já está em
produção e funcionando. O corolário incômodo é o oposto: **não existe como
apagar uma variável pelo pipeline** — para remover uma chave do servidor é
preciso editar o `.env` dele à mão.

Os valores são gravados entre aspas simples: isso é necessário porque a chave
de produção do Asaas começa com `$`, que o Docker Compose interpolaria e
transformaria em valor vazio se estivesse sem aspas.

### Checklist de virada para produção

A ordem importa: os passos 1–3 preparam, o 4 vira a chave e os 5–7 provam que
virou.

**1. Conta do Asaas (Monitence).** Conta aprovada (`status: APPROVED` em
`GET /myAccount`) e com dados bancários cadastrados — sem eles o dinheiro entra
no saldo Asaas e não sai de lá.

**2. Gerar a chave de produção.** Painel do Asaas > *Integrações > API*, com a
conta em modo **produção** (a chave de produção começa com `$aact_prod_`; a de
sandbox, não). Ela é mostrada **uma única vez**.

**3. Cadastrar a variável e os secrets** em *Settings > Secrets and variables > Actions*:

| Tipo | Nome | Valor |
| --- | --- | --- |
| Variable | `ASAAS_BASE_URL` | `https://api.asaas.com/v3` — **é este o passo que vira a chave** |
| Secret | `ASAAS_API_KEY` | a chave de produção do passo 2 |
| Secret | `ASAAS_WEBHOOK_TOKEN` | valor forte gerado por você (o mesmo do passo 5) |
| Secret | `ASAAS_VAULT_KEY` | valor forte gerado por você, **antes** de qualquer clínica cadastrar chave |

`ASAAS_BASE_URL` não é opcional: o default do código é o **sandbox**, então
deixar a variável vazia publica a produção cobrando de mentira.

`ASAAS_VAULT_KEY` precisa ser definida **antes** de a primeira clínica salvar a
chave dela. Introduzi-la depois muda a derivação e invalida tudo que já estava
no cofre.

**4. Rodar o deploy** (push na `main`, ou *Actions > Run workflow*). O job
`guard` avisa se a `ASAAS_BASE_URL` não for a de produção e falha se houver
chave sem token. Depois, confira no log do container que **não** apareceu
`[Asaas] ATENÇÃO: rodando em produção apontando para o SANDBOX`.

**5. Cadastrar o webhook da plataforma** no painel do Asaas (ver abaixo). Sem
este passo o checkout funciona, o cliente paga — e a fatura fica eternamente
"pendente", porque quem a baixa é o webhook.

**6. Conferir depois do deploy:**

- `GET /api/health` respondendo `{"ok":true}`.
- Painel do Asaas > *Integrações > Webhooks*: fila **ativa**, sem entregas
  falhadas acumuladas. Fila pausada congela a confirmação de **todas** as
  cobranças da conta.
- Uma assinatura de teste com valor baixo, paga por PIX, aparecendo como paga em
  `GET /api/platform/invoices` sem intervenção manual.
- `platform.webhook_events` com linhas chegando (é a prova de que o token bate;
  token errado devolve 401 e não grava nada).

**7. Se algo não baixar:** `POST /api/platform/invoices/:id/sync` relê a cobrança
no gateway e reaplica o efeito. Se for preciso usar isso com frequência, o
problema está no webhook, não na fatura.

### Painel do Asaas (plataforma)

*Integrações > Webhooks > Adicionar*:

- **Nome:** `Aura Clinic — plataforma`
- **URL:** `https://auraclinic.monitence.com/api/webhooks/asaas`
  (é `PUBLIC_API_URL` + `/api/webhooks/asaas`; a `PUBLIC_API_URL` vem do
  `SITE_URL` do workflow, **sem** `/api` no final — o caminho já traz o dele)
- **E-mail:** um endereço monitorado; é para lá que o Asaas escreve quando
  **pausa a fila**
- **Versão:** v3
- **Token de autenticação:** exatamente o valor de `ASAAS_WEBHOOK_TOKEN`
- **Tipo de envio:** sequencial
- **Eventos:** os de cobrança (`PAYMENT_*`). Basta os tratados —
  `PAYMENT_CREATED`, `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`,
  `PAYMENT_RECEIVED_IN_CASH`, `PAYMENT_APPROVED_BY_RISK_ANALYSIS`,
  `PAYMENT_OVERDUE`, `PAYMENT_DELETED`, `PAYMENT_REFUNDED`,
  `PAYMENT_CHARGEBACK_REQUESTED`, `PAYMENT_REPROVED_BY_RISK_ANALYSIS` — mas
  marcar todos é seguro: o que não é tratado vira no-op com 200.

Não existe evento de assinatura: o ciclo recorrente inteiro chega como evento de
**cobrança** (§5, item 7).

### Painel do Asaas (cada clínica)

A clínica faz isso sozinha, pela tela **Integrações** do painel dela:

1. Cola a chave da API da própria conta Asaas.
2. Clica em **Gerar token** e copia o valor (aparece **uma única vez**).
3. Copia a URL de webhook que a tela mostra
   (`https://seu-dominio.com/api/webhooks/asaas/<slug>`).
4. Cadastra os dois no painel do Asaas dela.
5. Testa a conexão e ativa a cobrança online.

---

## 7. Sandbox

Base: `https://api-sandbox.asaas.com/v3`.

Para receber webhooks em desenvolvimento local é preciso expor a API por um
túnel (`cloudflared`, `ngrok`) e cadastrar a URL no painel. A URL muda a cada
reinício do túnel — dor conhecida, sem solução elegante.

---

## 8. Mapa dos arquivos

| Arquivo | Papel |
| --- | --- |
| `backend/src/services/asaas/client.js` | Único ponto que fala HTTP com o Asaas |
| `backend/src/services/asaas/vault.js` | Cifra/decifra credenciais (AES-256-GCM) |
| `backend/src/services/asaas/credentials.js` | Resolve qual chave usar por escopo |
| `backend/src/services/asaas/events.js` | Traduz eventos e garante idempotência |
| `backend/src/routes/webhooks.js` | As duas rotas de webhook |
| `backend/src/routes/integrations.js` | API do cofre (tela de ajustes da clínica) |
| `backend/src/services/platformBilling.js` | Monitence cobra as clínicas |
| `backend/src/services/tenantCharges.js` | Clínica cobra o cliente final |
| `backend/src/routes/billing.js` | Assinatura e faturas |
| `backend/src/db/tenantSession.js` | Acesso ao schema da clínica fora do ciclo de requisição |
| `backend/tests/asaas.test.mjs` | Testes de segurança e idempotência |
