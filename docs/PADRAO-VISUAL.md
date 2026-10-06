# Padrão visual do frontend

Revisão de 06/10/2026: `ResponsiveEditableList` define as colunas de desktop pela variável CSS `--transaction-columns`. Em até 700px, cada linha passa a uma única coluna com rótulos e controles completos; não use `gridTemplateColumns` inline, pois ele impediria a regra móvel. Os pagamentos do atendimento usam esse componente, assim como vendas, compras e parcelas. O modal de agendamento desativa `overflow-anchor` no corpo para preservar a rolagem durante o recálculo financeiro.

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
| Ações de uma linha da listagem | `<RowActions>` | `components/common/Crud.jsx` |
| Formulário | `<Modal>` + `Input`/`Select`/`Textarea`/`Checkbox` | `components/common/Crud.jsx` e `Ui.jsx` |
| Formulário longo ou em etapas | `<FormWorkflow>` + `StepNavigator`/`FormSection`/`AdvancedFields` | `components/common/FormWorkflow.jsx` |
| Cabeçalho com botão "Novo" e atalhos da tela | `<CrudHeader>` (`actions` vira "Mais opções") | `components/common/Crud.jsx` |
| Confirmar exclusão | `<ConfirmDeleteModal>` | `components/common/Crud.jsx` |
| Escolher joia/item do estoque | `<SmartCombobox>` | `components/common/SmartCombobox.jsx` |
| Escolher de um cadastro simples, criando a opção na hora | `<SelectWithCreate>` | `components/common/SelectWithCreate.jsx` |
| Cartões de métrica no topo da tela | `<CollapsibleIndicators>` | `components/common/CollapsibleIndicators.jsx` |
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
| `DataView` | Listagem completa: busca, filtros avançados (em modal), ordenação por coluna, paginação e os estados de carregando/erro/vazio | `components/common/DataView.jsx` |
| `RowActions` | Ações da linha num único menu de três pontos ("Mais ações"); cada ação: `{ label, onClick, href, target, rel, danger, disabled }`. Nenhuma ação fica exposta (`primary` é aceito, mas ignorado) | `components/common/Crud.jsx` |
| `Modal` | Janela sobreposta (Radix Dialog), largura padrão (`modal-md`) ou ampla com `size="workspace"` (`modal-workspace`). Trava o scroll do body e **não** fecha no clique fora (`dismissible` libera, só em modal sem dados a perder). Com formulário alterado, X, Esc e os botões "Cancelar"/"Fechar" (ou `data-modal-cancel`) pedem confirmação: Sair sem salvar, Salvar, Continuar editando. Props `dirty`, `formId`, `confirmClose`; outros valores de `size` mantêm a largura padrão | `components/common/Crud.jsx` |
| `useModal()` | Dentro de um `Modal`: `requestClose`, `markDirty`, `dirty` e o contêiner onde camadas flutuantes devem montar | `components/common/Crud.jsx` |
| `ConfirmDeleteModal` | Exclusão com palavra digitada (padrão "SIM"). Use em **toda** exclusão | `components/common/Crud.jsx` |
| `CrudHeader` | Título + subtítulo + botão de ação; `actions` (`{ label, icon, onClick }`) vira o menu "Mais opções" antes do botão | `components/common/Crud.jsx` |
| `DropdownMenu` | Radix reexportado para menus próprios de uma tela | `components/common/Crud.jsx` |
| `Input` `Select` `Textarea` `Checkbox` | Campos controlados; `onChange` recebe o **valor**, não o evento. `Select` e `Checkbox` são Radix; `Select` aceita `<option>` como filhos | `components/common/Ui.jsx` |
| `Tabs` | Composição `Tabs.List`, `Tabs.Trigger`, `Tabs.Content`; `onChange`/`onValueChange` recebem a aba | `components/common/Ui.jsx` |
| `Accordion` | Composição `Accordion.Item`, `Header`, `Trigger`, `Content`; suporta `single` e `multiple` | `components/common/Ui.jsx` |
| `Switch` | Toggle Radix; `onChange` recebe booleano; `switchClassName` estiliza só o controle | `components/common/Ui.jsx` |
| `Input` / `Textarea` | `className` vai ao controle nativo e `fieldClassName` ao invólucro; demais atributos HTML são encaminhados. `Textarea` aceita `hint` (vira `.field-hint`) | `components/common/Ui.jsx` |
| `Button` | `variant`: `primary` \| `secondary` \| `ghost` \| `danger`; encaminha atributos e `ref` ao `<button>` | `components/common/Ui.jsx` |
| `StatusBadge` | Selo colorido; mapeia o texto do status para o tom | `components/common/Ui.jsx` |
| `AlertBlock` | Lista de avisos com estado vazio embutido | `components/common/Ui.jsx` |
| `SmartCombobox` | Busca de joias com foto, SKU, preço e estoque. Dentro de um `Modal`, a lista monta no próprio diálogo; até 640px vira folha inferior com busca própria | `components/common/SmartCombobox.jsx` |
| `SelectWithCreate` | `Select` de cadastro simples (categoria, centro de custo, fornecedor) com atalho para criar a opção sem sair do formulário; `onCreate(name)` devolve o registro criado | `components/common/SelectWithCreate.jsx` |
| `FormWorkflow` `FormPage` `FormSection` `StepNavigator` `AdvancedFields` `ValidationSummary` `ReviewSummary` | Estrutura de formulário longo: etapas, seções, campos avançados recolhidos, resumo de erros e de revisão; `mobileFullscreen` ocupa a tela no celular | `components/common/FormWorkflow.jsx` (+ `form-workflow.css`) |
| `useFormDraft` | Rascunho local no `localStorage` por clínica, usuário e formulário (`aura:form-draft:…`); com rascunho anterior, a gravação pausa até `restoreDraft` ou `discardDraft`. Nada vai ao backend antes de salvar | `lib/useFormDraft.js` |
| `ResponsiveEditableList` / `TransactionTotals` | Itens de uma transação: tabela no desktop e cartões no celular, sem rolagem horizontal; totais da operação | `components/common/TransactionFields.jsx` (+ `transaction-fields.css`) |
| `InstallmentGrid` | Parcelas automáticas ou editadas à mão (editar uma linha desliga o automático) | `components/common/InstallmentGrid.jsx` |
| `CollapsibleIndicators` | Envolve os cartões de métrica com "Ocultar indicadores"/"Mostrar indicadores"; a escolha fica no `localStorage` por clínica, usuário e tela (`screenId`) | `components/common/CollapsibleIndicators.jsx` |
| `LegalDocumentModal` / `useLegalDocuments` | Termos de Uso e Política de Privacidade em modal (título, versão, parágrafos) | `components/common/LegalDocumentModal.jsx` |
| `PlanUpgradeNotice` | Explica o bloqueio de plano no ponto da ação | `components/common/PlanUpgradeNotice.jsx` |
| `SignaturePad` | Assinatura desenhada (mouse, caneta ou dedo); devolve data URL PNG | `components/common/SignaturePad.jsx` |

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

