import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { ServicesWorkspace } from "../src/features/services/Services";
import { JewelryCards, JewelryEditor, JewelryTable } from "../src/features/inventory/Inventory";

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), invalidate: vi.fn(), options: {}, settings: {}, services: [{ id: 1, name: "Retorno", category: "Retorno", is_active: true }] }));
vi.mock("../src/lib/api", async (importOriginal) => ({
  ...(await importOriginal()),
  useFetch: (path) => ({ data: path === "/services" ? mocks.services : path === "/service-operational-settings" ? mocks.settings : mocks.options }),
  apiFetch: (...args) => mocks.apiFetch(...args),
  useApiInvalidate: () => mocks.invalidate,
  readStoredSession: () => ({ user: { id: 1, role: "admin" } }),
  tenantSlug: () => "teste"
}));

beforeEach(() => { mocks.apiFetch.mockReset(); mocks.services = [{ id: 1, name: "Retorno", category: "Retorno", is_active: true }]; });

it("editar só o selo de lançamento preserva o payload completo do produto e da variação", async () => {
  const user = userEvent.setup();
  const saved = vi.fn();
  mocks.apiFetch.mockResolvedValue({ ok: true, json: async () => ({ id: 8 }) });
  render(<JewelryEditor editing={{
    id: 8, name: "Argola", category: "Argolas", sku: "ARG-PROD", quantity: 6, low_stock_threshold: 0,
    can_publish: true, is_catalog_active: 1, is_published: 1, virtual_store_active: 1,
    images: [{ image_url: "https://cdn.test/principal.webp", is_primary: 1 }],
    variants: [{ id: 81, sku: "ARG-VAR", quantity: 6, low_stock_threshold: 0, purchase_cost_cents: 1700,
      sale_price_cents: 7900, price_multiplier: 3, price_manually_overridden: 1, is_active: 1,
      images: [{ image_url: "https://cdn.test/medida.webp", is_primary: 1 }] }]
  }} onSaved={saved} />);
  await user.click(screen.getByRole("tab", { name: "Comercial" }));
  await user.click(screen.getByRole("switch", { name: "Lançamento", exact: true }));
  fireEvent.submit(document.querySelector("#jewelry-editor-form"));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  const [path, options] = mocks.apiFetch.mock.calls.at(-1);
  expect(path).toBe("/jewelry/8");
  const body = JSON.parse(options.body);
  expect(body).toMatchObject({ is_new: true, quantity: 6, low_stock_threshold: 0, can_publish: true,
    is_catalog_active: true, is_published: true, virtual_store_active: true, sku: "ARG-PROD" });
  expect(body.images[0].image_url).toBe("https://cdn.test/principal.webp");
  expect(body.variants[0]).toMatchObject({ id: 81, sku: "ARG-VAR", quantity: 6, low_stock_threshold: 0,
    purchase_cost_cents: 1700, sale_price_cents: 7900, is_active: true });
  expect(body.variants[0].images[0].image_url).toBe("https://cdn.test/medida.webp");
});

it("procedimentos separam desativação e exclusão e exibem o bloqueio de histórico", async () => {
  const user = userEvent.setup();
  mocks.apiFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
  const { rerender } = render(<ServicesWorkspace />);
  await user.click(screen.getByRole("button", { name: "Mais ações" }));
  await user.click(screen.getByRole("menuitem", { name: "Desativar" }));
  expect(mocks.apiFetch).toHaveBeenLastCalledWith("/services/1", { method: "PATCH", body: JSON.stringify({ is_active: false }) });
  mocks.services = [{ ...mocks.services[0], is_active: false }];
  rerender(<ServicesWorkspace />);
  await user.click(screen.getByRole("button", { name: "Mais ações" }));
  expect(screen.getByRole("menuitem", { name: "Ativar" })).toBeInTheDocument();
  await user.click(screen.getByRole("menuitem", { name: "Excluir permanentemente" }));
  mocks.apiFetch.mockResolvedValue({ ok: false, json: async () => ({ error: "Possui histórico. Use Desativar." }) });
  await user.type(screen.getByRole("textbox", { name: /Digite SIM/ }), "SIM");
  await user.click(screen.getByRole("button", { name: "Excluir", exact: true }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Possui histórico. Use Desativar."));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});

it.each([JewelryTable, JewelryCards])("estoque mostra ativar, editar e excluir como ações distintas", async (Component) => {
  const user = userEvent.setup();
  const activate = vi.fn();
  const remove = vi.fn();
  const item = { id: 1, name: "Argola", status: "arquivado", quantity: 3 };
  render(<Component items={[item]} onEdit={() => {}} onArchive={activate} onDelete={remove} />);
  await user.click(screen.getByRole("button", { name: "Mais ações" }));
  expect(screen.getByRole("menuitem", { name: "Editar" })).toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "Excluir permanentemente" })).toBeInTheDocument();
  await user.click(screen.getByRole("menuitem", { name: "Ativar" }));
  expect(activate).toHaveBeenCalledWith(item);
  expect(remove).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Mais ações" }));
  await user.click(screen.getByRole("menuitem", { name: "Excluir permanentemente" }));
  expect(remove).toHaveBeenCalledWith(item);
});
