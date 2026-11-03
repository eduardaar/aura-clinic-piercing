import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

test("avaliação na cópia local: links, cadastro completo, falha de rede e troca de profissional", { timeout: 240000 }, async () => {
  const { chromium, webkit } = await import(pathToFileURL(process.env.AURA_PLAYWRIGHT_MODULE).href);
  const api = process.env.AURA_LOCAL_API || "http://127.0.0.1:4499/api";
  const origin = process.env.AURA_BROWSER_ORIGIN || "http://127.0.0.1:5187";
  assert.ok(new URL(api).hostname === "127.0.0.1", "Este roteiro só pode chamar a cópia local");
  const output = new URL("./", import.meta.url);
  await mkdir(output, { recursive: true });
  const headers = { "X-Tenant": "aura-clinic" };
  const results = [];
  let index = 0;
  for (const [engine, type] of [["chromium", chromium], ["webkit", webkit]]) {
    const browser = await type.launch({ headless: true });
    try {
      for (const width of [390, 1366]) {
        index += 1;
        const context = await browser.newContext({ viewport: { width, height: 900 } });
        let page;
        let failNextBooking = false;
        const errors = [];
        try {
          await context.route("**/api/**", async (route) => {
            const url = new URL(route.request().url());
            if (url.pathname === "/api/booking/requests" && failNextBooking) {
              failNextBooking = false;
              return route.abort("failed");
            }
            const response = await route.fetch({ url: `${api}${url.pathname.replace(/^\/api/, "")}${url.search}` });
            await route.fulfill({ response });
          });
          page = await context.newPage();
          page.on("pageerror", (error) => errors.push(error.message));
          const date = "2026-12-15";
          const slots = await fetch(`${api}/booking/slots?service_id=19&professional_id=2&date=${date}`, { headers }).then(r => r.json());
          const time = slots.slots[0].time;
          await page.goto(`${origin}/agendar?t=aura-clinic&service_id=19&professional_id=2&appointment_date=${date}&appointment_time=${time}`);
          await page.getByLabel("Nome", { exact: true }).fill("QA Investigação Navegador");
          await page.getByLabel("WhatsApp", { exact: true }).fill(`11900008${String(index).padStart(3, "0")}`);
          if (await page.getByLabel("Data de nascimento", { exact: true }).count()) await page.getByLabel("Data de nascimento", { exact: true }).fill("1990-01-01");
          await page.getByRole("button", { name: "Ver resumo", exact: true }).click();
          await page.getByRole("heading", { name: "Resumo da solicitação" }).waitFor();
          assert.ok((await page.locator(".booking-summary-facts").innerText()).includes("Erick Anthony"));
          for (const box of await page.getByRole("checkbox").all()) await box.check();
          failNextBooking = true;
          await page.getByRole("button", { name: "Confirmar solicitação", exact: true }).click();
          await page.getByText(/Não foi possível enviar a solicitação/).waitFor();
          assert.equal(await page.getByRole("button", { name: "Confirmar solicitação", exact: true }).isEnabled(), true);
          const sent = page.waitForResponse(r => new URL(r.url()).pathname === "/api/booking/requests" && r.request().method() === "POST");
          await page.getByRole("button", { name: "Confirmar solicitação", exact: true }).click();
          const response = await sent;
          assert.equal(response.status(), 201, await response.text());
          await page.getByRole("heading", { name: "Recebemos sua solicitação" }).waitFor();
          await page.screenshot({ path: fileURLToPath(new URL(`confirmacao-${engine}-${width}.png`, output)), fullPage: true });

          for (const id of [8, 17]) {
            await page.goto(`${origin}/agendar?t=aura-clinic&service_id=${id}`);
            await page.getByRole("heading", { name: "Escolha um ou mais serviços" }).waitFor();
            assert.ok((await page.getByRole("alert").innerText()).includes("não está disponível"));
            assert.equal(await page.getByRole("button", { name: /Consulta e avaliação de piercing/ }).count(), 1);
          }
          await page.goto(`${origin}/agendar?t=aura-clinic&service_id=19&professional_id=999&appointment_date=${date}&appointment_time=${time}`);
          await page.getByRole("heading", { name: "Escolha a profissional" }).waitFor();
          assert.equal(await page.getByRole("button", { name: /Erick Anthony/ }).count(), 1);

          await page.goto(`${origin}/agendar?t=aura-clinic&service_id=19&professional_id=1&appointment_date=2026-12-01`);
          await page.getByText("Nenhuma data disponível neste mês. Consulte outro mês.").waitFor();
          await page.getByRole("button", { name: "Voltar", exact: true }).click();
          await page.getByRole("button", { name: "Voltar", exact: true }).click();
          await page.getByRole("button", { name: /Erick Anthony/ }).click();
          await page.locator(".booking-date-strip button").first().waitFor();
          assert.ok(await page.locator(".booking-date-strip button").count() > 0);

          // Caminho completo desde a escolha do serviço, com os dados reais do cadastro.
          await page.goto(`${origin}/agendar?t=aura-clinic`);
          await page.getByRole("button", { name: /Consulta e avaliação de piercing/ }).click();
          await page.getByRole("button", { name: /^Continuar/ }).click();
          await page.getByRole("button", { name: /Erick Anthony/ }).click();
          await page.locator(".booking-date-strip button").first().click();
          await page.locator(".slot-grid button").first().click();
          await page.getByRole("button", { name: "Continuar", exact: true }).click();
          await page.getByLabel("Nome", { exact: true }).fill("QA Fluxo Completo");
          await page.getByLabel("WhatsApp", { exact: true }).fill(`11900007${String(index).padStart(3, "0")}`);
          if (await page.getByLabel("Data de nascimento", { exact: true }).count()) await page.getByLabel("Data de nascimento", { exact: true }).fill("1990-01-01");
          await page.getByRole("button", { name: "Ver resumo", exact: true }).click();
          await page.getByRole("heading", { name: "Resumo da solicitação" }).waitFor();
          assert.ok((await page.locator(".booking-summary-facts").innerText()).includes("Erick Anthony"));
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
          assert.deepEqual(errors, []);
          results.push({ engine, width, realConfig: true, validDeepLink: true, oldServiceLinksRecovered: [8, 17], invalidProfessionalRecovered: true, networkRetry: true, bookingPersisted: true, professionalSwitchAfterEmptyMonth: true, fullWizardToSummary: true, noOverflow: true, pageErrors: 0 });
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
});
