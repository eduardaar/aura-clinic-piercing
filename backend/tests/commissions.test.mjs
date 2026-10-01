// Comissões por profissional (SPEC 5.1–5.3 e 9/BE-COMISSAO).
//
// Parte 1: funções puras do cálculo (rateio pelo maior resto, arredondamento,
//          precedência de regra, teto do valor fixo, validação do payload).
// Parte 2: API numa clínica de teste própria (plano Studio): regras com
//          auditoria/histórico, recálculo idempotente, estorno na reabertura,
//          escopo view_own, gate de plano e vazamentos de dados corrigidos.
//
// O gancho automático na finalização é do pacote BE-DINHEIRO; aqui o
// lançamento é provocado pelo recálculo manual, que usa o MESMO serviço. Os
// testes não dependem de o gancho já existir: com ou sem ele, o estado final
// conferido é o mesmo.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import {
  allocateLargestRemainder,
  commissionAmountCents,
  computeCommissionEntries,
  normalizeCommissionRulesPayload,
  percentOfCents,
  resolveCommissionRule,
  sameCommissionEntries
} from "../src/services/commissions.js";
import { createTenant, loginTenant, req } from "./helpers.mjs";
import { withTenantSchema } from "../src/db/tenantSession.js";
import { deprovisionTenant } from "../src/services/tenants.js";

// ---------------------------------------------------------------- parte 1 ---

