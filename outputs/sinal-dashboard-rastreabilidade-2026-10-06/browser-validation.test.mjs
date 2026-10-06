// Execute pelo runner de backend em banco descartável, com Vite em :5184
// e AURA_PLAYWRIGHT_MODULE apontando para playwright/index.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createTenant, loginTenant, req, BASE } from "../../backend/tests/helpers.mjs";
import { withTenantSchema } from "../../backend/src/db/tenantSession.js";
import { deprovisionTenant } from "../../backend/src/services/tenants.js";
const output = fileURLToPath(new URL("./", import.meta.url));

test("navegadores reais: login, reabertura, sinal, fechamento, origem, filtros e toque", { timeout: 300000 }, async () => {
  const { chromium, webkit } = await import(pathToFileURL(process.env.AURA_PLAYWRIGHT_MODULE).href);
  const tenant = await createTenant("qa-browser-trace");
  const token = (await loginTenant(tenant.slug, tenant.adminEmail, tenant.adminPassword)).token;
  const api = (path, options = {}) => req(path, { tenant: tenant.slug, token, ...options });
  const db = (fn) => withTenantSchema(tenant.tenant.id, fn);
  let slot = 0;
  let checks = 0;
  try {
    await api("/subscription", { method: "PATCH", body: { plan_code: "studio" } });
    const professional = (await api("/professionals", { method: "POST", body: { name: "Profissional navegador", specialty: "Piercing" } })).json.id;
    const service = (await api("/services", { method: "POST", body: { name: "Procedimento navegador", price: 100, deposit_value: 25, duration_minutes: 30 } })).json.id;
    for (const [engine, browserType, widths] of [["chromium", chromium, [320, 390, 768, 1366]], ["webkit", webkit, [320, 375, 390, 768]]]) {
      let browser = await browserType.launch({ headless: true });
      let storage;
      const attach = async (context) => context.route("**/api/**", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const response = await route.fetch({ url: `${BASE}${url.pathname.slice(4)}${url.search}`, headers: { ...request.headers(), origin: new URL(BASE).origin } });
        await route.fulfill({ response });
      });
      try {
        let context = await browser.newContext({ viewport: { width: widths[0], height: 844 } });
        await attach(context);
        let page = await context.newPage();
        await page.goto(`http://127.0.0.1:5184/login?t=${tenant.slug}`);
        await page.getByLabel("E-mail", { exact: true }).fill(tenant.adminEmail);
        await page.getByLabel("Senha", { exact: true }).fill(tenant.adminPassword);
        await page.getByRole("button", { name: "Entrar", exact: true }).click();
        await page.waitForURL("**/app/**");
        await page.waitForFunction(() => Boolean(JSON.parse(localStorage.getItem("aura-session"))?.token));
        checks++;
        storage = await context.storageState();
        await context.unrouteAll({ behavior: "wait" });
        await context.close();
        await browser.close();
        browser = await browserType.launch({ headless: true });
        for (const width of widths) {
          slot++;
          const date = new Date(Date.UTC(2026, 10, slot)).toISOString().slice(0, 10);
          const created = await api("/appointments", { method: "POST", body: { full_name: `Cliente navegador ${slot}`, whatsapp: `1197000${String(slot).padStart(4, "0")}`, professional_id: professional, service_id: service, procedure: "Procedimento navegador", piercing_region: "Orelha", appointment_date: date, appointment_time: "10:00", status: "confirmado", deposit_value: 10, deposit_status: "pago", deposit_payment_method: "Pix" } });
          assert.equal(created.status, 201, JSON.stringify(created.json));
          const item = created.json;
          context = await browser.newContext({ storageState: storage, viewport: { width, height: 844 }, ...(width < 500 ? { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : {}) });
          await attach(context);
          page = await context.newPage();
          const errors = [];
          page.on("pageerror", (error) => errors.push(error.message));
          const layout = async () => {
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${engine} ${width}: overflow`);
            assert.deepEqual(errors, []);
            checks++;
          };
          await page.goto(`http://127.0.0.1:5184/.qa-traceability.html?appointment=${item.id}`);
          await page.getByText("Próximo agendamento", { exact: true }).waitFor();
          assert.ok(await page.evaluate(() => Boolean(JSON.parse(localStorage.getItem("aura-session"))?.token)));
          await layout();
          await page.getByRole("button", { name: "Conferir atendimento QA" }).click();
          const dialog = page.getByRole("dialog");
          await dialog.getByText(/Sinal esperado:/).waitFor();
          assert.ok((await dialog.boundingBox()).width <= width);
          await dialog.getByLabel("Valor do sinal (R$)").fill("60");
          await dialog.getByText(/Sinal conferido:/).filter({ hasText: "60,00" }).waitFor();
          await page.waitForTimeout(1200);
          const statusControl = dialog.getByRole("combobox", { name: "Status", exact: true }).last();
          await statusControl.click();
          await page.getByRole("option", { name: "Pendente", exact: true }).click();
          await layout();
          if (engine === "webkit" && width === 390) await page.screenshot({ path: `${output}sinal-finalizacao-iphone-webkit-390.png` });
          await dialog.getByRole("button", { name: "Revisar e finalizar", exact: true }).click();
          await dialog.waitFor({ state: "hidden" });
          const title = await db((conn) => conn.get("SELECT fe.* FROM financial_entries fe JOIN service_executions se ON fe.source_type='service_execution' AND fe.source_id=se.id WHERE se.appointment_id=?", [item.id]));
          assert.equal(Number(title.amount), 40);
          checks++;
          await page.getByRole("button", { name: "Recebíveis QA" }).click();
          await page.getByText("Contas a receber", { exact: true }).waitFor();
          const search = page.getByRole("searchbox").first();
          await search.fill(`Cliente navegador ${slot}`);
          await page.getByRole("row").filter({ hasText: `Atendimento #${item.id}` }).filter({ hasNotText: "Pagamento sinal" }).getByRole("button", { name: "Mais ações", exact: true }).click();
          await page.getByRole("menuitem", { name: "Detalhes", exact: true }).click();
          await page.getByText("Sinal efetivamente pago").waitFor();
          await layout();
          assert.ok(await page.getByRole("link", { name: "Abrir atendimento de origem" }).isVisible());
          await page.getByRole("button", { name: "Fechar", exact: true }).click();
          await page.getByRole("button", { name: "Relatórios QA" }).click();
          await page.getByText("Central de relatórios", { exact: true }).waitFor();
          await page.getByRole("combobox", { name: "Relatório", exact: true }).click();
          await page.getByRole("option", { name: "Agendamentos", exact: true }).click();
          await page.getByRole("button", { name: /^Filtros/ }).click();
          await page.getByLabel("De", { exact: true }).fill(date);
          await page.getByLabel("Até", { exact: true }).fill(date);
          await page.getByRole("button", { name: "Aplicar filtros" }).click();
          await page.getByText("1 registro(s)", { exact: true }).waitFor();
          await layout();
          if (engine === "chromium" && width === 1366) await page.screenshot({ path: `${output}relatorio-desktop-1366.png`, fullPage: true });
          const reportSearch = page.getByRole("searchbox").first();
          await reportSearch.fill("nunca-encontrado-qa");
          await page.getByText("0 registro(s)", { exact: true }).waitFor();
          await page.getByText("Nenhum registro corresponde aos filtros e à busca aplicados.").waitFor();
          await reportSearch.fill(`Cliente navegador ${slot}`);
          await page.getByText("1 registro(s)", { exact: true }).waitFor();
          checks += 2;
          await context.unrouteAll({ behavior: "wait" });
        await context.close();
          console.log(`${engine} ${width}px: login/reabertura, sinal, finalização, origem, filtros e layout OK`);
        }
      } finally { await browser.close(); }
    }
    console.log(`Verificações de navegador: ${checks}`);
  } finally { await deprovisionTenant(tenant.tenant.id); }
});
