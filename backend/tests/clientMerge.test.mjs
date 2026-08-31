import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createTenant, deleteTenant, loginTenant, platformLogin, req } from "./helpers.mjs";

const ctx = {};
const api = (path, options = {}) => req(path, { token: ctx.token, tenant: ctx.tenant?.slug, ...options });

before(async () => {
  ctx.platformToken = await platformLogin();
  ctx.tenant = await createTenant("qa-client-merge");
  ctx.token = (await loginTenant(ctx.tenant.slug, ctx.tenant.adminEmail, ctx.tenant.adminPassword)).token;
});

after(async () => {
  if (ctx.tenant?.tenant?.id) await deleteTenant(ctx.platformToken, ctx.tenant.tenant.id, ctx.tenant.slug);
});

test("mescla cadastro duplicado, move histórico e torna origem terminal", async () => {
  const target = await api("/clients", { method: "POST", body: { full_name: "Cliente Correto", whatsapp: "11911110001", email: "destino@aura.test", tags: ["vip"] } });
  const source = await api("/clients", { method: "POST", body: { full_name: "Cliente Duplicado", whatsapp: "11911110002", phone: "1133334444", tags: ["retorno"], operational_consent: true } });
  assert.equal(target.status, 201, JSON.stringify(target.json));
  assert.equal(source.status, 201, JSON.stringify(source.json));
  const professional = await api("/professionals", { method: "POST", body: { name: "Piercer Merge QA", specialty: "Piercing" } });
  const appointment = await api("/appointments", { method: "POST", body: {
    client_id: source.json.id, full_name: source.json.full_name, whatsapp: source.json.whatsapp,
    professional_id: professional.json.id, procedure: "Perfuração QA", piercing_region: "Orelha",
    appointment_date: "2026-09-10", appointment_time: "10:00", deposit_value: 0,
  } });
  assert.equal(appointment.status, 201, JSON.stringify(appointment.json));

  const merged = await api(`/clients/${source.json.id}/merge`, { method: "POST", body: {
    target_client_id: target.json.id, confirmation: "MESCLAR CLIENTES", reason: "Cadastro duplicado confirmado",
  } });
  assert.equal(merged.status, 200, JSON.stringify(merged.json));
  assert.equal(merged.json.target_id, target.json.id);
  assert.ok(merged.json.moved_records.appointments >= 1);

  const profile = await api(`/clients/${target.json.id}`);
  assert.equal(profile.status, 200, JSON.stringify(profile.json));
  assert.equal(profile.json.email, "destino@aura.test", "dado existente no destino é preservado");
  assert.equal(profile.json.phone, "1133334444", "lacuna do destino é complementada");
  assert.deepEqual(new Set(profile.json.tags), new Set(["vip", "retorno"]));
  assert.equal(profile.json.operational_consent, true);
  assert.ok(profile.json.history.some((item) => item.id === appointment.json.id));

  assert.equal((await api(`/clients/${source.json.id}`)).status, 404);
  const repeated = await api(`/clients/${source.json.id}/merge`, { method: "POST", body: {
    target_client_id: target.json.id, confirmation: "MESCLAR CLIENTES", reason: "Tentativa repetida",
  } });
  assert.equal(repeated.status, 409);
  assert.equal(repeated.json.code, "source_already_merged");
});

test("recusa auto-mesclagem antes de qualquer escrita", async () => {
  const client = await api("/clients", { method: "POST", body: { full_name: "Cliente Auto Merge", whatsapp: "11911110003" } });
  const response = await api(`/clients/${client.json.id}/merge`, { method: "POST", body: {
    target_client_id: client.json.id, confirmation: "MESCLAR CLIENTES", reason: "Não pode acontecer",
  } });
  assert.equal(response.status, 400);
});
