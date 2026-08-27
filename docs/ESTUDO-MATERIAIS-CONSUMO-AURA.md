# Materiais de consumo — leitura da base Aura Clinic

> **Leitura realizada em 26/08/2026 na cópia local restaurada.** Nenhum
> lançamento histórico foi alterado.

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

Uma compra confirmada gera as parcelas em **Contas a pagar**. Os seus itens
podem misturar produto de revenda e material de consumo, mas cada um atualiza
somente o estoque correspondente.

## Fluxo recomendado

```text
Fornecedor → Compra → Contas a pagar
                    ├─ Produto para revenda → Estoque de produtos → Vendas
                    └─ Material de consumo → Estoque de materiais → Uso/Saída
```

1. Cadastre luvas, agulhas, água, gaze, antisséptico e semelhantes em
   **Materiais**.
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
