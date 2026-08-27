# Plano — WhatsApp oficial com créditos Aura

> **Estado:** proposta para revisão. Não habilita envios reais, não cadastra
> credenciais e não altera o faturamento até as decisões marcadas neste documento
> serem aprovadas.

## 1. Objetivo

Transformar o WhatsApp Business oficial em um serviço vendido pela Aura Clinic:

- cada clínica usa **seu próprio número comercial** e identidade no WhatsApp;
- a **Aura Clinic contrata/paga** a infraestrutura de mensageria e revende o uso;
- cada clínica compra e consome **créditos Aura** dentro do painel;
- agenda, confirmações, lembretes e pós-atendimento disparam mensagens auditáveis,
  sempre respeitando opt-in, templates aprovados e saldo disponível.

O crédito Aura é uma unidade comercial do produto, não uma promessa de preço fixo
da Meta. O preço de venda deve absorver custo do provedor, impostos, falhas,
suporte e margem.

```text
Clínica compra créditos → Asaas confirma pagamento → saldo do tenant aumenta
                                                           ↓
Agenda/automação → fila de mensagens → reserva 1 crédito → provedor WhatsApp
                                                           ↓
                                 webhook de status ← mensagem aceita/entregue/falhou
                                                           ↓
                                  consumir crédito ou liberar reserva + auditoria
```

## 2. Modelo comercial proposto

### Papel de cada parte

| Parte | Responsabilidade |
| --- | --- |
| Aura Clinic | Contrata o acesso direto aprovado pela Meta ou um BSP, mantém método de pagamento, fatura as clínicas, opera a plataforma e suporte de primeiro nível. |
| Clínica | Vincula e autoriza seu número, mantém nome/identidade do negócio, templates e opt-ins corretos, paga créditos à Aura. |
| Meta/BSP | Entrega a mensagem, aplica políticas/limites e cobra a Aura conforme contrato e tabela vigente. |

### Política inicial de créditos

- Créditos são pré-pagos: pagamento confirmado adiciona saldo; intenção de compra
  não adiciona saldo.
- A unidade inicial é **1 crédito por tentativa de mensagem transacional** aceita
  pelo provedor. A política deve dizer expressamente se uma falha posterior gera
  estorno automático.
- Mensagens de marketing, mídia, autenticação ou países/categorias com custo
  maior devem ter tabela própria ou multiplicador; não serão vendidas como se
  tivessem o mesmo custo de lembretes.
- Planos podem conceder franquia mensal; créditos comprados não expiram até que a
  política comercial defina validade e tratamento de cancelamento.
- Sem saldo, a mensagem fica `blocked_credit` e nunca é enviada nem cria dívida.

### Lançamento comercial recomendado

Começar somente com **templates utilitários**: confirmação, lembrete, alteração
ou cancelamento de agendamento, instruções pós-atendimento e pedido de avaliação.
Campanhas/promos ficam fora da primeira versão por exigirem opt-in específico,
revisão de conteúdo e precificação distinta.

## 3. Decisão de infraestrutura (gate 0)

Antes de desenvolvimento, escolher uma das alternativas e registrar o contrato:

1. **BSP faturando a Aura — recomendado para o lançamento.** Um parceiro de
   WhatsApp fornece onboarding, gestão de números/WABAs e fatura consolidada para
   a Aura. Reduz a complexidade operacional, em troca de custo/margem do parceiro.
2. **Acesso direto da Aura à Meta.** Exige empresa verificada, estrutura de
   faturamento aceita e confirmação comercial/técnica de que a Aura pode operar
   números de clientes e assumir a cobrança. Dá mais controle, mas transfere toda
   a operação, suporte e risco para a Aura.

Não iniciar onboarding de clientes com token pessoal/copied-and-pasted. O fluxo
final deve usar onboarding autorizado pelo provedor (por exemplo, Embedded
Signup), emitir credenciais de servidor e salvar apenas segredos cifrados.

## 4. O que já existe no repositório

- Cofre por tenant em `tenant_integrations`; `whatsapp_cloud` guarda token
  cifrado, `phone_number_id`, WABA e status de teste.
- Tela de Integrações para configuração manual e teste de conexão.
- `notification_queue`, templates, regras de automação e histórico de execução.
- Razão de créditos, reservas e franquias por plano em
  `communication_credit_*`.
- Processador que reserva crédito antes de chamar a Cloud API e mantém o fallback
  manual por `wa.me` sem integração oficial.

## 5. Lacunas a fechar

| Lacuna | Efeito atual | Resultado necessário |
| --- | --- | --- |
| Onboarding multiempresa | Admin cola token e IDs manualmente. | Clínica conecta número por fluxo autorizado; tenant recebe IDs e credencial sem expor segredo. |
| Cobrança de créditos | Há intenção de compra, mas sem checkout/grant no webhook. | Asaas cria cobrança; webhook idempotente concede saldo uma única vez. |
| Templates oficiais | O envio atual é texto livre. | Catálogo de templates aprovados por tenant, variáveis tipadas e envio `type: template`. |
| Webhooks WhatsApp | Não há recebimento de status/mensagens. | Verificação de assinatura, idempotência, status `sent/delivered/read/failed` e correlação por `wamid`. |
| Worker | A fila depende do processamento acionado pela aplicação. | Worker persistente/cron com lock, retry exponencial e métricas. |
| Opt-in e LGPD | Não há registro específico por finalidade/canal. | Consentimento, fonte, data, finalidade, revogação e trilha de auditoria. |
| Precificação | Produtos atuais são valores de placeholder. | Tabela comercial versionada, custo interno por categoria/destino e margem mínima. |

## 6. Arquitetura-alvo

### Identidade e credenciais

Para cada tenant, guardar de forma cifrada e auditável:

