# Pendências

Levantado em 28/07/2026, ao fim da rodada de fundação (commits `3a8ea61`..`96f05d2`).
Cada item traz onde está e o que se sabe — não é lista de desejos, é o que foi
encontrado e conscientemente adiado.

---

## Bugs

### 1. Venda aceita quantidade que não existe em estoque
A validação de estoque na linha de venda só roda para produto **com variação**:
`line.item_type === "produto" && variant && quantity > variant.quantity`. Produto
sem variação não passa por checagem nenhuma, e `backend/src/services/sales.js`
usa `Math.max(0, ...)` em vez de rejeitar. Vender 50 unidades de um produto com
3 em estoque funciona: a venda é registrada e o saldo vai a zero.

Achado em `frontend/src/features/sales/Sales.jsx` ao investigar a variável morta
`availableQuantity`, que era resto de uma validação que nunca chegou a ser
exibida.

### 2. "Atendido" é irreversível na prática
Marcar um agendamento como atendido dispara cinco efeitos: baixa de estoque,
pagamento do restante, ordem de serviço, pós-atendimento e pontos de fidelidade.
Voltar o status para `pendente` **não desfaz nenhum deles**. Marcar por engano
hoje exige limpeza direta no banco.

### 3. Busca de joias não acha acento
O filtro `search` de `GET /api/jewelry` usa `LIKE` sensível a caixa e acento:
`?search=titanio` devolve zero, porque o dado é "Titânio". Os filtros de busca
criados depois (clientes, agendamentos, vendas) usam `ILIKE` e não têm o
problema. Corrigir exige `ILIKE` + normalização, ou `pg_trgm` com índice GIN.

---

## Funcionalidade inacabada

### 4. Modo "virtual" do estoque nunca foi ligado
`inventoryMode` está congelado em `"internal"` porque `setInventoryMode` não é
chamado em lugar nenhum. Isso deixa inalcançável todo o ramo `"virtual"` de
`filteredItems`, os cinco filtros de `badgeTab` (lançamentos, promoções, mais
desejados, últimas unidades, destaques) e o filtro por `is_catalog_active`.

O que falta é só o controle na interface: o CSS dele (`.inventory-mode-switch`,
`.inventory-badge-tabs`, com estados `.active`) existe desde o primeiro commit e
nunca apareceu em nenhum JSX. A lógica e o estilo foram construídos, o botão não.

### 5. Funil de CRM e mapa corporal não têm tela própria
Sobreviveram em `GET /api/erp` quando o conteúdo fictício saiu, e **não são
calculados em nenhum outro lugar do sistema**: o funil (Lead / Cliente /
recorrente / VIP, por contagem de atendimentos) e o mapa corporal (as 8 regiões
mais perfuradas).

Lugar natural: dois tipos novos em `buildReport` (`backend/src/services/reports.js`),
o que lhes daria a tela de Relatórios e a exportação PDF/XLSX/CSV de graça.

### 6. Monitor de erros sem interface
`GET /api/error-logs` e a tabela `error_logs` seguem no ar, e
`lib/errorReporter.js` continua enviando relatos. Mas a tela foi removida do app
da clínica (expunha stack traces e caminhos do servidor), então **ninguém tem
como ler**. O lugar certo é o painel `/plataforma`.

---

## Segurança

### 7. Uploads sem separação por clínica
Comprovantes de pagamento e PDFs de termo — arquivos sensíveis — vão para um
diretório compartilhado entre todos os tenants. Pendência antiga, agravada pelo
volume atual.

### 8. Sem lugar seguro para credencial por clínica
Pré-requisito da integração com gateway de pagamento. Hoje não existe:
`clinic_settings` é fixa, `platform.tenants` não tem coluna livre, e
`catalog_settings` — o único KV por tenant — **vaza inteiro na rota pública**
`GET /api/catalog`. Ver `docs/AURA-CLINIC-ERP-2.0.md` e o roadmap de pagamentos.

---

## Dívida técnica

