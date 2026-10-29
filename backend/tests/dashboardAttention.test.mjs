import assert from "node:assert/strict";
import test from "node:test";
import { createTenant, deleteTenant, loginTenant, platformLogin, req } from "./helpers.mjs";
import { withTenantSchema } from "../src/db/tenantSession.js";
import { localDate } from "../src/services/utils.js";

test("central retorna contagens reais completas, por período, sem incluir produtos desativados", async () => {
  const platformToken = await platformLogin();
  const clinic = await createTenant("qa-central-atencao");
  try {
    const { token } = await loginTenant(clinic.slug, clinic.adminEmail, clinic.adminPassword);
    const api = (path, options = {}) => req(path, { token, tenant: clinic.slug, ...options });
    const upgrade = await api("/subscription", { method: "PATCH", body: { plan_code: "studio" } });
    assert.equal(upgrade.status, 200, JSON.stringify(upgrade.json));
    const today = localDate();
    const service = await api("/services", { method: "POST", body: { name: "Retorno", price: 0 } });
    const professional = await api("/professionals", { method: "POST", body: { name: "Profissional QA", service_ids: [service.json.id] } });
    const appointment = await api("/appointments", { method: "POST", body: {
      full_name: "Cliente aniversariante", whatsapp: "11999993333", professional_id: professional.json.id,
      service_id: service.json.id, procedure: "Retorno", piercing_region: "Lóbulo", appointment_date: today, appointment_time: "10:00", status: "pendente"
    } });
    assert.equal(appointment.status, 201, JSON.stringify(appointment.json));
    for (let index = 0; index < 14; index++) {
      const product = await api("/jewelry", { method: "POST", body: { name: `Joia ${index}`, category: "Argolas", quantity: 0, can_sell: true, track_stock: true } });
      assert.equal(product.status, 201, JSON.stringify(product.json));
      if (index === 13) {
        const inactive = await api(`/jewelry/${product.json.id}/status`, { method: "PATCH", body: { is_active: false } });
        assert.equal(inactive.status, 200, JSON.stringify(inactive.json));
      }
    }
    await withTenantSchema(clinic.tenant.id, async (db) => {
      await db.run("UPDATE clients SET birth_date=? WHERE id=?", [`1990-${today.slice(5)}`, appointment.json.client_id]);
      for (const day of [7, 15]) {
        await db.run("INSERT INTO post_care_followups(appointment_id,client_id,reminder_day,due_date,care_message) VALUES(?,?,?,?,?)", [appointment.json.id, appointment.json.client_id, day, today, "Conferir retorno"]);
      }
    });
    for (const period of ["today", "week", "month"]) {
      const response = await api(`/dashboard/attention?period=${period}`);
      assert.equal(response.status, 200, JSON.stringify(response.json));
      assert.equal(response.json.appointments, 1);
      assert.equal(response.json.sold_out, 13, "contagem não usa a lista limitada a oito itens");
      assert.equal(response.json.birthdays, 1);
      assert.equal(response.json.returns, 1, "dois lembretes da mesma cliente representam um contato");
      assert.ok(response.json.updated_at.endsWith("Z"));
    }
  } finally {
    await deleteTenant(platformToken, clinic.tenant.id, clinic.slug);
  }
});
