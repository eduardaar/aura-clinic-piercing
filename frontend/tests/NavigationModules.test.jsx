import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "../src/components/layout/Sidebar";
import { PlanUpgradeNotice } from "../src/components/common/PlanUpgradeNotice";

const apiState = vi.hoisted(() => ({ readiness: { deprioritize: false, ready: false } }));

vi.mock("../src/lib/api", () => ({
  useFetch: () => ({ data: apiState.readiness, loading: false, error: "" })
}));

const allPlanFeatures = [
  "basic_inventory",
  "basic_catalog",
  "basic_finance",
  "basic_reports",
  "public_catalog_customization",
  "procedures",
  "message_templates",
  "campaigns",
  "coupons"
];

describe("navegação por módulos", () => {
  beforeEach(() => {
    apiState.readiness = { deprioritize: false, ready: false };
  });

  it("organiza as páginas e revela cadastros auxiliares somente sob demanda", async () => {
    const user = userEvent.setup();
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
      "Configurações"
    ]);
    expect(screen.getByRole("button", { name: "Fornecedores" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Categorias" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Centros de custo" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Financeiro" }));
    expect(screen.getByRole("button", { name: "Categorias" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Centros de custo" })).toBeInTheDocument();
  });

  it("abre filas e atalhos da agenda com destino explícito", async () => {
    const user = userEvent.setup();
    const setPage = vi.fn();
    render(<Sidebar page="dashboard" role="admin" user={{ role: "admin" }} features={allPlanFeatures} setPage={setPage} open />);

    await user.click(screen.getByRole("button", { name: "Clientes" }));
    expect(screen.getByRole("button", { name: /Termos pendentes/i })).toHaveTextContent("Fila");
    expect(screen.getByRole("button", { name: /Pós-atendimentos pendentes/i })).toHaveTextContent("Fila");

    await user.click(screen.getByRole("button", { name: "Agenda" }));
    await user.click(screen.getByRole("button", { name: "Procedimentos" }));
    expect(setPage).toHaveBeenCalledWith("agenda", "procedimentos");
  });

  it("oculta o onboarding assim que a configuração termina", () => {
    apiState.readiness = { deprioritize: true, ready: true };
    render(<Sidebar page="dashboard" role="admin" user={{ role: "admin" }} features={allPlanFeatures} setPage={vi.fn()} open />);
    expect(screen.queryByRole("button", { name: "Onboarding" })).not.toBeInTheDocument();
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
