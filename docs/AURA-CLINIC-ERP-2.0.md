# Aura Clinic ERP 2.0

## Princípio de evolução

A versão 2.0 evolui os módulos atuais. Não são criadas telas paralelas para
recursos que já existem. Personalização, catálogo público, estoque, agenda,
financeiro, clientes, dashboard e planos continuam sendo os pontos únicos de
entrada.

## Arquitetura auditada

- Frontend: React 18 e Vite, dividido entre páginas públicas, funcionalidades
  autenticadas, componentes comuns e utilitários.
- Backend: Express 5, rotas por domínio, serviços compartilhados e validação
  com Zod nas operações principais.
- Banco: PostgreSQL com um schema por tenant. Cada requisição recebe uma
  conexão dedicada com `search_path` fixado no schema resolvido.
- Isolamento: o tenant é derivado do token, header, query pública ou host. O
  identificador é validado e convertido em `tenant_<id>`; a conexão é limpa
  antes de voltar ao pool.
- Deploy: pipeline e servidor existentes. Vercel não faz parte da arquitetura.

## Reaproveitamento confirmado

| Requisito 2.0 | Implementação existente que será evoluída |
| --- | --- |
| Identidade e construtor | `CatalogCustomization.jsx`, `catalog.js`, tabelas `catalog_*` |
| Catálogo premium | `PublicExperience.jsx` e `/api/catalog` |
| Estoque e variações | `Inventory.jsx`, `jewelry.js`, `inventory.js` |
| Agenda pública | `PublicExperience.jsx`, `booking.js`, `appointments.js` |
| WhatsApp | links `wa.me` já usados no catálogo e agenda |
| Financeiro | `Finance.jsx`, `finance.js` e auditoria de despesas |
| Dashboard e alertas | `Dashboard.jsx`, `dashboard.js`, `alerts.js` |
| Clientes e prontuário | `ClientsMedical.jsx`, `clients.js`, termos e pós-atendimento |
| Planos | `plans.js`, `subscriptions.js` e `withFeature` no backend |

## Limitações confirmadas

- O backend removia produtos zerados antes do filtro público de esgotados.
- Promoções existentes possuem modelo simples e ainda não cobrem todas as
  combinações, prioridades e auditoria previstas.
- Cupons exibidos no resumo ERP eram mockados; não existia persistência nem
  validação transacional.
- Algumas mensagens públicas ainda continham o nome Aura Clinic como texto
  fixo, mesmo quando o tenant tinha marca própria.
- O preview do editor usa a própria vitrine em iframe e recebe o rascunho por
  mensagem de mesma origem. Uma sessão de preview curta no backend continua
  recomendada caso o preview precise ser compartilhado fora do editor.
- A busca visual ainda não possui infraestrutura vetorial. A fase inicial deve
  usar hash perceptual/metadados e declarar claramente essa limitação.
- Não existe integração oficial configurada para WhatsApp ou pagamentos; os
  fluxos não podem afirmar envio ou confirmação automáticos.

## Alterações implementadas

### Produtos esgotados

- A API pública fornece produtos zerados sem expor campos privados.
- A visibilidade padrão continua obedecendo à configuração do tenant.
- O filtro `Esgotados` passa a funcionar mesmo quando a vitrine normalmente
  oculta produtos sem estoque.
- Variações ativas são consideradas no cálculo de disponibilidade.

### Cupons

- Persistência por tenant em `coupons` e `coupon_usages`.
- Constraints contra valores negativos e estados inválidos.
- Índices para status/período, usos e clientes.
- CRUD administrativo dentro da Personalização existente.
- Validação pública e cálculo no backend, incluindo período, status, limites,
  compra mínima, teto, cliente, produtos, categorias e exclusões.
- Soft delete para cupons que já possuem histórico de uso.

### Promoções avançadas

