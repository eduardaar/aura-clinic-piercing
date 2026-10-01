// Desconto manual e ajustes de valor do atendimento (SPEC seções 2, 4 e 9).
//
// Rode (de backend/): node tests/run-suite.mjs tests/appointmentDiscountAdjustments.test.mjs
//
// Cobre a conta oficial (149,90 − 10,00 = 139,90; sinal 50 → restante 89,90),
// teto do desconto, permissões (apply_discount, edit_final_value, finance.edit),
// ajustes múltiplos com anulação, idempotência, efeitos após o fechamento,
// prévia oficial, identidade dos itens, sinal e crédito no teto do fechamento.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { calculateOperationTotals } from "../src/services/finance.js";
import { withTenantSchema } from "../src/db/tenantSession.js";
import { createTenant, deleteTenant, loginTenant, platformLogin, req } from "./helpers.mjs";

const ctx = { tokens: {}, userIds: {} };
const PW = "SenhaForte123";
let slot = 0;

before(async () => {
  Object.assign(ctx, await createTenant("qa-desc"));
  ctx.platformToken = await platformLogin();
  ctx.tokens.admin = (await loginTenant(ctx.slug, ctx.adminEmail, ctx.adminPassword)).token;
  const plan = await api("/subscription", { method: "PATCH", body: { plan_code: "studio" } });
  assert.equal(plan.status, 200, JSON.stringify(plan.json));

  const service = await api("/services", { method: "POST", body: { name: "Perfuração QA", duration_minutes: 30, price: 149.9, deposit_value: 50 } });
  assert.equal(service.status, 201, JSON.stringify(service.json));
  ctx.serviceId = service.json.id;
  const second = await api("/services", { method: "POST", body: { name: "Troca QA", duration_minutes: 20, price: 40, deposit_value: 0 } });
  ctx.secondServiceId = second.json.id;
  const professional = await api("/professionals", { method: "POST", body: { name: "Prof Desconto", specialty: "Piercing", phone: "11955554444" } });
  ctx.professionalId = professional.json.id;
  const other = await api("/professionals", { method: "POST", body: { name: "Prof Substituta", specialty: "Piercing", phone: "11955554445" } });
  ctx.otherProfessionalId = other.json.id;

  // piercer: tem desconto e ajuste, mas não finance.edit.
  // recepcao_sem_desconto: recepção com apply_discount negado por exceção.
  const users = [
    { key: "piercer", role: "piercer" },
    { key: "noDiscount", role: "reception", permission_overrides: [{ permission: "appointments.apply_discount", allowed: false }] },
    { key: "reception", role: "reception" }
  ];
  for (const user of users) {
    const email = `${user.key.toLowerCase()}@${ctx.slug}.test`;
    const created = await api("/users", {
      method: "POST",
      body: { name: `Usuário ${user.key}`, email, password: PW, role: user.role, permission_overrides: user.permission_overrides }
    });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    ctx.userIds[user.key] = created.json.id;
    ctx.tokens[user.key] = (await loginTenant(ctx.slug, email, PW)).token;
  }
});

after(async () => {
  if (ctx.tenant?.id) await deleteTenant(ctx.platformToken, ctx.tenant.id, ctx.slug);
});

function api(path, { as = "admin", ...options } = {}) {
  return req(path, { tenant: ctx.slug, token: ctx.tokens[as], ...options });
}

function tenantDb(fn) {
  return withTenantSchema(ctx.tenant.id, fn);
}

// Cada agendamento num dia próprio: nunca há conflito de horário entre testes.
function nextSchedule() {
  slot += 1;
  const date = new Date(Date.UTC(2026, 10, 2 + slot));
  return { appointment_date: date.toISOString().slice(0, 10), appointment_time: "10:00" };
}

async function createAppointment(extra = {}, as = "admin") {
  const response = await api("/appointments", {
    as,
    method: "POST",
    body: {
      full_name: `Cliente Desconto ${slot + 1}`, whatsapp: `1198${String(100000 + slot).padStart(7, "0")}`,
      professional_id: ctx.professionalId, service_id: ctx.serviceId, procedure: "Perfuração QA",
      piercing_region: "Orelha", deposit_value: 50, deposit_status: "pago", deposit_payment_method: "Pix",
      status: "confirmado", ...nextSchedule(), ...extra
    }
  });
  return response;
}

async function appointmentRow(id) {
  return tenantDb((db) => db.get("SELECT * FROM appointments WHERE id = ?", [id]));
}

test("cálculo oficial: bruto 149,90 − desconto 10,00 = 139,90; sinal 50 → restante 89,90", () => {
  const totals = calculateOperationTotals({
    serviceSubtotal: 149.9, couponDiscount: 0, manualDiscount: 10,
    payments: [{ status: "pago", payment_type: "sinal", amount: 50 }]
  });
  assert.equal(totals.grossTotal, 149.9);
  assert.equal(totals.discountTotal, 10);
  assert.equal(totals.manualDiscount, 10);
  assert.equal(totals.netTotal, 139.9);
  assert.equal(totals.outstandingBalance, 89.9);

  const adjusted = calculateOperationTotals({ serviceSubtotal: 149.9, manualDiscount: 10, adjustmentTotal: -4.95, payments: [] });
  assert.equal(adjusted.adjustmentTotal, -4.95);
  assert.equal(adjusted.netTotal, 134.95);
  const capped = calculateOperationTotals({ serviceSubtotal: 100, couponDiscount: 30, manualDiscount: 80 });
  assert.equal(capped.discountTotal, 100, "desconto total nunca passa do bruto");
  assert.equal(capped.discountExceedsGross, true);
  const negative = calculateOperationTotals({ serviceSubtotal: 100, manualDiscount: 90, adjustmentTotal: -20 });
  assert.equal(negative.netTotal, 0);
  assert.equal(negative.negativeNet, true);
});

