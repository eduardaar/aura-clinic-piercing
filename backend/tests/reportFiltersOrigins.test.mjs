import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import ExcelJS from "exceljs";
import { BASE, createTenant, loginTenant, req } from "./helpers.mjs";
import { withTenantSchema } from "../src/db/tenantSession.js";
import { deprovisionTenant } from "../src/services/tenants.js";

const ctx = {};
const day = "2026-10-06";
const api = (path, options = {}) => req(path, { token: ctx.token, tenant: ctx.slug, ...options });
const sql = (fn) => withTenantSchema(ctx.tenant.id, fn);
const range = `from=${day}&to=${day}`;

before(async () => {
  Object.assign(ctx, await createTenant("qa-responsive"));
  ctx.token = (await loginTenant(ctx.slug, ctx.adminEmail, ctx.adminPassword)).token;
  await api("/subscription", { method: "PATCH", body: { plan_code: "studio" } });
  await sql(async (db) => {
    ctx.client = (await db.run("INSERT INTO clients (full_name,whatsapp) VALUES ('João Responsivo','11981110001') RETURNING id")).returnedId;
    ctx.otherClient = (await db.run("INSERT INTO clients (full_name,whatsapp) VALUES ('Maria Fora do filtro','11981110002') RETURNING id")).returnedId;
    ctx.professional = (await db.run("INSERT INTO professionals (name) VALUES ('Áurea Responsiva') RETURNING id")).returnedId;
    ctx.otherProfessional = (await db.run("INSERT INTO professionals (name) VALUES ('Bruno') RETURNING id")).returnedId;
    ctx.service = (await db.run("INSERT INTO services (name,price,duration_minutes) VALUES ('Hélix legível',100,30) RETURNING id")).returnedId;
    for (const [client, professional, time, status] of [[ctx.client, ctx.professional, "09:00", "confirmado"], [ctx.otherClient, ctx.otherProfessional, "10:00", "pendente"]]) {
      const inserted = await db.run(`INSERT INTO appointments (client_id,professional_id,service_id,procedure,piercing_region,appointment_date,appointment_time,
        duration_minutes,total_value,subtotal_value,deposit_value,deposit_status,status) VALUES (?,?,?,'Hélix legível','Orelha',?,?,30,100,100,30,'pago',?) RETURNING id`,
      [client, professional, ctx.service, day, time, status]);
      if (client === ctx.client) ctx.appointment = inserted.returnedId;
    }
    await db.run("INSERT INTO appointment_items (appointment_id,service_id,region,quantity,procedure_price,subtotal) VALUES (?,?,'Orelha',1,100,100)", [ctx.appointment, ctx.service]);
    for (const [amount, status] of [[30, "pago"], [90, "cancelado"], [50, "pendente"]]) {
      await db.run("INSERT INTO payments (appointment_id,client_id,amount,payment_type,method,status,paid_at) VALUES (?,?,?,'sinal','Pix',?,?)", [ctx.appointment, ctx.client, amount, status, `${day} 09:00:00`]);
    }
  });
  const commission = await api(`/professionals/${ctx.professional}/commission-rules`, { method: "PUT", body: { rules: [{ scope: "servico_padrao", rate_type: "percentual", rate_value: 10 }] } });
  assert.equal(commission.status, 200, JSON.stringify(commission.json));
  const completed = await api(`/appointments/${ctx.appointment}/complete`, { method: "POST", body: { payments: [] } });
  assert.equal(completed.status, 200, JSON.stringify(completed.json));
  await sql(async (db) => {
    const entry = await db.get("SELECT fe.* FROM financial_entries fe JOIN service_executions se ON fe.source_type='service_execution' AND fe.source_id=se.id WHERE se.appointment_id=?", [ctx.appointment]);
    assert.ok(entry);
    ctx.entry = entry.id;
    await db.run("UPDATE financial_entries SET paid_amount=10,status='partially_paid',due_date=?,competence_date=? WHERE id=?", [day, "2026-01-01", ctx.entry]);
    ctx.sale = (await db.run("INSERT INTO sales_orders (client_id,total_value,status,source,created_at) VALUES (?,80,'aberta','balcao',?) RETURNING id", [ctx.client, `${day} 12:00:00`])).returnedId;
    await db.run("INSERT INTO sales_order_items (sales_order_id,item_type,item_name,quantity,unit_price) VALUES (?,'produto','Joia de titânio',1,80)", [ctx.sale]);
    ctx.saleEntry = (await db.run("INSERT INTO financial_entries (entry_type,description,amount,paid_amount,due_date,competence_date,status,source_type,source_id,source_key) VALUES ('receivable','Venda QA',80,20,?,?,'partially_paid','sales_order',?,?) RETURNING id", [day, day, ctx.sale, `sales-order:${ctx.sale}:receivable:1`])).returnedId;
    ctx.manual = (await db.run("INSERT INTO financial_entries (entry_type,description,amount,due_date,competence_date,status) VALUES ('receivable','Manual QA',12,?,?,'pending') RETURNING id", [day, day])).returnedId;
  });
});
after(async () => { if (ctx.tenant?.id) await deprovisionTenant(ctx.tenant.id); });

