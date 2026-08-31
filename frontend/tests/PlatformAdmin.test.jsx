import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/features/platform/LandingEditor", () => ({ LandingEditor: () => <div>Conteúdo Landing</div> }));
vi.mock("../src/features/platform/LegalEditor", () => ({ LegalEditor: () => <div>Conteúdo Legal</div> }));
vi.mock("../src/features/platform/ContentAdmin", () => ({ ContentAdmin: () => <div>Conteúdo e Ajuda</div> }));
vi.mock("../src/features/platform/PlansAdmin", () => ({ PlansAdmin: () => <div>Conteúdo Planos</div> }));
vi.mock("../src/features/platform/AccountsAdmin", () => ({ AccountsAdmin: () => <div>Conteúdo Clínicas</div> }));
vi.mock("../src/features/platform/FinanceAdmin", () => ({ PlatformFinance: () => <div>Conteúdo Dashboard</div> }));
vi.mock("../src/features/platform/EmailAdmin", () => ({ EmailAdmin: () => <div>Conteúdo E-mail</div> }));
vi.mock("../src/features/platform/SupportInbox", () => ({
  SupportInbox: () => <div>Conteúdo Suporte</div>,
  SupportOpenBadge: () => null,
}));

import { PlatformAdmin } from "../src/features/platform/PlatformAdmin";

describe("navegação do painel da plataforma", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("aura-platform-session", JSON.stringify({ token: "token-de-teste", user: { name: "Admin" } }));
    window.history.replaceState({}, "", "/plataforma/dashboard");
  });

  it("desmonta a tela anterior ao trocar de menu", async () => {
    const user = userEvent.setup();
    render(<PlatformAdmin />);

    expect(screen.getByText("Conteúdo Dashboard")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Clínicas" }));
    expect(screen.getByText("Conteúdo Clínicas")).toBeInTheDocument();
    expect(screen.queryByText("Conteúdo Dashboard")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Planos" }));
    expect(screen.getByText("Conteúdo Planos")).toBeInTheDocument();
    expect(screen.queryByText("Conteúdo Clínicas")).not.toBeInTheDocument();
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);

    // O painel foi reorganizado em d3147a23: e-mail e segurança saíram das abas
    // primárias para "Mais opções", e landing/notícias/legal passaram a viver
    // sob a aba "Conteúdo da plataforma". Uma tela por vez continua valendo.
    await user.click(screen.getByRole("button", { name: "Mais opções" }));
    await user.click(screen.getByRole("menuitem", { name: "Configuração de e-mail" }));
    expect(screen.getByText("Conteúdo E-mail")).toBeInTheDocument();
    expect(screen.queryByText("Conteúdo Planos")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Conteúdo da plataforma" }));
    expect(screen.getByText("Conteúdo Landing")).toBeInTheDocument();
    expect(screen.queryByText("Conteúdo E-mail")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Notícias e manual" }));
    expect(screen.getByText("Conteúdo e Ajuda")).toBeInTheDocument();
    expect(screen.queryByText("Conteúdo Landing")).not.toBeInTheDocument();
  });

  it("permite voltar do login restrito para a tela inicial", () => {
    localStorage.removeItem("aura-platform-session");
    render(<PlatformAdmin />);

    expect(screen.getByRole("link", { name: "Voltar para a tela inicial" })).toHaveAttribute("href", "/");
  });
});
