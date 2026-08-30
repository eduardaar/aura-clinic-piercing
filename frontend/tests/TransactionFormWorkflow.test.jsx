import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Purchases } from "../src/features/purchases/Purchases";

vi.mock("../src/lib/api", () => ({
  apiFetch: vi.fn(),
  readStoredSession: () => ({ user: { id: 7, role: "admin" } }),
  tenantSlug: () => "clinica-teste",
  useApiInvalidate: () => vi.fn(),
  useFetch: () => ({ data: [], loading: false, error: "" }),
}));

describe("formulário extenso de compras", () => {
  beforeEach(() => localStorage.clear());

  it("organiza essenciais, itens e parcelas em etapas sem modal secundário", async () => {
    const user = userEvent.setup();
    render(<Purchases />);

    await user.click(screen.getByRole("button", { name: "Nova compra" }));
    expect(screen.getByRole("heading", { name: "Fornecedor e data" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Importar XML da NF-e/i })).toHaveAttribute("data-state", "closed");
    expect(screen.queryByLabelText("Tipo de item")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /2\. Itens/i }));
    expect(screen.getByLabelText("Tipo de item")).toBeInTheDocument();
    expect(screen.queryByText("Parcelas da compra")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /3\. Pagamento/i }));
    expect(screen.getByText("Parcelas da compra")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Resumo da compra" })).toBeInTheDocument();
  });

  it("oferece restaurar e descartar um rascunho isolado", async () => {
    const savedAt = new Date().toISOString();
    localStorage.setItem(
      "aura:form-draft:clinica-teste:7:purchase-new",
      JSON.stringify({
        version: 1,
        schemaKey: "purchase-v1",
        savedAt,
        data: {
          form: { purchase_date: "2026-09-15", supplier_id: "" },
          line: {},
          items: [],
          installments: [],
          automaticInstallments: true,
        },
      }),
    );
    const user = userEvent.setup();
    render(<Purchases />);

    await user.click(screen.getByRole("button", { name: "Nova compra" }));
    expect(screen.getByRole("button", { name: "Restaurar" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Restaurar" }));
    expect(screen.getByLabelText("Data da compra")).toHaveValue("2026-09-15");
    expect(screen.queryByRole("button", { name: "Restaurar" })).not.toBeInTheDocument();
  });
});
