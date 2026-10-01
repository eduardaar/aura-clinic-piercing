import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StatusSelect } from "../src/components/common/Ui";
import { PlanUpgradeNotice } from "../src/components/common/PlanUpgradeNotice";
import { CalendarEvent } from "../src/features/agenda/Agenda";

// Lacunas pequenas de interface (relatório lacunas-interface.md, itens 29 e 37)
// e o aviso de plano com o nome do plano certo.

describe("StatusSelect", () => {
  it("mostra rótulos legíveis e envia o código", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<StatusSelect value="pendente" onChange={onChange} options={["pendente", "em_atendimento", "nao_compareceu"]} />);
    await user.click(screen.getByRole("combobox", { name: "Status" }));
    expect(screen.queryByRole("option", { name: "em_atendimento" })).not.toBeInTheDocument();
    await user.click(await screen.findByRole("option", { name: "Em atendimento" }));
    expect(onChange).toHaveBeenCalledWith("em_atendimento");
  });
});

describe("PlanUpgradeNotice", () => {
  it("usa o plano informado no botão e no rodapé", () => {
    const { rerender } = render(<PlanUpgradeNotice title="Comissões" planName="Studio" onUpgrade={() => {}}>Texto</PlanUpgradeNotice>);
    expect(screen.getByRole("button", { name: "Conhecer o Studio" })).toBeInTheDocument();
    rerender(<PlanUpgradeNotice title="Comissões" planName="Studio">Texto</PlanUpgradeNotice>);
    expect(screen.getByText("Peça ao administrador do estúdio para liberar o plano Studio.")).toBeInTheDocument();
  });

  it("sem planName continua no Profissional", () => {
    render(<PlanUpgradeNotice title="Contas a receber" onUpgrade={() => {}}>Texto</PlanUpgradeNotice>);
    expect(screen.getByRole("button", { name: "Conhecer o Profissional" })).toBeInTheDocument();
  });
});

describe("card do calendário", () => {
  const item = { id: 3, status: "confirmado", appointment_time: "10:00", full_name: "Ana Souza", procedure: "Helix", professional_name: "Bia" };

  beforeEach(() => localStorage.setItem("aura-session", JSON.stringify({ user: { id: 1, role: "admin" } })));

  it.each([
    ["Remarcar", "reschedule"],
    ["Cancelar com resolução", "cancel"],
    ["Revisar e finalizar", "finalize"]
  ])("“%s” abre o atendimento no passo pedido", async (label, intent) => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { container } = render(<CalendarEvent item={item} onSelect={onSelect} />);
    await user.click(within(/** @type {HTMLElement} */ (container.querySelector(".event-actions"))).getByRole("button"));
    await user.click(await screen.findByRole("menuitem", { name: label }));
    expect(onSelect).toHaveBeenCalledWith(item, intent);
  });

  it("atendimento encerrado não oferece remarcar, cancelar nem finalizar", () => {
    const { container } = render(<CalendarEvent item={{ ...item, status: "atendido" }} onSelect={vi.fn()} />);
    expect(container.querySelector(".event-actions")?.childElementCount).toBe(0);
  });
});
