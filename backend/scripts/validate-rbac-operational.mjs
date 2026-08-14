import assert from "node:assert/strict";
import { pool } from "../src/database/connection.js";

const base = process.env.RBAC_VALIDATION_API;
const password = process.env.RBAC_VALIDATION_PASSWORD;
const tenant = "clinica-repetida-988020-2";
if (!base || !password) throw new Error("Defina RBAC_VALIDATION_API e RBAC_VALIDATION_PASSWORD.");

async function request(path, { method = "GET", token, selectedTenant = tenant, body } = {}) {
  const response = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      ...(selectedTenant ? { "X-Tenant": selectedTenant } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let json = null;
  try { json = await response.json(); } catch {}
  return { status: response.status, json };
}

async function login(email) {
  let result;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    result = await request("/login", { method: "POST", body: { email, password } });
    if (result.status === 200) return result.json.token;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(result.status, 200, `${email}: ${JSON.stringify(result.json)}`);
}

const adminToken = await login("admin-rbac@tenant2455.test");
const users = {};
for (const role of ["piercer", "reception", "finance"]) {
  const email = `${role}-rbac@tenant2455.test`;
  const result = await request("/users", {
    method: "POST", token: adminToken,
    body: { name: `Validação ${role}`, email, password, role }
  });
  if (result.status === 409) {
    const list = await request("/users", { token: adminToken });
    users[role] = list.json.find((user) => user.email === email);
    assert.ok(users[role], `POST /users retornou 409 sem usuário existente: ${JSON.stringify(result.json)}`);
  } else {
    assert.equal(result.status, 201, JSON.stringify(result.json));
    users[role] = result.json;
  }
  users[role].token = await login(email);
}

const finalizePath = "/appointments/999999/complete";
for (const role of ["piercer", "reception"]) {
  assert.equal((await request(`/users/${users[role].id}/permissions`, {
    method: "PUT", token: adminToken,
    body: { reason: "Preparar baseline da validação operacional", overrides: [] }
  })).status, 200);
}
assert.equal((await request(finalizePath, { method: "POST", token: users.piercer.token })).status, 404);
assert.equal((await request(finalizePath, { method: "POST", token: users.reception.token })).status, 403);

assert.equal((await request(`/users/${users.piercer.id}/permissions`, {
  method: "PUT", token: adminToken,
  body: { reason: "Validação operacional denied", overrides: [{ permission: "appointments.finalize", allowed: false }] }
})).status, 200);
assert.equal((await request(finalizePath, { method: "POST", token: users.piercer.token })).status, 403);

assert.equal((await request(`/users/${users.reception.id}/permissions`, {
  method: "PUT", token: adminToken,
  body: { reason: "Validação operacional granted", overrides: [{ permission: "appointments.finalize", allowed: true }] }
})).status, 200);
assert.equal((await request(finalizePath, { method: "POST", token: users.reception.token })).status, 404);

assert.equal((await request("/users", { token: adminToken })).status, 200);
assert.equal((await request(finalizePath, { method: "POST", token: adminToken })).status, 404);

assert.equal((await request(`/users/${users.reception.id}`, {
  method: "PATCH", token: adminToken, body: { status: "inactive" }
})).status, 200);
assert.equal((await request("/clients", { token: users.reception.token })).status, 401);
assert.equal((await request("/login", {
  method: "POST", body: { email: users.reception.email, password }
})).status, 403);

const client = await pool.connect();
let storedPermission;
let auditRows;
try {
  await client.query("BEGIN READ ONLY");
  await client.query("SET LOCAL search_path TO tenant_2455");
  storedPermission = (await client.query(
    "SELECT permission, allowed FROM user_permissions WHERE user_id=$1",
    [users.reception.id]
  )).rows;
  auditRows = (await client.query(`
    SELECT tenant_id, entity_type, entity_id, user_id, snapshot, created_at
      FROM administrative_audit_logs
     WHERE entity_id = $1 AND entity_type IN ('user', 'user_permissions')
     ORDER BY id
  `, [users.reception.id])).rows;
  await client.query("ROLLBACK");
} finally {
  client.release();
  await pool.end();
}
assert.deepEqual(storedPermission, [{ permission: "appointments.finalize", allowed: true }]);
assert.ok(auditRows.length >= 2);
for (const row of auditRows) {
  assert.equal(row.tenant_id, 2455);
  const serialized = JSON.stringify(row).toLowerCase();
  assert.doesNotMatch(serialized, /password|password_hash|token|secret/);
}

assert.equal((await request(`/users/${users.reception.id}`, {
  method: "PATCH", token: adminToken, body: { status: "active" }
})).status, 200);
users.reception.token = await login(users.reception.email);
assert.equal((await request(`/users/${users.reception.id}/permissions`, {
  method: "PUT", token: adminToken,
  body: { reason: "Remover concessão após validação", overrides: [] }
})).status, 200);
assert.equal((await request(finalizePath, { method: "POST", token: users.reception.token })).status, 403);

const crossTenantPaths = [
  "/appointments", "/clients", "/jewelry", "/inventory/counts", "/finance",
  "/sales-orders", "/users", `/users/${users.reception.id}/permissions`, "/digital-terms"
];
for (const path of crossTenantPaths) {
  const result = await request(path, {
    token: adminToken,
    selectedTenant: "studio-lua-piercing-123799"
  });
  assert.ok([403, 404].includes(result.status), `${path}: ${result.status} ${JSON.stringify(result.json)}`);
}

console.log(JSON.stringify({
  tenant,
  granted: "passed",
  denied: "passed",
  inactiveUser: "passed",
  adminWildcard: "passed",
  auditRows: auditRows.length,
  crossTenantDomains: crossTenantPaths.length
}));
