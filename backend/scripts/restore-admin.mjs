import { pool, query } from "../src/database/connection.js";

const ADMIN_ROLE = "admin";

function arg(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((item) => item.startsWith(prefix));
  if (inline) return inline.slice(prefix.length).trim();
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? String(process.argv[index + 1] || "").trim() : "";
}

const email = arg("email").toLowerCase();
const tenantSlug = arg("tenant").toLowerCase();

if (!email) {
  console.error("Uso: npm run restore-admin -- --tenant=slug-da-clinica --email=email-da-conta");
  process.exit(1);
}

const tenantsResult = await query(
  tenantSlug
    ? "SELECT id, slug, name FROM platform.tenants WHERE slug = $1"
    : "SELECT id, slug, name FROM platform.tenants ORDER BY id",
  tenantSlug ? [tenantSlug] : []
);

if (tenantSlug && tenantsResult.rows.length === 0) {
  await pool.end();
  console.error(`Tenant '${tenantSlug}' nao encontrado. Nenhum usuario foi criado.`);
  process.exit(3);
}

async function tableExists(client, tableName) {
  const result = await client.query("SELECT to_regclass($1) AS name", [tableName]);
  return Boolean(result.rows[0]?.name);
}

async function columnExists(client, tableName, columnName) {
  const result = await client.query(
    `SELECT 1
       FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = $1
        AND column_name = $2
      LIMIT 1`,
    [tableName, columnName]
  );
  return result.rows.length > 0;
}

async function invalidateStoredSessions(client, userId, userEmail) {
  const sessionTables = ["user_sessions", "sessions", "auth_sessions", "refresh_tokens"];
  let removed = 0;

  for (const table of sessionTables) {
    if (!(await tableExists(client, table))) continue;
    const hasUserId = await columnExists(client, table, "user_id");
    const hasUserEmail = await columnExists(client, table, "user_email");
    if (!hasUserId && !hasUserEmail) continue;

    const condition = hasUserId ? "user_id = $1" : "LOWER(user_email) = $2";
    const result = await client.query(`DELETE FROM ${table} WHERE ${condition}`, [userId, userEmail]);
    removed += Number(result.rowCount || 0);
  }

  return removed;
}

let restored = null;

for (const tenant of tenantsResult.rows) {
  const schema = `tenant_${tenant.id}`;
  const client = await pool.connect();

  try {
    await client.query(`SET search_path TO "${schema}", public`);
    const found = await client.query(
      "SELECT id, name, email, role FROM users WHERE LOWER(email) = $1 LIMIT 1",
      [email]
    );
    const user = found.rows[0];
    if (!user) continue;

    await client.query("BEGIN");

    const setClauses = ["role = $1"];
    if (await columnExists(client, "users", "is_active")) setClauses.push("is_active = 1");
    if (await columnExists(client, "users", "active")) setClauses.push("active = 1");
    if (await columnExists(client, "users", "status")) setClauses.push("status = 'ativo'");
    if (await columnExists(client, "users", "updated_at")) setClauses.push("updated_at = CURRENT_TIMESTAMP");

    const updated = await client.query(
      `UPDATE users SET ${setClauses.join(", ")} WHERE id = $2 RETURNING id, name, email, role`,
      [ADMIN_ROLE, user.id]
    );
    const removedSessions = await invalidateStoredSessions(client, user.id, email);

    await client.query("COMMIT");
    restored = { ...updated.rows[0], tenant: tenant.slug, tenantName: tenant.name, removedSessions };
    break;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* no open transaction */ }
    throw error;
  } finally {
    try {
      await client.query("SET search_path TO public");
      client.release();
    } catch {
      client.release(true);
    }
  }
}

await pool.end();

if (!restored) {
  console.error(`Nenhuma conta encontrada para ${email}${tenantSlug ? ` no tenant ${tenantSlug}` : ""}. Nenhum usuario foi criado.`);
  process.exit(2);
}

console.log("Acesso administrativo restaurado com sucesso.");
console.log(`Usuaria: ${restored.name} <${restored.email}>`);
console.log(`Clinica: ${restored.tenantName} (${restored.tenant})`);
console.log(`Funcao aplicada: ${ADMIN_ROLE} / Administradora Geral`);
console.log(`Sessoes persistidas invalidadas: ${restored.removedSessions}`);
