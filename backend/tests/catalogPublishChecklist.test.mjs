import assert from "node:assert/strict";
import test from "node:test";
import { catalogPublishChecklist } from "../src/services/catalog.js";

test("checklist aceita snapshot legado sem seções do builder", () => {
  const checklist = catalogPublishChecklist({
    settings: {
      hero_image_url: "https://cdn.example.test/hero.webp",
      content_sections: JSON.stringify([{ media_type: "image", media_url: "https://cdn.example.test/content.webp" }])
    },
    theme: { button_color: "#1a1a1a" },
    banners: [{ image_url: "https://cdn.example.test/banner.webp", button_link: "/agendar" }]
  });

  assert.equal(checklist.ready, true, JSON.stringify(checklist));
  assert.deepEqual(checklist.errors, []);
});

test("checklist sinaliza somente avisos para ordem, referência e contraste calculáveis", () => {
  const checklist = catalogPublishChecklist({
    settings: { text_color: "#777777", site_background: "#ffffff" },
    theme: { button_color: "#ffffff" },
    banners: [{ image_url: "/uploads/banner.webp", button_link: "#nao-existe" }],
    catalogSections: [
      { section_key: "Hero inválido", section_type: "hero", sort_order: 0 },
      { section_key: "hero-2", section_type: "hero", sort_order: 2 },
      { section_key: "hero-2", section_type: "footer", sort_order: 2 }
    ]
  });

  assert.equal(checklist.ready, true, JSON.stringify(checklist));
  const codes = checklist.warnings.map((item) => item.code);
  assert.ok(codes.includes("invalid_section_reference"));
  assert.ok(codes.includes("invalid_section_order"));
  assert.ok(codes.includes("duplicate_section_reference"));
  assert.ok(codes.includes("duplicate_section_order"));
  assert.ok(codes.includes("unknown_section_reference"));
  assert.ok(codes.includes("insufficient_theme_contrast"));
});

test("checklist bloqueia URL executável, embed fora da allowlist e bloco desconhecido", () => {
  const checklist = catalogPublishChecklist({
    settings: {
      hero_image_url: "http://inseguro.example/hero.webp",
      content_sections: [{ media_type: "video", media_url: "https://evil.example/embed/123" }]
    },
    banners: [{ image_url: "javascript:alert(1)", button_link: "data:text/html,alert(1)" }],
    catalogSections: [{ section_key: "desconhecido-1", section_type: "codigo-de-terceiro", sort_order: 1 }]
  });

  assert.equal(checklist.ready, false);
  const codes = checklist.errors.map((item) => item.code);
  assert.ok(codes.includes("unsafe_banner_url"));
  assert.ok(codes.includes("unsafe_cta_url"));
  assert.ok(codes.includes("unallowed_catalog_embed"));
  assert.ok(codes.includes("unknown_catalog_block"));
});
