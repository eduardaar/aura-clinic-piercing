# Evolução operacional: estoque, agenda, financeiro e WhatsApp

Atualizado em 2026-08-27. Este documento separa o que já foi entregue daquilo que exige uma regra comercial explícita para não produzir estoque ou financeiro incorreto.

> **Situação em 30/09/2026:** regras revistas contra o código até `fdde35fd` (22/09/2026). Em 30/08 (`48e5bfa1`, migration tenant `0025_unified_inventory_items`) produtos e materiais passaram a ser o mesmo cadastro, `jewelry_inventory`, com as marcas `can_sell`, `can_use_in_service`, `track_stock`, `track_lots` e `can_publish`; as tabelas `consumables*` e as rotas `/api/consumables*` deixaram de existir, e os relatórios de movimentos e lotes passaram a ler o estoque unificado (`78192025`). Em 31/08 (`c49b714c`) voltaram a trava "soma dos lotes ≤ saldo" e o FEFO na saída manual. Desde 30/08 o atendimento concluído gera uma execução própria (`service_executions`), não mais uma ordem de serviço em `sales_orders`. Os itens abaixo já descrevem esse estado.

## Entregue nesta rodada

1. **Ficha técnica de materiais por serviço.** `GET` e `PUT /api/services/:id/inventory-items` (o caminho antigo `/api/services/:id/consumables` continua como alias) guardam em `service_inventory_recipes` os itens usados no serviço; a ficha também vai como `inventory_items` em `POST`/`PUT /api/services`. Só entra item não arquivado e marcado como usável em procedimento (`can_use_in_service`); um mesmo item pode ser, ao mesmo tempo, vendável e usável em procedimento.
2. **Consumo automático e reversível.** Ao concluir uma agenda (`POST /api/appointments/:id/complete` ou `PATCH` para `atendido`), a receita é congelada em `appointment_consumptions` (por `inventory_item_id`). Para item com `track_stock`, gera movimentação de saída e reduz o saldo; saldo insuficiente impede a conclusão. Reabrir, ou cancelar depois de concluído, devolve exatamente os materiais consumidos, inclusive aos lotes de onde saíram.
3. **Lotes e validade.** Itens com `track_lots` aceitam lotes em `inventory_item_lots` por `POST /api/jewelry/:id/lots` e são listados em `GET /api/inventory/lots`. O lote não pode passar do saldo ainda sem lote; com `increase_stock: true` ele soma ao saldo e grava uma entrada; item sem `track_lots` ou arquivado recebe `409`. A compra aceita `batch_code` e `expiry_date` por item e só cria lote quando o item tem `track_lots`. Na baixa, lotes saem por FEFO (validade mais próxima primeiro, sem validade por último), no consumo automático e na saída manual (`POST /api/jewelry/:id/movements`). Mudança em relação a 27/08: no consumo automático, item com `track_lots` precisa de lotes que cubram toda a quantidade, senão a conclusão falha com "Lotes insuficientes"; saldo sem lote só continua utilizável em item sem `track_lots` e na saída manual.
4. **Saúde do estoque.** `GET /api/inventory/health` mostra estoque baixo (só itens com `track_stock`), cadastro incompleto (sem SKU ou categoria), lotes vencidos/a vencer em 30 dias e serviços que possuem ficha técnica. O resumo conta `items`, `sellable` e `procedure_items`.
5. **Proteções existentes confirmadas.** Venda com estoque baixado ou valor recebido não pode ser cancelada diretamente; agenda concluída exige motivo para alteração financeira e restaura a baixa física ao ser reaberta.

## Fluxo operacional recomendado

~~~text
Compra confirmada -> estoque (convertido pelo fator de compra) + lote, se o item controla lote + contas a pagar
Serviço configurado -> ficha técnica (itens marcados como usáveis em procedimento)
Agenda concluída -> joia + materiais + execução do atendimento + receber/pagamentos
Agenda reaberta/cancelada -> estorno físico auditável; financeiro exige escolha explícita
Venda avulsa concluída -> estoque + pagamento/recebível
Devolução -> retorno físico por item + redução de títulos/crédito/reembolso
~~~

