import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { Purchases } from "../src/features/purchases/Purchases";
import { JewelryEditor } from "../src/features/inventory/Inventory";

const state = vi.hoisted(() => ({ products: [], calls: [] }));
vi.mock("../src/lib/api", () => ({
  apiFetch: vi.fn(async (path, options) => { state.calls.push({ path, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({ id: 1 }) }; }),
  readStoredSession: () => ({ user: { id: 1, role: "admin" } }),
  tenantSlug: () => "materials-qa",
  useApiInvalidate: () => vi.fn(),
  useFetch: (path) => ({ data: path === "/jewelry" ? state.products : path === "/finance/suppliers" ? [{ id: 1, name: "Fornecedor" }] : [], loading: false, error: "" }),
}));
beforeEach(() => { state.calls = []; state.products = []; localStorage.clear(); });

it("compra material também vendável e envia a variação que receberá estoque", async () => {
  state.products = [{ id: 5, name: "Gaze", can_sell: 1, can_use_in_service: 1, quantity: 2, stock_unit: "pacote", variants: [{ id: 51, variation_name: "Estéril", cost_value: 10, quantity: 2, is_active: 1 }, { id: 52, variation_name: "Inativa", is_active: 0 }] }];
  const user = userEvent.setup();
  render(<Purchases />);
  await user.click(screen.getByRole("button", { name: "Nova compra" }));
  await user.click(screen.getByRole("button", { name: "Produtos para revenda" }));
  await user.click(screen.getByLabelText("Fornecedor"));
  await user.click(screen.getByRole("option", { name: "Fornecedor" }));
  await user.click(screen.getByRole("button", { name: /2\. Itens/ }));
  await user.click(screen.getByLabelText("Tipo de item"));
  await user.click(screen.getByRole("option", { name: "Material de consumo" }));
  await user.click(screen.getByLabelText("Material"));
  await user.click(screen.getByRole("option", { name: /Gaze.*pacote/ }));
  expect(screen.getByLabelText("Variação")).toHaveTextContent("Estéril");
  await user.click(screen.getByLabelText("Variação"));
  expect(screen.queryByRole("option", { name: "Inativa" })).not.toBeInTheDocument();
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "Adicionar item" }));
  await user.click(screen.getByRole("button", { name: /3\. Pagamento/ }));
  // Submit the real form; payload must preserve the stock target.
  fireEvent.submit(document.querySelector("form"));
  await waitFor(() => expect(state.calls.some((call) => call.path === "/purchases")).toBe(true));
  expect(state.calls.find((call) => call.path === "/purchases").body.items[0]).toMatchObject({ product_id: 5, product_variant_id: 51, quantity: 1, unit_cost: 10 });
});

it("abre o cadastro existente e preserva o rascunho da compra", async () => {
  const navigate = vi.fn();
  const user = userEvent.setup();
  render(<Purchases onNavigate={navigate} />);
  await user.click(screen.getByRole("button", { name: "Nova compra" }));
  await user.click(screen.getByRole("button", { name: "Produtos para revenda" }));
  await user.click(screen.getByRole("button", { name: /2\. Itens/ }));
  await user.click(screen.getByLabelText("Tipo de item"));
  await user.click(screen.getByRole("option", { name: "Material de consumo" }));
  expect(screen.getByText(/Nenhum material ativo/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Cadastrar material no estoque" }));
  expect(navigate).toHaveBeenCalledWith("inventory", { target: "materiais" });
  expect(localStorage.getItem("aura:form-draft:materials-qa:1:purchase-new")).toContain("consumable");
});

it("cadastro reutilizado salva material não publicável com custo, saldo, mínimo e fornecedor", async () => {
  render(<JewelryEditor materialMode categories={[]} categoryOptions={["Labret"]} suppliers={[{ id: 9, name: "Fornecedor QA" }]} onSaved={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Nome do material"), { target: { value: "Gaze estéril" } });
  const user = userEvent.setup();
  await user.click(screen.getByLabelText("Categoria"));
  await user.click(screen.getByRole("option", { name: "Labret" }));
  fireEvent.change(screen.getByLabelText("Quantidade em estoque"), { target: { value: "4" } });
  fireEvent.change(screen.getByLabelText("Custo unitário"), { target: { value: "2.50" } });
  fireEvent.change(screen.getByLabelText("Estoque mínimo"), { target: { value: "2" } });
  await user.click(screen.getByLabelText("Fornecedor (opcional)"));
  await user.click(screen.getByRole("option", { name: "Fornecedor QA" }));
  fireEvent.submit(document.querySelector("form"));
  await waitFor(() => expect(state.calls).toHaveLength(1));
  expect(state.calls[0].body).toMatchObject({ name: "Gaze estéril", quantity: 4, cost_value: 2.5, can_sell: false, can_use_in_service: true, can_publish: false, low_stock_threshold: "2", supplier_id: "9" });
  expect(state.calls[0].body.variants[0]).toMatchObject({ quantity: "4", purchase_cost_cents: 250, supplier: "Fornecedor QA" });
});
