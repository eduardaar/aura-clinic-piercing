import assert from "node:assert/strict";
import test from "node:test";
import { validateImageTransform } from "../src/services/catalog.js";

test("normaliza o enquadramento seguro do catálogo", () => {
  assert.deepEqual(validateImageTransform(), {
    fitMode: "contain",
    focalPointX: 50,
    focalPointY: 50,
    zoom: 1,
    rotation: 0,
    flipHorizontal: false,
    aspectRatio: "16/5"
  });
});

test("rejeita transformações inválidas antes de alterar banners", () => {
  assert.throws(
    () => validateImageTransform({ fitMode: "crop-anything", zoom: 12 }),
    (error) => error.statusCode === 400 && /inválido/i.test(error.message)
  );
});
