# Estudo — serviços, agenda e financeiro

> **Situação em 30/09/2026:** as Etapas A e B foram executadas no código, exceto
> a migração das ordens legadas `source='agenda'`. A Etapa C segue aberta.
>
> - **Etapa A** (31c089e5, 26/08/2026).
> - **Etapa B** (c1176101 e 8584be9d, 30/08/2026). A migration tenant
>   `0019_service_executions` cria `service_executions` (1:1 com
>   `appointments`), `service_execution_items` e `payments.service_execution_id`.
>   Concluir o atendimento chama `ensureServiceExecution`
>   (services/serviceExecutions.js:22; routes/appointments.js:280 e 503) e gera
>   os títulos com `source_type='service_execution'`. Reabrir ou cancelar chama
>   `cancelServiceExecution` (services/serviceExecutions.js:184). O commit
>   8584be9d removeu `ensureSalesOrderForAppointment`.
> - **Itens da execução:** a implementação criou `service_execution_items`
>   (itens `service` e `product`; a joia aplicada entra como `product`), embora
>   a seção "Entidades" a tratasse como opcional.
> - **Ordens legadas** `source='agenda'`: continuam em `sales_orders`. Ficam
>   fora de Vendas, a menos que se peça `include_agenda=true`
>   (routes/sales.js:45). A rota de Vendas não altera o status delas
>   (routes/sales.js:237-238). O roadmap de lançamento aprovou o corte direto
>   sem backfill legado, recriando as bases descartáveis
>   ([ROADMAP-LANCAMENTO-SETEMBRO-2026.md](./ROADMAP-LANCAMENTO-SETEMBRO-2026.md));
>   por isso não há migração dessas ordens no código.
> - **Depois da Etapa A, a tela mudou.** O commit 2d3aafa3 (migration
>   `0035_unified_service_catalog`) uniu serviço e procedimento no cadastro
>   "Procedimentos e tipos de atendimento". `/api/procedures` virou alias
>   somente leitura: as escritas respondem 410.
>   - `/app/servicos` ("Procedimentos da Agenda") saiu do menu
>     (frontend/src/lib/appPages.js:40). O cadastro abre em Agenda →
>     Configurações da Agenda → aba "Procedimentos" (Agenda.jsx:1540 e 1550).
>   - A lista de serviços executados é o "Histórico de atendimentos", em "Mais
>     opções" da Agenda (Agenda.jsx:456 e 680). Ela lê
>     `GET /api/service-executions`.
> - **Etapa C:** há testes automatizados que exercitam a execução
>   (backend/tests/transactions.test.mjs e backend/tests/flow.test.mjs). Esta
>   revisão não os executou, por isso a Etapa C continua sem marcação.
>
> Até 30/08/2026 o estado registrado aqui era: Etapa A aplicada localmente em
> 26/08/2026, Etapa B ainda como proposta.

## Objetivo

Separar claramente três domínios que hoje se cruzam:

1. **Catálogo de serviços:** o que a clínica oferece, com preço, duração e
   profissionais habilitados.
2. **Serviço executado:** o atendimento que realmente aconteceu, gerado somente
   quando a agenda é finalizada.
3. **Venda:** comercialização avulsa de produto. Não deve ser o lugar para criar
   ou controlar um atendimento originado na agenda.

O serviço executado precisa aparecer no financeiro, mas como receita de serviço
originada pela agenda — não como uma venda de balcão.

## Estado atual observado

> Retrato de 26/08/2026, anterior à Etapa B. Fica como histórico; o estado atual
> está na nota de situação do topo.

### Dados e fluxo

```text
services ──< professional_services
     │
     └──< appointments / appointment_items
                   │
                   ├── payments
                   ├── inventory_reservations / stock_movements
                   └── sales_orders (ordem_servico, source=agenda)
                              ├── sales_order_items
                              └── financial_entries (source_type=sales_order)
```

- `services` já é o catálogo de serviços da clínica. Hoje seu CRUD está dentro
  das configurações da Agenda.
