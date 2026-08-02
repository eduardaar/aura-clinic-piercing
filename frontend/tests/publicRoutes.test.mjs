import assert from "node:assert/strict";
import test from "node:test";
import { catalogUrl, publicLinkForTenant, publicUrl, replaceCatalogState } from "../src/lib/publicRoutes.js";

function withLocation(pathname, search, callback) {
  const calls = [];
  global.window = {
    location: { pathname, search },
    history: {
      state: { keep: true },
      replaceState: (...args) => calls.push(args)
    }
  };
  callback(calls);
  delete global.window;
}

test("links compartilháveis sempre incluem o tenant e rejeitam slug vazio", () => {
  assert.equal(publicLinkForTenant("/catalogo", "clinica-a", "https://aura.test"), "https://aura.test/catalogo?t=clinica-a");
  assert.equal(publicLinkForTenant("/agendar", "clínica b", "https://aura.test"), "https://aura.test/agendar?t=cl%C3%ADnica+b");
  assert.throws(() => publicLinkForTenant("/catalogo", "", "https://aura.test"), /slug público/);
});

test("produto mantém tenant e estado do catálogo", () => {
  withLocation("/catalogo", "?t=aura-clinic&category=Argolas&q=ouro&sort=nome-az", () => {
    assert.equal(
      catalogUrl("/catalogo/produto/42"),
      "/catalogo/produto/42?t=aura-clinic&category=Argolas&q=ouro&sort=nome-az"
    );
  });
});

test("agendamento mantém tenant sem carregar filtros irrelevantes", () => {
  withLocation("/catalogo/produto/42", "?t=aura-clinic&category=Argolas", () => {
    assert.equal(
      publicUrl("/agendar", { jewelry_id: 42, jewelry_variant_id: 7 }),
      "/agendar?t=aura-clinic&jewelry_id=42&jewelry_variant_id=7"
    );
  });
});

test("atualização de filtros nunca remove o tenant", () => {
  withLocation("/catalogo", "?t=aura-clinic&category=Antiga", (calls) => {
    replaceCatalogState({ category: "Piercings", q: "titânio" });
    assert.deepEqual(calls[0], [
      { keep: true },
      "",
      "/catalogo?t=aura-clinic&category=Piercings&q=tit%C3%A2nio"
    ]);
  });
});
