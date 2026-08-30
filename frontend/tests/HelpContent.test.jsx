import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArticleContent } from "../src/components/common/ArticleContent";
import { ProductNews, UserManual } from "../src/features/help/HelpCenter";

const manual = [
  {
    id: 1,
    slug: "primeiros-passos",
    title: "Primeiros passos",
    summary: "Configure a clínica.",
    category: "Começar",
    content: "1. Preparação\n\nConfira os dados da clínica.",
  },
  {
    id: 2,
    slug: "agenda",
    title: "Agenda",
    summary: "Organize horários.",
    category: "Atendimento",
    content: "Use a agenda como ponto de partida.",
  },
];

vi.mock("../src/lib/api", () => ({
  apiFetch: vi.fn(async (path) => ({
    ok: true,
    json: async () => ({
      articles:
        path === "/manual"
          ? manual
          : [
              {
                id: 3,
                slug: "nova-agenda",
                title: "Nova Agenda",
                summary: "Fluxo mais rápido.",
                category: "Produto",
                content: "Veja o que mudou.",
                published_at: "2026-08-30T12:00:00.000Z",
              },
            ],
    }),
  })),
}));

describe("conteúdo de ajuda", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renderiza títulos estruturados sem interpretar HTML", () => {
    render(<ArticleContent content={"1. Segurança\n\n<script>alert(1)</script>"} />);
    expect(screen.getByRole("heading", { name: "Segurança" })).toBeInTheDocument();
    expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument();
  });

  it("permite navegar e buscar no manual dentro do sistema", async () => {
    const user = userEvent.setup();
    render(<UserManual />);
    expect(await screen.findByRole("heading", { name: "Manual do usuário" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Agenda/ }));
    expect(screen.getByText("Use a agenda como ponto de partida.")).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText("Buscar uma orientação…"), "configure");
    expect(screen.getByRole("button", { name: /Primeiros passos/ })).toBeInTheDocument();
  });

  it("exibe novidades com data de publicação", async () => {
    render(<ProductNews />);
    expect(await screen.findByRole("heading", { name: "Novidades" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Nova Agenda" })).toBeInTheDocument();
    expect(screen.getByText(/Publicado em 30\/08\/2026/)).toBeInTheDocument();
  });
});
