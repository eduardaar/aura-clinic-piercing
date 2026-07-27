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
- A personalização mistura rascunho e publicação na mesma persistência. Uma
  separação completa exige migration própria e compatibilidade com os dados
  publicados atuais.
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

- Seções persistidas em layouts separados de rascunho e publicação.
- Versionamento e histórico mínimo de salvamento/publicação.
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

## Fases seguintes

1. Inteligência de estoque, previsões e sugestões de compra.
2. Financeiro 2.0, relatórios, exportações e medições de performance.
3. Integrações oficiais de WhatsApp e pagamento, dependentes de credenciais.

Este documento deve ser atualizado a cada fase com migrations, testes,
medições, riscos, commits e estado de deploy reais.
