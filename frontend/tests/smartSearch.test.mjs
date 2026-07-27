import test from "node:test";
import assert from "node:assert/strict";
import { levenshtein, normalizeSearch, smartSearchMatches } from "../src/lib/smartSearch.js";

test("busca normaliza acentos, caixa e pontuação", () => {
  assert.equal(normalizeSearch(" Titânio — Dourado "), "titanio dourado");
  assert.equal(smartSearchMatches("Argola de titânio", "TITANIO"), true);
});

test("busca tolera erro simples de digitação sem aceitar termo distante", () => {
  assert.equal(levenshtein("titanio", "titanio"), 0);
  assert.equal(smartSearchMatches("Labret Titânio Dourado", "titanio dorado"), true);
  assert.equal(smartSearchMatches("Labret Titânio", "diamante"), false);
});
