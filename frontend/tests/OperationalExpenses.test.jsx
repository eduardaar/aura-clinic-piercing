import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { PayablesAdmin } from "../src/features/finance/Payables";
import { JewelryEditor } from "../src/features/inventory/Inventory";
import { SelectWithCreate } from "../src/components/common/SelectWithCreate";

const state = vi.hoisted(() => ({ calls: [], entries: [] }));
vi.mock("../src/lib/api", () => ({
  apiFetch: vi.fn(async (path, options) => { state.calls.push({ path, body: JSON.parse(options.body) }); return { ok: true, json: async () => [{ id: 1 }] }; }),
  readStoredSession: () => ({ user: { id: 1, role: "admin" } }),
  tenantSlug: () => "ops-qa",
  useApiInvalidate: () => vi.fn(),
  useFetch: (path) => ({ data: path.startsWith("/finance/ledger") ? { entries: state.entries } : path === "/finance/categories" ? [
    { id: 1, name: "Aluguel", usage_scope: "expense" }, { id: 2, name: "Materiais de consumo", usage_scope: "purchase" }
  ] : [] }),
}));
beforeEach(() => { state.calls = []; state.entries = []; localStorage.clear(); });

it("salva despesa já paga sem produto, fornecedor ou categoria prévia", async () => {
  const user = userEvent.setup();
  render(<PayablesAdmin />);
  await user.click(screen.getByRole("button", { name: "Nova conta a pagar" }));
  fireEvent.change(screen.getByLabelText("Descrição"), { target: { value: "Conta de luz" } });
  fireEvent.change(screen.getByLabelText("Valor total"), { target: { value: "250" } });
  await user.click(screen.getByLabelText("Categoria"));
  expect(screen.getByRole("option", { name: "Aluguel" })).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "Materiais de consumo" })).not.toBeInTheDocument();
  await user.keyboard("{Escape}");
  await user.click(screen.getByLabelText("Situação da despesa"));
  await user.click(screen.getByRole("option", { name: "Já paga" }));
  fireEvent.change(screen.getByLabelText("Data do pagamento"), { target: { value: "2026-10-18" } });
  await user.click(screen.getByRole("button", { name: "Salvar conta" }));
  await waitFor(() => expect(state.calls).toHaveLength(1));
  expect(state.calls[0]).toMatchObject({ path: "/finance/entries", body: { category: "Outras despesas", amount: 250, paid_amount: 250, paid_at: "2026-10-18", supplier_id: "", status: "paid" } });
  expect(state.calls[0].body).not.toHaveProperty("items");
});

it("material usa categorias próprias sem oferecer categorias de joias", async () => {
  const user = userEvent.setup();
  render(<JewelryEditor materialMode categoryOptions={["Labret", "Materiais de consumo"]} categories={[
    { name: "Labret", usage_scope: "product" }, { name: "Materiais de consumo", usage_scope: "material" }
  ]} />);
  await user.click(screen.getByLabelText("Categoria"));
  expect(screen.getByRole("option", { name: "Materiais de consumo" })).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "Labret" })).not.toBeInTheDocument();
});

it("criar categoria não impede escolher outra depois", async () => {
  function Form() {
    const [value, setValue] = useState("");
    return <SelectWithCreate label="Categoria" value={value} onChange={(next) => setValue(next)} options={[{ id: "Aluguel", name: "Aluguel" }]}
      createTitle="Nova categoria" createLabel="Nome" onCreate={async (name) => ({ id: name, name })} />;
  }
  const user = userEvent.setup();
  render(<Form />);
  await user.click(screen.getByRole("button", { name: "Nova categoria" }));
  await user.type(screen.getByLabelText("Nome"), "Condomínio");
  await user.click(screen.getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(screen.getByLabelText("Categoria")).toHaveTextContent("Condomínio"));
  await user.click(screen.getByLabelText("Categoria"));
  await user.click(screen.getByRole("option", { name: "Aluguel" }));
  expect(screen.getByLabelText("Categoria")).toHaveTextContent("Aluguel");
});
