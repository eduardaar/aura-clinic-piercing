# Roadmap de limpeza de legado — pós-lançamento

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

- [x] Consolidar Serviço e Procedimento e remover a experiência duplicada.
- [x] Criar execução própria de atendimento e retirar `ordem_servico` de Vendas.
- [x] Consolidar produtos, joias e materiais no Item de estoque e remover as cadeias antigas no cutover.
- [x] Criar serviço/modelo central de auditoria e remover `admin_audit_logs`, que não possui escritor.
- [x] Consolidar relatórios, filtros e exportadores síncronos/assíncronos.
- [x] Criar componentes oficiais para formulários extensos, parcelas e listas responsivas.
- [x] Consolidar rotas, menu, títulos, permissões e recursos do plano em um registro de páginas.
- [x] Remover telas, rotas, serviços e chamadas antigas no mesmo lote dos substitutos.
- [x] Remover dependências, exports e helpers comprovadamente sem uso e corrigir a busca global falsa.
- [x] Gerar a baseline pré-lançamento e retirar o bootstrap SQL duplicado, aproveitando que bases antigas podem ser descartadas.

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
