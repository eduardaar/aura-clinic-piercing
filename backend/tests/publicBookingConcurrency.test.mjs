import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createTenant, loginTenant, req } from "./helpers.mjs";
import { deprovisionTenant } from "../src/services/tenants.js";
import { withTenantSchema } from "../src/db/tenantSession.js";

const ctx = {};
before(async () => {
  Object.assign(ctx, await createTenant("qa-booking-race"));
  ctx.token = (await loginTenant(ctx.slug, ctx.adminEmail, ctx.adminPassword)).token;
  const api = (path, body) => req(path, { tenant: ctx.slug, token: ctx.token, method: "POST", body });
  const service = await api("/services", { name: "Avaliação QA", duration_minutes: 30, price: 30, deposit_value: 0, active_online_booking: true });
  assert.equal(service.status, 201);
  ctx.service = service.json.id;
  const professional = await api("/professionals", { name: "Profissional QA", service_ids: [ctx.service] });
  assert.equal(professional.status, 201);
  ctx.professional = professional.json.id;
  assert.equal((await api("/availability/generate-weekly", { professional_id: ctx.professional, weekdays: [0, 1, 2, 3, 4, 5, 6], start_time: "09:00", end_time: "18:00", buffer_minutes: 0 })).status, 201);
});
after(async () => { if (ctx.tenant?.id) await deprovisionTenant(ctx.tenant.id); });

const book = (date, key, phone) => req("/booking/requests", { tenant: ctx.slug, method: "POST", body: {
  service_id: ctx.service, professional_id: ctx.professional, appointment_date: date, appointment_time: "10:00",
  full_name: "Cliente QA concorrência", whatsapp: phone, idempotency_key: key
} });

test("duas clientes disputando o mesmo horário geram só um agendamento", async () => {
  const date = "2030-01-10";
  const responses = await Promise.all([book(date, "race-a", "11988880001"), book(date, "race-b", "11988880002")]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409], JSON.stringify(responses.map(r => ({ status: r.status, error: r.json.error }))));
  assert.equal(responses.find((r) => r.status === 409).json.code, "booking_slot_unavailable");
  await withTenantSchema(ctx.tenant.id, async (db) => {
    assert.equal(Number((await db.get("SELECT count(*) AS count FROM appointments WHERE appointment_date=?", [date])).count), 1);
  });
});

test("reenvio simultâneo da mesma solicitação reutiliza o agendamento sem erro 500", async () => {
  const date = "2030-01-11";
  const responses = await Promise.all([book(date, "same-request", "11988880003"), book(date, "same-request", "11988880003")]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 201]);
  assert.equal(responses[0].json.id, responses[1].json.id);
  await withTenantSchema(ctx.tenant.id, async (db) => {
    assert.equal(Number((await db.get("SELECT count(*) AS count FROM appointments WHERE appointment_date=?", [date])).count), 1);
    assert.equal(Number((await db.get("SELECT count(*) AS count FROM clients WHERE whatsapp=?", ["11988880003"])).count), 1);
  });
});
