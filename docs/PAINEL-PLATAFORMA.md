# Painel da plataforma

O que o super-admin da Monitence controla em `/plataforma`: planos, contas das
clínicas, financeiro, suporte e a landing pública.

---

## 1. Planos: o banco virou a fonte da verdade

Até esta rodada, `services/plans.js` era a fonte da verdade dos planos **de
propósito** — o comentário original dizia que era "para nunca depender de um
seed desatualizado". Para o painel poder editar planos, a fonte passou a ser o
banco (`platform.subscription_plans`).

A troca preservou a garantia antiga através de três decisões:

1. **Registro em memória**, carregado no boot e recarregado a cada escrita.
   `planByCode()` continua **síncrono** — ele é usado em seis arquivos, e
   torná-lo `async` espalharia `await` pelo projeto inteiro sem ganho.
2. **Falha de leitura mantém os planos do código.** Lista vazia significaria
   "nenhuma clínica tem feature nenhuma" — todas trancadas fora do sistema de
   uma vez, por uma indisponibilidade momentânea.
3. **O catálogo continua sendo código.** `FEATURE_CATALOG` e `LIMIT_CATALOG` só
   existem em `plans.js`, porque cada feature corresponde a uma rota realmente
   protegida por `withFeature`. Uma feature inventada no painel não protegeria
   nada e daria a impressão falsa de ter liberado algo.

### Dois problemas que a inversão revelou

Ambos teriam causado estrago silencioso em produção:

- **O seed divergia do código.** `visual_search` estava no plano premium em
  `plans.js` mas faltava no `platformSchema.sql`. Como o código mandava, as
  clínicas premium *tinham* a feature; inverter sem reparar a removeria sem
  ninguém notar. Há um `UPDATE` idempotente de reparo no schema.
- **O seed usava `ON CONFLICT DO UPDATE`.** Todo boot reescrevia nome, preço e
  features a partir do código. Inofensivo enquanto o código mandava; com o
  painel editável, **cada deploy desfaria as edições**. Agora é `DO NOTHING`.

### Regras do CRUD

- **Excluir plano com assinante é proibido** (409). O caminho é **desativar**:
  some da vitrine e do cadastro, preserva quem já assina.
- **Não é possível desativar o último plano ativo** — a vitrine ficaria vazia e
  o registro cairia de volta nos planos-semente.
- **Mudar preço com assinantes exige confirmação explícita.** Um erro de
  digitação recobraria todo mundo errado.
- **A propagação para o Asaas é best-effort, uma clínica por vez**, e a resposta
  diz quantas falharam. Saber que 3 de 40 não pegaram é o que importa.
- O uso de um plano conta **as duas referências**: a FK
  `tenant_subscriptions.plan_code` e a coluna espelho `tenants.plan`. Olhando só
  a FK, excluir deixaria `tenants.plan` órfão e `normalizePlanCode()` cairia no
  padrão — a clínica ganharia features que ninguém liberou.

### Vitrine x painel

`GET /api/plans` (landing e cadastro) devolve **apenas planos ativos**. O painel
vê todos, senão não haveria como reativar. O cadastro público **recusa** um
plano desativado enviado na mão; a rota do super-admin **aceita**, de propósito
— é como se honra um contrato antigo.

---

## 2. Cotas (limites por plano)

`services/planLimits.js`. Cinco cotas: usuários, clientes, agendamentos/mês,
itens de estoque e armazenamento. **Ausente ou `null` = ilimitado.**

Três garantias, todas deliberadas:

- **Cota atingida NUNCA apaga nem esconde dado.** Ela impede *criar* mais. Uma
  clínica que baixou de plano e está acima da cota continua enxergando e
  editando tudo que já tem. O contrário seria destruir dado de cliente pagante.
- **Falha de medição libera.** Bloquear uma clínica pagante por um bug nosso de
  contagem é pior que deixar passar um registro a mais.
- **Plano sem aquela cota não faz consulta nenhuma** — `limit === null` sai
  antes de medir. Como nenhum plano tem limites hoje, o guard é inerte por
  construção; ele só passa a existir quando alguém definir limites no painel.

Cache de 15s por (clínica, cota), **só confiado com folga abaixo de 90%** da
cota: perto do teto sempre mede fresco.

`storage_mb` é **aproximado** e marcado como tal (`approximate: true`): os
uploads vão para um diretório único, sem prefixo de tenant e sem coluna de
bytes. Não use como bloqueio — sirva como alerta.

---

## 3. Contas

`/api/platform/accounts/*`. Trocar plano, suspender/reativar, mexer no trial,
forçar status da assinatura, cancelar no gateway.

