import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createTenant, loginTenant, req } from "./helpers.mjs";
import { deprovisionTenant } from "../src/services/tenants.js";
import { withTenantSchema } from "../src/db/tenantSession.js";
import { localDate } from "../src/services/utils.js";

let clinic, token, bank, cash, client, appointment;
const api = (path, options = {}) => req(path, { tenant: clinic.slug, token, ...options });
const post = (path, body) => api(path, { method: "POST", body });
const patch = (path, body) => api(path, { method: "PATCH", body });
const balances = async () => new Map((await api("/finance/accounts")).json.map((row) => [row.id, Number(row.balance)]));

before(async () => {
  clinic = await createTenant("qa-accounts");
  token = (await loginTenant(clinic.slug, clinic.adminEmail, clinic.adminPassword)).token;
  for (const [name, kind, opening_balance] of [["Banco QA", "bank", 1000], ["Balcão QA", "cash", 100]]) {
    const created = await post("/finance/accounts", { name, kind, opening_balance, opening_date: localDate() });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    if (kind === "bank") bank = created.json.id; else cash = created.json.id;
  }
});
after(async () => { if (clinic) await deprovisionTenant(clinic.tenant.id); });

test("pendências não alteram saldos; pagamentos parciais por duas contas e recebimento manual entram uma única vez", async () => {
  const payable = await post("/finance/entries", { entry_type: "payable", description: "Compra pendente QA", amount: 200,
    due_date: localDate(), financial_account_id: bank, idempotency_key: "payable-account" });
  assert.equal(payable.status, 201, JSON.stringify(payable.json));
  assert.equal((await balances()).get(bank), 1000);
  const entryId = payable.json[0].id;
  for (const [amount, account] of [[30, cash], [70, bank]]) {
    const body = { amount, financial_account_id: account, paid_at: localDate(), payment_method: "Pix", idempotency_key: `pay-${account}` };
    for (let count = 0; count < 2; count++) {
      const paid = await post(`/finance/entries/${entryId}/payments`, body);
      assert.equal(paid.status, 200, JSON.stringify(paid.json));
    }
  }
  assert.equal((await balances()).get(bank), 930);
  assert.equal((await balances()).get(cash), 70);
  const income = await post("/finance/entries", { entry_type: "receivable", description: "Receita manual QA", amount: 50,
    status: "paid", due_date: localDate(), financial_account_id: bank, idempotency_key: "income-account" });
  assert.equal(income.status, 201, JSON.stringify(income.json));
  assert.equal((await balances()).get(bank), 980);
});

test("transferência preserva saldo total, é idempotente e estorno mantém histórico imutável", async () => {
  const transfer = { from_account_id: bank, to_account_id: cash, amount: 100, kind: "transfer", movement_date: localDate(), description: "Troco para balcão", idempotency_key: "transfer-once" };
  const created = await post("/finance/account-movements", transfer);
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal((await post("/finance/account-movements", transfer)).json.id, created.json.id);
  const mismatch = await post("/finance/account-movements", { ...transfer, amount: 200 });
  assert.equal(mismatch.status, 409);
  assert.equal((await balances()).get(bank), 880);
  assert.equal((await balances()).get(cash), 170);
  const reversed = await post(`/finance/account-movements/${created.json.id}/reverse`, { reason: "Troco devolvido" });
  assert.equal(reversed.status, 200, JSON.stringify(reversed.json));
  assert.equal((await post(`/finance/account-movements/${created.json.id}/reverse`, { reason: "Repetição" })).json.id, reversed.json.id);
  assert.equal((await balances()).get(bank), 980);
  assert.equal((await balances()).get(cash), 70);
  await assert.rejects(withTenantSchema(clinic.tenant.id, (db) => db.run("DELETE FROM financial_account_movements WHERE id=?", [created.json.id])), /imutáveis/);
  const history = await api(`/finance/account-movements?account_id=${bank}`);
  assert.equal(history.status, 200, JSON.stringify(history.json));
  assert.equal(history.json.total, 4);
});

