import test from "node:test";
import assert from "node:assert/strict";
import { syncProductImages } from "../src/services/inventory.js";

function fakeDb({ product = true, variation = true } = {}) {
  const calls = [];
  return {
    calls,
    async get(sql) {
      if (sql.includes("jewelry_inventory")) return product ? { id: 10 } : undefined;
      if (sql.includes("jewelry_variants")) return variation ? { id: 20 } : undefined;
    },
    async run(sql, params) {
      calls.push({ sql, params });
      return { lastID: calls.length };
    }
  };
}

test("rejeita imagem de variação que não pertence ao produto", async () => {
  const db = fakeDb({ variation: false });
  await assert.rejects(
    syncProductImages(db, 10, [{ image_url: "/uploads/a.png" }], { variationId: 20 }),
    /não pertence ao produto/
  );
  assert.equal(db.calls.length, 0);
});

test("remove duplicadas e mantém somente a primeira imagem como principal", async () => {
  const db = fakeDb();
  const images = await syncProductImages(db, 10, [
    { image_url: "/uploads/a.png", is_primary: false },
    { image_url: "/uploads/a.png", is_primary: true },
    { image_url: "/uploads/b.png", is_primary: true }
  ]);
  assert.deepEqual(images.map((image) => image.is_primary), [1, 0]);
  assert.equal(db.calls.filter((call) => call.sql.includes("INSERT INTO")).length, 2);
});
