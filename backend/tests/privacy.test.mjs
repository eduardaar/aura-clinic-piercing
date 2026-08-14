// Regressões dos controles LGPD implementados no tenant: auditoria de acesso,
// solicitações de titulares e retenção deliberadamente desativada por padrão.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createTenant, deleteTenant, loginTenant, platformLogin, req } from "./helpers.mjs";

const ctx = { platformToken: null, tenant: null, adminToken: null, receptionToken: null, clientId: null };

before(async () => {
  ctx.platformToken = await platformLogin();
  ctx.tenant = await createTenant("qaprivacy");
  const admin = await loginTenant(ctx.tenant.slug, ctx.tenant.adminEmail, ctx.tenant.adminPassword);
  ctx.adminToken = admin.token;
  const createdUser = await req("/users", {
    method: "POST", token: ctx.adminToken,
    body: { name: "Recepção Privacy", email: `reception@${ctx.tenant.slug}.test`, password: "SenhaForte123", role: "reception" }
  });
  assert.equal(createdUser.status, 201, JSON.stringify(createdUser.json));
  ctx.receptionToken = (await loginTenant(ctx.tenant.slug, `reception@${ctx.tenant.slug}.test`, "SenhaForte123")).token;
  const client = await req("/clients", {
    method: "POST", token: ctx.adminToken,
    body: { full_name: "Titular LGPD", whatsapp: "11999990000", email: "titular@example.test", cpf: "12345678900" }
  });
  assert.equal(client.status, 201, JSON.stringify(client.json));
  ctx.clientId = client.json.id;
});

after(async () => {
  if (ctx.platformToken && ctx.tenant?.tenant?.id) {
    await deleteTenant(ctx.platformToken, ctx.tenant.tenant.id, ctx.tenant.slug);
  }
});

test("leitura de prontuário do cliente deixa trilha sem conteúdo clínico", async () => {
  const read = await req(`/clients/${ctx.clientId}`, { token: ctx.adminToken });
  assert.equal(read.status, 200, JSON.stringify(read.json));

  const audit = await req(`/privacy/audit?client_id=${ctx.clientId}`, { token: ctx.adminToken });
  assert.equal(audit.status, 200, JSON.stringify(audit.json));
  const entry = audit.json.items.find((item) => item.action === "clinical_record_read" && Number(item.client_id) === ctx.clientId);
  assert.ok(entry, JSON.stringify(audit.json));
  assert.equal(entry.detail?.cpf, undefined, "auditoria não pode copiar dados pessoais do cliente");
});

test("gestão LGPD é exclusiva de admin", async () => {
  const response = await req("/privacy/audit", { token: ctx.receptionToken });
  assert.equal(response.status, 403, JSON.stringify(response.json));
});

test("solicitação do titular exige identidade validada antes da exportação", async () => {
  const created = await req("/privacy/data-subject-requests", {
    method: "POST", token: ctx.adminToken,
    body: { client_id: ctx.clientId, request_type: "access", notes: "Pedido recebido pelo canal oficial." }
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.ok(created.json.request_code);

  const blocked = await req(`/privacy/data-subject-requests/${created.json.id}/export`, { token: ctx.adminToken });
  assert.equal(blocked.status, 409, JSON.stringify(blocked.json));

  const verified = await req(`/privacy/data-subject-requests/${created.json.id}`, {
    method: "PATCH", token: ctx.adminToken, body: { status: "identity_verified" }
  });
  assert.equal(verified.status, 200, JSON.stringify(verified.json));

  const exported = await req(`/privacy/data-subject-requests/${created.json.id}/export`, { token: ctx.adminToken });
  assert.equal(exported.status, 200, JSON.stringify(exported.json));
  assert.equal(exported.json.client.id, ctx.clientId);
  assert.equal(exported.json.private_files.included, false);
});

test("retenção de logs começa desativada e exige confirmação explícita", async () => {
  const policies = await req("/privacy/retention-policies", { token: ctx.adminToken });
  assert.equal(policies.status, 200, JSON.stringify(policies.json));
  const errorPolicy = policies.json.items.find((item) => item.category === "error_logs");
  assert.equal(Number(errorPolicy.enabled), 0);

  const preview = await req("/privacy/retention/error_logs/preview", { method: "POST", token: ctx.adminToken });
  assert.equal(preview.status, 200, JSON.stringify(preview.json));
  assert.equal(preview.json.executable, false);

  const run = await req("/privacy/retention/error_logs/run", {
    method: "POST", token: ctx.adminToken, body: { confirmation: "CONFIRMAR RETENCAO" }
  });
  assert.equal(run.status, 409, JSON.stringify(run.json));
});
