# Estudo técnico de execução do roadmap de lançamento — setembro de 2026

## 1. Objetivo

Definir como transformar o roadmap de setembro em entregas pequenas, paralelas e
integráveis, usando agentes, automação e cortes diretos para concluir o produto no
menor tempo possível sem perder as garantias essenciais de uma plataforma clínica,
financeira e multi-tenant.

Este estudo parte de uma decisão explícita: dados antigos de desenvolvimento e
homologação podem ser descartados. Portanto, antes do primeiro dado real de
produção, o projeto não gastará tempo com backfills complexos, dual-write ou
compatibilidade prolongada com modelos substituídos.

Essa liberdade reduz trabalho de migração, mas não permite atalhos em:

- isolamento entre clínicas;
- autenticação e permissões;
- estoque, custos e lotes;
- financeiro, pagamentos, estornos e idempotência;
- arquivos privados e segredos;
- auditoria de eventos importantes;
- validação do XML fiscal.

## 2. Conclusão executiva

O caminho mais rápido não é reescrever o sistema, trocar framework nem converter
todo o projeto para TypeScript. A base atual é aproveitável: React/Vite, Express,
Postgres por schema, React Query, Radix, DataView, Zod, fila de jobs, storage
privado, migrations, testes e build já existem.

A aceleração virá de cinco decisões:

1. definir uma fonte de verdade antes de abrir cada frente;
2. trabalhar por fatias verticais completas, não por camada isolada;
3. usar agentes em worktrees e bancos separados;
4. remover o caminho antigo no mesmo lote em que o substituto entra;
5. usar codemod somente em alterações mecânicas e testes direcionados durante o desenvolvimento.

Com quatro slots de agentes, a configuração recomendada é um integrador e três
executores. O integrador controla contratos e hotspots; os executores entregam
fatias verticais com backend, frontend e testes relacionados.

## 3. Estado técnico relevante

### 3.1 Backend e banco

- O backend monta cerca de quarenta routers em `backend/src/index.js`.
- O schema de cada clínica ainda nasce de `schema.sql` e depois recebe migrations.
- As migrations `0001_baseline` não criam uma base vazia; apenas marcam o estado criado pelos schemas SQL.
- O projeto possui duas fontes de verdade transitórias: schemas idempotentes e migrations versionadas.
- A suíte backend possui aproximadamente sessenta arquivos e roda serialmente.
- O runner aceita um arquivo isolado, mas atualmente ignora arquivos adicionais.

### 3.2 Frontend

- Existe um shell único em `frontend/src/main.jsx`, com telas carregadas por `React.lazy`.
- Rota, título, grupo de menu, permissão e feature do plano estão espalhados por arquivos diferentes.
- A aplicação usa History API própria; `react-router-dom` está instalado sem import.
- `DataView` já suporta modo de servidor e pode sustentar as novas grids.
- `InstallmentGrid` já fornece a base para parcelas de Compra, Venda e Atendimento.
- Existem arquivos grandes e hotspots; quebrá-los apenas por tamanho agora criaria colisão sem retorno de produto.

### 3.3 Qualidade existente

- Biome está instalado e pode verificar apenas os arquivos alterados.
- O typecheck usa JavaScript com `checkJs`, mas cobre somente uma parte pequena do sistema.
- Backend permite teste por arquivo; frontend permite Node Test e Vitest por arquivo.
- Build e suítes completas existem e devem ser usados nos pontos de integração.
- Node está inconsistente entre documentação, ambiente, CI e Vite; deve ser fixado em `20.19+`.

## 4. Arquitetura-alvo mínima para o lançamento

### 4.1 Registro único de páginas

Criar `APP_PAGES` no frontend com ID, rota, título, grupo, ícone, componente
lazy, permissão, feature do plano, visibilidade no menu e aliases temporários.
O shell, Sidebar, títulos e guardas passam a consumir o mesmo registro.

### 4.2 Permissões dirigidas pelo backend

O backend permanece como fonte oficial e passa a entregar grupo, rótulo,
descrição, risco e perfis padrão. Criar:

