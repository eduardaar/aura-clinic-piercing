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

Isso é uma decisão, não uma limitação aceita por preguiça: o modelo de
subcontas do Asaas exigiria que a conta raiz da Monitence fosse CNPJ — uma
pendência que estava travando a integração inteira (ver `docs/PENDENCIAS.md`,
item 18). Com cada clínica usando a própria conta, o bloqueio deixa de existir
e a clínica recebe direto, sem intermediação de recebíveis.

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

Guardas de boot (`backend/src/config/index.js`):

- `ASAAS_API_KEY` sem `ASAAS_WEBHOOK_TOKEN` em produção → **derruba o boot**. O
  par é indivisível: sem o token, o webhook seria uma rota pública capaz de
  marcar assinatura como paga.
- Sandbox em produção → **aviso alto**, sem derrubar (pode ser homologação
  intencional).
- `PUBLIC_API_URL` ausente em produção → **aviso**: a URL entregue às clínicas
  apontaria para `localhost` e nenhuma confirmação de pagamento chegaria.

### Produção (pipeline)

Os segredos são **secrets do GitHub Actions** e o `scripts/deploy.sh` faz upsert
deles no `.env` **do servidor** (o rsync exclui `.env` de propósito, para o
repositório nunca virar fonte de credencial).

Configure em *Settings > Secrets and variables > Actions*:
`ASAAS_BASE_URL`, `ASAAS_API_KEY`, `ASAAS_WEBHOOK_TOKEN`, `ASAAS_VAULT_KEY`.

O upsert é **conservador**: secret vazio ou ausente é *pulado*, nunca escrito.
Rodar o deploy sem os secrets configurados não apaga uma chave que já está em
produção e funcionando.

### Painel do Asaas (plataforma)

*Integrações > Webhooks > Adicionar*:

- URL: `https://seu-dominio.com/api/webhooks/asaas`
- Token de autenticação: o mesmo valor de `ASAAS_WEBHOOK_TOKEN`
- Eventos: os de cobrança (`PAYMENT_*`)

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
