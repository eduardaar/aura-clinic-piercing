import crypto from "node:crypto";

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

export function structuralFingerprint(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function normalize(value, schema) {
  return value == null ? null : String(value)
    .replaceAll(`"${schema}".`, "")
    .replaceAll(`${schema}.`, "")
    .replace(/\s+/g, " ")
    .trim();
}

const expected = {
  "tenant:0001": {
    baseline: ["users"]
  },
  "platform:0001": {
    baseline: ["platform.tenants"]
  },
  "tenant:0002": {
    columns: [
      ["id", "uuid", false, null],
      ["type", "text", false, null],
      ["status", "text", false, "'queued'::text"],
      ["payload", "jsonb", false, "'{}'::jsonb"],
      ["request_hash", "text", false, null],
      ["result", "jsonb", true, null],
      ["idempotency_key", "text", true, null],
      ["requested_by", "integer", true, null],
      ["attempts", "integer", false, "0"],
      ["max_attempts", "integer", false, "3"],
      ["available_at", "timestamp with time zone", false, "now()"],
      ["locked_at", "timestamp with time zone", true, null],
      ["locked_by", "text", true, null],
      ["completed_at", "timestamp with time zone", true, null],
      ["last_error", "text", true, null],
      ["created_at", "timestamp with time zone", false, "now()"],
      ["updated_at", "timestamp with time zone", false, "now()"]
    ],
    constraints: [
      ["background_jobs_attempts_check", "CHECK ((attempts >= 0))"],
      ["background_jobs_max_attempts_check", "CHECK (((max_attempts >= 1) AND (max_attempts <= 10)))"],
      ["background_jobs_pkey", "PRIMARY KEY (id)"],
      ["background_jobs_requested_by_fkey", "FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE SET NULL"],
      ["background_jobs_status_check", "CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'completed'::text, 'failed'::text, 'cancelled'::text])))"],
      ["background_jobs_type_check", "CHECK ((type = ANY (ARRAY['report_export'::text, 'aura_jewelry_import'::text, 'asaas_reconcile'::text])))"]
    ],
    indexes: [
      ["background_jobs_pkey", true, null, ["id"]],
      ["ix_background_jobs_claim", false, "(status = 'queued'::text)", ["status", "available_at", "created_at"]],
      ["ix_background_jobs_recent", false, null, ["created_at DESC", "id DESC"]],
      ["ux_background_jobs_idempotency", true, "(idempotency_key IS NOT NULL)", ["type", "requested_by", "idempotency_key"]]
    ],
    functions: [], triggers: [], sequences: [], views: [], materializedViews: []
  },
  "tenant:0003": {
    alteredColumns: [
      ["administrative_audit_logs", "tenant_id", "integer", true, null],
      ["users", "status", "text", false, "'active'::text"]
    ],
    columns: [
      ["id", "integer", false, "nextval('user_permissions_id_seq'::regclass)"],
      ["user_id", "integer", false, null],
      ["permission", "text", false, null],
      ["allowed", "boolean", false, null],
      ["created_by", "integer", true, null],
      ["created_at", "timestamp with time zone", false, "now()"],
      ["updated_at", "timestamp with time zone", false, "now()"]
    ],
    constraints: [
      ["user_permissions_created_by_fkey", "FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL"],
      ["user_permissions_pkey", "PRIMARY KEY (id)"],
      ["user_permissions_user_id_fkey", "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE"],
      ["user_permissions_user_id_permission_key", "UNIQUE (user_id, permission)"]
    ],
    indexes: [
      ["idx_user_permissions_user", false, null, ["user_id"]],
      ["user_permissions_pkey", true, null, ["id"]],
      ["user_permissions_user_id_permission_key", true, null, ["user_id", "permission"]]
    ],
    functions: [], triggers: [], sequences: ["user_permissions_id_seq"], views: [], materializedViews: []
  }
};
expected["tenant:0004"] = expected["tenant:0002"];
expected["tenant:0005"] = {
  alteredColumns: [["jewelry_inventory", "category_id", "integer", true, null]],
  constraints: [["jewelry_inventory_category_id_fkey", "FOREIGN KEY (category_id) REFERENCES inventory_options(id) ON DELETE SET NULL"]],
  indexes: [["idx_jewelry_inventory_category_id", false, null, ["category_id"]]]
};

async function tableSignature(client, schema, table) {
  const columns = (await client.query(`
    SELECT a.attname AS name, pg_catalog.format_type(a.atttypid, a.atttypmod) AS type,
           NOT a.attnotnull AS nullable, pg_get_expr(d.adbin, d.adrelid) AS default
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
     WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
     ORDER BY a.attnum
  `, [schema, table])).rows.map((row) => [row.name, row.type, row.nullable, normalize(row.default, schema)]);
  const constraints = (await client.query(`
    SELECT conname AS name, pg_get_constraintdef(c.oid) AS definition
      FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace
     WHERE n.nspname=$1 AND r.relname=$2 AND c.contype <> 'n' ORDER BY conname
  `, [schema, table])).rows.map((row) => [row.name, normalize(row.definition, schema)]);
  const indexes = (await client.query(`
    SELECT i.relname AS name, x.indisunique AS unique, pg_get_expr(x.indpred, x.indrelid) AS predicate,
           ARRAY(SELECT pg_get_indexdef(x.indexrelid, k, true)
                        || CASE WHEN (x.indoption[k - 1] & 1) = 1 THEN ' DESC' ELSE '' END
                   FROM generate_series(1, x.indnkeyatts) k) AS keys
      FROM pg_index x JOIN pg_class t ON t.oid=x.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace
      JOIN pg_class i ON i.oid=x.indexrelid
     WHERE n.nspname=$1 AND t.relname=$2 ORDER BY i.relname
  `, [schema, table])).rows.map((row) => [row.name, row.unique, normalize(row.predicate, schema), row.keys.map((key) => normalize(key, schema))]);
  return { columns, constraints, indexes };
}

async function schemaExtras(client, schema, prefix) {
  const functions = (await client.query(`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.proname LIKE $2 ORDER BY p.proname`, [schema, `${prefix}%`])).rows.map((row) => row.proname);
  const triggers = (await client.query(`SELECT tg.tgname FROM pg_trigger tg JOIN pg_class c ON c.oid=tg.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname LIKE $2 AND NOT tg.tgisinternal ORDER BY tg.tgname`, [schema, `${prefix}%`])).rows.map((row) => row.tgname);
  const sequences = (await client.query(`SELECT sequencename FROM pg_sequences WHERE schemaname=$1 AND sequencename LIKE $2 ORDER BY sequencename`, [schema, `${prefix}%`])).rows.map((row) => row.sequencename);
  const views = (await client.query(`SELECT viewname FROM pg_views WHERE schemaname=$1 AND viewname LIKE $2 ORDER BY viewname`, [schema, `${prefix}%`])).rows.map((row) => row.viewname);
  const materializedViews = (await client.query(`SELECT matviewname FROM pg_matviews WHERE schemaname=$1 AND matviewname LIKE $2 ORDER BY matviewname`, [schema, `${prefix}%`])).rows.map((row) => row.matviewname);
  return { functions, triggers, sequences, views, materializedViews };
}

export async function inspectMigrationStructure(client, { scope, targetSchema, version }) {
  const key = `${scope}:${version}`;
  const wanted = expected[key];
  if (!wanted) throw new Error(`Fingerprint estrutural não definido para ${key}.`);
  let found;
  if (version === "0001") {
    const names = [];
    for (const item of wanted.baseline) {
      const qualified = item.includes(".") ? item : `${targetSchema}.${item}`;
      if ((await client.query("SELECT to_regclass($1) IS NOT NULL AS ok", [qualified])).rows[0].ok) names.push(item);
    }
    found = { baseline: names };
  } else if (version === "0005") {
    const table = await tableSignature(client, targetSchema, "jewelry_inventory");
    const categoryColumn = table.columns.filter(([name]) => name === "category_id");
    found = {
      alteredColumns: categoryColumn.map(([name, type, nullable, defaultValue]) => ["jewelry_inventory", name, type, nullable, defaultValue]),
      constraints: table.constraints.filter(([name]) => name === "jewelry_inventory_category_id_fkey"),
      indexes: table.indexes.filter(([name]) => name === "idx_jewelry_inventory_category_id")
    };
  } else {
    const table = version === "0002" || version === "0004" ? "background_jobs" : "user_permissions";
    found = {
      ...await tableSignature(client, targetSchema, table),
      ...await schemaExtras(client, targetSchema, table.replace(/s$/, ""))
    };
    if (version === "0003") {
      const alteredColumns = (await client.query(`
        SELECT table_name, column_name, data_type, is_nullable='YES' AS nullable, column_default
          FROM information_schema.columns
         WHERE table_schema=$1 AND ((table_name='users' AND column_name='status') OR (table_name='administrative_audit_logs' AND column_name='tenant_id'))
         ORDER BY table_name
      `, [targetSchema])).rows.map((row) => [row.table_name, row.column_name, row.data_type, row.nullable, normalize(row.column_default, targetSchema)]);
      found.alteredColumns = alteredColumns;
    }
  }
  const expectedCanonical = stable(wanted);
  const physicalCanonical = stable(found);
  return {
    expected: expectedCanonical,
    physical: physicalCanonical,
    expectedFingerprint: structuralFingerprint(expectedCanonical),
    physicalFingerprint: structuralFingerprint(physicalCanonical),
    equivalent: JSON.stringify(expectedCanonical) === JSON.stringify(physicalCanonical)
  };
}
