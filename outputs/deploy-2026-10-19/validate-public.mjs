import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
if (!process.env.AURA_PLAYWRIGHT_MODULE) throw new Error('Set AURA_PLAYWRIGHT_MODULE to the installed Playwright index.mjs path.');
const { chromium } = await import(pathToFileURL(process.env.AURA_PLAYWRIGHT_MODULE).href);
const origin = 'https://auraclinic.monitence.com';
const browser = await chromium.launch();
const results = [];
try {
  for (const width of [390, 1366]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const response = await page.goto(origin, { waitUntil: 'networkidle' });
    assert.equal(response.status(), 200);
    await page.locator('.au-l-feature').last().scrollIntoViewIfNeeded();
    await page.waitForFunction(() => [...document.querySelectorAll('.au-l-feature img')].length === 4 && [...document.querySelectorAll('.au-l-feature img')].every(i => i.complete && i.naturalWidth));
    const images = await page.locator('.au-l-feature img').evaluateAll(xs => xs.map(i => ({ src: i.getAttribute('src'), width: i.clientWidth, height: i.clientHeight, naturalWidth: i.naturalWidth, naturalHeight: i.naturalHeight })));
    assert.ok(images.every(i => i.src.includes('/assets/landing/features/')));
    assert.ok(images.every(i => Math.abs(i.width / i.height - i.naturalWidth / i.naturalHeight) < 0.02));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.locator('#recursos').screenshot({ path: new URL(`production-${width}.png`, import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'), style: 'header, .au-l-whatsapp-float { visibility: hidden !important; }' });
    const landing = await page.request.get(origin + '/api/landing');
    assert.equal(landing.status(), 200);
    assert.equal((await landing.json()).sections.find(s => s.section_key === 'features').content.items.length, 4);
    await page.goto(origin + '/login?t=aura-clinic');
    await page.locator('input[type=email]').waitFor();
    await page.locator('input[type=password]').waitFor();
    assert.deepEqual(errors, []);
    results.push({ width, images, loginRendered: true, errors });
    await page.close();
  }
  await writeFile(new URL('public-validation.json', import.meta.url), JSON.stringify(results, null, 2));
  console.log('Production public checks passed at 390px and 1366px.');
} finally { await browser.close(); }
