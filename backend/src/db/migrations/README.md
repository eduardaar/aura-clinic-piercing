# Migrations versionadas

As migrations novas da Aura Clinic vivem neste diretório. O `schema.sql` e o
`platformSchema.sql` ainda são aplicados durante a fase de transição para
preservar instalações antigas; toda mudança nova de banco deve, porém, ser uma
migration imutável aqui.

O `schema.sql` não espelha todas as migrations de tenant, e ainda declara
estruturas que migrations posteriores removeram (por exemplo `consumables`,
apagada pela `tenant/0025_unified_inventory_items`). O estado de referência de
uma clínica é sempre `schema.sql` seguido de todas as migrations de tenant, na
ordem — é exatamente o que `provisionTenant()` (`services/tenants.js`) aplica
ao criar uma clínica nova.

## Convenção

- `platform/NNNN_descricao.sql`: altera somente objetos do schema `platform`.
- `tenant/NNNN_descricao.sql`: altera objetos do schema da clínica atual, sem
  qualificá-lo pelo nome. A mesma migration é executada uma vez por tenant.
- O prefixo numérico precisa ter quatro dígitos e não pode ser repetido dentro
  do mesmo escopo (o runner recusa versão duplicada). O nome segue
  `NNNN_descricao.sql`, com a descrição em minúsculas, dígitos, `_` ou `-`.
- Uma migration já aplicada **nunca é editada**. O runner grava SHA-256 no
  ledger `platform.schema_migrations` e interrompe se o arquivo mudar. O
  checksum é calculado com quebras de linha normalizadas para LF, então o mesmo
  arquivo em CRLF (Windows) é aceito.
- Migrações devem poder rodar dentro de uma transação e ser compatíveis com a
  estratégia expand/contract: adicione estruturas, publique código compatível,
  faça backfill separado e só então remova o legado numa migration posterior.
  O runner recusa arquivo com `BEGIN;`, `COMMIT`, `ROLLBACK` ou
  `START TRANSACTION`; blocos `DO $$ ... $$` são permitidos.

## Numeração atual

| Escopo | Versões | Observação |
| --- | --- | --- |
| `platform` | `0001`–`0008` | Sequência contínua. |
| `tenant` | `0001`–`0025` e `0028`–`0042` | `0026` e `0027` não existem. |

As versões tenant `0026` e `0027` nunca foram criadas no histórico do
repositório: a `0025_unified_inventory_items` e a `0028_client_relationship`
entraram no mesmo dia (30/08/2026), em commits separados, e a numeração pulou
esses dois números. O runner não exige sequência contínua — só ordem e
unicidade —, então a lacuna é inofensiva. Evite preenchê-la: uma `0026`
criada agora rodaria depois da `0037` nos bancos já migrados, mas antes dela
numa clínica nova.

Colisão de número já aconteceu: a migration de campos clínicos da execução de
atendimento nasceu como `0021_service_execution_clinical_fields` e foi
renumerada para `0024` (commit `9f8a1d49`), porque `0021_client_profile_360`
já ocupava o número. Antes de criar uma migration, confira o último número do
escopo no branch principal.

## Operação

```bash
npm --prefix backend run migrations:verify
npm --prefix backend run migrations:status
npm --prefix backend run migrations:apply
```

- `status` lista, por schema, quantas versões estão aplicadas e pendentes.
- `verify` faz o mesmo e termina com erro se houver pendência.
- Os três comandos interrompem com erro se encontrarem checksum alterado ou
  versão no ledger que não existe mais nos arquivos.
- `apply` aplica as pendentes. Sem `--tenant`, cobre o schema `platform` e
  todas as clínicas de `platform.tenants`; com `--tenant=<id|slug>`, só aquela
  clínica (e não o `platform`).

Todos os comandos falam com o banco de `DATABASE_URL` e exigem que o schema
`platform` já exista (o CLI recusa rodar sem ele).

`migrations:apply` é seguro para repetir: usa lock transacional por escopo e
tenant, valida o checksum antes de executar e registra cada versão no mesmo
commit do SQL. O boot da API só aplica migrations quando
`RUN_MIGRATIONS_ON_BOOT=true`, o que é proibido em produção.

### Localmente

Fora de produção, `npm --prefix backend run migrations:apply` aplica tudo o
que estiver pendente, sem flags extras. Para recomeçar do zero numa base local,
`npm --prefix backend run db:reset-local` apaga todos os schemas `tenant_*` e o
`platform`, recria a plataforma e aplica as migrations de plataforma; o script
recusa rodar com `NODE_ENV=production` ou com `DATABASE_URL` fora de
`localhost`, `127.0.0.1` ou `::1`.

### Operação controlada por tenant

Para reparos pontuais, o CLI aceita as opções abaixo; `--target`,
`--allow-reconciliation` e `--adopt-existing` exigem `--tenant=<id|slug>`:

- `--target=<versão>`: aplica só aquela versão (exige as anteriores no ledger,
  a menos que se use `--allow-reconciliation`) e confere a estrutura resultante;
- `--dry-run`: mostra o que seria aplicado, sem gravar;
- `--adopt-existing` (com `apply --target`): registra no ledger uma versão cuja
  estrutura já existe no banco, desde que a impressão digital estrutural
  (`db/migrationStructure.js`) seja equivalente; a adoção fica registrada em
  `migration_adoption_audit` no schema da clínica.

A conferência estrutural só tem impressão digital definida para as versões
tenant `0001` a `0005` (e platform `0001`); `--target` com outra versão falha
nessa conferência e a transação é desfeita. Para as demais, use o `apply`
normal.

### Produção

Em produção, o deploy normal não executa migrations: `scripts/deploy.sh`
grava `RUN_DATABASE_MIGRATIONS=false`, `SKIP_DATABASE_BOOTSTRAP=true` e
`RUN_MIGRATIONS_ON_BOOT=false` no `.env` do servidor. A política vive em
`db/migrationPolicy.js`: `apply` exige `--tenant=<id|slug>`; rollout global
requer simultaneamente `--all` e `ALLOW_GLOBAL_MIGRATIONS=true`. O bootstrap
legado global também fica desligado por padrão e não é autorizado apenas por
`RUN_DATABASE_MIGRATIONS=true` (exige `ALLOW_LEGACY_GLOBAL_BOOTSTRAP=true`).

O rollout global é feito pelo workflow manual
`.github/workflows/migrations-production.yml` ("Aplicar migrations em
produção"), disparado no GitHub Actions com a confirmação `APLICAR`. Ele roda no
ambiente `production`, um de cada vez, e no servidor:

1. gera um `pg_dump` comprimido como ponto de restauração e o valida
   (`gzip -t` e marcador de dump completo);
2. roda `migrations.mjs status`, `apply --all` com
   `ALLOW_GLOBAL_MIGRATIONS=true` e `verify` dentro do container da API;
3. recria o container da API e consulta `/api/health/db` até 6 vezes,
   falhando se o banco não aparecer como conectado.

As migrations `0001_baseline.sql` apenas marcam o estado pré-existente criado
pelos schemas idempotentes. Elas não recriam uma instalação vazia sozinhas.
