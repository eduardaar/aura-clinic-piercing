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
  it("Boutique usa uma composição única mesmo com vitrines repetidas no layout antigo", async () => {
    const user = userEvent.setup();
    Object.assign(catalog.data.theme, { theme: "boutique", title_font: "Cormorant Garamond", body_font: "Plus Jakarta Sans", show_buy_button: 0 });
    catalog.data.catalogSections.unshift({ section_type: "in_stock", is_active: 1 }, { section_type: "in_stock", is_active: 1 });
    catalog.data.banners = [{ title: "Seu estilo, em cada detalhe.", image_url: "https://cdn.test/hero.webp", is_active: 1 }];
    render(<PublicCatalog />);
    expect(screen.getByRole("heading", { name: "Seu estilo, em cada detalhe.", level: 1 })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "Encontre sua próxima joia" })).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "Em estoque" })).not.toBeInTheDocument();
    expect(document.querySelectorAll("#catalog-products")).toHaveLength(1);
    expect(document.querySelector("main").style.fontFamily).toContain("sans-serif");
    expect(screen.queryByRole("button", { name: "Carrinho" })).not.toBeInTheDocument();
    const navigation = screen.getByRole("navigation", { name: "Categorias de joias" });
    await user.click(within(navigation).getByRole("button", { name: "Argolas", exact: true }));
    expect(results().querySelectorAll("article")).toHaveLength(3);
    expect(screen.queryByRole("heading", { name: "Seu estilo, em cada detalhe." })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Filtrar joias/ }));
    await user.type(screen.getByLabelText("Preço máximo"), "110");
    expect(results().querySelectorAll("article")).toHaveLength(1);
    expect(results()).toHaveTextContent("Joia 1");
  });

  it("Boutique usa os banners publicados e mantém a navegação entre eles", async () => {
    const user = userEvent.setup();
    catalog.data.theme.theme = "boutique";
    catalog.data.banners = [
      { title: "Coleção titânio", image_url: "https://cdn.test/one.webp", button_text: "Ver joias", button_link: "#catalog-products", is_active: 1 },
      { title: "Coleção ouro", image_url: "https://cdn.test/two.webp", is_active: 1 }
    ];
    render(<PublicCatalog />);
    expect(screen.getByRole("heading", { name: "Coleção titânio" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver joias" })).toHaveAttribute("href", "#catalog-products");
    await user.click(screen.getByRole("button", { name: "Próximo banner" }));
    expect(screen.getByRole("heading", { name: "Coleção ouro" })).toBeInTheDocument();
    expect(results().querySelectorAll("article")).toHaveLength(4);
    await user.click(screen.getByRole("button", { name: "Banner anterior" }));
    expect(screen.getByRole("heading", { name: "Coleção titânio" })).toBeInTheDocument();
  });

  it("recolher os filtros preserva a seleção e a ordenação permanece disponível junto aos resultados", async () => {
    const user = userEvent.setup();
    render(<PublicCatalog />);
    const toggle = screen.getByRole("button", { name: "Filtrar joias" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById(toggle.getAttribute("aria-controls"))).toContainElement(screen.getByLabelText("Preço máximo"));
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await user.type(screen.getByLabelText("Preço máximo"), "90");
    expect(results().querySelectorAll("article")).toHaveLength(1);
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByLabelText("Ordenar catálogo").closest(".catalog-refinement")).toBeNull();
    await user.click(screen.getByLabelText("Ordenar catálogo"));
    await user.click(await screen.findByRole("option", { name: "Maior preço" }));
    expect(results()).toHaveTextContent("Joia 3");
    await user.click(toggle);
    expect(screen.getByLabelText("Preço máximo")).toHaveValue(90);
    await user.click(screen.getByRole("button", { name: "Limpar filtros" }));
    expect(results().querySelectorAll("article")).toHaveLength(4);
  });

  it("mantém busca e filtros na grade completa quando o editor publica apenas uma seleção curada", async () => {
    const user = userEvent.setup();
    catalog.data.catalogSections = [{ section_type: "featured_products", is_active: 1 }];
    catalog.data.featuredProducts = [{ product_id: 1, is_active: 1 }];
    render(<PublicCatalog />);
    expect(screen.getAllByLabelText("Ordenar catálogo")).toHaveLength(1);
    expect(screen.getAllByLabelText("Preço máximo")).toHaveLength(1);
    await user.type(screen.getByLabelText("Buscar no catálogo"), "SKU-4");
    await waitFor(() => expect(results().querySelectorAll("article")).toHaveLength(1));
    expect(results()).toHaveTextContent("SKU SKU-4");
    expect(results()).not.toHaveTextContent("SKU SKU-1");
  });

  it.each([
    ["Lançamentos", [1, 4, 3, 2]],
    ["Mais recentes", [4, 3, 2, 1]],
    ["Menor preço", [3, 1, 4, 2]],
    ["Maior preço", [2, 4, 1, 3]],
    ["Nome de A a Z", [1, 2, 3, 4]],
    ["Nome de Z a A", [4, 3, 2, 1]]
  ])("ordenação do visitante %s prevalece sobre a ordem salva no bloco", async (label, expected) => {
    const user = userEvent.setup();
    catalog.data.catalogSections[1].product_sort = "price_desc";
    render(<PublicCatalog />);
    await user.click(screen.getByLabelText("Ordenar catálogo"));
    await user.click(await screen.findByRole("option", { name: label, exact: true }));
    expect([...results().querySelectorAll("article h2")].map((node) => Number(node.textContent.replace("Joia ", "")))).toEqual(expected);
  });

  it("lançamento recém-adicionado aparece na ordenação e após recarregar o link compartilhado", async () => {
    const user = userEvent.setup();
    catalog.data.catalogSections[1].product_sort = "recent";
    catalog.data.items.push(product(20, { is_new: 1 }));
    const view = render(<PublicCatalog />);
    await user.click(screen.getByLabelText("Ordenar catálogo"));
    await user.click(await screen.findByRole("option", { name: "Lançamentos", exact: true }));
    expect(results().querySelector("article h2")).toHaveTextContent("Joia 20");
    expect(new URLSearchParams(window.location.search).get("sort")).toBe("lancamentos");
    view.unmount();
    render(<PublicCatalog />);
    expect(results().querySelector("article h2")).toHaveTextContent("Joia 20");
    expect(results().querySelectorAll("article")).toHaveLength(5);
  });

  it("destaques manuais não retiram o lançamento do catálogo completo nem ignoram filtros", async () => {
    const user = userEvent.setup();
    catalog.data.items[2].is_featured = 1;
    catalog.data.items.push(product(20, { is_new: 1 }));
    render(<PublicCatalog />);
    await user.click(screen.getByLabelText("Ordenar catálogo"));
    await user.click(await screen.findByRole("option", { name: "Lançamentos", exact: true }));
    expect(results().querySelector("article h2")).toHaveTextContent("Joia 20");
    expect(results().querySelectorAll("article")).toHaveLength(5);
    await user.type(screen.getByLabelText("Preço máximo"), "90");
    expect(results()).toHaveTextContent("Joia 3");
    expect(results()).not.toHaveTextContent("Joia 20");
  });

  it("Lançamentos ordena sem excluir itens comuns e preserva categoria e filtros ativos", async () => {
    const user = userEvent.setup();
    catalog.data.catalogSections[1].product_sort = "recent";
    render(<PublicCatalog />);
    await user.click(screen.getByRole("button", { name: "Argolas" }));
    await user.type(screen.getByLabelText("Preço máximo"), "130");
    await user.click(screen.getByLabelText("Ordenar catálogo"));
    await user.click(await screen.findByRole("option", { name: "Lançamentos", exact: true }));
    expect([...results().querySelectorAll("article h2")].map((node) => node.textContent)).toEqual(["Joia 1", "Joia 4"]);
    expect(screen.getByText("2 filtros ativos")).toBeInTheDocument();
  });

  it("mais vendidos usa unidades em 30 dias, sem promover preço alto ou destaque manual", () => {
    catalog.data.catalogSections = [{ section_type: "best_sellers", is_active: 1, title: "Mais vendidos", items_limit: 8 }];
    catalog.data.campaigns = [];
    catalog.data.items = [product(1, { sale_value: 10, units_sold_30d: 10 }), product(2, { sale_value: 500, units_sold_30d: 2 }), product(3, { is_featured: 1, units_sold_30d: 0 })];
    render(<PublicCatalog />);
    const ranking = screen.getByRole("heading", { name: "Mais vendidos" }).closest("section");
    expect(ranking).toHaveTextContent("Joia 1");
    expect(ranking).toHaveTextContent("Joia 2");
    expect(ranking).not.toHaveTextContent("Joia 3");
    expect(ranking.textContent.indexOf("Joia 1")).toBeLessThan(ranking.textContent.indexOf("Joia 2"));
  });
  it.each([
    ["America/Sao_Paulo", "Disponível até 31 de outubro"],
    ["Asia/Tokyo", "Disponível até 01 de novembro"]
  ])("exibe o encerramento no fuso da loja %s", (timezone, expected) => {
    window.history.replaceState({}, "", "/catalogo/colecao/halloween?t=clinica-a");
    Object.assign(catalog.data.campaigns[0], { timezone, ends_at: "2099-11-01T01:00:00Z" });
    render(<PublicCatalog />);
    expect(screen.getByText(expected)).toBeInTheDocument();
  });
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
