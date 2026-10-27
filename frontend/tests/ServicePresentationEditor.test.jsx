// Cadastro do serviço: seções da etapa final, ordem e pré-visualização.
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import {
  ServiceInfoSectionsEditor,
  ServicePresentationPreview,
  servicePresentationPayload,
  withColumnSections
} from "../src/features/services/ServicePresentationEditor";

function Harness({ initial }) {
  const [sections, setSections] = useState(withColumnSections(initial));
  return (
    <>
      <ServiceInfoSectionsEditor sections={sections} onChange={setSections} />
      <output data-testid="payload">{JSON.stringify(servicePresentationPayload({ info_sections: sections }))}</output>
    </>
  );
}

const payload = () => JSON.parse(screen.getByTestId("payload").textContent);

describe("ServiceInfoSectionsEditor", () => {
  it("mantém as seções de coluna, reordena e grava o texto nas colunas próprias", async () => {
    const user = userEvent.setup();
    render(<Harness initial={[{ key: "warranty", title: "", body: "30 dias." }]} />);
    // As duas seções de coluna entram mesmo vazias e não podem ser removidas.
    expect(screen.queryByRole("button", { name: "Remover Antes do atendimento" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remover Garantia" })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Texto de "Cuidados após o atendimento"'), "Limpe com soro.");
    await user.click(screen.getByRole("button", { name: "Mover Cuidados após o atendimento para cima" }));
    expect(payload().public_info_sections).toEqual([{ key: "warranty", body: "30 dias." }, { key: "aftercare" }, { key: "pre_service" }]);
    expect(payload().aftercare_instructions).toBe("Limpe com soro.");
    expect(payload().pre_service_notes).toBe("");
    expect(payload()).not.toHaveProperty("info_sections");
  });

  it("adiciona seção personalizada com título próprio", async () => {
    const user = userEvent.setup();
    render(<Harness initial={[]} />);
    await user.click(screen.getByLabelText("Adicionar seção"));
    await user.click(await screen.findByRole("option", { name: "Outras informações" }));
    await user.click(screen.getByRole("button", { name: "Adicionar" }));
    await user.type(screen.getByLabelText("Título da seção"), "Duração do resultado");
    await user.type(screen.getByLabelText("Texto"), "Varia com o uso.");
    expect(payload().public_info_sections.at(-1)).toEqual({ key: "custom", title: "Duração do resultado", body: "Varia com o uso." });
  });
});

describe("ServicePresentationPreview", () => {
  it("mostra o cartão e as informações completas como o cliente verá", () => {
    render(
      <ServicePresentationPreview
        form={{
          name: "Anodização", base_price: "60", duration_minutes: 20, short_description: "", description: "Coloração eletroquímica. Sem tinta.",
          info_sections: withColumnSections([{ key: "rules", title: "", body: "Somente titânio." }])
        }}
      />
    );
    expect(screen.getByText("Cartão na escolha do serviço")).toBeInTheDocument();
    // Cartão e bloco completo usam a mesma imagem padrão.
    expect(screen.getAllByRole("img", { name: "Imagem padrão de Anodização" })).toHaveLength(2);
    expect(screen.getByText(/Sem descrição curta, o cartão mostra o início/)).toBeInTheDocument();
    const info = screen.getByRole("article");
    expect(within(info).getByText("Regras e condições")).toBeInTheDocument();
    expect(within(info).getByText("Somente titânio.")).toBeInTheDocument();
    expect(within(info).getByText("R$ 60")).toBeInTheDocument();
  });
});
