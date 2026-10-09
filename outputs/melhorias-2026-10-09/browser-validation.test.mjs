import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createTenant, loginTenant, req, BASE } from "../../backend/tests/helpers.mjs";
import { withTenantSchema } from "../../backend/src/db/tenantSession.js";
import { deprovisionTenant } from "../../backend/src/services/tenants.js";

test("Chromium/WebKit: edição, seleção, agenda responsiva e pagamento dividido com sinal", { timeout: 300000 }, async () => {
  const { chromium, webkit } = await import(pathToFileURL(process.env.AURA_PLAYWRIGHT_MODULE).href);
  const tenant = await createTenant("qa-improvements-browser");
  const token = (await loginTenant(tenant.slug, tenant.adminEmail, tenant.adminPassword)).token;
  const api = (path, options = {}) => req(path, { tenant: tenant.slug, token, ...options });
  const sql = (fn) => withTenantSchema(tenant.tenant.id, fn);
  let slot = 0;
  let checks = 0;
  let resizeObserverNotifications = 0;
  try {
    assert.equal((await api("/subscription", { method: "PATCH", body: { plan_code: "studio" } })).status, 200);
    const professional = (await api("/professionals", { method: "POST", body: { name: "Profissional navegador" } })).json.id;
    const service = (await api("/services", { method: "POST", body: { name: "Procedimento navegador", price: 145, deposit_value: 25, duration_minutes: 30 } })).json.id;
    for (const [engine, type] of [["chromium", chromium], ["webkit", webkit]].filter(([engine]) => !process.env.AURA_BROWSER_ENGINE || engine === process.env.AURA_BROWSER_ENGINE)) {
      const browser = await type.launch({ headless: true });
      try {
        for (const viewport of [{ width: 320, height: 844 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1366, height: 768 }, { width: 844, height: 390 }].filter((viewport) => !process.env.AURA_BROWSER_WIDTH || viewport.width === Number(process.env.AURA_BROWSER_WIDTH))) {
          slot++;
          const created = await api("/appointments", { method: "POST", body: {
            full_name: `Cliente edição ${slot}`, whatsapp: `1197000${String(slot).padStart(4, "0")}`, professional_id: professional, service_id: service,
            procedure: "Procedimento navegador", piercing_region: "Orelha", appointment_date: new Date(Date.UTC(2026, 10, slot)).toISOString().slice(0, 10),
            appointment_time: "10:00", status: "confirmado", deposit_value: 25, deposit_status: "pago", deposit_payment_method: "Pix"
          } });
          assert.equal(created.status, 201, JSON.stringify(created.json));
          const item = created.json;
          const context = await browser.newContext({ viewport, ...(viewport.width < 500 ? { hasTouch: true, isMobile: true } : {}) });
          await context.route("**/api/**", async (route) => {
            const request = route.request();
            const url = new URL(request.url());
            const response = await route.fetch({ url: `${BASE}${url.pathname.slice(4)}${url.search}`, headers: { ...request.headers(), origin: new URL(BASE).origin } });
            await route.fulfill({ response });
          });
          const page = await context.newPage();
          const errors = [];
          page.on("pageerror", (error) => {
            // Mesmo ruído já classificado por lib/errorReporter.js; não é erro
            // de negócio. Outros erros de renderização continuam bloqueando.
            if (/^ResizeObserver loop (?:completed with undelivered notifications\.|limit exceeded)/.test(error.message)) resizeObserverNotifications++;
            else errors.push(error.message);
          });
          try {
            await page.goto(`http://127.0.0.1:5184/login?t=${tenant.slug}`);
            await page.getByLabel("E-mail", { exact: true }).fill(tenant.adminEmail);
            await page.getByLabel("Senha", { exact: true }).fill(tenant.adminPassword);
            await page.getByRole("button", { name: "Entrar", exact: true }).click();
            await page.waitForURL("**/app/**");
            await page.goto(`http://127.0.0.1:5184/.qa-improvements.html?qa_appointment=${item.id}`);
            await page.getByRole("button", { name: "Agenda QA", exact: true }).waitFor();
            const layout = async () => {
              assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${engine} ${viewport.width}x${viewport.height}: overflow`);
              assert.deepEqual(errors, []);
              checks++;
            };
            await layout();
            await page.getByRole("button", { name: "Cliente QA", exact: true }).click();
            const name = page.getByLabel("Nome civil completo", { exact: true });
            await name.waitFor();
            await name.fill("Ana exemplo");
            await name.evaluate((input) => { input.focus(); input.setSelectionRange(0, 1); });
            await name.press("Backspace");
            assert.equal(await name.inputValue(), "na exemplo"); checks++;
            await name.evaluate((input) => { input.focus(); input.setSelectionRange(0, input.value.length); });
            await name.press("Delete");
            assert.equal(await name.inputValue(), ""); checks++;
            const phone = page.getByLabel("WhatsApp", { exact: true });
            await phone.fill("11999998888");
            await phone.press("Tab");
            assert.equal(await phone.inputValue(), "(11) 99999-8888"); checks++;
            await phone.fill("");
            await phone.press("Tab");
            assert.equal(await phone.inputValue(), ""); checks++;
            await page.getByRole("button", { name: "Conferir atendimento QA", exact: true }).click();
            const dialog = page.getByRole("dialog");
            await dialog.getByLabel("Valor 1", { exact: true }).waitFor();
            const amount = dialog.getByLabel("Valor 1", { exact: true });
            await amount.fill("");
            assert.equal(await amount.inputValue(), ""); checks++;
            await amount.fill("50");
            await dialog.getByRole("button", { name: /Dividir pagamento|Adicionar forma de pagamento/ }).click();
            console.log("Payment split", engine, viewport.width, await dialog.locator("input[aria-label^='Valor ']").evaluateAll((inputs) => inputs.map((input) => ({ label: input.getAttribute("aria-label"), value: input.value }))));
            await dialog.getByLabel("Valor 2", { exact: true }).fill("70");
            await dialog.getByRole("combobox", { name: "Forma 2", exact: true }).click();
            await page.getByRole("option", { name: "cartão de crédito", exact: true }).click();
            const installments = dialog.getByLabel("Parcelas 2", { exact: true });
            await installments.fill("");
            assert.equal(await installments.inputValue(), ""); checks++;
            await installments.fill("2");
            await layout();
            if (viewport.width === 390) await page.screenshot({ path: fileURLToPath(new URL(`./pagamento-${engine}-390.png`, import.meta.url)), fullPage: true });
            await dialog.getByRole("button", { name: "Revisar e finalizar", exact: true }).click();
            await dialog.waitFor({ state: "hidden" });
            await sql(async (db) => {
              const payments = await db.all("SELECT * FROM payments WHERE appointment_id=? AND status IN ('pago','confirmado') ORDER BY id", [item.id]);
              assert.equal(payments.length, 3);
              assert.equal(payments.filter((row) => row.payment_type === "sinal").length, 1);
              assert.equal(payments.reduce((sum, row) => sum + Number(row.amount), 0), 145);
              assert.equal(Number(payments.find((row) => row.method === "cartão de crédito").installments), 2);
              const saved = await db.get("SELECT remaining_value FROM appointments WHERE id=?", [item.id]);
              assert.equal(Number(saved.remaining_value), 0);
            }); checks++;
          } catch (error) {
            console.log("Browser failure", engine, viewport, errors, (await page.locator("body").innerText()).slice(0, 1800));
            await page.screenshot({ path: fileURLToPath(new URL("./falha-browser.png", import.meta.url)) }).catch(() => {});
            throw error;
          } finally { await context.unrouteAll({ behavior: "wait" }); await context.close(); }
        }
      } finally { await browser.close(); }
    }
    console.log(`Browser checks: ${checks}; ${slot} cenários Chromium/WebKit, API e banco reais; ${resizeObserverNotifications} notificações ResizeObserver classificadas como ruído.`);
  } finally { await deprovisionTenant(tenant.tenant.id); }
});
