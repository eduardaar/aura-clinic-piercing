# Ajustes dos pedidos 2 a 5 — 06/10/2026

Implementação sobre `main` em `ab290dda`, com alterações locais ainda sem commit.

| Pedido | Implementação | Evidência |
| --- | --- | --- |
| 2. Responsividade | Larguras naturais, mínimo de 160px por coluna, rolagem contida no desktop, cards no celular, rótulo/valor empilhados nas telas estreitas, exportações em grade, toque de 44px e campos de 16px | Chromium e WebKit, larguras de 320 a 1920px; capturas abaixo |
| 3. Filtros | API aplica filtros/busca uma vez; lista, contagem e totais usam o mesmo conjunto. Agenda inclui profissional/serviço/joia na busca; Financeiro distingue vencimento de competência; cliente/profissional/status combináveis | `reportFiltersOrigins.test.mjs`, `DataView.test.jsx`, `Reports.test.jsx` |
| 4. Central de Relatórios | Busca e ordenação passam para as exportações dos agregados; JSON/PDF/XLSX/CSV/TXT têm a mesma origem; totais de comissões/ajustes também seguem busca; tabela legível | Teste lê os quatro arquivos e confere o resultado filtrado; testes preexistentes de integridade/autorização continuam aprovados |
| 5. Origem dos recebíveis | Identifica cliente, atendimento/venda, data/hora, profissional, procedimento, itens congelados da execução, pagamentos e parcelas; discrimina sinal confirmado, outros recebimentos, crédito e restante; links abrem o registro específico | Testes de atendimento, venda, manual, pagamentos cancelados/pendentes, redução de parcela e nome de serviço alterado; teste frontend e navegação automatizada |

## Verificações

- Suíte backend completa: **715/715**, em banco PostgreSQL temporário, removido no encerramento. Sem uso das credenciais externas do ambiente local. Após os últimos ajustes, **24/24** testes de relatórios/novas regressões foram reexecutados (o arquivo novo contém oito regressões).
- Frontend: **65/65** unitários e **308/308** testes de componentes, em 36 arquivos Vitest.
- Typecheck de backend/frontend e build aprovados.
- Biome explícito sobre os 17 arquivos JS/testes alterados: zero erros, 18 avisos já existentes. `check:changed` não seleciona esses arquivos nesta cópia de trabalho, por isso foi complementado por lint explícito.
- Validação visual e funcional de navegador: **69 verificações** em Chromium (**320, 360, 390, 430, 768, 1024, 1366 e 1920px**) e WebKit (**320, 375, 390, 430 e 768px**). Componentes reais, respostas fictícias de API, interação com filtros, seleção, menus, modais, Agenda e recebíveis; também abertura específica de venda/atendimento pela query string. Nenhum teste em iPhone físico.
- Nenhuma migration nova e nenhuma alteração de produção.

## Capturas

- [Relatórios no viewport de iPhone, WebKit 390px](relatorios-iphone-webkit-390.png)
- [Relatórios no desktop, 1366px](relatorios-desktop-1366.png)
- [Detalhes do recebível, WebKit 390px](recebivel-origem-iphone-webkit-390.png)

As capturas incluem a navegação do ambiente temporário de testes, que não integra o produto. A revisão compartilhada beneficia todas as telas que usam `DataView`; os cenários acima não representam homologação integral de todos os fluxos particulares do sistema. Permanecem as pendências documentadas P-05 (política de baixa/faturamento), P-06, P-07 e a homologação integral da entrega de 01/10 em P-08.
