import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Modal, RowActions } from "../src/components/common/Crud";
import { Checkbox, Select } from "../src/components/common/Ui";

describe("componentes Radix compartilhados", () => {
  it("mantém a opção vazia e atualiza o valor do select", async () => {
    const user = userEvent.setup();
    let received = null;
    render(
      <Select label="Status" value="" onChange={(value) => { received = value; }}>
        <option value="">Todos</option>
        <option value="active">Ativo</option>
      </Select>
    );

    const trigger = screen.getByRole("combobox", { name: "Status" });
    await user.click(trigger);
    await user.click(screen.getByRole("option", { name: "Ativo" }));
    expect(received).toBe("active");
  });

  it("expõe o checkbox como controle acessível", async () => {
    const user = userEvent.setup();
    let received = null;
    render(<Checkbox label="Receber avisos" checked={false} onChange={(value) => { received = value; }} />);

    const checkbox = screen.getByRole("checkbox");
    await user.click(checkbox);
    expect(received).toBe(true);
  });

  it("abre ações secundárias de uma lista em menu acessível", async () => {
    const user = userEvent.setup();
    let deleted = false;
    render(<RowActions actions={[
      { label: "Editar", onClick: () => {} },
      { label: "Excluir", danger: true, onClick: () => { deleted = true; } }
    ]} />);

    await user.click(screen.getByRole("button", { name: "Mais ações" }));
    await user.click(screen.getByRole("menuitem", { name: "Excluir" }));
    expect(deleted).toBe(true);
  });

  it("fecha o modal Radix pela ação padrão de fechar", async () => {
    const user = userEvent.setup();
    let closed = false;
    render(<Modal open title="Editar categoria" onClose={() => { closed = true; }}>Conteúdo</Modal>);

    expect(screen.getByRole("dialog", { name: "Editar categoria" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Fechar" }));
    expect(closed).toBe(true);
  });
});
