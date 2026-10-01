// Central de Relatórios, razão financeiro, exportações e painel (SPEC 5.4 e
// 9/RELATÓRIOS): fonte de dados correta, permissões de comissão, escopo
// próprio, exportação assíncrona com as mesmas regras da síncrona, ledger sem
// dupla contagem e CSV financeiro sem duplicar venda × pagamento.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createTenant, loginTenant, req } from "./helpers.mjs";
import { withTenantSchema } from "../src/db/tenantSession.js";
import { deprovisionTenant } from "../src/services/tenants.js";

const ctx = {};
// Data local da clínica (UTC−3), igual à usada pelo backend.
const HOJE = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
const api = (path, opts = {}) => req(path, { token: ctx.token, tenant: ctx.slug, ...opts });
const sql = (fn) => withTenantSchema(ctx.tenant.id, fn);
const range = `from=${HOJE}&to=${HOJE}`;

async function createUser(role, extra = {}) {
  const email = `${role}.${Math.floor(Math.random() * 1e7)}@${ctx.slug}.test`;
  const password = "SenhaForteRelatorio123";
  const created = await api("/users", { method: "POST", body: { name: `Usuário ${role}`, email, password, role, ...extra } });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  return (await loginTenant(ctx.slug, email, password)).token;
}

async function createAppointment({ professionalId, time, fullName, whatsapp, items, status = "confirmado" }) {
  const created = await api("/appointments", {
    method: "POST",
    body: {
      full_name: fullName, whatsapp, professional_id: professionalId, service_id: items[0].service_id,
      procedure: "Relatório QA", piercing_region: "Orelha", appointment_date: HOJE, appointment_time: time,
      deposit_value: 0, status, appointment_items: items
    }
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  return created.json;
}

async function complete(appointmentId, payments = []) {
  const completed = await api(`/appointments/${appointmentId}/complete`, { method: "POST", body: { payments } });
  assert.equal(completed.status, 200, JSON.stringify(completed.json));
  return completed.json;
}

before(async () => {
  const created = await createTenant("qarel");
  Object.assign(ctx, created);
  ctx.token = (await loginTenant(created.slug, created.adminEmail, created.adminPassword)).token;
  const plan = await api("/subscription", { method: "PATCH", body: { plan_code: "studio" } });
  assert.equal(plan.status, 200, JSON.stringify(plan.json));

  const service = await api("/services", { method: "POST", body: { name: "Lóbulo Relatório", duration_minutes: 30, price: 100, deposit_value: 0 } });
  assert.equal(service.status, 201, JSON.stringify(service.json));
  ctx.serviceId = service.json.id;
  const p1 = await api("/professionals", { method: "POST", body: { name: "Piercer Relatório Um", phone: "11955550001", service_ids: [ctx.serviceId] } });
  const p2 = await api("/professionals", { method: "POST", body: { name: "Piercer Relatório Dois", phone: "11955550002", service_ids: [ctx.serviceId] } });
  assert.equal(p1.status, 201, JSON.stringify(p1.json));
  assert.equal(p2.status, 201, JSON.stringify(p2.json));
  ctx.p1 = p1.json.id;
  ctx.p2 = p2.json.id;
  for (const [id, rate] of [[ctx.p1, 10], [ctx.p2, 20]]) {
    const rules = await api(`/professionals/${id}/commission-rules`, { method: "PUT", body: { rules: [{ scope: "servico_padrao", rate_type: "percentual", rate_value: rate }] } });
    assert.equal(rules.status, 200, JSON.stringify(rules.json));
  }

  // Um atendimento finalizado para cada profissional, com comissão gravada.
  const a1 = await createAppointment({ professionalId: ctx.p1, time: "09:00", fullName: "Cliente Relatório Um", whatsapp: "11944440001", items: [{ service_id: ctx.serviceId, procedure_price: 100, region: "Lóbulo" }] });
  const a2 = await createAppointment({ professionalId: ctx.p2, time: "10:00", fullName: "Cliente Relatório Dois", whatsapp: "11944440002", items: [{ service_id: ctx.serviceId, procedure_price: 200, region: "Lóbulo" }] });
  await complete(a1.id, [{ amount: 100, method: "Pix", status: "pago" }]);
  await complete(a2.id, [{ amount: 200, method: "Pix", status: "pago" }]);
  for (const id of [a1.id, a2.id]) {
    const recalculated = await api("/commissions/recalculate", { method: "POST", body: { appointment_id: id } });
    assert.equal(recalculated.status, 200, JSON.stringify(recalculated.json));
  }
  ctx.a1 = a1;
  ctx.a2 = a2;
  ctx.clientId = a1.client_id;
});

after(async () => {
  if (ctx.tenant?.id) await deprovisionTenant(ctx.tenant.id);
});

test("comissões: lê os lançamentos ativos com colunas pt-BR, filtros e totais do período", async () => {
  const report = await api(`/reports/commissions?${range}`);
  assert.equal(report.status, 200, JSON.stringify(report.json));
  const rows = report.json.rows;
  assert.equal(rows.length, 2);
  const row1 = rows.find((row) => Number(row.appointment_id) === Number(ctx.a1.id));
  assert.equal(row1.professional, "Piercer Relatório Um");
  assert.equal(row1.item_kind, "Serviço");
  assert.equal(row1.rule_scope, "Padrão de serviços");
  assert.equal(row1.rule, "Percentual · 10,00%");
  assert.deepEqual([row1.gross_amount, row1.discount_amount, row1.adjustment_amount, row1.base_amount, row1.commission_amount], [100, 0, 0, 100, 10]);
  assert.equal(report.json.summary.commission, 50, "10% de 100 + 20% de 200");
  const labels = report.json.columns.map((column) => column.label);
  for (const label of ["Data", "Atendimento", "Cliente", "Profissional", "Item", "Tipo", "Bruto", "Desconto", "Ajuste", "Base (líquido)", "Taxa", "Comissão"]) {
    assert.ok(labels.includes(label), `coluna ausente: ${label}`);
  }

  const byProfessional = await api(`/reports/commissions?${range}&professional_id=${ctx.p2}`);
  assert.deepEqual(byProfessional.json.rows.map((row) => Number(row.appointment_id)), [Number(ctx.a2.id)]);
  const byAppointment = await api(`/reports/commissions?${range}&appointment_id=${ctx.a1.id}`);
  assert.deepEqual(byAppointment.json.rows.map((row) => Number(row.appointment_id)), [Number(ctx.a1.id)]);
  const byService = await api(`/reports/commissions?${range}&service_id=${ctx.serviceId}`);
  assert.equal(byService.json.rows.length, 2);

  // Lançamento estornado não aparece.
  await sql((db) => db.run("UPDATE commission_entries SET status='estornada', reversed_at=now(), reversal_reason='QA' WHERE appointment_id=?", [ctx.a2.id]));
  const afterReversal = await api(`/reports/commissions?${range}`);
  assert.equal(afterReversal.json.rows.length, 1);
  assert.equal(afterReversal.json.summary.commission, 10);
  await api("/commissions/recalculate", { method: "POST", body: { appointment_id: ctx.a2.id, reason: "Restaurar QA" } });
});

test("comissões: view_all vê todos, view_own só o próprio (CSV inclusive), sem permissão → 403", async () => {
  const financeToken = await createUser("finance");
  const all = await api(`/reports/commissions?${range}`, { token: financeToken });
  assert.equal(all.status, 200, JSON.stringify(all.json));
  assert.equal(all.json.rows.length, 2);

  const ownToken = await createUser("piercer", { professional_id: ctx.p1, permission_overrides: [{ permission: "commission.view_own", allowed: true }] });
  const own = await api(`/reports/commissions?${range}&professional_id=${ctx.p2}`, { token: ownToken });
  assert.equal(own.status, 200, JSON.stringify(own.json));
  assert.ok(own.json.rows.length > 0);
  assert.ok(own.json.rows.every((row) => row.professional === "Piercer Relatório Um"), "filtro forçado no profissional do usuário");
  const csv = await fetchText(`/reports/commissions?${range}&format=csv`, ownToken);
  assert.equal(csv.status, 200);
  assert.match(csv.text, /^﻿?ID,Data,Atendimento,Cliente,Profissional,Item,Tipo/);
  assert.doesNotMatch(csv.text, /Piercer Relatório Dois/);

  const catalog = await api("/reports", { token: ownToken });
  assert.ok(catalog.json.reports.some((report) => report.type === "commissions"), "comissões aparecem na central para quem tem view_own");

  const unlinked = await createUser("piercer", { permission_overrides: [{ permission: "commission.view_own", allowed: true }] });
  assert.equal((await api(`/reports/commissions?${range}`, { token: unlinked })).status, 409);

  const receptionToken = await createUser("reception");
  const denied = await api(`/reports/commissions?${range}`, { token: receptionToken });
  assert.equal(denied.status, 403, JSON.stringify(denied.json));
  // reports.view_financial sozinho não basta: comissão segue commission.*.
  const financialOnly = await createUser("reception", { permission_overrides: [{ permission: "reports.view_financial", allowed: true }] });
  assert.equal((await api(`/reports/commissions?${range}`, { token: financialOnly })).status, 403);
});

test("desempenho por profissional: faturamento das execuções e comissão dos lançamentos, só para quem pode ver comissão", async () => {
  const report = await api(`/reports/professionals?${range}&professional_id=${ctx.p1}`);
  assert.equal(report.status, 200, JSON.stringify(report.json));
  const [row] = report.json.rows;
  for (const field of ["worked_days", "available_hours", "occupied_hours", "completed_appointments", "cancellations", "no_shows", "products_sold", "service_revenue", "jewelry_revenue", "discount_total", "adjustment_total", "revenue", "average_ticket", "commission_base", "commission", "occupancy_rate", "attendance_rate"]) {
    assert.ok(Object.hasOwn(row, field), `campo ausente: ${field}`);
  }
  assert.equal(Object.hasOwn(row, "commission_percentage"), false, "percentual legado não é mais exposto");
  assert.equal(row.revenue, 100);
  assert.equal(row.service_revenue, 100);
  assert.equal(row.commission, 10);
  assert.equal(row.commission_base, 100);

  const viewer = await createUser("reception", { permission_overrides: [{ permission: "reports.view_all", allowed: true }] });
  const hidden = await api(`/reports/professionals?${range}&professional_id=${ctx.p1}`, { token: viewer });
  assert.equal(hidden.status, 200, JSON.stringify(hidden.json));
  assert.equal(Object.hasOwn(hidden.json.rows[0], "commission"), false);
  assert.equal(hidden.json.columns.some((column) => column.key === "commission"), false);
  const csv = await fetchText(`/reports/professionals?${range}&format=csv`, viewer);
  assert.doesNotMatch(csv.text.split("\n")[0], /Comissão/);
});

test("indicadores químicos: relatório próprio e biossegurança leem execução + indicador", async () => {
  const created = await api(`/appointments/${ctx.a1.id}/chemical-indicators`, {
    method: "POST",
    body: { procedure_name: "Lóbulo Relatório", indicator_type: "Classe 4 — multiparâmetro", indicator_brand: "Marca QA", indicator_lot: "LOTE-REL-1", indicator_date: HOJE, identification: "Ciclo 7", result: "aprovado" }
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));

  const report = await api(`/reports/chemical_indicators?${range}`);
  assert.equal(report.status, 200, JSON.stringify(report.json));
  const row = report.json.rows.find((item) => Number(item.appointment_id) === Number(ctx.a1.id));
  assert.ok(row, JSON.stringify(report.json.rows));
  assert.match(String(row.client).toLowerCase(), /cliente relatório um/);
  assert.equal(row.indicator_lot, "LOTE-REL-1");
  assert.equal(row.identification, "Ciclo 7");
  assert.equal(row.result, "aprovado");
  assert.equal(row.has_photo, false);
  assert.equal(row.status, "ativo");
  assert.equal(row.professional, "Piercer Relatório Um");
  assert.equal((await api(`/reports/chemical_indicators?${range}&result=reprovado`)).json.rows.length, 0);
  assert.equal((await api(`/reports/chemical_indicators?${range}&professional_id=${ctx.p2}`)).json.rows.length, 0);

  const biosafety = await api(`/reports/biosafety?${range}`);
  assert.equal(biosafety.status, 200, JSON.stringify(biosafety.json));
  const execution = biosafety.json.rows.find((item) => Number(item.appointment_id) === Number(ctx.a1.id));
  assert.ok(execution, "execução finalizada aparece na biossegurança");
  assert.equal(Number(execution.indicators), 1);
  assert.equal(Number(execution.indicators_approved), 1);
  assert.equal(execution.indicator_lots, "LOTE-REL-1");
  assert.ok(biosafety.json.rows.some((item) => Number(item.appointment_id) === Number(ctx.a2.id) && Number(item.indicators) === 0), "execução sem indicador também aparece (lacuna visível)");
});

test("ajustes de valor: relatório discrimina tipo, valor, motivo, usuário e situação", async () => {
  const appointment = await createAppointment({ professionalId: ctx.p1, time: "14:00", fullName: "Cliente Ajuste Relatório", whatsapp: "11944440003", items: [{ service_id: ctx.serviceId, procedure_price: 150, region: "Lóbulo" }] });
  const added = await api(`/appointments/${appointment.id}/value-adjustments`, { method: "POST", body: { adjustment_type: "acrescimo", amount: 15, reason: "Material adicional" } });
  assert.equal(added.status, 201, JSON.stringify(added.json));
  const reduced = await api(`/appointments/${appointment.id}/value-adjustments`, { method: "POST", body: { adjustment_type: "abatimento", amount: 5, reason: "Atraso do cliente" } });
  assert.equal(reduced.status, 201, JSON.stringify(reduced.json));
  const voided = await api(`/appointments/${appointment.id}/value-adjustments/${reduced.json.adjustment.id}/void`, { method: "POST", body: { reason: "Lançado por engano" } });
  assert.equal(voided.status, 200, JSON.stringify(voided.json));

  const report = await api(`/reports/value_adjustments?${range}`);
  assert.equal(report.status, 200, JSON.stringify(report.json));
  const rows = report.json.rows.filter((row) => Number(row.appointment_id) === Number(appointment.id));
  assert.equal(rows.length, 2);
  const increase = rows.find((row) => row.adjustment_type === "acrescimo");
  const decrease = rows.find((row) => row.adjustment_type === "abatimento");
  assert.equal(increase.amount, 15);
  assert.equal(increase.signed_amount, 15);
  assert.equal(increase.reason, "Material adicional");
  assert.equal(increase.status, "ativo");
  assert.match(String(increase.created_by).toLowerCase(), /administrador qa/);
  assert.match(increase.created_at_local, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.equal(decrease.signed_amount, -5);
  assert.equal(decrease.status, "anulado");
  assert.equal(decrease.void_reason, "Lançado por engano");
  assert.equal(report.json.summary.net_effect, 15, "anulado não entra no efeito líquido");
  assert.equal((await api(`/reports/value_adjustments?${range}&status=anulado`)).json.rows.length, 1);

  // O relatório de agendamentos mostra bruto, descontos, ajustes e líquido.
  const appointments = await api(`/reports/appointments?${range}`);
  const row = appointments.json.rows.find((item) => Number(item.id) === Number(appointment.id));
  assert.deepEqual([row.gross_value, row.discount_total, row.adjustment_total, row.net_value], [150, 0, 15, 165]);

  // Ajustes de valor exigem relatório financeiro (recepção não abre).
  const receptionToken = await createUser("reception");
  assert.equal((await api(`/reports/value_adjustments?${range}`, { token: receptionToken })).status, 403);
});

test("serviços, pagamentos, vendas e cancelamentos usam a fonte e o status corretos", async () => {
  // Agendamento só confirmado não é "serviço executado".
  await createAppointment({ professionalId: ctx.p2, time: "16:00", fullName: "Cliente Não Executado", whatsapp: "11944440004", items: [{ service_id: ctx.serviceId, procedure_price: 999, region: "Lóbulo" }] });
  const services = await api(`/reports/services?${range}`);
  assert.equal(services.status, 200, JSON.stringify(services.json));
  const service = services.json.rows.find((row) => row.service === "Lóbulo Relatório");
  assert.equal(Number(service.executions), 2);
  assert.equal(service.gross_revenue, 300);

  // Pagamentos: status explícito, "Recebido" só para pago/confirmado.
  const pending = await sql((db) => db.get(
    "INSERT INTO payments (client_id, amount, payment_type, method, status, paid_at) VALUES (?, 40, 'sinal', 'Pix', 'pendente', ?) RETURNING id",
    [ctx.clientId, `${HOJE} 12:00:00`]
  ));
  const canceled = await sql((db) => db.get(
    "INSERT INTO payments (client_id, amount, payment_type, method, status, paid_at) VALUES (?, 70, 'sinal', 'Pix', 'cancelado', ?) RETURNING id",
    [ctx.clientId, `${HOJE} 12:00:00`]
  ));
  const payments = await api(`/reports/payments?${range}`);
  assert.equal(payments.status, 200, JSON.stringify(payments.json));
  const pendingRow = payments.json.rows.find((row) => Number(row.id) === Number(pending.id));
  assert.equal(pendingRow.status, "pendente");
  assert.equal(pendingRow.received_amount, 0);
  assert.ok(!payments.json.rows.some((row) => Number(row.id) === Number(canceled.id)), "cancelado só aparece com filtro explícito");
  assert.ok(payments.json.rows.some((row) => row.status === "pago" && row.received_amount === row.amount));
  const onlyCanceled = await api(`/reports/payments?${range}&status=cancelado`);
  assert.ok(onlyCanceled.json.rows.some((row) => Number(row.id) === Number(canceled.id)));

  // Vendas: bruto, desconto manual, líquido; cancelada fora do padrão.
  const sale = await api("/sales-orders", { method: "POST", body: { client_id: ctx.clientId, full_name: "Cliente Relatório Um", whatsapp: "11944440001", status: "concluida", payment_method: "Pix", items: [{ item_name: "Joia avulsa", quantity: 1, unit_price: 100 }], manual_discount_value: 10, manual_discount_reason: "Fidelidade" } });
  assert.equal(sale.status, 201, JSON.stringify(sale.json));
  const toCancel = await api("/sales-orders", { method: "POST", body: { client_id: ctx.clientId, full_name: "Cliente Relatório Um", whatsapp: "11944440001", status: "aberta", payment_method: "Pix", items: [{ item_name: "Joia cancelada", quantity: 1, unit_price: 80 }] } });
  assert.equal(toCancel.status, 201, JSON.stringify(toCancel.json));
  const cancelSale = await api(`/sales-orders/${toCancel.json.id}`, { method: "PATCH", body: { status: "cancelado", reason: "Desistência" } });
  assert.equal(cancelSale.status, 200, JSON.stringify(cancelSale.json));
  const sales = await api(`/reports/sales?${range}`);
  assert.equal(sales.status, 200, JSON.stringify(sales.json));
  const saleRow = sales.json.rows.find((row) => Number(row.id) === Number(sale.json.id));
  assert.deepEqual([saleRow.gross_value, saleRow.manual_discount, saleRow.coupon_discount, saleRow.discount_total, saleRow.net_value, saleRow.returned_value, saleRow.final_value], [100, 10, 0, 10, 90, 0, 90]);
  assert.ok(!sales.json.rows.some((row) => Number(row.id) === Number(toCancel.json.id)), "venda cancelada não é somada como venda");
  assert.equal(sales.json.columns.some((column) => column.key === "discount_value"), false, "sem coluna discount_value (renderizada por discount_type na tela)");

  // Cancelamentos: inclui ausência (no-show) com a resolução do sinal.
  const noShow = await createAppointment({ professionalId: ctx.p1, time: "18:00", fullName: "Cliente Ausente", whatsapp: "11944440005", items: [{ service_id: ctx.serviceId, procedure_price: 100, region: "Lóbulo" }] });
  const marked = await api(`/appointments/${noShow.id}/cancel`, { method: "POST", body: { outcome: "no_show", resolution: "no_payment", reason: "Não veio" } });
  assert.equal(marked.status, 200, JSON.stringify(marked.json));
  const cancellations = await api(`/reports/cancellations?${range}`);
  assert.equal(cancellations.status, 200, JSON.stringify(cancellations.json));
  const absence = cancellations.json.rows.find((row) => Number(row.id) === Number(noShow.id));
  assert.equal(absence.status, "nao_compareceu");
  assert.equal(absence.deposit_resolution, "Sem sinal recebido");
  assert.equal(absence.reason, "Não veio");
  assert.equal(absence.event_date, HOJE);
});

test("ledger: status explícito, crédito aplicado fora da receita, pendente coberto pelo recebível e espelho órfão cancelado", async () => {
  const insertPayment = (status, amount, extra = {}) => sql((db) => db.get(
    `INSERT INTO payments (client_id, appointment_id, amount, payment_type, method, status, paid_at)
     VALUES (?, ?, ?, ?, 'Pix', ?, ?) RETURNING id`,
    [ctx.clientId, extra.appointmentId || null, amount, extra.type || "sinal", status, `${HOJE} 10:00:00`]
  ));
  const confirmed = await insertPayment("confirmado", 11);
  const refunded = await insertPayment("refunded", 12);
  const credit = await insertPayment("credito_aplicado", 13, { type: "credito_cliente" });

  // Atendimento finalizado com saldo PENDENTE: o recebível da execução já é
  // o "a receber"; o pagamento pendente não pode virar outra receita pendente.
  const appointment = await createAppointment({ professionalId: ctx.p1, time: "15:00", fullName: "Cliente Pendente Ledger", whatsapp: "11944440006", items: [{ service_id: ctx.serviceId, procedure_price: 80, region: "Lóbulo" }] });
  await complete(appointment.id, [{ amount: 80, method: "Pix", status: "pendente" }]);
  const pendingCompletion = await sql((db) => db.get("SELECT id FROM payments WHERE appointment_id=? AND status='pendente' ORDER BY id DESC LIMIT 1", [appointment.id]));

  // Espelho antigo de um pagamento que não existe mais (sinal recriado).
  await sql((db) => db.run(
    `INSERT INTO financial_entries (entry_type, description, category, amount, paid_amount, due_date, competence_date, status, source_type, source_id, source_key)
     VALUES ('income', 'Pagamento sinal', 'sinal', 99, 0, ?, ?, 'pending', 'payment', 987654, 'payment:987654')`,
    [HOJE, HOJE]
  ));

  const ledger = await api(`/finance/ledger?from=${HOJE}&to=${HOJE}`);
  assert.equal(ledger.status, 200, JSON.stringify(ledger.json));

  const mirror = (id) => sql((db) => db.get("SELECT status, paid_amount, amount FROM financial_entries WHERE source_key=?", [`payment:${id}`]));
  assert.deepEqual(await mirror(confirmed.id), { status: "paid", paid_amount: 11, amount: 11 });
  assert.deepEqual(await mirror(refunded.id), { status: "refunded", paid_amount: 12, amount: 12 }, "estorno: entrou e saiu (a saída é a despesa de reembolso)");
  assert.equal(await mirror(credit.id), undefined, "crédito aplicado não vira receita nem caixa");
  assert.ok(pendingCompletion, "o fechamento registrou o pagamento pendente");
  const pendingMirror = await mirror(pendingCompletion.id);
  assert.ok(!pendingMirror || pendingMirror.status === "canceled", `pendente coberto pelo recebível não duplica: ${JSON.stringify(pendingMirror)}`);
  const orphan = await sql((db) => db.get("SELECT status, paid_amount FROM financial_entries WHERE source_key='payment:987654'"));
  assert.equal(orphan.status, "canceled");

  // O "a receber" do atendimento aparece UMA vez (título da execução).
  const open = await sql((db) => db.get(
    `SELECT COALESCE(SUM(GREATEST(fe.amount-fe.paid_amount,0)),0) AS total FROM financial_entries fe
      WHERE fe.status IN ('pending','overdue','partially_paid') AND COALESCE(fe.lifecycle_status,'active')='active'
        AND ((fe.source_type='service_execution' AND fe.source_id=(SELECT id FROM service_executions WHERE appointment_id=?))
          OR (fe.source_type='payment' AND fe.source_id IN (SELECT id FROM payments WHERE appointment_id=?)))`,
    [appointment.id, appointment.id]
  ));
  assert.equal(Number(open.total), 80);

  // Painel: mesmo critério do razão (teste/cancelado fora do "a receber").
  const entry = await api("/finance/entries", { method: "POST", body: { entry_type: "receivable", description: "Título QA painel", amount: 500, due_date: HOJE } });
  assert.equal(entry.status, 201, JSON.stringify(entry.json));
  const before = (await api("/dashboard")).json.adminDashboard.executive.receivable;
  const marked = await api(`/finance/entries/${entry.json[0].id}/lifecycle`, { method: "POST", body: { action: "test", reason: "Lançamento de teste do painel" } });
  assert.equal(marked.status, 200, JSON.stringify(marked.json));
  const dashboard = await api("/dashboard");
  assert.equal(dashboard.status, 200, JSON.stringify(dashboard.json));
  assert.equal(Number((before - dashboard.json.adminDashboard.executive.receivable).toFixed(2)), 500, "lançamento de teste sai do a receber do painel");
  const ledgerAfter = await api(`/finance/ledger?from=2000-01-01&to=2100-12-31`);
  assert.equal(Number(ledgerAfter.json.receivable), Number(dashboard.json.adminDashboard.executive.receivable), "painel e razão concordam");
  // Faturamento do dia conta o confirmado, mas não o pendente.
  assert.ok(dashboard.json.stats.revenueToday >= 300 + 11);
});

test("CSV financeiro não conta a mesma venda duas vezes (pagamento × venda)", async () => {
  const paid = await api("/sales-orders", { method: "POST", body: { client_id: ctx.clientId, full_name: "Cliente Relatório Um", whatsapp: "11944440001", status: "concluida", payment_method: "Pix", items: [{ item_name: "Venda CSV paga", quantity: 1, unit_price: 77.7 }] } });
  assert.equal(paid.status, 201, JSON.stringify(paid.json));
  const open = await api("/sales-orders", { method: "POST", body: { client_id: ctx.clientId, full_name: "Cliente Relatório Um", whatsapp: "11944440001", status: "aberta", payment_method: "Pix", items: [{ item_name: "Venda CSV aberta", quantity: 1, unit_price: 66.6 }] } });
  assert.equal(open.status, 201, JSON.stringify(open.json));
  const csv = await fetchText("/finance/export.csv", ctx.token);
  assert.equal(csv.status, 200);
  const lines = csv.text.split("\n");
  assert.equal(lines.filter((line) => line.includes("77.7")).length, 1, "venda paga aparece só pelo pagamento");
  assert.ok(lines.some((line) => line.includes("77.7") && line.endsWith(",pagamento")));
  assert.equal(lines.filter((line) => line.includes("66.6")).length, 1, "venda sem pagamento aparece uma vez, como venda");
  assert.ok(lines.some((line) => line.includes("66.6") && line.endsWith(",venda")));
});

test("exportação assíncrona: mesmas permissões, escopo próprio e auditoria da rota síncrona", async () => {
  const receptionToken = await createUser("reception");
  for (const type of ["payments", "payables", "financial", "commissions", "audit", "users"]) {
    const denied = await api("/jobs/report-exports", { token: receptionToken, method: "POST", headers: { "Idempotency-Key": `rec-${type}` }, body: { type, format: "csv" } });
    assert.equal(denied.status, 403, `${type}: ${JSON.stringify(denied.json)}`);
  }

  const financeToken = await createUser("finance");
  const allowed = await api("/jobs/report-exports", { token: financeToken, method: "POST", headers: { "Idempotency-Key": "fin-payments" }, body: { type: "payments", format: "csv", filters: { from: HOJE, to: HOJE, status: "pago", injected: "x" } } });
  assert.equal(allowed.status, 202, JSON.stringify(allowed.json));

  const ownToken = await createUser("piercer", { professional_id: ctx.p1, permission_overrides: [{ permission: "commission.view_own", allowed: true }] });
  const own = await api("/jobs/report-exports", { token: ownToken, method: "POST", headers: { "Idempotency-Key": "own-commissions" }, body: { type: "commissions", format: "csv", filters: { professional_id: ctx.p2, service_id: ctx.serviceId } } });
  assert.equal(own.status, 202, JSON.stringify(own.json));
  const stored = await sql((db) => db.get("SELECT payload FROM background_jobs WHERE id=?", [own.json.job.id]));
  assert.equal(Number(stored.payload.filters.professional_id), Number(ctx.p1), "escopo próprio forçado no pedido");
  assert.equal(Number(stored.payload.filters.service_id), Number(ctx.serviceId), "filtro novo repassado ao worker");
  const financeStored = await sql((db) => db.get("SELECT payload FROM background_jobs WHERE id=?", [allowed.json.job.id]));
  assert.equal(Object.hasOwn(financeStored.payload.filters, "injected"), false, "filtro não declarado é descartado");

  const audit = await sql((db) => db.get("SELECT COUNT(*)::int AS total FROM audit_events WHERE module='reports' AND action='export_requested' AND entity_id='commissions'"));
  assert.equal(audit.total, 1);

  // O piercer não baixa a exportação pedida pelo financeiro, nem a lista.
  const listed = await api("/jobs", { token: ownToken });
  assert.equal(listed.status, 200, JSON.stringify(listed.json));
  assert.ok(!listed.json.items.some((item) => item.id === allowed.json.job.id));
  assert.equal((await api(`/jobs/${allowed.json.job.id}/download`, { token: ownToken })).status, 404);
  assert.equal((await api(`/jobs/${allowed.json.job.id}/download`, { token: receptionToken })).status, 404);

  // Exportação gerada COM colunas de comissão (pedida pelo admin) não é
  // baixada por quem vê a fila inteira mas não pode ver comissão.
  const withCommission = await api("/jobs/report-exports", { method: "POST", headers: { "Idempotency-Key": "admin-professionals" }, body: { type: "professionals", format: "csv", filters: { from: HOJE, to: HOJE } } });
  assert.equal(withCommission.status, 202, JSON.stringify(withCommission.json));
  const queueViewer = await createUser("reception", { permission_overrides: [
    { permission: "reports.view_all", allowed: true }, { permission: "reports.view_financial", allowed: true }
  ] });
  const viewerList = await api("/jobs", { token: queueViewer });
  assert.ok(viewerList.json.items.some((item) => item.id === withCommission.json.job.id), "vê a fila inteira");
  const leaked = await api(`/jobs/${withCommission.json.job.id}/download`, { token: queueViewer });
  assert.equal(leaked.status, 403, JSON.stringify(leaked.json));
  // Quem pediu passa pela checagem (o arquivo ainda não foi gerado → 409).
  assert.equal((await api(`/jobs/${withCommission.json.job.id}/download`)).status, 409);
});

async function fetchText(path, token) {
  const { BASE } = await import("./helpers.mjs");
  const response = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}`, "X-Tenant": ctx.slug } });
  return { status: response.status, text: (await response.text()).replace(/^﻿/, "") };
}
