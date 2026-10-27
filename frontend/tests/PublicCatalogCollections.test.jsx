// Vitrine comercial: categorias hierárquicas, filtros combinados e coleções.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublicCatalog } from "../src/pages/PublicExperience";

const { catalog, campaignState } = vi.hoisted(() => ({ catalog: { data: null }, campaignState: { value: { state: "ended", title: "Halloween" } } }));
vi.mock("../src/lib/api", () => ({
  API_ORIGIN: "",
  usePublicFetch: () => ({ data: catalog.data }),
  publicApiFetch: vi.fn(async () => ({ ok: true, json: async () => campaignState.value }))
}));

const product = (id, extra = {}) => ({
  id, name: `Joia ${id}`, sku: `SKU-${id}`, quantity: 3, sale_value: 100, is_catalog_active: 1, is_published: 1,
  virtual_store_active: 1, category: "Topos", material: "Titânio", variants: [], category_ids: [], ...extra
});

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, "", "/catalogo?t=clinica-a");
  catalog.data = {
    theme: { show_buy_button: 1 },
    catalogSections: [{ section_type: "categories", is_active: 1 }, { section_type: "featured_products", is_active: 1 }],
    catalogCategories: [
      { id: 1, parent_id: null, name: "Argolas", slug: "argolas", sort_order: 0 },
      { id: 2, parent_id: 1, name: "Titânio", slug: "argolas-titanio", sort_order: 0 },
      { id: 3, parent_id: 2, name: "Titânio anodizado", slug: "titanio-anodizado", sort_order: 0 },
      { id: 4, parent_id: null, name: "Labrets", slug: "labrets", sort_order: 1 }
    ],
    campaigns: [{
      id: 9, title: "Halloween", slug: "halloween", summary: "Joias temáticas", show_on_home: true, show_in_nav: true,
      display_position: "top", banner_desktop_url: "https://cdn.test/h.webp", ends_at: "2099-11-01T03:00:00Z",
      sections: [{ id: 50, name: "Topos temáticos", slug: "topos-tematicos" }],
      products: [{ product_id: 1, section_id: 50, promotional_price: 80 }, { product_id: 3, section_id: null }]
    }],
    items: [
      product(1, { category_ids: [3], material: "Titânio", sale_value: 100, is_new: 1 }),
      product(2, { category_ids: [2], material: "Ouro 18k", sale_value: 300 }),
      product(3, { category_ids: [4], material: "Titânio", sale_value: 50 }),
      product(4, { category_ids: [3, 4], material: "Titânio", sale_value: 120, variants: [{ id: 41, thickness: "1.2mm", thread_type: "Interna", sale_value: 120, quantity: 2, is_active: 1 }] })
    ]
  };
});
afterEach(cleanup);

const results = () => document.querySelector("#catalog-products");

