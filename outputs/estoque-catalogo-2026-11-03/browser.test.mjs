import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BASE, createTenant, loginTenant, req } from "../../backend/tests/helpers.mjs";
import { withTenantSchema } from "../../backend/src/db/tenantSession.js";
import { deprovisionTenant } from "../../backend/src/services/tenants.js";

test("estoque e catálogo persistem edição, ordenação, esgotamento e reposição em navegador real", { timeout: 240000 }, async () => {
  assert.ok(process.env.AURA_PLAYWRIGHT_MODULE, "Informe o módulo Playwright instalado em AURA_PLAYWRIGHT_MODULE");
  const { chromium, webkit } = await import(pathToFileURL(process.env.AURA_PLAYWRIGHT_MODULE).href);
  const output = new URL("./", import.meta.url);
  await mkdir(output, { recursive: true });
  const clinic = await createTenant("qa-stock-browser");
  const login = await loginTenant(clinic.slug, clinic.adminEmail, clinic.adminPassword);
  const api = (path, options = {}) => req(path, { tenant: clinic.slug, token: login.token, ...options });
  const results = [];
  const origin = process.env.AURA_BROWSER_ORIGIN || "http://127.0.0.1:5187";
  try {
    const products = [];
    for (const [name, price, is_new] of [["Argola Antiga", 100, true], ["Argola Adicionada", 50, false], ["Argola Nova", 80, true]]) {
      const created = await api("/jewelry", { method: "POST", body: {
        name, category: "Argolas", quantity: 6, low_stock_threshold: 5, cost_value: 17, sale_value: price,
        can_sell: true, can_publish: true, is_catalog_active: true, is_published: true, virtual_store_active: true, is_new
      } });
      assert.equal(created.status, 201, JSON.stringify(created.json));
      products.push(created.json);
    }
    const customization = await api("/catalog-customization", { method: "PATCH", body: {
      catalogSections: [
        { section_key: "qa-categories", section_type: "categories", sort_order: 1, is_active: true },
        { section_key: "qa-products", section_type: "featured_products", product_sort: "price_desc", sort_order: 2, is_active: true }
      ]
    } });
    assert.equal(customization.status, 200, JSON.stringify(customization.json));
    assert.equal((await api("/catalog-customization/publish", { method: "POST", body: { expected_draft_version: customization.json.version.draft } })).status, 200);

    for (const [engine, type] of [["chromium", chromium], ["webkit", webkit]]) {
      const browser = await type.launch({ headless: true });
      try {
        for (const width of [390, 1366]) {
          const context = await browser.newContext({ viewport: { width, height: 900 } });
          const errors = [];
          let page;
          try {
            await context.route("**/api/**", async (route) => {
              const url = new URL(route.request().url());
              const response = await route.fetch({ url: `${BASE}${url.pathname.replace(/^\/api/, "")}${url.search}` });
              await route.fulfill({ response });
            });
            await context.addInitScript(({ session, slug }) => {
              localStorage.setItem("aura-session", JSON.stringify(session));
              localStorage.setItem("aura-tenant", slug);
            }, { session: login, slug: clinic.slug });
            page = await context.newPage();
            page.on("pageerror", (error) => errors.push(error.message));
            const catalogUrl = `${origin}/catalogo?t=${clinic.slug}`;
            const added = products[1];
            assert.equal((await api(`/jewelry/${added.id}`, { method: "PATCH", body: { is_new: false } })).status, 200);
            await page.goto(catalogUrl);
            const grid = page.locator("#catalog-products");
            await grid.locator("article").first().waitFor();
            console.log(`${engine} ${width}px: catálogo carregado`);
            assert.equal(await grid.locator("article").count(), 3);
            await page.getByLabel("Ordenar catálogo").click();
            await page.getByRole("option", { name: "Lançamentos", exact: true }).click();
            assert.deepEqual(await grid.locator("article h2").allTextContents(), [products[2].name, products[0].name, added.name]);
            await page.waitForURL((url) => url.searchParams.get("sort") === "lancamentos");
            await page.reload();
            await grid.locator("article").first().waitFor();
            assert.equal(await grid.locator("article h2").first().textContent(), products[2].name);
            console.log(`${engine} ${width}px: ordenação e recarga conferidas`);

            // O produto de seis unidades aparece como baixo, e pode ser editado e salvo sem perder o saldo/preço.
            await page.goto(`${origin}/app/produtos/estoque?t=${clinic.slug}`);
            const row = page.locator(".inventory-product-cell").filter({ hasText: added.name });
            await row.waitFor();
            assert.ok((await row.locator("xpath=ancestor::tr").innerText()).includes("Baixo estoque"));
            await row.click();
            const dialog = page.getByRole("dialog");
            await dialog.getByRole("tab", { name: "Comercial", exact: true }).click();
            await dialog.getByRole("switch", { name: "Lançamento", exact: true }).click();
            const saved = page.waitForResponse((response) => response.request().method() === "PATCH" && new URL(response.url()).pathname === `/api/jewelry/${added.id}`);
            await dialog.getByRole("button", { name: "Salvar item", exact: true }).click();
            assert.equal((await saved).status(), 200);
            await dialog.waitFor({ state: "hidden" });
            await withTenantSchema(clinic.tenant.id, async (db) => {
              const product = await db.get("SELECT quantity,cost_value,sale_value,is_new FROM jewelry_inventory WHERE id=?", [added.id]);
              assert.equal(Number(product.quantity), 6);
              assert.equal(Number(product.cost_value), 17);
              assert.equal(Number(product.sale_value), 50);
              assert.equal(Number(product.is_new), 1);
            });
            await page.goto(`${catalogUrl}&sort=lancamentos`);
            await grid.locator("article").first().waitFor();
            assert.deepEqual(await grid.locator("article h2").allTextContents(), [products[2].name, added.name, products[0].name]);
            await page.getByLabel("Preço máximo", { exact: true }).fill("60");
            await page.waitForFunction(() => document.querySelectorAll("#catalog-products article").length === 1);
            assert.equal(await grid.locator("article h2").textContent(), added.name);
            await page.getByRole("button", { name: "Limpar filtros", exact: true }).click();
            await page.waitForFunction(() => document.querySelectorAll("#catalog-products article").length === 3);

            assert.equal((await api(`/jewelry/${added.id}/movements`, { method: "POST", body: { movement_type: "Saída", quantity: 6 } })).status, 200);
            await page.reload();
            const card = grid.locator("article").filter({ hasText: added.name });
            await card.waitFor();
            assert.ok((await card.innerText()).includes("Esgotado"));
            assert.equal((await api(`/jewelry/${added.id}/movements`, { method: "POST", body: { movement_type: "Entrada", quantity: 6 } })).status, 200);
            await page.reload();
            await card.waitFor();
            assert.ok(!(await card.innerText()).includes("Esgotado"));
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
            assert.deepEqual(errors, []);
            await page.screenshot({ path: fileURLToPath(new URL(`catalog-${engine}-${width}.png`, output)), fullPage: true });
            results.push({ engine, width, sortAndReload: true, editedLaunchPersisted: true, priceAndStockPreserved: true, combinedFilters: true, restock: true, noOverflow: true, pageErrors: 0 });
            console.log(`Aprovado: ${engine} ${width}px`);
          } catch (error) {
            if (page) await page.screenshot({ path: fileURLToPath(new URL(`failure-${engine}-${width}.png`, output)), fullPage: true }).catch(() => {});
            throw error;
          } finally {
            await context.close();
          }
        }
      } finally {
        await browser.close();
      }
    }
    await writeFile(new URL("browser-results.json", output), JSON.stringify(results, null, 2));
  } finally {
    await deprovisionTenant(clinic.tenant.id);
  }
});