### Padrões de lista, navegação e modal

- **Filtros em modal.** O botão "Filtros" do `DataView` (com contador) abre um
  `Modal` com "Cancelar", "Limpar" e "Aplicar filtros"; o que está ativo
  aparece como chips em "Filtros aplicados:", com "Limpar filtros". Período e
  filtros de uma tela entram como `filters` do `DataView`, não como barra
  própria.
- **Só os registros rolam no desktop.** `.dataview > .data-table-wrap` mantém
  altura limitada e cabeçalho fixo; busca, filtros e paginação ficam visíveis.
  Até 720px, os cards acompanham a rolagem da página, sem uma segunda área
  vertical de rolagem dentro da listagem.
- **Tabela a partir de 721px**: `table-layout: auto`, largura mínima de 160px
  por coluna e rolagem horizontal contida no bloco. Palavras quebram nos espaços;
  valores monetários não quebram por dígito. Até 720px a linha vira cartão com
  rótulos (`data-label`); relatórios e telas até 480px empilham rótulo e valor.
  Filtros, menus, paginação e seletores mantêm alvos de toque de pelo menos 44px;
  campos usam 16px em dispositivos de toque para evitar o zoom automático do iOS.
- **Filtros com uma única origem.** `DataView` aplica filtros e busca em memória
  por padrão. Quando a API já os aplicou, use `queryMode="external"`, inclusive
  em relatórios com paginação local. `mode="server"` continua reservando a
  paginação/contagem para a API. Exportações recebem filtros, busca e ordenação,
  removendo somente `limit` e `offset`.
- **Ações.** Da linha: `RowActions`, sempre o menu de três pontos. Da tela:
  `actions` do `CrudHeader` ("Mais opções"), antes do botão principal. O menu
  lateral não tem submenus (`Sidebar.jsx` fixa `visibleChildren: []` e
  `frontend/tests/appPages.test.mjs` proíbe `menuChildren`): atalho para
  subpágina mora no "Mais opções" da tela.
