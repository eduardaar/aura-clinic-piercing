import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SupplierRegistry } from "../src/features/finance/SupplierRegistry";

vi.mock("../src/lib/api", () => ({
  apiFetch: vi.fn(),
  readStoredSession: () => ({ user: { id: 7, role: "admin" } }),
  tenantSlug: () => "clinica-qa",
  useApiInvalidate: () => vi.fn(),
  useFetch: () => ({
    data: [{
      id: 1, name: "Titânio Brasil", person_type: "PJ", document: "11222333000181",
      contact_name: "Ana", whatsapp: "+55119999998888", categories: ["Joias"],
      quality_status: "approved", is_active: 1, lead_time_days: 5, minimum_order_value: 200
    }],
    error: ""
  })
}));

describe("cadastro de fornecedores", () => {
  it("lista responsivamente e abre o fluxo com campos essenciais primeiro", async () => {
    const user = userEvent.setup();
    render(<SupplierRegistry />);

    expect(screen.getByText("Titânio Brasil")).toBeInTheDocument();
    expect(screen.getByText("11.222.333/0001-81")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Novo fornecedor" }));

    expect(screen.getByRole("heading", { name: "Cadastro do fornecedor" })).toBeInTheDocument();
    expect(screen.getByLabelText("Nome do fornecedor")).toBeRequired();
    expect(screen.getByLabelText("CNPJ")).toBeInTheDocument();
    expect(screen.getByLabelText("WhatsApp")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Endereço/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Qualidade e rastreabilidade/ })).toBeInTheDocument();
  });
});
