import test from "node:test";
import assert from "node:assert/strict";
import { PLAN_FEATURES, SUBSCRIPTION_PLANS, pageAllowedByPlan } from "../src/services/plans.js";

test("matriz de planos é cumulativa e sem recursos duplicados", () => {
  const order = ["start", "profissional", "studio", "premium"];
  for (const code of order) {
    assert.equal(new Set(PLAN_FEATURES[code]).size, PLAN_FEATURES[code].length, `duplicidade em ${code}`);
  }
  for (let index = 1; index < order.length; index += 1) {
    const previous = PLAN_FEATURES[order[index - 1]];
    const current = PLAN_FEATURES[order[index]];
    previous.forEach((feature) => assert.ok(current.includes(feature), `${feature} não foi herdado por ${order[index]}`));
  }
});

test("recursos avançados ficam somente nos planos previstos", () => {
  assert.ok(PLAN_FEATURES.studio.includes("coupons"));
  assert.ok(!PLAN_FEATURES.profissional.includes("coupons"));
  assert.ok(PLAN_FEATURES.premium.includes("campaigns"));
  assert.ok(PLAN_FEATURES.premium.includes("visual_search"));
  assert.ok(PLAN_FEATURES.premium.includes("catalog_analytics"));
  assert.ok(!PLAN_FEATURES.studio.includes("catalog_analytics"));
  assert.ok(PLAN_FEATURES.premium.includes("advanced_finance"));
  assert.ok(!PLAN_FEATURES.studio.includes("campaigns"));
});

test("páginas protegidas refletem as features do plano", () => {
  assert.equal(pageAllowedByPlan(PLAN_FEATURES.start, "finance"), false);
  assert.equal(pageAllowedByPlan(PLAN_FEATURES.profissional, "finance"), true);
  assert.equal(pageAllowedByPlan(PLAN_FEATURES.start, "reports"), true);
  assert.equal(pageAllowedByPlan(PLAN_FEATURES.start, "terms"), false);
  assert.equal(SUBSCRIPTION_PLANS.length, 4);
  assert.equal(SUBSCRIPTION_PLANS.some((plan) => plan.code === "essencial"), false);
});