- `appointments` e `appointment_items` guardam o snapshot do atendimento,
  incluindo serviço/procedimento, joias, preços, duração e desconto.
- Ao finalizar `POST /api/appointments/:id/complete`, a transação:
  1. registra pagamentos;
  2. marca o agendamento como `atendido`;
  3. baixa joias usadas;
  4. chama `ensureSalesOrderForAppointment`;
  5. agenda pós-atendimento e fidelidade.
- `ensureSalesOrderForAppointment` cria/atualiza uma `sales_order` com
  `order_type='ordem_servico'` e `source='agenda'`, religa os pagamentos e
  cria contas a receber em `financial_entries`.
- A tela de Vendas ainda permite criar itens de tipo `servico` manualmente. Ela
  bloqueia apenas `ordem_servico`, mas não bloqueia a venda avulsa de serviço.

### Acertos existentes

- A finalização é transacional: não deve haver baixa de estoque sem atendimento.
- Um serviço gerado pela agenda não pode ter status alterado pela rota de Vendas.
- O financeiro evita duplicar previsão de agendamento e ordem de agenda em
  alguns totais.
- Pagamentos já são vinculados ao atendimento e ao título financeiro.

### Problemas de coesão

1. Um atendimento executado é representado por uma venda, mesmo quando não há
   venda de produto.
2. Vendas, relatórios e regras de exclusão conhecem `ordem_servico`, aumentando
   acoplamento entre domínios.
3. A tela de Vendas permite uma segunda origem de serviço, com risco de fluxo e
   relatório duplicados.
4. O razão usa `source_type='sales_order'` inclusive quando a origem real é a
   agenda.
5. O cadastro de serviços fica escondido na Agenda, embora seja uma entidade
   própria do negócio.

## Modelo-alvo recomendado

```text
Catálogo de serviços ──< Agenda ──(finalizar)──> Serviço executado
                                                ├── pagamentos
                                                ├── joias/estoque
                                                └── contas a receber

Venda de balcão ───────────────────────────────> produtos ──> contas a receber
```

### Entidades

| Entidade | Origem | Pode ser criada manualmente? | Responsabilidade |
| --- | --- | --- | --- |
| `services` | Cadastro de serviços | Sim | Oferta, preço-base, duração e profissionais. |
| `service_executions` | Agenda finalizada | Não | Snapshot do serviço prestado, cliente, profissional, valores, itens e status. |
| `sales_orders` | Vendas | Sim, somente produto | Venda de balcão/catálogo e baixa de produto. |
| `financial_entries` | Serviço executado ou venda | Não diretamente para essas origens | Contas a receber/pagamentos por origem rastreável. |

`service_executions` deve ter relação 1:1 com `appointments` (`UNIQUE
appointment_id`). Os itens do agendamento continuam sendo a fonte do snapshot;
uma tabela própria de itens de execução só será necessária se o serviço puder
ser alterado depois de concluído sem reabrir a agenda.

### Regras de negócio propostas

1. Somente `POST /appointments/:id/complete` gera um serviço executado.
2. Não existe botão de “nova venda de serviço” no módulo Vendas.
3. Produtos usados no atendimento continuam baixando estoque pelo atendimento;
   produtos vendidos fora dele pertencem somente a Vendas.
4. Ao concluir com saldo pendente, o título recebe
   `source_type='service_execution'`; ao receber à vista, o pagamento aponta ao
   serviço executado.
5. Reabertura/cancelamento de um atendimento concluído exige permissão financeira
   e reconcilia pagamentos, estoque e títulos do mesmo serviço.
6. Relatórios mostram receita de serviços e receita de produtos separadamente;
   o total financeiro vem de pagamentos/títulos, nunca da soma duplicada de
   agenda e vendas.
7. Dados legados `sales_orders.source='agenda'` são histórico: não aparecem em
   Vendas após a migração e são migrados para execuções ou mantidos em leitura
   compatível até a auditoria encerrar.

## Tela de Serviços

Novo módulo `/app/servicos`, com duas áreas:

### 1. Catálogo

