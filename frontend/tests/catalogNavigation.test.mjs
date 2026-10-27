import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCategoryTree,
  campaignItems,
  catalogItemPrice,
  categoryDescendantIds,
  categoryTrail,
  commercialFiltersMatch,
  countActiveCatalogFilters,
  sortCatalogItems
} from "../src/lib/catalogNavigation.js";

const categories = [
  { id: 3, parent_id: 2, name: "Natural", sort_order: 0 },
  { id: 1, parent_id: null, name: "Argolas", sort_order: 1 },
  { id: 2, parent_id: 1, name: "Titânio", sort_order: 0 },
  { id: 4, parent_id: null, name: "Labrets", sort_order: 0 }
];

test("árvore ordenada e descendência em qualquer profundidade", () => {
  const tree = buildCategoryTree(categories);
  assert.deepEqual(tree.map((node) => node.name), ["Labrets", "Argolas"]);
  assert.equal(tree[1].children[0].children[0].name, "Natural");
  assert.deepEqual([...categoryDescendantIds(categories, 1)].sort(), [1, 2, 3]);
  assert.deepEqual(categoryTrail(categories, 3).map((node) => node.name), ["Argolas", "Titânio", "Natural"]);
});

test("preço considera a menor variação ativa e os filtros se combinam", () => {
  const item = { sale_value: 90, variants: [{ sale_value: 70, thickness: "1.2mm", thread_type: "Interna", is_active: 1 }, { sale_value: 40, is_active: 0 }] };
  assert.equal(catalogItemPrice(item), 70);
  assert.equal(commercialFiltersMatch(item, { thickness: "1.2mm", thread: "interna", priceMin: "60", priceMax: "80" }), true);
  assert.equal(commercialFiltersMatch(item, { thickness: "1.2mm", priceMax: "60" }), false);
  assert.equal(commercialFiltersMatch(item, { thread: "Externa" }), false);
  assert.equal(countActiveCatalogFilters({ material: "Titânio", priceMin: "10" }, { category: "argolas", search: "" }), 3);
});

test("ordenações de relevância, lançamentos e preço", () => {
  const items = [
    { id: 1, name: "Labret liso", sku: "LAB-1", sale_value: 50 },
    { id: 2, name: "Argola", sku: "ARG-9", sale_value: 30, is_new: 1 },
    { id: 3, name: "Labret com pedra", sku: "LAB-2", sale_value: 80 }
  ];
  assert.deepEqual(sortCatalogItems(items, "relevancia", "lab-2").map((item) => item.id)[0], 3);
  assert.equal(sortCatalogItems(items, "lancamentos")[0].id, 2);
  assert.deepEqual(sortCatalogItems(items, "menor-preco").map((item) => item.id), [2, 1, 3]);
  assert.deepEqual(sortCatalogItems(items, "maior-preco").map((item) => item.id), [3, 1, 2]);
});

test("produtos da coleção respeitam a subcategoria e só mostram publicados", () => {
  const campaign = { sections: [{ id: 7, slug: "topos" }], products: [{ product_id: 1, section_id: 7, promotional_price: 80 }, { product_id: 2, section_id: null }, { product_id: 99, section_id: 7 }] };
  const items = [{ id: 1, sale_value: 100 }, { id: 2, sale_value: 50 }];
  assert.deepEqual(campaignItems(campaign, items).map((item) => item.id), [1, 2]);
  assert.deepEqual(campaignItems(campaign, items, "topos").map((item) => [item.id, item.campaign_price]), [[1, 80]]);
});
