# Roadmap de migração e padronização com Radix UI

## Objetivo

Consolidar a interface da Aura Clinic em componentes compartilhados, acessíveis e
responsivos, usando Radix UI para comportamentos complexos e HTML semântico
encapsulado para campos e botões básicos.

Radix UI não substitui `input`, `textarea` e `button`. Esses elementos continuam
HTML, mas devem ser consumidos por meio dos componentes de
`frontend/src/components/common/Ui.jsx`. Dialogs, menus, seleções, abas,
accordions e switches devem usar primitives Radix.

## Regras de execução

- Preservar comportamento, contratos da API, permissões e dados já existentes.
- Preferir `DataView`, `Modal`, `ConfirmDeleteModal`, `CrudHeader`, `RowActions`,
  `Button`, `Input`, `Textarea`, `Select`, `Checkbox` e `StatusBadge`.
- CSS comum fica na camada compartilhada; CSS específico deve usar `@layer telas`.
- Não criar um novo padrão visual por tela.
- Cada fase termina com testes, build e `git diff --check`.
- A migração só é concluída quando não houver controle complexo reimplementado
  manualmente sem justificativa documentada.

## Estado inicial auditado

- [x] `Dialog`, `Select`, `Checkbox` e `DropdownMenu` já usam Radix UI.
- [x] Não há `select`, `dialog`, checkbox ou radio nativos ativos nas telas.
- [x] Listagens de CRUD usam `DataView`; `DataTable` legado não possui consumidores.
- [x] Fundação responsiva criada para shell, modais, formulários e principais telas.
- [x] Abas operacionais migradas para `Tabs`; navegações especializadas foram
  preservadas como exceções semânticas.
- [x] Áreas expansíveis migradas de `details` para `Accordion`.
- [x] Toggles booleanos migrados para o componente `Switch` compartilhado.
- [x] Botões, inputs e textareas genéricos migrados para a UI comum; controles de
  upload, carrossel, calendário, galeria e radio cards permanecem especializados.

## Fase 1 — Fundação de componentes

Responsável: fundação compartilhada.

- [x] Instalar `@radix-ui/react-tabs`, `@radix-ui/react-accordion` e
  `@radix-ui/react-switch`.
- [x] Criar componentes compartilhados `Tabs`, `Accordion` e `Switch`.
- [x] Evoluir `Input`, `Textarea` e `Button` para aceitar os atributos HTML
  necessários sem obrigar as telas a contornar o componente.
- [x] Padronizar foco, teclado, estados desabilitados e responsividade.
- [x] Adicionar testes dos novos componentes.
- [x] Atualizar `PADRAO-VISUAL.md` e `ARQUITETURA.md`.

Critério de saída: primitives disponíveis, documentadas, testadas e sem regressão
nos componentes existentes.

## Fase 2 — Operação interna

### 2A — Agenda, estoque e vendas

- [x] Migrar abas da Agenda.
- [x] Migrar configurações avançadas da Agenda para `Accordion`.
- [x] Migrar abas do Estoque e do editor de produto.
- [x] Migrar toggles do Estoque para `Switch` quando forem estados booleanos.
- [x] Migrar abas de Vendas.
- [x] Substituir ações e campos diretos por componentes compartilhados.

### 2B — Clientes, financeiro e atendimento

- [x] Padronizar campos de Clientes e prontuários.
- [x] Padronizar campos de Financeiro e Contas a pagar.
- [x] Migrar expansível de composição financeira para `Accordion`.
- [x] Padronizar Pós-atendimento, Suporte e Termos.
- [x] Migrar etapas de Termos para `Tabs`.

### 2C — Administração da clínica

- [x] Migrar abas do Dashboard.
- [x] Migrar abas de Comunicações.
- [x] Padronizar Acessos, Integrações, Relatórios e Configurações.
- [x] Confirmar que todos os formulários seguem cabeçalho, corpo rolável e rodapé
  fixo do `Modal`.

Critério de saída: nenhuma tela interna usa uma implementação manual de tabs,
accordion, switch ou modal; exceções precisam estar comentadas no código.

## Fase 3 — Catálogo, plataforma e autenticação

### 3A — Catálogo administrativo e público

- [x] Migrar abas e histórico do editor de catálogo.
- [x] Padronizar botões e campos do editor sem comprometer drag-and-drop, upload
  e edição de imagens.
- [x] Migrar FAQ do catálogo para `Accordion`.
- [x] Padronizar controles da experiência pública mantendo semântica de
  carrossel, seleção e checkout.

### 3B — Plataforma e cobrança

- [x] Migrar abas do painel da plataforma.
- [x] Migrar expansível do Financeiro da plataforma.
- [x] Padronizar formulários de Contas, Meu Plano e editor da Landing.
- [x] Preservar os fluxos de checkout, suporte e administração de tenants.

### 3C — Autenticação

- [x] Padronizar Login e Cadastro com os componentes compartilhados.
- [x] Manter os modais legais em `Dialog` e o aceite em `Checkbox` Radix.
- [x] Validar teclado, foco inicial, mensagens de erro e preenchimento automático.

Critério de saída: plataforma, autenticação e áreas públicas usam a mesma base
visual e de acessibilidade, com exceções de interação explicitamente justificadas.

## Fase 4 — Auditoria e encerramento

- [x] Procurar controles nativos complexos e padrões duplicados restantes.
- [x] Verificar navegação por teclado e foco dos componentes Radix em testes.
- [x] Revisar por CSS/DOM os breakpoints de 360, 640, 900, 1180 e telas largas.
- [ ] Repetir a inspeção visual por navegador nos breakpoints quando a automação
  de navegador estiver disponível.
- [x] Executar a suíte completa de testes.
- [x] Executar build de produção.
- [x] Executar typecheck de frontend e backend.
- [x] Executar `git diff --check`.
- [x] Atualizar este roadmap com o resultado real e pendências justificadas.

## Matriz de execução paralela

| Frente | Escopo | Arquivos compartilhados permitidos |
| --- | --- | --- |
| Fundação | Primitives, estilos comuns, documentação e testes | `Ui.jsx`, CSS comum, package e docs |
| Operação | Agenda, estoque, vendas, clientes e atendimento | Somente arquivos das features atribuídas |
| Plataforma | Catálogo, plataforma, autenticação e público | Somente arquivos das features/páginas atribuídas |
| Integração | Auditoria, conflitos, testes e build | Ajustes pontuais após as frentes terminarem |

## Registro de execução

| Data | Fase | Resultado |
| --- | --- | --- |
| 2026-08-17 | Auditoria inicial | Migração parcial confirmada; roadmap criado e execução iniciada. |
| 2026-08-17 | Fase 1 — fundação | Tabs, Accordion e Switch Radix disponibilizados, com atributos HTML encaminhados nos campos, estilos e testes. |
| 2026-08-17 | Fase 2 — operação | Agenda, estoque, vendas, clientes, financeiro, termos, dashboard e comunicações migrados. |
| 2026-08-17 | Fase 3 — plataforma | Catálogo, plataforma, autenticação, cobrança e FAQ migrados; controles especializados preservados. |
| 2026-08-17 | Fase 4 — auditoria | Trava estrutural adicionada; testes, typecheck, build, API e banco validados. Inspeção visual automatizada ficou pendente por indisponibilidade do navegador na sessão. |