- `access_profiles`;
- `access_profile_permissions`;
- `users.access_profile_id`;
- `users.professional_id`;
- overrides individuais apenas como exceção.

O vínculo com profissional resolve também os relatórios do próprio usuário.

### 4.3 Auditoria central

Criar `audit_events` e `auditService.record()` com data/hora, ator, perfil
efetivo, módulo, ação, entidade, antes/depois, motivo, IP, user-agent e
request-id. A sanitização de segredos e dados sensíveis é obrigatória.

As escritas novas usam apenas esse serviço. As tabelas antigas saem quando não
houver leitores/escritores. `admin_audit_logs`, sem escritor, pode sair da nova
baseline diretamente.

### 4.4 Procedimento e execução do atendimento

Usar `services` como nome técnico da entidade central, exibida como
**Procedimento/Tipo de atendimento**. Ampliar essa entidade e remover `procedures`.

Criar `service_executions`, `service_execution_items`, snapshot do procedimento,
valores separados de serviço e produto, check-in, início, conclusão, checklist e
recebíveis com origem `service_execution`.

Ao entrar esse fluxo, remover `ordem_servico` de `sales_orders`. Não fazer escrita
dupla nem migrar dados descartáveis.

### 4.5 Item de estoque

Criar `inventory_items`, variantes e flags: vendável, utilizável em procedimento,
controlado em estoque, controlado por lote/validade e publicável no catálogo.

Um serviço único controla saldo, custo e movimento. Compras, Vendas, Agenda,
Catálogo, Reservas, Contagem e Relatórios passam a consumi-lo. No cutover,
remover `jewelry_inventory`, `consumables` e movimentos paralelos, mantendo apenas
extensões de joia/catálogo ligadas ao item.

### 4.6 Compras e NF-e

O importador produz um rascunho normalizado; a confirmação chama o serviço
transacional oficial de Compras. Adicionar:

- parser XML declarado diretamente, preferencialmente `fast-xml-parser`;
- middleware em memória, limite de tamanho e bloqueio de `DOCTYPE`/entidades;
- `purchase_imports`, chave, hash, protocolo, número, série e arquivo privado;
- preview e associação de fornecedor/itens;
- conferência de totais, frete, desconto e parcelas;
- aplicação idempotente pelo serviço de Compras.

NF-e começa somente depois de Fornecedor e Item de estoque estarem estáveis.

### 4.7 Relatórios configuráveis

Criar no backend `REPORT_DEFINITIONS` com categoria, código, título, descrição,
permissão, feature, filtros, colunas, executor e formatos.

A rota síncrona e o worker usam o mesmo `reportQueryService` e
`reportExportService`. CSV/TXT usam streaming; XLSX usa writer adequado ao volume;
PDF fica restrito a resumo e colunas selecionadas.

### 4.8 SMTP e identidade do remetente

Manter, para o lançamento, a configuração SMTP global no painel da plataforma,
conforme o fluxo já solicitado e implementado. Reutilizar o cofre e a fila
existentes para mensagens da Aura e das clínicas, mas separar templates, nome do
remetente, `reply-to`, opt-in e histórico por tenant. SMTP próprio por clínica
será uma evolução opcional e não deve ampliar o escopo de setembro sem nova
decisão de produto.

## 5. Modelo de trabalho com agentes

### 5.1 Estrutura

- **Integrador:** contratos, migrations, registro de páginas, permissões, integração e release.
- **Agente 1:** Clientes, Fornecedores e Rascunhos.
- **Agente 2:** Agenda, Procedimentos e Execução.
- **Agente 3:** Estoque, Compras e Vendas.

Os agentes são reciclados entre ondas. Relatórios, NF-e e comunicações entram
depois que seus contratos dependentes estabilizarem.

### 5.2 Worktrees

```powershell
git switch -c release/setembro-2026
git worktree add ..\aura-clientes -b feat/clientes release/setembro-2026
git worktree add ..\aura-agenda -b feat/agenda release/setembro-2026
git worktree add ..\aura-estoque -b feat/estoque-compras release/setembro-2026
```

