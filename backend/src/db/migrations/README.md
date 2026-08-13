# Migrations versionadas

As migrations novas da Aura Clinic vivem neste diretório. O `schema.sql` e o
`platformSchema.sql` ainda são aplicados durante a fase de transição para
preservar instalações antigas; toda mudança nova de banco deve, porém, ser uma
migration imutável aqui.

## Convenção

- `platform/NNNN_descricao.sql`: altera somente objetos do schema `platform`.
- `tenant/NNNN_descricao.sql`: altera objetos do schema da clínica atual, sem
  qualificá-lo pelo nome. A mesma migration é executada uma vez por tenant.
- O prefixo numérico precisa ter quatro dígitos e não pode ser repetido dentro
  do mesmo escopo.
- Uma migration já aplicada **nunca é editada**. O runner grava SHA-256 no
  ledger `platform.schema_migrations` e interrompe se o arquivo mudar.
- Migrações devem poder rodar dentro de uma transação e ser compatíveis com a
  estratégia expand/contract: adicione estruturas, publique código compatível,
  faça backfill separado e só então remova o legado numa migration posterior.

## Operação

```bash
npm --prefix backend run migrations:verify
npm --prefix backend run migrations:status
npm --prefix backend run migrations:apply
```

`migrations:apply` é seguro para repetir: usa lock transacional por escopo e
tenant, valida o checksum antes de executar e registra cada versão no mesmo
commit do SQL. Em produção, execute `verify` no artefato que será publicado e
`apply` como etapa explícita do deploy; o boot apenas aplica migrations quando
`RUN_MIGRATIONS_ON_BOOT=true`.

As migrations `0001_baseline.sql` apenas marcam o estado pré-existente criado
pelos schemas idempotentes. Elas não recriam uma instalação vazia sozinhas.
