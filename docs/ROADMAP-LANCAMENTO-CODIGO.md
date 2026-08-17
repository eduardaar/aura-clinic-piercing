# Roadmap de lançamento — código e arquitetura

> **Criado em:** 15 de agosto de 2026  
> **Escopo:** aplicação, arquitetura, banco/migrations, segurança de código,
> pagamentos, mecanismos de LGPD, desempenho, otimização e qualidade.  
> **Fora de escopo:** configuração de servidor, SSH, firewall, Cloudflare,
> contratação de serviços, operação de infraestrutura e aprovação jurídica.  
> **Estado atual:** **NO-GO para lançamento amplo** até o encerramento dos itens
> P0 e a aprovação dos gates definidos neste documento.

Este documento transforma os achados técnicos das auditorias existentes em um
plano executável de desenvolvimento. Ele complementa, sem substituir:

- [PRONTIDAO-PRODUCAO-LGPD-SEGURANCA.md](./PRONTIDAO-PRODUCAO-LGPD-SEGURANCA.md);
- [PLANO-DE-CORRECAO-CODIGO-E-OPERACAO.md](./PLANO-DE-CORRECAO-CODIGO-E-OPERACAO.md);
- [rbac-stage-2-review.md](./rbac-stage-2-review.md);
- [PADRAO-VISUAL.md](./PADRAO-VISUAL.md);
- [JOBS-EM-SEGUNDO-PLANO.md](./JOBS-EM-SEGUNDO-PLANO.md);
- [migrations/README.md](../backend/src/db/migrations/README.md).

## 1. Objetivo de lançamento

Entregar uma versão em que:

- toda rota sensível seja protegida por permissão e escopo de dados;
- sessões administrativas sejam curtas, revogáveis e protegidas por MFA;
- pagamentos e estoque permaneçam consistentes sob falhas e concorrência;
- direitos de titulares e retenção sejam executáveis pelo sistema;
- migrations sejam incrementais, reproduzíveis e compatíveis com releases;
- APIs e telas mantenham desempenho previsível sob carga concorrente;
- os módulos tenham contratos claros e possam evoluir sem ampliar o risco;
- CI, testes funcionais, contratos, concorrência e carga impeçam regressões.

## 2. Definição das prioridades

| Prioridade | Significado | Regra de lançamento |
| --- | --- | --- |
| **P0** | Pode causar exposição de dados, inconsistência financeira, perda lógica ou impossibilidade de atualizar o sistema com segurança. | Obrigatório antes do lançamento. |
| **P1** | Pode causar degradação relevante, dificuldade de operação, baixa usabilidade ou manutenção arriscada. | Obrigatório para a versão candidata, salvo aceite formal. |
| **P2** | Evolução estrutural ou otimização que pode ser concluída após estabilização, sem comprometer a segurança imediata. | Pode entrar após o lançamento controlado. |

Um item só pode ser marcado como concluído quando código, testes, documentação e
evidência de execução estiverem presentes. Existência de arquivo, variável ou
feature flag não constitui conclusão.

## 3. Gate 0 — baseline reproduzível

**Prioridade:** P0  
**Objetivo:** garantir que qualquer pessoa ou CI consiga reproduzir a versão
candidata antes de alterar módulos críticos.

### Entregas

- [ ] Instalar dependências com `npm ci` na raiz, backend e frontend.
- [ ] Executar typecheck, testes, build e lint a partir de checkout limpo.
- [ ] Registrar contagens e duração das suítes como baseline.
- [ ] Corrigir testes dependentes de estado local ou ordem de execução.
- [ ] Tornar falha de teste, typecheck, build ou lint erro bloqueante.
- [ ] Executar `npm audit --omit=dev` para backend e frontend.
- [ ] Eliminar vulnerabilidades altas ou registrar aceite técnico com teste de
      não explorabilidade, responsável e prazo.
- [ ] Corrigir/atualizar as cadeias atualmente relacionadas a
      `brace-expansion`, `ip-address`, `uuid`, `exceljs`, `react-router` e
      `react-router-dom`.
