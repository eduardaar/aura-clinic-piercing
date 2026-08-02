# Validação da feature Eduarda — 02/08/2026

## Escopo consolidado

A branch reúne as entregas anteriores de busca reutilizável de joias, desempenho por profissional e links públicos por tenant, além desta rodada final de exclusões administrativas seguras.

## Onde validar

- **Agenda → Agenda visual → Detalhes do agendamento**: administradores veem `Excluir definitivamente`; o modal apresenta vínculos, exige motivo e `EXCLUIR AGENDAMENTO`. Agendamentos com pagamento, venda, ficha, termo, pós-atendimento, cupom, promoção, fidelidade, intenção de pagamento ou reserva ativa são bloqueados.
- **Clientes → ações → Excluir cliente**: apenas administradores veem a ação. Cadastros sem histórico são apagados; cadastros com histórico são anonimizados e arquivados, preservando o financeiro e o clínico.
- **Relatórios → Desempenho por profissional**: conferir disponibilidade, dias com atendimento, atendimentos, vendas, faturamento e taxas.
- **Personalização → links públicos**: catálogo e agendamento devem copiar URLs com o slug da clínica.
- **Catálogo público**: conferir busca no topo, cards responsivos, contatos, botão flutuante e ausência de faixa preta/overflow.

## Banco e segurança

- Migration aditiva e idempotente: `clients.deleted_at`, `clients.anonymized_at` e `administrative_audit_logs`.
- Exclusões são transacionais, exigem confirmação literal e motivo, repetem permissões no backend e preservam snapshot de auditoria.
- A listagem e o detalhe comuns não expõem clientes arquivados/anonimizados.

## Evidências locais

- `npm run typecheck`: aprovado.
- `npm --prefix frontend test`: 72 testes aprovados.
- `npm run build`: aprovado (1.690 módulos).
- `npm --prefix backend test`: 365 testes aprovados.
- Navegador: catálogo validado em viewport mobile (375 px efetivos) e desktop (1.425 px efetivos), sem overflow horizontal, bloco preto anômalo ou erro de console.
- O lint global continua informativo no pipeline e reporta o passivo legado já documentado; os arquivos desta rodada não adicionam erros bloqueantes.

## Teste seguro sugerido

Use somente dados fictícios. Crie um cliente descartável sem histórico e confirme a exclusão. Em seguida, crie outro cliente com agendamento e confirme que a ação muda para anonimização. Para agenda, crie um agendamento sem sinal e confirme a exclusão; repita com sinal e confirme o bloqueio com mensagem de preservação do histórico.
