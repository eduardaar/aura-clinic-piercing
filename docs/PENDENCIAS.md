# Pendências

Levantado em 28/07/2026, ao fim da rodada de fundação (commits `3a8ea61`..`96f05d2`).
Cada item traz onde está e o que se sabe — não é lista de desejos, é o que foi
encontrado e conscientemente adiado.

---

## Bugs

### 1. Venda aceita quantidade que não existe em estoque
A validação de estoque na linha de venda só roda para produto **com variação**:
`line.item_type === "produto" && variant && quantity > variant.quantity`. Produto
sem variação não passa por checagem nenhuma, e `backend/src/services/sales.js`
usa `Math.max(0, ...)` em vez de rejeitar. Vender 50 unidades de um produto com
3 em estoque funciona: a venda é registrada e o saldo vai a zero.

Achado em `frontend/src/features/sales/Sales.jsx` ao investigar a variável morta
`availableQuantity`, que era resto de uma validação que nunca chegou a ser
exibida.

### 2. "Atendido" é irreversível na prática
Marcar um agendamento como atendido dispara cinco efeitos: baixa de estoque,
pagamento do restante, ordem de serviço, pós-atendimento e pontos de fidelidade.
Voltar o status para `pendente` **não desfaz nenhum deles**. Marcar por engano
hoje exige limpeza direta no banco.

### 3. Busca de joias não acha acento
O filtro `search` de `GET /api/jewelry` usa `LIKE` sensível a caixa e acento:
`?search=titanio` devolve zero, porque o dado é "Titânio". Os filtros de busca
criados depois (clientes, agendamentos, vendas) usam `ILIKE` e não têm o
problema. Corrigir exige `ILIKE` + normalização, ou `pg_trgm` com índice GIN.

---

## Funcionalidade inacabada

### 4. Modo "virtual" do estoque nunca foi ligado
`inventoryMode` está congelado em `"internal"` porque `setInventoryMode` não é
chamado em lugar nenhum. Isso deixa inalcançável todo o ramo `"virtual"` de
`filteredItems`, os cinco filtros de `badgeTab` (lançamentos, promoções, mais
desejados, últimas unidades, destaques) e o filtro por `is_catalog_active`.

O que falta é só o controle na interface: o CSS dele (`.inventory-mode-switch`,
`.inventory-badge-tabs`, com estados `.active`) existe desde o primeiro commit e
nunca apareceu em nenhum JSX. A lógica e o estilo foram construídos, o botão não.

### 5. Funil de CRM e mapa corporal não têm tela própria
Sobreviveram em `GET /api/erp` quando o conteúdo fictício saiu, e **não são
calculados em nenhum outro lugar do sistema**: o funil (Lead / Cliente /
recorrente / VIP, por contagem de atendimentos) e o mapa corporal (as 8 regiões
mais perfuradas).

Lugar natural: dois tipos novos em `buildReport` (`backend/src/services/reports.js`),
o que lhes daria a tela de Relatórios e a exportação PDF/XLSX/CSV de graça.

### 6. Monitor de erros sem interface
`GET /api/error-logs` e a tabela `error_logs` seguem no ar, e
`lib/errorReporter.js` continua enviando relatos. Mas a tela foi removida do app
da clínica (expunha stack traces e caminhos do servidor), então **ninguém tem
como ler**. O lugar certo é o painel `/plataforma`.

---

## Segurança

### 7. Uploads sem separação por clínica
Comprovantes de pagamento e PDFs de termo — arquivos sensíveis — vão para um
diretório compartilhado entre todos os tenants. Pendência antiga, agravada pelo
volume atual.

### 8. Sem lugar seguro para credencial por clínica — RESOLVIDO
~~Pré-requisito da integração com gateway de pagamento.~~

Resolvido pela tabela `tenant_integrations`, no schema de cada clínica, com os
segredos cifrados em AES-256-GCM (`backend/src/services/asaas/vault.js`). Tabela
dedicada justamente por causa do problema apontado aqui: `catalog_settings` vaza
inteira em `GET /api/catalog`. Ver `docs/ASAAS.md`.