test("agenda: data, cliente, profissional, status e busca usam o mesmo conjunto na lista e contagem", async () => {
  const filters = `${range}&client_id=${ctx.client}&professional_id=${ctx.professional}&status=atendido&search=aurea&limit=1`;
  const result = await api(`/appointments?${filters}`);
  assert.equal(result.status, 200);
  assert.equal(result.json.total, 1);
  assert.deepEqual(result.json.items.map((row) => row.id), [ctx.appointment]);
  for (const extra of [`status=pendente`, `client_id=${ctx.otherClient}`, "search=%25", "from=2026-10-07&to=2026-10-07"]) {
    const params = new URLSearchParams(filters);
    new URLSearchParams(extra).forEach((value, key) => params.set(key, value));
    const empty = await api(`/appointments?${params}`);
    assert.equal(empty.json.total, 0, extra);
    assert.deepEqual(empty.json.items, [], extra);
  }
});

test("relatórios agregados respeitam filtros combinados, busca e contagem", async () => {
  const params = `${range}&professional_id=${ctx.professional}&client_id=${ctx.client}&status=atendido&search=responsivo`;
  const result = await api(`/reports/appointments?${params}`);
  assert.equal(result.status, 200, JSON.stringify(result.json));
  assert.equal(result.json.total_rows, 1);
  assert.deepEqual(result.json.rows.map((row) => row.id), [ctx.appointment]);
  const empty = await api(`/reports/appointments?${params}&search=inexistente`);
  assert.equal(empty.json.total_rows, 0);
  assert.deepEqual(empty.json.rows, []);
  assert.equal((await api("/reports/appointments?from=2026-10-07&to=2026-10-06")).status, 400);
});

test("financeiro: vencimento e competência são filtros distintos com totais coerentes", async () => {
  const result = await api(`/finance/ledger?${range}&date_field=due_date&entry_type=receivable&client_id=${ctx.client}&professional_id=${ctx.professional}&search=responsivo&limit=10`);
  assert.equal(result.status, 200, JSON.stringify(result.json));
  assert.equal(result.json.total, 1);
  assert.equal(result.json.entries[0].id, ctx.entry);
  assert.equal(result.json.receivable, 60);
  const competence = await api(`/finance/ledger?${range}&client_id=${ctx.client}&professional_id=${ctx.professional}&entry_type=receivable&limit=10`);
  assert.equal(competence.json.total, 0);
  assert.deepEqual(competence.json.entries, []);
});

test("origem: sinal recebido, baixa financeira, itens e link do atendimento sem contar pendentes ou cancelados", async () => {
  const result = await api(`/finance/entries/${ctx.entry}/details`);
  assert.equal(result.status, 200, JSON.stringify(result.json));
  const origin = result.json.origin;
  assert.equal(origin.client, "João Responsivo");
  assert.equal(origin.professional, "Áurea Responsiva");
  assert.equal(origin.date, day);
  assert.equal(origin.time, "09:00");
  assert.equal(origin.total_value, 100);
  assert.equal(origin.deposit_paid, 30);
  assert.equal(origin.other_paid, 10);
  assert.equal(origin.remaining_value, 60);
  assert.equal(origin.items[0].service, "Hélix legível");
  assert.equal(origin.href, `/app/agenda?appointment=${ctx.appointment}`);
});

