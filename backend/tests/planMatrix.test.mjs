import test from "node:test";
import assert from "node:assert/strict";
import { PLAN_FEATURES, SUBSCRIPTION_PLANS, pageAllowedByPlan } from "../src/services/plans.js";

test("matriz de planos é cumulativa e sem recursos duplicados", () => {
  const order = ["start", "profissional", "studio"];
  for (const code of order) {
    assert.equal(new Set(PLAN_FEATURES[code]).size, PLAN_FEATURES[code].length, `duplicidade em ${code}`);
  }
  for (let index = 1; index < order.length; index += 1) {
    const previous = PLAN_FEATURES[order[index - 1]];
    const current = PLAN_FEATURES[order[index]];
    previous.forEach((feature) => {
      assert.ok(current.includes(feature), `${feature} não foi herdado por ${order[index]}`);
    });
  }
});

test("recursos avançados ficam somente nos planos previstos", () => {
  assert.ok(PLAN_FEATURES.studio.includes("coupons"));
  assert.ok(!PLAN_FEATURES.profissional.includes("coupons"));
  assert.ok(PLAN_FEATURES.studio.includes("campaigns"));
  assert.ok(PLAN_FEATURES.studio.includes("visual_search"));
  assert.ok(PLAN_FEATURES.studio.includes("catalog_analytics"));
  assert.ok(PLAN_FEATURES.studio.includes("advanced_finance"));
  assert.ok(!PLAN_FEATURES.profissional.includes("campaigns"));
});

test("páginas protegidas refletem as features do plano", () => {
  assert.equal(pageAllowedByPlan(PLAN_FEATURES.start, "finance"), false);
  assert.equal(pageAllowedByPlan(PLAN_FEATURES.profissional, "finance"), true);
  assert.equal(pageAllowedByPlan(PLAN_FEATURES.start, "reports"), true);
  assert.equal(pageAllowedByPlan(PLAN_FEATURES.start, "terms"), false);
  assert.equal(SUBSCRIPTION_PLANS.length, 3);
  assert.equal(SUBSCRIPTION_PLANS.some((plan) => plan.code === "essencial"), false);
  assert.equal(SUBSCRIPTION_PLANS.some((plan) => plan.code === "premium"), false);
});

test("oferta comercial tem três planos, preços e limites publicados", () => {
  assert.deepEqual(
    SUBSCRIPTION_PLANS.map(({ code, price_cents }) => ({ code, price_cents })),
    [
      { code: "start", price_cents: 4990 },
      { code: "profissional", price_cents: 8990 },
      { code: "studio", price_cents: 14990 }
    ]
  );
  assert.deepEqual(SUBSCRIPTION_PLANS.find((plan) => plan.code === "start")?.limits, {
    users: 1, clients: 300, appointments_month: 100, jewelry_items: 100, storage_mb: 1024, catalog_plugins: 0
  });
  assert.deepEqual(SUBSCRIPTION_PLANS.find((plan) => plan.code === "profissional")?.limits, {
    users: 3, jewelry_items: 500, storage_mb: 5120, catalog_plugins: 3
  });
  assert.deepEqual(SUBSCRIPTION_PLANS.find((plan) => plan.code === "studio")?.limits, {
    users: 10, storage_mb: 20480, catalog_plugins: 12
  });
});