Fica em aberto o caso geral: hoje o cofre atende **um provedor por clínica**
(`UNIQUE(provider)` permite vários, mas só o Asaas é lido). Outras credenciais
(WhatsApp oficial, e-mail transacional) ainda não têm onde morar — o caminho
natural é reusar esta tabela.

---

## Dívida técnica

### 9. Ampliar o `checkJs` às telas
Os typedefs do `DataView` só rejeitam coluna mal definida quando o arquivo que
**chama** entra no escopo. Hoje valem no editor; a CI não valida nenhum call
site. Ordem sugerida: `features/shared/` → telas que mais usam `DataView` →
`backend/src/services/` → `backend/src/routes/`. Só depois ligar
`strictNullChecks`.

Falta também acrescentar `npm run typecheck` ao workflow do GitHub Actions —
adiado para não colocar verificação bloqueante nova junto com um deploy grande.

### 10. Formatação em massa com Biome
`npm run format:all` mudaria **21.847 linhas em 135 arquivos**. Deve ser um
commit isolado, sem nenhuma mudança lógica junto, com o hash registrado em
`.git-blame-ignore-revs` (senão o `git blame` de 21 mil linhas passa a apontar
para ele e a arqueologia do código morre). Considerar fatiar: backend primeiro,
depois frontend, deixando os quatro arquivos gigantes por último.

Só depois disso adicionar `npm run check` à CI — antes, ela reprovaria em 135
arquivos.

### 11. Roteamento por URL
`react-router-dom` está instalado e nunca foi ativado. Nenhuma tela interna tem
URL: não dá para mandar link de "Vendas" para um colega, o botão voltar do
navegador sai do sistema, e não há como abrir duas telas em abas.

Adiado de propósito: mexeria na navegação de todas as ~30 telas e no `main.jsx`
junto com um deploy já grande.

### 12. Os 147 achados de lint
`npm run lint`. Nenhum nas categorias clássicas de bug. O grosso: 58
`useExhaustiveDependencies` (44 são dependência faltando — candidatas reais a
stale closure, mas mexer em array de deps muda comportamento), 55
`noUnusedImports` (26 são `import React`, inofensivos pelo runtime automático de
JSX) e 11 `noArrayIndexKey`.

### 13. Dinheiro em `DOUBLE PRECISION`
Todos os valores monetários usam ponto flutuante; somatórios financeiros
acumulam erro. Migrar para `NUMERIC(12,2)`. Ver `docs/AUDIT-DATA-MODEL.md`.

---

## Interface

### 14. Tabelas em coluna estreita
Termos digitais (~395px) e Cupons/Promoções (~600px) ficam num layout de duas
colunas: a tabela respeita o `min-width: 720px` global e rola horizontalmente
dentro do painel. Não vaza, mas em Termos só duas colunas aparecem sem rolar.
Resolver exige mexer no layout de duas colunas dessas telas.

### 15. Enum em inglês na tela de Lançamentos
As colunas Tipo e Status de `AdvancedFinance` exibem o valor cru
(`receivable`, `pending`). Foram traduzidas só nos rótulos do filtro, para não
alterar dado exibido além do combinado na época. Relatórios já resolveu o mesmo
problema com um mapa de tradução — vale reaproveitar.

### 16. Dashboards dentro das listagens
Decisão pendente: Vendas, Financeiro e Clientes abrem com blocos de indicadores
antes da lista, duplicando o que já existe no Dashboard. A proposta era deixar
2–3 números por tela e mover a parte analítica para abas no Dashboard — ou para
Relatórios, que já tem filtro de data livre e exportação. **Não decidido.**

### 17. Resíduos em `permissions.js`
O comentário sobre o `erp.js` exibir conteúdo fictício não vale mais (o conteúdo
foi removido), e `pageTitle()` ainda mapeia `erp` e `error-logs`, que hoje são
chaves inalcançáveis.