test("origem de venda e lançamento manual, também no relatório de recebíveis", async () => {
  const sale = await api(`/finance/entries/${ctx.saleEntry}/details`);
  assert.equal(sale.status, 200, JSON.stringify(sale.json));
  assert.equal(sale.json.origin.items[0].product, "Joia de titânio");
  assert.equal(sale.json.origin.deposit_paid, 0);
  assert.equal(sale.json.origin.other_paid, 20);
  assert.equal(sale.json.origin.remaining_value, 60);
  assert.equal(sale.json.origin.href, `/app/vendas?sale=${ctx.sale}`);
  const manual = await api(`/finance/entries/${ctx.manual}/details`);
  assert.equal(manual.status, 200);
  assert.equal(manual.json.origin, null);
  const report = await api(`/reports/receivables?${range}&client_id=${ctx.client}&professional_id=${ctx.professional}&search=responsivo`);
  assert.equal(report.status, 200, JSON.stringify(report.json));
  assert.equal(report.json.total_rows, 1);
  assert.equal(report.json.rows[0].client_name, "João Responsivo");
});

test("PDF, XLSX, CSV e TXT exportam o mesmo resultado filtrado da tela", async () => {
  const path = `/reports/appointments?${range}&client_id=${ctx.client}&professional_id=${ctx.professional}&search=responsivo`;
  const screen = await api(path);
  assert.equal(screen.json.total_rows, 1);
  for (const format of ["csv", "txt", "xlsx", "pdf"]) {
    const response = await fetch(`${BASE}${path}&format=${format}`, { headers: { Authorization: `Bearer ${ctx.token}`, "X-Tenant": ctx.slug } });
    assert.equal(response.status, 200, format);
    const buffer = Buffer.from(await response.arrayBuffer());
    let content;
    if (format === "xlsx") {
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(buffer);
      assert.equal(book.worksheets[0].rowCount, 2);
      content = JSON.stringify(book.worksheets[0].getSheetValues());
    } else if (format === "pdf") {
      assert.equal(buffer.subarray(0, 4).toString(), "%PDF");
      const binary = buffer.toString("latin1");
      content = [...binary.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map((match) => {
        try { return inflateSync(Buffer.from(match[1], "latin1")).toString(); } catch { return ""; }
      }).join("\n");
      content = [...content.matchAll(/<([0-9a-f]+)>/gi)].map((match) => Buffer.from(match[1], "hex").toString("latin1")).join("");
    } else content = buffer.toString("utf8");
    assert.match(content, /Responsivo/, format);
    assert.doesNotMatch(content, /Maria Fora/, format);
  }
});

test("comissões: busca filtra também os totais e uma página fora do conjunto retorna uma página válida", async () => {
  const result = await api(`/reports/commissions?${range}&search=aurea&limit=1&offset=999`);
  assert.equal(result.status, 200, JSON.stringify(result.json));
  assert.equal(result.json.total_rows, 1);
  assert.equal(result.json.offset, 0);
  assert.equal(result.json.rows.length, 1);
  assert.equal(result.json.summary.commission, 10);
  const empty = await api(`/reports/commissions?${range}&search=inexistente`);
  assert.equal(empty.json.total_rows, 0);
  assert.equal(empty.json.summary.commission, 0);
  assert.deepEqual(empty.json.rows, []);
});

test("origem preserva o nome do item concluído e redução de parcela não vira recebimento", async () => {
  await sql(async (db) => {
    await db.run("UPDATE services SET name='Serviço renomeado depois' WHERE id=?", [ctx.service]);
    await db.run("UPDATE financial_entries SET amount=60 WHERE id=?", [ctx.saleEntry]);
  });
  const appointment = await api(`/finance/entries/${ctx.entry}/details`);
  assert.equal(appointment.json.origin.items[0].service, "Hélix legível");
  const sale = await api(`/finance/entries/${ctx.saleEntry}/details`);
  assert.equal(sale.json.origin.other_paid, 20);
  assert.equal(sale.json.origin.remaining_value, 40);
});
