import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { catalogFontStack } from "../src/features/catalog/catalogTypography.js";

test("fontes dos textos sempre possuem substituta sem serifa, inclusive família desconhecida", () => {
  for (const family of ["Inter", "Plus Jakarta Sans", "Arial", "Verdana", "Não instalada", "", undefined]) {
    assert.match(catalogFontStack(family), /sans-serif$/);
  }
});

test("fontes do editor entregues como webfont existem no pacote da aplicação", () => {
  const css = readFileSync(new URL("../src/styles/catalog-boutique.css", import.meta.url), "utf8")
    + readFileSync(new URL("../src/styles/catalog-v2.css", import.meta.url), "utf8");
  for (const family of ["Inter", "Playfair Display", "Cormorant Garamond", "Plus Jakarta Sans"]) {
    assert.ok(css.includes(`font-family: "${family}"`), `${family} precisa ser carregada`);
  }
  for (const [, url] of css.matchAll(/src: url\("(\/assets\/fonts\/[^"\n]+\.woff2)"\)/g)) {
    assert.ok(existsSync(new URL(`../public${url}`, import.meta.url)), `Fonte ausente: ${url}`);
  }
});