test("rateio pelo maior resto: soma exata, sinal preservado e desempate pela ordem", () => {
  assert.deepEqual(allocateLargestRemainder(100, [1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(allocateLargestRemainder(-100, [1, 1, 1]), [-34, -33, -33]);
  assert.deepEqual(allocateLargestRemainder(1000, [10000, 12000, 20000]), [238, 286, 476]);
  assert.deepEqual(allocateLargestRemainder(-500, [10000, 12000, 20000]), [-119, -143, -238]);
  assert.deepEqual(allocateLargestRemainder(7, [0, 5, 0, 5]), [0, 4, 0, 3], "peso zero nunca recebe centavo");
  assert.deepEqual(allocateLargestRemainder(50, [0, 0]), [0, 0], "sem peso não há o que ratear");
  // Valores altos: |total| × peso passa de 2^53 e o rateio continua exato.
  const big = allocateLargestRemainder(99999999999, [999999999999, 333333333333, 1]);
  assert.equal(big.reduce((sum, value) => sum + value, 0), 99999999999);
});

test("percentual em centavos arredonda meio para cima", () => {
  assert.equal(percentOfCents(11571, 5), 579, "578,55 → 579");
  assert.equal(percentOfCents(9643, 10), 964, "964,3 → 964");
  assert.equal(percentOfCents(1005, 10), 101, "100,5 → 101");
  assert.equal(percentOfCents(1000, 12.5), 125);
  assert.equal(percentOfCents(0, 50), 0);
});

test("valor fixo: por item de serviço, × quantidade em produto e limitado à base", () => {
  assert.equal(commissionAmountCents({ baseCents: 19286, rateType: "valor_fixo", rateValue: 30, itemKind: "servico", quantity: 3 }), 3000);
  assert.equal(commissionAmountCents({ baseCents: 19286, rateType: "valor_fixo", rateValue: 250, itemKind: "servico" }), 19286);
  assert.equal(commissionAmountCents({ baseCents: 12000, rateType: "valor_fixo", rateValue: 15, itemKind: "produto", quantity: 2 }), 3000);
  assert.equal(commissionAmountCents({ baseCents: 0, rateType: "valor_fixo", rateValue: 15, itemKind: "produto", quantity: 2 }), 0);
});

test("regra: serviço específico vence o padrão; produto usa o padrão de produtos; inativa é ignorada", () => {
  const rules = [
    { id: 1, scope: "servico_padrao", rate_type: "percentual", rate_value: 10, active: true },
    { id: 2, scope: "servico", service_id: 7, rate_type: "valor_fixo", rate_value: 30, active: true },
    { id: 3, scope: "servico", service_id: 8, rate_type: "valor_fixo", rate_value: 99, active: false },
    { id: 4, scope: "produto_padrao", rate_type: "percentual", rate_value: 5, active: true }
  ];
  assert.equal(resolveCommissionRule(rules, { item_kind: "servico", service_id: 7 }).id, 2);
  assert.equal(resolveCommissionRule(rules, { item_kind: "servico", service_id: 8 }).id, 1);
  assert.equal(resolveCommissionRule(rules, { item_kind: "servico", service_id: null }).id, 1);
  assert.equal(resolveCommissionRule(rules, { item_kind: "produto" }).id, 4);
  assert.equal(resolveCommissionRule([rules[1]], { item_kind: "produto" }), null);
});

test("cálculo do atendimento: desconto e ajuste rateados entre todas as parcelas com soma exata", () => {
  const appointment = { id: 1, professional_id: 9, appointment_date: "2026-09-30", discount_value: 10, adjustment_total: -5 };
  const items = [
    { id: 11, service_id: 1, procedure_price: 100, jewelry_id: 50, jewelry_unit_price: 60, quantity: 2, procedure_name: "Lóbulo", jewelry_name: "Argola" },
    { id: 12, service_id: 2, procedure_price: 200, jewelry_id: null, jewelry_unit_price: 0, quantity: 1, procedure_name: "Hélix" }
  ];
  const rules = [
    { id: 1, scope: "servico_padrao", rate_type: "percentual", rate_value: 10, active: true },
    { id: 2, scope: "servico", service_id: 2, rate_type: "valor_fixo", rate_value: 30, active: true },
    { id: 3, scope: "produto_padrao", rate_type: "percentual", rate_value: 5, active: true }
  ];
  const entries = computeCommissionEntries({ appointment, items, rules, serviceExecutionId: 77 });
  assert.equal(entries.length, 3, "a parcela de produto com bruto 0 não gera lançamento");
  const [serviceA, product, serviceB] = entries;
  assert.deepEqual(
    entries.map((entry) => [entry.item_kind, entry.gross_cents, entry.discount_cents, entry.adjustment_cents, entry.base_cents]),
    [["servico", 10000, 238, -119, 9643], ["produto", 12000, 286, -143, 11571], ["servico", 20000, 476, -238, 19286]]
  );
  assert.equal(entries.reduce((sum, entry) => sum + entry.discount_cents, 0), 1000, "desconto rateado soma o total");
  assert.equal(entries.reduce((sum, entry) => sum + entry.adjustment_cents, 0), -500, "ajuste rateado soma o total");
  assert.equal(entries.reduce((sum, entry) => sum + entry.base_cents, 0), 42000 - 1000 - 500);
  assert.equal(serviceA.commission_cents, 964);
  assert.equal(serviceA.rule_scope, "servico_padrao");
  assert.equal(product.commission_cents, 579);
  assert.equal(product.quantity, 2);
  assert.equal(product.product_id, 50);
  assert.equal(serviceB.commission_cents, 3000);
  assert.equal(serviceB.rule_scope, "servico");
  assert.equal(serviceA.reference_date, "2026-09-30");
  assert.equal(serviceA.service_execution_id, 77);

  // Sem regra de produto, a joia fica sem comissão, mas continua recebendo a
  // sua parte do desconto (as parcelas de serviço não mudam).
  const withoutProduct = computeCommissionEntries({ appointment, items, rules: rules.slice(0, 2) });
  assert.equal(withoutProduct.length, 2);
  assert.equal(withoutProduct[0].base_cents, 9643);

  // Sem itens gravados: um item único sai de service_value/jewelry_value.
  const legacy = computeCommissionEntries({
    appointment: { ...appointment, discount_value: 0, adjustment_total: 0, service_value: 80, jewelry_value: 40, service_id: 3 },
    items: [],
    rules
  });
  assert.deepEqual(legacy.map((entry) => [entry.item_kind, entry.base_cents, entry.commission_cents]), [["servico", 8000, 800], ["produto", 4000, 200]]);
});

test("bruto igual ao oficial: itens sem preço usam as colunas do atendimento; preço negativo vale zero", () => {
  const rules = [
    { id: 1, scope: "servico_padrao", rate_type: "percentual", rate_value: 10, active: true },
    { id: 2, scope: "servico", service_id: 5, rate_type: "valor_fixo", rate_value: 7, active: true }
  ];
  const base = { id: 1, professional_id: 9, appointment_date: "2026-09-30", discount_value: 0, adjustment_total: 0 };
  // Agendamento com itens sem preço (ex.: público) e valor só no atendimento:
  // antes saía sem comissão alguma; o serviço do item ainda escolhe a regra.
  const unpriced = computeCommissionEntries({
    appointment: { ...base, service_value: 150, jewelry_value: 0 },
    items: [{ id: 31, service_id: 5, procedure_price: 0, jewelry_unit_price: 0, quantity: 1 }],
    rules
  });
  assert.deepEqual(unpriced.map((entry) => [entry.item_kind, entry.gross_cents, entry.rule_id, entry.commission_cents]), [["servico", 15000, 2, 700]]);

  // Linha antiga só com líquido: bruto = líquido + desconto − ajuste (como no
  // finance.js), para o desconto não ser abatido duas vezes.
  const onlyTotal = computeCommissionEntries({
    appointment: { ...base, total_value: 90, discount_value: 10, adjustment_total: 0 },
    items: [],
    rules
  });
  assert.deepEqual(onlyTotal.map((entry) => [entry.gross_cents, entry.discount_cents, entry.base_cents, entry.commission_cents]), [[10000, 1000, 9000, 900]]);

  const negative = computeCommissionEntries({
    appointment: { ...base, discount_value: 10 },
    items: [
      { id: 41, service_id: 1, procedure_price: -50, quantity: 1 },
      { id: 42, service_id: 1, procedure_price: 100, quantity: 1 }
    ],
    rules
  });
  assert.deepEqual(negative.map((entry) => [entry.appointment_item_id, entry.gross_cents, entry.discount_cents, entry.base_cents]), [[42, 10000, 1000, 9000]]);
});

test("comparação de conjuntos aceita a linha do banco (reais) contra o esperado (centavos)", () => {
  const appointment = { id: 1, professional_id: 9, appointment_date: "2026-09-30", discount_value: 0, adjustment_total: 0 };
  const items = [{ id: 11, service_id: 1, procedure_price: 100, quantity: 1 }];
  const rules = [{ id: 1, scope: "servico_padrao", rate_type: "percentual", rate_value: 10, active: true }];
  const [expected] = computeCommissionEntries({ appointment, items, rules });
  const stored = {
    ...expected,
    gross_cents: undefined, discount_cents: undefined, adjustment_cents: undefined, base_cents: undefined, rate_cents: undefined, commission_cents: undefined,
    gross_amount: 100, discount_amount: 0, adjustment_amount: 0, base_amount: 100, rate_value: 10, commission_amount: 10
  };
  for (const key of ["gross_cents", "discount_cents", "adjustment_cents", "base_cents", "rate_cents", "commission_cents"]) delete stored[key];
  assert.equal(sameCommissionEntries([expected], [stored]), true);
  assert.equal(sameCommissionEntries([expected], [{ ...stored, commission_amount: 11 }]), false);
  assert.equal(sameCommissionEntries([expected], []), false);
});

test("payload de regras: validações com mensagens em pt-BR", () => {
  assert.match(normalizeCommissionRulesPayload(null).error, /lista/);
  assert.match(normalizeCommissionRulesPayload([{ scope: "x", rate_type: "percentual", rate_value: 1 }]).error, /Escopo/);
  assert.match(normalizeCommissionRulesPayload([{ scope: "servico", rate_type: "percentual", rate_value: 1 }]).error, /serviço/);
  assert.match(normalizeCommissionRulesPayload([{ scope: "servico_padrao", service_id: 3, rate_type: "percentual", rate_value: 1 }]).error, /Somente/);
  assert.match(normalizeCommissionRulesPayload([{ scope: "servico_padrao", rate_type: "percentual", rate_value: 101 }]).error, /entre 0 e 100/);
  assert.match(normalizeCommissionRulesPayload([{ scope: "servico_padrao", rate_type: "percentual", rate_value: -1 }]).error, /maior ou igual/);
  assert.match(normalizeCommissionRulesPayload([{ scope: "servico_padrao", rate_type: "percentual", rate_value: 1.234 }]).error, /duas casas/);
  assert.match(normalizeCommissionRulesPayload([
    { scope: "produto_padrao", rate_type: "percentual", rate_value: 1 },
    { scope: "produto_padrao", rate_type: "valor_fixo", rate_value: 2 }
  ]).error, /repetidas/);
  const ok = normalizeCommissionRulesPayload([{ scope: "servico", service_id: "4", rate_type: "valor_fixo", rate_value: "12,50", notes: "  " }]);
  assert.deepEqual(ok.rules, [{ scope: "servico", service_id: 4, rate_type: "valor_fixo", rate_value: 12.5, active: true, notes: null }]);
});

// ---------------------------------------------------------------- parte 2 ---

const ctx = {};
const HOJE = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
const api = (path, opts = {}) => req(path, { token: ctx.token, tenant: ctx.slug, ...opts });
const sql = (fn) => withTenantSchema(ctx.tenant.id, fn);

async function setPlan(planCode) {
  const response = await api("/subscription", { method: "PATCH", body: { plan_code: planCode } });
  assert.equal(response.status, 200, JSON.stringify(response.json));
}

async function createUser(role, extra = {}) {
  const email = `${role}.${Math.floor(Math.random() * 1e6)}@${ctx.slug}.test`;
  const password = "SenhaForteComissao123";
  const created = await api("/users", { method: "POST", body: { name: `Usuário ${role}`, email, password, role, ...extra } });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  return (await loginTenant(ctx.slug, email, password)).token;
}

async function createCompletedAppointment({ professionalId, time, items, fullName, whatsapp }) {
  const created = await api("/appointments", {
    method: "POST",
    body: {
      full_name: fullName, whatsapp, professional_id: professionalId, service_id: items[0].service_id,
      procedure: "Comissão QA", piercing_region: "Orelha", appointment_date: HOJE, appointment_time: time,
      deposit_value: 0, status: "confirmado", appointment_items: items
    }
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const completed = await api(`/appointments/${created.json.id}/complete`, { method: "POST", body: { payments: [] } });
  assert.equal(completed.status, 200, JSON.stringify(completed.json));
  return created.json.id;
}

async function activeEntries(appointmentId) {
  return sql((db) => db.all("SELECT * FROM commission_entries WHERE appointment_id = ? AND status = 'ativa' ORDER BY id", [appointmentId]));
}

before(async () => {
  const created = await createTenant("qacomm");
  Object.assign(ctx, created);
  ctx.token = (await loginTenant(created.slug, created.adminEmail, created.adminPassword)).token;
  await setPlan("studio");

  const serviceA = await api("/services", { method: "POST", body: { name: "Lóbulo Comissão", duration_minutes: 30, price: 100, deposit_value: 0 } });
  const serviceB = await api("/services", { method: "POST", body: { name: "Hélix Comissão", duration_minutes: 30, price: 200, deposit_value: 0 } });
  assert.equal(serviceA.status, 201, JSON.stringify(serviceA.json));
  assert.equal(serviceB.status, 201, JSON.stringify(serviceB.json));
  ctx.serviceA = serviceA.json.id;
  ctx.serviceB = serviceB.json.id;

  const professional = await api("/professionals", {
    method: "POST",
    body: { name: "Piercer Comissão", specialty: "Piercing", phone: "11977771234", email: "piercer@comissao.test", service_ids: [ctx.serviceA, ctx.serviceB] }
  });
  assert.equal(professional.status, 201, JSON.stringify(professional.json));
  ctx.professionalId = professional.json.id;
  const other = await api("/professionals", { method: "POST", body: { name: "Outra Profissional", phone: "11977774321" } });
  assert.equal(other.status, 201, JSON.stringify(other.json));
  ctx.otherProfessionalId = other.json.id;

  const jewelry = await api("/jewelry", {
    method: "POST",
    body: { name: "Argola Comissão", category: "Argola", material: "Titânio", color: "Prata", quantity: 20, cost_value: 10, sale_value: 60 }
  });
  assert.equal(jewelry.status, 201, JSON.stringify(jewelry.json));
  ctx.jewelryId = jewelry.json.id;
  ctx.variantId = jewelry.json.variants?.[0]?.id || null;
});

after(async () => {
  if (ctx.tenant?.id) await deprovisionTenant(ctx.tenant.id);
});

test("CRUD de profissionais é auditado", async () => {
  const updated = await api(`/professionals/${ctx.otherProfessionalId}`, { method: "PATCH", body: { specialty: "Joias" } });
  assert.equal(updated.status, 200, JSON.stringify(updated.json));
  const events = await sql((db) => db.all(
    "SELECT action, entity_id, before_data, after_data FROM audit_events WHERE module = 'professionals' AND entity_id = ? ORDER BY id",
    [String(ctx.otherProfessionalId)]
  ));
  assert.deepEqual(events.map((event) => event.action), ["create", "update"]);
  assert.equal(events[1].before_data.specialty, "");
  assert.equal(events[1].after_data.specialty, "Joias");
  assert.equal(Array.isArray(events[1].after_data), false, "antes/depois gravados como objeto JSON");
});

test("regras: PUT cria com auditoria, espelha o percentual legado e GET devolve o conjunto", async () => {
  const saved = await api(`/professionals/${ctx.professionalId}/commission-rules`, {
    method: "PUT",
    body: {
      rules: [
        { scope: "servico_padrao", rate_type: "percentual", rate_value: 10 },
        { scope: "servico", service_id: ctx.serviceB, rate_type: "valor_fixo", rate_value: 30, notes: "Hélix paga fixo" },
        { scope: "produto_padrao", rate_type: "percentual", rate_value: 5 }
      ]
    }
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.equal(saved.json.rules.length, 3);
  assert.equal(saved.json.changes.filter((change) => change.action === "rule_create").length, 3);
  assert.ok(saved.json.services.some((service) => Number(service.id) === Number(ctx.serviceB) && service.linked));

  const again = await api(`/professionals/${ctx.professionalId}/commission-rules`, {
    method: "PUT",
    body: { rules: saved.json.rules.map(({ scope, service_id, rate_type, rate_value, active, notes }) => ({ scope, service_id, rate_type, rate_value, active, notes })) }
  });
  assert.equal(again.status, 200, JSON.stringify(again.json));
  assert.equal(again.json.changes.length, 0, "reenviar o mesmo conjunto não gera alteração nem auditoria");

  const fetched = await api(`/professionals/${ctx.professionalId}/commission-rules`);
  assert.equal(fetched.status, 200, JSON.stringify(fetched.json));
  assert.equal(fetched.json.professional.id, ctx.professionalId);
  assert.equal(fetched.json.rules.find((rule) => rule.scope === "servico").service_name, "Hélix Comissão");

  const list = await api("/professionals");
  const row = list.json.find((item) => Number(item.id) === Number(ctx.professionalId));
  assert.equal(Number(row.commission_percentage), 10, "padrão de serviço espelhado na coluna legada");
  assert.deepEqual(row.commission_summary.service_default, { rate_type: "percentual", rate_value: 10 });
  assert.equal(row.commission_summary.service_rules, 1);

  const invalid = await api(`/professionals/${ctx.professionalId}/commission-rules`, {
    method: "PUT",
    body: { rules: [{ scope: "servico", service_id: 999999, rate_type: "percentual", rate_value: 5 }] }
  });
  assert.equal(invalid.status, 400, JSON.stringify(invalid.json));
  const missing = await api("/professionals/999999/commission-rules");
  assert.equal(missing.status, 404, JSON.stringify(missing.json));
});

test("cálculo pela API: percentual, específico > padrão, produto, rateio exato e recálculo idempotente", async () => {
  const appointmentId = await createCompletedAppointment({
    professionalId: ctx.professionalId,
    time: "10:00",
    fullName: "Cliente Comissão Rateio",
    whatsapp: "11966660001",
    items: [
      { service_id: ctx.serviceA, procedure_price: 100, jewelry_id: ctx.jewelryId, jewelry_variant_id: ctx.variantId, jewelry_unit_price: 60, quantity: 2, region: "Lóbulo" },
      { service_id: ctx.serviceB, procedure_price: 200, region: "Hélix" }
    ]
  });
  ctx.appointmentId = appointmentId;
  // Desconto total e ajuste líquido gravados direto: o que se testa aqui é o
  // rateio da comissão, independente de como o atendimento chegou a eles.
  await sql((db) => db.run("UPDATE appointments SET discount_value = 10, adjustment_total = -5 WHERE id = ?", [appointmentId]));

  const first = await api("/commissions/recalculate", { method: "POST", body: { appointment_id: appointmentId, reason: "Desconto aplicado" } });
  assert.equal(first.status, 200, JSON.stringify(first.json));
  assert.equal(first.json.unchanged, false);
  assert.equal(first.json.created, 3);
  const entries = await activeEntries(appointmentId);
  assert.deepEqual(
    entries.map((entry) => [entry.item_kind, entry.rule_scope, entry.gross_amount, entry.discount_amount, entry.adjustment_amount, entry.base_amount, entry.commission_amount]),
    [
      ["servico", "servico_padrao", 100, 2.38, -1.19, 96.43, 9.64],
      ["produto", "produto_padrao", 120, 2.86, -1.43, 115.71, 5.79],
      ["servico", "servico", 200, 4.76, -2.38, 192.86, 30]
    ]
  );
  assert.equal(entries[1].quantity, 2);
  assert.equal(entries[0].reference_date, HOJE);
  assert.equal(entries[0].professional_id, ctx.professionalId);
  assert.ok(entries[0].service_execution_id, "lançamento ligado à execução do atendimento");

  const totalRows = async () => sql(async (db) => Number((await db.get("SELECT COUNT(*)::int AS total FROM commission_entries WHERE appointment_id = ?", [appointmentId])).total));
  const before = await totalRows();
  const second = await api("/commissions/recalculate", { method: "POST", body: { appointment_id: appointmentId } });
  assert.equal(second.status, 200, JSON.stringify(second.json));
  assert.deepEqual([second.json.unchanged, second.json.created, second.json.reversed], [true, 0, 0]);
  assert.equal(await totalRows(), before, "recálculo sem mudança não grava lançamento");

  const statement = await api(`/commissions?appointment_id=${appointmentId}`);
  assert.equal(statement.status, 200, JSON.stringify(statement.json));
  assert.equal(statement.json.items.length, 3);
  assert.deepEqual(
    [statement.json.totals.gross, statement.json.totals.discount, statement.json.totals.adjustment, statement.json.totals.base, statement.json.totals.commission],
    [420, 10, -5, 405, 45.43]
  );
  assert.equal(statement.json.items[0].client_name, "Cliente Comissão Rateio");
});

test("valor fixo acima da base fica limitado à base; mudança de regra só vale com recálculo", async () => {
  const saved = await api(`/professionals/${ctx.professionalId}/commission-rules`, {
    method: "PUT",
    body: {
      reason: "Hélix passa a pagar fixo maior",
      rules: [
        { scope: "servico_padrao", rate_type: "percentual", rate_value: 10 },
        { scope: "servico", service_id: ctx.serviceB, rate_type: "valor_fixo", rate_value: 250, notes: "Hélix paga fixo" },
        { scope: "produto_padrao", rate_type: "percentual", rate_value: 5 }
      ]
    }
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.deepEqual(saved.json.changes.map((change) => change.action), ["rule_update"]);
  const untouched = await activeEntries(ctx.appointmentId);
  assert.equal(untouched.find((entry) => entry.rule_scope === "servico").commission_amount, 30, "regra nova não recalcula o passado sozinha");

  const recalculated = await api("/commissions/recalculate", { method: "POST", body: { appointment_id: ctx.appointmentId, reason: "Aplicar regra nova" } });
  assert.equal(recalculated.status, 200, JSON.stringify(recalculated.json));
  assert.deepEqual([recalculated.json.reversed, recalculated.json.created], [3, 3]);
  const entries = await activeEntries(ctx.appointmentId);
  const helix = entries.find((entry) => entry.rule_scope === "servico");
  assert.equal(helix.commission_amount, 192.86, "fixo de 250,00 limitado à base de 192,86");
  assert.equal(helix.rate_value, 250);
  const reversed = await sql((db) => db.all("SELECT reversal_reason FROM commission_entries WHERE appointment_id = ? AND status = 'estornada'", [ctx.appointmentId]));
  assert.ok(reversed.length >= 3);
  assert.ok(reversed.some((entry) => entry.reversal_reason === "Aplicar regra nova"));
});

test("histórico de regras traz autor, data e antes/depois como objetos", async () => {
  const history = await api(`/professionals/${ctx.professionalId}/commission-rules/history`);
  assert.equal(history.status, 200, JSON.stringify(history.json));
  const actions = history.json.items.map((item) => item.action);
  assert.equal(actions.filter((action) => action === "rule_create").length, 3);
  const update = history.json.items.find((item) => item.action === "rule_update");
  assert.ok(update, JSON.stringify(history.json.items));
  assert.equal(update.before.rate_value, 30);
  assert.equal(update.after.rate_value, 250);
  assert.equal(update.after.service_name, "Hélix Comissão");
  assert.equal(update.reason, "Hélix passa a pagar fixo maior");
  // O cadastro normaliza o nome do usuário (maiúsculas); o que importa é o autor.
  assert.equal(String(update.user_name).toLowerCase(), "administrador qa");
  assert.ok(update.user_id);
  assert.ok(update.created_at);

  // Retirar a regra de produto do conjunto a desativa (nunca apaga).
  const saved = await api(`/professionals/${ctx.professionalId}/commission-rules`, {
    method: "PUT",
    body: {
      rules: [
        { scope: "servico_padrao", rate_type: "percentual", rate_value: 10 },
        { scope: "servico", service_id: ctx.serviceB, rate_type: "valor_fixo", rate_value: 250, notes: "Hélix paga fixo" }
      ]
    }
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.deepEqual(saved.json.changes.map((change) => change.action), ["rule_deactivate"]);
  assert.equal(saved.json.rules.find((rule) => rule.scope === "produto_padrao").active, false);
  // Restaura para os testes seguintes.
  const restored = await api(`/professionals/${ctx.professionalId}/commission-rules`, {
    method: "PUT",
    body: {
      rules: [
        { scope: "servico_padrao", rate_type: "percentual", rate_value: 10 },
        { scope: "servico", service_id: ctx.serviceB, rate_type: "valor_fixo", rate_value: 250, notes: "Hélix paga fixo" },
        { scope: "produto_padrao", rate_type: "percentual", rate_value: 5 }
      ]
    }
  });
  assert.equal(restored.status, 200, JSON.stringify(restored.json));
});

test("view_own vê só o próprio profissional; sem permissão de comissão → 403 e sem percentual na lista", async () => {
  await api(`/professionals/${ctx.otherProfessionalId}/commission-rules`, {
    method: "PUT",
    body: { rules: [{ scope: "servico_padrao", rate_type: "percentual", rate_value: 20 }] }
  });
  const otherAppointment = await createCompletedAppointment({
    professionalId: ctx.otherProfessionalId,
    time: "11:00",
    fullName: "Cliente Outra Profissional",
    whatsapp: "11966660002",
    items: [{ service_id: ctx.serviceA, procedure_price: 100, region: "Lóbulo" }]
  });
  const recalculated = await api("/commissions/recalculate", { method: "POST", body: { appointment_id: otherAppointment } });
  assert.equal(recalculated.status, 200, JSON.stringify(recalculated.json));
  assert.equal((await activeEntries(otherAppointment))[0].commission_amount, 20);

  const ownToken = await createUser("piercer", {
    professional_id: ctx.professionalId,
    permission_overrides: [{ permission: "commission.view_own", allowed: true }]
  });
  const own = await api(`/commissions?professional_id=${ctx.otherProfessionalId}&status=todas`, { token: ownToken });
  assert.equal(own.status, 200, JSON.stringify(own.json));
  assert.equal(own.json.scope, "own");
  assert.ok(own.json.items.length > 0);
  assert.ok(own.json.items.every((item) => Number(item.professional_id) === Number(ctx.professionalId)), "filtro forçado no profissional do usuário");
  assert.equal((await api(`/professionals/${ctx.professionalId}/commission-rules`, { token: ownToken })).status, 200);
  assert.equal((await api(`/professionals/${ctx.otherProfessionalId}/commission-rules`, { token: ownToken })).status, 403);
  assert.equal((await api(`/professionals/${ctx.professionalId}/commission-rules`, { token: ownToken, method: "PUT", body: { rules: [] } })).status, 403);
  assert.equal((await api("/commissions/recalculate", { token: ownToken, method: "POST", body: { appointment_id: otherAppointment } })).status, 403);

  const all = await api("/commissions?status=ativa");
  assert.equal(all.json.scope, "all");
  assert.ok(all.json.items.some((item) => Number(item.professional_id) === Number(ctx.otherProfessionalId)));

  const receptionToken = await createUser("reception");
  const denied = await api("/commissions", { token: receptionToken });
  assert.equal(denied.status, 403, JSON.stringify(denied.json));
  assert.equal((await api(`/professionals/${ctx.professionalId}/commission-rules`, { token: receptionToken })).status, 403);
  const hidden = await api("/professionals", { token: receptionToken });
  assert.equal(hidden.status, 200, JSON.stringify(hidden.json));
  for (const professional of hidden.json) {
    assert.equal(Object.hasOwn(professional, "commission_percentage"), false, "percentual de comissão não vaza para quem não vê comissão");
    assert.equal(Object.hasOwn(professional, "commission_summary"), false);
  }

  const financeToken = await createUser("finance");
  const visible = await api("/professionals", { token: financeToken });
  assert.equal(visible.status, 200, JSON.stringify(visible.json));
  const row = visible.json.find((item) => Number(item.id) === Number(ctx.professionalId));
  assert.equal(Number(row.commission_percentage), 10);
  assert.ok(row.commission_summary);
  assert.equal((await api("/commissions", { token: financeToken })).json.scope, "all");
});

test("reabrir o atendimento estorna os lançamentos ativos", async () => {
  const reopened = await api(`/appointments/${ctx.appointmentId}`, { method: "PATCH", body: { status: "confirmado", reason: "Reabertura para correção" } });
  assert.equal(reopened.status, 200, JSON.stringify(reopened.json));
  // Com o gancho do BE-DINHEIRO o estorno já aconteceu na reabertura; sem ele,
  // o recálculo faz o mesmo. O estado final é idêntico nos dois casos.
  const recalculated = await api("/commissions/recalculate", { method: "POST", body: { appointment_id: ctx.appointmentId, reason: "Reabertura" } });
  assert.equal(recalculated.status, 200, JSON.stringify(recalculated.json));
  assert.equal(recalculated.json.created, 0);
  assert.equal((await activeEntries(ctx.appointmentId)).length, 0);
  const reversed = await sql((db) => db.all("SELECT status, reversed_at FROM commission_entries WHERE appointment_id = ?", [ctx.appointmentId]));
  assert.ok(reversed.length >= 6);
  assert.ok(reversed.every((entry) => entry.status === "estornada" && entry.reversed_at));
  const statement = await api(`/commissions?appointment_id=${ctx.appointmentId}&status=estornada`);
  assert.equal(statement.status, 200, JSON.stringify(statement.json));
  assert.equal(statement.json.items.length, reversed.length);
});

test("serviço apagado que só estava no item não derruba o recálculo (id órfão vira nulo)", async () => {
  const extra = await api("/services", { method: "POST", body: { name: "Serviço Temporário Comissão", duration_minutes: 30, price: 80, deposit_value: 0 } });
  assert.equal(extra.status, 201, JSON.stringify(extra.json));
  const appointmentId = await createCompletedAppointment({
    professionalId: ctx.professionalId,
    time: "13:00",
    fullName: "Cliente Serviço Apagado",
    whatsapp: "11966660003",
    items: [
      { service_id: ctx.serviceA, procedure_price: 100, region: "Lóbulo" },
      { service_id: extra.json.id, procedure_price: 80, region: "Nostril" }
    ]
  });
  // A rota agora arquiva serviço usado em item de atendimento (não apaga).
  const removed = await api(`/services/${extra.json.id}`, { method: "DELETE" });
  assert.equal(removed.status, 200, JSON.stringify(removed.json));
  assert.equal(removed.json.archived, true, JSON.stringify(removed.json));
  // Dado legado (apagado antes dessa regra): appointment_items.service_id não
  // tem FK, então o item fica apontando para um id inexistente, enquanto
  // commission_entries.service_id tem FK.
  await sql((db) => db.run("DELETE FROM services WHERE id = ?", [extra.json.id]));
  await sql((db) => db.run("UPDATE commission_entries SET status = 'estornada', reversed_at = now(), reversal_reason = 'teste' WHERE appointment_id = ? AND status = 'ativa'", [appointmentId]));

  const recalculated = await api("/commissions/recalculate", { method: "POST", body: { appointment_id: appointmentId } });
  assert.equal(recalculated.status, 200, JSON.stringify(recalculated.json));
  const entries = await activeEntries(appointmentId);
  assert.deepEqual(entries.map((entry) => [entry.service_id, entry.base_amount, entry.commission_amount]), [[ctx.serviceA, 100, 10], [null, 80, 8]]);
});

test("profissional com lançamentos/execuções de atendimento já transferido é arquivado (não 500); auditoria nomeia o serviço", async () => {
  const temp = await api("/professionals", { method: "POST", body: { name: "Profissional Temporária", phone: "11977775555", service_ids: [ctx.serviceA] } });
  assert.equal(temp.status, 201, JSON.stringify(temp.json));
  const tempId = temp.json.id;
  const rulesUrl = `/professionals/${tempId}/commission-rules`;
  const first = await api(rulesUrl, {
    method: "PUT",
    body: { rules: [
      { scope: "servico_padrao", rate_type: "percentual", rate_value: 10 },
      { scope: "servico", service_id: ctx.serviceA, rate_type: "valor_fixo", rate_value: 12 }
    ] }
  });
  assert.equal(first.status, 200, JSON.stringify(first.json));
  // A regra por serviço fica fora do conjunto: desativada, e a auditoria
  // ainda diz de qual serviço era.
  const second = await api(rulesUrl, { method: "PUT", body: { rules: [{ scope: "servico_padrao", rate_type: "percentual", rate_value: 10 }] } });
  assert.equal(second.status, 200, JSON.stringify(second.json));
  const history = await api(`${rulesUrl}/history`);
  const deactivated = history.json.items.find((item) => item.action === "rule_deactivate");
  assert.equal(deactivated?.before?.service_name, "Lóbulo Comissão", JSON.stringify(history.json.items));

  const appointmentId = await createCompletedAppointment({
    professionalId: tempId,
    time: "14:00",
    fullName: "Cliente Troca Profissional",
    whatsapp: "11966660004",
    items: [{ service_id: ctx.serviceA, procedure_price: 100, region: "Lóbulo" }]
  });
  assert.equal((await api("/commissions/recalculate", { method: "POST", body: { appointment_id: appointmentId } })).status, 200);
  // O atendimento passa para outra profissional e é recalculado: os
  // lançamentos estornados (e a execução, se não ressincronizada) continuam
  // apontando para a temporária.
  await sql((db) => db.run("UPDATE appointments SET professional_id = ? WHERE id = ?", [ctx.otherProfessionalId, appointmentId]));
  assert.equal((await api("/commissions/recalculate", { method: "POST", body: { appointment_id: appointmentId } })).status, 200);
  const stale = await sql((db) => db.get("SELECT COUNT(*)::int AS total FROM commission_entries WHERE professional_id = ?", [tempId]));
  assert.ok(stale.total > 0);

  const removed = await api(`/professionals/${tempId}`, { method: "DELETE" });
  assert.equal(removed.status, 200, JSON.stringify(removed.json));
  assert.equal(removed.json.archived, true);
  assert.equal((await api("/professionals/abc", { method: "DELETE" })).status, 404);
  assert.equal((await api("/professionals/abc", { method: "PATCH", body: { name: "X" } })).status, 404);
  assert.equal((await api("/professionals/999999", { method: "DELETE" })).status, 404);
});

test("GET /api/booking/config devolve só colunas públicas dos profissionais", async () => {
  const config = await req("/booking/config", { tenant: ctx.slug });
  assert.equal(config.status, 200, JSON.stringify(config.json));
  const professional = config.json.professionals.find((item) => Number(item.id) === Number(ctx.professionalId));
  assert.ok(professional, JSON.stringify(config.json.professionals));
  assert.deepEqual(Object.keys(professional).sort(), ["calendar_color", "id", "name", "photo_url", "service_ids", "specialty"]);
  for (const sensitive of ["commission_percentage", "email", "phone", "whatsapp"]) {
    assert.equal(Object.hasOwn(professional, sensitive), false, `${sensitive} não pode sair na rota pública`);
  }
});

test("plano sem o recurso de comissões bloqueia regras, extrato e recálculo", async () => {
  await setPlan("profissional");
  try {
    for (const [path, options] of [
      ["/commissions", {}],
      [`/professionals/${ctx.professionalId}/commission-rules`, {}],
      [`/professionals/${ctx.professionalId}/commission-rules/history`, {}],
      [`/professionals/${ctx.professionalId}/commission-rules`, { method: "PUT", body: { rules: [] } }],
      ["/commissions/recalculate", { method: "POST", body: { appointment_id: ctx.appointmentId } }]
    ]) {
      const response = await api(path, options);
      assert.equal(response.status, 403, `${path}: ${JSON.stringify(response.json)}`);
      assert.equal(response.json.code, "plan_upgrade_required");
    }
    const list = await api("/professionals");
    assert.equal(list.status, 200, JSON.stringify(list.json));
    assert.ok(list.json.every((item) => !Object.hasOwn(item, "commission_summary")), "resumo de comissão só com o recurso do plano");
  } finally {
    await setPlan("studio");
  }
});
