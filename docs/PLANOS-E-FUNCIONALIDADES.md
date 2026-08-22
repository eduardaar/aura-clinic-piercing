# Planos e funcionalidades

Contrato comercial e técnico dos três planos padrão da Aura Clinic. A landing e
o cadastro leem os planos ativos de `platform.subscription_plans`; esta matriz
também define a semente usada quando o banco ainda não possui catálogo.

## Posicionamento comercial

| Plano | Preço mensal | Papel na oferta | Limites padrão relevantes |
| --- | ---: | --- | --- |
| Start | R$ 39,90 | Operação essencial para profissional solo | 1 usuário, 300 clientes, 100 agendamentos/mês, 100 itens, 1 GB, nenhum plugin |
| Profissional | R$ 69,90 | Operação completa e melhor custo-benefício | até 3 usuários, clientes/agendamentos ilimitados, 500 itens, 5 GB, 3 plugins |
| Studio | R$ 119,90 | Equipe, crescimento e recursos avançados | até 10 usuários, clientes/agendamentos/itens ilimitados, 20 GB, 12 plugins |

O Profissional é o único plano recomendado. Os planos são cumulativos: o
Profissional inclui toda a base do Start e o Studio inclui toda a base do
Profissional.

## Matriz final

| Plano | Funcionalidades incluídas |
| --- | --- |
| Start | Clientes (`clients`), agenda (`agenda`), procedimentos (`procedures`), estoque básico (`basic_inventory`), catálogo básico (`basic_catalog`), link de WhatsApp (`whatsapp_link`) e relatórios básicos (`basic_reports`). |
| Profissional | Tudo do Start mais agendamento online (`online_booking`), termos digitais (`digital_terms`), financeiro completo (`basic_finance`), sinais e depósitos (`deposits`), pós-atendimento automático (`automatic_followup`), modelos de mensagem (`message_templates`) e personalização do catálogo (`public_catalog_customization`). |
| Studio | Tudo do Profissional mais comissões (`commissions`), cupons (`coupons`), campanhas (`campaigns`), Analytics do catálogo (`catalog_analytics`) e busca visual (`visual_search`). |

Nenhuma outra chave compõe a oferta atual. Uma capacidade comum do sistema não
vira diferencial comercial apenas porque já existe uma tela ou coluna no banco.

## Como o acesso deve funcionar

Uma feature paga precisa de duas camadas coerentes:

1. o frontend usa a lista da assinatura para orientar a navegação;
2. o backend usa `withFeature("chave")` ou validação equivalente antes de ler ou
   alterar dados.

Esconder um menu não protege a API. Cotas, como usuários ou itens de estoque,
são verificadas separadamente por `requireWithinLimit`; cota ausente ou `null`
significa ilimitado.

O backend responde `402 subscription_inactive` quando a assinatura não permite
acesso e `403 plan_upgrade_required` quando falta a feature exigida. A resposta
de upgrade inclui a chave no campo `feature`.

## Mapa de proteção da API

- `agenda`: agenda e conclusão de atendimentos;
- `basic_catalog`: vendas e catálogo operacional;
- `online_booking`: configuração, horários e solicitações públicas;
- `digital_terms`: termos digitais;
- `basic_finance`: compras, fornecedores, categorias, centros de custo, contas
  a pagar, contas a receber, razão e exportações;
- `deposits`: intenções, cancelamento e estorno de cobranças;
- `automatic_followup`: pós-atendimento;
- `message_templates`: modelos e automações de comunicação;
- `public_catalog_customization`: editor, mídia, publicação, histórico e
  rollback da vitrine;
- `basic_reports`: relatórios compartilhados;
- `commissions`: relatórios e dados de comissão do Studio;
- `coupons` e `campaigns`: cupons e promoções;
- `visual_search`: busca visual de joias;
- `whatsapp_link`, `public_catalog_customization`, `online_booking` e
  `catalog_analytics`: plugins nativos validados também no serviço do catálogo.

## Recursos fora da oferta atual

As chaves abaixo não devem aparecer na landing, comparação de planos, cadastro,
menu ou editor administrativo. Elas só podem voltar após definição de produto,
enforcement no backend e cobertura de teste:

- `manual_reminders`, `monthly_reports`, `returns`, `advanced_catalog`,
  `courses` e `priority_support`: não possuem um produto ou política operacional
  suficientemente definidos;
- `anamnesis`, `stock_alerts`, `multi_user`, `full_client_history`,
  `jewelry_sales_report`, `featured_products`, `promotional_banner`,
  `variation_inventory` e `alert_center`: descrevem capacidades existentes ou
  compartilhadas, mas não constituem diferenciais isolados dos planos atuais;
- `advanced_finance`: retirado com a remoção do Financeiro 2.0; não deve ser
  usado para vender ou bloquear o financeiro atual.

As grafias históricas `anamnese` e `anamnesis` são normalizadas para
`digital_terms`, que hoje reúne anamnese e termos digitais. Os aliases preservam
dados antigos, mas não integram o catálogo nem a matriz comercial.

## Alteração de plano

1. A requisição resolve o tenant e a assinatura em
   `platform.tenant_subscriptions`.
2. O plano vigente fornece as features e cotas.
3. Upgrade libera as novas rotas sem apagar dados anteriores.
4. Downgrade bloqueia novas operações fora do plano, mas não deve excluir dados
   já criados; cada módulo precisa definir sua política de leitura e exportação.
5. Alterações no catálogo de planos exigem sincronização da vitrine, painel,
   navegação, backend e testes antes da publicação.

## Critério para evoluir a oferta

Antes de publicar uma nova feature:

- implementar um fluxo utilizável e seus testes funcionais;
- proteger todas as rotas de leitura e escrita, ou declarar a capacidade como
  base compartilhada;
- adicionar a chave ao plano correto sem quebrar a relação cumulativa;
- documentar limites e efeitos de downgrade;
- para benefícios operacionais, publicar canal, horário e SLA.

O teste `backend/tests/planMatrix.test.mjs` fixa preços, posicionamento, matriz
exata, cumulatividade, ausência de chaves órfãs e consistência entre catálogo,
páginas e guards do backend.
