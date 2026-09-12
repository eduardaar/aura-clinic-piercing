// Login não pode depender de maiúsculas no e-mail — e editar o acesso de
// alguém (nível, perfil, permissões) jamais pode derrubar o login dela.
//
// O caso real: a conta foi criada antes de o cadastro normalizar o e-mail e
// ficou gravada como "Erick@...". A pessoa entrava digitando exatamente isso
// (o navegador lembra). O admin editou as permissões dela; a edição gravou o
// e-mail em minúsculas; o login, que comparava a grafia exata, passou a
// responder "Credenciais inválidas".
//
// Rode (de backend/):
//   node tests/run-suite.mjs tests/loginEmailCase.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { query } from "../src/database/connection.js";
import { req, createTenant, loginTenant, platformLogin, deleteTenant } from "./helpers.mjs";

const PW = "SenhaForte123";
const ctx = { platformToken: null, tenant: null, adminToken: null, schema: null };

before(async () => {
  ctx.platformToken = await platformLogin();
  ctx.tenant = await createTenant("qa-email-case");
  const admin = await loginTenant(ctx.tenant.slug, ctx.tenant.adminEmail, ctx.tenant.adminPassword);
  ctx.adminToken = admin.token;
  const row = await query("SELECT schema_name FROM platform.tenants WHERE id = $1", [ctx.tenant.tenant.id]);
  ctx.schema = row.rows[0]?.schema_name;
  assert.ok(ctx.schema, "schema da clínica de teste");
});

after(async () => {
  if (ctx.platformToken && ctx.tenant?.tenant?.id) {
    await deleteTenant(ctx.platformToken, ctx.tenant.tenant.id, ctx.tenant.slug);
  }
});

async function login(email, password = PW) {
  return req("/login", { tenant: ctx.tenant.slug, method: "POST", body: { email, password } });
}

async function criarUsuario(nome, email, role = "reception") {
  const created = await req("/users", { token: ctx.adminToken, method: "POST", body: { name: nome, email, password: PW, role } });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  return created.json;
}

test("e-mail cadastrado com maiúsculas entra com qualquer grafia", async () => {
  const slug = ctx.tenant.slug;
  const user = await criarUsuario("Erick Teste", `Erick.Teste@${slug}.test`);
  assert.equal(user.email, `erick.teste@${slug}.test`, "o cadastro normaliza para minúsculas");
  for (const typed of [`erick.teste@${slug}.test`, `Erick.Teste@${slug}.test`, `ERICK.TESTE@${slug}.test`, ` Erick.Teste@${slug}.test `]) {
    const entrada = await login(typed);
    assert.equal(entrada.status, 200, `${JSON.stringify(typed)}: ${JSON.stringify(entrada.json)}`);
    assert.equal(entrada.json.user.id, user.id);
  }
});

test("conta antiga com maiúsculas continua entrando depois de o admin editar nível e permissões", async () => {
  const slug = ctx.tenant.slug;
  const legacyEmail = `Erick.Legado@${slug}.test`;
  const user = await criarUsuario("Erick Legado", legacyEmail.toLowerCase());
  // Simula a conta legada: gravada com a grafia original, antes da normalização.
  await query(`UPDATE "${ctx.schema}".users SET email = $1 WHERE id = $2`, [legacyEmail, user.id]);
  assert.equal((await login(legacyEmail)).status, 200, "grafia exata entra");
  assert.equal((await login(legacyEmail.toLowerCase())).status, 200, "grafia normalizada também entra");

  // O admin muda o nível e libera permissões — o fluxo que derrubava o login.
  const patched = await req(`/users/${user.id}`, { token: ctx.adminToken, method: "PATCH", body: { role: "piercer", reason: "Novas atribuições no estúdio" } });
  assert.equal(patched.status, 200, JSON.stringify(patched.json));
  assert.equal(patched.json.email, legacyEmail.toLowerCase(), "a edição normaliza o e-mail");
  const permissions = await req(`/users/${user.id}/permissions`, {
    token: ctx.adminToken, method: "PUT",
    body: { reason: "Liberar edição de itens do catálogo", overrides: [{ permission: "inventory.edit", allowed: true }] }
  });
  assert.equal(permissions.status, 200, JSON.stringify(permissions.json));

  // A pessoa entra com o e-mail que o navegador lembrou (grafia antiga) e com o novo.
  for (const typed of [legacyEmail, legacyEmail.toLowerCase()]) {
    const entrada = await login(typed);
    assert.equal(entrada.status, 200, `${typed}: ${JSON.stringify(entrada.json)}`);
    assert.equal(entrada.json.user.email, legacyEmail.toLowerCase());
    assert.equal(entrada.json.user.role, "piercer");
    // A lista resolvida vai no login: padrão do novo cargo + a exceção concedida.
    assert.ok(Array.isArray(entrada.json.user.permissions), "login devolve as permissões resolvidas");
    assert.ok(entrada.json.user.permissions.includes("inventory.edit"), "exceção concedida");
    assert.ok(entrada.json.user.permissions.includes("appointments.finalize"), "padrão do cargo piercer");
    assert.ok(!entrada.json.user.permissions.includes("finance.view"), "fora do cargo continua fora");
  }
  // Nada mais mudou na credencial: a senha errada segue recusada.
  assert.equal((await login(legacyEmail, "OutraSenhaErrada1")).status, 401);
});

test("auditoria registra quem alterou as permissões e o que mudou", async () => {
  const slug = ctx.tenant.slug;
  const user = await criarUsuario("Auditado", `auditado@${slug}.test`, "finance");
  const antes = [{ permission: "coupons.apply", allowed: true }];
  const troca = await req(`/users/${user.id}/permissions`, { token: ctx.adminToken, method: "PUT", body: { reason: "Cupons no caixa", overrides: antes } });
  assert.equal(troca.status, 200, JSON.stringify(troca.json));
  const trilha = await query(
    `SELECT actor_email, reason, before_data, after_data FROM "${ctx.schema}".audit_events
      WHERE module = 'users' AND action = 'replace_permissions' AND entity_id = $1 ORDER BY id DESC LIMIT 1`,
    [String(user.id)]
  );
  const evento = trilha.rows[0];
  assert.ok(evento, "evento de auditoria gravado");
  assert.equal(evento.actor_email, ctx.tenant.adminEmail);
  assert.equal(evento.reason, "Cupons no caixa");
  assert.deepEqual(evento.after_data?.permissions, antes);
});
