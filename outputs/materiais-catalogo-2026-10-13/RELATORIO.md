# Materiais de consumo e catálogo — 13/10/2026

Implementação sobre `df551949`, preparada para envio à `main` por solicitação do usuário. O push aciona a pipeline de CI/deploy; este relatório registra os testes anteriores à publicação e não certifica a conclusão em produção. O anexo recebido foi
`Texto colado.txt`; as três imagens mencionadas nele não foram disponibilizadas.
A aparência foi revisada segundo as diretrizes textuais e a identidade existente,
sem afirmar correspondência visual com referências ausentes.

## Causa raiz e correção dos materiais

O cadastro já existe em `jewelry_inventory`, desde a migration `0025`. A tela de
compras ainda exigia `can_use_in_service=1` **e** `can_sell=0`, excluindo itens
que podem ser vendidos e usados em procedimento. Além disso, a seleção de
material removia `product_variant_id`; o cadastro comum cria uma variação e a
confirmação da compra exige a variação que recebeu estoque.

- A seleção inclui todos os materiais não arquivados usáveis em procedimento.
- Selecionar material inicializa sua variação ativa e custo; outras variações
  podem ser escolhidas. A associação fiscal também preserva a variação.
- **Estoque → Materiais de procedimento → Novo material** reutiliza o editor
  existente. Novos materiais iniciam como usáveis em procedimento, sem venda
  ou publicação automáticas. Saldo, custo, mínimo, unidades, conversão de compra
  e fornecedor são configurados ali; variações e arquivamento continuam no fluxo
  existente. Categorias usam o gerenciador existente, agora acessível no Estoque.
- Compras orienta o cadastro e permite navegar ao estoque preservando o
  rascunho por usuário/clínica. A criação respeita `inventory.create`.
- `/options` retorna apenas ID/nome de fornecedores ativos e não bloqueados,
  dentro do schema do tenant. Não retorna dados financeiros de fornecedores.
- A API valida item e vínculo da variação antes de inserir a compra: referência
  inexistente ou variação de outro produto responde `409`, evitando o `500` da
  chave estrangeira. Não foi criado outro cadastro ou outra tabela de materiais.

Conferências no banco descartável: quatro unidades a R$ 2,50 + compra de duas
caixas (fator 2), a R$ 8,00/caixa, resultaram em oito unidades a custo médio de
R$ 3,25. Reenvio e reconfirmação mantiveram uma entrada e um título de R$ 16,00.
No navegador, duas unidades a R$ 2,50 + três unidades a R$ 5,00 resultaram em
cinco unidades a R$ 4,00 e uma movimentação da compra.

## Catálogo

- Cartões mostram foto, nome em até duas linhas, material comum às variações
  (ou categoria), preço, contagem de variações ativas e ação principal.
  Cores e medidas não são agregadas no cartão. Uma variação esgotada continua
  selecionável nos detalhes; variações inativas não entram na contagem.
- Detalhes preservam as características da variação selecionada. Material e
  tamanho ausentes não são preenchidos com dados de outra variação.
- Imagens quadradas com `object-fit: contain`, carregamento lazy/decodificação
  assíncrona e fallback neutro. Logotipo inexistente é ocultado.
- Tipografia dos cartões herda a fonte da loja, com menos peso, melhor
  contraste e títulos limitados a duas linhas. Não foi adicionada uma fonte.
- Cabeçalho compacto, categorias em botões de 44px e rolagem contida. “Todos”
  existe mesmo quando a configuração da loja omite essa opção.
- “Ver todos” aponta para a grade completa, sem se deter na seleção curada,
  preservando a categoria quando a seção possui filtro próprio.
  Busca, filtros, links, carrinho e favoritos continuam ligados aos dados do ERP.
- Esgotados continuam publicados e consultáveis, sem botão de compra.
  Não foi inventado um status de encomenda que o ERP não suporta.