test("cartão em 12x mostra repasse, registra taxa como despesa e não duplica ao refinalizar", async () => {
  const rate = await post("/finance/card-fees", { operator_name: "InfinitePay QA", valid_from: localDate(), debit_percent: 1.37,
    credit_rates: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, 10])), fee_policy: "studio" });
  assert.equal(rate.status, 201, JSON.stringify(rate.json));
  const service = await post("/services", { name: "Atendimento QA contas", duration_minutes: 30, price: 100, deposit_value: 0 });
  const professional = await post("/professionals", { name: "Profissional contas", service_ids: [service.json.id] });
  const customer = await post("/clients", { full_name: "Cliente contas", whatsapp: "11998765432" });
  client = customer.json.id;
  const booked = await post("/appointments", { client_id: client, professional_id: professional.json.id, service_id: service.json.id,
    appointment_date: localDate(), appointment_time: "09:00", total_value: 100, status: "confirmado", procedure: "Atendimento QA contas", piercing_region: "Orelha" });
  assert.equal(booked.status, 201, JSON.stringify(booked.json));
  appointment = booked.json.id;
  const payment = { amount: 100, method: "Cartão de crédito", status: "pago", installments: 12, fee_amount: 11.11,
    card_fee_table_id: rate.json.id, fee_policy: "customer", quoted_charged_amount: 111.11, financial_account_id: bank };
  const notQuoted = await post(`/appointments/${appointment}/complete`, { payments: [{ ...payment, quoted_charged_amount: 100 }] });
  assert.equal(notQuoted.status, 400, JSON.stringify(notQuoted.json));
  for (let repeat = 0; repeat < 2; repeat++) {
    const done = await post(`/appointments/${appointment}/complete`, { payments: [payment], reason: "Conferência das taxas sem duplicar o pagamento" });
    assert.equal(done.status, 200, JSON.stringify(done.json));
  }
  assert.equal((await balances()).get(bank), 1080);
  const recorded = await withTenantSchema(clinic.tenant.id, (db) => db.get("SELECT * FROM payments WHERE appointment_id=? AND payment_type='restante'", [appointment]));
  assert.equal(Number(recorded.amount), 100);
  assert.equal(Number(recorded.card_surcharge_amount), 11.11);
  assert.equal(Number(recorded.fee_amount), 11.11);
  assert.equal(Number(recorded.net_amount), 100);
  for (let repeat = 0; repeat < 2; repeat++) assert.equal((await api(`/finance/ledger?from=${localDate()}&to=${localDate()}`)).status, 200);
  const counts = await withTenantSchema(clinic.tenant.id, (db) => db.all("SELECT source_type,COUNT(*)::int AS count FROM financial_entries WHERE source_id=? AND source_type IN ('card_fee','card_surcharge') GROUP BY source_type", [recorded.id]));
  assert.deepEqual(counts.map((row) => [row.source_type, row.count]).sort(), [["card_fee", 1], ["card_surcharge", 1]]);
  const old = recorded.card_fee_snapshot;
  await post("/finance/card-fees", { operator_name: "InfinitePay QA", valid_from: localDate(), debit_percent: 2,
    credit_rates: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, 20])) });
  const same = await post(`/appointments/${appointment}/complete`, { payments: [payment], reason: "Preservar a taxa contratada no pagamento" });
  assert.equal(same.status, 200, JSON.stringify(same.json));
  const preserved = await withTenantSchema(clinic.tenant.id, (db) => db.get("SELECT card_fee_snapshot FROM payments WHERE id=?", [recorded.id]));
  assert.deepEqual(preserved.card_fee_snapshot, old);
});

