import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ImageEditor, imageTransformStyle, normalizeImageTransform } from "../src/components/common/ImageEditor";

describe("editor de imagens multi-contexto", () => {
  it("permite limpar e substituir a coordenada antes de normalizar ao sair", async () => {
    const user = userEvent.setup();
    render(<ImageEditor src="/image.png" onCancel={() => {}} onConfirm={() => {}} />);
    const x = screen.getByLabelText("Foco X");
    await user.clear(x);
    expect(x).toHaveValue(null);
    await user.type(x, "75");
    expect(x).toHaveValue(75);
    await user.tab();
    expect(x).toHaveValue(75);
  });
  it("usa contain e centro como padrão para não cortar imagens", () => {
    expect(normalizeImageTransform()).toMatchObject({
      fitMode: "contain",
      focalPointX: 50,
      focalPointY: 50,
      zoom: 1
    });
  });

  it("mantém compatibilidade com tenants antigos sem transformação salva", () => {
    expect(normalizeImageTransform(null)).toMatchObject({
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
