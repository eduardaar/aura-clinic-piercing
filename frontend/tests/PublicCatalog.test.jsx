import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublicBooking, PublicCatalog, PublicCheckout } from "../src/pages/PublicExperience";

const { catalog } = vi.hoisted(() => ({ catalog: { data: null } }));
vi.mock("../src/lib/api", () => ({
  API_ORIGIN: "", usePublicFetch: () => ({ data: catalog.data }),
  publicApiFetch: vi.fn(async () => ({ ok: true, json: async () => ({}) }))
}));
const product = (id, quantity, extra = {}) => ({ id, name: `Joia ${id}`, quantity, sale_value: 100,
  is_catalog_active: 1, is_published: 1, virtual_store_active: 1, category: "Labret", variants: [], ...extra });
beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, "", "/catalogo?t=clinica-a&q=joia&material=Titânio");
  catalog.data = { theme: { show_out_of_stock: 0, show_buy_button: 1 }, whatsapp_phone: "71999999999",
    catalogSections: [{ section_type: "featured_products", is_active: 1 }],
    items: [product(1, 0, { material: "Titânio" }), product(2, 3, { material: "Titânio" }), product(3, 0, { status: "arquivado" })] };
});
afterEach(cleanup);
describe("PublicCatalog", () => {
  it("sempre permite limpar categorias mesmo quando Todos não foi cadastrado pela loja", () => {
    catalog.data.catalogSections.unshift({ section_type: "categories", is_active: 1 });
    catalog.data.categories = ["Labret"];
    render(<PublicCatalog />);
    expect(screen.getByRole("button", { name: "Todos", exact: true })).toBeInTheDocument();
  });
  it("Ver todos mantém a categoria da seção e inclui suas joias esgotadas na grade completa", () => {
    catalog.data.catalogSections.unshift({ section_type: "in_stock", category_filter: "Labret", is_active: 1 });
    catalog.data.items.push(product(4, 2, { category: "Argolas", material: "Titânio" }));
    render(<PublicCatalog />);
    expect(document.querySelector("#catalog-products")).toHaveTextContent("Joia 4");
    const link = screen.getByRole("link", { name: "Ver todos", exact: true });
    link.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(link);
    expect(document.querySelector("#catalog-products")).toHaveTextContent("Joia 1");
    expect(document.querySelector("#catalog-products")).toHaveTextContent("Joia 2");
    expect(document.querySelector("#catalog-products")).not.toHaveTextContent("Joia 4");
  });
  it("resume somente características comuns e conta variações ativas sem listar cores no cartão", () => {
    catalog.data.items[1].color = "natural, bronze, rosa, azul, turquesa, verde, roxo, dourado";
    catalog.data.items[1].variants = Array.from({ length: 11 }, (_, index) => ({ id: index + 100, material: "Titânio ASTM F136", color: `Cor ${index}`, quantity: index ? 1 : 0, is_active: 1 }));
    catalog.data.items[1].variants.push({ id: 999, material: "Aço", is_active: 0 });
    render(<PublicCatalog />);
    const card = screen.getByRole("heading", { name: "Joia 2" }).closest("article");
    expect(card).toHaveTextContent("11 variações");
    expect(card).toHaveTextContent("Titânio ASTM F136");
    expect(card).not.toHaveTextContent("turquesa");
    expect(card).not.toHaveTextContent("sem juros");
    expect(card).not.toHaveTextContent("via Pix");
  });
  it("favoritos persistem por clínica após remontar o catálogo e compra desabilitada esconde carrinho", () => {
    catalog.data.theme.show_buy_button = 0;
    const view = render(<PublicCatalog />);
    const card = screen.getByRole("heading", { name: "Joia 2" }).closest("article");
    fireEvent.click(card.querySelector('button[aria-label="Favoritar"]'));
    expect(card.querySelector('button[aria-label="Remover dos favoritos"]')).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: "Carrinho" })).not.toBeInTheDocument();
    view.unmount();
    render(<PublicCatalog />);
    expect(screen.getByRole("heading", { name: "Joia 2" }).closest("article").querySelector('button[aria-label="Remover dos favoritos"]')).toHaveAttribute("aria-pressed", "true");
  });
  it("Ver todos aponta à listagem completa depois de uma seleção curada, incluindo esgotados", () => {
    catalog.data.catalogSections.unshift({ section_type: "in_stock", is_active: 1 });
    catalog.data.featuredProducts = [{ product_id: 2, is_active: 1 }];
    render(<PublicCatalog />);
    expect(document.querySelectorAll("#catalog-products")).toHaveLength(1);
    expect(document.querySelector("#catalog-products")).toHaveTextContent("Joia 1");
    expect(document.querySelector("#catalog-products")).toHaveTextContent("Joia 2");
    expect(screen.getByRole("link", { name: "Ver todos" })).toHaveAttribute("href", "#catalog-products");
  });
  it("exibe esgotados, protege ocultos e compartilha o produto e a clínica corretos", async () => {
    render(<PublicCatalog />);
    expect(screen.getByRole("heading", { name: "Joia 1" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Joia 3" })).not.toBeInTheDocument();
    const article = screen.getByRole("heading", { name: "Joia 1" }).closest("article");
    const share = article.querySelector('a[href^="https://wa.me/?"]');
    expect(new URL(share.href).searchParams.get("text")).toContain("/catalogo/produto/1?t=clinica-a");
    const contact = article.querySelector('a[href^="https://wa.me/55"]');
    expect(new URL(contact.href).searchParams.get("text")).toContain("Joia 1");
    expect(new URL(contact.href).searchParams.get("text")).toContain("/catalogo/produto/1");
    expect(article.querySelector('a[aria-label="Abrir Joia 1"]').href).toContain("material=Tit");
  });
  it("complementa seleções curadas para permitir descobrir todas as joias publicadas", () => {
    catalog.data.featuredProducts = [{ product_id: 2, is_active: 1 }];
    render(<PublicCatalog />);
    expect(screen.getByRole("heading", { name: "Todas as joias" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Joia 1" })).toBeInTheDocument();
  });
  it("permite consultar variação esgotada e abre carrinho da variação disponível nos detalhes", async () => {
    window.history.replaceState({}, "", "/catalogo/produto/2?t=clinica-a&q=joia&variant=21");
    catalog.data.items[1].variants = [{ id: 21, variation_name: "6mm", quantity: 0, sale_value: 120, material: "Titânio" },
      { id: 22, variation_name: "8mm", quantity: 2, sale_value: 150, material: "Titânio" }];
    render(<PublicCatalog />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox"));
    expect(screen.getByRole("option", { name: /6mm/ })).not.toHaveAttribute("data-disabled");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("button", { name: /Adicionar 1 ao carrinho/ })).not.toBeInTheDocument();
    const contact = screen.getByRole("link", { name: "Pedir pelo WhatsApp" });
    expect(new URL(contact.href).searchParams.get("text")).toContain("Variacao: 6mm");
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: /8mm/ }));
    fireEvent.click(screen.getByRole("button", { name: "Adicionar 1 ao carrinho" }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    const stored = JSON.parse(localStorage.getItem("aura-catalog-order:clinica-a"));
    expect(stored[0]).toMatchObject({ id: 2, selected_variant_id: 22, sale_value: 150, quantity: 2 });
    expect(screen.getByRole("link", { name: "Voltar ao catálogo" }).href).toContain("q=joia");
  });
  it("mantém preço e estoque do produto sem variações e ignora pedidos legados de outras clínicas", async () => {
    localStorage.setItem("aura-catalog-order", JSON.stringify([{ id: 999, name: "Outro tenant", sale_value: 999 }]));
    window.history.replaceState({}, "", "/catalogo/produto/2?t=clinica-a");
    render(<PublicCatalog />);
    fireEvent.click(screen.getByRole("button", { name: "Adicionar 1 ao carrinho" }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    const stored = JSON.parse(localStorage.getItem("aura-catalog-order:clinica-a"));
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ id: 2, sale_value: 100, quantity: 3 });
    const quantity = screen.getByRole("spinbutton", { name: "Quantidade" });
    fireEvent.change(quantity, { target: { value: "" } });
    expect(quantity.value).toBe("");
    expect(screen.getByRole("button", { name: "Finalizar no site" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Finalizar pelo WhatsApp" })).toBeDisabled();
    expect(screen.queryByRole("link", { name: "Finalizar no site" })).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Informe quantidades inteiras");
    fireEvent.change(quantity, { target: { value: "4" } });
    expect(screen.getByRole("button", { name: "Finalizar no site" })).toBeDisabled();
    fireEvent.change(quantity, { target: { value: "2" } });
    expect(screen.getByRole("link", { name: "Finalizar no site" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Finalizar pelo WhatsApp" })).toBeInTheDocument();
  });
  it("informa produto ausente sem mostrar um produto diferente", () => {
    window.history.replaceState({}, "", "/catalogo/produto/999?t=clinica-a");
    render(<PublicCatalog />);
    expect(screen.getByRole("heading", { name: "Joia indisponível neste catálogo" })).toBeInTheDocument();
  });
});


async function verifyPublicDocumentEditing(input) {
  const user = userEvent.setup();
  await user.type(input, "52998224725");
  expect(input).toHaveValue("52998224725");
  fireEvent.blur(input);
  expect(input).toHaveValue("529.982.247-25");
  input.focus();
  input.setSelectionRange(4, 4);
  await user.keyboard("{Backspace}");
  expect(input).toHaveValue("529982.247-25");
  expect(input.selectionStart).toBe(3);
  input.setSelectionRange(0, 1);
  await user.keyboard("{Delete}");
  expect(input).toHaveValue("29982.247-25");
  await user.clear(input);
  expect(input).toHaveValue("");
  fireEvent.blur(input);
  expect(input).toHaveValue("");
}

describe("campos públicos com documentos e cupons", () => {
  it("checkout permite exclusão de separador, edição do primeiro caractere e limpeza sem restaurar a máscara", async () => {
    window.history.replaceState({}, "", "/comprar?t=clinica-a");
    render(<PublicCheckout />);
    await verifyPublicDocumentEditing(screen.getByLabelText("CPF (opcional)"));
    const coupon = screen.getByPlaceholderText("Cupom de desconto");
    const user = userEvent.setup();
    await user.type(coupon, "aura");
    expect(coupon).toHaveValue("aura");
    fireEvent.blur(coupon);
    expect(coupon).toHaveValue("AURA");
    await user.clear(coupon);
    expect(coupon).toHaveValue("");
  });
  it("agendamento e documento do responsável permitem editar o meio e apagar todo o documento", async () => {
    window.history.replaceState({}, "", "/agendar?t=clinica-a&service_id=1&professional_id=1&appointment_date=2026-10-09&appointment_time=10:00");
    catalog.data.services = [{ id: 1, name: "Perfuração", requires_guardian: true, base_price: 100 }];
    catalog.data.professionals = [{ id: 1, name: "Profissional", service_ids: [1] }];
    render(<PublicBooking />);
    await verifyPublicDocumentEditing(screen.getByLabelText("CPF (opcional)"));
    fireEvent.change(screen.getByLabelText("Data de nascimento"), { target: { value: "2015-01-01" } });
    await verifyPublicDocumentEditing(screen.getByLabelText("Documento do responsável"));
  });
});


describe("quantidades na compra pública", () => {
  it("bloqueia quantidade apagada ou maior que o estoque e permite continuar após correção", () => {
    window.history.replaceState({}, "", "/comprar?t=clinica-a");
    const order = { ...product(2, 3), qty: "" };
    localStorage.setItem("aura-catalog-order:clinica-a", JSON.stringify([order]));
    let view = render(<PublicCheckout />);
    expect(screen.getByRole("button", { name: "Confirmar compra" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Corrija as quantidades");
    expect(screen.getByText(/Quantidade inválida/)).toBeInTheDocument();
    view.unmount();
    localStorage.setItem("aura-catalog-order:clinica-a", JSON.stringify([{ ...order, qty: "4" }]));
    view = render(<PublicCheckout />);
    expect(screen.getByRole("button", { name: "Confirmar compra" })).toBeDisabled();
    view.unmount();
    localStorage.setItem("aura-catalog-order:clinica-a", JSON.stringify([{ ...order, qty: "2" }]));
    render(<PublicCheckout />);
    expect(screen.getByRole("button", { name: "Confirmar compra" })).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
