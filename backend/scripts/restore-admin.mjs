import { pool, query } from "../src/database/connection.js";

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
  console.error("Uso: npm run restore-admin -- --email=email-da-conta [--tenant=slug-da-clinica]");
  process.exit(1);
}

const tenantsResult = await query(
  tenantSlug
    ? "SELECT id, slug, name FROM platform.tenants WHERE slug = $1"
    : "SELECT id, slug, name FROM platform.tenants ORDER BY id",
  tenantSlug ? [tenantSlug] : []
);

let restored = null;
for (const tenant of tenantsResult.rows) {
  const schema = `tenant_${tenant.id}`;
  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO "${schema}"`);
    const found = await client.query("SELECT id, name, email, role FROM users WHERE LOWER(email) = $1 LIMIT 1", [email]);
    const user = found.rows[0];
    if (!user) continue;
    await client.query("UPDATE users SET role = 'admin' WHERE id = $1", [user.id]);
    restored = { ...user, role: "admin", tenant: tenant.slug, tenantName: tenant.name };
    break;
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
  console.error(`Nenhuma conta encontrada para ${email}${tenantSlug ? ` no tenant ${tenantSlug}` : ""}. Nenhum usuário foi criado.`);
  process.exit(2);
}

console.log(`Acesso administrativo restaurado com sucesso.`);
console.log(`Usuária: ${restored.name} <${restored.email}>`);
console.log(`Clínica: ${restored.tenantName} (${restored.tenant})`);
console.log(`Função aplicada: admin / Administrador Geral`);
