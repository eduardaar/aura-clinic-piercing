# Relatório de homologação crítica — 27/08/2026

## Veredito

**Aprovado no escopo local homologado após as correções.**

A base principal dos fluxos está coerente: criação isolada de clínica, permissões, compras, contas a pagar, agenda, consumo automático, ordem de serviço, contas a receber, créditos, cancelamentos, reembolsos, catálogo, agendamento público, relatórios, suporte e privacidade funcionaram no cenário executado. As falhas F-01 a F-07 descritas abaixo foram corrigidas e retestadas. Cobranças e mensagens reais continuam fora deste aceite local.

## Ambiente e evidência

- Base revisada: `e00464d2` mais as correções ainda não commitadas desta homologação.
- Backend local: `http://localhost:4000` saudável.
- Frontend local: `http://localhost:5174`.
- Banco: PostgreSQL local, tenant com migrations `0001` a `0016`, sem pendência.
- Clínica final preservada para conferência visual: `qa-estudio-aurora-mtb5xqzt`.
- Administrador: `qa.admin.mtb5xqzt@aurora-teste.local`.
- Senha não é armazenada neste documento; foi entregue separadamente ao responsável.
- Automação executada: `backend/scripts/qa-homologation-critical.mjs`.

O tenant anterior `qa-estudio-aurora-mtb4u9e9` preserva a reprodução histórica das falhas. O tenant final acima foi criado do zero depois dos ajustes e terminou sem saldo negativo, sem movimento excessivo e sem lotes acima do saldo.

## Resultado quantitativo

| Camada | Resultado |
| --- | --- |
| Homologação HTTP + conciliação SQL final | 123/123 aprovados |
| Invariância de lotes | aprovada: excesso recusado, baixa FEFO e soma dos lotes <= saldo |
| Frontend unitário | 33/33 aprovados |
| Frontend componentes | 103/103 aprovados em 14 arquivos |
| Build frontend | aprovado; 1.793 módulos transformados |
| Backend — compras e parcelamentos | 13/13 aprovados nos arquivos isolados |
| Backend — storage e imagens | aprovado, inclusive PNG grande convertido para WebP |
| Backend — regressões críticas + transações | 24/24 aprovados |
| Backend — fluxo histórico | 31/31 aprovados |
| Backend — migrations/compras/parcelamentos | 23/23 aprovados |
| Suíte backend global final | 539/539 aprovados em 97 s |

## Falhas encontradas e corrigidas

### F-01 — devolução parcial vira devolução total

**Severidade: crítica.**

**Status: corrigida e coberta por regressão.** A quantidade solicitada agora prevalece sobre a quantidade original do item; o reteste devolveu uma de duas unidades, repôs uma unidade e gerou R$ 60 de crédito.

Venda criada com duas unidades a R$ 60 cada. A API recebeu devolução de uma unidade. O resultado gravado foi:

- quantidade devolvida: 2;
- estoque reposto: 2;
- crédito do cliente: R$ 120;
- quantidade ainda devolvível: zero.

A origem está em `backend/src/services/salesReturns.js`: ao combinar o pedido normalizado com o item vendido, `...item` sobrescreve `requested.quantity`. O mesmo problema pode inflar crédito ou reembolso e corromper o estoque.

**Correção esperada:** preservar explicitamente a quantidade solicitada após anexar os dados da venda, testar devolução parcial, concorrente, múltiplos itens, danificado e descartado.

### F-02 — saída manual acima do estoque é aceita

**Severidade: alta.**

**Status: corrigida e coberta por regressão.** Saída, venda e perda acima do saldo retornam `409`; lock, movimento, atualização e sincronização agora estão na mesma transação. Movimento no pai atualiza a variação única e exige seleção quando existem várias.

Ao pedir saída manual de 999 unidades sobre saldo menor, a API respondeu `200` e zerou a variação. O movimento fica registrado com a quantidade pedida, embora a baixa física efetiva seja menor. A mesma lógica existe no movimento do produto pai.

