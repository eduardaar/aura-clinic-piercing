# Roadmap de limpeza de legado — pós-lançamento

> **Situação em 30/09/2026:** a maior parte dos trabalhos transferidos foi
> executada em 30 e 31/08 e chegou à `main` pelo merge `10c51bca` da branch
> `release/setembro-2026`; a execução de cada item está anotada abaixo. Ficaram
> pendentes a baseline pré-lançamento e parte das remoções no mesmo lote (aliases e
> resíduos listados na Fase 3). A limpeza restante deste roadmap não começou: o
> roadmap de setembro não tem registro de conclusão nem de decisão Go/No-Go, e a
> tabela "Registro dos lotes" segue sem lote. O estado vivo está em
> [ESTADO-ATUAL.md](./ESTADO-ATUAL.md).

> Plano exclusivo para a limpeza ampla que permanecer depois da conclusão do
> `ROADMAP-LANCAMENTO-SETEMBRO-2026.md`. As consolidações necessárias para as
> novas regras de negócio foram antecipadas ao lançamento e estão registradas
> abaixo como transferidas.

## Objetivo

Deixar frontend, backend, banco, testes e documentação sem código morto,
dependências sem uso, estilos abandonados, scripts obsoletos ou caminhos de
compatibilidade que não participam mais do produto em produção.

## Trabalhos transferidos para o roadmap de lançamento

Estes itens não são mais pendências deste roadmap. Serão eliminados no mesmo lote
que implantar seus substitutos, conforme o estudo técnico de execução:

> O `[x]` desta seção marca a transferência. A execução de cada item, conferida
> no código em 30/09/2026, está anotada ao lado.

- [x] Consolidar Serviço e Procedimento e remover a experiência duplicada. Executado em `2d3aafa3` (migration tenant `0035`); resta o alias somente leitura `GET /api/procedures`.
- [x] Criar execução própria de atendimento e retirar `ordem_servico` de Vendas. Executado em `c1176101` (migration `0019`) e `8584be9d`, que removeu a geração de venda pelo atendimento; `createSalesOrder` recusa `ordem_servico` (`backend/src/services/sales.js:221`).
- [x] Consolidar produtos, joias e materiais no Item de estoque e remover as cadeias antigas no cutover. Executado em `48e5bfa1` (migration `0025`, que apaga `consumables` e tabelas ligadas); restam aliases e o bloco legado do `schema.sql` (ver Fase 3).
- [x] Criar serviço/modelo central de auditoria e remover `admin_audit_logs`, que não possui escritor. Executado em `064d2404` (`audit_events`, migration `0017`) e `14686d5a` (remoção de `admin_audit_logs` do `schema.sql`).
- [x] Consolidar relatórios, filtros e exportadores síncronos/assíncronos. Executado em `39530ba2` e `02419dd3`; a exportação síncrona e o job `report_export` usam o mesmo `buildReport` (`backend/src/services/jobs.js:182`).
- [x] Criar componentes oficiais para formulários extensos, parcelas e listas responsivas. Executado em `fae82e5c`, `68a03299` e `cf32e294`.
- [x] Consolidar rotas, menu, títulos, permissões e recursos do plano em um registro de páginas. Executado em `52f365cb` (`frontend/src/lib/appPages.js`).
- [x] Remover telas, rotas, serviços e chamadas antigas no mesmo lote dos substitutos. Parcial: saíram `routes/consumables.js` e `Consumables.jsx`, mas ficaram os aliases listados na Fase 3.
- [x] Remover dependências, exports e helpers comprovadamente sem uso e corrigir a busca global falsa. Executado em `8018244d` (`react-router-dom`, `@aws-sdk/s3-request-presigner`, `legacyLocalDateValue` e `DataTable`) e `2cf86817` (busca global retirada).
- [x] Gerar a baseline pré-lançamento e retirar o bootstrap SQL duplicado, aproveitando que bases antigas podem ser descartadas. Não executado: as migrations `0001_baseline.sql` seguem como marco (`SELECT 1`) e a clínica nova ainda nasce de `schema.sql` (`backend/src/services/tenants.js:200`).

## Regra de início da limpeza restante

- [ ] Concluir o roadmap de lançamento de setembro de 2026.
- [ ] Encerrar bloqueios classificados como Go/No-Go.
- [ ] Manter a produção estável e observada antes de iniciar remoções amplas.
- [ ] Criar backup verificável e procedimento de restauração antes de migrations destrutivas.
- [ ] Congelar novas funcionalidades durante cada lote de limpeza.

## Regras obrigatórias

- Nenhum item será removido apenas por parecer antigo.
- Toda remoção precisa de evidência de não uso no código, dados e fluxos reais.
- Estruturas com dados reais devem ser migradas antes da remoção.
- A versão nova deve estar funcionando antes de desligar a antiga.
- Remoções de banco usam migrations versionadas, nunca alteração manual.
- Cada lote deve ser pequeno, recuperável e entregue separadamente.
- Compatibilidade não permanece indefinidamente sem uma versão suportada que a utilize.

## Fase 1 — inventário e classificação

- [ ] Mapear páginas, componentes, hooks, serviços e estilos restantes do frontend.
- [ ] Mapear rotas, middlewares, serviços, jobs e integrações restantes do backend.
- [ ] Mapear tabelas, colunas, índices, triggers e migrations da baseline lançada.
- [ ] Mapear scripts operacionais, configurações, assets e documentos.
- [ ] Mapear dependências diretas e confirmar quais são importadas.
- [ ] Relacionar telas a rotas e rotas a consumidores.
- [ ] Relacionar tabelas/colunas a pontos de leitura e escrita.
- [ ] Classificar candidatos como ativo, duplicado, legado necessário, substituído, morto ou desconhecido.
- [ ] Registrar evidência, risco, dados existentes, substituto e estratégia de remoção.

