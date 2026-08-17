import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Modal, RowActions } from "../src/components/common/Crud";
import { Accordion, Button, Checkbox, Input, Select, Switch, Tabs, Textarea } from "../src/components/common/Ui";

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

  it("troca abas com a semântica e o teclado do Radix", async () => {
    const user = userEvent.setup();
    let selected = "overview";
    render(
      <Tabs defaultValue="overview" onChange={(value) => { selected = value; }}>
        <Tabs.List aria-label="Seções do cadastro">
          <Tabs.Trigger value="overview">Visão geral</Tabs.Trigger>
          <Tabs.Trigger value="history">Histórico</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="overview">Resumo</Tabs.Content>
        <Tabs.Content value="history">Alterações</Tabs.Content>
      </Tabs>
    );

    screen.getByRole("tab", { name: "Visão geral" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(selected).toBe("history");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Alterações");
  });

  it("abre e fecha conteúdo do accordion", async () => {
    const user = userEvent.setup();
    render(
      <Accordion defaultValue="details">
        <Accordion.Item value="details">
          <Accordion.Header><Accordion.Trigger>Mais detalhes</Accordion.Trigger></Accordion.Header>
          <Accordion.Content>Conteúdo expansível</Accordion.Content>
        </Accordion.Item>
      </Accordion>
    );

    const trigger = screen.getByRole("button", { name: "Mais detalhes" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("expõe switch e campos com atributos HTML encaminhados", async () => {
    const user = userEvent.setup();
    let enabled = false;
    let fieldValue = "";
    render(
      <>
        <Switch label="Ativar lembretes" checked={false} onChange={(value) => { enabled = value; }} />
        <Input label="Telefone" value={fieldValue} onChange={(value) => { fieldValue = value; }} id="phone" name="phone" placeholder="(00) 00000-0000" inputMode="tel" maxLength={16} autoComplete="tel" />
        <Textarea label="Observação" value="" onChange={() => {}} id="note" disabled rows={5} />
        <Button aria-label="Salvar formulário" form="profile-form">Salvar</Button>
      </>
    );

    const toggle = screen.getByRole("switch", { name: "Ativar lembretes" });
    await user.click(toggle);
    expect(enabled).toBe(true);
    expect(screen.getByLabelText("Telefone")).toHaveAttribute("inputmode", "tel");
    expect(screen.getByLabelText("Telefone")).toHaveAttribute("maxlength", "16");
    expect(screen.getByLabelText("Observação")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Salvar formulário" })).toHaveAttribute("form", "profile-form");
  });
});
