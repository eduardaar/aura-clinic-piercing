import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createTenant, loginTenant, req } from "./helpers.mjs";
import { withTenantSchema } from "../src/db/tenantSession.js";
import { deprovisionTenant } from "../src/services/tenants.js";
import { normalizeEntry } from "../src/services/financeLedger.js";

const ctx = {};
const api = (path, options = {}) => req(path, { tenant: ctx.slug, token: ctx.token, ...options });
before(async () => {
  Object.assign(ctx, await createTenant("qa-edit-fields"));
  ctx.token = (await loginTenant(ctx.slug, ctx.adminEmail, ctx.adminPassword)).token;
  assert.equal((await api("/subscription", { method: "PATCH", body: { plan_code: "studio" } })).status, 200);
  const professional = await api("/professionals", { method: "POST", body: { name: "Profissional edição" } });
  assert.equal(professional.status, 201);
  ctx.professional = professional.json.id;
});
after(async () => { if (ctx.tenant?.id) await deprovisionTenant(ctx.tenant.id); });

test("bloqueio permite limpar motivo e observações sem restaurar o cadastro", async () => {
  const created = await api("/schedule-blocks", { method: "POST", body: {
    professional_id: ctx.professional, start_datetime: "2026-11-03T14:00", end_datetime: "2026-11-03T15:00",
    reason: "Ausência", notes: "Texto salvo", duration_minutes: 30, buffer_minutes: 0
  } });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const cleared = await api(`/schedule-blocks/${created.json.id}`, { method: "PATCH", body: { reason: "", notes: "" } });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.json));
  assert.equal(cleared.json.reason, "");
  assert.equal(cleared.json.notes, "");
  assert.equal(cleared.json.professional_id, ctx.professional);
  assert.equal(cleared.json.duration_minutes, 30);
  assert.equal(cleared.json.buffer_minutes, 0);
  const clearedNumbers = await api(`/schedule-blocks/${created.json.id}`, { method: "PATCH", body: { duration_minutes: "", buffer_minutes: "" } });
  assert.equal(clearedNumbers.status, 200);
  assert.equal(clearedNumbers.json.duration_minutes, null);
  assert.equal(clearedNumbers.json.buffer_minutes, null);
});

test("lista de espera distingue limpar datas/vínculos de omitir campos", async () => {
  const created = await api("/agenda/waitlist", { method: "POST", body: {
    client_name: "Cliente espera", professional_id: ctx.professional,
    preferred_date_from: "2026-11-01", preferred_date_to: "2026-11-15", notes: "Texto salvo"
  } });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const omitted = await api(`/agenda/waitlist/${created.json.id}`, { method: "PATCH", body: { contact: "11999990000" } });
  assert.equal(omitted.status, 200);
  assert.equal(omitted.json.preferred_date_from.slice(0, 10), "2026-11-01");
  const cleared = await api(`/agenda/waitlist/${created.json.id}`, { method: "PATCH", body: {
    professional_id: null, preferred_date_from: "", preferred_date_to: "", notes: ""
  } });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.json));
  assert.equal(cleared.json.professional_id, null);
  assert.equal(cleared.json.preferred_date_from, null);
  assert.equal(cleared.json.preferred_date_to, null);
  assert.equal(cleared.json.notes, "");
});

test("pós-atendimento permite apagar mensagem e observações já salvas", async () => {
  const service = await api("/services", { method: "POST", body: { name: "Serviço edição", price: 100, duration_minutes: 30, postcare_enabled: true, postcare_days: [7] } });
  assert.equal(service.status, 201);
  const appointment = await api("/appointments", { method: "POST", body: {
    full_name: "Cliente edição", whatsapp: "11985550100", professional_id: ctx.professional, service_id: service.json.id,
    procedure: "Serviço edição", piercing_region: "Orelha", appointment_date: "2026-11-02", appointment_time: "10:00"
  } });
  assert.equal(appointment.status, 201, JSON.stringify(appointment.json));
  const complete = await api(`/appointments/${appointment.json.id}/complete`, { method: "POST", body: { payments: [{ amount: 100, method: "Pix", status: "pago" }] } });
  assert.equal(complete.status, 200, JSON.stringify(complete.json));
  const followup = await withTenantSchema(ctx.tenant.id, (db) => db.get("SELECT id FROM post_care_followups WHERE appointment_id=?", [appointment.json.id]));
  assert.ok(followup);
  const saved = await api(`/post-care/${followup.id}`, { method: "PATCH", body: { care_message: "Mensagem antiga", client_notes: "Observação antiga" } });
  assert.equal(saved.status, 200);
  const omitted = await api(`/post-care/${followup.id}`, { method: "PATCH", body: { status: "enviado" } });
  assert.equal(omitted.status, 200);
  assert.equal(omitted.json.client_notes, "Observação antiga");
  const cleared = await api(`/post-care/${followup.id}`, { method: "PATCH", body: { care_message: "", client_notes: "" } });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.json));
  assert.equal(cleared.json.care_message, "");
  assert.equal(cleared.json.client_notes, "");
});

test("lançamento preserva campos omitidos e remove os opcionais enviados vazios/null", () => {
  const current = { entry_type: "payable", description: "Conta", amount: 100, due_date: "2026-11-01", cost_center_id: 7, supplier_id: 8, recurrence_end_date: "2027-01-01", installment_number: 2, installment_count: 3 };
  const preserved = normalizeEntry({ notes: "" }, current);
  assert.equal(preserved.cost_center_id, 7);
  assert.equal(preserved.supplier_id, 8);
  assert.equal(preserved.recurrence_end_date, "2027-01-01");
  const cleared = normalizeEntry({ cost_center_id: "", supplier_id: null, recurrence_end_date: "", installment_number: "", installment_count: null }, current);
  for (const field of ["cost_center_id", "supplier_id", "recurrence_end_date", "installment_number", "installment_count"]) assert.equal(cleared[field], null);
});
