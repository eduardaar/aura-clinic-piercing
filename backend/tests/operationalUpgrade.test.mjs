import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createTenant, loginTenant, req } from "./helpers.mjs";
import { deprovisionTenant } from "../src/services/tenants.js";
import { withTenantSchema } from "../src/db/tenantSession.js";
import { applyConfiguredCardFee, normalizeCardFeeTable } from "../src/services/cardFees.js";
import { localDate } from "../src/services/utils.js";
import { loadMigrations } from "../src/db/migrations.js";

let clinic,
  token,
  materials = [],
  serviceId,
  professionalId,
  clientId,
  appointmentId;
const api = (path, options = {}) => req(path, { tenant: clinic.slug, token, ...options });
before(async () => {
  clinic = await createTenant("qa-operational-upgrade");
  token = (await loginTenant(clinic.slug, clinic.adminEmail, clinic.adminPassword)).token;
});
after(async () => {
  if (clinic) await deprovisionTenant(clinic.tenant.id);
});

test("energia futura permanece pendente, pagamento posterior é idempotente e não altera estoque", async () => {
  const today = localDate();
  const future = localDate(new Date(Date.now() + 14 * 86400000));
  const stockBefore = await withTenantSchema(clinic.tenant.id, (db) =>
    db.get("SELECT COUNT(*) AS count,COALESCE(SUM(quantity),0) AS quantity FROM jewelry_inventory"),
  );
  const ids = [];
  for (const [category, amount] of [
    ["Energia elétrica", 250],
    ["Aluguel", 1500],
    ["Água", 80],
    ["Internet e telefone", 120],
  ]) {
    const created = await api("/finance/entries", {
      method: "POST",
      body: {
        entry_type: "payable",
        description: `${category} QA`,
        category,
        amount,
        due_date: future,
        competence_date: today,
        payment_method: "Pix",
        idempotency_key: `expense-${category}`,
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    ids.push(created.json[0].id);
  }
  let ledger = await api(`/finance/ledger?from=${today}&to=${future}&date_field=due_date`);
  assert.equal(ledger.json.entries.filter((row) => ids.includes(row.id)).length, 4);
  assert.equal(Number(ledger.json.cashflow.paid), 0);
  const payment = {
    amount: 250,
    paid_at: today,
    payment_method: "dinheiro",
    notes: "Conferência QA",
    idempotency_key: "energy-paid-once",
  };
  for (let i = 0; i < 2; i++)
    assert.equal((await api(`/finance/entries/${ids[0]}/payments`, { method: "POST", body: payment })).status, 200);
  const detail = await api(`/finance/entries/${ids[0]}/details`);
  assert.equal(detail.json.status, "paid");
  assert.equal(detail.json.paid_at, today);
  assert.equal(detail.json.payments.length, 1);
  ledger = await api(`/finance/ledger?from=${today}&to=${future}&date_field=due_date`);
  assert.equal(Number(ledger.json.cashflow.paid), 250);
  assert.equal(Number(ledger.json.payable), 1700);
  const stockAfter = await withTenantSchema(clinic.tenant.id, (db) =>
    db.get("SELECT COUNT(*) AS count,COALESCE(SUM(quantity),0) AS quantity FROM jewelry_inventory"),
  );
  assert.deepEqual(stockAfter, stockBefore);
});

test("vencimento reagendado volta a pendente automaticamente", async () => {
  const past = localDate(new Date(Date.now() - 86400000));
  const future = localDate(new Date(Date.now() + 14 * 86400000));
  const created = await api("/finance/entries", {
    method: "POST",
    body: { entry_type: "payable", description: "Conta com vencimento ajustado", amount: 80, due_date: past },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const id = created.json[0].id;
  let ledger = await api("/finance/ledger?from=&to=");
  assert.equal(ledger.json.entries.find((row) => row.id === id).status, "overdue");
  const changed = await api(`/finance/entries/${id}`, { method: "PATCH", body: { due_date: future } });
  assert.equal(changed.status, 200, JSON.stringify(changed.json));
  ledger = await api("/finance/ledger?from=&to=");
  assert.equal(ledger.json.entries.find((row) => row.id === id).status, "pending");
});

test("kit de quatro materiais limita 100 atendimentos e a finalização baixa uma vez os componentes e variações", async () => {
  for (const name of ["Gaze", "Cotonete", "Embalagem", "Wrap"]) {
    const item = await api("/jewelry", {
      method: "POST",
      body: {
        name,
        category: "Materiais de consumo",
        item_classification: "material",
        can_sell: false,
        can_use_in_service: true,
        can_publish: false,
        stock_unit: "unidade",
        purchase_unit: "pacote",
        purchase_to_stock_factor: 100,
        variants: [{ variation_name: "Unidade", quantity: 100, cost_value: 1, sale_value: 0 }],
      },
    });
    assert.equal(item.status, 201, JSON.stringify(item.json));
    materials.push(item.json);
  }
  const professional = await api("/professionals", { method: "POST", body: { name: "Profissional QA" } });
  professionalId = professional.json.id;
  const service = await api("/services", {
    method: "POST",
    body: {
      name: "Procedimento com kit",
      price: 100,
      duration_minutes: 30,
      deposit_value: 0,
      inventory_kit_name: "Kit individual",
      professional_ids: [professionalId],
      inventory_items: materials.map((item) => ({
        inventory_item_id: item.id,
        inventory_variant_id: item.variants[0].id,
        quantity: 1,
        is_required: true,
        usage_stage: "procedure",
        auto_consume: true,
      })),
    },
  });
  assert.equal(service.status, 201, JSON.stringify(service.json));
  serviceId = service.json.id;
  const client = await api("/clients", { method: "POST", body: { full_name: "Cliente QA", whatsapp: "11999996666" } });
  clientId = client.json.id;
  let kits = await api("/inventory/kits");
  assert.equal(kits.status, 200, JSON.stringify(kits.json));
  assert.equal(kits.json[0].available_kits, 100);
  assert.equal(kits.json[0].cost_value, 4);
  const options = await api("/service-catalog-options");
  const option = options.json.inventoryItems.find((row) => row.id === materials[0].id);
  assert.equal(option.quantity, 100);
  assert.equal(option.cost_value, 1);
  assert.equal(option.variants[0].id, materials[0].variants[0].id);
  const appointment = await api("/appointments", {
    method: "POST",
    body: {
      client_id: clientId,
      professional_id: professionalId,
      service_id: serviceId,
      procedure: "Procedimento com kit",
      piercing_region: "Helix",
      appointment_date: localDate(new Date(Date.now() + 86400000)),
      appointment_time: "10:00",
      total_value: 100,
      deposit_value: 0,
      status: "confirmado",
    },
  });
  assert.equal(appointment.status, 201, JSON.stringify(appointment.json));
  appointmentId = appointment.json.id;
  const preview = await api(`/appointments/${appointmentId}/materials`);
  assert.equal(preview.json.items.length, 4);
  const consumed = preview.json.items.map(({ inventory_item_id }) => ({ inventory_item_id, quantity: 1 }));
  let completed = await api(`/appointments/${appointmentId}/complete`, {
    method: "POST",
    body: { payments: [], material_consumption: consumed },
  });
  assert.equal(completed.status, 200, JSON.stringify(completed.json));
  completed = await api(`/appointments/${appointmentId}/complete`, {
    method: "POST",
    body: { payments: [], material_consumption: consumed, reason: "Conferência sem nova baixa" },
  });
  assert.equal(completed.status, 200, JSON.stringify(completed.json));
  kits = await api("/inventory/kits");
  assert.equal(kits.json[0].available_kits, 99);
  await withTenantSchema(clinic.tenant.id, async (db) => {
    for (const item of materials) {
      assert.equal(Number((await db.get("SELECT quantity FROM jewelry_inventory WHERE id=?", [item.id])).quantity), 99);
      assert.equal(
        Number((await db.get("SELECT quantity FROM jewelry_variants WHERE id=?", [item.variants[0].id])).quantity),
        99,
      );
    }
    assert.equal(
      Number(
        (
          await db.get(
            "SELECT COUNT(*) AS count FROM appointment_consumptions WHERE appointment_id=? AND reversed_at IS NULL",
            [appointmentId],
          )
        ).count,
      ),
      4,
    );
  });
  const report = await api(`/reports/material_consumption?from=2000-01-01&to=2099-12-31`);
  assert.equal(report.status, 200, JSON.stringify(report.json));
  assert.equal(report.json.rows.length, 4);
});

test("compra de um pacote com 100 unidades converte estoque e custo sem duplicar confirmação", async () => {
  const supplier = await api("/finance/suppliers", { method: "POST", body: { name: "Fornecedor QA" } });
  const body = {
    supplier_id: supplier.json.id,
    purchase_date: localDate(),
    first_due_date: localDate(),
    installment_count: 1,
    idempotency_key: "pack-100",
    items: [
      {
        product_id: materials[0].id,
        product_variant_id: materials[0].variants[0].id,
        quantity: 1,
        unit_cost: 50,
        stock_conversion_factor: 100,
        purchase_unit: "pacote",
      },
    ],
  };
  const purchased = await api("/purchases", { method: "POST", body });
  assert.equal(purchased.status, 201, JSON.stringify(purchased.json));
  assert.equal((await api(`/purchases/${purchased.json.id}/confirm`, { method: "POST", body: {} })).status, 200);
  const item = await api(`/jewelry?search=Gaze`);
  const row = (item.json.items || item.json).find((row) => row.id === materials[0].id);
  assert.equal(Number(row.quantity), 199);
  assert.equal(Number(row.cost_value), 0.75);
  assert.equal(Number(purchased.json.total_value), 50);
  const legacyCategory = await api("/jewelry", {
    method: "POST",
    body: { name: "Argola de teste", category: "Argola", quantity: 1, cost_value: 5, sale_value: 15 },
  });
  assert.equal(legacyCategory.status, 201, JSON.stringify(legacyCategory.json));
  assert.equal(legacyCategory.json.category, "Argolas");
});

test("consolidação de categorias preserva movimentos, compras e vínculos dos materiais", async () => {
  await withTenantSchema(clinic.tenant.id, async (db) => {
    const before = await db.get(
      "SELECT (SELECT COUNT(*) FROM stock_movements) AS movements,(SELECT COUNT(*) FROM purchase_order_items) AS purchases,(SELECT SUM(quantity) FROM jewelry_inventory) AS quantity",
    );
    const official = await db.get(
      "SELECT id FROM inventory_options WHERE type='category' AND name='Materiais de consumo'",
    );
    const duplicate = await db.run(
      "INSERT INTO inventory_options(type,name,is_active,usage_scope) VALUES('category','Material de consumo',1,'material') RETURNING id",
    );
    await db.run("UPDATE jewelry_inventory SET category='Material de consumo',category_id=? WHERE id=?", [
      duplicate.returnedId,
      materials[0].id,
    ]);
    await db.run(loadMigrations("tenant").find((row) => row.version === "0051").sql);
    const after = await db.get(
      "SELECT (SELECT COUNT(*) FROM stock_movements) AS movements,(SELECT COUNT(*) FROM purchase_order_items) AS purchases,(SELECT SUM(quantity) FROM jewelry_inventory) AS quantity",
    );
    assert.deepEqual(after, before);
    const item = await db.get("SELECT category,category_id FROM jewelry_inventory WHERE id=?", [materials[0].id]);
    assert.equal(item.category_id, official.id);
    assert.equal(item.category, "Materiais de consumo");
    assert.equal(
      (await db.get("SELECT is_active FROM inventory_options WHERE id=?", [duplicate.returnedId])).is_active,
      0,
    );
    assert.equal(
      (
        await db.get("SELECT moved_items FROM inventory_category_consolidations WHERE source_category_id=?", [
          duplicate.returnedId,
        ])
      ).moved_items,
      1,
    );
  });
});

test("reabertura estorna o consumo anterior e aceita correção sem baixar em duplicidade", async () => {
  const opened = await api(`/appointments/${appointmentId}`, {
    method: "PATCH",
    body: { status: "confirmado", reason: "Conferir consumo do kit" },
  });
  assert.equal(opened.status, 200, JSON.stringify(opened.json));
  // Gaze has also received a package of 100 units; the earlier consumption returns.
  const before = await withTenantSchema(clinic.tenant.id, (db) =>
    db.get("SELECT quantity FROM jewelry_inventory WHERE id=?", [materials[0].id]),
  );
  assert.equal(Number(before.quantity), 200);
  const actual = materials.map((item, index) => ({ inventory_item_id: item.id, quantity: index === 0 ? 2 : 1 }));
  const completed = await api(`/appointments/${appointmentId}/complete`, {
    method: "POST",
    body: { payments: [], material_consumption: actual },
  });
  assert.equal(completed.status, 200, JSON.stringify(completed.json));
  const after = await withTenantSchema(clinic.tenant.id, (db) =>
    db.get("SELECT quantity FROM jewelry_inventory WHERE id=?", [materials[0].id]),
  );
  assert.equal(Number(after.quantity), 198);
});

test("estoque insuficiente cancela todas as baixas da tentativa de finalização", async () => {
  const appointment = await api("/appointments", {
    method: "POST",
    body: {
      client_id: clientId,
      professional_id: professionalId,
      service_id: serviceId,
      procedure: "Kit",
      piercing_region: "Lobulo",
      appointment_date: localDate(new Date(Date.now() + 2 * 86400000)),
      appointment_time: "11:00",
      total_value: 100,
      status: "confirmado",
    },
  });
  assert.equal(appointment.status, 201, JSON.stringify(appointment.json));
  const failed = await api(`/appointments/${appointment.json.id}/complete`, {
    method: "POST",
    body: {
      payments: [],
      material_consumption: materials.map((item, index) => ({
        inventory_item_id: item.id,
        quantity: index === 1 ? 10000 : 1,
      })),
    },
  });
  assert.equal(failed.status, 400, JSON.stringify(failed.json));
  const state = await withTenantSchema(clinic.tenant.id, async (db) => ({
    stock: await db.get("SELECT quantity FROM jewelry_inventory WHERE id=?", [materials[0].id]),
    count: await db.get("SELECT COUNT(*) AS n FROM appointment_consumptions WHERE appointment_id=?", [
      appointment.json.id,
    ]),
  }));
  assert.equal(Number(state.stock.quantity), 198);
  assert.equal(Number(state.count.n), 0);
});

test("opcionais não confirmados e reutilizáveis não têm baixa automática", async () => {
  const service = await api("/services", {
    method: "POST",
    body: {
      name: "Kit opcional",
      price: 10,
      duration_minutes: 20,
      deposit_value: 0,
      professional_ids: [professionalId],
      inventory_items: [
        { inventory_item_id: materials[0].id, quantity: 1, is_required: false },
        { inventory_item_id: materials[1].id, quantity: 1, usage_stage: "reusable" },
      ],
    },
  });
  assert.equal(service.status, 201, JSON.stringify(service.json));
  const appointment = await api("/appointments", {
    method: "POST",
    body: {
      client_id: clientId,
      professional_id: professionalId,
      service_id: service.json.id,
      procedure: "Kit opcional",
      piercing_region: "Lobulo",
      appointment_date: localDate(new Date(Date.now() + 3 * 86400000)),
      appointment_time: "11:00",
      total_value: 10,
      status: "confirmado",
    },
  });
  assert.equal(appointment.status, 201, JSON.stringify(appointment.json));
  const completed = await api(`/appointments/${appointment.json.id}/complete`, {
    method: "POST",
    body: { payments: [] },
  });
  assert.equal(completed.status, 200, JSON.stringify(completed.json));
  const count = await withTenantSchema(clinic.tenant.id, (db) =>
    db.get("SELECT COUNT(*) AS n FROM appointment_consumptions WHERE appointment_id=?", [appointment.json.id]),
  );
  assert.equal(Number(count.n), 0);
});

test("taxas independentes de 1x a 12x são aplicadas e versões novas preservam o pagamento anterior", async () => {
  const body = {
    operator_name: "Maquininha QA",
    valid_from: localDate(),
    debit_percent: 1.5,
    credit_rates: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, i + 2])),
  };
  const created = await api("/finance/card-fees", { method: "POST", body });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const tableId = created.json.id;
  await withTenantSchema(clinic.tenant.id, async (db) => {
    for (let count = 1; count <= 12; count++) {
      const payment = await applyConfiguredCardFee(db, {
        amount: 100,
        method: "cartão de crédito",
        installments: count,
        card_fee_table_id: tableId,
      });
      assert.equal(payment.fee_amount, count + 1);
      assert.equal(payment.card_fee_snapshot.net_amount, 99 - count);
    }
    const debit = await applyConfiguredCardFee(db, {
      amount: 100,
      method: "cartão de débito",
      installments: 1,
      card_fee_table_id: tableId,
    });
    assert.equal(debit.fee_amount, 1.5);
  });
  const complete = await api(`/appointments/${appointmentId}/complete`, {
    method: "POST",
    body: {
      payments: [{ amount: 100, method: "cartão de crédito", installments: 3, card_fee_table_id: tableId }],
      reason: "Recebimento no cartão",
    },
  });
  assert.equal(complete.status, 200, JSON.stringify(complete.json));
  await api("/finance/card-fees", {
    method: "POST",
    body: { ...body, credit_rates: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, 20])) },
  });
  await withTenantSchema(clinic.tenant.id, async (db) => {
    const saved = await db.get(
      "SELECT * FROM payments WHERE appointment_id=? AND payment_type='restante' AND status='pago'",
      [appointmentId],
    );
    assert.equal(Number(saved.fee_amount), 4);
    assert.equal(Number(saved.net_amount), 96);
    assert.equal(saved.card_fee_snapshot.percent, 4);
  });
  assert.throws(() => normalizeCardFeeTable({ ...body, credit_rates: {} }));
  const pendingPayment = await withTenantSchema(clinic.tenant.id, (db) =>
    db.run(
      "INSERT INTO payments(client_id,amount,payment_type,method,status,installments,card_fee_table_id,expected_receipt_date) VALUES(?,100,'recebimento','cartão de crédito','pendente',2,?,CURRENT_DATE) RETURNING id",
      [clientId, tableId],
    ),
  );
  const ledger = await api("/finance/ledger?from=&to=");
  const title = ledger.json.entries.find(
    (row) => row.source_type === "payment" && Number(row.source_id) === pendingPayment.returnedId,
  );
  assert.ok(title, "o recebimento pendente deve estar no financeiro");
  const received = await api(`/finance/entries/${title.id}`, { method: "PATCH", body: { paid_amount: 100 } });
  assert.equal(received.status, 200, JSON.stringify(received.json));
  await withTenantSchema(clinic.tenant.id, async (db) => {
    const payment = await db.get("SELECT * FROM payments WHERE id=?", [pendingPayment.returnedId]);
    assert.equal(payment.fee_amount, 3);
    assert.equal(payment.net_amount, 97);
    assert.equal(payment.card_fee_snapshot.percent, 3);
  });
});