---

## Produto

### 18. Integração com o Asaas — IMPLEMENTADA (com arestas)
Cofre de credenciais por clínica, webhook multi-tenant, cobrança de assinatura
(Monitence → clínicas) e cobrança da clínica ao cliente final estão no ar. Ver
`docs/ASAAS.md`.

O bloqueio do **CNPJ da conta raiz deixou de existir**: em vez de subcontas,
cada clínica usa a própria conta Asaas e recebe direto. Não há split nem
intermediação de recebíveis.

**Resolvido na segunda rodada:** as rotas foram ligadas (o agendamento público e
a venda do catálogo geram cobrança online quando a clínica tem gateway),
`GET /api/payment-intents/:id/pix` e `POST /api/payment-intents/:id/sync` estão
no ar, a venda paga por webhook agora **baixa estoque**, a idempotência do
checkout virou `platform.idempotency_keys` (vale entre instâncias) e existe
worker de conciliação (`ASAAS_RECONCILE_ENABLED`).

O conflito entre a reserva de 30 min e o boleto de 2 dias foi resolvido por
desenho: **cobrança que prende estoque físico é PIX com janela de 30 min**
(`chargeModeForStock`, em `tenantCharges.js`), casando exatamente com a validade
da reserva. Segurar joia por dois dias contra um boleto — ou liberar a peça
antes de ele vencer — eram as duas alternativas, e nenhuma é aceitável.

O que continua aberto:

**18.1 — O agendamento público não coleta CPF.** O checkout do catálogo coleta
(e agora propaga para `clients.tax_id`), mas o formulário de agendamento não.
Sem CPF o Asaas recusa criar o pagador, então o sinal online **degrada para o
caminho manual** (comprovante por WhatsApp). O backend já aceita `cpf`/`email`
no corpo: falta só o campo na tela. É o que separa o fluxo do sinal de funcionar
ponta a ponta.

**18.2 — `PATCH /api/sales-orders/:id` continua sem baixar estoque.** A lacuna
foi fechada no caminho do webhook, não no manual. Marcar um pedido como pago
pela tela ainda não decrementa `jewelry_inventory.quantity`. Pendência antiga,
anterior ao gateway.

**18.3 — Estorno não reverte o atendimento.** No fluxo da plataforma,
estorno/chargeback reverte a fatura e põe a assinatura em `overdue`. No fluxo da
clínica, o intent vira `refunded` e libera as reservas, mas nada desfaz um
atendimento já prestado.

**18.4 — Pagamento que chega depois do prazo.** Se o PIX cair após o
`expires_at` (reserva já liberada), o código confirma o pagamento assim mesmo —
o dinheiro entrou — e emite `console.warn` pedindo conferência de estoque. É a
escolha certa (recusar geraria reentrega infinita), mas ninguém é *avisado* na
interface. Deveria virar alerta na central.

**18.5 — Sem `SIGTERM` para o worker.** `stopReconcileWorker()` existe e está
exportada, mas o `index.js` não tem handler de encerramento. O `unref()` já
impede que o timer segure o processo; falta o desligamento gracioso.

---

## Painel da plataforma (rodada de 01/08/2026)

Planos editáveis, cotas, controle de contas, financeiro e suporte entraram.
Ver `docs/PAINEL-PLATAFORMA.md`. O que ficou aberto:

### 19. Trocar de plano não reajusta a cobrança no Asaas
A troca muda o acesso da clínica **na hora**, mas a assinatura recorrente no
gateway continua com o valor do plano antigo. A rota devolve `warning` quando
existe `asaas_subscription_id`, e a tela exibe — mas ninguém age.

É a lacuna mais cara desta rodada: uma clínica promovida para um plano mais caro
continua pagando o barato até alguém notar. O conserto exige refazer o checkout
ou chamar `updateSubscription` no gateway; ficou de fora por mexer em cobrança.

