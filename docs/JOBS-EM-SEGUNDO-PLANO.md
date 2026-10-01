# Jobs em segundo plano

## Objetivo

Tarefas que podem demorar — inicialmente, exportação de relatórios CSV — não
devem manter a requisição HTTP aberta nem competir com a agenda e o checkout.
A tabela `background_jobs` existe dentro do schema de cada clínica para que
nenhuma clínica consiga listar, executar ou baixar um trabalho de outra.

## Contrato atual

- `POST /api/jobs/report-exports` aceita `type` (um dos relatórios de
  `REPORT_CATALOG`, em `services/reports.js`), `format` (só `csv`; outro valor
  responde `400`) e `filters`, exige `Idempotency-Key` (sem ela, `400`) e
  responde `202` com o job enfileirado. Dos filtros, só `from`, `to`, `status`,
  `professional_id`, `product_id` e `category` chegam ao job.
- Repetir o mesmo pedido com a mesma chave devolve o mesmo job, com `200`;
  reutilizar a chave com payload diferente responde `409`. A chave vale por tipo
  de job e por usuário solicitante: o índice único
  `(type, requested_by, idempotency_key)` e o hash do pedido persistem essa
  garantia entre processos e deploys.
- `GET /api/jobs` lista os jobs mais recentes da clínica: 30 por padrão, até
  100 com `limit`, e filtro opcional por `status`.
- `GET /api/jobs/metrics` é exclusivo de admin e mostra profundidade por
  estado e idade do job mais antigo na fila.
- `GET /api/jobs/:id/download` transmite o CSV privado depois que o job fica
  `completed` (antes disso, `409`); o arquivo não recebe URL pública e a
  resposta usa `Cache-Control: private, no-store`. O objeto se chama
  `export-<tipo>-<uuid do job>.csv` e fica no bucket privado em
  `tenant_<id>/report_export/` (prefixo de armazenamento pelo id da clínica,
  diferente do nome do schema, `tenant_<slug>`; ou no disco local, sem R2), com linha em
  `private_files` (purpose `report_export`). Ver [R2.md](./R2.md).

## Acesso e plano

- Todas as rotas, menos `/metrics`, exigem o recurso `basic_reports` do plano
  da clínica, e cada relatório exige também as features listadas em
  `REPORT_FEATURE_REQUIREMENTS` (por exemplo, `basic_finance` para os
  relatórios financeiros e de compras). A listagem omite os jobs de relatórios
  que o plano atual não cobre.
- Papéis aceitos: `admin`, `finance` e `reception`. Os relatórios `financial`,
  `payments` e `commissions` só podem ser pedidos ou baixados por `admin` e
  `finance`.
- A recepção só lista e baixa os jobs que ela mesma pediu; job de outra pessoa
  responde `404`.
- A fila confere o papel-base do usuário (`requireRole`), não as permissões
  granulares nem a regra de relatório próprio que `GET /api/reports/:type`
  aplica (`reports.view_financial`, `reports.view_all`, `reports.view_own`).

O worker é **desligado por padrão**. Para ativá-lo depois de aplicar as
migrations, defina `JOBS_WORKER_ENABLED=true`. Em uma instalação pequena ele
pode rodar junto da API; em produção com réplicas, o recomendado é subir uma
instância dedicada com essa variável e deixá-la desligada nas réplicas HTTP.
O intervalo padrão é cinco segundos e pode ser ajustado, entre 1 e 60 segundos,
por `JOBS_WORKER_INTERVAL_MS`. O worker é iniciado pelo próprio processo da API
(`startJobWorker` em `backend/src/index.js`) e, a cada ciclo, percorre as
clínicas com status `ativo`, reivindicando no máximo um job por clínica.

## Confiabilidade

O consumidor usa `FOR UPDATE SKIP LOCKED`, marca uma linha como `running` e
incrementa tentativas antes de executar. Uma instância caída deixa um lease de
15 minutos: a próxima reivindicação o devolve à fila, desde que ainda restem
tentativas — um job abandonado na última tentativa fica em `running`. Falhas
são reenfileiradas com atraso de um minuto até `max_attempts` (3); então viram
`failed` e o erro aparece no campo `error` da listagem. A exportação usa o
UUID do job no nome do objeto, logo uma nova tentativa sobrescreve o mesmo
artefato em vez de duplicá-lo.

## Limites desta primeira etapa

- O executor entregue processa `report_export` em CSV. Os tipos de importação
  e reconciliação estão reservados no esquema, mas só devem ganhar endpoint e
  executor quando suas validações específicas forem portadas para a fila.
- Não há fila externa, autoscaling, alerta ou dashboard central: esses itens
  dependem de infraestrutura/observabilidade.
- CSV é deliberado nesta versão por permitir transferência simples; XLSX/PDF
  continuam síncronos até serem adaptados para artefato privado.
- Nenhuma tela do frontend usa a fila. A central de relatórios exporta PDF,
  XLSX, CSV e TXT de forma síncrona, por `GET /api/reports/:type` com `format`.
- O CSV da fila não acompanha a exportação síncrona: o cabeçalho traz as chaves
  técnicas das colunas, sem rótulos em português, tradução de valores nem BOM,
  e o job não grava evento em `audit_events`.
- Nos relatórios com paginação no servidor (`pagination: "server"` em
  `REPORT_CATALOG`, como `audit`, `payables` e `stock_movements`), o executor não
  desliga a paginação, e o CSV sai só com a primeira página (25 linhas).
