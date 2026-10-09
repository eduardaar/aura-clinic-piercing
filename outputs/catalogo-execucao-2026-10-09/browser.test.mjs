import { chromium, webkit } from '/Users/izaquesouza/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const fixture = { theme: { show_out_of_stock: 0, show_buy_button: 1 }, whatsapp_phone: '71999999999',
  catalogSections: [{ section_type: 'featured_products', is_active: 1 }], items: Array.from({ length: 8 }, (_, i) => ({
    id: i + 1, name: `Joia Premium Labret Cristal ${i + 1}`, material: 'Titânio ASTM F136', quantity: i ? 3 : 0,
    sale_value: 120, is_catalog_active: 1, is_published: 1, virtual_store_active: 1, category: 'Labret',
    variants: [{ id: 10 + i, quantity: i ? 3 : 0, variation_name: '6mm', material: 'Titânio', sale_value: 120 }]
  })) };
const results = [];
for (const [engine, type] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await type.launch();
  for (const width of [320, 390, 768, 1366]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = []; page.on('pageerror', err => errors.push(err.message));
    await page.route('**/api/**', route => route.fulfill({ json: route.request().url().match(/\/catalog(?:\?|$)/) ? fixture : {} }));
    await page.goto('http://127.0.0.1:5186/catalogo?t=clinica-a');
    await page.locator('.catalog-product-card').first().waitFor();
    const grid = await page.locator('.catalog-grid').first().evaluate(node => ({ columns: getComputedStyle(node).gridTemplateColumns.split(' ').length, scroll: document.documentElement.scrollWidth, width: innerWidth }));
    assert.equal(grid.scroll <= grid.width, true, `${engine} ${width} overflow ${JSON.stringify(grid)}`);
    if (width < 768) assert.equal(grid.columns, 2);
    else assert.ok(grid.columns >= 3);
    const soldout = page.locator('.catalog-product-card').filter({ hasText: 'Cristal 1' }).first();
    assert.ok(await soldout.getByText('Indisponível', { exact: true }).count());
    const share = await soldout.getByRole('link', { name: 'Compartilhar' }).getAttribute('href');
    assert.ok(new URL(share).searchParams.get('text').includes('/catalogo/produto/1?t=clinica-a'));
    await page.screenshot({ path: `outputs/catalogo-execucao-2026-10-09/catalog-${engine}-${width}.png`, fullPage: true });
    await soldout.getByRole('link', { name: 'Consultar disponibilidade' }).click();
    await page.getByRole('heading', { name: 'Joia Premium Labret Cristal 1', exact: true }).waitFor();
    const contact = await page.getByRole('link', { name: 'Pedir pelo WhatsApp' }).getAttribute('href');
    const message = new URL(contact).searchParams.get('text');
    assert.ok(message.includes('Variacao: 6mm'));
    assert.ok(message.includes('variant=10'));
    assert.equal(await page.getByRole('button', { name: /Adicionar 1 ao carrinho/ }).count(), 0);
    assert.deepEqual(errors, []);
    results.push({ engine, width, ...grid, sharedTenant: true, unavailableVariantContact: true });
    await page.close();
  }
  await browser.close();
}
await fs.writeFile('outputs/catalogo-execucao-2026-10-09/browser-results.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify(results));