- [ ] Gerar relatório de build contendo tamanho de chunks e assets.
- [ ] Criar um manifesto da versão com commit, migrations e data do build.

### Critérios de aceite

- checkout limpo passa em todos os comandos do CI;
- nenhuma vulnerabilidade crítica ou alta permanece sem aceite formal;
- build e resultados de testes podem ser associados ao commit exato;
- a versão candidata pode ser reconstruída sem arquivos locais não versionados.

## 4. Gate 1 — migrations e evolução do banco

**Prioridade:** P0  
**Objetivo:** remover a ambiguidade entre schemas idempotentes e migrations
incrementais e garantir evolução segura para todos os tenants.

### Entregas

- [ ] Validar estruturalmente as migrations `tenant/0003`, `0004` e `0005`.
- [ ] Criar teste que constrói uma instalação vazia apenas pelo caminho oficial.
- [ ] Criar teste que atualiza um snapshot legado até a versão atual.
- [ ] Testar banco com objetos físicos existentes, mas ledger incompleto.
- [ ] Registrar no ledger `running`, `applied` e `failed`.
- [ ] Registrar início, fim, duração, release, escopo/tenant e erro sanitizado.
- [ ] Definir `lock_timeout` e `statement_timeout` por migration.
- [ ] Impedir alteração de arquivo já aplicado por checksum.
- [ ] Exigir estratégia expand/contract para alterações destrutivas.
- [ ] Testar compatibilidade da versão anterior da API com a estrutura expandida.
- [ ] Impedir remoção de coluna/tabela no mesmo release que elimina sua leitura.
- [ ] Encerrar gradualmente o uso de `schema.sql` como mecanismo de atualização.
- [ ] Manter uma única fonte de verdade para alterações futuras do banco.
- [ ] Atualizar README, arquitetura, guia e workflows para refletirem o mesmo
      fluxo de migrations.

### Testes obrigatórios

- instalação vazia;
- atualização a partir de snapshot legado;
- reaplicação idempotente;
- checksum divergente;
- lock concorrente;
- timeout;
- falha no meio da migration;
- dois tenants com versões diferentes;
- compatibilidade N-1/N/N+1 durante expand/contract.

### Critérios de aceite

- `verify`, `status` e `apply` produzem resultados determinísticos;
- nenhum boot da API altera o banco implicitamente no modo de release;
- todas as estruturas usadas pelo código atual são verificadas antes de servir;
- documentação e implementação descrevem o mesmo comportamento.

## 5. Gate 2 — autorização, sessões e segurança da aplicação

### 5.1 RBAC completo

**Prioridade:** P0

- [ ] Migrar as 89 decisões legadas catalogadas em
      [rbac-stage-2-review.md](./rbac-stage-2-review.md).
- [ ] Criar permissões para catálogo, promoções, billing, MFA, profissionais,
      serviços, procedimentos, observabilidade, privacidade, jobs, uploads,
      suporte, integrações, opções estruturais e fidelidade.
- [ ] Separar leitura, criação, edição, exclusão, publicação, exportação e ações
      destrutivas.
- [ ] Adotar negação por padrão para permissão ou papel desconhecido.
- [ ] Vincular `users` a `professionals` com FK opcional e índice único parcial.
- [ ] Derivar o profissional exclusivamente da sessão em operações “próprias”.
- [ ] Proibir filtros de escopo baseados apenas em IDs enviados pelo cliente.
- [ ] Auditar alterações de papel, status e overrides de permissão.
- [ ] Gerar o catálogo do frontend a partir da fonte do backend.
- [ ] Remover matrizes de permissão duplicadas manualmente.

#### Testes

- matriz `recurso × ação × papel`;
- overrides de concessão e negação;
- usuário inativo;
- último administrador;
- tentativa de acessar dado de outro profissional;
- tentativa de ampliar escopo por query/body;
- papel e permissão desconhecidos;
- revogação após alteração administrativa.

### 5.2 Sessões administrativas e MFA

**Prioridade:** P0

