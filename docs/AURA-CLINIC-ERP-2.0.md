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

## Segurança e decisões

- Valores calculados pelo navegador são apenas estimativas visuais; o backend
  recalcula descontos.
- As tabelas de cupons ficam no schema do tenant, evitando a necessidade de
  aceitar `tenant_id` enviado pelo cliente.
- Cupons usados não são apagados fisicamente.
- Uploads, pagamentos e webhooks continuarão exigindo validação no servidor.
- Nenhuma remoção de código antigo foi feita sem prova de ausência de uso.

## Fases seguintes

1. Agenda com múltiplos serviços/joias e reserva de estoque.
2. Templates de comunicação e provedores de pagamento.
3. Relatórios, indicadores, exportações e medições de performance.

Este documento deve ser atualizado a cada fase com migrations, testes,
medições, riscos, commits e estado de deploy reais.
