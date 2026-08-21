-- Dá ao schema Postgres de cada clínica um nome legível ("tenant_aura_clinic"
-- em vez de "tenant_2"): dá pra saber de quem é o schema só olhando o nome,
-- sem consultar platform.tenants.
--
-- O nome é calculado UMA VEZ aqui (e no provisionamento) e gravado em
-- platform.tenants.schema_name — nunca recalculado depois. O slug hoje não tem
-- rota de edição, mas se um dia ganhar uma, o schema não pode sair andando
-- atrás dele (mesmo motivo já documentado em services/storage/keys.js para as
-- chaves do storage usarem o id, não o slug).
ALTER TABLE platform.tenants ADD COLUMN IF NOT EXISTS schema_name TEXT;

DO $$
DECLARE
  tenant_record RECORD;
  computed_name TEXT;
  legacy_schema TEXT;
BEGIN
  FOR tenant_record IN
    SELECT id, slug FROM platform.tenants WHERE schema_name IS NULL ORDER BY id
  LOOP
    computed_name := 'tenant_' || replace(tenant_record.slug, '-', '_');
    legacy_schema := 'tenant_' || tenant_record.id;

    -- Só renomeia o schema físico se ele ainda estiver no formato antigo e o
    -- nome novo ainda não existir (idempotente: reaplicar não falha).
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = legacy_schema)
       AND NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = computed_name) THEN
      EXECUTE format('ALTER SCHEMA %I RENAME TO %I', legacy_schema, computed_name);
    END IF;

    -- O ledger de migrations do schema segue o nome novo, senão a próxima
    -- verificação de versão procuraria por um target_schema que não existe mais.
    UPDATE platform.schema_migrations
       SET target_schema = computed_name
     WHERE scope = 'tenant' AND target_schema = legacy_schema;

    UPDATE platform.tenants SET schema_name = computed_name WHERE id = tenant_record.id;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_tenants_schema_name ON platform.tenants (schema_name);
