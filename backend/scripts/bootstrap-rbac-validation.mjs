import bcrypt from "bcryptjs";
import { pool } from "../src/database/connection.js";

const tenantId = process.argv.find((value) => value.startsWith("--tenant="))?.split("=")[1];
const password = process.env.RBAC_VALIDATION_PASSWORD;
if (tenantId !== "2455" || !password || password.length < 12) {
  throw new Error("Bootstrap recusado: use --tenant=2455 e RBAC_VALIDATION_PASSWORD com pelo menos 12 caracteres.");
}

const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("SET LOCAL search_path TO tenant_2455");
  const passwordHash = await bcrypt.hash(password, 10);
  const result = await client.query(`
    INSERT INTO users (name, email, password_hash, role, status)
    VALUES ('Admin RBAC Local', 'admin-rbac@tenant2455.test', $1, 'admin', 'active')
    ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash, role='admin', status='active'
    RETURNING id, email, role, status
  `, [passwordHash]);
  for (const role of ["piercer", "reception", "finance"]) {
    await client.query(`
      INSERT INTO users (name, email, password_hash, role, status)
      VALUES ($1, $2, $3, $4, 'active')
      ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash, role=EXCLUDED.role, status='active'
    `, [`Validação ${role}`, `${role}-rbac@tenant2455.test`, passwordHash, role]);
  }
  const users = (await client.query("SELECT id, email, role, status, password_hash FROM users ORDER BY id")).rows;
  const passwordChecks = [];
  for (const user of users) {
    passwordChecks.push({
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      passwordMatches: await bcrypt.compare(password, user.password_hash)
    });
  }
  await client.query("COMMIT");
  console.log(JSON.stringify({ admin: result.rows[0], passwordChecks }));
} catch (error) {
  try { await client.query("ROLLBACK"); } catch {}
  throw error;
} finally {
  client.release();
  await pool.end();
}