test("criação com desconto manual grava bruto, desconto, líquido, restante e auditoria", async () => {
  const created = await createAppointment({ manual_discount_value: "10.00", manual_discount_reason: "Cliente fiel" });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal(Number(created.json.subtotal_value), 149.9);
  assert.equal(Number(created.json.manual_discount_value), 10);
  assert.equal(Number(created.json.discount_value), 10);
  assert.equal(Number(created.json.total_value), 139.9);
  assert.equal(Number(created.json.remaining_value), 89.9);
  assert.equal(created.json.manual_discount_reason, "Cliente fiel");
  ctx.discounted = created.json;

  const state = await tenantDb(async (db) => ({
    audit: await db.get("SELECT before_data, after_data FROM audit_events WHERE module='appointments' AND action='discount' AND entity_id=?", [String(created.json.id)]),
    financial: await db.get("SELECT action FROM appointment_financial_audit WHERE appointment_id=? AND action='manual_discount'", [created.json.id])
  }));
  assert.ok(state.audit, "alteração de desconto gera recordAudit");
  assert.equal(typeof state.audit.after_data, "object");
  assert.equal(Array.isArray(state.audit.after_data), false, "auditoria grava objeto, não array");
  assert.equal(Number(state.audit.after_data.manual_discount_value), 10);
  assert.ok(state.financial, "alteração de desconto gera appointment_financial_audit");

  const snapshot = await api(`/appointments/${created.json.id}/value-adjustments`);
  assert.equal(snapshot.status, 200, JSON.stringify(snapshot.json));
  assert.equal(snapshot.json.financial.manualDiscount, 10);
  assert.equal(snapshot.json.financial.couponDiscount, 0);
  assert.equal(snapshot.json.financial.manualDiscountReason, "Cliente fiel");
  assert.equal(snapshot.json.financial.netTotal, 139.9);
  assert.equal(snapshot.json.financial.outstandingBalance, 89.9);
});

test("desconto acima do bruto e valor malformado são recusados com 400", async () => {
  const tooHigh = await createAppointment({ manual_discount_value: 150 });
  assert.equal(tooHigh.status, 400, JSON.stringify(tooHigh.json));
  assert.equal(tooHigh.json.error, "O desconto não pode ser maior que o valor bruto.");

  const malformed = await createAppointment({ manual_discount_value: "10.555" });
  assert.equal(malformed.status, 400, JSON.stringify(malformed.json));
  const negative = await createAppointment({ manual_discount_value: -5 });
  assert.equal(negative.status, 400, JSON.stringify(negative.json));

  const patch = await api(`/appointments/${ctx.discounted.id}`, { method: "PATCH", body: { manual_discount_value: 200 } });
  assert.equal(patch.status, 400, JSON.stringify(patch.json));
  assert.equal(patch.json.error, "O desconto não pode ser maior que o valor bruto.");
  const unchanged = await appointmentRow(ctx.discounted.id);
  assert.equal(Number(unchanged.manual_discount_value), 10, "recusa não grava nada");

  // Itens alterados que deixam o desconto maior que o bruto também param.
  const cheaper = await api(`/appointments/${ctx.discounted.id}`, {
    method: "PATCH",
    body: { appointment_items: [{ service_id: ctx.secondServiceId, procedure_price: 5 }] }
  });
  assert.equal(cheaper.status, 400, JSON.stringify(cheaper.json));
  assert.match(cheaper.json.error, /Revise o desconto/);
});

test("sem appointments.apply_discount: 403 ao alterar o desconto, mas salvar sem mudar o valor continua liberado", async () => {
  const denied = await createAppointment({ manual_discount_value: 5 }, "noDiscount");
  assert.equal(denied.status, 403, JSON.stringify(denied.json));
  assert.equal(denied.json.error, "Você não tem permissão para aplicar desconto.");

  const patchDenied = await api(`/appointments/${ctx.discounted.id}`, { as: "noDiscount", method: "PATCH", body: { manual_discount_value: 12 } });
  assert.equal(patchDenied.status, 403, JSON.stringify(patchDenied.json));

  const sameValue = await api(`/appointments/${ctx.discounted.id}`, {
    as: "noDiscount", method: "PATCH", body: { manual_discount_value: "10", manual_discount_reason: "Cliente fiel", notes: "Sem mudança de valor" }
  });
  assert.equal(sameValue.status, 200, JSON.stringify(sameValue.json));

  const allowed = await api(`/appointments/${ctx.discounted.id}`, { as: "reception", method: "PATCH", body: { manual_discount_value: 15, manual_discount_reason: "Campanha" } });
  assert.equal(allowed.status, 200, JSON.stringify(allowed.json));
  assert.equal(Number(allowed.json.total_value), 134.9);
  assert.equal(Number(allowed.json.remaining_value), 84.9);
  const row = await appointmentRow(ctx.discounted.id);
  assert.equal(Number(row.manual_discount_updated_by), Number(ctx.userIds.reception));

  const coupon = await api(`/appointments/${ctx.discounted.id}`, { as: "noDiscount", method: "PATCH", body: { coupon_code: "INEXISTENTE" } });
  assert.equal(coupon.status, 400, "cupom inexistente é validado (recepção tem apply_coupon)");
});

