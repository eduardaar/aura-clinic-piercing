import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { ServicesWorkspace } from "../src/features/services/Services";
import { JewelryCards, JewelryTable } from "../src/features/inventory/Inventory";

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
