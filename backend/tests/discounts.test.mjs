import test from "node:test";
import assert from "node:assert/strict";
import { calculateDiscount, validateCoupon } from "../src/services/discounts.js";

test("desconto percentual e limitado ao total", () => {
  assert.deepEqual(
    calculateDiscount({ amount: 200, discountType: "percent", discountValue: 15 }),
    { original_amount: 200, discount_amount: 30, final_amount: 170 }
  );
  assert.deepEqual(
    calculateDiscount({ amount: 30, discountType: "fixed", discountValue: 50 }),
    { original_amount: 30, discount_amount: 30, final_amount: 0 }
  );
});

test("desconto respeita teto configurado", () => {
  assert.equal(calculateDiscount({
    amount: 500,
    discountType: "percent",
    discountValue: 20,
    maximumDiscount: 40
  }).discount_amount, 40);
});

test("cupom e validado no banco do tenant e rejeita item excluido", async () => {
  const db = {
    get: async (sql) => {
      if (sql.includes("FROM coupons")) return {
        id: 1,
        code: "LABRET15",
        internal_name: "Labrets",
        status: "active",
        discount_type: "percent",
        discount_value: 15,
        minimum_amount: 0,
        excluded_product_ids: "9",
        is_stackable: 0
      };
      return { count: 0 };
    }
  };
  const result = await validateCoupon(db, "labret15", {
    amount: 100,
    items: [{ product_id: 9, category: "Labrets" }]
  });
  assert.equal(result.valid, false);
  assert.equal(result.error, "Cupom não aplicável aos itens.");
});
