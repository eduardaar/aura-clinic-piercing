import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultPageForPlan,
  planAllowsAction,
  planAllowsPage,
  resolveAccessiblePage
} from "../src/lib/permissions.js";

test("Start mantém catálogo e vendas, mas não gera contas a receber", () => {
  const startFeatures = ["basic_inventory", "basic_catalog", "basic_reports"];

  assert.equal(planAllowsPage(startFeatures, "catalog"), true);
  assert.equal(planAllowsPage(startFeatures, "sales"), true);
  assert.equal(planAllowsPage(startFeatures, "products"), true);
  assert.equal(planAllowsPage(startFeatures, "inventory"), true);
  assert.equal(planAllowsAction(startFeatures, "sales.generate_receivables"), false);
  assert.equal(planAllowsAction(startFeatures, "appointments.generate_receivables"), false);
});

test("Profissional libera as ações que geram contas a receber", () => {
  const professionalFeatures = ["basic_catalog", "basic_inventory", "basic_finance"];
  assert.equal(planAllowsAction(professionalFeatures, "sales.generate_receivables"), true);
  assert.equal(planAllowsAction(professionalFeatures, "appointments.generate_receivables"), true);
});

test("perfil financeiro sem módulo contratado cai em uma tela operacional permitida", () => {
  assert.equal(defaultPageForPlan("finance", ["basic_catalog"]), "sales");
});

test("rota direta fora do plano leva admin ao upgrade e demais perfis ao fallback", () => {
  assert.equal(resolveAccessiblePage("admin", "receivables", ["basic_catalog"]), "meu-plano");
  assert.equal(resolveAccessiblePage("finance", "receivables", ["basic_catalog"]), "sales");
  assert.equal(resolveAccessiblePage("admin", "receivables", [], false), "receivables");
});
