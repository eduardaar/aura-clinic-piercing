# Revisão de estoque e catálogo — 03/11/2026

## Resultado

Os relatos de 29/10 foram transformados em regressões reproduzíveis. A rodada
encontrou e corrigiu os problemas abaixo, com verificação de persistência no
PostgreSQL e interação com os componentes reais.

| Problema reproduzido | Comportamento corrigido |
| --- | --- |
| A ordem salva no bloco substituía “Lançamentos”, preço ou nome escolhidos pelo visitante. | A grade preserva a ordenação escolhida. Carrosséis e seleções mantêm sua configuração própria. |
| No celular, uma regra de estilo escondia todos os filtros, incluindo a ordenação. | Filtros, preço e ordenação permanecem visíveis e cabem na tela. |
| Editar somente selo, publicação, nome ou observações recalculava preços com valores vazios. | Preço e custo do produto principal são preservados quando a edição não inclui precificação. Os dados das variações também são conferidos. |
| O mínimo zero voltava ao padrão 5 no cadastro e ao abrir a edição. | Zero é preservado nos dois caminhos e na movimentação. |
| Regravar uma variação inativa como `is_active: 0` a reativava. | Booleanos e o zero/um retornados pelo banco mantêm o estado correto. |
| O checkout aceitava produto com `virtual_store_active` desligado. | Catálogo e pedido público exigem as mesmas quatro marcas de publicação. |
| A interface apresentava “baixo estoque” como “Crítico”. | O rótulo e o filtro distinguem os dois estados. |

## Regra de mínimo confirmada

Com mínimo **5**, o limite é inclusivo:

| Quantidade | Estado |
| --- | --- |
| 0 | Esgotado |
| 1 a 5 | Crítico |
| 6 a 10 | Baixo estoque |
| Acima de 10 | Disponível |

Cinco unidades permanecem críticas por regra; seis já saem do crítico.
Isso não despublica o produto. O teste confirma que produtos esgotados continuam
na vitrine quando publicados, com disponibilidade correta.

## Cobertura executada

- Limites 0/1/4/5/6/10/11 com mínimo 5 e preservação do mínimo zero.
- Edições parciais de nome, texto, destaque e lançamento sem perda de dinheiro,
  saldo, SKU, fotos, descrição ou variações.
- Ocultação e republicação por cada uma das quatro marcas, incluindo recusa
  do pedido público quando o produto está oculto.
- Entrada, saída, perda, venda manual, esgotamento e reposição, conciliando pai,
  variação e catálogo.
- Duas saídas concorrentes da última unidade: uma passa e outra recebe 409.
- Quantidades negativas, zero, fracionárias, inválidas e acima do saldo são
  recusadas sem deixar baixa ou movimentação parcial.
- Variações zeradas não herdam saldo do pai; inativas ficam fora do público;
  produtos com várias medidas exigem a seleção correta na movimentação.
- SKU duplicado e edição com saldo negativo desfazem a transação completa.
- Arquivamento, movimentação durante a inatividade e reativação preservam cadastro.
- Regravação e remoção de variações, fotos por medida e isolamento entre clínicas.
- Ordenação por lançamento, data, preço e nome, com configuração conflitante
  no bloco, categoria e preço combinados, destaques e recarga do link.
- Submissão do editor real ao alterar somente lançamento, conferindo
  fotos, IDs, preços, estoque e publicação enviados.
- Suítes existentes de compras, embalagens, devoluções, FEFO, catálogo,
  campanhas e ranking, além de toda a suíte do servidor e do frontend.

## Validação

- **Servidor completo:** 808/808 testes aprovados, com API e autenticação reais
  e banco PostgreSQL temporário. Nenhum teste ignorado.
- **Frontend completo:** 77/77 testes unitários e 417/417 de componentes.
- **Regressões novas:** 19 testes de servidor e 18 de componentes.
- **Comando focado repetível:** 39 testes de servidor, 11 unitários e 38 de
  componentes aprovados por `npm.cmd run test:inventory-catalog`.
- **Verificações estáticas:** tipos e build aprovados. Biome explícito nos
  arquivos de aplicação alterados sem erros (27 avisos preexistentes); nos
  seis arquivos novos/alterados de testes e executor, sem avisos. Conferência
  de Novidades e `git diff --check` aprovadas.
- **Navegador:** Chromium e WebKit, em 390 e 1366 px. Em cada combinação: ordenar
  por lançamentos e recarregar; editar o selo pela tela administrativa e conferir
  os valores no banco; combinar preço e ordenação; zerar e repor o estoque;
  conferir retorno à vitrine, ausência de rolagem horizontal e de exceções de
  JavaScript. As quatro combinações passaram.

O teste reutilizável está em [browser.test.mjs](./browser.test.mjs), com resultados
em [browser-results.json](./browser-results.json). As capturas PNG são locais e
ficam fora do Git.

## Como repetir

```powershell
npm.cmd run test:inventory-catalog
npm.cmd --prefix backend run test:isolated
npm.cmd --prefix frontend test
npm.cmd run verify:static
```

O executor isolado exige `DATABASE_URL` local e permissão para criar bancos.
Ele cria um banco vazio, limpa credenciais externas no processo filho, grava
log individual em `outputs/test-runs/` e remove o banco ao terminar. O roteiro
de navegador e suas variáveis estão em [GUIA-DEV.md](../../docs/GUIA-DEV.md).

## Preparação da publicação

A conferência para envio à `main` identificou os avisos
[GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) e
[GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4)
na cadeia transitiva do ExcelJS. Os overrides desse pacote passam a usar
`minimatch 11.0.4`, `glob 14.0.3` e `unzipper 0.12.3`, preservando o Archiver 5.
Dois testes adicionais verificam ZIP com glob/diretório e gravação de XLSX por
streaming seguida de leitura dos textos, números e centavos. As auditorias de
raiz, backend e frontend ficam sem vulnerabilidades conhecidas.
Os 35 testes de relatórios e arquivos compactados passaram com essas versões.

## Limites

Esta rodada usa dados fictícios. Ela não comprova a integridade dos cadastros
atuais da cliente nem recupera valores de alterações passadas. Uma conferência
dos registros reais continua necessária se a cliente indicar produtos específicos.
WebKit em 390 px não equivale a teste em iPhone físico.

Nenhum registro de produção foi alterado durante os testes. Sem migration nova.
A publicação deve ser conferida no workflow “CI e Deploy” da `main`.