### 20. Os guards de cota não estão ligados em nenhuma rota
`requireWithinLimit` existe, é testado e funciona — mas nenhuma rota o chama, e
nenhum plano tem `limits` configurado. O sistema é inerte por construção até
alguém definir limites no painel.

Ordem sugerida de ativação (do mais barato ao mais caro de medir): `users` em
`routes/users.js`, `clients` em `routes/clients.js`, `jewelry_items` em
`routes/jewelry.js`, `appointments_month` em `routes/appointments.js`.

**Cuidado com `routes/booking.js`** (agendamento público): ali o 409 apareceria
para o *cliente final* da clínica, que não tem como resolver. Ou o público passa
livre, ou a mensagem precisa ser outra.

### 21. `storage_mb` é estimativa, não medida
Os uploads vão para um diretório único, sem prefixo de tenant e sem coluna de
bytes. A conta é "arquivos referenciados × média por tipo" e subestima galerias.
Serve como alerta, **não como bloqueio**. Vira número real com uma coluna de
bytes em `private_files`/`jewelry_inventory`.

### 22. Churn e cancelamentos dependem de histórico que não existe
`churn_mes` vem `null` de propósito: `tenant_subscriptions` guarda uma linha por
clínica com o status *atual*, sem log de mudanças, então a base de assinantes no
1º do mês não é reconstruível. Assumir que todo ativo de hoje já estava lá
inflaria o divisor justamente nos meses de crescimento.

`cancelamentos_mes` fica em 0 até o fluxo de cancelamento carimbar `canceled_at`.

Para os dois virarem número: (a) gravar `canceled_at` no cancelamento e (b) um
log `(assinatura, data, de, para)`.

### 23. Uso em massa não invalida o cache de cotas
Importação de joias e exclusões em lote não chamam `invalidateUsageCache`. A
janela é de 15s e o cache só é confiado com folga abaixo de 90% da cota, então o
efeito é pequeno — mas o gancho existe e não está plugado.

### 24. A propagação de preço nunca foi exercida contra o Asaas real
Sem `ASAAS_API_KEY` no ambiente de teste, o caminho coberto é o de gateway
indisponível. O laço de `try/catch` por clínica está testado só na contagem.
Vale um teste manual no sandbox antes do lançamento.

### 25. `.stack` está definida duas vezes em `styles.css`
Linhas 2165 (`display: grid; gap: 18px`) e 5757 (`gap: clamp(...)`), ambas em
`@layer legado`. Dentro da mesma camada vale a ordem do arquivo, então a segunda
vence e o `gap: 18px` da primeira é letra morta.

Não quebra nada hoje, mas é exatamente a duplicata que `docs/PADRAO-VISUAL.md`
pede para não criar — e quem for editar a primeira vai mexer numa regra que não
tem efeito. Consolidar numa só.

### 26. Três decisões de frontend não estão escritas em lugar nenhum
Levantadas ao documentar o padrão visual; nenhuma se responde lendo o código:

- **Quando uma tela monta o próprio `.main-content`.** `/plataforma` monta (tem
  sessão e shell próprios), o app da clínica monta no `main.jsx`, as telas
  públicas não montam. Não há regra para decidir o caso novo.
- **O destino da camada `legado`.** O cabeçalho do `styles.css` fala em "quatro
  gerações", mas não há critério nem plano de migração.
- **Quando `mode="server"` do `DataView` passa a ser obrigatório.** Os dois modos
  estão documentados e `client` é chamado de "caminho de migração", mas não há
  limiar (nº de linhas, peso da resposta) que obrigue a troca.

### 27. Cor `#6d5e52` repetida sem token
Aparece crua em `.field-hint`, `.platform-metric .label` e `.platform-fact dt`.
É o cinza-texto secundário do painel e deveria ser uma variável no `:root`,
junto de `--line`, `--white` e `--muted`.
