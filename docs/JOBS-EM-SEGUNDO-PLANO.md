# Jobs em segundo plano

## Objetivo

Tarefas que podem demorar — inicialmente, exportação de relatórios CSV — não
devem manter a requisição HTTP aberta nem competir com a agenda e o checkout.
A tabela `background_jobs` existe dentro de cada schema `tenant_<id>` para que
nenhuma clínica consiga listar, executar ou baixar um trabalho de outra.

## Contrato atual

- `POST /api/jobs/report-exports` aceita relatório e filtros, exige
  `Idempotency-Key` e responde `202` com o job enfileirado.
- Repetir o mesmo pedido com a mesma chave devolve o mesmo job; reutilizar a
  chave com payload diferente responde `409`. O índice único e o hash do pedido
  persistem essa garantia entre processos e deploys.
- `GET /api/jobs` lista os últimos 100 jobs da clínica.
- `GET /api/jobs/metrics` é exclusivo de admin e mostra profundidade por
  estado e idade do job mais antigo na fila.
- `GET /api/jobs/:id/download` transmite o CSV privado depois que o job fica
  `completed`; o arquivo não recebe URL pública e a resposta usa
  `Cache-Control: private, no-store`.

O worker é **desligado por padrão**. Para ativá-lo depois de aplicar as
migrations, defina `JOBS_WORKER_ENABLED=true`. Em uma instalação pequena ele
pode rodar junto da API; em produção com réplicas, o recomendado é subir uma
instância dedicada com essa variável e deixá-la desligada nas réplicas HTTP.
O intervalo padrão é cinco segundos e pode ser ajustado, entre 1 e 60 segundos,
por `JOBS_WORKER_INTERVAL_MS`.

## Confiabilidade

O consumidor usa `FOR UPDATE SKIP LOCKED`, marca uma linha como `running` e
incrementa tentativas antes de executar. Uma instância caída deixa um lease de
15 minutos: a próxima reivindicação o devolve à fila. Falhas são reenfileiradas
com atraso de um minuto até `max_attempts` (3); então viram `failed` e ficam
visíveis para administração. A exportação usa o UUID do job no nome do objeto,
logo uma nova tentativa sobrescreve o mesmo artefato em vez de duplicá-lo.

## Limites desta primeira etapa

- O executor entregue processa `report_export` em CSV. Os tipos de importação
  e reconciliação estão reservados no esquema, mas só devem ganhar endpoint e
  executor quando suas validações específicas forem portadas para a fila.
- Não há fila externa, autoscaling, alerta ou dashboard central: esses itens
  dependem de infraestrutura/observabilidade.
- CSV é deliberado nesta versão por permitir transferência simples; XLSX/PDF
  continuam síncronos até serem adaptados para artefato privado.