- Modelo existente ampliado de forma aditiva, preservando campanhas atuais.
- Regras por produto, variação, categoria, cor, material, pedra e serviço.
- Períodos por data e horário, prioridade, limites, quantidade mínima, selos e texto legal.
- Tipos percentual, valor fixo, preço promocional e compre X/pague Y.
- Resolução de conflitos por prioridade e especificidade.
- Acumulação controlada entre promoções e cupons.
- Cotação final no backend, sem total negativo ou aplicação duplicada.
- CRUD, duplicação, pausa, encerramento, soft delete e auditoria.
- Integração da cotação com o pedido público.

### Identidade

- Informações comerciais, suporte, presença digital, políticas, biossegurança
  e materiais foram incorporados às configurações existentes.
- O fluxo público de agendamento usa a identidade do tenant quando disponível.

### Construtor e categorias

- O snapshot inteiro da vitrine — identidade, tema, banners, categorias,
  destaques, promoções e seções — é salvo em rascunho isolado.
- A publicação cria uma revisão imutável e atualiza a vitrine de forma atômica.
- O catálogo público recebe as `catalogSections` da revisão publicada.
- Histórico e rollback preservam todas as versões; o reset volta somente o
  rascunho ao padrão.
- O editor oferece quatro templates iniciais: Minimal clean, Luxe editorial,
  Studio booking e Campaign / lançamento.
- Ver [CATALOGO-BUILDER.md](./CATALOGO-BUILDER.md) para o contrato e limites de
  segurança.
- Tipos para banners, categorias, vitrines, serviços, profissionais, localização,
  políticas, biossegurança, materiais, depoimentos, Instagram, agenda e rodapé.
- Ordenação, ativação, duplicação, modo visual, largura, colunas, espaçamento,
  alinhamento, limite e regra de produtos.
- Prévia em desktop, tablet e celular.
- Catálogo público respeita ordem e visibilidade publicadas.
- Categorias mantêm nome interno separado do nome público, com descrição,
  imagem, banner, cor, destaque, limite e modo de exibição.

### Busca visual

- Busca real por hash perceptual de pixels decodificados (dHash 64 bits).
- Ranking por distância de Hamming combinado com metadados.
- Índice persistente de hashes dentro do schema de cada tenant.
- Upload temporário em memória, sem persistência da imagem de consulta.
- JPEG, PNG e WebP limitados a 5 MB e 40 milhões de pixels.
- Origens remotas passam por proteção contra endereços privados/SSRF.
- Resultado inclui identidade, SKU, categoria, atributos, variações, estoque,
  preço e percentual de similaridade.
- Recurso protegido por plano no backend.

### Agenda, reservas e sinal

- Agenda pública aceita múltiplos serviços e as múltiplas joias do pedido.
- Itens são persistidos em `appointment_items`, com produto, variação,
  quantidade, preço, duração, subtotal e observações.
- Preços, promoções e cupons são recalculados pelo backend.
- Duração agregada é validada contra os horários reais do profissional.
- Reservas temporárias usam bloqueio de linha e transação, com expiração,
  confirmação, liberação e prevenção de estoque negativo.
- Intenções e eventos de pagamento possuem idempotência e estados explícitos.
- Comprovante manual está estruturado; Asaas, Mercado Pago e Stripe permanecem
  dependentes de credenciais externas e não são simulados em produção.
- Confirmação de pagamento confirma reservas; falha, cancelamento ou expiração
  libera o estoque.

### Comunicações e automações

- A central existente de notificações foi ampliada, sem criar um fluxo paralelo.
- Modelos por tenant aceitam somente variáveis documentadas e preservam
  marcadores desconhecidos para evitar substituições silenciosas.
- Regras de confirmação imediata e lembrete antes do atendimento são
  configuráveis, ativáveis e registram execuções.
- O agendamento público cria comunicações idempotentes para o cliente, além da
  notificação operacional já existente.
- A fila distingue mensagens pendentes, prontas e falhas; sem um provedor
  oficial configurado, nenhuma mensagem é declarada como enviada.
- A interface permite editar modelos, ativar regras, processar vencimentos,
  consultar o histórico e abrir a mensagem pronta no WhatsApp.
