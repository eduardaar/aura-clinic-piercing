import test from "node:test";
import assert from "node:assert/strict";
import { highlightedPlanFeatures } from "../src/lib/planFeatures.js";

const common = ["clients", "agenda", "procedures", "basic_inventory", "basic_catalog", "whatsapp_link", "basic_reports"];

test("cards cumulativos destacam o diferencial de cada plano", () => {
  assert.deepEqual(
    highlightedPlanFeatures({ code: "profissional", features: [...common, "online_booking", "digital_terms", "basic_finance", "automatic_followup", "public_catalog_customization"] }),
    ["basic_finance", "online_booking", "digital_terms", "public_catalog_customization", "automatic_followup"]
  );
  assert.deepEqual(
    highlightedPlanFeatures({ code: "studio", features: [...common, "commissions", "coupons", "campaigns", "catalog_analytics", "visual_search"] }),
    ["commissions", "coupons", "campaigns", "catalog_analytics", "visual_search"]
  );
});