- **Indicadores** no topo da tela vão dentro de `CollapsibleIndicators`.
- **Modal com largura padrão e opção ampla.** Por padrão, o `Modal` renderiza
  `modal-card modal-md`, com `width: min(640px, 100%)` (`styles.css`).
  `size="workspace"` renderiza `modal-card modal-workspace`, usado nos formulários
  de agendamento: até 1280px de largura e altura da janela menos 32px no desktop
  (`styles/appointment-workspace.css`). Outros valores de `size` usam `modal-md`;
  as regras `.modal-card.modal-sm`/`.modal-lg` não são alcançadas pelo `Modal`.
- **Celular.** Até 620px o modal ocupa a tela cheia (`100dvh`, sem cantos, rodapé
  com botões em coluna e área segura). `frontend/index.html` usa
  `viewport-fit=cover, interactive-widget=resizes-content`: com o teclado aberto
  a página encolhe em vez de cobrir os campos.

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
| `telas` | CSS de tela: `topnav`, `landing`, `legal`, `auth`, `directory`, `settings`, `catalog-v2`, `operations-responsive`, `responsive`, `platform-panel` e os CSS por tela do painel | **você** |
| `app` | `appshell.css`, o layout do shell | quem mexe no shell |

A ordem de import em `main.jsx` é: `styles.css` (primeiro, porque declara as
camadas), `topnav`, `landing`, `legal`, `auth`, `directory`, `settings`,
`appshell`, `catalog-v2`, `operations-responsive` e, por último,
`responsive.css` (invariantes responsivas do produto). Como
`operations-responsive.css` e `responsive.css` estão em `telas`, vir por último
só os faz vencer **dentro** de `telas`: o `appshell.css` (`app`) continua
ganhando deles. Os demais CSS de tela (`platform-panel`, `plans-admin`,
`agenda-admin-responsive` etc.) são importados pelo componente que os usa.

### A parte contraintuitiva

**Camada posterior vence, independentemente de especificidade.** Uma regra
`.app-shell .main-content .content-scroll` (especificidade 0-3-0) escrita em
`telas` **perde** para um `.content-scroll` nu (0-1-0) escrito em `app`. A
especificidade só desempata *dentro* da mesma camada.

Isso é o oposto do que a intuição diz, e é justamente o que torna o sistema
previsível: `appshell.css` não precisa disputar seletor com as quase 12 mil linhas do
`styles.css`. Ele ganha por estar na última camada.

Duas consequências que mordem:

1. **CSS fora de camada vence CSS de qualquer camada.** Um arquivo `.css` novo
   sem `@layer telas { … }` em volta passa a ganhar de tudo — inclusive do
   `appshell.css` — e o visual do sistema inteiro muda por acidente de ordem de
   importação. Por isso **todo** arquivo de `frontend/src/styles/` está
   envolvido num bloco de camada, e `frontend/tests/UiArchitecture.test.mjs`
   falha se algum ficar sem `@layer`. O teste só olha essa pasta; hoje ficam
   **fora de camada** (e vencem qualquer camada): o trecho final de
   `styles.css`, depois de `} /* fim de @layer legado */` (seletor de joias
   `.smart-combobox-*`, resumo financeiro `.financial-*` e blocos da vitrine),
   `components/common/form-workflow.css`,
   `components/common/transaction-fields.css`, `features/clients/clients.css`,
   `features/access/access-admin.css` e os `*.module.css` de
   `features/catalog/`. Não acrescente regra nova a esses trechos sem envolvê-la
   numa camada.
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

No painel `/plataforma`, o cabeçalho e o `.content-scroll` ficam dentro de
`.platform-tabs-root`, que precisa ser coluna flex com `min-height: 0` e
`overflow: hidden` (`styles/platform-panel.css`) — sem isso a rolagem volta a
sumir. O `UiArchitecture.test.mjs` confere essas quatro propriedades.

Quando a tela precisa de controles fixos **dentro** da área rolável, a saída é
`position: sticky; top: 0` com fundo opaco, como `.agenda-sticky-controls` na
Agenda (título, seletor de visão e barra de busca/filtros; `z-index: 24` e uma
faixa opaca em `::before` para o calendário não aparecer por baixo).

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

Depois dessa rodada, outros anti-padrões passaram a ser barrados — alguns por
teste:

