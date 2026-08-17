# Padrão visual do frontend

Como escrever tela nova sem criar mais um sistema de CSS. O documento nasceu da
refatoração do painel `/plataforma`, onde cinco telas tinham cinco CSS paralelos
(`pa-`, `aa-`, `fa-`, `le-`, `sup-`) para desenhar as mesmas coisas.

---

## 1. A regra de ouro

**Antes de escrever CSS, procure o componente. Depois, a classe. Só então
escreva.**

A ordem de busca, na prática:

| Preciso de… | Procure primeiro | Onde |
| --- | --- | --- |
| Listar registros | `<DataView>` | `components/common/DataView.jsx` |
| Formulário | `<Modal>` + `Input`/`Select`/`Textarea`/`Checkbox` | `components/common/Crud.jsx` e `Ui.jsx` |
| Cabeçalho com botão "Novo" | `<CrudHeader>` | `components/common/Crud.jsx` |
| Confirmar exclusão | `<ConfirmDeleteModal>` | `components/common/Crud.jsx` |
| Botão | `<Button variant=…>` | `components/common/Ui.jsx` |
| Navegar entre seções | `<Tabs>` | `components/common/Ui.jsx` |
| Mostrar conteúdo progressivamente | `<Accordion>` | `components/common/Ui.jsx` |
| Ligar/desligar uma preferência | `<Switch>` | `components/common/Ui.jsx` |
| Selo de status | `<StatusBadge>` | `components/common/Ui.jsx` |
| Empilhar blocos numa página | `.stack` | `styles.css` |
| Bloco de conteúdo | `.panel` + `.panel-heading` | `styles.css` |
| Barra de filtros fora do DataView | `.toolbar` | `styles.css` |
| Grade de campos | `.form-grid` | `styles.css` |
| Texto de apoio abaixo de um campo | `.field-hint` | `styles.css` (`@layer base`) |
| Coisa do painel da plataforma | `.platform-*` | `styles/platform-panel.css` |

Só depois de passar por essa lista é que se escreve CSS — e, mesmo aí, **uma
regra a mais na camada compartilhada é melhor que um arquivo novo**.

