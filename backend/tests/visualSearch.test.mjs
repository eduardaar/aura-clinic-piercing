import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { hashSimilarity, perceptualHash } from "../src/services/visualSearch.js";

async function imageWithColor(color) {
  return sharp({ create: { width: 64, height: 64, channels: 3, background: color } })
    .composite([{ input: Buffer.from(`<svg width="64" height="64"><circle cx="20" cy="32" r="12" fill="white"/></svg>`) }])
    .png()
    .toBuffer();
}

test("hash perceptual é estável para a mesma imagem", async () => {
  const buffer = await imageWithColor("#222222");
  const left = await perceptualHash(buffer);
  const right = await perceptualHash(buffer);
  assert.match(left, /^[0-9a-f]{16}$/);
  assert.equal(left, right);
  assert.equal(hashSimilarity(left, right), 100);
});

test("hash perceptual compara pixels decodificados e não o nome do arquivo", async () => {
  const left = await perceptualHash(await imageWithColor("#111111"));
  const right = await perceptualHash(await imageWithColor("#eeeeee"));
  assert.ok(hashSimilarity(left, right) >= 0);
  assert.ok(hashSimilarity(left, right) <= 100);
  assert.equal(hashSimilarity("arquivo.jpg", right), 0);
});
