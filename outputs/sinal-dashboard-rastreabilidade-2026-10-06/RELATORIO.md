# Validação — sinal, Dashboard e rastreabilidade

Data: 06/10/2026. Continuação dos itens 2–5, com implementação dos itens 6–10. Alterações locais sobre `ab290dda`; sem publicação ou alteração de banco de produção.

## Resultado por pedido

| Pedido | Implementação e evidência |
| --- | --- |
| 6 — sinal realmente recebido | Campo manual com orientação; expectativa preservada em `deposit_expected_value`, recebimento calculado dos pagamentos confirmados. Sinais R$ 10, R$ 25 e R$ 60 com expectativa R$ 25 deixam saldos R$ 90, R$ 75 e R$ 40 em operações de R$ 100. Pendente não abate saldo. Relatório distingue esperado, informado e recebido. Serviço com sinal zero não usa fallback de R$ 25. |
| 7 — conferência antes de finalizar | Campo editável, resumo e saldo acompanham a alteração. Pagamento conserva o ID; auditorias registram autor, motivo, valor anterior e novo. Fechamento usa o saldo recém-gravado para a linha padrão, inclusive se a prévia ainda estiver carregando. Teste de componente verifica correção R$ 50 → R$ 60 e restante R$ 79,90 em atendimento líquido R$ 139,90. |
| 8 — próximo agendamento | Data/hora em São Paulo; suporta minutos ou segundos. Exclui horários passados e estados encerrados/remarcados/em atendimento. Teste compara o resultado da API com SQL independente após criar, reagendar, cancelar e concluir. Relógio da tela atualiza sem navegação; API é atualizada periodicamente e na retomada de foco. |
| 9 — conexão entre módulos | Baixa financeira de título integrado gera/atualiza pagamento único ligado ao título e saldo da operação. Repetição de baixa parcial ou total não duplica recebimento. Ledger e origem evitam somar título e pagamento duas vezes. Confirmação de intent não revive sinais cancelados nem reabre atendimento encerrado. Caixa confirmado é tratado igualmente nas séries e totais; datas com fuso do gateway são convertidas para a data civil da clínica. Cache de Agenda, Financeiro, Dashboard, relatórios e histórico é invalidado após alterações. |
| 10 — validação | Testes backend/frontend e oito cenários de navegador com API e PostgreSQL reais em bancos descartáveis. Os testes anteriores de filtros combinados, origem e PDF/XLSX/CSV/TXT foram preservados e reexecutados. |

## Verificação realizada

- Backend completo: **725/725**, banco PostgreSQL descartável. Inclui autenticação, sessões, filtros, descontos, ajustes, comissões, procedimentos, profissionais, estoque, vendas, agendamentos, relatórios e integridade transacional. Após a última normalização de fuso no gateway: **37/37** em sinal/rastreabilidade, Dashboard e Asaas.
- Frontend: **375/375** — 65 testes unitários e 310 testes de componentes em 37 arquivos. Inclui resumo financeiro, alteração do sinal, filtros, permissões e sessão.
- Navegadores: **58 verificações**, Chromium em 320/390/768/1366px e WebKit em 320/375/390/768px. Login real, encerramento/reabertura do processo do navegador com estado da sessão, edição do sinal de R$ 10 para R$ 60, finalização deixando R$ 40 pendentes, consulta da origem financeira, filtros com um e nenhum resultado, contagem coerente, menus e layout sem transbordamento lateral. Vários resultados e combinações de data/profissional/cliente/status são cobertos nos testes HTTP.
- Exportações: regressão abre CSV, TXT, XLSX e texto extraído dos streams de PDF e compara os registros filtrados; tela e formatos usam `buildReport`.
- Tipagem e build aprovados. Lint dos 14 arquivos de implementação desta rodada sem erros (13 avisos de padrões já presentes). `git diff --check` sem erros.

Os testes reais de navegador encontraram dois defeitos adicionais, corrigidos antes da aprovação: colunas inline impediam os cards de pagamentos no celular, e a ancoragem automática de rolagem deslocava controles durante a atualização financeira. Agora os cards usam uma coluna e o modal preserva a posição de rolagem.

## Evidências e repetição

- [Conferência financeira em WebKit, 390px](./sinal-finalizacao-iphone-webkit-390.png).
- [Relatório em desktop, 1366px](./relatorio-desktop-1366.png).
- [Teste de navegador](./browser-validation.test.mjs), [harness React](./browser-harness.jsx) e [HTML de teste](./browser-harness.html).
- [Runner isolado](./run-isolated-tests.cjs): execute a partir da raiz com Node. Exige PostgreSQL local e permissão de criar banco; cria e remove somente sua base descartável. Desabilita credenciais externas na execução. Para selecionar testes, passe os caminhos relativos a `backend`, como `tests/depositDashboardTraceability.test.mjs`.

Para repetir o navegador, restaure os dois arquivos do harness como `frontend/.qa-traceability.jsx` e `.html`; use Vite em 5184 com `VITE_API_URL=/api` e `VITE_DEV_API_TARGET=http://localhost:4299`; configure `AURA_PLAYWRIGHT_MODULE` para o `index.mjs` de uma instalação de Playwright com Chromium/WebKit. Execute o runner isolado passando `../outputs/sinal-dashboard-rastreabilidade-2026-10-06/browser-validation.test.mjs`. Remova o harness do frontend ao terminar. Ele monta componentes reais e encaminha requisições à API descartável; não simula respostas de negócio.

## Banco e limites

A migration tenant **0043_deposit_expectation.sql** deve ser aplicada no ambiente de publicação. Acrescenta expectativa de sinal e vínculo único entre baixa e pagamento. Não inventa valores esperados de registros antigos; não modifica migrations já aplicadas. O baseline foi atualizado para novas clínicas.

Não houve deploy, alteração de registros reais ou chamada ao gateway externo. A integração Asaas foi testada internamente; a homologação no sandbox externo continua pendente. As telas foram verificadas em WebKit com toque e tamanhos de iPhone, sem acesso a iPhone ou tablet físicos. A matriz automatizada cobre os fluxos descritos; não constitui garantia de ausência de qualquer defeito em todos os fluxos do produto.
