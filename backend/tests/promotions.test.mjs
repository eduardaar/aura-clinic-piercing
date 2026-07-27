import test from "node:test";
import assert from "node:assert/strict";
import { calculatePromotionDiscount, quotePromotions } from "../src/services/promotions.js";

test("promoção percentual nunca gera total negativo", () => {
  assert.deepEqual(
    calculatePromotionDiscount({ discount_type: "percent", discount_value: 150, minimum_quantity: 1 }, 80, 1),
    { original_amount: 80, discount_amount: 80, final_amount: 0 }
  );
});

test("compre X pague Y calcula apenas grupos completos", () => {
  const quote = calculatePromotionDiscount({
    discount_type: "buy_x_pay_y",
    buy_quantity: 3,
    pay_quantity: 2,
    minimum_quantity: 1
  }, 400, 4);
  assert.equal(quote.discount_amount, 100);
  assert.equal(quote.final_amount, 300);
});

test("prioridade e especificidade escolhem promoção sem duplicar desconto", async () => {
  const promotions = [
    { id: 1, name: "Geral", status: "active", is_active: 1, discount_type: "percent", discount_value: 10, priority: 1 },
    { id: 2, name: "Produto", status: "active", is_active: 1, discount_type: "percent", discount_value: 20, product_ids: "7", priority: 5 }
  ];
  const db = {
    all: async () => promotions,
    get: async () => ({ count: 0 })
  };
  const quote = await quotePromotions(db, { items: [{ product_id: 7, unit_price: 100, quantity: 1 }] });
  assert.equal(quote.discount_amount, 20);
  assert.equal(quote.promotions.length, 1);
  assert.equal(quote.promotions[0].id, 2);
});

test("promoções cumulativas podem ser combinadas sem ultrapassar o total", async () => {
  const db = {
    all: async () => [
      { id: 1, name: "A", status: "active", is_active: 1, discount_type: "fixed", discount_value: 80, priority: 2, is_stackable: 1 },
      { id: 2, name: "B", status: "active", is_active: 1, discount_type: "fixed", discount_value: 80, priority: 1, is_stackable: 1 }
    ],
    get: async () => ({ count: 0 })
  };
  const quote = await quotePromotions(db, { items: [{ product_id: 1, unit_price: 100, quantity: 1 }] });
  assert.equal(quote.discount_amount, 100);
  assert.equal(quote.final_amount, 0);
});