- O acesso é controlado pela feature `message_templates` e pelos papéis de
  administrador e recepção.
- Testes unitários cobrem a renderização segura das variáveis; a suíte completa
  do backend permanece verde com 142 testes preexistentes.

### Busca e filtros inteligentes

- Busca compartilhada normaliza acentos, caixa e pontuação e tolera erros
  simples de digitação por distância de edição.
- O catálogo mantém histórico recente local, sugestões nativas e estado na URL.
- A consulta de estoque usa debounce para não realizar uma requisição a cada
  tecla; vendas e clientes pesquisam também itens, SKU, status e contatos.
- Filtros existentes de variação, material, cor, pedra, medidas, rosca,
  fornecedor, disponibilidade e ordenação continuam ligados aos dados reais.

### Estoque inteligente

- Giro, demanda diária e previsão de ruptura são calculados sobre saídas,
  vendas e perdas reais em uma janela configurável.
- Curva ABC usa valor efetivamente movimentado, em vez de valor parado em
  estoque.
- Sugestões de reposição e de metadados ausentes são persistidas, revisáveis e
  nunca aplicadas sem aprovação.
- Inventário físico possui rascunho, contagem por SKU/variação, bloqueio de
  conclusão incompleta, ajuste transacional, movimentação e auditoria.
- Reservas temporárias permanecem descontadas da disponibilidade comercial.
- Etiquetas são geradas localmente com QR Code e código de barras Code 128,
  limitadas a 100 produtos por impressão.
- Novas tabelas por tenant: `inventory_suggestions`, `inventory_counts`,
  `inventory_count_items` e `inventory_audit_log`.
- A suíte passou a 146 testes de backend e 8 de frontend.

### Financeiro 2.0

- O financeiro básico e suas despesas foram preservados; um razão financeiro
  avançado foi adicionado sem duplicar pagamentos e despesas de origem.
- Contas a pagar, contas a receber, receitas e despesas aceitam baixa parcial,
  cancelamento, estorno, comprovante, conta/caixa, responsável e observações.
- Parcelamentos criam competências mensais e lançamentos recorrentes são
  gerados de forma idempotente para horizontes configuráveis.
- Centros de custo, metas, conciliação e auditoria possuem persistência própria
  no schema de cada tenant.
- Fluxo de caixa, DRE, inadimplência e saldos a pagar/receber são calculados
  no backend para o período solicitado.
- Pagamentos e despesas antigas são sincronizados por `source_key` único,
  evitando lançamentos duplicados.
- A interface Premium permite criar lançamentos e parcelas, registrar baixas,
  gerar recorrências, cadastrar centros de custo e acompanhar indicadores.
- Teste de integração comprova parcelamento, baixa parcial, razão e
  idempotência das recorrências.

### Dashboard, clientes e relatórios

- Dashboard executivo ganhou filtros de 7, 30, 90 e 365 dias e indicadores de
  comparecimento, cancelamento, ticket médio, contas, promoções, cupons e
  conversão do catálogo.
- Visualizações e seleções do catálogo são registradas sem dados pessoais, com
  sessão anônima e isolamento por tenant.
- Ranking de profissionais e produtos mais visualizados usa agregações reais.
- O perfil da cliente reúne atendimentos, prontuário e fotos, termos,
  pós-atendimento, pagamentos, vendas, fidelidade, cupons e promoções em uma
  timeline cronológica.
- A central de relatórios cobre financeiro, vendas, estoque, serviços,
  clientes, profissionais, agenda, cancelamentos, promoções, cupons, comissões,
  pagamentos e conversão.
- Os relatórios aceitam período e filtros específicos e exportam PDF, XLSX e
  CSV no backend; tipos financeiros continuam restritos a administrador e
  financeiro.
- Testes percorrem todos os tipos de relatório e confirmam a ingestão pública
  validada dos eventos de conversão.

## Segurança e decisões

- Valores calculados pelo navegador são apenas estimativas visuais; o backend
  recalcula descontos.
- As tabelas de cupons ficam no schema do tenant, evitando a necessidade de
  aceitar `tenant_id` enviado pelo cliente.
