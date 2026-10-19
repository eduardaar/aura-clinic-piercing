import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
if (!process.env.AURA_PLAYWRIGHT_MODULE) throw new Error('Set AURA_PLAYWRIGHT_MODULE to the installed Playwright index.mjs path.');
const { chromium } = await import(pathToFileURL(process.env.AURA_PLAYWRIGHT_MODULE).href);
const origin = process.argv[2] || 'http://127.0.0.1:5187';
const label = origin.includes('127.0.0.1') ? 'local' : 'production';
const browser = await chromium.launch();
try {
  for (const width of [390, 1366]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + '/login?t=demo');
    await page.locator('input[type=email]').waitFor();
    await page.locator('.au-a-login-photo img').waitFor();
    await page.waitForFunction(() => document.querySelector('.au-a-login-photo img')?.naturalWidth > 0);
    const img = await page.locator('.au-a-login-photo img').evaluate(i => ({ w: i.clientWidth, h: i.clientHeight, nw: i.naturalWidth, nh: i.naturalHeight }));
    assert.ok(Math.abs(img.w / img.h - img.nw / img.nh) < 0.02);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.equal(await page.locator('.au-a-aside-quote').count(), 0);
    await page.screenshot({ path: new URL(`${label}-${width}.png`, import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'), fullPage: true });
    await page.getByRole('button', { name: 'Mostrar senha', exact: true }).click();
    await page.getByRole('button', { name: 'Ocultar senha', exact: true }).waitFor();
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(`${label}: login image and form verified in 390px and 1366px.`);
} finally { await browser.close(); }
