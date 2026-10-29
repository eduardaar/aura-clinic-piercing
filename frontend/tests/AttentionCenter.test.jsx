import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { AttentionCenter } from "../src/features/dashboard/AttentionCenter";
import { AlertsPopup } from "../src/features/dashboard/Dashboard";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), useFetch: vi.fn() }));
vi.mock("../src/lib/api", () => ({ useFetch: (...args) => mocks.useFetch(...args) }));

it("mostra contagens reais, muda período, atualiza e abre os destinos", async () => {
  mocks.useFetch.mockReturnValue({ data: { appointments: 13, sold_out: 6, birthdays: 2, returns: 18, updated_at: "2026-10-29T19:13:00Z" }, refresh: mocks.refresh, loading: false });
  const setPage = vi.fn();
  const user = userEvent.setup();
  render(<AttentionCenter setPage={setPage} />);
  expect(screen.getByText("13")).toBeInTheDocument();
  expect(screen.getByText("18")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Atualizado às 16:13");
  await user.click(screen.getByRole("button", { name: "Esta semana" }));
  expect(mocks.useFetch).toHaveBeenLastCalledWith("/dashboard/attention?period=week");
  await user.click(screen.getByRole("button", { name: "Este mês" }));
  expect(mocks.useFetch).toHaveBeenLastCalledWith("/dashboard/attention?period=month");
  await user.click(screen.getByRole("button", { name: "Atualizar Central de atenção" }));
  expect(mocks.refresh).toHaveBeenCalled();
  for (const [name, page] of [["Ver agendamentos", "agenda"], ["Ver estoque", "inventory"], ["Ver clientes", "client-center"], ["Acompanhar clientes", "postcare"]]) {
    await user.click(screen.getByRole("button", { name }));
    expect(setPage).toHaveBeenLastCalledWith(page);
  }
});

it("oculta categorias sem permissão e oferece nova tentativa em caso de erro", async () => {
  mocks.useFetch.mockReturnValue({ data: { appointments: 0, sold_out: null, birthdays: null, returns: null }, refresh: mocks.refresh });
  const { rerender } = render(<AttentionCenter setPage={() => {}} />);
  expect(screen.queryByText("Joias esgotadas")).not.toBeInTheDocument();
  expect(screen.getByText("00")).toBeInTheDocument();
  mocks.useFetch.mockReturnValue({ data: { error: "Falha ao carregar" }, refresh: mocks.refresh });
  rerender(<AttentionCenter setPage={() => {}} />);
  expect(screen.getByRole("alert")).toHaveTextContent("Falha ao carregar");
  expect(screen.getByRole("button", { name: "Atualizar Central de atenção" })).toBeEnabled();
});

it("janela do sininho reúne a Central e os alertas detalhados, com atalhos e fechamento", async () => {
  mocks.useFetch.mockReturnValue({ data: { appointments: 3, sold_out: 6, birthdays: 2, returns: 8 }, refresh: mocks.refresh, loading: false });
  const onAction = vi.fn();
  const onClose = vi.fn();
  const user = userEvent.setup();
  render(<AlertsPopup alerts={{ items: [{ id: "invoice-1", category: "Cobrança", title: "Fatura pendente", action_page: "meu-plano", action_label: "Ver faturas" }] }} loading={false} onAction={onAction} onClose={onClose} />);
  expect(screen.getByRole("dialog", { name: "Central de atenção" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Central de atenção" })).toBeInTheDocument();
  expect(screen.getByText("Fatura pendente")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Ver estoque" }));
  expect(onAction).toHaveBeenLastCalledWith("inventory");
  await user.click(screen.getByRole("button", { name: "Ver faturas" }));
  expect(onAction).toHaveBeenLastCalledWith("meu-plano");
  await user.click(screen.getByRole("button", { name: "Fechar Central de atenção" }));
  expect(onClose).toHaveBeenCalledTimes(1);
  await user.keyboard("{Escape}");
  expect(onClose).toHaveBeenCalledTimes(2);
});