Cada worktree deve possuir banco, porta, `.env` e branch próprios. Testes backend
não devem rodar simultaneamente sobre o mesmo `DATABASE_URL`.

### 5.3 Arquivos de propriedade exclusiva

Somente o integrador altera, salvo coordenação explícita:

- schemas SQL, migrations e `backend/src/index.js`;
- catálogos de permissão e schemas Zod compartilhados;
- `frontend/src/main.jsx`, registro de páginas, Sidebar e permissões;
- `defaultForms.js`, CSS global, pacotes, lockfiles e roadmaps.

Agentes de feature criam CSS no arquivo do próprio domínio.

### 5.4 Contrato de entrega

Cada tarefa termina com migration, quando necessária; endpoint e validação;
interface desktop/mobile; permissão e auditoria; teste do fluxo principal e de
uma falha relevante; remoção do caminho substituído; e commit pequeno.

## 6. Ondas de execução

### Onda 0 — 30 de agosto a 2 de setembro: fundação serial

- abrir branch de release e worktrees;
- fixar Node `20.19+`;
- criar `check:changed`, `verify:static` e `verify:full`;
- ajustar o runner backend para vários testes;
- reservar migrations;
- definir contratos de Cliente, Procedimento, Execução, Item, Fornecedor, Auditoria e Relatório;
- criar registro de páginas e componentes de formulário/rascunho/itens/revisão;
- remover candidatos mecânicos comprovados.

Saída: agentes trabalham sem decidir nomes nem editar os mesmos arquivos.

### Onda 1 — 3 a 8 de setembro: cadastros e governança

- **Agente 1:** Cliente, PT-BR, duplicidade, perfil, linha do tempo e rascunho.
- **Agente 2:** Perfis, permissões, vínculo profissional e auditoria central.
- **Agente 3:** Fornecedor e relacionamento inicial com Item de estoque.
- **Integrador:** componentes compartilhados, contratos e integração diária.

Saída: cadastros-base e governança prontos para fluxos transacionais.

### Onda 2 — 9 a 15 de setembro: fontes de verdade operacionais

- Item de estoque único, variantes, lotes e movimentos;
- Procedimento único e configurações da Agenda;
- Compra e Venda adaptadas ao Item;
- remoção de Materiais e Procedimentos antigos após encerrar consumidores.

Estoque e atendimento não devem alterar simultaneamente o mesmo serviço de
baixa. O contrato de Item entra primeiro; Agenda consome depois.

### Onda 3 — 16 a 20 de setembro: execução e financeiro

- criar `service_executions` e fechamento do atendimento;
- retirar `ordem_servico` de Vendas;
- adaptar pagamento, recebíveis, cancelamento, crédito, comissão e pós-atendimento;
- ligar os eventos da Agenda ao SMTP global configurado no painel, com identidade e rastreamento por clínica;
- importar NF-e sobre Fornecedor, Item e Compra consolidados.

Saída: Atendimento, Venda e Compra têm origens separadas e conciliadas.

### Onda 4 — 21 a 24 de setembro: gestão e superfície final

- concluir Central de relatórios, Auditoria e Perfis;
- reorganizar menu, submenus e ações rápidas;
- integrar Termos e Pós-atendimento ao perfil;
- criar documentos legais, Manual e Novidades;
- implementar ou retirar a busca global falsa;
- remover aliases, rotas e telas substituídas.

### Onda 5 — 25 a 27 de setembro: baseline e release candidate

- aplicar tudo numa base descartável;
- gerar baselines com `pg_dump --schema-only`;
- atualizar provisionamento para usar somente migrations;
- remover schemas/bootstrap duplicados e scripts substituídos;
- zerar a base e criar uma clínica do zero;
- validar SMTP, R2 e Asaas reais/sandbox;
- executar suítes completas, build, isolamento, migrations e homologação crítica;
- congelar escopo e corrigir apenas bloqueios.

### Onda 6 — 28 a 30 de setembro: lançamento

- provisionar a primeira clínica real;
- executar operação controlada;
- observar erros, fila, e-mails, pagamentos e storage;
- corrigir somente bloqueios e decidir Go/No-Go.

