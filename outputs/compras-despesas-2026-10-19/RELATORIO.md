# Compras, estoque e despesas operacionais — 19/10/2026

Implementação local sobre `d7f6da31`, a partir de `Texto colado.txt`. Não houve
commit, push, deploy ou alteração da base de trabalho/produção nesta rodada.

## O que mudou

O editor de materiais exigia uma categoria, mas oferecia categorias de joias.
A migration `0045_operational_categories.sql` cria oito categorias de materiais
no cadastro de estoque e completa as categorias financeiras solicitadas,
classificando seu uso como compras, despesas ou ambos. A migration é executada
uma vez por clínica pelo ledger; não recria categorias renomeadas nem reativa
categorias desativadas nas leituras seguintes. Categorias financeiras e de
estoque são registros independentes.

As categorias financeiras seguem personalizáveis e desativáveis. Renomear não
reescreve a classificação dos lançamentos históricos: os nomes antigos continuam
nos relatórios e nos filtros das contas a pagar. A API não oferece exclusão física
de categoria financeira. Nomes duplicados na edição retornam erro legível.

Compras ganha descrição opcional, separada das observações e refletida nos
lançamentos financeiros. Mantém fornecedor, itens, quantidades, custos, parcelas, NF-e, rascunhos
e entrada de estoque. Categorias podem ser criadas no próprio formulário; omitir
a classificação usa “Outros”. O navegador revelou que o seletor de variação podia
emitir um valor vazio ao carregar as opções do produto: agora esse evento não
apaga a variação obrigatória e o formulário exige uma variação válida antes de
adicionar o item.

Contas a pagar passa a explicar o fluxo de despesas operacionais e oferece
registro já pago, com data, ou pendente. Categoria e fornecedor são opcionais;
o padrão é “Outras despesas”. A criação continua no ledger financeiro, sem
produto ou movimentação de estoque. Os atalhos entre Compras e Despesas tornam
os dois caminhos explícitos. Contas manuais criadas com idempotência voltam a
exibir a ação Editar.

Também foi corrigido o seletor que voltava à categoria recém-criada após o
usuário escolher outra. Falhas de criação aparecem no formulário. Em telas
estreitas, parcelas e totais usam a largura disponível e o resumo não herda as
duas colunas da regra global de `dl`.

## Simulações e evidências

- API e PostgreSQL descartáveis, autenticação real e duas clínicas distintas.
- Aluguel de R$ 1.500, água de R$ 100 e energia de R$ 250, com pagamento em
  18/10 e vencimento em 19/10: valores e categoria conferidos no razão e nos
  relatórios, sem fornecedor/produto obrigatório ou mudança de estoque.
- Materiais e joias: saldo inicial de 2 unidades a R$ 10, compra de 3 a R$ 20,
  saldo final de 5 a custo médio de R$ 16. Uma obrigação de R$ 60 por compra.
  Reenvio da mesma operação não duplica a entrada nem o título.
- Clínica nova: categorias consultadas diretamente no banco antes do primeiro
  GET de categorias. Clínica antiga: estrutura anterior reconstruída em tenant
  descartável e atualizada pela migration, preservando categoria personalizada
  e categoria desativada. Reaplicação pelo ledger sem duplicação.
- Navegador: aplicativo real, APIs reais e banco descartável. O roteiro cadastra
  material pela tela, registra as três despesas e compra material e joia em cada
  dimensão. Dados de joia e fornecedor são preparados pela API. Capturas e
  resultado estruturado ficam nesta pasta.

Os testes de navegador não equivalem à homologação em aparelho físico. Não
houve uso de gateway ou provedor externo. As imagens que o usuário pretende
enviar depois ainda não fazem parte desta entrega.

## Resultados dos testes

| Verificação | Resultado |
| --- | --- |
| Backend completo, PostgreSQL descartável | 742/742 passaram |
| Backend após o acréscimo final da descrição de compra | 16/16 passaram (compras, materiais, NF-e e categorias/migration) |
| Frontend unitário | 68/68 passaram |
| Frontend componentes, 41 arquivos | 340/340 passaram |
| Typecheck backend/frontend e build final | Passaram (`npm run verify:static`) |
| Biome explícito nos 13 arquivos JS/JSX alterados/novos | Sem erros; 9 avisos preexistentes no editor de estoque |
| Navegador final: Chromium e WebKit, 320/390/1366 px | 6/6 cenários passaram; 18 despesas e 12 compras, com conferência de banco e relatórios |

O Biome também foi executado explicitamente porque `check:changed` pode não
selecionar a cópia de trabalho. As regressões de componentes pertinentes foram
reexecutadas após a correção da variação. Os resumos estão em
`backend-summary.txt` e `frontend-summary.txt`.
O teste final de navegador levou 127 s e gerou `browser-results.json` e 12
capturas de despesas/compras. Verifica campos e totais dentro da largura visível,
sem erro JavaScript de aplicação. WebKit em Windows não é um iPhone físico.

## Publicação

Aplicar `0045_operational_categories.sql` nos tenants existentes antes de
disponibilizar o novo código. O deploy atual não aplica migrations. A migration
não foi aplicada à base de trabalho ou à produção. Novas clínicas recebem as
categorias automaticamente pelo provisionamento existente.
