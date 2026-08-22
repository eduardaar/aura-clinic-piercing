import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SalesWorkspace } from "../src/features/sales/Sales";

vi.mock("../src/lib/api", () => ({
  apiFetch: vi.fn(),
  useApiInvalidate: () => vi.fn(),
  useFetch: () => ({ data: [], loading: false, error: "" })
}));

describe("ações financeiras da venda por plano", () => {
  it("mantém a venda Start aberta e mostra o recebível bloqueado com explicação", async () => {
    const user = userEvent.setup();
    render(<SalesWorkspace features={["basic_catalog"]} />);

    await user.click(screen.getByRole("button", { name: /Nova venda/i }));
    expect(screen.getByRole("note")).toHaveTextContent("A venda e o pagamento imediato continuam disponíveis no Start.");

    await user.click(screen.getByRole("combobox", { name: "Recebimento" }));
    const pendingOption = await screen.findByRole("option", { name: /Gerar contas a receber.*Profissional/i });
    expect(pendingOption).toHaveAttribute("data-disabled");
    expect(screen.queryByText("Parcelas da venda")).not.toBeInTheDocument();
  });
});