- [ ] Criar sessões persistidas para usuários da plataforma.
- [ ] Implementar refresh opaco e rotativo para superadmin.
- [ ] Verificar `session_version` e sessão ativa em toda requisição privilegiada.
- [ ] Revogar sessões após senha, MFA, suspensão ou evento administrativo.
- [ ] Exigir MFA para admin de clínica e superadmin por política de código.
- [ ] Implementar códigos de recuperação de uso único, armazenados por hash.
- [ ] Invalidar códigos depois do uso ou regeneração.
- [ ] Auditar ativação, desativação, recuperação e falhas de MFA.
- [ ] Limitar tentativas por conta e janela, além da proteção por IP.
- [ ] Criar listagem e encerramento de sessões/dispositivos.

### 5.3 Validação e endpoints públicos

**Prioridade:** P0

- [ ] Aplicar schemas de validação a body, params e query de todas as rotas.
- [ ] Impedir mass assignment com DTOs/whitelists explícitos.
- [ ] Limitar tamanho de strings, arrays, filtros, ranges e objetos aninhados.
- [ ] Padronizar idempotência em cadastro, booking, compra e cobrança pública.
- [ ] Criar adapter de prova anti-automação sem acoplar domínio ao fornecedor.
- [ ] Aplicar quotas lógicas por tenant a eventos e uploads públicos.
- [ ] Expirar e limitar telemetria pública.
- [ ] Redigir segredos e identificadores antes de persistir erros.
- [ ] Criar testes para IDOR, fuzzing, prototype pollution, path traversal,
      injeção, replay e concorrência.

### 5.4 Uploads

**Prioridade:** P0 para arquivos privados; P1 para demais mídias

- [ ] Modelar estados `pending_scan`, `available` e `rejected`.
- [ ] Bloquear download antes da aprovação.
- [ ] Criar interface de scanner desacoplada do fornecedor.
- [ ] Validar conteúdo real, dimensões e limites de processamento.
- [ ] Bloquear SVG, HTML e conteúdo ativo.
- [ ] Servir PDF como anexo ou em sandbox apropriado.
- [ ] Auditar upload, leitura, rejeição e exclusão.
- [ ] Testar MIME falso, polyglot, arquivo truncado, decompression bomb e
      concorrência de substituição/exclusão.

### Critérios de aceite do Gate 2

- nenhuma rota sensível depende apenas de `requireRole`;
- toda negação relevante possui teste automatizado;
- superadmin e admin usam sessão revogável e MFA obrigatório;
- endpoint público possui validação, limite e estratégia contra repetição;
- arquivo privado não fica disponível antes das validações exigidas.

## 6. Gate 3 — pagamentos e consistência financeira

**Prioridade:** P0  
**Objetivo:** tornar pagamentos, assinatura, pedido e estoque determinísticos sob
falha, repetição e concorrência.

### 6.1 Máquina de estados

Definir uma máquina explícita para intenção, pedido, reserva, fatura e
assinatura. Estado-base recomendado:

```text
created
  → pending_provider
  → awaiting_payment
  → paid
  → expired | cancelled | refunded | chargeback
```

- [ ] Centralizar transições permitidas em um único módulo de domínio.
- [ ] Rejeitar regressões e transições impossíveis.
- [ ] Persistir origem, evento, chave idempotente e timestamps.
- [ ] Executar transições locais dentro de transação.
- [ ] Produzir auditoria/ledger imutável.
- [ ] Tratar eventos duplicados e fora de ordem.
- [ ] Compartilhar o mesmo serviço entre webhook e reconciliação.

### 6.2 Regras de negócio obrigatórias

- [ ] Ativar plano somente após confirmação do gateway.
- [ ] Não marcar pedido como pago pela resposta inicial de criação.
- [ ] Reservar estoque uma única vez.
- [ ] Liberar reserva expirada/cancelada uma única vez.
- [ ] Criar operação inversa para estorno, sem apagar histórico.
- [ ] Tratar chargeback como evento distinto.
- [ ] Definir upgrade, downgrade, prorrata, inadimplência, retry e cancelamento.
- [ ] Aplicar timeout em toda chamada externa.
- [ ] Recuperar resposta ambígua por idempotência e consulta posterior.
- [ ] Impedir divergência entre `payments`, `payment_intents`, pedidos,
      assinaturas e ledger financeiro.