- Lista: nome, duração, preço-base, sinal, profissionais vinculados e estado.
- Formulário: nome, descrição, duração, preço-base, sinal, observações de
  pré-serviço, profissionais e ativo/inativo.
- Arquivamento preserva histórico; serviço vinculado a agenda não é apagado.

### 2. Serviços executados

- Lista somente leitura derivada da agenda finalizada: data, cliente,
  profissional, serviço, joias, valor, pago, saldo e estado financeiro.
- Filtros: período, profissional, cliente, serviço e situação financeira.
- Ação principal: abrir o atendimento de origem. Não há “criar execução” manual.
- Formulário operacional é o fechamento do atendimento na Agenda; a tela de
  Serviços pode abrir esse formulário pelo vínculo do agendamento enquanto ele
  ainda não estiver atendido.

## Plano de implementação

### Etapa A — separação visível e de permissão

- [x] Criar página `Serviços` e mover para ela o CRUD atualmente embutido na
  Agenda.
- [x] Adicionar a página ao menu, rotas e permissões.
- [x] Criar a lista de atendimentos finalizados derivada da Agenda.
- [x] Remover as abas/itens `servico` e `mista` de Vendas.
- [x] Rejeitar no backend a criação manual de `sales_orders` contendo serviço.
- [x] Ocultar `source='agenda'` do módulo Vendas, preservando acesso financeiro
  somente até a migração completa.

> Depois de 30/08/2026, a página Serviços saiu do menu. O cadastro e a lista de
> atendimentos finalizados voltaram para dentro da Agenda (ver a nota do topo).

### Etapa B — separação de dados e financeiro

- [x] Migration: criar `service_executions`, vincular pagamentos por
  `service_execution_id` e títulos financeiros pela origem polimórfica.
- [x] Substituir `ensureSalesOrderForAppointment` por
  `ensureServiceExecution` (services/serviceExecutions.js).
- [x] Criar recebíveis com `source_type='service_execution'` e chave idempotente
  própria, sem depender de `sales_orders`.
- [ ] Migrar ordens legadas `source='agenda'` de forma auditável e reversível por
  etapa; não apagar dados já pagos.
- [x] Adaptar cancelamento/reabertura, relatórios e exportações.

### Etapa C — validação

- [ ] Testar atendimento pago, parcial, parcelado, cancelado e reaberto.
- [ ] Testar atendimento com e sem joia, garantindo uma única baixa de estoque.
- [ ] Testar que Vendas não cria serviço e Serviço não cria venda.
- [ ] Conferir que `payments`, `financial_entries` e relatórios não duplicam
  receita antes/depois da migração.
- [ ] Rodar migração em banco vazio e em cópia de banco legado.

## Decisões necessárias antes da etapa B

> Situação em 30/09/2026: as perguntas 2 e 4 foram respondidas no
> [ROADMAP-LANCAMENTO-SETEMBRO-2026.md](./ROADMAP-LANCAMENTO-SETEMBRO-2026.md)
> (seção "Pontos levantados durante os testes"; o item da joia foi marcado em
> 48e17a2f). Na pergunta 2, ficou um único fechamento para o
> cliente, com receita de serviço e de produto separadas nos dados; o código
> guarda a joia aplicada como item `product` da própria execução, com
> `product_subtotal` separado de `service_subtotal` (migration tenant
> `0019_service_executions`). Na pergunta 4, a decisão foi o corte direto sem
> backfill legado, recriando as bases descartáveis antes do primeiro dado real.
> As perguntas 1 e 3 não têm decisão registrada.

1. A execução de serviço pode ser editada depois de finalizada ou deve exigir
   reabertura do agendamento?
2. Joia aplicada no atendimento é parte da execução de serviço, receita de
   produto separada, ou ambas as visões devem aparecer no mesmo documento?
3. O número de uma ordem de serviço precisa continuar existindo para impressão,
   ou o protocolo do agendamento/executado a substitui?
4. Qual política de migração dos títulos já pagos ligados a `sales_orders` da
   agenda: referência de compatibilidade ou cópia auditada para a nova origem?