**Motivo é obrigatório em toda escrita**, e cada uma grava `platform.admin_audit`
**na mesma transação** da mudança — se a auditoria falha, a mudança é desfeita.
Estas ações cortam acesso e mexem em dinheiro; quando alguém perguntar "por que
esta clínica caiu de plano?", a resposta precisa estar gravada.

### Três assimetrias deliberadas

| Ação | O que ela **não** faz |
| --- | --- |
| Suspender a conta | não cancela a assinatura no Asaas |
| Cancelar a assinatura | não suspende a conta (a clínica usa o período pago) |
| Trocar de plano | não reajusta a cobrança recorrente no Asaas |

A terceira é a mais perigosa: o acesso muda na hora, mas o gateway continua
cobrando o valor antigo. A rota devolve `warning` quando existe
`asaas_subscription_id`. **Ainda em aberto** (ver `docs/PENDENCIAS.md`).

---

## 4. Financeiro

`/api/platform/finance/*`: resumo, inadimplência, vencimentos, série mensal e
receita por plano.

- **Dinheiro só em `NUMERIC`**, somado no Postgres. Cada valor sai em dois
  campos: string decimal (`"189.80"`) e centavos inteiros. Nenhum `Number`
  participa de conta de dinheiro — a pendência 13 (dinheiro em
  `DOUBLE PRECISION`) não foi ampliada.
- **Fuso `America/Sao_Paulo`, aplicado no SQL**, nunca com o relógio do Node.
  `?data_base=AAAA-MM-DD` congela o "hoje" — é o que torna o fechamento
  conferível e os testes independentes do dia em que rodam.
- **"Vencido" é por FATO, não por status**: `due_date < hoje AND status IN
  ('pendente','atrasada')`. O status só vira `atrasada` quando o webhook chega —
  e o painel de cobrança é justamente onde o webhook perdido precisa aparecer.

### O que NÃO é calculado, e por quê

- **`churn_mes` vem `null`.** Não existe log de mudanças de status, então a base
  de assinantes no 1º do mês não é reconstruível. Assumir que todo ativo de hoje
  já estava lá inflaria o divisor exatamente nos meses de crescimento. Preferimos
  `null` com o motivo em `notas` a um número errado numa reunião.
- **`cancelamentos_mes` fica em 0** até o fluxo de cancelamento carimbar
  `canceled_at`.
- **`mrr_estimado` é projeção** pelo preço de tabela — desconto e cortesia não
  existem no modelo de dados. Nunca confundir com `recebido_mes`, que é caixa.

---

## 5. Suporte

`platform.support_tickets` + `platform.support_messages`. A clínica abre, o
super-admin responde.

- **Isolamento**: toda leitura da clínica filtra por `tenant_id` no `WHERE` — não
  existe "buscar por id e conferir o dono depois". Chamado alheio e chamado
  inexistente devolvem o **mesmo 404**; um 403 confirmaria que o id existe.
- **Nota interna** do suporte é filtrada na camada de serviço, na única função
  que a clínica usa para ler a conversa — não na rota, para não depender de
  alguém lembrar de filtrar. O banco ainda impede, por `CHECK`, que uma nota
  interna seja atribuída à clínica.
- **O suporte não fica atrás do plano.** Trancar o atendimento por feature
  impediria justamente quem tem problema de cobrança de falar com a Monitence.
- Teto de **10 chamados abertos** por clínica: teto de estoque, não de
  frequência — quem abre três numa manhã ruim não é punido, e a vaga volta
  quando um chamado é fechado.
- **A prioridade é do suporte**, nunca da clínica: senão tudo vira "alta".

---

## 6. Auditoria

`platform.admin_audit` guarda quem fez, o quê, em quem, e o antes/depois.
Alimentada pelas ações de plano e de conta.

---

## 7. Mapa dos arquivos

| Arquivo | Papel |
| --- | --- |
| `backend/src/services/plans.js` | Registro vivo, catálogo de features e limites |
| `backend/src/services/planAdmin.js` | CRUD de planos + propagação de preço |
| `backend/src/services/accountAdmin.js` | Ações do super-admin sobre contas |
| `backend/src/services/planLimits.js` | Medição e aplicação das cotas |
| `backend/src/services/platformFinance.js` | Análise financeira (só leitura) |
| `backend/src/services/support.js` | Chamados e mensagens |
| `frontend/src/features/platform/PlansAdmin.jsx` | Tela de planos |
| `frontend/src/features/platform/AccountsAdmin.jsx` | Tela de contas |
| `frontend/src/features/platform/FinanceAdmin.jsx` | Tela do financeiro |
| `frontend/src/features/platform/SupportInbox.jsx` | Caixa de entrada do suporte |
| `frontend/src/features/support/Support.jsx` | Tela de suporte da clínica |
