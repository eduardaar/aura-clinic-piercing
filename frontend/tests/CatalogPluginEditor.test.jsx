import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CatalogPluginEditor } from "../src/features/catalog/CatalogPluginEditor";

describe("CatalogPluginEditor", () => {
  it("adiciona somente uma configuração estruturada do WhatsApp", () => {
    const onChange = vi.fn();
    render(<CatalogPluginEditor plugins={[]} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Adicionar Botão de WhatsApp" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({
        id: expect.stringMatching(/^whatsapp_cta-/),
        pluginId: "whatsapp_cta",
        enabled: true,
        config: {
          phone: "",
          label: "Falar no WhatsApp",
          message: "Olá! Vim pelo catálogo online.",
          style: "primary"
        }
      })
    ]);
  });

  it("respeita plugin único, explica consentimento e normaliza campos ao editar", () => {
    const onChange = vi.fn();
    const plugins = [{
      id: "mapa-principal",
      pluginId: "maps_location",
      enabled: true,
      config: { address: "Rua A, 10", display: "link" }
    }];
    render(<CatalogPluginEditor plugins={plugins} onChange={onChange} />);

    expect(screen.getByRole("button", { name: "Adicionar Localização no Maps" })).toBeDisabled();
    expect(screen.getByText(/Obrigatório: third_party_maps/)).toBeInTheDocument();
    expect(screen.getByText("google.com, www.google.com, maps.google.com")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Título"), { target: { value: "  Onde estamos  " } });
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({
        pluginId: "maps_location",
        config: expect.objectContaining({
          title: "Onde estamos",
          address: "Rua A, 10",
          mapUrl: "https://www.google.com/maps/search/?api=1&query=Rua%20A%2C%2010"
        })
      })
    ]);
  });

  it("edita FAQ por campos conhecidos sem expor campo de HTML", () => {
    const onChange = vi.fn();
    render(<CatalogPluginEditor plugins={[{
      id: "faq-1",
      pluginId: "faq",
      enabled: true,
      config: { items: [{ question: "Como agendo?", answer: "Pelo catálogo." }] }
    }]} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("Pergunta 1"), { target: { value: "  Onde fica o estúdio?  " } });
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({
        pluginId: "faq",
        config: expect.objectContaining({
          items: [{ question: "Onde fica o estúdio?", answer: "Pelo catálogo." }]
        })
      })
    ]);
    expect(screen.queryByLabelText(/HTML/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/JavaScript/i)).not.toBeInTheDocument();
  });

  it("respeita recursos do plano e limite sem bloquear integrações já existentes", () => {
    const onChange = vi.fn();
    render(<CatalogPluginEditor
      plugins={[{
        id: "analytics-existente",
        pluginId: "google_analytics",
        enabled: true,
        config: { measurementId: "G-AB12CD34" }
      }]}
      enabledFeatures={["public_catalog_customization"]}
      pluginLimit={1}
      onChange={onChange}
    />);

    // O Analytics já salvo continua editável mesmo se não estiver disponível
    // para novas adições em uma futura regra de plano.
    expect(screen.getByLabelText("ID de medição do Google Analytics *")).toHaveValue("G-AB12CD34");
    expect(screen.getByRole("button", { name: "Adicionar Botão de WhatsApp" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Adicionar Perguntas frequentes" })).toBeDisabled();
    expect(screen.getAllByText("Limite de integrações atingido").length).toBeGreaterThan(0);
  });
});
