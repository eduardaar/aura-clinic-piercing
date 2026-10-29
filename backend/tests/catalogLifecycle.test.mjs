import assert from "node:assert/strict";
import test from "node:test";
import { createTenant, deleteTenant, loginTenant, platformLogin, req } from "./helpers.mjs";
import { withTenantSchema } from "../src/db/tenantSession.js";

test("ativar/desativar é reversível; excluir apaga cadastros sem uso e recusa histórico sem arquivar silenciosamente", async () => {
  const platformToken = await platformLogin();
  const clinic = await createTenant("qa-ciclo-cadastro");
  try {
    const { token } = await loginTenant(clinic.slug, clinic.adminEmail, clinic.adminPassword);
    const api = (path, options = {}) => req(path, { tenant: clinic.slug, token, ...options });
    const service = await api("/services", { method: "POST", body: { name: "Serviço temporário", price: 80, duration_minutes: 30, active_online_booking: true } });
    assert.equal(service.status, 201, JSON.stringify(service.json));
    const professional = await api("/professionals", { method: "POST", body: { name: "Profissional QA", service_ids: [service.json.id] } });
    for (const is_active of [false, true]) {
      const response = await api(`/services/${service.json.id}`, { method: "PATCH", body: { is_active } });
      assert.equal(response.status, 200, JSON.stringify(response.json));
      assert.equal(Boolean(response.json.is_active), is_active);
      assert.ok(response.json.professional_ids.includes(professional.json.id));
      assert.equal(Number(response.json.price), 80);
      assert.equal(Number(response.json.active_online_booking), 1);
    }
    assert.equal((await api(`/services/${service.json.id}`, { method: "DELETE" })).json.deleted, true);
    const services = await api("/services");
    assert.ok(!services.json.some((item) => item.id === service.json.id));

    const product = await api("/jewelry", { method: "POST", body: { name: "Produto sem uso", category: "Argolas", quantity: 0, sale_value: 77, cost_value: 13, can_sell: true } });
    assert.equal(product.status, 201, JSON.stringify(product.json));
    const stored = () => withTenantSchema(clinic.tenant.id, (db) => db.get("SELECT quantity,sale_value,cost_value,is_catalog_active,is_published,virtual_store_active,status FROM jewelry_inventory WHERE id=?", [product.json.id]));
    const before = await stored();
    for (const is_active of [false, true]) {
      const response = await api(`/jewelry/${product.json.id}/status`, { method: "PATCH", body: { is_active } });
      assert.equal(response.status, 200, JSON.stringify(response.json));
      const { status, ...after } = await stored();
      const { status: _oldStatus, ...original } = before;
      assert.deepEqual(after, original, "status não altera dinheiro, saldo ou publicação");
      assert.equal(status === "arquivado", !is_active);
    }
    const deleted = await api(`/jewelry/${product.json.id}`, { method: "DELETE" });
    assert.equal(deleted.status, 200, JSON.stringify(deleted.json));
    assert.equal(deleted.json.deleted, true);
    assert.equal(await stored(), undefined);

    const usedService = await api("/services", { method: "POST", body: { name: "Serviço em uso", price: 80 } });
    const usedProduct = await api("/jewelry", { method: "POST", body: { name: "Produto em uso", category: "Argolas", quantity: 2, sale_value: 20, can_sell: true } });
    const appointment = await api("/appointments", { method: "POST", body: {
      full_name: "Cliente QA", whatsapp: "11999998888", professional_id: professional.json.id,
      procedure: "Serviço em uso", piercing_region: "Lóbulo",
      appointment_date: "2030-01-10", appointment_time: "10:00", service_id: usedService.json.id,
      appointment_items: [{ service_id: usedService.json.id, jewelry_id: usedProduct.json.id, procedure_price: 80, jewelry_unit_price: 20 }]
    } });
    assert.equal(appointment.status, 201, JSON.stringify(appointment.json));
    for (const path of [`/services/${usedService.json.id}`, `/jewelry/${usedProduct.json.id}`]) {
      const refused = await api(path, { method: "DELETE" });
      assert.equal(refused.status, 409, JSON.stringify(refused.json));
      assert.match(refused.json.error, /Desativar/);
    }
    await withTenantSchema(clinic.tenant.id, async (db) => {
      const service = await db.get("SELECT is_active FROM services WHERE id=?", [usedService.json.id]);
      assert.equal(service.is_active, true);
      const stock = await db.get("SELECT status,quantity FROM jewelry_inventory WHERE id=?", [usedProduct.json.id]);
      assert.notEqual(stock.status, "arquivado");
      assert.equal(Number(stock.quantity), 2);
    });
    const inactive = await api(`/jewelry/${usedProduct.json.id}/status`, { method: "PATCH", body: { is_active: false } });
    assert.equal(inactive.status, 200, JSON.stringify(inactive.json));
    const movement = await api(`/jewelry/${usedProduct.json.id}/movements`, { method: "POST", body: { movement_type: "Entrada", quantity: 1 } });
    assert.equal(movement.status, 200, JSON.stringify(movement.json));
    const stock = await withTenantSchema(clinic.tenant.id, (db) => db.get("SELECT status,quantity FROM jewelry_inventory WHERE id=?", [usedProduct.json.id]));
    assert.equal(stock.status, "arquivado", "movimentar estoque não reativa produto desativado");
    assert.equal(Number(stock.quantity), 3);
  } finally {
    await deleteTenant(platformToken, clinic.tenant.id, clinic.slug);
  }
});