- O desconto fixo de 5% no Pix e a promessa fixa de 3x sem juros foram retirados
  dos cartões, pois não vinham das configurações comerciais da loja.
- Carrinho respeita a opção de compra da loja. Não foi criado acesso a conta de
  cliente onde essa funcionalidade não existe.

## Arquivos de implementação

| Arquivo | Mudança |
| --- | --- |
| `backend/src/services/purchases.js` | Validação dos vínculos antes da gravação |
| `backend/src/routes/options.js` | Fornecedores para o cadastro unificado |
| `frontend/src/features/purchases/Purchases.jsx` | Filtro, variação, associação fiscal e acesso ao cadastro |
| `frontend/src/features/inventory/Inventory.jsx` | Modo contextual de material no editor existente |
| `frontend/src/lib/defaultForms.js` | Referência opcional de fornecedor |
| `frontend/src/features/catalog/catalogUtils.js` | Resumo técnico e contagem de variações ativas |
| `frontend/src/pages/PublicExperience.jsx` | Cartões, detalhes, ações, filtros e listagem completa |
| `frontend/src/styles/catalog-v2.css` | Grade, imagens, tipografia, cabeçalho e categorias |

Regressões em `backend/tests/consumablePurchases.test.mjs`,
`frontend/tests/ConsumablePurchases.test.jsx` e `frontend/tests/PublicCatalog.test.jsx`.
Teste de navegador e evidências nesta pasta.

## Validação e limites

| Verificação executada | Resultado |
| --- | --- |
| Suíte completa do backend, em banco descartável | 737/737 passaram |
| Frontend unitário (Node) | 68/68 passaram |
| Frontend componentes (Vitest), 40 arquivos | 337/337 passaram |
| Typecheck backend/frontend e build Vite | Passaram |
| Biome explícito nos 10 arquivos JS/JSX de implementação/testes | Sem erros; 27 avisos de padrões/hooks |
| Chromium e WebKit | Matriz em 320, 390, 430, 768 e 1366px |

A matriz verifica grade, alturas iguais por linha, `object-fit`, ausência de
rolagem horizontal na listagem, nome em duas linhas, contagem de 11 variações,
favoritos e busca após recarregar, filtro de categoria, carrinho da variação
escolhida, consulta ao WhatsApp da variação esgotada e segunda loja isolada.
Cadastro e compra do material são exercitados em 390/1366px nos dois motores.
Resultados estruturados em `browser-results.json` e capturas nesta pasta.

Na configuração de teste, a grade completa tem uma coluna em 320px, duas em
390/430/768px e quatro em 1366px. A quantidade de colunas usa a largura real do
container, inclusive dentro do construtor; não força colunas por resolução de
aparelho quando o espaço do componente é menor.

O teste de navegador usa componentes reais do produto e dados fictícios
cadastrados por API em PostgreSQL descartável. As chamadas são encaminhadas à
API de teste; o catálogo não é substituído por JSON estático. Também confere uma
segunda clínica com produto e cor próprios. As fotografias ausentes usam o
placeholder do produto; as capturas não simulam fotos do estoque real da Aura.

Chromium/WebKit em dimensões de iPhone não equivalem a um teste em aparelho
físico. Não houve acesso a operadora, WhatsApp real, produção ou alteração do
banco de trabalho. Nenhuma migration nova é necessária.

Para repetir o navegador, inicie Vite e configure `AURA_BROWSER_ORIGIN` se a
porta for diferente de 5187. Com PostgreSQL local e Playwright instalado:

```powershell
$env:AURA_TEST_PORT = '4304'
$env:AURA_PLAYWRIGHT_MODULE = 'CAMINHO\playwright\index.mjs'
node outputs/sinal-dashboard-rastreabilidade-2026-10-06/run-isolated-tests.cjs ../outputs/materiais-catalogo-2026-10-13/browser.test.mjs
```

O runner cria e remove um banco descartável e desativa as credenciais externas.
Use `TEMP` e portas separados para execuções concorrentes.