Origem: `backend/src/routes/jewelry.js` usa `Math.max(0, saldo + delta)` nos dois endpoints de movimento.

**Correção esperada:** bloquear saída/venda/perda superior ao saldo com `409`, dentro de transação e com lock; nunca gravar movimento maior que a baixa realizada.

### F-03 — soma de lotes pode superar o saldo do material

**Severidade: alta.**

**Status: corrigida e coberta por regressão.** Novo lote sem entrada usa apenas o saldo ainda não classificado. Saída e ajuste para baixo também reduzem lotes por FEFO.

Material com saldo 21 aceitou três lotes de dez unidades sem entrada de estoque. O material continuou com 21, mas os lotes passaram a somar 30.

Origem: `backend/src/routes/consumables.js` compara cada novo lote apenas com o saldo total, sem descontar a quantidade já atribuída a outros lotes.

**Correção esperada:** ao classificar saldo legado, permitir no máximo `saldo atual - soma ainda alocada em lotes`; executar com lock e validar a invariância `soma dos lotes <= saldo`.

### F-04 — ação rápida de cancelamento do frontend usa o contrato antigo

**Severidade: média/alta.**

**Status: corrigida.** A ação rápida incompatível foi removida; cancelamento passa pelo modal e pelo endpoint auditável.

O modal detalhado usa corretamente `POST /appointments/:id/cancel`. Porém, a ação `Cancelar atendimento` da listagem ainda envia `PATCH {status: "cancelado"}`. O backend novo bloqueia esse atalho com `409`, corretamente, pois falta definir retenção, crédito, reembolso ou ausência de pagamento.

Origem: `frontend/src/features/agenda/Agenda.jsx`, ação da listagem de atendimentos.

**Correção esperada:** abrir o mesmo modal de resolução financeira ou remover a ação rápida.

### F-05 — ações financeiras aparecem para perfis que receberão 403

**Severidade: média.**

**Status: corrigida.** Ações e destinos financeiros agora respeitam `appointments.cancel`, `finance.edit`, `sales.edit_closed` e `finance.refund`; sinal pendente não sugere retenção.

Antes da correção, o modal de agenda oferecia crédito e reembolso sem permissão financeira, a lista de vendas não verificava `SALES_EDIT_CLOSED`/`FINANCE_REFUND` e um sinal apenas configurado podia sugerir retenção. Esses caminhos não são mais exibidos para papéis incompatíveis.

O backend protege corretamente as rotas. A falha é de coerência e experiência no frontend.

### F-06 — guia e documentação operacional estão desatualizados

**Severidade: média.**

**Status: corrigida.** O guia e o documento de evolução agora descrevem ficha técnica, FEFO, quatro resoluções de cancelamento e devoluções parciais/danificadas.

Na revisão inicial, o guia ainda declarava como lacunas:

- M-01: consumo automático por ficha técnica;
- M-03: devolução/troca/estorno.

Ambos já estavam implementados, mas a documentação misturava o estado antigo “devolução futura” com o estado atual.

### F-07 — suíte backend não cobre o trabalho novo e não é determinística

**Severidade: alta para manutenção.**

**Status: corrigida no escopo desta rodada.** Foi criado `operationalReversals.test.mjs`, o baseline passou a incluir `0012` a `0016`, contratos antigos foram atualizados e o runner usa superadmin efêmero com encerramento forçado e limpeza final.

Na revisão inicial não havia regressões em `backend/tests` para:

- `appointment_cancellations`;
- `sales_returns` e `sales_return_items`;
- `client_credits` e uso de crédito;
- receitas e lotes de materiais introduzidos nas migrations novas.

Também foram observadas expectativas antigas e dependência da senha mutável do superadmin. Todos os itens abaixo foram tratados nesta rodada:

