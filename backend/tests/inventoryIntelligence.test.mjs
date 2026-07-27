import test from "node:test";
import assert from "node:assert/strict";
import { calculateInventoryMetrics } from "../src/services/inventoryIntelligence.js";

test("previsão usa somente saídas, vendas e perdas no período informado", () => {
  const products = [
    { id: 1, name: "A", quantity: 5, sale_value: 100, low_stock_threshold: 3 },
    { id: 2, name: "B", quantity: 20, sale_value: 10, low_stock_threshold: 3 }
  ];
  const movements = [
    { jewelry_id: 1, movement_type: "Saída", quantity: 9 },
    { jewelry_id: 1, movement_type: "Entrada", quantity: 200 },
    { jewelry_id: 2, movement_type: "Venda", quantity: 1 }
  ];
  const metrics = calculateInventoryMetrics(products, movements, 90);
  const first = metrics.find((item) => item.id === 1);
  assert.equal(first.units_out, 9);
  assert.equal(first.days_to_stockout, 50);
  assert.ok(first.suggested_purchase >= 1);
});

test("curva ABC é calculada por valor movimentado e não por estoque parado", () => {
  const rows = calculateInventoryMetrics([
    { id: 1, quantity: 1000, sale_value: 1 },
    { id: 2, quantity: 2, sale_value: 500 }
  ], [
    { jewelry_id: 2, movement_type: "Perda", quantity: 2 }
  ], 30);
  assert.equal(rows[0].id, 2);
  assert.equal(rows[0].abc_class, "A");
});