O teste é simples: se a regra que você quer escrever descreve *o que a coisa é*
("um texto de apoio", "uma barra de progresso", "um bloco destrutivo"), ela
pertence à camada comum. Se descreve *uma peculiaridade daquela tela* ("a
prévia da imagem fica ao lado dos controles"), ela pertence ao CSS da tela.

---

## 2. O catálogo de primitivas

### Componentes

| Componente | Para quê | Arquivo |
| --- | --- | --- |
| `DataView` | Listagem completa: busca, filtros avançados, ordenação por coluna, paginação e os estados de carregando/erro/vazio | `components/common/DataView.jsx` |
| `DataTable` | Tabela nua, sem nada disso. **Só para tela ainda não migrada** | `components/common/Crud.jsx` |
| `Modal` | Janela sobreposta. Fecha no Esc e no clique fora, trava o scroll do body | `components/common/Crud.jsx` |
| `ConfirmDeleteModal` | Exclusão com palavra digitada. Use em **toda** exclusão | `components/common/Crud.jsx` |
| `CrudHeader` | Título + subtítulo + botão de ação | `components/common/Crud.jsx` |
| `Input` `Select` `Textarea` `Checkbox` | Campos controlados; `onChange` recebe o **valor**, não o evento | `components/common/Ui.jsx` |
| `Tabs` | Composição `Tabs.List`, `Tabs.Trigger`, `Tabs.Content`; `onChange`/`onValueChange` recebem a aba | `components/common/Ui.jsx` |
| `Accordion` | Composição `Accordion.Item`, `Header`, `Trigger`, `Content`; suporta `single` e `multiple` | `components/common/Ui.jsx` |
| `Switch` | Toggle Radix; `onChange` recebe booleano; `switchClassName` estiliza só o controle | `components/common/Ui.jsx` |
| `Input` / `Textarea` | `className` vai ao controle nativo e `fieldClassName` ao invólucro; demais atributos HTML são encaminhados | `components/common/Ui.jsx` |
| `Button` | `variant`: `primary` \| `secondary` \| `ghost` \| `danger`; encaminha atributos e `ref` ao `<button>` | `components/common/Ui.jsx` |
| `StatusBadge` | Selo colorido; mapeia o texto do status para o tom | `components/common/Ui.jsx` |
| `AlertBlock` | Lista de avisos com estado vazio embutido | `components/common/Ui.jsx` |

### Classes globais (`styles.css`)

| Classe | Para quê |
| --- | --- |
| `.stack` | Grid vertical com `gap`. O invólucro padrão de uma tela |
| `.panel` / `.panel-heading` | Bloco de conteúdo e seu cabeçalho |
| `.form-grid` | Duas colunas de campos |
| `.form-section` | Seção dentro de um formulário |
| `.toolbar` | Barra de filtros/ações |
| `.header-actions` / `.table-actions` / `.row-actions` | Linha de botões (e de **links** — `.table-actions a` está no seletor) |
| `.form-error` / `.form-success` | Mensagem de resultado |
| `.empty-state` | Área vazia, moldura tracejada |
| `.field-hint` (+ `.is-error`) | Texto de apoio abaixo de um campo |
| `button:disabled` | Estado desabilitado, global |
| `code` | Valor técnico no meio do texto (slug, código de plano, id do gateway) |

As três últimas moram em `@layer base` e valem para o projeto inteiro. Nenhuma
existia antes desta rodada — a seção 6 conta por quê.

### Classes do painel da plataforma (`styles/platform-panel.css`)

| Classe | Para quê |
| --- | --- |
| `.platform-tabs` | Menu de abas, no cabeçalho fixo |
| `.platform-metrics` / `.platform-metric` | Grade de números do topo |
| `.platform-split` (`--wide`) | Mestre-detalhe em duas colunas |
| `.platform-facts` / `.platform-fact` | Pares rótulo/valor |
| `.platform-quota*` | Barra de progresso de cota (com `is-near`, `is-over`, `is-unlimited`) |
| `.platform-danger` | Bloco de ação destrutiva, moldura vermelha |
| `.platform-notice` | "Leia antes de clicar", âmbar — não é erro |
| `.platform-sticky-warning` | Aviso que **não** pode sumir sozinho |

### Layout do shell (`styles/appshell.css`)

`.app-shell`, `.sidebar`, `.topbar`, `.main-content`, `.content-scroll`. Este
arquivo é a **autoridade** sobre o layout da área autenticada. Layout de shell
se mexe aqui, e só aqui.

---

## 3. As camadas da cascata

`styles.css` declara, na primeira linha útil:

```css
@layer base, legado, telas, app;
```

| Camada | Conteúdo | Quem escreve nela |
| --- | --- | --- |
| `base` | Tokens do `:root`, reset e primitivas globais | quem cria primitiva nova |
| `legado` | O corpo do `styles.css` — quatro gerações de CSS redefinindo os mesmos seletores | ninguém, se der para evitar |
| `telas` | CSS de tela: `topnav`, `landing`, `auth`, `directory`, `platform-panel` e os CSS por tela do painel | **você** |
| `app` | `appshell.css`, o layout do shell | quem mexe no shell |

### A parte contraintuitiva

**Camada posterior vence, independentemente de especificidade.** Uma regra
`.app-shell .main-content .content-scroll` (especificidade 0-3-0) escrita em
`telas` **perde** para um `.content-scroll` nu (0-1-0) escrito em `app`. A
especificidade só desempata *dentro* da mesma camada.

Isso é o oposto do que a intuição diz, e é justamente o que torna o sistema
previsível: `appshell.css` não precisa disputar seletor com as 10 mil linhas do
`styles.css`. Ele ganha por estar na última camada.

Duas consequências que mordem:

1. **CSS fora de camada vence CSS de qualquer camada.** Um arquivo `.css` novo
   sem `@layer telas { … }` em volta passa a ganhar de tudo — inclusive do
   `appshell.css` — e o visual do sistema inteiro muda por acidente de ordem de
   importação. Por isso **todo** arquivo de `frontend/src/styles/` está
   envolvido num bloco de camada.
2. **`!important` inverte a ordem entre camadas**: com ele, `base` ganha de
   `app`. Hoje os poucos `!important` do projeto não disputam a mesma
   propriedade; mantenha assim.

Ao criar um `.css` novo: envolva em `@layer telas`, e importe-o **no
componente** que o usa (import de CSS é deduplicado pelo bundler, então isso não
muda a ordem final das regras — e a tela deixa de depender de quem a monta).

---

## 4. A armadilha do scroll

```
.main-content     height: 100dvh; overflow: hidden   ← NÃO rola
└─ .content-scroll  flex:1; min-height:0; overflow-y:auto   ← rola
```

`.main-content` é uma coluna flex de altura fixa e **rolagem desligada**, de
propósito: é o que mantém o menu lateral e o topo parados enquanto o conteúdo
anda. Quem rola é o filho `.content-scroll`.

Uma tela que monte `.main-content` sem esse filho **não ganha barra de rolagem**:
tudo abaixo da dobra fica cortado e inalcançável, sem nenhum sinal de erro. Foi
exatamente o bug do painel `/plataforma` (commit `27ce9a2`), que usava
`.main-content` direto.

A estrutura correta de uma tela que monta o próprio shell:

```jsx
<main className="main-content">
  <header className="topbar">…</header>
  <div className="content-scroll">
    <div className="stack">…</div>
  </div>
</main>
```

Corolário: **o que precisa ficar fixo vai no `<header>`, não no
`.content-scroll`.** As abas do painel moram no cabeçalho porque trocar de área
não pode exigir rolar de volta ao topo.

---

## 5. Anti-padrões, com o caso real

O painel do super-admin foi construído por partes. Cada tela nasceu com um CSS
próprio, e o resultado foi cinco jeitos de desenhar a mesma coisa — cada aba com
uma cara. A refatoração (`f308eec`) reverteu isso:

| Tela | CSS antes | CSS depois |
| --- | --- | --- |
| Planos | 403 linhas | 51 |
| Contas | 448 linhas | 15 (nenhuma regra exclusiva sobrou) |
| Financeiro | 421 linhas | 58 |
| Suporte | 224 linhas | 61 |

O bundle de CSS do painel caiu de **17,77 kB para 5,03 kB**. Nenhuma tela perdeu
funcionalidade — todas ganharam paginação e ordenação que não tinham.

Os quatro anti-padrões, na ordem em que aparecem:

**1. Um sistema de CSS por tela.** O prefixo (`pa-`, `aa-`, `fa-`…) parece
organização, mas é o sintoma: quando cada tela tem o próprio vocabulário para
"cartão de número" e "texto de apoio", nenhuma delas está usando o do projeto.

**2. Listagem desenhada à mão.** As telas montavam `<table>` (ou grades de
cartões) do zero. `DataView` já entrega tabela, `data-label` para o mobile,
`caption` para acessibilidade e ações na linha.

**3. Reimplementar o que o `DataView` já dá.** Cada tela tinha o próprio campo de
busca, o próprio `sort` e o próprio "Nenhum registro encontrado" — o inventário
achou **4 marcações diferentes de busca e 7 tratamentos diferentes de estado
vazio**. Busca, filtros, ordenação, paginação e os três estados
(carregando/erro/vazio) são do componente. Se você está escrevendo
`rows.filter(...)` para uma caixa de busca, pare.

**4. Formulário embutido na página.** Planos editava o registro numa segunda
coluna dentro da lista, e por isso guardava um **mapa de rascunhos** — um por
plano, todos vivos ao mesmo tempo. Com `<Modal>` existe uma edição por vez, e o
mapa virou um rascunho só. O padrão não é só visual: ele simplifica o estado.

---

## 6. O sinal de primitiva faltando

Durante a rodada, dois agentes trabalhando em telas diferentes criaram, cada um
por conta própria, a mesma coisa com nomes diferentes:

```css
.pa-hint   /* plans-admin.css  */
.aa-nota   /* accounts-admin.css */
```

Ambos eram "texto de apoio abaixo de um campo". Nenhum dos dois copiou o outro —
os dois chegaram à mesma necessidade porque a necessidade é real e não existia
nada global para atendê-la.

**Quando a mesma necessidade reaparece com nomes diferentes em telas diferentes,
é primitiva faltando — não preferência de quem escreveu.** O lugar dela é a
camada comum.

Foi assim que nasceram as três primitivas de `@layer base`:

| Primitiva | O que a revelou |
| --- | --- |
| `.field-hint` | `.pa-hint` e `.aa-nota`, criadas em paralelo |
| `button:disabled` | Só três regras pontuais no projeto inteiro. Fora delas, botão desabilitado ficava idêntico a um clicável — a pessoa clicava, nada acontecia, e a conclusão era "o sistema travou" |
| `code` | Slug, código de plano e id do gateway existem para ser **copiados**, e apareciam sem nenhuma distinção da palavra ao lado |

O mesmo raciocínio vale no sentido inverso: `.platform-quota-bar.is-near` (faixa
de atenção antes do teto) e `.platform-split--wide` entraram na camada comum
porque descrevem uma situação que qualquer tela do painel pode ter, não um
detalhe de uma delas.

---

## 7. Gabarito

`frontend/src/features/platform/PlansAdmin.jsx` é a tela mais próxima do padrão:
`.stack` por fora, `.panel` + `<CrudHeader>` no bloco, `<DataView>` com `actions`
na linha, `<Modal>` para o formulário, `<ConfirmDeleteModal>` para a exclusão,
`.platform-facts` para o comparativo de preço, `.field-hint` para os textos de
apoio e `<code>` para o código do plano. O CSS próprio dela são **quatro
regras** — e cada uma tem, em comentário, o motivo de não haver equivalente.

Vale ler também o cabeçalho de `AccountsAdmin.jsx`: ele lista, em cinco linhas,
qual primitiva substituiu cada parte do sistema `aa-` que existia antes.

---

## 8. Mapa dos arquivos

| Arquivo | Papel |
| --- | --- |
| `frontend/src/styles.css` | Declara a ordem das camadas; `@layer base` (tokens + primitivas) e `@layer legado` (o histórico) |
| `frontend/src/styles/appshell.css` | `@layer app`. Autoridade do layout do shell e do CSS do `DataView` |
| `frontend/src/styles/platform-panel.css` | `@layer telas`. Camada única do painel `/plataforma` |
| `frontend/src/components/common/DataView.jsx` | Listagem padrão. Os typedefs no topo são o contrato |
| `frontend/src/components/common/Crud.jsx` | `Modal`, `ConfirmDeleteModal`, `CrudHeader`, `DataTable` |
| `frontend/src/components/common/Ui.jsx` | Campos, `Button`, `StatusBadge`, `AlertBlock` |
| `frontend/src/features/platform/PlansAdmin.jsx` | O gabarito |
| `frontend/src/styles/plans-admin.css` | Exemplo do "que sobra": 4 regras, cada uma justificada |
| `frontend/src/styles/accounts-admin.css` | O caso-limite: sobrou **nada**, e o arquivo continua lá para a próxima regra realmente específica ter um lugar óbvio |
