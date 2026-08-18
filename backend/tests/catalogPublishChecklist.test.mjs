import assert from "node:assert/strict";
import test from "node:test";
import { catalogPublishChecklist, normalizeCatalogSections } from "../src/services/catalog.js";

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

test("normalizador preserva linhas, colunas, componentes e itens do menu", () => {
  const sections = normalizeCatalogSections([{
    section_key: "linha-principal",
    section_type: "layout_row",
    is_active: true,
    sort_order: 1,
    columns_count: 2,
    columns: [{
      column_key: "cabecalho",
      components: [{
        section_key: "menu-principal",
        section_type: "menu",
        title: "Navegação",
        menu_items: [
          { label: "Joias", url: "#produtos", is_active: true },
          { label: "Agendar", url: "/agendar", is_active: false }
        ]
      }]
    }, {
      column_key: "destaque",
      components: [{ section_key: "produtos", section_type: "featured_products", sort_order: 1 }]
    }]
  }]);

  assert.equal(sections[0].section_type, "layout_row");
  assert.equal(sections[0].columns_count, 2);
  assert.equal(sections[0].columns[0].column_key, "cabecalho");
  assert.equal(sections[0].columns[0].components[0].section_type, "menu");
  assert.deepEqual(sections[0].columns[0].components[0].menu_items, [
    { label: "Joias", url: "#produtos", is_active: 1 },
    { label: "Agendar", url: "/agendar", is_active: 0 }
  ]);
  assert.equal(sections[0].columns[1].components[0].section_key, "produtos");
});

test("checklist valida tipos, links e referências dentro das colunas", () => {
  const checklist = catalogPublishChecklist({
    catalogSections: [{
      section_key: "linha-principal",
      section_type: "layout_row",
      sort_order: 1,
      columns_count: 2,
      columns: [{
        column_key: "Coluna inválida",
        components: [{
          section_key: "componente-repetido",
          section_type: "menu",
          sort_order: 1,
          menu_items: [{ label: "Inseguro", url: "javascript:alert(1)", is_active: true }]
        }]
      }, {
        column_key: "segunda-coluna",
        components: [{
          section_key: "componente-repetido",
          section_type: "codigo-de-terceiro",
          sort_order: 1,
          button_link: "data:text/html,alert(1)"
        }]
      }]
    }]
  });

  assert.equal(checklist.ready, false);
  assert.ok(checklist.errors.some((item) => item.code === "unknown_catalog_block" && item.path.includes("columns[1].components[0]")));
  assert.ok(checklist.errors.some((item) => item.code === "unsafe_cta_url" && item.path.endsWith("menu_items[0].url")));
  assert.ok(checklist.errors.some((item) => item.code === "unsafe_cta_url" && item.path.includes("columns[1].components[0].button_link")));
  assert.ok(checklist.warnings.some((item) => item.code === "invalid_column_reference"));
  assert.ok(checklist.warnings.some((item) => item.code === "duplicate_section_reference" && item.path.includes("columns[1].components[0]")));
});

test("checklist exige de uma a três colunas e rejeita linhas aninhadas", () => {
  const checklist = catalogPublishChecklist({
    catalogSections: [{
      section_key: "linha-externa",
      section_type: "layout_row",
      sort_order: 1,
      columns_count: 4,
      columns: [{
        column_key: "coluna-unica",
        components: [{ section_key: "linha-interna", section_type: "layout_row", sort_order: 1, columns_count: 1, columns: [] }]
      }]
    }]
  });

  assert.equal(checklist.ready, false);
  assert.ok(checklist.errors.some((item) => item.code === "invalid_layout_columns"));
  assert.ok(checklist.errors.some((item) => item.code === "invalid_layout_row"));
});
