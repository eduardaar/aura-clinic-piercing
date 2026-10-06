import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createTenant, loginTenant, req } from "./helpers.mjs";
import { withTenantSchema } from "../src/db/tenantSession.js";
import { deprovisionTenant } from "../src/services/tenants.js";
import { appointmentDateTime, appointmentCountdown, upcomingAppointmentsAt } from "../src/services/appointmentClock.js";
import { createPaymentIntent, transitionPaymentIntent } from "../src/services/payments.js";

const ctx = {};
let slot = 0;
const api = (path, options = {}) => req(path, { tenant: ctx.slug, token: ctx.token, ...options });
const sql = (fn) => withTenantSchema(ctx.tenant.id, fn);
before(async () => {
  Object.assign(ctx, await createTenant("qa-trace"));
  ctx.token = (await loginTenant(ctx.slug, ctx.adminEmail, ctx.adminPassword)).token;
  assert.equal((await api("/subscription", { method: "PATCH", body: { plan_code: "studio" } })).status, 200);
  ctx.professional = (await api("/professionals", { method: "POST", body: { name: "Profissional Rastreável", specialty: "Piercing" } })).json.id;
  ctx.service = (await api("/services", { method: "POST", body: { name: "Procedimento Rastreável", price: 100, deposit_value: 25, duration_minutes: 30 } })).json.id;
});
after(async () => { if (ctx.tenant?.id) await deprovisionTenant(ctx.tenant.id); });
async function create(deposit, status = "pago") {
  slot++;
  const result = await api("/appointments", { method: "POST", body: {
    full_name: `Cliente sinal ${slot}`, whatsapp: `1198000${String(slot).padStart(4, "0")}`,
    professional_id: ctx.professional, service_id: ctx.service, procedure: "Procedimento Rastreável", piercing_region: "Orelha",
    appointment_date: new Date(Date.UTC(2026, 10, slot)).toISOString().slice(0, 10), appointment_time: "10:00",
    deposit_value: deposit, deposit_status: status, deposit_payment_method: "Pix", status: "confirmado"
  } });
  assert.equal(result.status, 201, JSON.stringify(result.json));
  return result.json;
}

test("relógio: fuso São Paulo, segundos, horários passados e estados encerrados", () => {
  const now = new Date("2026-10-06T15:00:00Z");
  const base = { appointment_date: "2026-10-06", appointment_time: "13:30:00", status: "confirmado" };
  assert.equal(appointmentDateTime(base).toISOString(), "2026-10-06T16:30:00.000Z");
  assert.equal(appointmentCountdown(base, now), "Em 1h30");
  assert.equal(appointmentDateTime({ ...base, appointment_time: "inválido" }), null);
  const records = ["cancelado", "atendido", "recusado", "remarcado", "nao_compareceu", "em_atendimento", "confirmado", "chegou"].map((status, id) => ({ ...base, id, status }));
  records.push({ ...base, id: 99, appointment_time: "11:59" });
  assert.deepEqual(upcomingAppointmentsAt(records, now).map((item) => item.status), ["confirmado", "chegou"]);
  assert.deepEqual(upcomingAppointmentsAt(records, new Date("2026-10-07T00:00:00Z")), []);
});

for (const deposit of [10, 25, 60]) test(`sinal real ${deposit}: criação, resumo, relatório e expectativa preservada`, async () => {
  const item = await create(deposit);
  assert.equal(Number(item.deposit_value), deposit);
  assert.equal(Number(item.deposit_received_value), deposit);
  assert.equal(Number(item.deposit_expected_value), 25);
  assert.equal(Number(item.remaining_value), 100 - deposit);
  const snapshot = await api(`/appointments/${item.id}/value-adjustments`);
  assert.equal(snapshot.status, 200, JSON.stringify(snapshot.json));
  assert.equal(snapshot.json.financial.depositPaid, deposit);
  assert.equal(snapshot.json.financial.depositExpected, 25);
  const report = await api(`/reports/appointments?from=${item.appointment_date}&to=${item.appointment_date}&client_id=${item.client_id}`);
  assert.equal(report.json.total_rows, 1);
  assert.equal(Number(report.json.rows[0].deposit_received_value), deposit);
  assert.equal(Number(report.json.rows[0].remaining_value), 100 - deposit);
});