test("acréscimos e abatimentos múltiplos, anulação com motivo e idempotência", async () => {
  const created = await createAppointment({ manual_discount_value: 10 });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const id = created.json.id;

  const noPermission = await api(`/appointments/${id}/value-adjustments`, {
    as: "reception", method: "POST", body: { adjustment_type: "acrescimo", amount: 10, reason: "Atraso" }
  });
  assert.equal(noPermission.status, 403, "recepção não tem appointments.edit_final_value");

  const invalid = await api(`/appointments/${id}/value-adjustments`, { method: "POST", body: { adjustment_type: "acrescimo", amount: 10, reason: "  " } });
  assert.equal(invalid.status, 400, JSON.stringify(invalid.json));
  const invalidType = await api(`/appointments/${id}/value-adjustments`, { method: "POST", body: { adjustment_type: "bonus", amount: 10, reason: "x" } });
  assert.equal(invalidType.status, 400);
  const zero = await api(`/appointments/${id}/value-adjustments`, { method: "POST", body: { adjustment_type: "abatimento", amount: 0, reason: "x" } });
  assert.equal(zero.status, 400);

  const first = await api(`/appointments/${id}/value-adjustments`, {
    as: "piercer", method: "POST", headers: { "Idempotency-Key": "qa-adj-1" },
    body: { adjustment_type: "acrescimo", amount: 20, reason: "Material adicional" }
  });
  assert.equal(first.status, 201, JSON.stringify(first.json));
  assert.equal(first.json.adjustment.adjustment_type, "acrescimo");
  assert.equal(Number(first.json.adjustment.net_before), 139.9);
  assert.equal(Number(first.json.adjustment.net_after), 159.9);
  assert.equal(first.json.adjustment.created_by_name, "Usuário piercer");
  assert.equal(first.json.financial.adjustmentTotal, 20);
  assert.equal(first.json.financial.netTotal, 159.9);

  const repeated = await api(`/appointments/${id}/value-adjustments`, {
    as: "piercer", method: "POST", body: { adjustment_type: "acrescimo", amount: 20, reason: "Material adicional", idempotency_key: "qa-adj-1" }
  });
  assert.equal(repeated.status, 200, JSON.stringify(repeated.json));
  assert.equal(repeated.json.adjustment.id, first.json.adjustment.id, "repetição devolve o mesmo ajuste");
  const conflicting = await api(`/appointments/${id}/value-adjustments`, {
    method: "POST", headers: { "Idempotency-Key": "qa-adj-1" }, body: { adjustment_type: "acrescimo", amount: 21, reason: "Material adicional" }
  });
  assert.equal(conflicting.status, 409, JSON.stringify(conflicting.json));

  const second = await api(`/appointments/${id}/value-adjustments`, {
    method: "POST", body: { adjustment_type: "abatimento", amount: "5.50", reason: "Atraso do estúdio" }
  });
  assert.equal(second.status, 201, JSON.stringify(second.json));
  assert.equal(second.json.financial.adjustmentTotal, 14.5);
  assert.equal(second.json.adjustments.length, 2);
  let row = await appointmentRow(id);
  assert.equal(Number(row.adjustment_total), 14.5);
  assert.equal(Number(row.total_value), 154.4);
  assert.equal(Number(row.remaining_value), 104.4);

  const voidWithoutReason = await api(`/appointments/${id}/value-adjustments/${first.json.adjustment.id}/void`, { method: "POST", body: {} });
  assert.equal(voidWithoutReason.status, 400);
  const voided = await api(`/appointments/${id}/value-adjustments/${first.json.adjustment.id}/void`, {
    method: "POST", body: { reason: "Lançado por engano" }
  });
  assert.equal(voided.status, 200, JSON.stringify(voided.json));
  assert.equal(voided.json.adjustment.status, "anulado");
  assert.equal(voided.json.adjustment.void_reason, "Lançado por engano");
  assert.ok(voided.json.adjustment.voided_by_name);
  assert.equal(voided.json.financial.adjustmentTotal, -5.5);
  assert.equal(voided.json.financial.adjustments.length, 1, "snapshot lista só os ativos");
  row = await appointmentRow(id);
  assert.equal(Number(row.total_value), 134.4);
  assert.equal(Number(row.remaining_value), 84.4);

  const voidAgain = await api(`/appointments/${id}/value-adjustments/${first.json.adjustment.id}/void`, { method: "POST", body: { reason: "De novo" } });
  assert.equal(voidAgain.status, 409);

  const list = await api(`/appointments/${id}/value-adjustments`, { as: "reception" });
  assert.equal(list.status, 200);
  assert.equal(list.json.adjustments.length, 2, "listagem mantém o histórico com anulados");

  const audits = await tenantDb((db) => db.all(
    "SELECT action, metadata FROM audit_events WHERE module='appointments' AND entity_id=? AND action LIKE 'value_adjustment%' ORDER BY id",
    [String(id)]
  ));
  assert.deepEqual(audits.map((item) => item.action), ["value_adjustment_add", "value_adjustment_add", "value_adjustment_void"]);
  assert.equal(Array.isArray(audits[0].metadata), false);
  const financialAudits = await tenantDb((db) => db.all("SELECT action FROM appointment_financial_audit WHERE appointment_id=? AND action LIKE 'value_adjustment%'", [id]));
  assert.equal(financialAudits.length, 3);

  const impact = await api(`/appointments/${id}/deletion-impact`);
  assert.equal(impact.json.impact.value_adjustments, 2);
  assert.equal(impact.json.can_delete, false);
});