### 6.3 Checkout público

- [ ] Mostrar somente métodos realmente implementados.
- [ ] Exibir corretamente QR Code, link, linha digitável, status e expiração.
- [ ] Não apresentar sucesso antes da confirmação apropriada.
- [ ] Expirar token público e reserva de estoque de forma coordenada.
- [ ] Permitir repetição segura após timeout de rede.
- [ ] Padronizar mensagens de pendência, recusa, expiração e erro recuperável.

### 6.4 Matriz automatizada de pagamentos

- [ ] PIX: criação, pagamento, expiração, estorno e webhook perdido.
- [ ] Boleto: emissão, vencimento, cancelamento e pagamento posterior.
- [ ] Checkout hospedado: aprovado, recusado, timeout, estorno e chargeback.
- [ ] Assinatura: upgrade, downgrade, prorrata, retry, inadimplência e cancelamento.
- [ ] Webhook duplicado, fora de ordem e com assinatura inválida.
- [ ] Duas instâncias processando o mesmo evento.
- [ ] Falha de banco antes/depois de resposta positiva do provedor.
- [ ] Reconciliação encontrando e corrigindo divergência.
- [ ] Concorrência entre pagamento, cancelamento e expiração.

### Critérios de aceite

- nenhum teste gera duplicação de cobrança, receita, pedido ou baixa de estoque;
- toda transição financeira é idempotente e auditável;
- falha externa ou interna converge para estado conhecido;
- checkout e backend compartilham o mesmo contrato de estados e métodos.

## 7. Gate 4 — mecanismos de LGPD no produto

**Prioridade:** P0 para dados clínicos e titulares; P1 para automações gerais  
**Observação:** este gate cobre mecanismos técnicos. Conteúdo e aprovação
jurídica permanecem fora deste roadmap.

### 7.1 Direitos dos titulares

- [ ] Criar orquestrador único para localizar dados em todos os domínios.
- [ ] Gerar exportação estruturada e compreensível como job assíncrono.
- [ ] Paginar leituras para não montar todo o histórico em memória.
- [ ] Implementar correção, anonimização e exclusão como ações distintas.
- [ ] Propagar exclusão ao adapter de arquivos e integrações suportadas.
- [ ] Implementar legal hold e exceções fundamentadas.
- [ ] Registrar solicitação, verificação de identidade, decisão e execução.
- [ ] Garantir idempotência e retomada depois de falha parcial.

### 7.2 Retenção e eliminação

- [ ] Versionar matriz de retenção por categoria.
- [ ] Implementar dry-run de expiração antes de qualquer escrita.
- [ ] Criar job periódico de expiração, anonimização e purge.
- [ ] Separar retenção de dado operacional e trilha de auditoria.
- [ ] Evitar que auditoria replique o conteúdo sensível eliminado.
- [ ] Adicionar retentativas e estado de falha/dead-letter.
- [ ] Registrar contagens, exceções e evidência da execução.
- [ ] Testar restauração lógica sem reativar dados já eliminados.

### 7.3 Termos, consentimentos e menores

- [ ] Vincular aceite à versão e ao hash exato do documento.
- [ ] Produzir PDF final imutável e verificável.
- [ ] Separar termo obrigatório de consentimentos opcionais.
- [ ] Exigir novo aceite em alteração material.
- [ ] Implementar assinatura e identificação separadas do responsável.
- [ ] Usar link individual, aleatório, expirável e de uso controlado.
- [ ] Registrar data, IP, dispositivo e trilha de eventos.
- [ ] Testar adulteração, replay, expiração e uso concorrente do link.

### 7.4 IA e minimização

- [ ] Centralizar provedores em adapter único.
- [ ] Manter allowlist dos campos que podem sair da aplicação.
- [ ] Redigir automaticamente CPF, telefone, e-mail e identificadores.
- [ ] Bloquear dados clínicos por padrão.
- [ ] Criar permissão específica para uso de IA.
- [ ] Auditar uso sem persistir prompt sensível integral.
- [ ] Limitar tamanho, retenção local e contexto.
- [ ] Criar testes que falham se dados proibidos forem enviados ao adapter.

