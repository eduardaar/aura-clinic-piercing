import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  AdvancedFields,
  FormPage,
  FormSection,
  FormWorkflow,
  ReviewSummary,
  StepNavigator,
  ValidationSummary,
} from "../src/components/common/FormWorkflow";

describe("fundação compartilhada de formulários", () => {
  it("estrutura página, etapa e seção sem esconder o conteúdo", () => {
    render(
      <FormWorkflow title="Novo cliente" description="Dados essenciais" draft={{ savedAt: "2026-08-30T15:30:00.000Z" }}>
        <FormPage title="Identificação">
          <FormSection title="Contato" badge="Obrigatório">
            <input aria-label="Telefone" />
          </FormSection>
        </FormPage>
      </FormWorkflow>,
    );

    expect(screen.getByRole("heading", { name: "Novo cliente" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Identificação" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Contato" })).toContainElement(screen.getByLabelText("Telefone"));
    expect(screen.getByRole("status")).toHaveTextContent("Rascunho salvo às");
  });

  it("navega por etapas permitidas e bloqueia avanço linear distante", async () => {
    const user = userEvent.setup();
    const onStepChange = vi.fn();
    render(
      <StepNavigator
        currentStep="contact"
        linear
        onStepChange={onStepChange}
        steps={[
          { id: "contact", label: "Contato" },
          { id: "health", label: "Saúde", optional: true },
          { id: "review", label: "Conferência" },
        ]}
      />,
    );

    expect(screen.getByRole("button", { name: "1. Contato" })).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("button", { name: "3. Conferência" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "2. Saúde, opcional" }));
    expect(onStepChange).toHaveBeenCalledWith("health", 1);
  });

  it("revela campos avançados pelo accordion acessível", async () => {
    const user = userEvent.setup();
    render(
      <AdvancedFields count={2}>
        <input aria-label="Código externo" />
      </AdvancedFields>,
    );

    const trigger = screen.getByRole("button", { name: /Campos avançados/ });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Código externo")).toBeInTheDocument();
  });

  it("resume validações e leva ao campo escolhido", async () => {
    const user = userEvent.setup();
    const onErrorClick = vi.fn();
    render(
      <ValidationSummary
        errors={[{ field: "email", label: "E-mail", message: "Informe um endereço válido" }]}
        onErrorClick={onErrorClick}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Informe um endereço válido/ }));
    expect(onErrorClick).toHaveBeenCalledWith(
      "email",
      expect.objectContaining({ field: "email", message: "Informe um endereço válido" }),
    );
  });

  it("mostra conferência em grupos e permite voltar para editar", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    render(
      <ReviewSummary
        onEdit={onEdit}
        sections={[
          {
            id: "contact",
            title: "Contato",
            items: [
              { label: "WhatsApp", value: true },
              { label: "Observações", value: "" },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByText("Sim")).toBeInTheDocument();
    expect(screen.getByText("Não informado")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Editar" }));
    expect(onEdit).toHaveBeenCalledWith("contact", expect.objectContaining({ title: "Contato" }));
  });
});
