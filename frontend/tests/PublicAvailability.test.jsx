import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { PublicAvailabilityEditor } from "../src/features/agenda/PublicAvailabilityEditor";
import { PublicBookingCalendar } from "../src/components/common/PublicBookingCalendar";

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), publicApiFetch: vi.fn() }));
vi.mock("../src/lib/api", () => mocks);
const ok = (json) => ({ ok: true, json: async () => json });

beforeEach(() => {
  mocks.apiFetch.mockReset();
  mocks.publicApiFetch.mockReset();
});

describe("Liberação de agenda pública", () => {
  it("monta um mês inteiro, permite ajustar dias e horários e salva por profissional", async () => {
    mocks.apiFetch.mockImplementation(async (_path, options) =>
      ok(options?.method === "PUT" ? JSON.parse(options.body) : { restricted: false, windows: [] }),
    );
    render(<PublicAvailabilityEditor professionalId="7" />);
    await screen.findByRole("button", { name: "Adicionar período" });
    await userEvent.click(screen.getByRole("combobox", { name: "Liberar período" }));
    await userEvent.click(await screen.findByRole("option", { name: "Mês inteiro" }));
    fireEvent.change(screen.getByLabelText("Mês a liberar"), { target: { value: "2030-02" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar período" }));
    expect(screen.getByLabelText("De")).toHaveValue("2030-02-01");
    expect(screen.getByLabelText("Até")).toHaveValue("2030-02-28");
    fireEvent.change(screen.getByLabelText("A partir de"), { target: { value: "14:00" } });
    fireEvent.click(screen.getByLabelText("Dom"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar disponibilidade pública" }));
    await screen.findByText("Disponibilidade do link público salva com sucesso.");
    const [path, options] = mocks.apiFetch.mock.calls.find(([, options]) => options?.method === "PUT");
    expect(path).toBe("/availability/public/7");
    expect(JSON.parse(options.body)).toEqual({
      restricted: true,
      windows: [
        { from: "2030-02-01", to: "2030-02-28", start_time: "14:00", end_time: "18:00", weekdays: [1, 2, 3, 4, 5, 6] },
      ],
    });
  });

  it("libera a semana escolhida de segunda a domingo e aceita outro período personalizado", async () => {
    mocks.apiFetch.mockResolvedValue(ok({ restricted: true, windows: [] }));
    render(<PublicAvailabilityEditor professionalId="7" />);
    await screen.findByRole("button", { name: "Adicionar período" });
    await userEvent.click(screen.getByRole("combobox", { name: "Liberar período" }));
    await userEvent.click(await screen.findByRole("option", { name: "Semana específica" }));
    fireEvent.change(screen.getByLabelText("Uma data da semana"), { target: { value: "2030-11-06" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar período" }));
    expect(screen.getByLabelText("De")).toHaveValue("2030-11-04");
    expect(screen.getByLabelText("Até")).toHaveValue("2030-11-10");
    await userEvent.click(screen.getByRole("combobox", { name: "Liberar período" }));
    await userEvent.click(await screen.findByRole("option", { name: "Período personalizado" }));
    fireEvent.click(screen.getByRole("button", { name: "Adicionar período" }));
    expect(screen.getAllByLabelText("De")).toHaveLength(2);
  });
});

describe("Calendário público", () => {
  it("reconsulta as datas quando muda a composição, mesmo mantendo o primeiro serviço", async () => {
    mocks.publicApiFetch.mockImplementation(async (path) => {
      const params = new URL(path, "https://aura.test").searchParams;
      return ok({ dates: params.get("service_ids") === "1,2" ? ["2030-11-11"] : ["2030-11-10", "2030-11-11"] });
    });
    const onChange = vi.fn();
    const { rerender } = render(<PublicBookingCalendar serviceId={1} serviceIds={[1]} professionalId={7} value="2030-11-10" onChange={onChange} />);
    await waitFor(() => expect(document.querySelectorAll(".booking-date-strip button")).toHaveLength(2));
    rerender(<PublicBookingCalendar serviceId={1} serviceIds={[1, 2]} professionalId={7} value="2030-11-10" onChange={onChange} />);
    await waitFor(() => expect(document.querySelectorAll(".booking-date-strip button")).toHaveLength(1));
    fireEvent.click(document.querySelector(".booking-date-strip button"));
    expect(onChange).toHaveBeenLastCalledWith("2030-11-11");
    const query = new URL(mocks.publicApiFetch.mock.calls.at(-1)[0], "https://aura.test").searchParams;
    expect(query.get("service_ids")).toBe("1,2");
  });
  it("navega entre meses e mostra somente as datas retornadas pela disponibilidade", async () => {
    mocks.publicApiFetch.mockImplementation(async (path) =>
      ok({ dates: path.includes("month=2030-11") ? ["2030-11-04", "2030-11-12"] : ["2030-12-02"] }),
    );
    const onChange = vi.fn();
    render(<PublicBookingCalendar serviceId="1" professionalId="7" value="2030-11-04" onChange={onChange} />);
    fireEvent.click(await screen.findByRole("button", { name: /12 de novembro de 2030/ }));
    expect(onChange).toHaveBeenCalledWith("2030-11-12");
    expect(screen.queryByRole("button", { name: /5 de novembro de 2030/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Próximo mês" }));
    await screen.findByRole("button", { name: /2 de dezembro de 2030/ });
    expect(screen.queryByRole("button", { name: /12 de novembro de 2030/ })).not.toBeInTheDocument();
  });

  it("ignora resposta atrasada de outro mês", async () => {
    let resolveFirst;
    mocks.publicApiFetch.mockImplementation((path) =>
      path.includes("month=2030-11")
        ? new Promise((resolve) => {
            resolveFirst = resolve;
          })
        : Promise.resolve(ok({ dates: ["2030-12-02"] })),
    );
    render(<PublicBookingCalendar serviceId="1" professionalId="7" value="2030-11-04" onChange={() => {}} />);
    await waitFor(() => expect(resolveFirst).toBeTypeOf("function"));
    fireEvent.click(screen.getByRole("button", { name: "Próximo mês" }));
    await screen.findByRole("button", { name: /2 de dezembro de 2030/ });
    await act(async () => resolveFirst(ok({ dates: ["2030-11-04"] })));
    expect(screen.queryByRole("button", { name: /4 de novembro de 2030/ })).not.toBeInTheDocument();
  });
});