test("sinal pendente não abate saldo; conferência auditada mantém pagamento e não duplica fechamento", async () => {
  const item = await create(25, "pendente");
  assert.equal(Number(item.remaining_value), 100);
  assert.equal(Number(item.deposit_received_value), 0);
  const initial = await sql((db) => db.get("SELECT id FROM payments WHERE appointment_id=?", [item.id]));
  for (const amount of [15, 45]) {
    const edited = await api(`/appointments/${item.id}`, { method: "PATCH", body: { deposit_value: amount, deposit_status: "pago", reason: "Conferência do comprovante" } });
    assert.equal(edited.status, 200, JSON.stringify(edited.json));
  }
  await sql(async (db) => {
    const payments = await db.all("SELECT * FROM payments WHERE appointment_id=?", [item.id]);
    assert.equal(payments.length, 1);
    assert.equal(payments[0].id, initial.id);
    assert.equal(Number(payments[0].amount), 45);
    const audits = await db.all("SELECT * FROM appointment_financial_audit WHERE appointment_id=? AND action='deposit_correction' ORDER BY id", [item.id]);
    assert.equal(audits.length, 2);
    assert.equal(Number(audits[1].before_snapshot.deposit_value), 15);
    assert.equal(Number(audits[1].after_snapshot.deposit_value), 45);
    assert.ok(audits[1].user_id);
  });
  const complete = await api(`/appointments/${item.id}/complete`, { method: "POST", body: { payments: [] } });
  assert.equal(complete.status, 200, JSON.stringify(complete.json));
  const title = await sql((db) => db.get("SELECT fe.* FROM financial_entries fe JOIN service_executions se ON fe.source_type='service_execution' AND fe.source_id=se.id WHERE se.appointment_id=?", [item.id]));
  assert.equal(Number(title.amount), 55);
  for (const paid of [20, 20, 55, 55]) {
    const paidResult = await api(`/finance/entries/${title.id}`, { method: "PATCH", body: { paid_amount: paid, payment_method: "Dinheiro" } });
    assert.equal(paidResult.status, 200, JSON.stringify(paidResult.json));
    const origin = await api(`/finance/entries/${title.id}/details`);
    assert.equal(origin.status, 200, JSON.stringify(origin.json));
    assert.equal(origin.json.origin.deposit_paid, 45);
    assert.equal(origin.json.origin.other_paid, paid);
    assert.equal(origin.json.origin.paid_value, 45 + paid);
    assert.equal(origin.json.origin.remaining_value, 55 - paid);
    const financial = await api(`/appointments/${item.id}/value-adjustments`);
    assert.equal(financial.json.financial.totalPaid, 45 + paid);
    assert.equal(financial.json.financial.outstandingBalance, 55 - paid);
  }
  await sql(async (db) => {
    assert.equal((await db.all("SELECT id FROM payments WHERE financial_entry_id=?", [title.id])).length, 1);
    const execution = await db.get("SELECT * FROM service_executions WHERE appointment_id=?", [item.id]);
    assert.equal(Number(execution.paid_value), 100);
    assert.equal(Number(execution.receivable_value), 0);
  });
  const ledger = await api(`/finance/ledger?from=&to=&client_id=${item.client_id}`);
  assert.equal(ledger.json.cashflow.received, 100);
  assert.equal(ledger.json.receivable, 0);
});

