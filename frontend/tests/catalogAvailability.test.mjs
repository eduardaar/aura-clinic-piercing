import test from "node:test";
import assert from "node:assert/strict";
import {
  catalogAvailabilityMatches,
  catalogItemIsAvailable,
  hasRenderableContent
} from "../src/features/catalog/catalogUtils.js";

test("produto sem estoque aparece quando o filtro Esgotados e selecionado", () => {
  const item = { quantity: 0, variants: [] };
  assert.equal(catalogAvailabilityMatches(item, "false", false), true);
  assert.equal(catalogAvailabilityMatches(item, "", false), false);
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
