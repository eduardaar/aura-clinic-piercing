import { describe, expect, it } from "vitest";
import { imageTransformStyle, normalizeImageTransform } from "../src/components/common/ImageEditor";

describe("editor de imagens multi-contexto", () => {
  it("usa contain e centro como padrão para não cortar imagens", () => {
    expect(normalizeImageTransform()).toMatchObject({
      fitMode: "contain",
      focalPointX: 50,
      focalPointY: 50,
      zoom: 1
    });
  });

  it("limita coordenadas e zoom a valores seguros", () => {
    expect(normalizeImageTransform({ focalPointX: -20, focalPointY: 180, zoom: 9 })).toMatchObject({
      focalPointX: 0,
      focalPointY: 100,
      zoom: 3
    });
  });

  it("transforma enquadramento persistido em estilo visual", () => {
    expect(imageTransformStyle({ fitMode: "cover", focalPointX: 30, focalPointY: 70, zoom: 1.2, rotation: 90, flipHorizontal: true })).toEqual({
      objectFit: "cover",
      objectPosition: "30% 70%",
      transform: "scale(1.2) rotate(90deg) scaleX(-1)"
    });
  });
});
