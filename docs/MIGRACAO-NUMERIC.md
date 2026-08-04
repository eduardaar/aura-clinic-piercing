# Migração de dinheiro para `NUMERIC(12,2)`

Pendência 13 (`docs/PENDENCIAS.md`, achado #6 de `docs/AUDIT-DATA-MODEL.md`).
Este documento é o passo a passo de **deploy** dessa migração. A implementação
está em `backend/src/db/schema.sql` (bloco `DO $$` no fim do arquivo) e em
`backend/src/db/postgres.js` (conversão de tipo na saída do driver).

---

## 1. O que muda

**No banco.** 46 colunas monetárias de cada schema de clínica deixam de ser
`DOUBLE PRECISION` e passam a `NUMERIC(12,2)` — decimal exato, sem resíduo de
ponto flutuante em somatório. `professionals.commission_percentage` vira
`NUMERIC(5,2)` porque multiplica dinheiro dentro do SQL do relatório de
comissões.

**Não mudam** (não são dinheiro): `weight_grams`, `package_length_cm`,
`package_width_cm`, `package_height_cm`, `top_size_mm`, `length_mm`
(grandezas físicas), `inventory_suggestions.confidence` (score 0..1),
`price_multiplier` e `clinic_settings.default_price_multiplier` (fator 3 ou 4
que só alimenta cálculo em centavos INTEIROS no JavaScript).

**No código.** O driver `pg` devolve `NUMERIC` como **string** — é o padrão
dele, e é o certo, porque `NUMERIC` arbitrário não cabe em `Number`. Só que
`"10.00" + "5.00"` em JavaScript é `"10.005.00"`, e o sistema inteiro trata
esses campos como número. A conversão de volta para `Number` foi colocada na
camada de acesso das clínicas (`createDb`, em `db/postgres.js`), por query, e
**não** num `pg.types.setTypeParser` global: o painel financeiro da plataforma
(`services/platformFinance.js`) devolve dinheiro como string decimal de
propósito, e um parser global quebraria justamente o código que já faz dinheiro
do jeito certo.

Consequência prática: **o JSON da API não muda**. O frontend continua recebendo
número em todos os campos monetários das clínicas, e string nos campos do painel
da plataforma. Nenhuma tela precisa de ajuste.

**O ganho é a soma feita pelo Postgres.** Aritmética em JavaScript sobre o valor
já convertido continua sendo IEEE-754. Por isso `services/financeLedger.js`
deixou de somar os indicadores com `reduce` e passou a somá-los em SQL.

---

## 2. Como a migração roda

Não existe runner de migração separado: `applySchemaToAllTenants()`
(`services/tenants.js`) aplica `schema.sql` em **todos** os schemas de clínica a
cada boot do servidor (`src/index.js`), antes do `app.listen`. A migração vai
junto.

O bloco `DO $$` no fim de `schema.sql`:

- só converte coluna que **ainda** está em `double precision` (o `JOIN` com
  `information_schema.columns` é o guarda de idempotência);
- emite **um** `ALTER TABLE` por tabela, com todas as colunas dela na mesma
  instrução — 20 reescritas em vez de 46;
- na segunda passada não executa nenhuma iteração, então restart de servidor não
  reescreve tabela nenhuma.

Verificado num banco descartável (`aura_numeric_scratch`, PostgreSQL 16.13):
schema antigo + dados → 1ª passada converte 46 colunas em 20 tabelas → 2ª e 3ª
passadas convertem 0 → o schema migrado fica **tipo a tipo idêntico** a um schema
criado do zero.

---

## 3. Tempo de lock

`ALTER TABLE ... ALTER COLUMN ... TYPE` **reescreve a tabela inteira e todos os
índices dela**, segurando `ACCESS EXCLUSIVE` — nem `SELECT` passa durante a
operação.

Medido no banco descartável (200.000 linhas, SSD local, PostgreSQL 16):

| Tabela         | Colunas convertidas | Tamanho (tabela + índices) | Tempo do `ALTER` |
| -------------- | ------------------- | -------------------------- | ---------------- |
| `appointments` | 7                   | 54 MB                      | **1,7 s**        |
| `payments`     | 3                   | 23 MB                      | **0,6 s**        |

Regra de bolso: **~30 MB/s de tamanho total da relação**. Como as 20 tabelas são
reescritas em sequência, o tempo total por clínica é a soma dos tamanhos delas
dividida por ~30 MB/s — e o tempo do deploy é a soma disso sobre **todas** as
clínicas, porque `applySchemaToAllTenants` roda tenant a tenant.

Para dimensionar antes de subir, rode **no servidor de produção** (só leitura):

```sql
SELECT n.nspname AS clinica,
       pg_size_pretty(sum(pg_total_relation_size(c.oid))) AS a_reescrever,
       round(sum(pg_total_relation_size(c.oid)) / 30.0 / 1024 / 1024, 1) AS segundos_estimados
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname LIKE 'tenant\_%'
   AND c.relkind = 'r'
   AND c.relname IN (
     'appointment_items','appointments','catalog_promotions','coupon_usages','coupons',
     'expenses','financial_entries','financial_goals','financial_reconciliations',
     'jewelry_inventory','jewelry_variants','loyalty_redemptions','payment_intents',
     'payments','procedures','professionals','promotion_usages','sales_order_items',
     'sales_orders','services')
 GROUP BY n.nspname
 ORDER BY 3 DESC;
```

Se o total passar de poucos minutos, avise as clínicas: durante o boot a API
**não responde** (o `listen` só acontece depois das migrações). Isso é uma
proteção, não um defeito — ninguém escreve no banco enquanto ele é reescrito.

---

## 4. Ordem de execução

Alfabética por tabela, definida pelo `ORDER BY m.tabela` do bloco. **A ordem não
importa**: nenhuma chave estrangeira aponta para coluna monetária (todas as FKs
são sobre `id`), então não há dependência entre as conversões.

O que importa é a ordem dentro do arquivo: o bloco `DO $$` é a **última** coisa
de `schema.sql`, depois de todos os `ADD COLUMN IF NOT EXISTS`. Assim uma coluna
recém-adicionada já nasce `NUMERIC` e o bloco simplesmente não a encontra em
`double precision`. Não mova o bloco.

---

## 5. Passo a passo do deploy

1. **Backup — obrigatório e verificado.**
   `scripts/deploy.sh` já faz `pg_dump` antes de subir (linha ~227), mas com
   `|| true` no fim: se o dump falhar, o deploy segue mesmo assim. Para **esta**
   migração isso não serve. Rode o backup à mão antes e confira o tamanho:

   ```bash
   ts=$(date +%Y%m%d-%H%M%S)
   docker exec monitence-postgres pg_dump -U aura -d aura_clinic \
     | gzip > /root/pg-backups/pre-numeric-${ts}.sql.gz
   ls -lh /root/pg-backups/pre-numeric-${ts}.sql.gz   # não pode estar vazio
   gunzip -t /root/pg-backups/pre-numeric-${ts}.sql.gz && echo "backup íntegro"
   ```

2. **Anote o estado atual** (serve de conferência depois):

   ```sql
   SELECT count(*) FILTER (WHERE data_type = 'double precision') AS ainda_double,
          count(*) FILTER (WHERE data_type = 'numeric')          AS ja_numeric
     FROM information_schema.columns
    WHERE table_schema LIKE 'tenant\_%';
   ```

3. **Guarde os totais financeiros de antes.** É a única forma de provar que
   nenhum valor se perdeu na conversão. Para cada clínica:

   ```sql
   SET search_path TO tenant_<id>;
   SELECT sum(amount) AS pagamentos, count(*) FROM payments;
   SELECT sum(total_value) AS agendamentos, count(*) FROM appointments;
   SELECT sum(amount) AS lancamentos, sum(paid_amount) AS baixas FROM financial_entries;
   ```

4. **Suba o deploy normal** (`scripts/deploy.sh`). O `docker compose up -d`
   recria o container: a instância antiga para antes de a nova subir, então não
   há duas versões disputando o `ACCESS EXCLUSIVE`.

5. **Acompanhe o log do boot.** Cada conversão emite um `NOTICE`:

   ```
   NOTICE:  Dinheiro -> NUMERIC: appointments (7 coluna(s), schema tenant_3)
   ```

   Ausência total de `NOTICE` num restart posterior é o esperado: significa que
   já está tudo convertido.

6. **Confira depois.** O `ainda_double` do passo 2 tem de bater exatamente com
   `11 × (número de clínicas)` — são as 11 colunas de grandeza física que ficam
   em `double` de propósito. E os totais do passo 3 têm de bater centavo a
   centavo (a menos de valores com mais de 2 casas decimais, ver §7).

---

## 6. Como reverter

**Reverter só a imagem NÃO resolve.** O código anterior lê o banco sem o
conversor de `NUMERIC`, então receberia string onde espera número e todo
somatório viraria concatenação silenciosa. Se precisar voltar, escolha **uma**
das duas rotas abaixo — nunca só o `rollback` de imagem do `deploy.sh`.

### Rota A — desfazer só o tipo (rápida, preserva os dados novos)

Idempotente, mesmo formato do bloco de ida. Rode uma vez **por schema de
clínica**, com o `search_path` no schema da clínica:

```sql
DO $$
DECLARE
  alvo RECORD;
BEGIN
  FOR alvo IN
    SELECT m.tabela,
           string_agg(format('ALTER COLUMN %I TYPE DOUBLE PRECISION USING %I::double precision',
                             m.coluna, m.coluna), ', ' ORDER BY m.coluna) AS clausulas
      FROM (VALUES
        ('appointment_items','procedure_price'),('appointment_items','jewelry_unit_price'),
        ('appointment_items','subtotal'),
        ('appointments','total_value'),('appointments','deposit_value'),
        ('appointments','remaining_value'),('appointments','service_value'),
        ('appointments','jewelry_value'),('appointments','subtotal_value'),
        ('appointments','discount_value'),
        ('catalog_promotions','discount_value'),('catalog_promotions','minimum_amount'),
        ('catalog_promotions','maximum_discount'),('catalog_promotions','fixed_promotional_price'),
        ('coupon_usages','original_amount'),('coupon_usages','discount_amount'),
        ('coupon_usages','final_amount'),
        ('coupons','discount_value'),('coupons','minimum_amount'),('coupons','maximum_discount'),
        ('expenses','amount'),
        ('financial_entries','amount'),('financial_entries','paid_amount'),
        ('financial_entries','original_paid_amount'),
        ('financial_goals','target_amount'),
        ('financial_reconciliations','statement_amount'),
        ('jewelry_inventory','cost_value'),('jewelry_inventory','sale_value'),
        ('jewelry_variants','cost_value'),('jewelry_variants','sale_value'),
        ('loyalty_redemptions','discount_value'),
        ('payment_intents','amount'),
        ('payments','amount'),('payments','fee_amount'),('payments','net_amount'),
        ('procedures','price'),
        ('professionals','commission_percentage'),
        ('promotion_usages','original_amount'),('promotion_usages','discount_amount'),
        ('promotion_usages','final_amount'),
        ('sales_order_items','unit_price'),
        ('sales_orders','total_value'),('sales_orders','subtotal_value'),
        ('sales_orders','discount_value'),
        ('services','price'),('services','deposit_value')
      ) AS m(tabela, coluna)
      JOIN information_schema.columns c
        ON c.table_schema = current_schema()
       AND c.table_name   = m.tabela
       AND c.column_name  = m.coluna
       AND c.data_type    = 'numeric'
      GROUP BY m.tabela
      ORDER BY m.tabela
  LOOP
    RAISE NOTICE 'Revertendo para DOUBLE: % (schema %)', alvo.tabela, current_schema();
    EXECUTE format('ALTER TABLE %I %s', alvo.tabela, alvo.clausulas);
  END LOOP;
END
$$;
```

Custo: o mesmo `ACCESS EXCLUSIVE` e o mesmo tempo da ida. **Só faça isso com a
imagem antiga já no ar**, senão o próximo boot da imagem nova converte tudo de
volta.

### Rota B — restaurar o backup (completa, perde o que entrou desde o dump)

```bash
docker compose stop aura-api
gunzip -c /root/pg-backups/pre-numeric-<ts>.sql.gz \
  | docker exec -i monitence-postgres psql -U aura -d aura_clinic
# só então volte a imagem antiga
```

---

## 7. Riscos conhecidos

- **Rollback de imagem sem rollback de banco quebra o sistema em silêncio.** É o
  risco número um; ver §6. Vale a pena avisar quem opera o `deploy.sh` de que o
  atalho de rollback dele não cobre este deploy.

- **Valores com mais de 2 casas decimais são arredondados** (half-up) na
  conversão: `0.005` vira `0.01`. Não deveria existir dinheiro com 3 casas no
  banco, mas taxa de gateway (`payments.fee_amount`) e valor estimado podem ter
  entrado assim. Para saber antes de migrar:

  ```sql
  SET search_path TO tenant_<id>;
  SELECT count(*) FROM payments WHERE fee_amount <> round(fee_amount::numeric, 2);
  SELECT count(*) FROM payments WHERE amount     <> round(amount::numeric, 2);
  ```

  Se aparecer algo, o total somado muda em centavos — e é justamente esse o
  ponto da migração (o valor com 3 casas nunca foi cobrável).

- **A API fica fora do ar durante o boot**, pelo tempo da soma de todas as
  clínicas (§3). E se **uma** clínica falhar, `applySchemaToAllTenants` propaga o
  erro e o servidor **não sobe** — a falha é barulhenta, não silenciosa, mas
  derruba o deploy inteiro.

- **Espaço em disco:** a reescrita cria uma cópia nova da tabela antes de soltar
  a antiga. Reserve o dobro do tamanho da maior tabela migrada, mais o WAL. Se o
  volume estiver acima de ~80%, libere espaço antes.

- **Constraint `CHECK` fica com um cast cosmético.** O Postgres preserva as
  checagens de não-negatividade ao mudar o tipo, mas reescreve a expressão como
  `(amount)::double precision >= (0)::double precision` nas clínicas migradas,
  enquanto uma clínica nova nasce com `amount >= 0::numeric`. **O comportamento é
  idêntico** (testado: inserir `-0.01` continua sendo rejeitado) e nenhum valor
  de `NUMERIC(12,2)` muda de sinal ao virar `double`. É divergência de DDL, não
  de dado; se incomodar, dá para normalizar depois com `DROP CONSTRAINT` +
  `ADD CONSTRAINT` fora da janela de deploy.

- **`docs/AUDIT-DATA-MODEL.md` continua valendo para o resto:** datas em `TEXT`,
  flags em `INTEGER` e JSON em `TEXT` não foram tocados aqui.

---

## 8. `platformSchema.sql` — nada a fazer

O schema de controle da plataforma **já está correto** e não entra nesta
migração:

| Coluna                              | Tipo atual      | Situação                                                  |
| ----------------------------------- | --------------- | --------------------------------------------------------- |
| `platform.tenant_invoices.amount`   | `NUMERIC(12,2)` | Já nasceu assim (commit `16dec52`). Nada a converter.       |
| `platform.subscription_plans.price_cents` | `INTEGER` | Centavos inteiros — representação exata, não vira decimal. |

Não há nenhuma coluna `DOUBLE PRECISION` em `platformSchema.sql`. O bloco abaixo
é apenas **defensivo/idempotente**, para o caso de algum banco ter divergido por
alteração manual. Ele pode ser aplicado a qualquer momento; num banco íntegro não
faz nada:

```sql
-- Roda no banco da plataforma, sem search_path especial (o schema é explícito).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'platform'
       AND table_name   = 'tenant_invoices'
       AND column_name  = 'amount'
       AND data_type    = 'double precision'
  ) THEN
    RAISE NOTICE 'platform.tenant_invoices.amount estava em double precision; convertendo.';
    ALTER TABLE platform.tenant_invoices
      ALTER COLUMN amount TYPE NUMERIC(12,2) USING amount::NUMERIC(12,2);
  END IF;
END
$$;

-- Conferência: deve devolver zero linhas.
SELECT table_name, column_name, data_type
  FROM information_schema.columns
 WHERE table_schema = 'platform'
   AND data_type IN ('double precision', 'real');
```

> Atenção ao aplicar: `platformFinance.js` trata dinheiro como **string decimal**
> de ponta a ponta e depende de `NUMERIC` continuar chegando como string
> (`database/connection.js` não registra type parser nenhum, de propósito). Não
> adicione um `pg.types.setTypeParser(1700, …)` global "para uniformizar" — é
> exatamente o que essa migração evitou fazer.