test("recebimento pendente fica fora do saldo; associação e estorno acompanham a origem", async () => {
  const created = await withTenantSchema(clinic.tenant.id, (db) => db.run(`INSERT INTO payments
    (client_id,amount,payment_type,method,status,paid_at,fee_amount,financial_account_id) VALUES (?,50,'avulso','Cartão de débito','pendente',?,2,?) RETURNING id`,
    [client,localDate(),bank]));
  const before = (await balances()).get(bank);
  await withTenantSchema(clinic.tenant.id, (db) => db.run("UPDATE payments SET status='pago' WHERE id=?", [created.returnedId]));
  assert.equal((await balances()).get(bank), before + 48);
  await withTenantSchema(clinic.tenant.id, (db) => db.run("UPDATE payments SET status='refunded' WHERE id=?", [created.returnedId]));
  assert.equal((await balances()).get(bank), before - 2, "taxa não reembolsada permanece como despesa");
  const cashReceipt = await withTenantSchema(clinic.tenant.id, (db) => db.run(`INSERT INTO payments
    (client_id,amount,payment_type,method,status,paid_at) VALUES (?,25,'avulso','Pix','pago',?) RETURNING id`, [client,localDate()]));
  assert.equal((await balances()).get(bank), before - 2);
  const unallocated = await api("/finance/accounts/unallocated");
  assert.ok(unallocated.json.items.some((row) => row.source_type === "payments" && row.source_id === cashReceipt.returnedId));
  for (let repeat = 0; repeat < 2; repeat++) assert.equal((await post("/finance/accounts/allocate", {
    source_type: "payments", source_id: cashReceipt.returnedId, financial_account_id: bank })).status, 200);
  assert.equal((await balances()).get(bank), before + 23);
  assert.equal((await patch(`/finance/accounts/${cash}`, { opening_balance: 200 })).status, 400);
  assert.equal((await patch(`/finance/accounts/${cash}`, { is_active: false })).status, 200);
  assert.equal((await post("/finance/account-movements", { kind: "transfer", from_account_id: bank, to_account_id: cash,
    amount: 1, movement_date: localDate(), description: "Conta inativa", idempotency_key: "inactive" })).status, 400);
});

test("baixas de um recebível preservam contas e taxas individuais, mantendo o resumo único", async () => {
  const bankBefore=(await balances()).get(bank);
  const cashBefore=(await balances()).get(cash);
  const title=await withTenantSchema(clinic.tenant.id,async(db)=>{
    const order=await db.run("INSERT INTO sales_orders (client_id,total_value,status,source) VALUES (?,100,'concluida','balcao') RETURNING id",[client]);
    return db.get("INSERT INTO financial_entries (entry_type,description,amount,paid_amount,due_date,status,source_type,source_id,source_key) VALUES ('receivable','Duas contas QA',100,0,?,'pending','sales_order',?,?) RETURNING *",[localDate(),order.returnedId,`two-accounts:${order.returnedId}`]);
  });
  await patch(`/finance/accounts/${cash}`,{is_active:true});
  let received=await patch(`/finance/entries/${title.id}`,{paid_amount:40,payment_method:'Dinheiro',financial_account_id:cash});
  assert.equal(received.status,200,JSON.stringify(received.json));
  const table=await post('/finance/card-fees',{operator_name:'Recebimento 12x QA',valid_from:localDate(),debit_percent:1.37,
    credit_rates:Object.fromEntries(Array.from({length:12},(_,i)=>[i+1,10]))});
  received=await patch(`/finance/entries/${title.id}`,{paid_amount:100,payment_method:'Cartão de crédito',financial_account_id:bank,
    card_fee_table_id:table.json.id,fee_policy:'customer',card_installments:12,quoted_charged_amount:66.67});
  assert.equal(received.status,200,JSON.stringify(received.json));
  assert.equal((await balances()).get(cash),cashBefore+40);
  assert.equal((await balances()).get(bank),bankBefore+60);
  const history=await withTenantSchema(clinic.tenant.id,db=>db.all('SELECT * FROM financial_entry_payments WHERE entry_id=? ORDER BY id',[title.id]));
  assert.deepEqual(history.map(p=>[Number(p.amount),p.financial_account_id,Number(p.fee_amount),Number(p.card_surcharge_amount)]),[[40,cash,0,0],[60,bank,6.67,6.67]]);
  assert.equal(history[1].card_fee_snapshot.installments,12);
  const aggregated=await withTenantSchema(clinic.tenant.id,db=>db.all('SELECT * FROM payments WHERE financial_entry_id=?',[title.id]));
  assert.equal(aggregated.length,1);
  assert.equal(Number(aggregated[0].amount),100);
  assert.equal(Number(aggregated[0].net_amount),100);
  await Promise.all(Array.from({length:4},()=>api('/finance/accounts')));
  assert.equal((await balances()).get(bank),bankBefore+60,'reconciliação concorrente não duplica baixas');
});
