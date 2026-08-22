import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  FEATURE_ALIASES,
  FEATURE_KEYS,
  PAGE_FEATURE,
  PLAN_FEATURES,
  SUBSCRIPTION_PLANS,
  pageAllowedByPlan
} from "../src/services/plans.js";
import { catalogPluginRequiredFeature } from "../src/services/catalogPlugins.js";
import { REPORT_FEATURE_REQUIREMENTS } from "../src/services/reports.js";

const backendRoot = fileURLToPath(new URL("../src/", import.meta.url));

const EXPECTED_PLAN_FEATURES = {
  start: [
    "clients",
    "agenda",
    "procedures",
    "basic_inventory",
    "basic_catalog",
    "whatsapp_link",
    "basic_reports"
  ],
  profissional: [
    "clients",
    "agenda",
    "procedures",
    "basic_inventory",
    "basic_catalog",
    "whatsapp_link",
    "basic_reports",
    "online_booking",
    "digital_terms",
    "basic_finance",
    "deposits",
    "automatic_followup",
    "message_templates",
    "public_catalog_customization"
  ],
  studio: [
    "clients",
    "agenda",
    "procedures",
    "basic_inventory",
    "basic_catalog",
    "whatsapp_link",
    "basic_reports",
    "online_booking",
    "digital_terms",
    "basic_finance",
    "deposits",
    "automatic_followup",
    "message_templates",
    "public_catalog_customization",
    "commissions",
    "coupons",
    "campaigns",
    "catalog_analytics",
    "visual_search"
  ]
};

function guardedBackendFeatures() {
  const guarded = new Set();
  for (const file of readdirSync(`${backendRoot}routes`)) {
    if (!file.endsWith(".js")) continue;
    const source = readFileSync(`${backendRoot}routes/${file}`, "utf8");
    for (const match of source.matchAll(/(?:withFeature|requireFeature|withCatalogFeature)\([^)]*?["']([a-z_]+)["']/g)) {
      guarded.add(match[1]);
    }
  }
  for (const plugin of ["whatsapp_cta", "instagram_profile", "maps_location", "faq", "seo_metadata", "google_analytics", "google_review_link"]) {
    guarded.add(catalogPluginRequiredFeature(plugin));
  }
  for (const features of Object.values(REPORT_FEATURE_REQUIREMENTS)) {
    features.forEach((feature) => {
      guarded.add(feature);
    });
  }
  return guarded;
}

test("matriz de planos é cumulativa e sem recursos duplicados", () => {
  const order = ["start", "profissional", "studio"];
  for (const code of order) {
    assert.deepEqual(PLAN_FEATURES[code], EXPECTED_PLAN_FEATURES[code], `matriz comercial divergente em ${code}`);
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
  assert.ok(PLAN_FEATURES.studio.includes("commissions"));
  assert.ok(PLAN_FEATURES.studio.includes("coupons"));
  assert.ok(!PLAN_FEATURES.profissional.includes("coupons"));
  assert.ok(PLAN_FEATURES.studio.includes("campaigns"));
  assert.ok(PLAN_FEATURES.studio.includes("visual_search"));
  assert.ok(PLAN_FEATURES.studio.includes("catalog_analytics"));
  assert.ok(!PLAN_FEATURES.profissional.includes("campaigns"));
  assert.ok(!FEATURE_KEYS.includes("advanced_finance"));
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
      { code: "start", price_cents: 3990 },
      { code: "profissional", price_cents: 6990 },
      { code: "studio", price_cents: 11990 }
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

test("Profissional é o único plano recomendado e preserva o posicionamento acordado", () => {
  const recommended = SUBSCRIPTION_PLANS.filter((plan) => plan.highlight || plan.is_recommended);
  assert.deepEqual(recommended.map((plan) => plan.code), ["profissional"]);
  assert.match(recommended[0].badge || "", /custo-benefício|recomendado/i);
  assert.match(SUBSCRIPTION_PLANS.find((plan) => plan.code === "start")?.audience || "", /solo/i);
  assert.match(SUBSCRIPTION_PLANS.find((plan) => plan.code === "studio")?.audience || "", /equipe|crescimento/i);
});

test("toda feature protegida no backend pertence ao catálogo e a algum plano", () => {
  const guarded = guardedBackendFeatures();
  const sold = new Set(Object.values(PLAN_FEATURES).flat());
  assert.deepEqual([...guarded].filter((feature) => !FEATURE_KEYS.includes(feature)), []);
  assert.deepEqual([...guarded].filter((feature) => !sold.has(feature)), []);
  assert.deepEqual(Object.values(PAGE_FEATURE).filter((feature) => !FEATURE_KEYS.includes(feature)), []);
});

test("todo diferencial pago possui proteção autoritativa no backend", () => {
  const guarded = guardedBackendFeatures();
  const paidDifferentials = new Set([
    ...PLAN_FEATURES.profissional.filter((feature) => !PLAN_FEATURES.start.includes(feature)),
    ...PLAN_FEATURES.studio.filter((feature) => !PLAN_FEATURES.profissional.includes(feature))
  ]);
  assert.deepEqual(
    [...paidDifferentials].filter((feature) => !guarded.has(feature)),
    [],
    "diferencial de plano sem withFeature ou validação equivalente conhecida"
  );
});

test("toda feature ofertada possui gate autoritativo, plugin ou ação protegida", () => {
  const guarded = guardedBackendFeatures();
  assert.deepEqual(
    FEATURE_KEYS.filter((feature) => !guarded.has(feature)),
    [],
    "feature comercial sem uso real no backend"
  );
});

test("catálogo não expõe chaves órfãs e preserva alias histórico fora da matriz", () => {
  const sold = new Set(Object.values(PLAN_FEATURES).flat());
  assert.deepEqual([...FEATURE_KEYS].sort(), [...sold].sort());
  assert.equal(FEATURE_ALIASES.anamnese, "digital_terms");
  assert.equal(FEATURE_ALIASES.anamnesis, "digital_terms");
  assert.ok(!FEATURE_KEYS.includes("anamnese"));
  assert.ok(!FEATURE_KEYS.includes("anamnesis"));
});