- `migrations.test.mjs` esperava somente `0001` a `0011`, apesar de existirem `0012` a `0016`;
- testes antigos cancelavam agenda por `PATCH`;
- contagens antigas de vendas não consideravam que ordens da agenda foram ocultadas da listagem padrão;
- algumas expectativas aguardavam erro `500` onde o contrato atual retorna validação `400`;
- a suíte dependia da senha mutável do superadmin da base local;
- uma execução sem encerramento forçado ficou pendurada sem resumo.

## Fluxos aprovados

### Cadastro, isolamento e acesso

- disponibilidade de nome/e-mail antes do aceite;
- signup, login automático e segundo login;
- clínica nova sem dados de outro tenant;
- e-mail ocupado detectado antecipadamente;
- token de uma clínica recusado ao apontar para outra;
- usuário piercer impedido de listar usuários por URL direta.

### Estoque, materiais e compras

- categoria canônica e produto pai com duas variações;
- SKU manual duplicado recusado;
- compra de revenda com entrada na variação e duas contas a pagar;
- repetição da compra idempotente: um movimento e duas parcelas;
- compra de materiais separada dos produtos de venda;
- lotes automáticos por compra;
- custo e saldo de materiais atualizados;
- saída de material acima do saldo recusada;
- ficha técnica do serviço consumiu luva e agulha ao concluir agenda.

### Agenda, serviço e financeiro

- bloqueios removeram horários públicos;
- conflito de profissional/horário recusado;
- total de R$ 180 composto por serviço de R$ 120 e joia de R$ 60;
- sinal de R$ 40, pagamento final de R$ 60 e duas contas a receber somando R$ 80;
- uma única ordem de serviço, mesmo após refechamento;
- uma baixa de joia;
- dois consumos de material;
- três acompanhamentos de pós-atendimento;
- nenhuma chave financeira duplicada.

### Cancelamentos, créditos e reembolsos

- `PATCH` direto bloqueado;
- retenção de sinal;
- conversão de sinal em crédito;
- aplicação automática de R$ 35 sobre crédito de R$ 50, mantendo R$ 15;
- segundo cancelamento recusado sem duplicar crédito;
- reembolso manual do sinal com despesa rastreável;
- cancelamento sem pagamento;
- devolução integral de item danificado com reembolso sem retorno ao estoque;
- devolução de venda pendente reduziu títulos sem criar crédito/reembolso;
- crédito emitido conciliado com usos e saldo remanescente.

### Público e módulos auxiliares

- produto totalmente publicado apareceu no catálogo;
- agendamento público ofereceu slots e foi idempotente;
- oito relatórios responderam;
- lançamento manual parcelado foi idempotente;
- suporte e auditoria de privacidade responderam.

## Conciliação do tenant QA

No momento da conciliação principal:

- 2 clientes;
- 7 agendamentos;
- 4 ordens;
- 13 lançamentos financeiros;
- 7 movimentos de joias;
- 7 movimentos de materiais;
- 2 créditos de cliente;
- zero `source_key` duplicada;
- zero ordem de serviço duplicada;
- zero saldo negativo gravado;
- reembolso manual de agenda: 1 despesa;
- reembolso manual de venda: 1 despesa.

No tenant final, os créditos conciliados fecharam em R$ 110 emitidos = R$ 35 usados + R$ 75 restantes. A soma de lotes acima do saldo ficou em zero.

## Fora de escopo seguro desta rodada

- disparo real de WhatsApp;
- cobrança real no Asaas;
- persistência real em R2, pois o ambiente local está configurado para disco;
- dados pessoais reais, assinaturas reais e imagens de pacientes;
- exclusão da clínica QA, preservada para conferência visual.

## Estado final das correções

1. F-01 a F-07 corrigidas.
2. Automação crítica reexecutada em tenant novo com 123/123.
3. Testes frontend e build aprovados.
4. Regressões backend críticas, transacionais, históricas, de migrations, compras e parcelamentos aprovadas.
5. Próximo gate externo: testar R2, WhatsApp e Asaas em ambientes sandbox próprios antes de produção.
