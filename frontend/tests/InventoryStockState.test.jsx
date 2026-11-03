import { describe, expect, it } from "vitest";
import { inventoryStockState, inventoryStatusLabel } from "../src/features/shared/helpers";
import { normalizeJewelryForm } from "../src/lib/defaultForms";

describe("estoque mínimo e apresentação dos alertas", () => {
  it.each([
    [0, "esgotado", "sold-out", "Esgotado"],
    [1, "crítico", "critical", "Crítico"],
    [5, "crítico", "critical", "Crítico"],
    [6, "baixo estoque", "low-stock", "Baixo estoque"],
    [10, "baixo estoque", "low-stock", "Baixo estoque"],
    [11, "disponível", "active", "Ativo"]
  ])("%i unidades com mínimo 5: %s", (quantity, status, state, label) => {
    const item = { quantity, status, low_stock_threshold: 5 };
    expect(inventoryStockState(item)).toBe(state);
    expect(inventoryStatusLabel(item)).toBe(label);
  });

  it("o total alto não esconde uma variação crítica e arquivado continua inativo", () => {
    expect(inventoryStockState({ quantity: 30, status: "crítico", low_stock_threshold: 5 })).toBe("critical");
    expect(inventoryStockState({ quantity: 30, status: "arquivado" })).toBe("inactive");
  });

  it("abrir edição preserva o mínimo zero e os selos comerciais", () => {
    const form = normalizeJewelryForm({ low_stock_threshold: 0, critical_stock_threshold: 0, is_new: 1, is_published: 1, is_catalog_active: 1, virtual_store_active: 1 });
    expect(form.low_stock_threshold).toBe(0);
    expect(form.critical_stock_threshold).toBe(0);
    expect(form.is_new).toBe(true);
    expect(inventoryStockState({ quantity: 1, low_stock_threshold: 0 })).toBe("active");
  });
});
