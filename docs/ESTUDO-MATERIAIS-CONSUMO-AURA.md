# Materiais de consumo — leitura da base Aura Clinic

> **Leitura realizada em 26/08/2026 na cópia local restaurada.** Nenhum
> lançamento histórico foi alterado.
>
> **Situação em 30/09/2026:** o modelo de dois estoques de "Modelo aplicado"
> foi substituído em 30/08/2026 (48e5bfa1, migration tenant
> `0025_unified_inventory_items`).
>
> - **O que a `0025` removeu:** `consumables` e as tabelas ligadas
>   (movimentos, lotes, alocações e fichas técnicas) e a coluna
>   `purchase_order_items.consumable_id`.
> - **Como o material é cadastrado hoje:** como item de `jewelry_inventory`.
>   Liga-se "Pode ser usado em procedimento" (`can_use_in_service`) e não
>   "Pode ser vendido" (`can_sell`). Quando for o caso, liga-se também
>   "Controla lote e validade" (`track_lots`) (Inventory.jsx:970-973).
> - **Lotes e saídas:**
>   - Os lotes ficam em `inventory_item_lots` (`POST /api/jewelry/:id/lots`,
>     routes/jewelry.js:185).
>   - A saída manual baixa os lotes por FEFO e recusa saldo insuficiente com 409
>     (routes/jewelry.js:794-802).
>   - A ficha técnica do serviço (`service_inventory_recipes`,
>     `GET/PUT /api/services/:id/inventory-items`) baixa os materiais ao
>     concluir o atendimento (services/consumableUsage.js:50-78;
>     routes/appointments.js:279 e 500). Reabrir ou cancelar o atendimento
>     devolve esse consumo (routes/appointments.js:509;
>     services/appointmentCancellations.js:71).
> - **Onde fica a tela:** a aba "Materiais de procedimento" do Estoque.
>   `/app/materiais` abre essa aba e não aparece no menu (appPages.js:65;
>   Inventory.jsx:62 e 219).
> - **Compras:** a opção "Material de consumo" continua e lista os itens com
>   `can_use_in_service` e sem `can_sell` (Purchases.jsx:112 e 537).
>   - A entrada converte quantidade e custo pelo fator de compra do item
>     (`purchase_to_stock_factor`) e só cria lote quando `track_lots` está
>     ligado e a linha traz lote ou validade (services/purchases.js:252-253 e
>     311).
>   - Na importação da NF-e, uma linha pode virar "Cadastrar novo material de
>     consumo" (25edb281). O item é criado na mesma transação, sem saldo, custo
>     ou preço, com `can_use_in_service` e `track_lots` ligados e fora do
>     catálogo; o saldo entra quando a compra é confirmada
>     (services/purchases.js:142-162, 384 e 408-410;
>     Purchases.jsx:510).
> - **Base local:** os dados lidos em 26/08/2026 não foram reconferidos.

## O que existe hoje

- Não há `purchase_orders` registradas na clínica Aura Clinic.
- Água e descartáveis foram lançados como despesas financeiras manuais, não como
  estoque. Exemplos encontrados: “Água mineral” em `Água` e “Guimed produtos
  descartáveis” em `Descartáveis`.
- Há variação de escrita na categoria (`Descartáveis` e `Descartaveis`), o que
  fragmenta relatórios por categoria.

Esse histórico está correto como despesa, mas não permite saber saldo de luvas,
agulhas, materiais de assepsia, água ou itens de esterilização.

## Modelo aplicado

Foram criados dois estoques com responsabilidades diferentes:

| Tipo | Entra por compra | Controla saldo | Pode ser vendido/catálogo |
| --- | --- | --- | --- |
| Produto para revenda | Sim | `jewelry_inventory` | Sim |
| Material de consumo | Sim | `consumables` | Não |

> Tabela de 26/08/2026, mantida como histórico. Desde a migration `0025`, os dois
> tipos são itens de `jewelry_inventory`, diferenciados por `can_sell` e
> `can_use_in_service`.

Uma compra confirmada gera as parcelas em **Contas a pagar**. Os seus itens
podem misturar produto de revenda e material de consumo, mas cada um atualiza
somente o estoque correspondente.

## Fluxo recomendado

```text
Fornecedor → Compra → Contas a pagar
                    ├─ Produto para revenda → Estoque (produtos para venda) → Vendas
                    └─ Material de consumo → Estoque (materiais de procedimento) → Uso/Saída
```

1. Cadastre luvas, agulhas, água, gaze, antisséptico e semelhantes como item
   de estoque com **Pode ser usado em procedimento**, na aba **Materiais de
   procedimento** do Estoque.
2. Na compra, escolha “Material de consumo”, fornecedor, custo e vencimentos.
   Não crie uma segunda conta a pagar manual para a mesma nota.
3. Registre o uso por saída — por exemplo, uma caixa de luvas aberta ou água
   consumida no estúdio. O sistema bloqueia saldo negativo.
4. Defina estoque mínimo para destacar a necessidade de reposição.
5. Para despesas sem quantidade controlável (energia, aluguel, manutenção),
   continue usando **Contas a pagar** avulso.

## Histórico e padronização futura

As despesas atuais continuam intactas e não foram transformadas em saldo de
material, pois não há quantidade confiável para reconstruir. A partir de agora,
novas aquisições devem nascer em Compras.

Vale também unificar as categorias financeiras em uma grafia única, por exemplo
`Materiais de consumo`, para não dividir relatórios entre “Descartáveis” e
“Descartaveis”.
