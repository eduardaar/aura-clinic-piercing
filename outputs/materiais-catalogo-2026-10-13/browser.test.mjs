import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createTenant, loginTenant, req, BASE } from "../../backend/tests/helpers.mjs";
import { withTenantSchema } from "../../backend/src/db/tenantSession.js";
import { deprovisionTenant } from "../../backend/src/services/tenants.js";

test("catálogo e compra de materiais em Chromium/WebKit com API e banco isolados", { timeout: 300000 }, async () => {
  const { chromium, webkit } = await import(pathToFileURL(process.env.AURA_PLAYWRIGHT_MODULE).href);
  const output = new URL("./", import.meta.url);
  await mkdir(output, { recursive: true });
  const clinic = await createTenant("qa-store-materials");
  const other = await createTenant("qa-other-store");
  const login = await loginTenant(clinic.slug, clinic.adminEmail, clinic.adminPassword);
  const otherLogin = await loginTenant(other.slug, other.adminEmail, other.adminPassword);
  const api = (path, options = {}) => req(path, { tenant: clinic.slug, token: login.token, ...options });
  const results = [];
  try {
    assert.equal((await api("/subscription", { method: "PATCH", body: { plan_code: "studio" } })).status, 200);
    const supplier = await api("/finance/suppliers", { method: "POST", body: { name: "Fornecedor QA", person_type: "PJ", document: "11222333000181" } });
    assert.equal(supplier.status, 201);
    const otherProduct = await req("/jewelry", { tenant: other.slug, token: otherLogin.token, method: "POST", body: {
      name: "Joia exclusiva da outra clínica", category: "Argolas", quantity: 3, cost_value: 10, sale_value: 50,
      is_catalog_active: true, is_published: true, virtual_store_active: true, can_sell: true, can_publish: true
    } });
    assert.equal(otherProduct.status, 201);
    await withTenantSchema(other.tenant.id, async (db) => { await db.run("UPDATE catalog_theme SET primary_color='#245675', body_font='Arial', brand_name='Outra clínica QA' WHERE id=1"); });
    const products = [];
    for (let index = 0; index < 8; index++) {
      const created = await api("/jewelry", { method: "POST", body: {
        name: index === 1 ? "Labret com cristal e acabamento delicado para composições de orelha" : `Joia QA ${index}`,
        category: index === 7 ? "Argolas" : "Labret", material: "Titânio ASTM F136", color: "natural, bronze, rosa, azul, turquesa, verde, roxo, dourado",
        is_catalog_active: true, is_published: true, virtual_store_active: true, can_sell: true, can_publish: true,
        variants: Array.from({ length: index === 1 ? 11 : 1 }, (_, variant) => ({
          variation_name: `${6 + variant}mm`, material: "Titânio ASTM F136", color: variant ? "Dourado" : "Natural", length: `${6 + variant}mm`,
          quantity: index === 0 || index === 1 && variant === 0 ? 0 : 3, cost_value: 20, sale_value: 120 + variant
        }))
      } });
      assert.equal(created.status, 201, JSON.stringify(created.json));
      products.push(created.json);
    }
    const customization = await api("/catalog-customization", { method: "PATCH", body: {
      theme: { brand_name: "Aura Clinic QA", body_font: "Manrope", show_buy_button: 1, show_favorites: 1, show_schedule_button: 1 },
      settings: { whatsapp_phone: "71999999999", categories: "Labret,Argolas" },
      catalogSections: [
        { section_key: "qa-categories", section_type: "categories", sort_order: 1, is_active: true },
        { section_key: "qa-stock", section_type: "in_stock", display_mode: "grid", sort_order: 2, is_active: true },
        { section_key: "qa-products", section_type: "featured_products", sort_order: 3, is_active: true }
      ]
    } });
    assert.equal(customization.status, 200, JSON.stringify(customization.json));
    const published = await api("/catalog-customization/publish", { method: "POST", body: { expected_draft_version: customization.json.version.draft } });
    assert.equal(published.status, 200, JSON.stringify(published.json));

    for (const [engine, type] of [["chromium", chromium], ["webkit", webkit]].filter(([engine]) => !process.env.AURA_BROWSER_ENGINE || engine === process.env.AURA_BROWSER_ENGINE)) {
      const browser = await type.launch({ headless: true });
      try {
        for (const width of [320, 390, 430, 768, 1366].filter((width) => !process.env.AURA_BROWSER_WIDTH || width === Number(process.env.AURA_BROWSER_WIDTH))) {
          console.log(`Validando ${engine} ${width}px`);
          const context = await browser.newContext({ viewport: { width, height: 900 }, ...(width < 500 ? { hasTouch: true, isMobile: true } : {}) });
          await context.route("**/api/**", async (route) => {
            const url = new URL(route.request().url());
            const response = await route.fetch({ url: `${BASE}${url.pathname.replace(/^\/api/, "")}${url.search}` });
            await route.fulfill({ response });
          });
          const page = await context.newPage();
          const errors = [];
          page.on("pageerror", (error) => { if (!/^ResizeObserver loop/.test(error.message)) errors.push(error.message); });
          try {
            const origin = process.env.AURA_BROWSER_ORIGIN || "http://127.0.0.1:5187";
            await page.goto(`${origin}/catalogo?t=${clinic.slug}`);
            const grid = page.locator("#catalog-products");
            await grid.locator(".catalog-product-card").first().waitFor();
            assert.equal(await grid.locator(".catalog-product-card").count(), 8);
            const layout = await grid.evaluate((node) => ({
              columns: getComputedStyle(node).gridTemplateColumns.split(" ").length,
              overflow: document.documentElement.scrollWidth > innerWidth + 1,
              cards: [...node.children].map((card) => ({ top: card.getBoundingClientRect().top, height: card.getBoundingClientRect().height })),
              images: [...node.querySelectorAll("img")].every((image) => getComputedStyle(image).objectFit === "contain")
            }));
            assert.equal(layout.overflow, false, `${engine} ${width}: page overflow`);
            assert.equal(layout.images, true);
            if (width < 360) assert.equal(layout.columns, 1);
            else if (width < 768) assert.equal(layout.columns, 2);
            else if (width < 1024) assert.ok(layout.columns >= 2);
            else assert.ok(layout.columns >= 3);
            for (const card of layout.cards) for (const peer of layout.cards.filter((entry) => Math.abs(entry.top - card.top) < 1)) assert.ok(Math.abs(card.height - peer.height) <= 1);
            const long = grid.locator(".catalog-product-card").filter({ hasText: products[1].name });
            assert.ok((await long.innerText()).includes("11 variações"));
            assert.ok(!(await long.innerText()).includes("turquesa"));
            assert.ok(!(await long.innerText()).includes("via Pix"));
            assert.equal(await long.locator("h2 a").evaluate((node) => getComputedStyle(node).webkitLineClamp), "2");
            await page.screenshot({ path: fileURLToPath(new URL(`catalog-${engine}-${width}.png`, output)), fullPage: true });
            await page.screenshot({ path: fileURLToPath(new URL(`viewport-${engine}-${width}.png`, output)) });
            await long.getByRole("button", { name: "Favoritar", exact: true }).click();
            await page.reload();
            await grid.locator(".catalog-product-card").first().waitFor();
            assert.equal(await long.getByRole("button", { name: "Remover dos favoritos" }).getAttribute("aria-pressed"), "true");
            await page.locator(".catalog-category-strip").getByRole("button", { name: "Argolas", exact: true }).click();
            assert.equal(await grid.locator(".catalog-product-card").count(), 1);
            await page.locator(".catalog-category-strip").getByRole("button", { name: "Todos", exact: true }).click();
            const search = page.locator(".catalog-search input:visible").first();
            await search.fill("cristal");
            await page.waitForFunction(() => document.querySelectorAll("#catalog-products .catalog-product-card").length === 1);
            await page.waitForURL((url) => url.searchParams.get("q") === "cristal");
            await page.reload();
            await grid.locator(".catalog-product-card").first().waitFor();
            assert.equal(await grid.locator(".catalog-product-card").count(), 1);
            await search.fill("");
            await page.waitForFunction(() => document.querySelectorAll("#catalog-products .catalog-product-card").length === 8);
            await page.goto(`${origin}/catalogo/produto/${products[0].id}?t=${clinic.slug}`);
            await page.getByRole("link", { name: "Pedir pelo WhatsApp" }).waitFor();
            assert.equal(await page.getByRole("button", { name: /Adicionar 1 ao carrinho/ }).count(), 0);
            const contact = new URL(await page.getByRole("link", { name: "Pedir pelo WhatsApp" }).getAttribute("href")).searchParams.get("text");
            assert.ok(contact.includes(`variant=${products[0].variants[0].id}`));
            await page.goto(`${origin}/catalogo/produto/${products[1].id}?t=${clinic.slug}&variant=${products[1].variants[0].id}`);
            await page.getByRole("link", { name: "Pedir pelo WhatsApp" }).waitFor();
            await page.getByLabel("Escolha a Variação").click();
            assert.equal(await page.getByRole("option").count(), 11);
            await page.getByRole("option", { name: /7mm/ }).first().click();
            await page.getByRole("button", { name: "Adicionar 1 ao carrinho", exact: true }).click();
            await page.getByRole("dialog").waitFor();
            const order = await page.evaluate((slug) => JSON.parse(localStorage.getItem(`aura-catalog-order:${slug}`)), clinic.slug);
            assert.equal(order[0].selected_variant_id, products[1].variants[1].id);
            assert.equal(Number(order[0].sale_value), Number(products[1].variants[1].sale_value));
            await page.goto(`${origin}/catalogo?t=${other.slug}`);
            await page.locator(".catalog-results").first().waitFor();
            await page.getByRole("heading", { name: otherProduct.json.name, exact: true }).first().waitFor();
            assert.equal(await page.getByRole("heading", { name: products[1].name, exact: true }).count(), 0);
            assert.equal(await page.locator(".catalog-page").evaluate((node) => getComputedStyle(node).getPropertyValue("--catalog-primary").trim()), "#245675");

            if ([390, 1366].includes(width)) {
              await context.addInitScript(({ session, slug }) => { localStorage.setItem("aura-session", JSON.stringify(session)); localStorage.setItem("aura-tenant", slug); }, { session: login, slug: clinic.slug });
              await page.goto(`${origin}/app/produtos/estoque?t=${clinic.slug}`);
              await page.getByRole("tab", { name: "Materiais de procedimento" }).click();
              await page.getByRole("button", { name: "Novo material", exact: true }).click();
              const materialName = `Gaze navegador ${engine} ${width}`;
              await page.getByLabel("Nome do material", { exact: true }).fill(materialName);
              await page.getByLabel("Categoria", { exact: true }).click();
              await page.getByRole("option", { name: "Labret", exact: true }).click();
              await page.getByLabel("Quantidade em estoque", { exact: true }).fill("2");
              await page.getByLabel("Custo unitário", { exact: true }).fill("2.50");
              await page.getByLabel("Estoque mínimo", { exact: true }).fill("1");
              await page.getByLabel("Fornecedor (opcional)", { exact: true }).click();
              await page.getByRole("option", { name: "Fornecedor QA", exact: true }).click();
              const savedMaterial = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/jewelry");
              await page.getByRole("button", { name: "Cadastrar item", exact: true }).click();
              const materialResponse = await savedMaterial;
              assert.equal(materialResponse.status(), 201);
              assert.equal(materialResponse.request().postDataJSON().can_publish, false, `${engine} ${width}: payload do material não publica por padrão`);
              const material = await materialResponse.json();
              await page.getByRole("dialog").waitFor({ state: "hidden" });
              const persisted = (await api("/jewelry")).json.find((item) => item.id === material.id);
              assert.equal(persisted.name.toLowerCase(), materialName.toLowerCase());
              assert.ok(material, "cadastro do navegador persistiu no ERP");
              assert.equal(Number(material.can_publish), 0);
              await page.goto(`${origin}/app/compras?t=${clinic.slug}`);
              await page.getByRole("button", { name: "Nova compra", exact: true }).click();
              await page.getByLabel("Fornecedor", { exact: true }).click();
              await page.getByRole("option", { name: "Fornecedor QA", exact: true }).click();
              await page.getByRole("button", { name: /2\. Itens/ }).click();
              await page.getByLabel("Tipo de item", { exact: true }).click();
              await page.getByRole("option", { name: "Material de consumo", exact: true }).click();
              await page.getByLabel("Material", { exact: true }).click();
              await page.getByRole("option", { name: new RegExp(material.name) }).click();
              await page.getByLabel("Quantidade", { exact: true }).fill("3");
              await page.getByLabel("Custo unitário", { exact: true }).fill("5.00");
              await page.getByRole("button", { name: "Adicionar item", exact: true }).click();
              await page.getByRole("button", { name: /3\. Pagamento/ }).click();
              await page.getByRole("button", { name: "Confirmar compra", exact: true }).click();
              await page.getByRole("dialog").waitFor({ state: "hidden" });
              await withTenantSchema(clinic.tenant.id, async (db) => {
                const row = await db.get("SELECT quantity, cost_value FROM jewelry_inventory WHERE id=?", [material.id]);
                assert.equal(Number(row.quantity), 5);
                assert.equal(Number(row.cost_value), 4);
                const movement = await db.get("SELECT COUNT(*)::int AS n FROM stock_movements WHERE jewelry_id=? AND purchase_order_id IS NOT NULL", [material.id]);
                assert.equal(movement.n, 1);
              });
            }
            assert.deepEqual(errors, []);
            results.push({ engine, width, columns: layout.columns, noOverflow: true, equalCardHeights: true, imageContain: true, variants: 11, favoritesReload: true, searchReload: true, categoryFilter: true, cart: true, unavailableContact: true, tenantIsolation: true, materialPurchase: [390, 1366].includes(width) });
          } finally { await context.close(); }
        }
      } finally { await browser.close(); }
    }
    await writeFile(new URL("browser-results.json", output), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results));
  } finally { await deprovisionTenant(clinic.tenant.id); await deprovisionTenant(other.tenant.id); }
});
