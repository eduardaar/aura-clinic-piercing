import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Sidebar } from "../src/components/layout/Sidebar";
import { PlanUpgradeNotice } from "../src/components/common/PlanUpgradeNotice";

vi.mock("../src/lib/api", () => ({
  useFetch: () => ({ data: { deprioritize: false }, loading: false, error: "" })
}));

const allPlanFeatures = [
  "basic_inventory",
  "basic_catalog",
  "basic_finance",
  "basic_reports",
  "public_catalog_customization"
];

describe("navegação por módulos", () => {
  it("organiza as páginas e mantém cadastros auxiliares fora do menu", () => {
    const { container } = render(
      <Sidebar
        page="dashboard"
        role="admin"
        user={{ role: "admin" }}
        features={allPlanFeatures}
        setPage={vi.fn()}
        open
      />
    );

    expect([...container.querySelectorAll(".nav-group-label")].map((item) => item.textContent)).toEqual([
      "Início",
      "Atendimento",
      "Comercial",
      "Estoque e compras",
      "Financeiro",
      "Gestão",
      "Sistema"
    ]);
    expect(screen.getByRole("button", { name: "Fornecedores" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Categorias financeiras/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Centros de custo/i })).not.toBeInTheDocument();
  });

  it("explica o upgrade no ponto da ação e oferece CTA ao administrador", async () => {
    const user = userEvent.setup();
    const onUpgrade = vi.fn();
    render(
      <PlanUpgradeNotice title="Contas a receber no plano Profissional" onUpgrade={onUpgrade}>
        A venda recebida agora continua disponível.
      </PlanUpgradeNotice>
    );

    expect(screen.getByRole("note")).toHaveTextContent("A venda recebida agora continua disponível.");
    await user.click(screen.getByRole("button", { name: "Conhecer o Profissional" }));
    expect(onUpgrade).toHaveBeenCalledOnce();
  });
});
