import { useState } from "react";
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

describe("Modal: largura padronizada com uma única exceção", () => {
  it.each([undefined, "sm", "md", "lg", "xl"])("size=%s continua na largura média (modal-md)", (size) => {
    render(<Modal open title="Padrão" size={size} onClose={() => {}}><p>Conteúdo</p></Modal>);
    const dialog = screen.getByRole("dialog", { name: "Padrão" });
    expect(dialog).toHaveClass("modal-card", "modal-md");
    expect(dialog).not.toHaveClass("modal-workspace");
    expect(dialog).not.toHaveClass("modal-lg");
  });

  it("size=\"workspace\" aplica a área de trabalho e mantém a guarda", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal open title="Novo Agendamento" size="workspace" onClose={onClose}>
        <form><label>Nome<input name="name" /></label></form>
      </Modal>
    );
    const dialog = screen.getByRole("dialog", { name: "Novo Agendamento" });
    expect(dialog).toHaveClass("modal-card", "modal-workspace");
    expect(dialog).not.toHaveClass("modal-md");
    await user.type(screen.getByLabelText("Nome"), "Ana");
    await user.click(screen.getByRole("button", { name: "Fechar" }));
    expect(screen.getByRole("alertdialog", { name: "Existem alterações não salvas" })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("Modal: o que não pertence ao formulário não liga a guarda", () => {
  it("digitar num modal aninhado não marca o modal de fora", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    function Nested() {
      const [innerOpen, setInnerOpen] = useState(true);
      return (
        <Modal open title="Detalhes" onClose={onClose}>
          <form><label>Observação<input name="notes" /></label></form>
          <Modal open={innerOpen} title="Anular ajuste" confirmClose={false} onClose={() => setInnerOpen(false)} footer={<button type="button" onClick={() => setInnerOpen(false)}>Anular</button>}>
            <label>Motivo da anulação<textarea /></label>
          </Modal>
        </Modal>
      );
    }
    render(<Nested />);
    // Eventos do portal aninhado sobem pela árvore do React até o modal de fora.
    await user.type(screen.getByLabelText("Motivo da anulação"), "lançado em dobro");
    await user.click(screen.getByRole("button", { name: "Anular" }));
    await user.click(screen.getByRole("button", { name: "Fechar" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("áreas com `data-modal-ignore-dirty` (gravam na hora) não pedem confirmação", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal open title="Detalhes" onClose={onClose}>
        <form><label>Observação<input name="notes" /></label></form>
        <section data-modal-ignore-dirty=""><label>Valor do ajuste<input name="amount" /></label></section>
      </Modal>
    );
    await user.type(screen.getByLabelText("Valor do ajuste"), "15");
    await user.click(screen.getByRole("button", { name: "Fechar" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("o formulário do próprio modal continua ligando a guarda", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal open title="Detalhes" onClose={onClose}>
        <form><label>Observação<input name="notes" /></label></form>
        <section data-modal-ignore-dirty=""><label>Valor do ajuste<input name="amount" /></label></section>
      </Modal>
    );
    await user.type(screen.getByLabelText("Observação"), "cliente pediu troca");
    await user.click(screen.getByRole("button", { name: "Fechar" }));
    expect(screen.getByRole("alertdialog", { name: "Existem alterações não salvas" })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
