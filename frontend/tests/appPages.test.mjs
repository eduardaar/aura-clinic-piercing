import assert from "node:assert/strict";
import test from "node:test";
import { APP_PAGES, INTERNAL_APP_PAGES, appPageById, menuPages, publicPageForPath } from "../src/lib/appPages.js";
import { appPathForPage, pageForAppPath } from "../src/lib/appRoutes.js";
import { PAGE_FEATURE, PAGE_PERMISSION, allowedPagesForRole, pageTitle } from "../src/lib/permissions.js";

test("registro possui ids únicos e metadados completos nas páginas internas", () => {
  assert.equal(new Set(APP_PAGES.map(({ id }) => id)).size, APP_PAGES.length);
  for (const page of INTERNAL_APP_PAGES) {
    assert.ok(page.path.startsWith("/app/"), `${page.id} sem rota interna`);
    assert.ok(page.title, `${page.id} sem título`);
    assert.equal(typeof page.component, "object", `${page.id} sem componente lazy`);
  }
});

test("rotas canônicas e aliases antigos derivam do registro", () => {
  assert.equal(appPathForPage("receivables"), "/app/financeiro/receber");
  assert.equal(pageForAppPath("/app/financeiro"), "receivables");
  assert.equal(pageForAppPath("/app/financeiro/cadastros/"), "suppliers");
  assert.equal(pageForAppPath("/app"), "dashboard");
  assert.equal(pageForAppPath("/app/desconhecida"), null);
});

test("permissões, features, títulos e ordem dos papéis usam APP_PAGES", () => {
  assert.equal(PAGE_PERMISSION.purchases, appPageById("purchases").permission);
  assert.equal(PAGE_PERMISSION.audit, "audit.view");
  assert.equal(pageForAppPath("/app/auditoria"), "audit");
  assert.equal(PAGE_FEATURE.terms, appPageById("terms").feature);
  assert.equal(pageTitle("postcare"), appPageById("postcare").title);
  assert.deepEqual(allowedPagesForRole("finance").slice(0, 3), ["receivables", "payables", "purchases"]);
});

test("menu e páginas públicas preservam agrupamento e correspondência", () => {
  const menu = menuPages();
  assert.deepEqual(menu.map(({ group }) => group), [
    "Início", "Atendimento", "Comercial", "Estoque e compras", "Financeiro", "Gestão", "Configurações"
  ]);
  assert.deepEqual(menu.find(({ group }) => group === "Estoque e compras").pages.map(({ id }) => id), [
    "inventory", "purchases", "suppliers"
  ]);
  assert.deepEqual(menu.find(({ group }) => group === "Gestão").pages.map(({ id }) => id), ["reports", "audit"]);
  assert.deepEqual(menu.find(({ group }) => group === "Financeiro").pages.map(({ id }) => id), ["receivables"]);
  assert.equal(menuPages({ onboardingComplete: true }).flatMap(({ pages }) => pages).some(({ id }) => id === "onboarding"), false);
  // A navegação foi simplificada ao longo da release (a575523f, da8f96ca e
  // seguintes): o registro não pendura mais submenus (`menuChildren`) sob
  // Clientes, Agenda, Vendas e Financeiro. Cada tela permanece no registro e é
  // alcançada pela própria rota canônica — é isso que precisa continuar valendo.
  assert.equal(APP_PAGES.some((page) => page.menuChildren), false);
  assert.equal(pageForAppPath("/app/clientes/termos"), "terms");
  assert.equal(pageForAppPath("/app/clientes/pos-atendimento"), "postcare");
  assert.equal(pageForAppPath("/app/agenda"), "agenda");
  assert.equal(pageForAppPath("/app/servicos"), "services");
  assert.equal(pageForAppPath("/app/vendas"), "sales");
  assert.equal(pageForAppPath("/app/financeiro/receber"), "receivables");
  assert.equal(publicPageForPath("/catalogo/produto/42").id, "public-catalog");
  assert.equal(publicPageForPath("/politica-de-privacidade").documentKey, "privacy_policy");
  assert.equal(publicPageForPath("/novidades/agenda-renovada").id, "news");
  assert.equal(pageForAppPath("/app/ajuda/manual"), "manual");
  assert.equal(publicPageForPath("/app/dashboard"), null);
});