- Cupons usados não são apagados fisicamente.
- Uploads, pagamentos e webhooks continuarão exigindo validação no servidor.
- Nenhuma remoção de código antigo foi feita sem prova de ausência de uso.
- `sharp` foi atualizado para 0.35.3 após auditoria. O `npm audit` ainda aponta
  10 achados transitivos (9 altos e 1 moderado) na cadeia de exportação do
  `exceljs`; o único reparo automático oferecido é downgrade major para 3.4.0,
  portanto não foi aplicado sem validar primeiro as exportações na fase de
  relatórios.

### Segurança, permissões e arquivos clínicos

- Uploads públicos e clínicos agora usam diretórios separados. Termos,
  prontuários, referências, pós-atendimento e comprovantes novos ficam privados.
- A leitura privada exige token, papel autorizado e registro no schema do
  tenant; tentativas anônimas ou cruzadas são rejeitadas.
- Imagens, GIFs e PDFs têm conteúdo real validado, além de MIME e tamanho.
- Recepção não recebe prontuários/termos e não altera registros clínicos;
  usuários financeiros não acessam a agenda.
- Valores, descontos, reservas e relatórios continuam calculados no backend e
  dentro do `search_path` do tenant autenticado.

## Matriz de recursos validada

| Área | Start | Profissional | Studio |
| --- | --- | --- | --- |
| Clientes, agenda, procedimentos e estoque básico | Sim | Sim | Sim |
| Catálogo, WhatsApp por link e relatórios básicos | Sim | Sim | Sim |
| Agenda online, termos, financeiro e pós-atendimento | Não | Sim | Sim |
| Personalização pública e modelos de mensagem | Não | Sim | Sim |
| Equipe, comissões, cupons e relatórios mensais | Não | Não | Sim |
| Campanhas, busca visual, Analytics e Financeiro avançado | Não | Não | Sim |

O frontend espelha a matriz, mas o backend decide o acesso com `withFeature`.
Testes verificam herança cumulativa, duplicidades e recursos exclusivos.

## Performance medida localmente

Referência: Node em modo de produção local, PostgreSQL local, tenant Studio
vazio e 15 requisições sequenciais por endpoint em 27/07/2026.

| Operação | p50 | p95 |
| --- | ---: | ---: |
| Catálogo público | 6,65 ms | 19,85 ms |
| Dashboard (30 dias) | 14,43 ms | 35,86 ms |
| Busca de estoque | 2,48 ms | 3,48 ms |
| Relatório de estoque | 2,06 ms | 59,92 ms |

Bundle: entrada principal 195,55 kB (63,46 kB gzip), CSS 161,75 kB
(30,38 kB gzip), estoque 64,61 kB (17,06 kB gzip) e catálogo público 54,49 kB
(15,88 kB gzip). `performance.test.mjs` torna a medição reproduzível e detecta
regressões severas de p95.

## Responsividade e acessibilidade

- Validação real no navegador em 360, 375, 390, 768, 1024, 1366 e 1440 px.
- Nenhuma largura apresentou overflow horizontal ou controle cortado na página
  pública.
- Não foram encontrados erros de console, imagens sem `alt` ou botões/links sem
  nome acessível nessa superfície.

## Estado final e pendências externas

- Fases locais concluídas sem recriar Personalização, Catálogo, Estoque ou Agenda.
- Asaas, Mercado Pago, Stripe e WhatsApp oficial permanecem preparados, mas não
  ativados por falta de credenciais e webhooks públicos. O modo atual usa
  comprovante manual e `wa.me` e não declara envio automático.
- Os 10 alertas transitivos do `exceljs` permanecem documentados; o reparo
  automático exige downgrade major com risco para XLSX.
- Arquivos clínicos legados já gravados em `/uploads` precisam de migração
  operacional individual antes da remoção definitiva da rota pública. Novos
  arquivos já usam armazenamento privado.
- Nenhum merge, deploy ou validação de produção foi executado nesta etapa.