test("gateway confirma só seu sinal, respeita valor cobrado e reenvio não ressuscita cancelados", async () => {
  const item = await create(25, "pendente");
  await sql(async (db) => {
    await db.run("INSERT INTO payments (client_id,appointment_id,amount,payment_type,method,status,paid_at) VALUES (?,?,90,'sinal','Pix','cancelado','2026-10-06')", [item.client_id, item.id]);
    const intent = await createPaymentIntent(db, { appointmentId: item.id, clientId: item.client_id, amount: 12 });
    await transitionPaymentIntent(db, { intentId: intent.id, status: "confirmed", providerEventId: "qa-1", paidAt: "2026-10-07T01:00:00Z" });
    await transitionPaymentIntent(db, { intentId: intent.id, status: "confirmed", providerEventId: "qa-2" });
    const received = await db.all("SELECT * FROM payments WHERE appointment_id=? AND status='pago'", [item.id]);
    assert.equal(received.length, 1);
    assert.equal(Number(received[0].amount), 12);
    assert.equal(received[0].paid_at, "2026-10-06 22:00:00");
    assert.equal(Number((await db.get("SELECT remaining_value FROM appointments WHERE id=?", [item.id])).remaining_value), 88);
    assert.equal((await db.all("SELECT id FROM payments WHERE appointment_id=? AND status='cancelado'", [item.id])).length, 1);
  });
});

test("dashboard acompanha criação, reagendamento, cancelamento e finalização e coincide com agenda real", async () => {
  const first = await create(0, "pendente");
  const second = await create(0, "pendente");
  const compare = async () => {
    const expected = await sql((db) => db.all(`SELECT id FROM appointments WHERE status IN ('pendente','awaiting_deposit_proof','confirmado','chegou')
      AND (appointment_date || ' ' || appointment_time)::timestamp AT TIME ZONE 'America/Sao_Paulo' >= now()
      ORDER BY appointment_date,appointment_time,id`));
    const dashboard = await api("/dashboard");
    assert.equal(dashboard.status, 200);
    assert.deepEqual(dashboard.json.adminDashboard.upcomingAppointments.map((item) => item.id), expected.slice(0, 8).map((item) => item.id));
    assert.equal(dashboard.json.adminDashboard.nextAppointment?.id ?? null, expected[0]?.id ?? null);
    if (expected.length) assert.ok(dashboard.json.adminDashboard.nextAppointment.starts_at.endsWith("Z"));
  };
  await compare();
  assert.equal((await api(`/appointments/${first.id}`, { method: "PATCH", body: { appointment_date: "2026-12-30", reason: "Reagendamento QA" } })).status, 200);
  await compare();
  assert.equal((await api(`/appointments/${first.id}/cancel`, { method: "POST", body: { resolution: "no_payment", reason: "Cancelamento QA" } })).status, 200);
  await compare();
  assert.equal((await api(`/appointments/${second.id}/complete`, { method: "POST", body: { payments: [] } })).status, 200);
  await compare();
});

test("baixa da venda é idempotente, rastreável e não cria receita em dobro", async () => {
  const item = await create(0, "pendente");
  const title = await sql(async (db) => {
    const sale = (await db.run("INSERT INTO sales_orders (client_id,total_value,status,source) VALUES (?,80,'concluida','balcao') RETURNING id", [item.client_id])).returnedId;
    return db.get("INSERT INTO financial_entries (entry_type,description,amount,paid_amount,due_date,competence_date,status,source_type,source_id,source_key) VALUES ('receivable','Venda rastreável',80,0,'2026-10-06','2026-10-06','pending','sales_order',?,?) RETURNING *", [sale, `sales-order:${sale}:receivable:1`]);
  });
  for (const paid of [20, 20, 80, 80]) {
    const result = await api(`/finance/entries/${title.id}`, { method: "PATCH", body: { paid_amount: paid, payment_method: "Pix" } });
    assert.equal(result.status, 200, JSON.stringify(result.json));
    const details = await api(`/finance/entries/${title.id}/details`);
    assert.equal(details.json.origin.paid_value, paid);
    assert.equal(details.json.origin.remaining_value, 80 - paid);
  }
  assert.equal((await sql((db) => db.all("SELECT id FROM payments WHERE financial_entry_id=?", [title.id]))).length, 1);
  const ledger = await api(`/finance/ledger?from=&to=&client_id=${item.client_id}`);
  assert.equal(ledger.json.cashflow.received, 80);
  assert.equal((await api(`/finance/entries/${title.id}`, { method: "PATCH", body: { paid_amount: "NaN" } })).status, 400);
  assert.equal((await api(`/finance/entries/${title.id}`, { method: "PATCH", body: { amount: 90, paid_amount: 80 } })).status, 400);
});
