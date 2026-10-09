import test from "node:test";
import assert from "node:assert/strict";
import {
  catalogAvailabilityMatches,
  catalogItemIsAvailable,
  catalogItemIsPublished,
  catalogStockText,
  catalogOrderQuantityIsValid,
  hasRenderableContent
} from "../src/features/catalog/catalogUtils.js";

test("produto sem estoque aparece quando o filtro Esgotados e selecionado", () => {
  const item = { quantity: 0, variants: [] };
  assert.equal(catalogAvailabilityMatches(item, "false", false), true);
  assert.equal(catalogAvailabilityMatches(item, "", false), true);
});

test("seções públicas vazias não reservam container", () => {
  assert.equal(hasRenderableContent({ type: "footer" }), false);
  assert.equal(hasRenderableContent({ type: "location", address: "  " }), false);
  assert.equal(hasRenderableContent({ type: "instagram", username: "@aura" }), true);
  assert.equal(hasRenderableContent({ type: "footer", logo_url: "/uploads/logo" }), true);
  assert.equal(hasRenderableContent({ type: "custom", items: [{ id: 1 }] }), true);
  assert.equal(hasRenderableContent({ type: "banner", image_url: "/banner.jpg", is_active: 0 }), false);
});

test("disponibilidade considera o estoque real das variacoes ativas", () => {
  const item = {
    quantity: 0,
    variants: [
      { quantity: 0, is_active: 1 },
      { quantity: 2, is_active: 1 }
    ]
  };
  assert.equal(catalogItemIsAvailable(item), true);
  assert.equal(catalogAvailabilityMatches(item, "true", false), true);
  assert.equal(catalogAvailabilityMatches(item, "false", true), false);
});

test("tenant pode exibir esgotados normalmente sem alterar o filtro", () => {
  assert.equal(catalogAvailabilityMatches({ quantity: 0 }, "", true), true);
});

test("tema legado não pode ocultar publicados esgotados; publicação continua obrigatória", () => {
  const published = { is_catalog_active: 1, is_published: 1, virtual_store_active: 1, quantity: 0 };
  assert.equal(catalogItemIsPublished(published), true);
  for (const key of ["is_catalog_active", "is_published", "virtual_store_active"]) {
    assert.equal(catalogItemIsPublished({ ...published, [key]: 0 }), false);
  }
  assert.equal(catalogItemIsPublished({ ...published, status: "arquivado" }), false);
  assert.equal(catalogItemIsPublished({ ...published, can_publish: false }), false);
  assert.equal(catalogAvailabilityMatches(published, "", false), true);
});

test("esgotado mantém identificação mesmo com estoque oculto pelo tema", () => {
  assert.equal(catalogStockText({ quantity: 0 }, { stock_display_mode: "hidden" }), "Esgotado");
  assert.equal(catalogStockText({ quantity: 0, variants: [{ quantity: 3 }] }), "Em estoque");
  assert.equal(catalogStockText({ quantity: 5, variants: [{ quantity: 0 }] }), "Esgotado");
});

test("quantidades incompletas e fora do estoque não podem virar pedido", () => {
  for (const qty of ["", " ", "0", "-1", "1.5", "4"]) assert.equal(catalogOrderQuantityIsValid({ qty, quantity: 3 }), false);
  assert.equal(catalogOrderQuantityIsValid({ qty: "2", quantity: 3 }), true);
});
