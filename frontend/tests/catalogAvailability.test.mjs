import test from "node:test";
import assert from "node:assert/strict";
import {
  catalogAvailabilityMatches,
  catalogItemIsAvailable
} from "../src/features/catalog/catalogUtils.js";

test("produto sem estoque aparece quando o filtro Esgotados e selecionado", () => {
  const item = { quantity: 0, variants: [] };
  assert.equal(catalogAvailabilityMatches(item, "false", false), true);
  assert.equal(catalogAvailabilityMatches(item, "", false), false);
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