### Critérios de aceite

- exportação e eliminação funcionam de ponta a ponta com retentativa;
- arquivos e registros relacionais participam da mesma solicitação;
- termos aceitos são imutáveis e verificáveis;
- nenhuma integração de IA recebe campo fora da allowlist.

## 8. Gate 5 — desempenho e otimização

### 8.1 Banco e API

**Prioridade:** P1; P0 quando afetar checkout, agenda ou isolamento

- [ ] Tornar paginação obrigatória nas listagens de crescimento contínuo.
- [ ] Remover gradualmente o retorno legado de arrays completos.
- [ ] Adotar cursor em históricos grandes e feeds append-only.
- [ ] Limitar períodos, filtros e tamanho máximo de página.
- [ ] Identificar e eliminar consultas N+1.
- [ ] Revisar `SELECT *` em respostas e fluxos sensíveis.
- [ ] Criar teste de orçamento de queries por endpoint crítico.
- [ ] Medir consultas com `EXPLAIN (ANALYZE, BUFFERS)` em massa representativa.
- [ ] Revisar índices por uso real, evitando acrescentá-los sem medição.
- [ ] Aplicar timeouts e cancelamento a operações pesadas.
- [ ] Mover exportações e tarefas longas para jobs.
- [ ] Produzir CSV por streaming/lotes.
- [ ] Usar cache apenas para conteúdo público/versionado.
- [ ] Incluir tenant e versão publicada em toda chave de cache.
- [ ] Proibir cache compartilhado de dado clínico ou financeiro privado.

### 8.2 Frontend

**Baseline observado:** `dist` com aproximadamente 8,4 MB, asset de login com
2,2 MB, CSS principal com 268 KB e JavaScript inicial com 252 KB.

- [ ] Criar orçamento bloqueante de bundle no CI.
- [ ] Converter imagens grandes para AVIF/WebP responsivo.
- [ ] Definir dimensões, `srcset`, lazy loading e prioridade de carregamento.
- [ ] Separar e reduzir o CSS legado de `styles.css`.
- [ ] Detectar regras CSS mortas e imports globais desnecessários.
- [ ] Verificar dependências duplicadas entre chunks.
- [ ] Garantir lazy loading por feature e subfeature pesada.
- [ ] Migrar telas grandes para paginação server-side.
- [ ] Virtualizar listas apenas quando o volume visível justificar.
- [ ] Medir LCP, INP e CLS em páginas públicas e autenticadas.
- [ ] Criar teste de regressão dos Web Vitals e do peso inicial.

### 8.3 Metas iniciais

Em ambiente de teste representativo, até definição de SLO comercial:

- erro 5xx inferior a 1%;
- leitura comum com p95 inferior a 400 ms;
- escrita comum com p95 inferior a 800 ms;
- p99 inferior a 1,5 segundo;
- pool abaixo de 80% de saturação sustentada;
- ausência de crescimento contínuo de memória após estabilização;
- backlog da fila recuperado após o pico;
- nenhum vazamento ou mistura de dados entre tenants.

## 9. Gate 6 — testes de carga, concorrência e resiliência

**Prioridade:** P0 para pagamento/estoque/agenda; P1 para demais módulos

Criar `load-tests/` com k6 ou ferramenta equivalente, dados sintéticos e
relatório versionado por release.

### Cenários

- [ ] Login, refresh e revogação.
- [ ] Consulta concorrente da agenda.
- [ ] Disputa pelo mesmo horário.
- [ ] Busca e atualização de clientes.
- [ ] Catálogo público e cálculo de preços.
- [ ] Busca, reserva, venda e ajuste de estoque.
- [ ] Checkout e criação idempotente de cobrança.
- [ ] Webhooks duplicados e fora de ordem.
- [ ] Dashboard, financeiro e relatórios.
- [ ] Exportações assíncronas.
- [ ] Múltiplos tenants sob carga simultânea.
- [ ] Saturação controlada do pool de conexões.

