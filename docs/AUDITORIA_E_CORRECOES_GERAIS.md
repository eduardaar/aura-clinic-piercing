# Auditoria e Correções Gerais

## Resumo

Esta rodada consolidou correções estruturais no fluxo de agendamentos, estoque, catálogo público e SaaS, preservando as funcionalidades existentes.

## Correções aplicadas

- Agendamentos internos agora suportam múltiplos itens por atendimento.
- Foi adicionada a tabela `appointment_items`, mantendo compatibilidade com os campos legados `jewelry_id` e `jewelry_variant_id`.
- O cálculo do agendamento passa a somar procedimento, joia e quantidade de cada item.
- A ordem de serviço gerada ao finalizar um atendimento registra itens de serviço e produtos vinculados.
- A baixa automática de estoque considera cada item do atendimento e sua quantidade.
- O cancelamento de atendimento já finalizado restaura o estoque baixado.
- O backend valida estoque disponível antes de salvar itens de joalheria em agendamentos.
- O catálogo público agora recebe explicitamente `is_catalog_active`, `is_published`, `status` e variações ativas.
- Variações inativas não são expostas na vitrine pública.
- Novas clínicas permanecem em teste grátis por 7 dias.
- Quando o teste expira, a assinatura passa para `trial_expired` e recursos pagos ficam bloqueados.
- O painel de plataforma exibe status da assinatura e possui ação para ativar ou renovar clínica.

## Arquivos principais alterados

- `backend/src/db/schema.sql`
- `backend/src/routes/appointments.js`
- `backend/src/routes/catalog.js`
- `backend/src/routes/platform.js`
- `backend/src/services/appointments.js`
- `backend/src/services/sales.js`
- `backend/src/services/subscriptions.js`
- `backend/tests/flow.test.mjs`
- `frontend/src/features/agenda/Agenda.jsx`
- `frontend/src/features/platform/PlatformAdmin.jsx`
- `frontend/src/lib/defaultForms.js`
- `frontend/src/styles.css`

## Validações executadas

- `npm run build`
- `$env:AUTH_SECRET='test-local-secret-for-aura-clinic'; npm --prefix backend test`

## Resultado

- Build do frontend concluído com sucesso.
- Testes do backend concluídos com sucesso: 128 testes aprovados.

## Como validar localmente

1. Iniciar backend e frontend.
2. Criar serviço, procedimento, profissional e disponibilidade.
3. Criar um agendamento interno com mais de um item em "Procedimentos E Joias".
4. Verificar se total, sinal, restante e itens são calculados corretamente.
5. Finalizar o atendimento e conferir ordem de serviço, financeiro e baixa de estoque.
6. Cancelar atendimento finalizado e conferir restauração de estoque.
7. Abrir o catálogo público e confirmar que apenas produtos ativos aparecem.
8. No painel de plataforma, conferir teste grátis, status da assinatura e botão "Ativar/Renovar".

