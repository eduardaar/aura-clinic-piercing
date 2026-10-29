import assert from "node:assert/strict";
import test from "node:test";
import { attentionPeriod, dashboardAttention } from "../src/services/dashboardAttention.js";

test("períodos usam São Paulo e incluem a semana na virada do ano", () => {
  assert.deepEqual(attentionPeriod("today", new Date("2026-10-30T01:00:00Z")), { from: "2026-10-29", to: "2026-10-29" });
  assert.deepEqual(attentionPeriod("week", new Date("2027-01-01T12:00:00Z")), { from: "2026-12-28", to: "2027-01-03" });
  assert.deepEqual(attentionPeriod("month", new Date("2028-02-15T12:00:00Z")), { from: "2028-02-01", to: "2028-02-29" });
});

test("sem permissão, não consulta nem retorna contagens das categorias", async () => {
  const db = { get() { throw new Error("consulta indevida"); }, all() { throw new Error("consulta indevida"); } };
  const result = await dashboardAttention(db, { appointments: false, inventory: false, clients: false, followups: false });
  for (const key of ["appointments", "sold_out", "birthdays", "returns"]) assert.equal(result[key], null);
});

test("aniversários da semana incluem dezembro e janeiro e retornos não são limitados à prévia", async () => {
  const db = {
    async get() { return { total: 12 }; },
    async all() { return [{ birth_date: "1990-12-30" }, { birth_date: "2000-01-02" }, { birth_date: "1980-01-04" }]; }
  };
  const result = await dashboardAttention(db, { period: "week", now: new Date("2027-01-01T12:00:00Z"), inventory: false });
  assert.equal(result.birthdays, 2);
  assert.equal(result.returns, 12);
});

test("joias esgotadas usam a contagem completa e excluem materiais e estoque não controlado", async () => {
  const products = Array.from({ length: 15 }, (_, i) => ({ id: i + 1, name: `Joia ${i}`, quantity: 0, can_sell: true, track_stock: true }));
  products[13].can_sell = false;
  products[14].track_stock = false;
  const db = { async all(sql) { return sql.includes("FROM jewelry_inventory") ? products : []; } };
  const result = await dashboardAttention(db, { appointments: false, clients: false, followups: false });
  assert.equal(result.sold_out, 13);
});
