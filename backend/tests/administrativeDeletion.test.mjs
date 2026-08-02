import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createTenant, deleteTenant, loginTenant, platformLogin, req } from "./helpers.mjs";

const ctx = {};
const api = (path, options = {}) => req(path, { token: ctx.token, ...options });

before(async () => {
  ctx.platformToken = await platformLogin();
  ctx.tenant = await createTenant("qa-delete");
  ctx.token = (await loginTenant(ctx.tenant.slug, ctx.tenant.adminEmail, ctx.tenant.adminPassword)).token;
});

after(async () => {
  await deleteTenant(ctx.platformToken, ctx.tenant.tenant.id, ctx.tenant.slug);
});

async function client(name, whatsapp) {
  const response = await api("/clients", { method: "POST", body: { full_name: name, whatsapp } });
  assert.equal(response.status, 201, JSON.stringify(response.json));
  return response.json;
}

test("cliente sem histórico exige confirmação e é excluído em transação", async () => {
  const created = await client("Cliente descartável", "11911110000");
  const refused = await api(`/clients/${created.id}`, { method: "DELETE", body: { confirmation: "errado", reason: "Cadastro de teste" } });
  assert.equal(refused.status, 400);
  const removed = await api(`/clients/${created.id}`, { method: "DELETE", body: { confirmation: "EXCLUIR CLIENTE", reason: "Cadastro de teste" } });
  assert.equal(removed.status, 200, JSON.stringify(removed.json));
  assert.equal(removed.json.action, "hard_delete");
});

test("cliente com histórico é anonimizado e some da operação", async () => {
  const created = await client("Cliente com histórico", "11922220000");
  const professional = await api("/professionals", { method: "POST", body: { name: "Piercer QA", specialty: "Piercing" } });
  assert.equal(professional.status, 201, JSON.stringify(professional.json));
  const appointment = await api("/appointments", { method: "POST", body: { client_id: created.id, full_name: created.full_name, whatsapp: created.whatsapp, professional_id: professional.json.id, procedure: "Teste", piercing_region: "Orelha", appointment_date: "2026-08-20", appointment_time: "10:00", deposit_value: 0 } });
  assert.equal(appointment.status, 201, JSON.stringify(appointment.json));
  const impact = await api(`/clients/${created.id}/deletion-impact`);
  assert.equal(impact.status, 200);
  assert.equal(impact.json.action, "anonymize");
  const removed = await api(`/clients/${created.id}`, { method: "DELETE", body: { confirmation: "EXCLUIR CLIENTE", reason: "Solicitação de privacidade QA" } });
  assert.equal(removed.status, 200, JSON.stringify(removed.json));
  assert.equal(removed.json.action, "anonymize");
  const detail = await api(`/clients/${created.id}`);
  assert.equal(detail.status, 404);
});

test("agendamento de teste é apagado, mas vínculo financeiro bloqueia exclusão", async () => {
  const created = await client("Cliente agenda", "11933330000");
  const professional = await api("/professionals", { method: "POST", body: { name: "Piercer Agenda QA", specialty: "Piercing" } });
  const base = { client_id: created.id, full_name: created.full_name, whatsapp: created.whatsapp, professional_id: professional.json.id, procedure: "Teste", piercing_region: "Orelha", appointment_date: "2026-08-21" };
  const disposable = await api("/appointments", { method: "POST", body: { ...base, appointment_time: "10:00", deposit_value: 0 } });
  const removed = await api(`/appointments/${disposable.json.id}`, { method: "DELETE", body: { confirmation: "EXCLUIR AGENDAMENTO", reason: "Agendamento de teste" } });
  assert.equal(removed.status, 200, JSON.stringify(removed.json));
  const linked = await api("/appointments", { method: "POST", body: { ...base, appointment_time: "11:00", deposit_value: 10, deposit_payment_method: "Pix" } });
  assert.equal(linked.status, 201, JSON.stringify(linked.json));
  const blocked = await api(`/appointments/${linked.json.id}`, { method: "DELETE", body: { confirmation: "EXCLUIR AGENDAMENTO", reason: "Não deve apagar" } });
  assert.equal(blocked.status, 409, JSON.stringify(blocked.json));
  assert.ok(blocked.json.impact.payments > 0);
});
