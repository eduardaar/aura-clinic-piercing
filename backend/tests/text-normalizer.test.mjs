import assert from "node:assert/strict";
import test from "node:test";

import { normalizeCommonText } from "../src/text-normalizer.js";

test("preserva texto UTF-8 legítimo com circunflexo", () => {
  assert.equal(normalizeCommonText("Categoria Dinâmica"), "Categoria Dinâmica");
  assert.equal(normalizeCommonText("titânio"), "titânio");
});

test("preserva outros acentos legítimos", () => {
  assert.equal(normalizeCommonText("Validação clínica"), "Validação clínica");
});
