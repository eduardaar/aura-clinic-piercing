import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { pool } from '../../backend/src/database/connection.js';
import { pathToFileURL } from 'node:url';
if (!process.env.AURA_PLAYWRIGHT_MODULE) throw new Error('Set AURA_PLAYWRIGHT_MODULE to the installed Playwright index.mjs path.');
const { chromium, webkit } = await import(pathToFileURL(process.env.AURA_PLAYWRIGHT_MODULE).href);
import { BASE, req } from '../../backend/tests/helpers.mjs';

test('imagens da landing: API, proporções e telas responsivas', { timeout: 120000 }, async () => {
  const { json, status } = await req('/landing');
  assert.equal(status, 200);
  const features = json.sections.find(s => s.section_key === 'features');
  assert.deepEqual(features.content.items.map(i => i.title), ['Agendamento online', 'Controle de estoque', 'Ficha digital', 'Controle financeiro']);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const legacy = { title: 'Título preservado', items: [{ title: 'Catálogo de joias', image: '/antiga.jpg', extra: true }, { title: 'Outro recurso', image: '/personalizada.jpg' }] };
    await client.query("UPDATE platform.landing_sections SET content=$1 WHERE section_key='features'", [legacy]);
    const sql = await readFile(new URL('../../backend/src/db/migrations/platform/0009_landing_feature_images.sql', import.meta.url), 'utf8');
    await client.query(sql);
    const updated = (await client.query("SELECT content FROM platform.landing_sections WHERE section_key='features'")).rows[0].content;
    assert.equal(updated.title, legacy.title);
    assert.equal(updated.items[0].title, 'Controle de estoque');
    assert.equal(updated.items[0].extra, true);
    assert.deepEqual(updated.items[1], legacy.items[1]);
    await client.query(sql);
    assert.deepEqual((await client.query("SELECT content FROM platform.landing_sections WHERE section_key='features'")).rows[0].content, updated);
  } finally { await client.query('ROLLBACK'); client.release(); }
  const results = [];
  for (const [engine, type] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await type.launch();
    try {
      for (const width of [320, 390, 768, 1366]) {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        await page.route('**/api/**', async route => {
          const url = new URL(route.request().url());
          const response = await route.fetch({ url: `${BASE}${url.pathname.replace(/^\/api/, '')}${url.search}` });
          await route.fulfill({ response });
        });
        await page.goto('http://127.0.0.1:5187/');
        await page.locator('.au-l-feature').last().scrollIntoViewIfNeeded();
        await page.waitForFunction(() => [...document.querySelectorAll('.au-l-feature img')].length === 4 && [...document.querySelectorAll('.au-l-feature img')].every(i => i.complete && i.naturalWidth));
        const measurements = await page.locator('.au-l-feature img').evaluateAll(images => images.map(i => ({ src: i.getAttribute('src'), width: i.clientWidth, height: i.clientHeight, naturalWidth: i.naturalWidth, naturalHeight: i.naturalHeight })));
        for (const i of measurements) {
          assert.ok(i.src.startsWith('/assets/landing/features/'));
          assert.ok(Math.abs(i.width / i.height - i.naturalWidth / i.naturalHeight) < 0.02, 'imagem completa, sem corte');
          assert.ok(i.height > (width >= 900 ? 250 : 135), `altura legível: ${i.height}px em tela de ${width}px`);
        }
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'sem rolagem horizontal');
        await page.locator('#recursos').screenshot({ path: `../outputs/landing-imagens-2026-10-19/${engine}-${width}.png`, style: 'header, .au-l-whatsapp-float { visibility: hidden !important; }' });
        results.push({ engine, width, images: measurements });
        await page.close();
      }
    } finally { await browser.close(); }
  }
  await writeFile('../outputs/landing-imagens-2026-10-19/results.json', JSON.stringify(results, null, 2));
});