## 7. Pacotes e dependências

| ID | Pacote | Depende de | Critério de saída |
| --- | --- | --- | --- |
| FND-01 | Ferramentas, scripts e Node | Nenhum | Verificação rápida reproduzível |
| FND-02 | Registro de páginas e UI de formulários | FND-01 | Menu e formulários usam componentes oficiais |
| ACC-01 | Perfis e permissões | Contratos | Usuário nasce com perfil claro |
| AUD-01 | Auditoria central | ACC-01 | Eventos consultáveis e sanitizados |
| CLI-01 | Cliente e normalização | FND-02 | Cadastro curto, duplicidade e perfil funcionam |
| CLI-02 | Termos, pós e linha do tempo | CLI-01, AUD-01 | Histórico central e filas operacionais |
| SUP-01 | Fornecedor | FND-02 | Cadastro opcional e documentos normalizados |
| INV-01 | Item de estoque | SUP-01 | Uma identidade, saldo, custo e movimento |
| PROC-01 | Procedimento único | FND-02 | Um cadastro oficial e configurável |
| PUR-01 | Compra consolidada | INV-01, SUP-01 | Estoque e contas a pagar idempotentes |
| SALE-01 | Venda consolidada | INV-01 | Venda avulsa sem semântica de atendimento |
| EXEC-01 | Execução de atendimento | PROC-01, INV-01, AUD-01 | Fechamento sem `ordem_servico` |
| MAIL-01 | SMTP global e eventos por clínica | AUD-01, EXEC-01 parcial | Mensagens rastreadas e configuráveis no painel da plataforma |
| NFE-01 | Importação NF-e | SUP-01, INV-01, PUR-01 | Preview e aplicação idempotente |
| REP-01 | Motor de relatórios | Modelos finais | Grid e quatro exportações pela mesma definição |
| PUB-01 | Legal, Manual e Novidades | FND-02 | Conteýo publicado e acessível |
| REL-01 | Baseline e release | Todos | Base vazia gera plataforma e clínica completas |

## 8. Conversores rápidos e geração de código

### Ferramentas

- **Biome:** formatação, imports sem uso e validação do que foi tocado.
- **jscodeshift:** instalar somente se houver mudança mecânica em muitos arquivos.
- **Knip:** diagnóstico de arquivos, exports e dependências; sem remoção automática.
- **pg_dump:** converter a estrutura Postgres final na baseline.
- **rg:** inventário e gates que falham se nomes legados permanecerem.
- **Registros declarativos:** gerar UI de relatórios, menu e permissões sem duplicar configuração.

Codemods podem atualizar imports, nomes, props, IDs de página, endpoints
inequívocos e arrays homogêneos de colunas. O fluxo é fixture, dry-run, revisão do
diff, aplicação, Biome e teste direcionado.

Não usar codemod para fusão de entidades, SQL financeiro/fiscal, recebíveis,
pagamentos, estoque, cancelamento, crédito, permissões ou rateios da NF-e.

## 9. Estratégia de banco sem dados antigos

### Durante o desenvolvimento

- migrations `0017+` separadas por fatia;
- sem backfill e sem dual-write;
- sem manter endpoint antigo e novo por várias ondas;
- banco isolado e descartável por agente;
- integrador controla versões e sincroniza schema.

### No candidato a release

1. aplicar schemas atuais e migrations numa base limpa;
2. gerar DDL final com `pg_dump --schema-only --no-owner --no-privileges`;
3. separar baseline de plataforma e tenant;
4. atualizar provisionamento e runner;
5. remover schemas SQL e bootstrap global duplicado;
6. retirar migrations/scripts incompatíveis com a nova baseline;
7. zerar a base;
8. criar plataforma, superadmin e clínica somente pelas migrations;
9. executar o fluxo crítico.

Antes do reset, conferir somente alvo e travas de ambiente. Não é necessário
auditar registros antigos; é obrigatório impedir que desenvolvimento atinja uma
base real. Depois da primeira clínica real, migrations voltam a ser imutáveis,
incrementais e obrigadas a preservar dados.