- `provider` (`meta_direct` ou BSP escolhido), `waba_id`, `phone_number_id`,
  nome/número exibido e estado da conexão;
- credencial de servidor/refresh controlada pela Aura, nunca exposta ao navegador;
- estado da verificação, qualidade, limites e motivo de suspensão, quando o
  provedor disponibilizar;
- ID externo de cliente/conta no BSP, se aplicável.

Um tenant não pode acessar número, template, saldo, webhook ou log de outro.

### Mensagens

1. Um evento de negócio cria mensagem na `notification_queue` com `tenant_id`,
   tipo/categoria, template, destino normalizado e chave de idempotência.
2. O worker valida integração, opt-in, template, horário, limite e saldo.
3. Cria reserva de crédito idempotente e chama o provedor.
4. Armazena `provider_message_id` (`wamid`) e muda para `submitted`.
5. O webhook atualiza o estado de entrega. Falha antes de aceite libera a reserva;
   a regra de estorno posterior será explícita na política comercial.

### Créditos e cobrança

```text
checkout Asaas → payment intent → webhook pago → lançamento credit_grant
                                                   ↓
processamento → credit_reservation → submitted → credit_consume
                         └──────── falha pré-aceite ───────→ credit_release
```

Todos os lançamentos exigem chave idempotente, referência ao tenant, origem,
ator e saldo calculável por razão; nunca atualizar apenas um contador.

## 7. Fases de implementação

### Fase 0 — decisões e conformidade

- [ ] Escolher BSP ou acesso direto e aprovar contrato/custos.
- [ ] Definir titularidade de WABA/número, responsável pelo pagamento à Meta/BSP
  e SLA de suporte.
- [ ] Aprovar política de créditos, estorno, expiração, impostos e margem.
- [ ] Criar aditivo contratual: Aura como operadora, clínica como controladora,
  regras de opt-in e uso aceitável.
- [ ] Definir lista inicial de templates utilitários e fluxo de aprovação.

### Fase 1 — base técnica segura

- [ ] Criar migrations imutáveis para conexão WhatsApp, consentimentos, mensagens
  externas, eventos de webhook e catálogo de preço versionado.
- [ ] Implementar onboarding autorizado por tenant e rotação/revogação de
  credenciais.
- [ ] Implementar webhook público: GET de verificação, POST com assinatura,
  deduplicação e armazenamento mínimo necessário.
- [ ] Criar painel de estado da conexão, qualidade, número e auditoria.

### Fase 2 — envio utilitário confiável

- [ ] Criar catálogo de templates, parâmetros permitidos e versão aprovada.
- [ ] Substituir automações proativas por mensagens `template`.
- [ ] Criar worker persistente com concorrência limitada, retry e dead-letter.
- [ ] Registrar aceite, entrega, leitura e falha por mensagem.
- [ ] Aplicar opt-out antes do envio e permitir revogação no painel.

### Fase 3 — monetização

- [ ] Integrar pacote de créditos ao checkout Asaas existente.
- [ ] Conceder saldo somente por webhook idempotente de pagamento confirmado.
- [ ] Reservar/consumir/liberar crédito por mensagem e exibir extrato ao tenant.
- [ ] Criar bloqueios de saldo, limite de gasto, alerta de baixo saldo e relatório
  de custo/margem para plataforma.
- [ ] Migrar as franquias atuais para política comercial aprovada; não publicar os
  valores placeholder como preço definitivo.

### Fase 4 — piloto e lançamento

- [ ] Homologar um tenant interno e duas clínicas piloto com números próprios.
- [ ] Testar template, webhook duplicado/fora de ordem, saldo insuficiente,
  estorno, cancelamento e revogação de opt-in.
- [ ] Reconciliar mensalmente consumo interno versus fatura Meta/BSP.
- [ ] Criar runbooks de incidente, bloqueio de número, rotação de segredo e
  atendimento financeiro.
- [ ] Liberar campanhas de marketing somente depois do piloto utilitário e da
  aprovação de opt-in/preço específicos.

## 8. Critérios de aceite

- Uma clínica não consegue enviar, ver saldo ou consultar logs de outra.
- Token nunca aparece em API, frontend, log, exportação ou auditoria legível.
- O mesmo webhook/pagamento repetido não cria crédito nem débito em duplicidade.
- Mensagem proativa sem template aprovado ou opt-in é bloqueada.
- Saldo zero impede submissão ao provedor.
- Falha antes do aceite não perde crédito; aceite e status são rastreáveis pelo
  ID externo da mensagem.
- A soma do razão de créditos fecha com os saldos exibidos e com a conciliação de
  faturamento do provedor.
- Todo fluxo crítico possui testes unitários, integração com mock do provedor e
  E2E de compra → envio → webhook.

## 9. Decisões pendentes para refinamento

1. A Aura lançará com um BSP ou buscará operação direta com a Meta?
2. Qual será o preço de cada pacote, franquia por plano e margem mínima?
3. Crédito será consumido no aceite pelo provedor ou somente na confirmação de
   entrega? Qual política de reembolso por falha?
4. Créditos expiram? O que ocorre no cancelamento de assinatura?
5. Quais templates utilitários entram no piloto? Marketing fica bloqueado?
6. Quem aprova o vínculo de um número e como a clínica comprova que ele lhe
   pertence?
7. Qual canal de suporte e SLA serão prometidos para falha de mensagem?

## 10. Fora de escopo da primeira versão

- Inbox completo para atendimento humano multicanal.
- Campanhas em massa, marketing e segmentação comportamental.
- IA respondendo automaticamente a pacientes.
- Revenda de números ou compartilhamento de um mesmo número entre clínicas.
- Cobrança de cartão dentro da Aura sem o gateway já homologado.
