# Roadmap de lançamento — setembro de 2026

> Documento vivo para conduzir o lançamento da Aura Clinic durante setembro de
> 2026. O foco é validar regras de negócio com uso real, corrigir bloqueios e
> evitar ampliar o produto antes de o fluxo principal estar confiável.

## Objetivo do mês

Colocar a Aura Clinic em produção para as primeiras clínicas, com cadastro,
agenda, clientes, atendimento, estoque, vendas, financeiro e cobrança da
assinatura funcionando ponta a ponta.

## Regra de prioridade

1. Bloqueia cadastro, venda, atendimento ou recebimento: corrigir imediatamente.
2. Pode gerar perda financeira, estoque incorreto ou vazamento de dados: não lançar sem corrigir.
3. Prejudica muito a operação diária: corrigir antes da entrada dos primeiros clientes.
4. Melhoria visual, conveniência ou automação não essencial: registrar para depois do lançamento.

## Semana 1 — 1 a 6 de setembro

### Conta nova e configuração inicial

- [ ] Criar uma clínica nova pelo fluxo público.
- [ ] Validar login, sessão e recuperação de acesso.
- [ ] Configurar identidade, endereço e dados de cobrança.
- [ ] Cadastrar usuários e validar permissões de cada perfil.
- [ ] Confirmar limites e recursos de cada plano.
- [ ] Revisar clareza do onboarding e mensagens de erro.

### Cadastros essenciais

- [ ] Cadastrar clientes.
- [ ] Cadastrar profissionais e disponibilidade.
- [ ] Cadastrar serviços, procedimentos e valores.
- [ ] Cadastrar produtos, variações e materiais de consumo.
- [ ] Registrar fornecedores, categorias e centros de custo.

**Saída da semana:** uma clínica vazia consegue ficar pronta para operar sem intervenção técnica.

## Semana 2 — 7 a 13 de setembro

### Agenda e atendimento

- [ ] Criar agendamento interno.
- [ ] Criar agendamento pelo site público.
- [ ] Validar conflito de horário, bloqueios e disponibilidade.
- [ ] Confirmar, reagendar e cancelar atendimentos.
- [ ] Validar sinal, crédito do cliente e reembolso manual.
- [ ] Concluir atendimento com serviço, joia e materiais.
- [ ] Validar prontuário, termo digital e pós-atendimento.

### Comunicação operacional

- [ ] Configurar SMTP real e enviar mensagem de teste.
- [ ] Definir quais avisos transacionais serão enviados por e-mail.
- [ ] Validar solicitação, confirmação, reagendamento e cancelamento.
- [ ] Validar lembretes e pós-atendimento.
- [ ] Manter campanhas promocionais desativadas até existir consentimento e descadastro.

**Saída da semana:** o ciclo completo do agendamento funciona sem inconsistência operacional ou financeira.

## Semana 3 — 14 a 20 de setembro

### Estoque, compras e vendas

- [ ] Registrar compra e entrada de estoque.
- [ ] Conferir parcelas e contas a pagar geradas pela compra.
- [ ] Fazer venda interna à vista e parcelada.
- [ ] Fazer pedido pelo catálogo público.
- [ ] Validar baixa de produto e variação.
- [ ] Validar materiais consumidos pelo atendimento.
- [ ] Testar cancelamento, devolução parcial, crédito e reembolso.
- [ ] Revisar estoque crítico, lotes e validade.

### Financeiro

- [ ] Conferir sinal, saldo restante e recebíveis.
- [ ] Conferir contas a pagar e a receber.
- [ ] Validar caixa, taxas, parcelamento e formas de pagamento.
- [ ] Comparar dashboard, relatórios e razão financeiro.
- [ ] Garantir que cancelamentos e estornos não permaneçam como receita.

**Saída da semana:** estoque e financeiro representam exatamente as operações realizadas.

## Semana 4 — 21 a 27 de setembro

### Integrações e produção

- [ ] Homologar Asaas em sandbox com webhook real.
- [ ] Homologar SMTP com uma conta e remetente reais.
- [ ] Homologar Cloudflare R2 com arquivos públicos e privados.
- [ ] Confirmar domínio, HTTPS, CORS e URLs públicas.
- [ ] Configurar secrets de produção.
- [ ] Aplicar e verificar migrations no ambiente de produção.
- [ ] Validar backup e procedimento de restauração.
- [ ] Confirmar logs, saúde da API e alertas operacionais.

### Segurança e privacidade

- [ ] Trocar todas as senhas temporárias.
- [ ] Ativar MFA do superadmin.
- [ ] Revisar acessos de usuários e permissões.
- [ ] Validar isolamento entre clínicas.
- [ ] Confirmar proteção de arquivos clínicos e comprovantes.
- [ ] Revisar termos, privacidade e retenção de dados.

**Saída da semana:** ambiente de produção pronto para receber dados reais.

## Lançamento — 28 a 30 de setembro

- [ ] Criar a primeira clínica de produção.
- [ ] Fazer onboarding acompanhado do responsável.
- [ ] Executar um agendamento, atendimento e venda controlados.
- [ ] Confirmar cobrança, estoque, financeiro e comunicação.
- [ ] Monitorar erros e suporte durante o primeiro dia.
- [ ] Corrigir somente bloqueios e riscos; melhorias entram no próximo ciclo.
- [ ] Registrar a decisão final de lançamento.

## Critérios de Go/No-Go

O lançamento pode avançar quando todos os itens abaixo forem verdadeiros:

- [ ] Cadastro e login funcionam sem intervenção no banco.
- [ ] Nenhuma falha aberta pode misturar dados entre clínicas.
- [ ] Agenda impede conflito e preserva histórico em cancelamentos.
- [ ] Estoque não fica negativo nem diverge após venda, atendimento ou devolução.
- [ ] Financeiro não duplica cobrança, receita, parcela ou estorno.
- [ ] Asaas recebe webhooks e concilia pagamentos.
- [ ] Arquivos privados não ficam públicos.
- [ ] Backup e restauração foram exercitados.
- [ ] Há um canal claro de suporte para as primeiras clínicas.

Se qualquer item acima falhar, o lançamento fica **No-Go** até a correção.

## Fora do escopo do lançamento

- Campanhas de marketing por e-mail ou WhatsApp sem consentimento.
- Novas integrações que não bloqueiam a operação principal.
- Mudanças grandes de identidade visual.
- Funcionalidades solicitadas por um único teste sem validação do problema.
- Expansão comercial antes de estabilizar as primeiras clínicas.

## Registro rápido de decisões

| Data | Área | Decisão ou problema | Prioridade | Responsável | Estado |
| --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |

## Resultado do lançamento

| Campo | Preenchimento |
| --- | --- |
| Data efetiva | A definir |
| Primeira clínica | A definir |
| Plano inicial | A definir |
| Responsável pelo suporte | A definir |
| Decisão | `Go` / `No-Go` |
| Pendências aceitas | A definir |