- **Controle complexo nativo.** `frontend/tests/UiArchitecture.test.mjs` falha
  se um `.jsx` de `components/`, `features/` ou `pages/` usar `<select>`,
  `<dialog>`, `<details>` ou `<input type="checkbox|radio">`: use `Select`,
  `Modal`, `Accordion`/`DropdownMenu` e `Checkbox`/`Switch`.
- **Radix importado na tela.** O mesmo teste proíbe `@radix-ui/*` em
  `features/` e `pages/`; nas telas, o Radix entra só por `components/common`
  (por isso `Crud.jsx` reexporta `DropdownMenu`). Fora dessas pastas, só o
  shell em `main.jsx` importa o `DropdownMenu` do Radix direto.
- **Painel montando telas ocultas.** `PlatformAdmin.jsx` monta só a aba ativa
  (`<Tabs.Content key={tab} …>`, sem `forceMount`); o teste também trava isso.
- **Botões de ação expostos na linha.** Ação de linha vai no `RowActions`.
- **Variável CSS que não existe.** Os tokens são os do `:root` de `styles.css`
  (`--ink`, `--muted`, `--line`, `--paper`, `--white`, `--gold`, `--ok`,
  `--warn`, `--danger`, `--info`…). `--border`, `--surface*`, `--text` e
  `--accent` não existem. `--border`, `--surface*` e `--text` ainda aparecem,
  com valor de reserva, em
  `form-workflow.css`, `transaction-fields.css`, `content-hub.css`,
  `myplan.css` e `access-admin.css`, e caem sempre no valor fixo.

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
na linha (via `<RowActions>`), `<Modal>` para o formulário, `<ConfirmDeleteModal>` para a exclusão,
`.platform-facts` para o comparativo de preço, `.field-hint` para os textos de
apoio e `<code>` para o código do plano. O CSS próprio dela são **quatro
regras** — e cada uma tem, em comentário, o motivo de não haver equivalente.

Vale ler também o cabeçalho de `AccountsAdmin.jsx`: ele lista, em seis linhas,
qual primitiva substituiu cada parte do sistema `aa-` que existia antes.

---

## 8. Mapa dos arquivos

| Arquivo | Papel |
| --- | --- |
| `frontend/src/main.jsx` | Ordem de import dos CSS globais (ver seção 3) |
| `frontend/index.html` | `viewport` com `viewport-fit=cover, interactive-widget=resizes-content` |
| `frontend/src/styles.css` | Declara a ordem das camadas; `@layer base` (tokens + primitivas), `@layer legado` (o histórico) e um trecho final fora de camada |
| `frontend/src/styles/appshell.css` | `@layer app`. Autoridade do layout do shell e do CSS do `DataView` |
| `frontend/src/styles/responsive.css` / `operations-responsive.css` | `@layer telas`. Ajustes de celular do produto e das telas internas, importados por último em `main.jsx` |
| `frontend/src/styles/agenda-admin-responsive.css` | `@layer telas`. Ajustes da Agenda, Dashboard e Configurações, importado por essas telas |
| `frontend/src/styles/platform-panel.css` | `@layer telas`. Camada única do painel `/plataforma` |
| `frontend/src/components/common/DataView.jsx` | Listagem padrão. Os typedefs no topo são o contrato |
| `frontend/src/components/common/Crud.jsx` | `Modal`, `useModal`, `ConfirmDeleteModal`, `CrudHeader`, `RowActions`, `DropdownMenu` |
| `frontend/src/components/common/Ui.jsx` | Campos (Radix em `Select`/`Checkbox`), `Button`, `Tabs`, `Accordion`, `Switch`, `StatusBadge`, `AlertBlock` |
| `frontend/src/components/common/FormWorkflow.jsx` + `form-workflow.css` | Base de formulários longos e em etapas |
| `frontend/src/lib/useFormDraft.js` | Rascunho local de formulário |
| `frontend/tests/UiArchitecture.test.mjs` | Trava as regras: sem controle nativo complexo, nenhum import de Radix em `features/` e `pages/`, `@layer` em `styles/`, painel montando só a aba ativa |
| `frontend/src/features/platform/PlansAdmin.jsx` | O gabarito |
| `frontend/src/styles/plans-admin.css` | Exemplo do "que sobra": 4 regras, cada uma justificada |
| `frontend/src/styles/accounts-admin.css` | O caso-limite: sobrou **nada**, e o arquivo continua lá para a próxima regra realmente específica ter um lugar óbvio |
