import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { PublicBooking } from "../src/pages/PublicExperience";

const state = vi.hoisted(() => ({ config: null, request: vi.fn() }));
vi.mock("../src/lib/api", () => ({
  API_ORIGIN: "",
  usePublicFetch: (path) => ({ data: path === "/booking/config" ? state.config : { items: [], theme: { brand_name: "Clínica QA" } } }),
  publicApiFetch: (...args) => state.request(...args)
}));
const config = () => ({
  services: [{ id: 1, name: "Avaliação", duration_minutes: 20, price: 0, deposit_value: 0 }],
  professionals: [{ id: 7, name: "Profissional QA", service_ids: [1] }],
  payment: { gateway_enabled: false }, rules: {}
});
beforeEach(() => {
  localStorage.clear();
  state.config = config();
  state.request.mockReset();
  state.request.mockImplementation(async () => ({ ok: true, json: async () => ({ slots: [{ time: "10:00" }] }) }));
  window.history.replaceState({}, "", "/agendar?t=qa&service_id=1&professional_id=7&appointment_date=2030-01-10&appointment_time=10:00");
});
async function summary(user) {
  await user.type(await screen.findByLabelText("Nome", { exact: true }), "Cliente QA");
  await user.type(screen.getByLabelText("WhatsApp", { exact: true }), "11988887777");
  await user.click(screen.getByRole("button", { name: "Ver resumo", exact: true }));
  await screen.findByRole("heading", { name: "Resumo da solicitação" });
}

it("carregar a configuração depois da primeira renderização preserva a profissional do link", async () => {
  const user = userEvent.setup();
  state.config = null;
  const view = render(<PublicBooking />);
  state.config = config();
  view.rerender(<PublicBooking />);
  await summary(user);
  expect(document.querySelector(".booking-summary-facts")).toHaveTextContent("Profissional QA");
  state.request.mockResolvedValue({ ok: true, json: async () => ({ id: 9, appointment_date: "2030-01-10", appointment_time: "10:00", payment_instructions: "Solicitação recebida." }) });
  await user.click(screen.getByRole("button", { name: "Confirmar solicitação" }));
  await waitFor(() => expect(state.request).toHaveBeenCalledWith("/booking/requests", expect.anything()));
  const body = state.request.mock.calls.find(([path]) => path === "/booking/requests")[1].body;
  expect(body.get("professional_id")).toBe("7");
});

it("falha de conexão no envio preserva dados e permite tentar novamente", async () => {
  const user = userEvent.setup();
  render(<PublicBooking />);
  await summary(user);
  state.request.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  await user.click(screen.getByRole("button", { name: "Confirmar solicitação" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Confirmar solicitação" })).toBeEnabled());
  expect(screen.getByText(/Não foi possível enviar.*tente novamente/i)).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Resumo da solicitação" })).toBeInTheDocument();
});

it("link de avaliação antiga volta aos serviços atuais com uma explicação", async () => {
  window.history.replaceState({}, "", "/agendar?t=qa&service_id=8");
  render(<PublicBooking />);
  expect(await screen.findByRole("heading", { name: "Escolha um ou mais serviços" })).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent(/serviço.*não está disponível/i);
  expect(screen.getByRole("button", { name: /Avaliação/ })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Nenhuma profissional vinculada" })).not.toBeInTheDocument();
});

it("profissional inválida no link retorna à seleção mantendo os serviços", async () => {
  window.history.replaceState({}, "", "/agendar?t=qa&service_id=1&professional_id=999&appointment_date=2030-01-10&appointment_time=10:00");
  render(<PublicBooking />);
  expect(await screen.findByRole("heading", { name: "Escolha a profissional" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Profissional QA/ })).toBeInTheDocument();
});

it("horário do link que ficou indisponível retorna à escolha de horário", async () => {
  state.request.mockResolvedValue({ ok: true, json: async () => ({ slots: [], dates: ["2030-01-10"] }) });
  render(<PublicBooking />);
  expect(await screen.findByRole("heading", { name: "Agende seu horário" })).toBeInTheDocument();
  expect(screen.getByText("Nenhum horário disponível nesta data.")).toBeInTheDocument();
});

it("serviços sem uma profissional em comum explicam que os agendamentos devem ser separados", async () => {
  const user = userEvent.setup();
  window.history.replaceState({}, "", "/agendar?t=qa");
  state.config = { ...config(), services: [...config().services, { id: 2, name: "Laser", duration_minutes: 30, price: 30 }],
    professionals: [...config().professionals, { id: 8, name: "Outra profissional", service_ids: [2] }] };
  render(<PublicBooking />);
  await user.click(screen.getByRole("button", { name: /Avaliação/ }));
  await user.click(screen.getByRole("button", { name: /Laser/ }));
  await user.click(screen.getByRole("button", { name: /^Continuar/ }));
  expect(await screen.findByText(/agendamentos separados/i)).toBeInTheDocument();
});

it("conflito de horário volta aos horários disponíveis preservando o nome e WhatsApp", async () => {
  const user = userEvent.setup();
  render(<PublicBooking />);
  await summary(user);
  state.request.mockImplementation(async (path) => path === "/booking/requests"
    ? { ok: false, status: 409, json: async () => ({ code: "booking_slot_unavailable", error: "O horário acabou de ser ocupado." }) }
    : { ok: true, json: async () => ({ dates: ["2030-01-10"], slots: [{ time: "11:00" }] }) });
  await user.click(screen.getByRole("button", { name: "Confirmar solicitação" }));
  expect(await screen.findByRole("heading", { name: "Agende seu horário" })).toBeInTheDocument();
  await user.click(await screen.findByRole("button", { name: "11:00", exact: true }));
  await user.click(screen.getByRole("button", { name: "Continuar", exact: true }));
  expect(screen.getByLabelText("Nome", { exact: true })).toHaveValue("Cliente QA");
  expect(screen.getByLabelText("WhatsApp", { exact: true })).toHaveValue("11988887777");
});
