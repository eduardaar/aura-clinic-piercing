import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createTenant, loginTenant, req, BASE } from "../../backend/tests/helpers.mjs";
import { withTenantSchema } from "../../backend/src/db/tenantSession.js";
import { deprovisionTenant } from "../../backend/src/services/tenants.js";

test("despesas e reposições no aplicativo real em desktop e mobile", { timeout: 360000 }, async () => {
  const { chromium, webkit } = await import(pathToFileURL(process.env.AURA_PLAYWRIGHT_MODULE).href);
  const clinic = await createTenant("qa-ops-browser");
  const login = await loginTenant(clinic.slug, clinic.adminEmail, clinic.adminPassword);
  const api = (path, options = {}) => req(path, { tenant: clinic.slug, token: login.token, ...options });
  const origin = process.env.AURA_BROWSER_ORIGIN || "http://127.0.0.1:5187";
  const results = [];
  try {
    assert.equal((await api("/subscription", { method: "PATCH", body: { plan_code: "studio" } })).status, 200);
    const supplier = await api("/finance/suppliers", { method: "POST", body: { name: "Fornecedor QA", person_type: "PJ", document: "11222333000181" } });
    assert.equal(supplier.status, 201);
    for (const [engine, type] of [["chromium", chromium], ["webkit", webkit]].filter(([engine]) => !process.env.AURA_BROWSER_ENGINE || engine === process.env.AURA_BROWSER_ENGINE)) {
      const browser = await type.launch({ headless: true });
      try {
        for (const width of [320, 390, 1366]) {
          console.log(`Validando despesas e compras: ${engine} ${width}px`);
          const context = await browser.newContext({ viewport: { width, height: 900 }, ...(width < 500 ? { hasTouch: true, isMobile: true } : {}) });
          await context.route("**/api/**", async (route) => {
            const url = new URL(route.request().url());
            const response = await route.fetch({ url: `${BASE}${url.pathname.replace(/^\/api/, "")}${url.search}` });
            await route.fulfill({ response });
          });
          await context.addInitScript(({ session, slug }) => {
            localStorage.setItem("aura-session", JSON.stringify(session)); localStorage.setItem("aura-tenant", slug);
          }, { session: login, slug: clinic.slug });
          const page = await context.newPage();
          page.setDefaultTimeout(15000);
          const errors = [];
          page.on("pageerror", (error) => { if (!/^ResizeObserver loop/.test(error.message)) errors.push(error.message); });
          const select = async (label, option) => {
            await page.getByLabel(label, { exact: true }).click();
            await page.getByRole("option", { name: option, exact: true }).click();
          };
          const assertFits = async () => {
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "página sem rolagem horizontal");
            const dialog = page.getByRole("dialog");
            if (await dialog.count()) assert.ok(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1), "modal sem rolagem horizontal");
            if (await dialog.count()) assert.deepEqual(await page.locator(".modal-body input, .modal-body .ui-select-trigger, .modal-body .transaction-totals").evaluateAll((nodes) => nodes.filter((node) => node.getBoundingClientRect().width && node.getBoundingClientRect().right > innerWidth + 1).map((node) => node.getAttribute("aria-label") || node.className)), [], "campos e totais não podem ficar cortados");
          };
          try {
            const before = (await api("/jewelry")).json.map(({ id, quantity, cost_value }) => ({ id, quantity, cost_value }));
            for (const [category, amount] of [["Aluguel", 1500], ["Água", 100], ["Energia elétrica", 250]]) {
              await page.goto(`${origin}/app/financeiro/pagar?t=${clinic.slug}`);
              await page.getByRole("button", { name: "Nova conta a pagar", exact: true }).click();
              const description = `${category} ${engine} ${width}`;
              await page.getByLabel("Descrição", { exact: true }).fill(description);
              await select("Categoria", category);
              await page.getByLabel("Valor total", { exact: true }).fill(String(amount));
              await page.getByLabel("Primeiro vencimento", { exact: true }).fill("2026-10-19");
              await select("Situação da despesa", "Já paga");
              await page.getByLabel("Data do pagamento", { exact: true }).fill("2026-10-18");
              await assertFits();
              if (category === "Aluguel") await page.screenshot({ path: new URL(`expense-${engine}-${width}.png`, import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"), fullPage: true });
              assert.deepEqual(await page.locator("#payable-form input").evaluateAll((nodes) => nodes.filter((node) => !node.validity.valid).map((node) => ({ value: node.value, type: node.type, error: node.validationMessage }))), [], "campos da despesa válidos");
              const saved = page.waitForResponse((res) => res.request().method() === "POST" && new URL(res.url()).pathname === "/api/finance/entries");
              await page.getByRole("button", { name: "Salvar conta", exact: true }).click();
              const response = await saved;
              assert.equal(response.status(), 201, await response.text());
              const entry = (await response.json())[0];
              assert.equal(entry.category, category);
              assert.equal(Number(entry.paid_amount), amount);
              assert.equal(entry.paid_at, "2026-10-18");
              await page.getByRole("dialog").waitFor({ state: "hidden" });
              const report = await api(`/reports/payables?from=2026-10-01&to=2026-10-31&category=${encodeURIComponent(category)}`);
              assert.ok(report.json.rows.some((row) => row.id === entry.id && row.description === description));
            }
            assert.deepEqual((await api("/jewelry")).json.map(({ id, quantity, cost_value }) => ({ id, quantity, cost_value })), before);

            for (const material of [true, false]) {
              let item;
              if (material) {
                await page.goto(`${origin}/app/produtos/estoque?t=${clinic.slug}`);
                await page.getByRole("tab", { name: "Materiais de procedimento" }).click();
                await page.getByRole("button", { name: "Novo material", exact: true }).click();
                await page.getByLabel("Nome do material", { exact: true }).fill(`Gaze ${engine} ${width}`);
                await select("Categoria", "Materiais de consumo");
                await page.getByLabel("Quantidade em estoque", { exact: true }).fill("2");
                await page.getByLabel("Custo unitário", { exact: true }).fill("10");
                await assertFits();
                const saved = page.waitForResponse((res) => res.request().method() === "POST" && new URL(res.url()).pathname === "/api/jewelry");
                await page.getByRole("button", { name: "Cadastrar item", exact: true }).click();
                const response = await saved;
                assert.equal(response.status(), 201, await response.text());
                item = await response.json();
                await page.getByRole("dialog").waitFor({ state: "hidden" });
              } else {
                const created = await api("/jewelry", { method: "POST", body: { name: `Joia ${engine} ${width}`, category: "Labret", can_sell: true, track_stock: true, variants: [{ variation_name: "Padrão", quantity: 2, cost_value: 10, sale_value: 50 }] } });
                assert.equal(created.status, 201); item = created.json;
              }
              await page.goto(`${origin}/app/compras?t=${clinic.slug}`);
              await page.getByRole("button", { name: "Nova compra", exact: true }).click();
              await select("Fornecedor", "Fornecedor QA");
              await page.getByLabel("Descrição da compra (opcional)", { exact: true }).fill(`Reposição ${item.name}`);
              await page.getByRole("button", { name: /2\. Itens/ }).click();
              if (material) await select("Tipo de item", "Material de consumo");
              await page.getByLabel(material ? "Material" : "Produto", { exact: true }).click();
              await page.getByRole("option", { name: new RegExp(item.name) }).click();
              await page.getByLabel("Quantidade", { exact: true }).fill("3");
              await page.getByLabel("Custo unitário", { exact: true }).fill("20");
              await page.getByRole("button", { name: "Adicionar item", exact: true }).click();
              await page.getByRole("button", { name: /3\. Pagamento/ }).click();
              await page.getByText("Valores e classificação", { exact: true }).click();
              await select("Categoria financeira", material ? "Materiais de consumo" : "Compras de joias para revenda");
              await assertFits();
              if (material) await page.screenshot({ path: new URL(`purchase-${engine}-${width}.png`, import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"), fullPage: true });
              const saved = page.waitForResponse((res) => res.request().method() === "POST" && new URL(res.url()).pathname === "/api/purchases");
              await page.getByRole("button", { name: "Confirmar compra", exact: true }).click();
              const response = await saved;
              assert.equal(response.status(), 201, await response.text());
              assert.equal((await response.json()).description, `Reposição ${item.name}`);
              await page.getByRole("dialog").waitFor({ state: "hidden" });
              await withTenantSchema(clinic.tenant.id, async (db) => {
                const stock = await db.get("SELECT quantity,cost_value FROM jewelry_inventory WHERE id=?", [item.id]);
                assert.equal(Number(stock.quantity), 5); assert.equal(Number(stock.cost_value), 16);
              });
            }
            assert.deepEqual(errors, []);
            results.push({ engine, width, expenses: 3, stockPurchases: 2, stockUnaffectedByExpenses: true, weightedCost: 16, noOverflow: true, reports: true });
          } catch (error) {
            await writeFile(new URL(`layout-${engine}-${width}.json`, import.meta.url), JSON.stringify(await page.evaluate(() => [...document.querySelectorAll(".modal-body *")].filter((node) => node.getBoundingClientRect().right > innerWidth + 1).map((node) => ({ tag: node.tagName, className: node.className, width: node.getBoundingClientRect().width, right: node.getBoundingClientRect().right, grid: getComputedStyle(node).gridTemplateColumns }))), null, 2));
            await page.screenshot({ path: new URL(`failure-${engine}-${width}.png`, import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"), fullPage: true });
            throw error;
          } finally { await context.close(); }
        }
      } finally { await browser.close(); }
    }
    await writeFile(new URL("browser-results.json", import.meta.url), JSON.stringify(results, null, 2));
  } finally { await deprovisionTenant(clinic.tenant.id); }
});