## 10. Validação rápida

### Nível 1 — a cada tarefa

- Biome nos arquivos alterados;
- teste unitário do normalizador/serviço;
- um teste do fluxo principal e um de erro relevante.

### Nível 2 — a cada fatia integrada

- testes backend e componentes relacionados;
- build do frontend;
- busca por nomes/rotas legadas removidas;
- criação do recurso em tenant limpo.

### Nível 3 — ao fechar uma onda

- typecheck, reconhecendo cobertura parcial;
- suítes backend/frontend completas;
- migrations verify/status;
- isolamento multi-tenant quando a onda altera dados ou autenticação.

### Nível 4 — release candidate

- instalação limpa, homologação crítica, backup/restauração;
- R2 real, Asaas sandbox/webhook, SMTP real e arquivos privados;
- operação controlada de cadastro, agenda, atendimento, compra, venda e financeiro.

| Trilha | Testes backend principais |
| --- | --- |
| Agenda/Execução | `flow`, `crud`, `reservations`, `transactions`, `installments` |
| Estoque/Compras | `purchases`, `operationalReversals`, `inventoryIntelligence`, `transactions` |
| Acesso/Auditoria | `permissions`, `rbac`, `security`, `privacy` |
| SMTP | `emailProvider`, `platformEmail`, `smtpVault`, `communications` |
| Relatórios | `reports`, `jobs` |
| Banco | `migrations`, `migration-policy`, `db` |

## 11. Limpeza incorporada e adiada

### Incorporada ao lançamento

- registro único de navegação;
- remoção de telas/rotas substituídas no mesmo cutover;
- Procedimento e Item de estoque únicos;
- execução de atendimento fora de Vendas;
- auditoria e relatórios centralizados;
- baseline completa e retirada do bootstrap duplicado;
- remoção de dependências/exports sem consumidor;
- correção ou retirada da busca global falsa;
- consolidação dos exportadores;
- remoção de jobs declarados que o worker não executa, após gate estático.

### Adiada para depois

- React Router, limpeza ampla de CSS, TypeScript total e npm workspaces;
- quebra de arquivos apenas por tamanho;
- normalização global de datas `TEXT`;
- revisão de índices baseada em produção;
- unificação genérica de helpers/middlewares;
- OpenAPI completo, ORM e remoção ampla de scripts/documentos históricos.

## 12. Riscos e contenção

| Risco | Impacto | Contenção |
| --- | --- | --- |
| Agentes editarem o mesmo hotspot | Alto retrabalho | Propriedade exclusiva e worktrees |
| Estoque e Agenda discordarem do Item | Saldo incorreto | Contrato de Item antes dos consumidores |
| Execução duplicar recebível | Perda financeira | Origem idempotente e teste transacional |
| NF-e criar item/fornecedor errado | Estoque incorreto | Preview e confirmação manual |
| Auditoria vazar segredo | Incidente | Sanitização central e testes |
| Codemod alterar semântica | Regressão silenciosa | Somente transformação mecânica |
| Reset atingir base errada | Perda de dados | Travas local/não-produção |
| Baseline não criar tenant | Cadastro bloqueado | Teste em instalação vazia |
| Escopo exceder setembro | Atraso | Recursos avançados não bloqueiam fluxo básico |

## 13. Definição de pronto

Uma tarefa termina quando o contrato oficial, backend, interface desktop/mobile,
permissão, plano, auditoria, estados de tela e testes direcionados estão prontos;
o caminho antigo foi removido; a documentação foi atualizada; e não ficou TODO
ocultando uma regra obrigatória para produção.

## 14. Primeiro lote recomendado

1. integrar os documentos atuais na branch de release;
2. criar worktrees e bancos isolados;
3. fixar Node e comandos rápidos;
4. ajustar o runner de testes;
5. criar registro de páginas;
6. definir DDL e contratos das fontes de verdade;
7. reservar migrations e donos de hotspots;
8. abrir somente então as três frentes paralelas.

Esse lote curto evita que velocidade inicial gere retrabalho nas semanas críticas.
