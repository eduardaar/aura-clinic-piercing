import assert from "node:assert/strict";
import test from "node:test";
import { defaultBoutiqueConfig, normalizeBoutiqueConfig } from "../src/config/catalogBoutique.js";

test("Boutique preserva conteúdos vazios e listas removidas, sem recriar marketing fixo", () => {
  const { config, errors } = normalizeBoutiqueConfig({ announcement_text: "", hero_note: "", benefits: [], footer_columns: [], navigation_links: [], sections: [] });
  assert.deepEqual(errors, []);
  assert.equal(config.announcement_text, "");
  assert.equal(config.hero_note, "");
  for (const key of ["benefits", "footer_columns", "navigation_links", "sections"]) assert.deepEqual(config[key], []);
  const changed = defaultBoutiqueConfig(); changed.benefits[0].title = "Outra clínica";
  assert.notEqual(defaultBoutiqueConfig().benefits[0].title, "Outra clínica");
});

test("Boutique normaliza números, flags, sequência e opções específicas de celular", () => {
  const { config, errors } = normalizeBoutiqueConfig({ hero_autoplay: "false", products_mobile_columns: 1, hero_mobile_layout: "stack", products_default_sort: "menor-preco", sections: [{ id: "products", type: "products", enabled: true }, { id: "hero", type: "hero", enabled: false }], filters: ["price", "price", "material"], category_keys: ["labret", "labret"] });
  assert.deepEqual(errors, []);
  assert.equal(config.hero_autoplay, false);
  assert.equal(config.products_mobile_columns, 1);
  assert.equal(config.hero_mobile_layout, "stack");
  assert.equal(config.products_default_sort, "menor-preco");
  assert.deepEqual(config.sections.map((section) => section.type), ["products", "hero"]);
  assert.deepEqual(config.filters, ["price", "material"]);
  assert.deepEqual(config.category_keys, ["labret"]);
});

test("Boutique recusa links executáveis, cores livres, números fora do limite e componentes duplicados", () => {
  for (const value of [
    42, [], "null",
    { announcement_link_url: "javascript:alert(1)" }, { benefits: [{ url: "data:text/html,bad" }] },
    { navigation_links: [{ url: "//unsafe.test" }] }, { footer_columns: [{ type: "links", links: [{ url: "javascript:alert(1)" }] }] },
    { hero_background: "red;display:none" }, { products_mobile_columns: 8 }, { hero_interval: 1 },
    { hero_layout: "arbitrary-script" }, { sections: [{ type: "custom", image_url: "mailto:test@test.com" }] },
    { sections: [{ id: "one", type: "products" }, { id: "two", type: "products" }] }
  ]) assert.ok(normalizeBoutiqueConfig(value).errors.length, JSON.stringify(value));
});
