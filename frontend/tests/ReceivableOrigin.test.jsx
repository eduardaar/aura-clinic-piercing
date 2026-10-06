import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { AccountsReceivable } from "../src/features/finance/Receivables";
import { useFetch, apiFetch } from "../src/lib/api";

vi.mock("../src/lib/api", () => ({ useFetch: vi.fn(), apiFetch: vi.fn(), useApiInvalidate: () => vi.fn(), tenantSlug: () => "qa", readStoredSession: () => ({ user: { role: "admin" } }) }));

it("recebível identifica cliente e atendimento, mostra pagamentos e abre o registro específico", async () => {
  const row = { id: 8, entry_type: "receivable", description: "Atendimento #42", source_type: "service_execution", origin_label: "Atendimento #42", client_name: "João", appointment_date: "2026-10-06", appointment_time: "09:00", professional_name: "Áurea", procedure: "Hélix", due_date: "2026-10-06", amount: 70, paid_amount: 10, status: "partially_paid" };
  useFetch.mockImplementation((path) => ({ data: path?.startsWith("/finance/ledger") ? { entries: [row] } : [] }));
  apiFetch.mockResolvedValue({ ok: true, json: async () => ({ ...row, origin: { type: "appointment", label: "Atendimento #42", client: "João", date: "2026-10-06", time: "09:00", professional: "Áurea", procedure: "Hélix", total_value: 100, deposit_paid: 30, other_paid: 10, remaining_value: 60, items: [{ id: 1, service: "Hélix", product: "Joia de titânio", quantity: 1 }], payments: [{ id: 1, payment_type: "sinal", method: "Pix", status: "pago", amount: 30, paid_at: "2026-10-06" }], receivables: [], href: "/app/agenda?appointment=42" } }) });
  const user = userEvent.setup();
  render(<AccountsReceivable />);
  expect(screen.getByText("João")).toBeInTheDocument();
  expect(useFetch.mock.calls.some(([path]) => path?.includes("date_field=due_date"))).toBe(true);
  await user.click(screen.getByRole("button", { name: "Mais ações" }));
  await user.click(screen.getByRole("menuitem", { name: "Detalhes" }));
  expect(await screen.findByText("Sinal efetivamente pago")).toBeInTheDocument();
  expect(screen.getByText("Outros recebimentos")).toBeInTheDocument();
  expect(screen.getByText("Valor restante da operação")).toBeInTheDocument();
  expect(screen.getByText(/Joia de titânio/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Abrir atendimento de origem" })).toHaveAttribute("href", "/app/agenda?appointment=42");
});