## Fluxos entregues de cancelamento e devolução

### Cancelamento de agenda

Use `POST /api/appointments/:id/cancel` e informe sempre `reason` e uma `resolution`:

| Resolução | Efeito |
| --- | --- |
| `no_payment` | cancela a agenda sem sinal recebido |
| `retain_deposit` | mantém o sinal como receita já recebida |
| `client_credit` | cria crédito rastreável do cliente pelo sinal |
| `manual_refund` | gera despesa paga de reembolso; exige `refund_method` |

O `PATCH` direto para `status=cancelado` foi bloqueado. Atendimento concluído com pagamento final precisa primeiro de uma devolução/estorno próprio, para não misturar origens financeiras. Atenção: a API recusa esse cancelamento apontando para a "devolução/estorno da venda", mas desde 30/08 o atendimento gera `service_executions`, não venda; a devolução de venda recusa origem `agenda` e `/api/service-executions` só tem leitura. Até `fdde35fd`, esse caso não tem fluxo de devolução próprio.

O crédito pode ser consumido em `POST /api/appointments/:id/apply-client-credit` ou `POST /api/sales-orders/:id/apply-client-credit`. Ele baixa o crédito e o saldo/título da origem, mas não entra novamente como receita de caixa.

### Devolução de venda

Use `POST /api/sales-orders/:id/returns` com `items`, `reason` e `financial_action`:

| Ação financeira | Quando usar |
| --- | --- |
| `none` | a devolução reduz apenas títulos ainda pendentes |
| `client_credit` | a parte já recebida vira crédito do cliente |
| `manual_refund` | a parte já recebida gera despesa de reembolso; exige `refund_method` |

Cada item declara `return_to_stock` e `condition`. Somente item `sellable` retorna automaticamente ao estoque; item danificado/descartado continua registrado, mas não volta a ficar disponível. A API impede devolver mais do que foi vendido e preserva cada devolução anterior. Vendas registram apenas produtos: a tela só oferece itens vendáveis (`can_sell`) e o checkout público os exige. Venda com origem `agenda` não aceita devolução, porque atendimento usa o cancelamento.

## Complementos ainda planejados

| Tema | Decisão assumida por segurança | Próxima entrega |
| --- | --- | --- |
| Cancelamento de agenda | API e tela já exigem resolução explícita | Integrar solicitação de estorno online ao gateway e confirmar por webhook |
| Devolução/troca de venda | API e modal já registram retorno físico e financeiro | Exibir histórico consolidado das devoluções na ficha da venda |
| WhatsApp como produto Aura | Configuração Cloud API hoje é por clínica e sem expor token; a carteira de créditos por clínica já reserva e baixa 1 crédito por envio oficial, e a compra de créditos só registra a intenção | Cofre central Aura, vínculo do número do cliente, compra efetiva de créditos e conciliação do provedor |
| Taxonomia | Categorias de joias atuais continuam compatíveis; desde a `0025`, joia de venda e material operacional são o mesmo cadastro, separados pelas marcas `can_sell` e `can_use_in_service` e pelas abas "Produtos para venda" e "Materiais de procedimento" do Estoque; serviços têm cadastro próprio | Taxonomia única de categorias e campo único de publicação; não criar categorias duplicadas (ver P-02 em [ESTADO-ATUAL.md](./ESTADO-ATUAL.md)) |

## Critérios de aceite para a próxima rodada

- Manter regressão automática garantindo que devolução parcial nunca devolva mais unidades ou dinheiro do que foi solicitado/vendido.
- Estorno de gateway fica `solicitado` até confirmação do webhook; não marca como pago/devolvido por clique.
- Crédito de cliente vira um título rastreável e não saldo solto em observações.
- O custo de mensagens é debitado por tenant com idempotência e auditoria, sem armazenar chave de cliente em texto claro.
