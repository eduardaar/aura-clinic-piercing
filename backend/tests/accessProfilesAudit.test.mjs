import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { req, createTenant, loginTenant, platformLogin, deleteTenant } from "./helpers.mjs";

const ctx = { platformToken: null, tenant: null, adminToken: null, userToken: null, userId: null, profileId: null };
const password = "SenhaForte123";

before(async () => {
  ctx.platformToken = await platformLogin();
  ctx.tenant = await createTenant("qa-access-audit");
  const admin = await loginTenant(ctx.tenant.slug, ctx.tenant.adminEmail, ctx.tenant.adminPassword);
  ctx.adminToken = admin.token;
});

after(async () => {
  if (ctx.platformToken && ctx.tenant?.tenant?.id) {
    await deleteTenant(ctx.platformToken, ctx.tenant.tenant.id, ctx.tenant.slug);
  }
});

test("catálogo de permissões possui metadados legíveis", async () => {
  const response = await req("/permissions", { token: ctx.adminToken });
  assert.equal(response.status, 200, JSON.stringify(response.json));
  assert.ok(response.json.catalog.length > 0);
  assert.ok(response.json.catalog.every((item) => item.key && item.module_label && item.label));
});

test("perfil reutilizável define a base exata de acesso do usuário", async () => {
  const profile = await req("/access-profiles", {
    token: ctx.adminToken,
    method: "POST",
    body: {
      name: "Consulta de clientes",
      description: "Acesso restrito para validação",
      base_role: "reception",
      permissions: ["clients.view"]
    }
  });
  assert.equal(profile.status, 201, JSON.stringify(profile.json));
  ctx.profileId = profile.json.id;

  const email = `consulta@${ctx.tenant.slug}.test`;
  const user = await req("/users", {
    token: ctx.adminToken,
    method: "POST",
    body: { name: "Consulta QA", email, password, role: "reception", access_profile_id: ctx.profileId }
  });
  assert.equal(user.status, 201, JSON.stringify(user.json));
  assert.equal(user.json.access_profile_id, ctx.profileId);
  ctx.userId = user.json.id;
  ctx.userToken = (await loginTenant(ctx.tenant.slug, email, password)).token;

  const clients = await req("/clients", { token: ctx.userToken });
  assert.equal(clients.status, 200, JSON.stringify(clients.json));
  const appointments = await req("/appointments", { token: ctx.userToken });
  assert.equal(appointments.status, 403, JSON.stringify(appointments.json));
});

test("exceção individual expande o perfil e fica auditada", async () => {
  const grant = await req(`/users/${ctx.userId}/permissions`, {
    token: ctx.adminToken,
    method: "PUT",
    body: { reason: "Necessidade operacional QA", overrides: [{ permission: "appointments.view", allowed: true }] }
  });
  assert.equal(grant.status, 200, JSON.stringify(grant.json));
  const appointments = await req("/appointments", { token: ctx.userToken });
  assert.equal(appointments.status, 200, JSON.stringify(appointments.json));

  const audit = await req("/audit-events?limit=20&module=users", { token: ctx.adminToken });
  assert.equal(audit.status, 200, JSON.stringify(audit.json));
  assert.ok(audit.json.items.some((item) => item.action === "create" && item.entity_type === "access_profile"));
  assert.ok(audit.json.items.some((item) => item.action === "create" && item.entity_type === "user"));
  assert.ok(audit.json.items.some((item) => item.action === "replace_permissions" && item.entity_id === String(ctx.userId)));
});

test("perfil em uso não pode ser excluído", async () => {
  const response = await req(`/access-profiles/${ctx.profileId}`, {
    token: ctx.adminToken,
    method: "DELETE",
    body: { reason: "Validação QA" }
  });
  assert.equal(response.status, 409, JSON.stringify(response.json));
});