### 9. Ampliar o `checkJs` às telas
Os typedefs do `DataView` só rejeitam coluna mal definida quando o arquivo que
**chama** entra no escopo. Hoje valem no editor; a CI não valida nenhum call
site. Ordem sugerida: `features/shared/` → telas que mais usam `DataView` →
`backend/src/services/` → `backend/src/routes/`. Só depois ligar
`strictNullChecks`.

Falta também acrescentar `npm run typecheck` ao workflow do GitHub Actions —
adiado para não colocar verificação bloqueante nova junto com um deploy grande.

### 10. Formatação em massa com Biome
`npm run format:all` mudaria **21.847 linhas em 135 arquivos**. Deve ser um
commit isolado, sem nenhuma mudança lógica junto, com o hash registrado em
`.git-blame-ignore-revs` (senão o `git blame` de 21 mil linhas passa a apontar
para ele e a arqueologia do código morre). Considerar fatiar: backend primeiro,
depois frontend, deixando os quatro arquivos gigantes por último.

Só depois disso adicionar `npm run check` à CI — antes, ela reprovaria em 135
arquivos.

### 11. Roteamento por URL
`react-router-dom` está instalado e nunca foi ativado. Nenhuma tela interna tem
URL: não dá para mandar link de "Vendas" para um colega, o botão voltar do
navegador sai do sistema, e não há como abrir duas telas em abas.

Adiado de propósito: mexeria na navegação de todas as ~30 telas e no `main.jsx`
junto com um deploy já grande.

### 12. Os 147 achados de lint
`npm run lint`. Nenhum nas categorias clássicas de bug. O grosso: 58
`useExhaustiveDependencies` (44 são dependência faltando — candidatas reais a
stale closure, mas mexer em array de deps muda comportamento), 55
`noUnusedImports` (26 são `import React`, inofensivos pelo runtime automático de
JSX) e 11 `noArrayIndexKey`.

### 13. Dinheiro em `DOUBLE PRECISION`
Todos os valores monetários usam ponto flutuante; somatórios financeiros
acumulam erro. Migrar para `NUMERIC(12,2)`. Ver `docs/AUDIT-DATA-MODEL.md`.

---

## Interface

### 14. Tabelas em coluna estreita
Termos digitais (~395px) e Cupons/Promoções (~600px) ficam num layout de duas
colunas: a tabela respeita o `min-width: 720px` global e rola horizontalmente
dentro do painel. Não vaza, mas em Termos só duas colunas aparecem sem rolar.
Resolver exige mexer no layout de duas colunas dessas telas.

### 15. Enum em inglês na tela de Lançamentos
As colunas Tipo e Status de `AdvancedFinance` exibem o valor cru
(`receivable`, `pending`). Foram traduzidas só nos rótulos do filtro, para não
alterar dado exibido além do combinado na época. Relatórios já resolveu o mesmo
problema com um mapa de tradução — vale reaproveitar.

### 16. Dashboards dentro das listagens
Decisão pendente: Vendas, Financeiro e Clientes abrem com blocos de indicadores
antes da lista, duplicando o que já existe no Dashboard. A proposta era deixar
2–3 números por tela e mover a parte analítica para abas no Dashboard — ou para
Relatórios, que já tem filtro de data livre e exportação. **Não decidido.**

### 17. Resíduos em `permissions.js`
O comentário sobre o `erp.js` exibir conteúdo fictício não vale mais (o conteúdo
foi removido), e `pageTitle()` ainda mapeia `erp` e `error-logs`, que hoje são
chaves inalcançáveis.

---

## Produto

### 18. Integração com o Asaas
O roadmap está desenhado e a fundação (transações, paginação) já foi feita.
Faltam as fases 3 a 6: cofre de credenciais por clínica, webhook multi-tenant,
worker, cobrança de assinatura (Monitence → clínicas) e cobrança da clínica ao
cliente final (sinal de agendamento e venda de joias).

Ponto bloqueante a confirmar antes: **a conta raiz da Monitence precisa ser
CNPJ** para o modelo de subcontas. Se for CPF, o desenho muda.
