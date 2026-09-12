import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Modal } from "../src/components/common/Crud";

// O Radix só passa a ouvir cliques fora do diálogo depois de um tick.
const nextTick = () => new Promise((resolve) => setTimeout(resolve, 10));

function FormModal({ onClose, onSubmit = () => {}, footer = null }) {
  return (
    <Modal open title="Novo cliente" onClose={onClose} footer={footer}>
      <form id="client-form" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
        <label>Nome<input name="name" /></label>
      </form>
    </Modal>
  );
}

describe("Modal com formulário: nada se perde por acidente", () => {
  it("não fecha ao clicar fora, mesmo sem alterações", async () => {
    const onClose = vi.fn();
    render(<FormModal onClose={onClose} />);
    await nextTick();
    fireEvent.pointerDown(document.body);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Novo cliente" })).toBeInTheDocument();
  });

  it("sem alterações, o X fecha direto", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<FormModal onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Fechar" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("com alterações, pede confirmação e 'Continuar editando' preserva o preenchimento", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<FormModal onClose={onClose} />);
    await user.type(screen.getByLabelText("Nome"), "Ana");
    await user.click(screen.getByRole("button", { name: "Fechar" }));
    expect(screen.getByRole("alertdialog", { name: "Existem alterações não salvas" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continuar editando" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Nome")).toHaveValue("Ana");
  });

  it("'Salvar' envia o formulário; Esc e 'Sair sem salvar' fecham de fato", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSubmit = vi.fn();
    render(<FormModal onClose={onClose} onSubmit={onSubmit} />);
    await user.type(screen.getByLabelText("Nome"), "Ana");
    await user.click(screen.getByRole("button", { name: "Fechar" }));
    await user.click(screen.getByRole("button", { name: "Salvar" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sair sem salvar" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("o 'Cancelar' do rodapé também passa pela confirmação", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<FormModal onClose={onClose} footer={<button type="button" onClick={onClose}>Cancelar</button>} />);
    await user.type(screen.getByLabelText("Nome"), "Ana");
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Sair sem salvar" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("botões de ação do rodapé (Limpar, Aplicar) seguem direto", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<FormModal onClose={() => {}} footer={<button type="button" onClick={onApply}>Aplicar filtros</button>} />);
    await user.type(screen.getByLabelText("Nome"), "Ana");
    await user.click(screen.getByRole("button", { name: "Aplicar filtros" }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("modal sem formulário fecha sem perguntar, mesmo depois de digitar", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Modal open title="Filtros" onClose={onClose}><input aria-label="Busca" /></Modal>);
    await user.type(screen.getByLabelText("Busca"), "argola");
    await user.click(screen.getByRole("button", { name: "Fechar" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("`dirty` controlado por fora liga a guarda sem depender dos campos", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Modal open title="Itens" onClose={onClose} dirty><p>Três itens adicionados</p></Modal>);
    await user.click(screen.getByRole("button", { name: "Fechar" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Salvar" })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