### Modalidades

- **Smoke:** carga mínima em todo PR relevante.
- **Load:** volume esperado antes de cada release candidata.
- **Stress:** aumento progressivo até encontrar o limite.
- **Spike:** pico abrupto em catálogo, booking e checkout.
- **Soak:** execução prolongada para detectar vazamento e degradação.
- **Concurrency:** disputa transacional em agenda, estoque e pagamento.

### Asserções obrigatórias

- [ ] Sem dupla reserva ou estoque negativo.
- [ ] Sem dois agendamentos para a mesma capacidade exclusiva.
- [ ] Sem duplicação financeira.
- [ ] Sem resposta de um tenant contendo dados de outro.
- [ ] Estado converge depois de timeout ou retry.
- [ ] Latência e erro respeitam as metas do Gate 5.
- [ ] Memória, conexões e fila retornam ao patamar esperado após o pico.

## 10. Gate 7 — arquitetura e padrões de módulos

**Prioridade:** P1; mudanças em módulos financeiros e de autorização devem
acontecer antes da expansão funcional.

### 10.1 Frontend

Arquivos prioritários para decomposição:

| Arquivo | Tamanho observado | Direção |
| --- | ---: | --- |
| `features/inventory/Inventory.jsx` | 2.012 linhas | Separar catálogo, estoque, contagem, variações e profissionais. |
| `pages/PublicExperience.jsx` | 1.981 linhas | Separar catálogo, booking, checkout e componentes públicos. |
| `pages/CatalogCustomization.jsx` | 1.970 linhas | Separar editor, mídia, revisão, plugins e publicação. |
| `features/agenda/Agenda.jsx` | 1.833 linhas | Separar agenda, disponibilidade, bloqueios, profissionais e serviços. |
| `features/platform/AccountsAdmin.jsx` | 1.464 linhas | Separar lista, detalhes, cotas, auditoria e ações destrutivas. |
| `styles.css` | 11.708 linhas | Migrar legado para camadas e primitivas por domínio. |

Estrutura recomendada:

```text
feature/
  api/
  components/
  hooks/
  pages/
  schemas/
  state/
  utils/
  index.js
```

- [ ] Componentes não executam regras financeiras ou de autorização.
- [ ] Hooks controlam efeitos e integração HTTP.
- [ ] Schemas e DTOs definem entrada/saída da feature.
- [ ] `DataView` server-side torna-se padrão para listas persistentes.
- [ ] Primitivas compartilhadas seguem [PADRAO-VISUAL.md](./PADRAO-VISUAL.md).

### 10.2 Backend

Módulos prioritários: pagamentos, catálogo, estoque, agenda, clientes e
administração da plataforma.

Estrutura de referência:

```text
domain/
  routes.js
  controller.js
  service.js
  repository.js
  policy.js
  schemas.js
  events.js
  tests/
```

- [ ] Rotas tratam apenas HTTP, validação e composição.
- [ ] Policies concentram autorização e escopo.
- [ ] Services concentram invariantes e transações.
- [ ] Repositories concentram consultas do domínio.
- [ ] Eventos de domínio conectam pagamento, estoque, auditoria e privacidade.
- [ ] Adapters isolam storage, gateway, e-mail, IA e scanner.
- [ ] Regras de importação impedem dependências circulares/proibidas.

### 10.3 Contratos

- [ ] Criar contrato OpenAPI ou equivalente.
- [ ] Padronizar envelope paginado.
- [ ] Padronizar erro com `code`, mensagem, campos e request/correlation ID.
- [ ] Centralizar enums e gerar artefatos consumidos pelo frontend.
- [ ] Criar contract tests entre API e SPA.
- [ ] Manter dinheiro em decimal/numeric e testar arredondamento.
- [ ] Introduzir TypeScript gradualmente nos contratos críticos, sem exigir
      reescrita total como condição de lançamento.

### Critérios de aceite

- módulos críticos têm fronteiras e responsabilidades verificáveis;
- frontend e backend não mantêm enums críticos divergentes;
- alteração de contrato quebra teste antes de chegar à interface;
- arquivos grandes deixam de concentrar domínios independentes.

