import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCatalogPlugins } from "../src/services/catalogPlugins.js";

test("normaliza plugins nativos e suas configurações permitidas", () => {
  const input = [
    {
      id: "whatsapp-main",
      pluginId: "whatsapp_cta",
      enabled: "true",
      config: {
        phone: "+55 (71) 99999-1111",
        label: "  Fale   com a equipe ",
        message: "Olá!\n\nQuero saber mais.",
        style: "outline"
      }
    },
    {
      pluginId: "instagram_profile",
      enabled: false,
      config: { username: "https://www.instagram.com/aura.clinic/", label: " Ver perfil " }
    },
    {
      pluginId: "maps_location",
      config: {
        title: " Onde estamos ",
        address: "Rua das Joias, 10\nSalvador - BA",
        display: "embed",
        mapUrl: "https://www.google.com/maps/search/?api=1&query=Aura#remover",
        embedUrl: "https://maps.google.com/maps/embed?pb=exemplo"
      }
    },
    {
      pluginId: "faq",
      config: { title: " Dúvidas ", items: [{ question: "Como agendo?", answer: "Pelo link público." }] }
    },
    {
      pluginId: "seo_metadata",
      config: { title: "Joias Aura", description: "Joias para piercing em Salvador.", indexing: "noindex" }
    }
  ];

  const result = normalizeCatalogPlugins(input);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.plugins, [
    {
      id: "whatsapp-main",
      pluginId: "whatsapp_cta",
      enabled: true,
      config: { phone: "5571999991111", label: "Fale com a equipe", message: "Olá!\nQuero saber mais.", style: "outline" }
    },
    {
      pluginId: "instagram_profile",
      enabled: false,
      config: { username: "aura.clinic", label: "Ver perfil", openInNewTab: true }
    },
    {
      pluginId: "maps_location",
      enabled: true,
      config: {
        title: "Onde estamos",
        address: "Rua das Joias, 10\nSalvador - BA",
        display: "embed",
        mapUrl: "https://www.google.com/maps/search/?api=1&query=Aura",
        embedUrl: "https://maps.google.com/maps/embed?pb=exemplo"
      }
    },
    {
      pluginId: "faq",
      enabled: true,
      config: { title: "Dúvidas", items: [{ question: "Como agendo?", answer: "Pelo link público." }] }
    },
    {
      pluginId: "seo_metadata",
      enabled: true,
      config: { title: "Joias Aura", description: "Joias para piercing em Salvador.", indexing: "noindex" }
    }
  ]);
});

test("normaliza Google Analytics e link de avaliação a partir de Place ID, sem URL arbitrária", () => {
  const result = normalizeCatalogPlugins([
    {
      pluginId: "google_analytics",
      config: { measurementId: "g-ab12cd34ef" }
    },
    {
      pluginId: "google_review_link",
      config: {
        title: " Conte como foi sua experiência ",
        placeId: "ChIJN1t_tDeuEmsRUsoyG83frY4",
        label: " Deixar avaliação ",
        style: "outline"
      }
    }
  ]);

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.plugins, [
    { pluginId: "google_analytics", enabled: true, config: { measurementId: "G-AB12CD34EF" } },
    {
      pluginId: "google_review_link",
      enabled: true,
      config: {
        title: "Conte como foi sua experiência",
        placeId: "ChIJN1t_tDeuEmsRUsoyG83frY4",
        label: "Deixar avaliação",
        style: "outline"
      }
    }
  ]);

  const invalid = normalizeCatalogPlugins([
    { pluginId: "google_analytics", config: { measurementId: "UA-123456" } },
    { pluginId: "google_review_link", config: { placeId: "https://evil.example/review", url: "https://evil.example" } }
  ]);
  assert.deepEqual(invalid.plugins, []);
  assert.ok(invalid.errors.some((error) => error.code === "invalid_plugin_field"));
  assert.ok(invalid.errors.some((error) => error.code === "unknown_plugin_key"));
});

test("rejeita plugins, chaves e conteúdo executável desconhecidos sem persistir uma instância contaminada", () => {
  const result = normalizeCatalogPlugins([
    { pluginId: "pixel_terceiro", config: {} },
    {
      pluginId: "whatsapp_cta",
      onClick: "alert(1)",
      config: {
        phone: "+55 71 99999-1111",
        html: "<script>alert(1)</script>",
        label: "<b>Fale comigo</b>"
      }
    },
    {
      pluginId: "faq",
      config: {
        items: [{ question: "Posso usar CSS?", answer: "<style>body{display:none}</style>" }],
        extra: "não permitido"
      }
    }
  ]);

  assert.deepEqual(result.plugins, []);
  const codes = result.errors.map((error) => error.code);
  assert.ok(codes.includes("unknown_catalog_plugin"));
  assert.ok(codes.includes("unsafe_plugin_key"));
  assert.ok(codes.includes("unknown_plugin_key"));
  assert.ok(codes.includes("unsafe_plugin_content"));
});

test("URLs de perfil e Maps exigem HTTPS, hosts e caminhos permitidos", () => {
  const result = normalizeCatalogPlugins([
    {
      pluginId: "instagram_profile",
      config: { username: "https://evil.example/aura" }
    },
    {
      pluginId: "maps_location",
      config: {
        address: "Rua A, 10",
        display: "embed",
        mapUrl: "http://www.google.com/maps/search/?q=Aura",
        embedUrl: "https://www.google.com/maps/search/?q=Aura"
      }
    }
  ]);

  assert.deepEqual(result.plugins, []);
  const codes = result.errors.map((error) => error.code);
  assert.ok(codes.includes("unallowed_plugin_url"));
  assert.ok(codes.includes("invalid_plugin_url"));
  assert.ok(codes.includes("required_plugin_field"), "embed sem /maps/embed deve ser recusado");
});

test("limita texto, itens de FAQ, instâncias únicas e IDs duplicados", () => {
  const faqItems = Array.from({ length: 13 }, (_, index) => ({ question: `Pergunta ${index + 1}`, answer: "Resposta válida" }));
  const result = normalizeCatalogPlugins({
    plugins: [
      { id: "duplicado", pluginId: "seo_metadata", config: { title: "T".repeat(61), description: "Descrição válida" } },
      { id: "duplicado", pluginId: "seo_metadata", config: { title: "Outro título", description: "Outra descrição" } },
      { pluginId: "faq", config: { items: faqItems } }
    ]
  });

  assert.deepEqual(result.plugins, []);
  const codes = result.errors.map((error) => error.code);
  assert.ok(codes.includes("plugin_text_too_long"));
  assert.ok(codes.includes("duplicate_plugin_id"));
  assert.ok(codes.includes("duplicate_catalog_plugin"));
  assert.ok(codes.includes("too_many_plugin_items"));
});

test("a forma opcional de snapshot não aceita propriedades soltas", () => {
  const result = normalizeCatalogPlugins({
    plugins: [],
    script: "alert(1)"
  });

  assert.deepEqual(result.plugins, []);
  assert.deepEqual(result.errors.map((error) => error.code), ["unsafe_plugin_key"]);
});