test("abatimento que negativa o líquido ou fica abaixo do já pago é recusado", async () => {
  const created = await createAppointment({ manual_discount_value: 10 });
  const id = created.json.id;
  const negative = await api(`/appointments/${id}/value-adjustments`, { method: "POST", body: { adjustment_type: "abatimento", amount: 140, reason: "Teste" } });
  assert.equal(negative.status, 400, JSON.stringify(negative.json));
  assert.equal(negative.json.error, "O abatimento deixaria o valor líquido negativo.");
  const toZero = await api(`/appointments/${id}/value-adjustments`, { method: "POST", body: { adjustment_type: "abatimento", amount: 139.9, reason: "Zerar" } });
  assert.equal(toZero.status, 400, "zerar fica abaixo do sinal já pago");
  const belowPaid = await api(`/appointments/${id}/value-adjustments`, { method: "POST", body: { adjustment_type: "abatimento", amount: 100, reason: "Abaixo do sinal" } });
  assert.equal(belowPaid.status, 400, JSON.stringify(belowPaid.json));
  assert.match(belowPaid.json.error, /já pagou/);
  const row = await appointmentRow(id);
  assert.equal(Number(row.adjustment_total), 0);
  assert.equal(Number(row.total_value), 139.9);
});

test("finalização usa o líquido ajustado; atendido exige finance.edit; parcela recebida bloqueia com 409", async () => {
  const created = await createAppointment({ manual_discount_value: 10 });
  const id = created.json.id;
  const plus = await api(`/appointments/${id}/value-adjustments`, { method: "POST", body: { adjustment_type: "acrescimo", amount: 10, reason: "Atraso do cliente" } });
  assert.equal(plus.status, 201, JSON.stringify(plus.json));

  const tooMuch = await api(`/appointments/${id}/complete`, { method: "POST", body: { payments: [{ amount: 99.91, method: "Pix", status: "pago" }] } });
  assert.equal(tooMuch.status, 400, "teto é líquido ajustado (149,90) − sinal (50)");
  const completed = await api(`/appointments/${id}/complete`, {
    method: "POST", body: { payments: [{ amount: 59.9, method: "Pix", status: "pago" }], installment_count: 2, first_due_date: "2026-12-01", payment_method: "Cartão de crédito" }
  });
  assert.equal(completed.status, 200, JSON.stringify(completed.json));
  assert.equal(Number(completed.json.total_value), 149.9);
  assert.equal(Number(completed.json.remaining_value), 40);
  let execution = await tenantDb((db) => db.get("SELECT * FROM service_executions WHERE appointment_id=?", [id]));
  assert.equal(Number(execution.total_value), 149.9);
  assert.equal(Number(execution.adjustment_total), 10);
  assert.equal(Number(execution.discount_total), 10);
  assert.equal(Number(execution.receivable_value), 40);
  const linked = await tenantDb((db) => db.get("SELECT service_execution_id FROM appointment_value_adjustments WHERE appointment_id=?", [id]));
  assert.equal(Number(linked.service_execution_id), Number(execution.id), "ajuste anterior ao fechamento é vinculado à execução");

  const piercer = await api(`/appointments/${id}/value-adjustments`, { as: "piercer", method: "POST", body: { adjustment_type: "abatimento", amount: 5, reason: "Desconto pós-fechamento" } });
  assert.equal(piercer.status, 403, "após atendido o ajuste exige finance.edit");

  const admin = await api(`/appointments/${id}/value-adjustments`, { method: "POST", body: { adjustment_type: "abatimento", amount: 5, reason: "Correção pós-fechamento" } });
  assert.equal(admin.status, 201, JSON.stringify(admin.json));
  execution = await tenantDb((db) => db.get("SELECT * FROM service_executions WHERE appointment_id=?", [id]));
  assert.equal(Number(execution.total_value), 144.9);
  assert.equal(Number(execution.adjustment_total), 5);
  assert.equal(Number(execution.receivable_value), 35);
  const receivables = await tenantDb((db) => db.all(
    "SELECT id, amount FROM financial_entries WHERE source_type='service_execution' AND source_id=? AND entry_type='receivable' AND status!='canceled' ORDER BY installment_number",
    [execution.id]
  ));
  assert.equal(receivables.length, 2);
  assert.equal(receivables.reduce((sum, item) => sum + Math.round(Number(item.amount) * 100), 0), 3500);
  const revisions = await tenantDb((db) => db.get("SELECT COUNT(*)::int AS total FROM service_execution_operational_revisions WHERE appointment_id=?", [id]));
  assert.equal(revisions.total, 1, "ajuste não gera revisão operacional");

  const discountWithoutReason = await api(`/appointments/${id}`, { method: "PATCH", body: { manual_discount_value: 12 } });
  assert.equal(discountWithoutReason.status, 400, "desconto em atendido exige motivo");
  const discountAsPiercer = await api(`/appointments/${id}`, { as: "piercer", method: "PATCH", body: { manual_discount_value: 12, reason: "Correção" } });
  assert.equal(discountAsPiercer.status, 403, "desconto em atendido exige finance.edit");

  await tenantDb((db) => db.run("UPDATE financial_entries SET status='partially_paid', paid_amount=10 WHERE id=?", [receivables[0].id]));
  const blocked = await api(`/appointments/${id}/value-adjustments`, { method: "POST", body: { adjustment_type: "acrescimo", amount: 5, reason: "Depois da baixa" } });
  assert.equal(blocked.status, 409, JSON.stringify(blocked.json));
  assert.equal(blocked.json.error, "Já existe parcela recebida deste atendimento; corrija pelo Financeiro.");
  const blockedDiscount = await api(`/appointments/${id}`, { method: "PATCH", body: { manual_discount_value: 12, reason: "Depois da baixa" } });
  assert.equal(blockedDiscount.status, 409, JSON.stringify(blockedDiscount.json));
  const row = await appointmentRow(id);
  assert.equal(Number(row.manual_discount_value), 10, "409 desfaz a alteração");
});

test("ajuste em atendimento cancelado é recusado com 409", async () => {
  const created = await createAppointment({ deposit_value: 0 });
  const cancel = await api(`/appointments/${created.json.id}/cancel`, { method: "POST", body: { resolution: "no_payment", reason: "Desistiu" } });
  assert.equal(cancel.status, 200, JSON.stringify(cancel.json));
  const adjustment = await api(`/appointments/${created.json.id}/value-adjustments`, { method: "POST", body: { adjustment_type: "acrescimo", amount: 5, reason: "Teste" } });
  assert.equal(adjustment.status, 409, JSON.stringify(adjustment.json));
});

