// Painel da vitrine comercial: categorias e campanhas.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CatalogCategoriesAdmin } from "../src/features/catalog/CatalogCategoriesAdmin";
import { CatalogCampaignsAdmin } from "../src/features/catalog/CatalogCampaignsAdmin";
import { apiFetch, useFetch } from "../src/lib/api";

vi.mock("../src/lib/api", () => ({
  API_ORIGIN: "",
  apiFetch: vi.fn(),
  tenantSlug: () => "clinica-teste",
  useApiInvalidate: () => vi.fn(),
  useFetch: vi.fn()
}));

const state = { fetch: {}, replies: {} };
const reply = (payload, status = 200) => Promise.resolve({ ok: status < 300, status, json: async () => payload });

beforeEach(() => {
  state.fetch = {};
  state.replies = {};
  useFetch.mockImplementation((path) => ({ data: state.fetch[path.split("?")[0]] ?? null, refresh: vi.fn(), loading: false, error: "" }));
  apiFetch.mockReset();
  apiFetch.mockImplementation((path, options = {}) => {
    const key = `${options.method || "GET"} ${path}`;
    const handler = state.replies[key];
    return handler ? (typeof handler === "function" ? handler(options) : reply(handler)) : reply({ ok: true });
  });
});

const sentBody = (key) => {
  const call = apiFetch.mock.calls.find(([path, options]) => `${options?.method || "GET"} ${path}` === key);
  return call ? JSON.parse(call[1].body) : null;
};

const CATEGORIES = [
  { id: 1, parent_id: null, name: "Argolas", slug: "argolas", path: "Argolas", depth: 0, product_count: 2, child_count: 1, is_active: true },
  { id: 2, parent_id: 1, name: "Titânio", slug: "argolas-titanio", path: "Argolas › Titânio", depth: 1, product_count: 1, child_count: 0, is_active: true },
  { id: 3, parent_id: null, name: "Ofertas", slug: "ofertas", path: "Ofertas", depth: 0, product_count: 0, child_count: 0, is_active: false }
];

describe("CatalogCategoriesAdmin", () => {
  it("lista a árvore e cria subcategoria com a categoria principal escolhida", async () => {
    state.fetch["/catalog-categories"] = CATEGORIES;
    const user = userEvent.setup();
    render(<CatalogCategoriesAdmin />);
    expect(screen.getByText("Argolas › Titânio")).toBeInTheDocument();
    expect(screen.getAllByText("Oculta").length).toBeGreaterThan(0);
    const row = screen.getAllByText("Argolas")[0].closest("tr, article, li, [role=row]") || document.body;
    await user.click(within(row).getAllByRole("button", { name: "Mais ações" })[0]);
    await user.click(await screen.findByRole("menuitem", { name: "Adicionar subcategoria" }));
    const dialog = await screen.findByRole("dialog", { name: "Nova categoria" });
    await user.type(within(dialog).getByLabelText("Nome"), "Titânio anodizado");
    await user.click(within(dialog.closest("[role=dialog]")).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(sentBody("POST /catalog-categories")).toMatchObject({ name: "Titânio anodizado", parent_id: 1 }));
  });

  it("mostra o motivo quando a exclusão é recusada por ter subcategorias", async () => {
    state.fetch["/catalog-categories"] = CATEGORIES;
    state.replies["DELETE /catalog-categories/1"] = () => reply({ error: "A categoria tem subcategorias ou produtos." }, 409);
    const user = userEvent.setup();
    render(<CatalogCategoriesAdmin />);
    const row = screen.getAllByText("Argolas")[0].closest("tr, article, li, [role=row]") || document.body;
    await user.click(within(row).getAllByRole("button", { name: "Mais ações" })[0]);
    await user.click(await screen.findByRole("menuitem", { name: "Excluir" }));
    const confirm = await screen.findByRole("dialog");
    await user.type(within(confirm).getByRole("textbox"), "SIM");
    await user.click(within(confirm).getByRole("button", { name: "Excluir" }));
    expect(await screen.findByText("A categoria tem subcategorias ou produtos.")).toBeInTheDocument();
  });
});

const CAMPAIGN = {
  id: 7, name: "Halloween 2026", title: "Halloween", slug: "halloween", summary: "Joias temáticas", status: "published", state: "active",
  starts_local: "2026-10-20T00:00", ends_local: "2026-11-01T00:00", product_count: 0, unavailable_count: 0,
  warnings: ["Campanha sem produtos."], show_on_home: true, show_in_nav: false, display_position: "top", priority: 0, promotion_id: null
};

describe("CatalogCampaignsAdmin", () => {
  it("mostra situação, período, avisos e pausa a campanha", async () => {
    state.fetch["/catalog-campaigns"] = { timezone: "America/Sao_Paulo", campaigns: [CAMPAIGN, { ...CAMPAIGN, id: 8, title: "Natal", slug: "natal", state: "scheduled", warnings: [] }] };
    state.fetch["/promotions"] = { items: [] };
    const user = userEvent.setup();
    render(<CatalogCampaignsAdmin />);
    expect(screen.getAllByText("Ativa").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Agendada").length).toBeGreaterThan(0);
    expect(screen.getAllByText("20/10/2026 00:00 → 01/11/2026 00:00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Campanha sem produtos.").length).toBeGreaterThan(0);
    const row = screen.getAllByText("Halloween")[0].closest("tr, article, li, [role=row]") || document.body;
    await user.click(within(row).getAllByRole("button", { name: "Mais ações" })[0]);
    await user.click(await screen.findByRole("menuitem", { name: "Pausar" }));
    await waitFor(() => expect(sentBody("POST /catalog-campaigns/7/status")).toEqual({ action: "pause" }));
  });

  it("cria a campanha com datas no horário da loja", async () => {
    state.fetch["/catalog-campaigns"] = { timezone: "America/Sao_Paulo", campaigns: [] };
    state.fetch["/promotions"] = { items: [{ id: 3, name: "Black Friday 20%" }] };
    state.replies["POST /catalog-campaigns"] = { ...CAMPAIGN, id: 9, status: "draft", state: "draft" };
    state.fetch["/catalog-campaigns/9"] = { ...CAMPAIGN, id: 9, sections: [], products: [] };
    const user = userEvent.setup();
    render(<CatalogCampaignsAdmin />);
    await user.click(screen.getByRole("button", { name: "Nova campanha" }));
    const dialog = await screen.findByRole("dialog", { name: "Nova campanha" });
    expect(within(dialog).getByText("Datas no horário da loja (America/Sao_Paulo)")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("Nome interno"), "Black Friday");
    within(dialog).getByLabelText("Início").value = "";
    await user.type(within(dialog).getByLabelText("Início"), "2026-11-27T00:00");
    await user.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(sentBody("POST /catalog-campaigns")).toMatchObject({ name: "Black Friday", starts_local: "2026-11-27T00:00", promotion_id: null }));
  });
});