## 11. Gate 8 — testes funcionais, E2E e acessibilidade

**Prioridade:** P0 para jornadas clínicas e financeiras; P1 para cobertura geral

- [ ] Adotar Playwright ou equivalente para E2E.
- [ ] Testar jornadas de admin, recepção, piercer e financeiro.
- [ ] Testar signup, onboarding, configuração inicial e primeiro atendimento.
- [ ] Testar agendamento público até confirmação.
- [ ] Testar pagamento até webhook/reconciliação.
- [ ] Testar termo, prontuário, pós-atendimento e arquivo privado.
- [ ] Testar sessão expirada e recuperação após refresh.
- [ ] Executar testes em resoluções mobile, tablet e desktop.
- [ ] Integrar axe ou equivalente para acessibilidade automatizada.
- [ ] Testar teclado, foco, modal, contraste e anúncios de erro/sucesso.
- [ ] Criar testes de contrato da API.
- [ ] Criar property-based tests para dinheiro, descontos e estados.
- [ ] Aplicar mutation testing em permissões e pagamentos.
- [ ] Executar testes de concorrência contra PostgreSQL real.
- [ ] Validar isolamento multi-tenant em toda release candidata.

### Critérios de aceite

- jornadas críticas passam sem intervenção manual;
- nenhuma violação crítica de acessibilidade permanece aberta;
- erros de contrato, permissão e concorrência são detectados no CI;
- a suíte produz evidência ligada ao commit da release.

## 12. Sequência recomendada de execução

```text
Baseline reproduzível
  → migrations
  → RBAC e sessões
  → segurança pública/uploads
  → máquina de estados de pagamentos
  → mecanismos de LGPD
  → paginação e otimização do backend
  → otimização do frontend
  → E2E/contratos/acessibilidade
  → carga, stress e soak
  → modularização final e release candidate
```

Trabalhos que podem ocorrer em paralelo sem cruzar os módulos críticos:

- otimização de imagens e bundle;
- criação da base dos testes E2E;
- contrato OpenAPI;
- adapter de scanner;
- suíte de carga somente leitura;
- decomposição visual de telas sem alteração de regra de negócio.

## 13. Checklist da release candidate

### Código e banco

- [ ] Migrations reproduzíveis em banco vazio e legado.
- [ ] Nenhuma atualização implícita de schema no boot de release.
- [ ] RBAC granular aplicado a todas as rotas sensíveis.
- [ ] Sessão de plataforma revogável e MFA obrigatório.
- [ ] Nenhuma vulnerabilidade crítica/alta sem aceite válido.
- [ ] Inputs e uploads públicos validados e limitados.

### Pagamentos e dados

- [ ] Máquina de estados aprovada e testada sob concorrência.
- [ ] Webhook e reconciliação são idempotentes e convergentes.
- [ ] Estoque não duplica reserva nem fica negativo.
- [ ] Direitos de titular e retenção funcionam ponta a ponta.
- [ ] Termos e consentimentos são versionados e imutáveis.

### Qualidade e desempenho

- [ ] Typecheck, lint, testes e build verdes em checkout limpo.
- [ ] E2E das jornadas críticas aprovado.
- [ ] Testes de contrato e isolamento aprovados.
- [ ] Testes de carga, stress e soak dentro dos limites definidos.
- [ ] Bundle e Web Vitals dentro do orçamento.
- [ ] Nenhuma regressão crítica de acessibilidade.

## 14. Decisão de lançamento pelo código

O código pode receber decisão **GO** quando:

1. todos os itens P0 estiverem concluídos;
2. itens P1 abertos tiverem impacto medido e aceite explícito;
3. a release candidate passar pelas suítes funcional, segurança, contrato,
   concorrência, isolamento e carga;
4. migrations, API, frontend e evidências apontarem para o mesmo commit;
5. pagamentos e exclusões LGPD convergirem corretamente após falhas simuladas;
6. nenhum achado crítico ou alto de revisão de código permanecer aberto.

Até lá, o estado deste roadmap permanece **NO-GO por código**.