test("prévia oficial devolve a mesma conta que a gravação", async () => {
  const preview = await api("/appointments/financial-preview", {
    method: "POST",
    body: {
      appointment_items: [{ service_id: ctx.serviceId }, { service_id: ctx.secondServiceId, procedure_price: 40 }],
      manual_discount_value: "10", deposit_value: 50, deposit_status: "pago"
    }
  });
  assert.equal(preview.status, 200, JSON.stringify(preview.json));
  assert.equal(preview.json.grossTotal, 189.9);
  assert.equal(preview.json.manualDiscount, 10);
  assert.equal(preview.json.netTotal, 179.9);
  assert.equal(preview.json.outstandingBalance, 129.9);
  assert.equal(preview.json.validation.discount, null);

  const created = await createAppointment({
    appointment_items: [{ service_id: ctx.serviceId }, { service_id: ctx.secondServiceId, procedure_price: 40 }],
    manual_discount_value: "10"
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal(Number(created.json.total_value), preview.json.netTotal);
  assert.equal(Number(created.json.remaining_value), preview.json.outstandingBalance);

  const adjust = await api(`/appointments/${created.json.id}/value-adjustments`, { method: "POST", body: { adjustment_type: "acrescimo", amount: 7.25, reason: "Material adicional" } });
  assert.equal(adjust.status, 201);
  const existing = await api("/appointments/financial-preview", { method: "POST", body: { appointment_id: created.json.id } });
  assert.equal(existing.status, 200, JSON.stringify(existing.json));
  const stored = await appointmentRow(created.json.id);
  assert.equal(existing.json.netTotal, Number(stored.total_value), "prévia com agendamento inclui pagamentos e ajustes");
  assert.equal(existing.json.outstandingBalance, Number(stored.remaining_value));
  assert.equal(existing.json.adjustmentTotal, 7.25);

  const excessive = await api("/appointments/financial-preview", { method: "POST", body: { appointment_id: created.json.id, manual_discount_value: 500 } });
  assert.equal(excessive.status, 200);
  assert.equal(excessive.json.validation.discount, "O desconto não pode ser maior que o valor bruto.");
});

test("PATCH preserva a identidade dos itens e atualiza bruto, serviço e joia", async () => {
  const created = await createAppointment({
    deposit_value: 0,
    appointment_items: [{ service_id: ctx.serviceId }, { service_id: ctx.secondServiceId }]
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const [first, second] = created.json.items;
  const patched = await api(`/appointments/${created.json.id}`, {
    method: "PATCH",
    body: {
      appointment_items: [
        { id: first.id, service_id: ctx.serviceId, procedure_price: 160 },
        { service_id: ctx.secondServiceId, procedure_price: 30, region: "Nariz" }
      ]
    }
  });
  assert.equal(patched.status, 200, JSON.stringify(patched.json));
  const ids = patched.json.items.map((item) => Number(item.id));
  assert.ok(ids.includes(Number(first.id)), "item com id é atualizado no lugar");
  assert.ok(!ids.includes(Number(second.id)), "item ausente do payload é removido");
  assert.equal(patched.json.items.length, 2);
  assert.equal(Number(patched.json.items.find((item) => Number(item.id) === Number(first.id)).procedure_price), 160);
  assert.equal(Number(patched.json.subtotal_value), 190, "PATCH atualiza o bruto gravado");
  assert.equal(Number(patched.json.service_value), 190);
  assert.equal(Number(patched.json.total_value), 190);
});

test("sinal confirmado não volta a pendente e não é recriado a cada salvamento", async () => {
  const created = await createAppointment({ deposit_value: 50, deposit_status: "pago" });
  const id = created.json.id;
  const before = await tenantDb((db) => db.all("SELECT id, status, amount FROM payments WHERE appointment_id=? AND payment_type='sinal'", [id]));
  assert.equal(before.length, 1);
  const saved = await api(`/appointments/${id}`, {
    method: "PATCH",
    body: { deposit_value: 50, deposit_status: "pendente", deposit_payment_method: "Pix", notes: "Salvo pela tela" }
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  const afterSave = await tenantDb((db) => db.all("SELECT id, status, amount FROM payments WHERE appointment_id=? AND payment_type='sinal' ORDER BY id", [id]));
  assert.equal(afterSave.length, 1);
  assert.equal(afterSave[0].id, before[0].id, "o pagamento do sinal mantém o id");
  assert.equal(afterSave[0].status, "pago", "sinal recebido não volta a pendente");
  assert.equal(saved.json.deposit_status, "pago");
  assert.equal(Number(saved.json.remaining_value), 99.9);

  const pending = await createAppointment({ deposit_value: 30, deposit_status: "pendente" });
  const pendingBefore = await tenantDb((db) => db.get("SELECT id FROM payments WHERE appointment_id=? AND payment_type='sinal'", [pending.json.id]));
  const changed = await api(`/appointments/${pending.json.id}`, { method: "PATCH", body: { deposit_value: 40, deposit_status: "pendente" } });
  assert.equal(changed.status, 200, JSON.stringify(changed.json));
  const pendingAfter = await tenantDb((db) => db.all("SELECT id, amount, status FROM payments WHERE appointment_id=? AND payment_type='sinal' AND status<>'cancelado'", [pending.json.id]));
  assert.equal(pendingAfter.length, 1);
  assert.equal(pendingAfter[0].id, pendingBefore.id, "mudança de valor atualiza a mesma linha");
  assert.equal(Number(pendingAfter[0].amount), 40);
});

test("sinal pendente é substituído no fechamento e não fica a receber", async () => {
  const created = await createAppointment({ deposit_value: 30, deposit_status: "pendente" });
  const id = created.json.id;
  const completed = await api(`/appointments/${id}/complete`, { method: "POST", body: { payments: [{ amount: 149.9, method: "Pix", status: "pago" }] } });
  assert.equal(completed.status, 200, JSON.stringify(completed.json));
  assert.equal(Number(completed.json.remaining_value), 0);
  const deposit = await tenantDb((db) => db.get("SELECT status, notes FROM payments WHERE appointment_id=? AND payment_type='sinal'", [id]));
  assert.equal(deposit.status, "cancelado");
  assert.match(deposit.notes, /substituído/);
});

test("crédito aplicado entra no teto do fechamento e não gera recebível indevido", async () => {
  const created = await createAppointment({ deposit_value: 0 });
  const id = created.json.id;
  await tenantDb((db) => db.run(
    "INSERT INTO client_credits (client_id, amount, remaining_amount, reason) VALUES (?, 40, 40, 'Crédito QA')",
    [created.json.client_id]
  ));
  const credit = await api(`/appointments/${id}/apply-client-credit`, { method: "POST", body: { amount: 40 } });
  assert.equal(credit.status, 200, JSON.stringify(credit.json));
  assert.equal(Number(credit.json.remaining_value), 109.9);

  const tooMuch = await api(`/appointments/${id}/complete`, { method: "POST", body: { payments: [{ amount: 149.9, method: "Pix", status: "pago" }] } });
  assert.equal(tooMuch.status, 400, "teto desconta o crédito aplicado");
  const completed = await api(`/appointments/${id}/complete`, { method: "POST", body: { payments: [{ amount: 109.9, method: "Pix", status: "pago" }] } });
  assert.equal(completed.status, 200, JSON.stringify(completed.json));
  assert.equal(Number(completed.json.remaining_value), 0);
  const execution = await tenantDb((db) => db.get("SELECT id, paid_value, receivable_value FROM service_executions WHERE appointment_id=?", [id]));
  assert.equal(Number(execution.receivable_value), 0);
  assert.equal(Number(execution.paid_value), 149.9);
  const open = await tenantDb((db) => db.all("SELECT id FROM financial_entries WHERE source_type='service_execution' AND source_id=? AND entry_type='receivable' AND status NOT IN ('canceled','paid')", [execution.id]));
  assert.equal(open.length, 0, "nenhum recebível no valor do crédito");
});

test("troca de profissional após atendido exige finance.edit e motivo", async () => {
  const created = await createAppointment({ deposit_value: 0 });
  const id = created.json.id;
  const completed = await api(`/appointments/${id}/complete`, { method: "POST", body: { payments: [{ amount: 149.9, method: "Pix", status: "pago" }] } });
  assert.equal(completed.status, 200, JSON.stringify(completed.json));
  const piercer = await api(`/appointments/${id}`, { as: "piercer", method: "PATCH", body: { professional_id: ctx.otherProfessionalId, reason: "Troca" } });
  assert.equal(piercer.status, 403);
  const withoutReason = await api(`/appointments/${id}`, { method: "PATCH", body: { professional_id: ctx.otherProfessionalId } });
  assert.equal(withoutReason.status, 400);
  const admin = await api(`/appointments/${id}`, { method: "PATCH", body: { professional_id: ctx.otherProfessionalId, reason: "Atendido pela substituta" } });
  assert.equal(admin.status, 200, JSON.stringify(admin.json));
  const execution = await tenantDb((db) => db.get("SELECT professional_id FROM service_executions WHERE appointment_id=?", [id]));
  assert.equal(Number(execution.professional_id), Number(ctx.otherProfessionalId));
});

// --- Casos achados na verificação adversarial ---------------------------------

test("reduzir ou zerar o desconto manual baixa o desconto total (sem resíduo como cupom)", async () => {
  const created = await createAppointment({ deposit_value: 0, manual_discount_value: 10 });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const id = created.json.id;
  const lower = await api(`/appointments/${id}`, { method: "PATCH", body: { manual_discount_value: 5 } });
  assert.equal(lower.status, 200, JSON.stringify(lower.json));
  assert.equal(Number(lower.json.discount_value), 5);
  assert.equal(Number(lower.json.total_value), 144.9);
  const zero = await api(`/appointments/${id}`, { method: "PATCH", body: { manual_discount_value: 0 } });
  assert.equal(zero.status, 200, JSON.stringify(zero.json));
  assert.equal(Number(zero.json.discount_value), 0);
  assert.equal(Number(zero.json.total_value), 149.9);
  const snapshot = await api(`/appointments/${id}/value-adjustments`);
  assert.equal(snapshot.json.financial.couponDiscount, 0);
  assert.equal(snapshot.json.financial.manualDiscount, 0);
});

test("remover o cupom tira o desconto do cupom e o uso registrado", async () => {
  const coupon = await api("/coupons", { method: "POST", body: { code: "QADESC20", internal_name: "QA 20", discount_type: "fixed", discount_value: 20 } });
  assert.equal(coupon.status, 201, JSON.stringify(coupon.json));
  const created = await createAppointment({ deposit_value: 0, coupon_code: "QADESC20", manual_discount_value: 5 });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal(Number(created.json.discount_value), 25);
  assert.equal(Number(created.json.total_value), 124.9);
  const id = created.json.id;
  const preview = await api("/appointments/financial-preview", { method: "POST", body: { appointment_id: id, coupon_code: "" } });
  assert.equal(preview.status, 200, JSON.stringify(preview.json));
  assert.equal(preview.json.netTotal, 144.9);
  const removed = await api(`/appointments/${id}`, { method: "PATCH", body: { coupon_code: "" } });
  assert.equal(removed.status, 200, JSON.stringify(removed.json));
  assert.equal(removed.json.coupon_code, null);
  assert.equal(Number(removed.json.discount_value), 5);
  assert.equal(Number(removed.json.total_value), preview.json.netTotal);
  const usages = await tenantDb((db) => db.get("SELECT COUNT(*)::int AS total FROM coupon_usages WHERE appointment_id=?", [id]));
  assert.equal(Number(usages.total), 0);
});

test("agendamento público (só total com promoção): prévia e PATCH partem do mesmo desconto", async () => {
  const created = await createAppointment({ deposit_value: 0 });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const id = created.json.id;
  // Simula a linha gravada por routes/booking.js: só total_value (149,90 − 20 de promoção).
  await tenantDb((db) => db.run(
    "UPDATE appointments SET subtotal_value=0, service_value=0, jewelry_value=0, discount_value=0, total_value=129.9, remaining_value=129.9 WHERE id=?",
    [id]
  ));
  const [item] = created.json.items;
  const items = [{ id: item.id, service_id: ctx.serviceId, procedure_price: 200 }];
  const preview = await api("/appointments/financial-preview", { method: "POST", body: { appointment_id: id, appointment_items: items } });
  assert.equal(preview.status, 200, JSON.stringify(preview.json));
  assert.equal(preview.json.grossTotal, 200);
  assert.equal(preview.json.discountTotal, 20, "a promoção vira desconto e não absorve o aumento de preço");
  assert.equal(preview.json.netTotal, 180);
  const patched = await api(`/appointments/${id}`, { method: "PATCH", body: { appointment_items: items } });
  assert.equal(patched.status, 200, JSON.stringify(patched.json));
  assert.equal(Number(patched.json.subtotal_value), 200);
  assert.equal(Number(patched.json.discount_value), 20);
  assert.equal(Number(patched.json.total_value), preview.json.netTotal);
});

test("crédito em atendido com parcela recebida é recusado; ids inválidos dão 404", async () => {
  const created = await createAppointment({ deposit_value: 0 });
  const id = created.json.id;
  const completed = await api(`/appointments/${id}/complete`, {
    method: "POST", body: { payments: [{ amount: 49.9, method: "Pix", status: "pago" }], installment_count: 2, first_due_date: "2026-12-01", payment_method: "Cartão de crédito" }
  });
  assert.equal(completed.status, 200, JSON.stringify(completed.json));
  await tenantDb(async (db) => {
    await db.run("INSERT INTO client_credits (client_id, amount, remaining_amount, reason) VALUES (?, 30, 30, 'Crédito QA')", [created.json.client_id]);
    await db.run(`UPDATE financial_entries SET status='partially_paid', paid_amount=10
      WHERE id = (SELECT fe.id FROM financial_entries fe JOIN service_executions se ON se.id=fe.source_id
        WHERE fe.source_type='service_execution' AND se.appointment_id=? ORDER BY fe.installment_number LIMIT 1)`, [id]);
  });
  const credit = await api(`/appointments/${id}/apply-client-credit`, { method: "POST", body: { amount: 30 } });
  assert.equal(credit.status, 409, JSON.stringify(credit.json));
  assert.equal(credit.json.error, "Já existe parcela recebida deste atendimento; corrija pelo Financeiro.");
  const credits = await tenantDb((db) => db.get("SELECT remaining_amount FROM client_credits WHERE client_id=?", [created.json.client_id]));
  assert.equal(Number(credits.remaining_amount), 30, "nada é consumido");

  const badId = await api("/appointments/abc/value-adjustments");
  assert.equal(badId.status, 404);
  const badAdjustment = await api(`/appointments/${id}/value-adjustments/xyz/void`, { method: "POST", body: { reason: "x" } });
  assert.equal(badAdjustment.status, 404);
});

test("anulação exige motivo e não pode ser repetida", async () => {
  const created = await createAppointment({ deposit_value: 0 });
  const id = created.json.id;
  const plus = await api(`/appointments/${id}/value-adjustments`, { method: "POST", body: { adjustment_type: "acrescimo", amount: "12,50", reason: "Material adicional" } });
  assert.equal(plus.status, 201, JSON.stringify(plus.json));
  assert.equal(Number(plus.json.adjustment.net_before), 149.9);
  assert.equal(Number(plus.json.adjustment.net_after), 162.4);
  const adjustmentId = plus.json.adjustment.id;
  const noReason = await api(`/appointments/${id}/value-adjustments/${adjustmentId}/void`, { method: "POST", body: { reason: "  " } });
  assert.equal(noReason.status, 400, JSON.stringify(noReason.json));
  const voided = await api(`/appointments/${id}/value-adjustments/${adjustmentId}/void`, { method: "POST", body: { reason: "Lançado por engano" } });
  assert.equal(voided.status, 200, JSON.stringify(voided.json));
  assert.equal(voided.json.adjustment.status, "anulado");
  assert.equal(voided.json.financial.netTotal, 149.9);
  const again = await api(`/appointments/${id}/value-adjustments/${adjustmentId}/void`, { method: "POST", body: { reason: "De novo" } });
  assert.equal(again.status, 409, JSON.stringify(again.json));
  const otherAppointment = await createAppointment({ deposit_value: 0 });
  const foreign = await api(`/appointments/${otherAppointment.json.id}/value-adjustments/${adjustmentId}/void`, { method: "POST", body: { reason: "Outro agendamento" } });
  assert.equal(foreign.status, 404, "ajuste de outro agendamento não é encontrado");
  const badType = await api(`/appointments/${id}/value-adjustments`, { method: "POST", body: { adjustment_type: "bonus", amount: 5, reason: "x" } });
  assert.equal(badType.status, 400);
  const longReason = await api(`/appointments/${id}/value-adjustments`, { method: "POST", body: { adjustment_type: "acrescimo", amount: 5, reason: "x".repeat(501) } });
  assert.equal(longReason.status, 400);
});

test("valor do sinal inválido (texto, negativo, 3 casas) é recusado com 400", async () => {
  for (const deposit_value of ["abc", -10, "10.555"]) {
    const created = await createAppointment({ deposit_value });
    assert.equal(created.status, 400, `${deposit_value}: ${JSON.stringify(created.json)}`);
  }
  const ok = await createAppointment({ deposit_value: "30,00", deposit_status: "pendente" });
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  assert.equal(Number(ok.json.deposit_value), 30);
  const patch = await api(`/appointments/${ok.json.id}`, { method: "PATCH", body: { deposit_value: "abc" } });
  assert.equal(patch.status, 400, JSON.stringify(patch.json));
  const row = await appointmentRow(ok.json.id);
  assert.equal(Number(row.deposit_value), 30);
});

test("cupom já aplicado: mesmo código não é revalidado; itens novos só recalculam o valor", async () => {
  const coupon = await api("/coupons", { method: "POST", body: { code: "QAPCT10", internal_name: "QA 10%", discount_type: "percent", discount_value: 10, usage_limit: 1 } });
  assert.equal(coupon.status, 201, JSON.stringify(coupon.json));
  const created = await createAppointment({ deposit_value: 0, coupon_code: "QAPCT10" });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal(Number(created.json.discount_value), 14.99);
  const id = created.json.id;
  // Cupom pausado depois de aplicado e com o único uso já consumido por este
  // agendamento: reenviar o mesmo código não pode travar o salvamento.
  await tenantDb((db) => db.run("UPDATE coupons SET status = 'paused' WHERE id = ?", [coupon.json.id]));
  const same = await api(`/appointments/${id}`, { method: "PATCH", body: { coupon_code: "qapct10", notes: "Reenvio do formulário" } });
  assert.equal(same.status, 200, JSON.stringify(same.json));
  assert.equal(Number(same.json.discount_value), 14.99);
  const [item] = created.json.items;
  const items = [{ id: item.id, service_id: ctx.serviceId, procedure_price: 200 }];
  const preview = await api("/appointments/financial-preview", { method: "POST", body: { appointment_id: id, appointment_items: items, coupon_code: "QAPCT10" } });
  assert.equal(preview.status, 200, JSON.stringify(preview.json));
  assert.equal(preview.json.couponDiscount, 20, "10% sobre o novo bruto, sem revalidar o cupom pausado");
  const patched = await api(`/appointments/${id}`, { method: "PATCH", body: { appointment_items: items, coupon_code: "QAPCT10" } });
  assert.equal(patched.status, 200, JSON.stringify(patched.json));
  assert.equal(Number(patched.json.discount_value), 20);
  assert.equal(Number(patched.json.total_value), preview.json.netTotal);
  // Trocar para outro código continua revalidando: cupom pausado é recusado.
  await api("/coupons", { method: "POST", body: { code: "QAPAUSADO", internal_name: "QA pausado", discount_type: "fixed", discount_value: 5 } });
  await tenantDb((db) => db.run("UPDATE coupons SET status = 'paused' WHERE code = 'QAPAUSADO'"));
  const swapped = await api(`/appointments/${id}`, { method: "PATCH", body: { coupon_code: "QAPAUSADO" } });
  assert.equal(swapped.status, 400, JSON.stringify(swapped.json));
});

test("marcar atendido pelo PATCH exige appointments.finalize", async () => {
  const created = await createAppointment({ deposit_value: 0 });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const denied = await api(`/appointments/${created.json.id}`, { as: "reception", method: "PATCH", body: { status: "atendido" } });
  assert.equal(denied.status, 403, JSON.stringify(denied.json));
  assert.equal((await appointmentRow(created.json.id)).status, "confirmado");
  // Editar sem finalizar continua liberado para a recepção.
  const edited = await api(`/appointments/${created.json.id}`, { as: "reception", method: "PATCH", body: { notes: "Recepção edita" } });
  assert.equal(edited.status, 200, JSON.stringify(edited.json));
});

test("/options e cotação pública de cupom não expõem nem aceitam campos fora da lista", async () => {
  const options = await api("/options", { as: "reception" });
  assert.equal(options.status, 200, JSON.stringify(options.json));
  const professional = options.json.professionals.find((item) => Number(item.id) === Number(ctx.professionalId));
  assert.ok(professional, "profissional ativo listado");
  for (const field of ["commission_percentage", "email", "phone", "whatsapp"]) {
    assert.equal(professional[field], undefined, `${field} não sai de /options`);
  }
  // Cupom de uso único já consumido: a cotação pública não pode ser liberada
  // com uma exclusão injetada no corpo.
  const coupon = await api("/coupons", { method: "POST", body: { code: "QAUNICOPUB", internal_name: "QA único", discount_type: "fixed", discount_value: 5, usage_limit: 1 } });
  assert.equal(coupon.status, 201, JSON.stringify(coupon.json));
  const used = await createAppointment({ deposit_value: 0, coupon_code: "QAUNICOPUB" });
  assert.equal(used.status, 201, JSON.stringify(used.json));
  const quote = await req("/catalog/coupon-quote", {
    method: "POST", tenant: ctx.slug,
    body: { code: "QAUNICOPUB", amount: 100, excludeAppointmentId: used.json.id }
  });
  assert.equal(quote.status, 400, JSON.stringify(quote.json));
  assert.equal(quote.json.valid, false);
});
