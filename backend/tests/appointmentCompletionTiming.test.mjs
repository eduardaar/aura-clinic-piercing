import assert from "node:assert/strict";
import { test } from "node:test";
import { createTenant, deleteTenant, loginTenant, platformLogin, req } from "./helpers.mjs";
import { withTenantSchema } from "../src/db/tenantSession.js";
import { localDate, localTimestamp } from "../src/services/utils.js";

test("profissional preenche e finaliza retorno passado com antecedência de 60 minutos, preservando dinheiro, estoque e datas", async () => {
  const platformToken = await platformLogin();
  const clinic = await createTenant("qa-retorno-passado");
  try {
    const { token } = await loginTenant(clinic.slug, clinic.adminEmail, clinic.adminPassword);
    const api = (path, options = {}) => req(path, { token, tenant: clinic.slug, ...options });
    const service = await api("/services", { method: "POST", body: { name: "Retorno", category: "Retorno", duration_minutes: 30, price: 80, deposit_value: 20, minimum_advance_minutes: 60 } });
    assert.equal(service.status, 201, JSON.stringify(service.json));
    const professional = await api("/professionals", { method: "POST", body: { name: "Profissional do retorno", service_ids: [service.json.id] } });
    assert.equal(professional.status, 201, JSON.stringify(professional.json));
    const user = await api("/users", { method: "POST", body: { name: "Profissional", email: `piercer@${clinic.slug}.test`, password: "SenhaForte123", role: "piercer" } });
    assert.equal(user.status, 201, JSON.stringify(user.json));
    const piercer = await loginTenant(clinic.slug, `piercer@${clinic.slug}.test`, "SenhaForte123");
    const professionalApi = (path, options = {}) => req(path, { token: piercer.token, tenant: clinic.slug, ...options });
    const product = await api("/jewelry", { method: "POST", body: { name: "Joia QA", category: "Argolas", quantity: 4, cost_value: 10, sale_value: 20, can_sell: true } });
    assert.equal(product.status, 201, JSON.stringify(product.json));
    const future = localDate(new Date(Date.now() + 7 * 86400000));
    const past = localDate(new Date(Date.now() - 2 * 86400000));
    const body = {
      full_name: "Cliente do retorno", whatsapp: "11999997777", professional_id: professional.json.id,
      service_id: service.json.id, procedure: "Retorno", piercing_region: "Lóbulo", appointment_date: future, appointment_time: "10:00", status: "confirmado",
      deposit_value: 20, deposit_status: "pago", deposit_payment_method: "Pix",
      appointment_items: [{ service_id: service.json.id, procedure_price: 80, jewelry_id: product.json.id, jewelry_unit_price: 20, quantity: 1 }]
    };
    const created = await api("/appointments", { method: "POST", body });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const id = created.json.id;
    // Simula a passagem do tempo depois de um retorno corretamente agendado.
    await withTenantSchema(clinic.tenant.id, (db) => db.run("UPDATE appointments SET appointment_date=? WHERE id=?", [past, id]));
    const opened = await professionalApi(`/appointments?id=${id}`);
    assert.equal(opened.status, 200);
    const appointment = opened.json[0];
    assert.equal(appointment.appointment_date, past);
    const operational = await professionalApi(`/appointments/${id}`, { method: "PATCH", body: { status: "em_atendimento", notes: "Conferência do retorno" } });
    assert.equal(operational.status, 200, JSON.stringify(operational.json));
    const items = appointment.items.map((item) => ({ ...item, region: "Lóbulo revisado" }));
    const patch = { appointment_date: past, appointment_time: "10:00:00", appointment_items: items, notes: "Retorno realizado; cicatrização conferida." };
    const saved = await professionalApi(`/appointments/${id}`, { method: "PATCH", body: patch });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.equal(Number(saved.json.total_value), 100);
    assert.equal(Number(saved.json.remaining_value), 80);
    const complete = await professionalApi(`/appointments/${id}/complete`, { method: "POST", body: {
      clinical_notes: "Cicatrização adequada.", aftercare_notes: "Manter os cuidados orientados.", payments: [{ amount: 80, method: "Pix", status: "pago" }]
    } });
    assert.equal(complete.status, 200, JSON.stringify(complete.json));
    assert.equal(complete.json.status, "atendido");
    assert.equal(complete.json.appointment_date, past);
    assert.equal(String(complete.json.appointment_time).slice(0, 5), "10:00");
    assert.equal(Number(complete.json.remaining_value), 0);
    await withTenantSchema(clinic.tenant.id, async (db) => {
      const execution = await db.get("SELECT * FROM service_executions WHERE appointment_id=?", [id]);
      assert.equal(execution.clinical_notes, "Cicatrização adequada.");
      assert.equal(execution.snapshot.appointment_date, past);
      assert.equal(localDate(new Date(execution.completed_at)), localDate());
      const stock = await db.get("SELECT quantity FROM jewelry_inventory WHERE id=?", [product.json.id]);
      assert.equal(Number(stock.quantity), 3);
      const paid = await db.get("SELECT SUM(amount) AS total FROM payments WHERE appointment_id=? AND status IN ('pago','confirmado')", [id]);
      assert.equal(Number(paid.total), 100);
      const history = await db.get("SELECT COUNT(*) AS total FROM appointment_reschedule_history WHERE appointment_id=?", [id]);
      assert.equal(Number(history.total), 0, "reenviar o horário original não gera reagendamento");
    });
    const blockedCreate = await api("/appointments", { method: "POST", body: { ...body, appointment_date: past, appointment_time: "12:00" } });
    assert.equal(blockedCreate.status, 400);
    assert.match(blockedCreate.json.error, /antecedência mínima de 60 minutos/);
    const nearFuture = localTimestamp(new Date(Date.now() + 30 * 60000));
    const tooSoon = await api("/appointments", { method: "POST", body: { ...body, appointment_date: nearFuture.slice(0, 10), appointment_time: nearFuture.slice(11, 16) } });
    assert.equal(tooSoon.status, 400, JSON.stringify(tooSoon.json));
    assert.match(tooSoon.json.error, /antecedência mínima de 60 minutos/);
    for (const withItems of [false, true]) {
      const reschedule = await api(`/appointments/${id}`, { method: "PATCH", body: {
        appointment_time: "11:00", reason: "Reagendamento de teste", ...(withItems ? { appointment_items: items } : {})
      } });
      assert.equal(reschedule.status, 400, JSON.stringify(reschedule.json));
      assert.match(reschedule.json.error, /antecedência mínima de 60 minutos/);
    }
  } finally {
    await deleteTenant(platformToken, clinic.tenant.id, clinic.slug);
  }
});