## Fase 2 — confirmar uso real

- [ ] Fazer análise estática de imports, exports, rotas, componentes e chamadas de API.
- [ ] Comparar rotas registradas com frontend, integrações, webhooks e jobs.
- [ ] Consultar volumes e datas de uso das tabelas candidatas sem alterar dados.
- [ ] Usar logs e telemetria de produção para confirmar caminhos acessados.
- [ ] Verificar recursos condicionados por plano, permissão ou configuração.
- [ ] Verificar fluxos públicos, e-mails, arquivos privados e URLs externas.
- [ ] Identificar testes que mantêm comportamentos antigos artificialmente.

## Fase 3 — candidatos restantes

Estes itens são candidatos, não autorização de remoção:

- [ ] Identificar componentes e estilos extraídos ou substituídos que permaneceram sem import.
- [ ] Revisar documentos de estudo, marcando o que é vigente, histórico ou substituído.
- [ ] Revisar dependências diretas e transitivas sem depender de pacote transitivo não declarado.
- [ ] Revisar scripts de migração, importação, auditoria e reconciliação que permanecerem depois da baseline.
- [ ] Revisar compatibilidade de rotas públicas, favoritos antigos, uploads e integrações observadas em produção.
- [ ] Resíduos do cutover de agosto, levantados no código em 30/09/2026: alias somente leitura `GET /api/procedures` (escritas em 410), ainda lido pela Agenda (`frontend/src/features/agenda/Agenda.jsx:352`); alias `GET/PUT /api/services/:id/consumables` (`backend/src/routes/services.js:176-177`); página `consumables` em `/app/materiais`, fora do menu, que só abre a visão Materiais de procedimento do Estoque unificado (`frontend/src/lib/appPages.js:65`); bloco `consumables`, `consumable_stock_movements` e `purchase_order_items.consumable_id` em `backend/src/db/schema.sql:1647-1676`; tipos de job `aura_jewelry_import` e `asaas_reconcile` sem executor (`backend/src/services/jobs.js:12`); código de submenu inerte em `frontend/src/components/layout/Sidebar.jsx` (`visibleChildren: []`, linha 20) com o CSS `.nav-submenu` (`frontend/src/styles/appshell.css:249`); CSS `.visual-search-*` sem tela (`frontend/src/styles.css:9810`); e `PlansPage` exportado sem uso, já que `/planos` redireciona para `/#planos` (`frontend/src/pages/Landing.jsx:378`).

## Fase 4 — limpeza ampla do frontend

- [ ] Remover componentes, hooks, helpers, estados e propriedades sem consumidor.
- [ ] Unificar componentes duplicados que executam a mesma responsabilidade.
- [ ] Remover CSS morto e regras conflitantes depois de confirmar telas responsivas e públicas.
- [ ] Revisar chunks, assets e exports órfãos usando dados do build e da produção.
- [ ] Avaliar arquivos grandes por responsabilidade, sem quebrá-los apenas por tamanho.
- [ ] Decidir, com base no produto estabilizado, se a navegação migra para React Router.

## Fase 5 — limpeza ampla do backend

- [ ] Unificar lógicas repetidas de autorização, idempotência, paginação, dinheiro, datas e arquivos.
- [ ] Remover jobs, filas e integrações sem uso comprovado em produção.
- [ ] Remover variáveis de ambiente antigas e atualizar exemplos e validações.
- [ ] Garantir que rotas internas, administrativas ou de diagnóstico não fiquem expostas sem necessidade.
- [ ] Avaliar ampliação gradual do typecheck somente nos módulos estabilizados.

## Fase 6 — otimização do banco

- [ ] Revisar índices duplicados ou sem utilidade com base nas consultas reais.
- [ ] Preservar registros financeiros, clínicos, fiscais e de auditoria conforme retenção.
- [ ] Normalizar datas e horários armazenados como texto com migration incremental.
- [ ] Revisar tamanho, crescimento, vacuum, consultas lentas e uso de índices.
- [ ] Testar atualização de base real e restauração de backup antes de cada lote.

## Fase 7 — testes e encerramento

- [ ] Executar fluxos essenciais após cada lote de remoção.
- [ ] Comparar saldos, parcelas, recebíveis e históricos antes/depois.
- [ ] Validar isolamento entre clínicas e arquivos privados.
- [ ] Executar build, testes e verificações de migrations.
- [ ] Confirmar por busca e telemetria que nomes removidos não possuem consumidores.
- [ ] Atualizar arquitetura, modelo de dados, API, fluxos e guia de desenvolvimento.
- [ ] Publicar registro final do que foi removido, mantido e adiado.

## Critérios para remover definitivamente

- [ ] Não possui consumidor ativo no frontend, backend, integração, job ou link público.
- [ ] Não é exigido por plano, permissão, configuração ou compatibilidade suportada.
- [ ] Seus dados foram migrados, preservados ou comprovadamente não existem.
- [ ] O substituto cobre a regra e está em produção.
- [ ] Existe migration/alteração versionada e recuperação clara.
- [ ] Testes e observação confirmam o comportamento esperado.
- [ ] A documentação não orienta mais o caminho removido.

## Registro dos lotes

| Lote | Escopo | Evidência de não uso | Migração | Validação | Estado |
| --- | --- | --- | --- | --- | --- |
|  |  |  |  |  | A planejar |

## Resultado esperado

- Nenhuma tela, rota, job ou script sem consumidor conhecido.
- Nenhuma dependência direta sem uso comprovado.
- Banco otimizado a partir de consultas reais.
- Migrations seguras para bases que já possuem dados de produção.
- Documentação alinhada ao sistema efetivamente publicado.