describe("PublicCatalog · vitrine comercial", () => {
  it("categoria principal inclui todas as subcategorias e mostra trilha e filhas", async () => {
    const user = userEvent.setup();
    render(<PublicCatalog />);
    await user.click(screen.getByRole("button", { name: "Argolas" }));
    expect(results()).toHaveTextContent("Joia 1");
    expect(results()).toHaveTextContent("Joia 2");
    expect(results()).toHaveTextContent("Joia 4");
    expect(results()).not.toHaveTextContent("Joia 3");
    const nav = screen.getByRole("navigation", { name: "Você está em" });
    expect(within(nav).getByText("Argolas")).toHaveAttribute("aria-current", "page");
    // Descer um nível pela subcategoria.
    await user.click(screen.getByRole("button", { name: "Titânio" }));
    await user.click(screen.getByRole("button", { name: "Titânio anodizado" }));
    expect(results()).toHaveTextContent("Joia 1");
    expect(results()).not.toHaveTextContent("Joia 2");
    // Um produto em duas categorias aparece uma vez só.
    expect(results().querySelectorAll("article").length).toBe(2);
  });

  it("combina categoria, material e faixa de preço e limpa tudo de uma vez", async () => {
    const user = userEvent.setup();
    render(<PublicCatalog />);
    await user.click(screen.getByRole("button", { name: "Argolas" }));
    await user.type(screen.getByLabelText("Preço máximo"), "110");
    expect(results()).toHaveTextContent("Joia 1");
    expect(results()).not.toHaveTextContent("Joia 2");
    expect(results()).not.toHaveTextContent("Joia 4");
    expect(screen.getByText("2 filtros ativos")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Limpar filtros" }));
    expect(results().querySelectorAll("article").length).toBe(4);
  });

  it("filtros de espessura e fixação só aparecem quando há dados e funcionam pelas variações", async () => {
    const user = userEvent.setup();
    render(<PublicCatalog />);
    expect(screen.queryByLabelText("Pedra")).not.toBeInTheDocument();
    await user.click(screen.getByLabelText("Fixação"));
    await user.click(await screen.findByRole("option", { name: "Interna" }));
    expect(results().querySelectorAll("article").length).toBe(1);
    expect(results()).toHaveTextContent("Joia 4");
  });

  it("cards mostram o SKU e a ordenação por lançamentos coloca novidades primeiro", async () => {
    const user = userEvent.setup();
    render(<PublicCatalog />);
    expect(results()).toHaveTextContent("SKU SKU-3");
    await user.click(screen.getByLabelText("Ordenar catálogo"));
    await user.click(await screen.findByRole("option", { name: "Lançamentos" }));
    expect(results().querySelector("article h2")).toHaveTextContent("Joia 1");
  });

  it("árvore de categorias abre em modal e seleciona subcategorias profundas", async () => {
    const user = userEvent.setup();
    render(<PublicCatalog />);
    await user.click(screen.getByRole("button", { name: "Todas as categorias" }));
    const dialog = await screen.findByRole("dialog", { name: "Categorias" });
    await user.click(within(dialog).getByRole("button", { name: "Subcategorias de Argolas" }));
    await user.click(within(dialog).getByRole("button", { name: "Subcategorias de Titânio" }));
    await user.click(within(dialog).getByRole("button", { name: "Titânio anodizado" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Categorias" })).not.toBeInTheDocument());
    expect(results().querySelectorAll("article").length).toBe(2);
  });

  it("coleções aparecem na página inicial e na navegação, com link próprio", () => {
    render(<PublicCatalog />);
    const links = screen.getAllByRole("link", { name: /Halloween/ });
    expect(links.length).toBeGreaterThanOrEqual(2);
    expect(links[0].getAttribute("href")).toBe("/catalogo/colecao/halloween?t=clinica-a");
  });

  it("página da coleção mostra os produtos vinculados, subcategorias e preço da promoção", async () => {
    window.history.replaceState({}, "", "/catalogo/colecao/halloween?t=clinica-a");
    const user = userEvent.setup();
    render(<PublicCatalog />);
    expect(screen.getByRole("heading", { name: "Halloween", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("2 joias")).toBeInTheDocument();
    const first = screen.getByRole("heading", { name: "Joia 1" }).closest("article");
    expect(first).toHaveTextContent("R$ 80,00");
    expect(first.querySelector("del")).toHaveTextContent("R$ 100,00");
    await user.click(screen.getByRole("button", { name: "Topos temáticos" }));
    expect(screen.getByText("1 joia")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Joia 3" })).not.toBeInTheDocument();
  });

  it("link de coleção encerrada mostra página amigável", async () => {
    window.history.replaceState({}, "", "/catalogo/colecao/natal-2025?t=clinica-a");
    catalog.data.campaigns = [];
    render(<PublicCatalog />);
    expect(await screen.findByRole("heading", { name: "A coleção Halloween foi encerrada" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver catálogo" })).toBeInTheDocument();
  });

  it("sem categorias comerciais a vitrine mantém as categorias do editor", () => {
    catalog.data.catalogCategories = [];
    catalog.data.categories = ["Topos"];
    render(<PublicCatalog />);
    expect(screen.queryByRole("button", { name: "Todas as categorias" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Topos" }));
    expect(results().querySelectorAll("article").length).toBe(4);
  });
});
