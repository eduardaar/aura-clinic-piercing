import assert from "node:assert/strict";
import test from "node:test";
import {
  CATALOG_BUILDER_PLUGIN_REGISTRY,
  getCatalogBuilderPlugin,
  normalizeAllowedUrl,
  normalizeCatalogBuilderPluginConfig,
  normalizeCatalogBuilderPluginInstance
} from "../src/features/catalog/builderPluginRegistry.js";

test("registry do builder é fechado e não permite HTML, CSS ou JavaScript arbitrário", () => {
  assert.deepEqual(CATALOG_BUILDER_PLUGIN_REGISTRY.map((plugin) => plugin.id), [
    "whatsapp_cta", "instagram_profile", "maps_location", "faq", "seo_metadata", "google_analytics", "google_review_link"
  ]);
  assert.ok(CATALOG_BUILDER_PLUGIN_REGISTRY.every((plugin) =>
    plugin.allowsArbitraryHtml === false
    && plugin.allowsArbitraryCss === false
    && plugin.allowsArbitraryJavaScript === false
  ));
  assert.equal(getCatalogBuilderPlugin("nao-existe"), null);
});

test("URLs de integrações rejeitam protocolos perigosos e hosts fora da allowlist", () => {
  assert.deepEqual(normalizeAllowedUrl("javascript:alert(1)", "google_maps"), { value: "", error: "Use uma URL HTTPS." });
  assert.deepEqual(normalizeAllowedUrl("https://evil.example/maps?q=clinica", "google_maps"), { value: "", error: "Host ou caminho não permitido para esta integração." });
  assert.deepEqual(normalizeAllowedUrl("https://www.google.com/not-maps", "google_maps"), { value: "", error: "Host ou caminho não permitido para esta integração." });
  assert.equal(
    normalizeAllowedUrl("https://www.google.com/maps/search/?api=1&query=Aura#ignored", "google_maps").value,
    "https://www.google.com/maps/search/?api=1&query=Aura"
  );
});

test("WhatsApp conserva somente campos suportados e normaliza telefone", () => {
  const input = {
    phone: "+55 (71) 99999-1111",
    label: "  Fale com a equipe  ",
    message: "Olá!\n\nQuero saber mais.",
    style: "outline",
    html: "<script>alert(1)</script>",
    onClick: "alert(1)"
  };
  const result = normalizeCatalogBuilderPluginConfig("whatsapp_cta", input);

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.config, {
    phone: "5571999991111",
    label: "Fale com a equipe",
    message: "Olá!\nQuero saber mais.",
    style: "outline"
  });
  assert.equal("html" in result.config, false);
  assert.equal("onClick" in result.config, false);
  assert.equal(input.html, "<script>alert(1)</script>");
});

test("Maps cria link conhecido pelo endereço e exige URL segura quando incorporado", () => {
  const link = normalizeCatalogBuilderPluginConfig("maps_location", {
    address: "Rua das Joias, 10, Salvador",
    display: "link"
  });
  assert.deepEqual(link.errors, []);
  assert.equal(link.config.mapUrl, "https://www.google.com/maps/search/?api=1&query=Rua%20das%20Joias%2C%2010%2C%20Salvador");

  const embed = normalizeCatalogBuilderPluginConfig("maps_location", {
    address: "Rua das Joias, 10",
    display: "embed",
    embedUrl: "https://maps.google.com/maps/embed?pb=example"
  });
  assert.deepEqual(embed.errors, []);
  assert.equal(embed.config.embedUrl, "https://maps.google.com/maps/embed?pb=example");
});

test("FAQ remove itens vazios, mantém texto simples e relata respostas incompletas", () => {
  const result = normalizeCatalogBuilderPluginConfig("faq", {
    title: "  Dúvidas  ",
    items: [
      { question: "Como agendo?", answer: "Pelo link público." },
      { question: "", answer: "" },
      { question: "Oi", answer: "No" }
    ],
    script: "window.alert(1)"
  });
  assert.equal(result.config.title, "Dúvidas");
  assert.deepEqual(result.config.items, [
    { question: "Como agendo?", answer: "Pelo link público." },
    { question: "Oi", answer: "No" }
  ]);
  assert.deepEqual(result.errors, [
    { field: "items.2.question", message: "A pergunta precisa ter ao menos 3 caracteres." },
    { field: "items.2.answer", message: "A resposta precisa ter ao menos 3 caracteres." }
  ]);
  assert.equal("script" in result.config, false);
});

test("instância informa feature e consentimento sem persistir estado de consentimento", () => {
  const base = {
    id: "mapa-principal",
    pluginId: "maps_location",
    config: { address: "Rua A, 10", display: "link" }
  };
  const waiting = normalizeCatalogBuilderPluginInstance(base, { enabledFeatures: ["online_booking"] });
  assert.equal(waiting.available, true);
  assert.equal(waiting.consentRequired, true);
  assert.equal(waiting.consentGranted, false);
  assert.equal(waiting.readyToRender, false);
  assert.equal("consent" in waiting.instance, false);

  const ready = normalizeCatalogBuilderPluginInstance(base, {
    enabledFeatures: ["online_booking"],
    consentByPurpose: { third_party_maps: true }
  });
  assert.equal(ready.readyToRender, true);
  assert.equal(ready.instance.config.address, "Rua A, 10");
});

test("Google Analytics e link de avaliação só aceitam identificadores conhecidos", () => {
  const analytics = normalizeCatalogBuilderPluginConfig("google_analytics", {
    measurementId: " g-ab12cd34 "
  });
  assert.deepEqual(analytics.errors, []);
  assert.deepEqual(analytics.config, { measurementId: "G-AB12CD34" });

  const invalidAnalytics = normalizeCatalogBuilderPluginConfig("google_analytics", { measurementId: "UA-123" });
  assert.ok(invalidAnalytics.errors.some((error) => error.field === "measurementId"));
  assert.equal(invalidAnalytics.config.measurementId, "");

  const review = normalizeCatalogBuilderPluginConfig("google_review_link", {
    placeId: "ChIJN1t_tDeuEmsRUsoyG83frY4",
    label: "  Avaliar a Aura  ",
    script: "alert(1)"
  });
  assert.deepEqual(review.errors, []);
  assert.deepEqual(review.config, {
    title: "Avalie sua experiência",
    placeId: "ChIJN1t_tDeuEmsRUsoyG83frY4",
    label: "Avaliar a Aura",
    style: "outline"
  });
  assert.equal("script" in review.config, false);
});

test("Analytics depende do recurso catalog_analytics e mantém revisão no construtor base", () => {
  const analytics = getCatalogBuilderPlugin("google_analytics");
  const review = getCatalogBuilderPlugin("google_review_link");
  assert.equal(analytics.featureFlag, "catalog_analytics");
  assert.equal(review.featureFlag, "public_catalog_customization");
  assert.equal(normalizeCatalogBuilderPluginInstance({ pluginId: "google_analytics", config: { measurementId: "G-AB12CD34" } }, {
    enabledFeatures: ["public_catalog_customization"], consentByPurpose: { analytics: true }
  }).readyToRender, false);
  assert.equal(normalizeCatalogBuilderPluginInstance({ pluginId: "google_analytics", config: { measurementId: "G-AB12CD34" } }, {
    enabledFeatures: ["catalog_analytics"], consentByPurpose: { analytics: true }
  }).readyToRender, true);
});
