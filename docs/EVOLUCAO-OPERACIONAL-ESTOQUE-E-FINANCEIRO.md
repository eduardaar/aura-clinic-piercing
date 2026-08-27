# Evolução operacional: estoque, agenda, financeiro e WhatsApp

Atualizado em 2026-08-27. Este documento separa o que já foi entregue daquilo que exige uma regra comercial explícita para não produzir estoque ou financeiro incorreto.

## Entregue nesta rodada

1. **Ficha técnica de materiais por serviço.** `GET` e `PUT /api/services/:id/consumables` guardam os materiais operacionais do serviço. Produtos de revenda continuam fora dela.
2. **Consumo automático e reversível.** Ao concluir uma agenda, a receita é congelada em `appointment_consumptions`, gera movimentação de saída e reduz o saldo. Reabrir ou cancelar depois de concluído devolve exatamente os materiais consumidos.
3. **Lotes e validade.** Materiais aceitam lotes por `GET`/`POST /api/consumables/:id/lots`. A compra também aceita em cada item de consumo `batch_code` e `expiry_date`. Na baixa, lotes com validade saem por FEFO; estoque histórico sem lote segue utilizável.
4. **Saúde do estoque.** `GET /api/inventory/health` mostra estoque baixo, cadastro incompleto, lotes vencidos/a vencer e serviços que possuem ficha técnica.
5. **Proteções existentes confirmadas.** Venda com estoque baixado ou valor recebido não pode ser cancelada diretamente; agenda concluída exige motivo para alteração financeira e restaura a baixa física ao ser reaberta.

## Fluxo operacional recomendado

~~~text
Compra confirmada -> estoque + contas a pagar
Serviço configurado -> ficha técnica (materiais, nunca produtos vendidos)
Agenda concluída -> joia + materiais + ordem de serviço + receber/pagamentos
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

O `PATCH` direto para `status=cancelado` foi bloqueado. Atendimento concluído com pagamento final precisa primeiro de uma devolução/estorno próprio, para não misturar origens financeiras.

O crédito pode ser consumido em `POST /api/appointments/:id/apply-client-credit` ou `POST /api/sales-orders/:id/apply-client-credit`. Ele baixa o crédito e o saldo/título da origem, mas não entra novamente como receita de caixa.

### Devolução de venda

Use `POST /api/sales-orders/:id/returns` com `items`, `reason` e `financial_action`:

| Ação financeira | Quando usar |
| --- | --- |
| `none` | a devolução reduz apenas títulos ainda pendentes |
| `client_credit` | a parte já recebida vira crédito do cliente |
| `manual_refund` | a parte já recebida gera despesa de reembolso; exige `refund_method` |

Cada item declara `return_to_stock` e `condition`. Somente item `sellable` retorna automaticamente ao estoque; item danificado/descartado continua registrado, mas não volta a ficar disponível. A API impede devolver mais do que foi vendido e preserva cada devolução anterior.

## Complementos ainda planejados

| Tema | Decisão assumida por segurança | Próxima entrega |
| --- | --- | --- |
| Cancelamento de agenda | API e tela já exigem resolução explícita | Integrar solicitação de estorno online ao gateway e confirmar por webhook |
| Devolução/troca de venda | API e modal já registram retorno físico e financeiro | Exibir histórico consolidado das devoluções na ficha da venda |
| WhatsApp como produto Aura | Configuração Cloud API hoje é por clínica e sem expor token | Cofre central Aura, vínculo do número do cliente, saldo de créditos, reserva/baixa por envio e conciliação do provedor |
| Taxonomia | Categorias de joias atuais continuam compatíveis | Separar na UI: joia de venda, material operacional e serviço; não criar categorias duplicadas |

## Critérios de aceite para a próxima rodada

- Manter regressão automática garantindo que devolução parcial nunca devolva mais unidades ou dinheiro do que foi solicitado/vendido.
- Estorno de gateway fica `solicitado` até confirmação do webhook; não marca como pago/devolvido por clique.
- Crédito de cliente vira um título rastreável e não saldo solto em observações.
- O custo de mensagens é debitado por tenant com idempotência e auditoria, sem armazenar chave de cliente em texto claro.
