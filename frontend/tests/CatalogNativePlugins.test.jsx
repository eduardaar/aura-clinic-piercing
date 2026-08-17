import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CatalogNativePlugins,
  getCatalogNativeSeoMetadata,
  normalizeCatalogNativePlugins
} from "../src/features/catalog/CatalogNativePlugins";

describe("CatalogNativePlugins", () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, "", "/catalogo?t=plugin-test");
  });

  afterEach(() => {
    document.querySelectorAll("script[data-aura-google-analytics]").forEach((script) => { script.remove(); });
    delete window.gtag;
    delete window.dataLayer;
  });

  it("renderiza somente plugins conhecidos e habilitados com links seguros", () => {
    render(<CatalogNativePlugins plugins={[
      { id: "wa", pluginId: "whatsapp_cta", config: { phone: "+55 (71) 99999-1111", label: "Falar com a equipe", message: "Olá!" } },
      { id: "insta", pluginId: "instagram_profile", config: { username: "aura.clinic", label: "Ver perfil", openInNewTab: false } },
      { id: "off", pluginId: "faq", enabled: false, config: { items: [{ question: "Não aparece?", answer: "Não deve aparecer." }] } },
      { id: "unknown", pluginId: "<script>alert(1)</script>", config: {} }
    ]} />);

    expect(screen.getByRole("link", { name: "Falar com a equipe" })).toHaveAttribute("href", "https://wa.me/5571999991111?text=Ol%C3%A1!");
    const instagram = screen.getByRole("link", { name: "Ver perfil" });
    expect(instagram).toHaveAttribute("href", "https://www.instagram.com/aura.clinic/");
    expect(instagram).not.toHaveAttribute("target");
    expect(screen.queryByText("Não aparece?")).not.toBeInTheDocument();
  });

  it("mantém Maps como link até o visitante consentir e renderiza FAQ como conteúdo de texto", async () => {
    const user = userEvent.setup();
    const { container } = render(<CatalogNativePlugins plugins={[
      {
        id: "mapa", pluginId: "maps_location", config: {
          title: "Como chegar", address: "Rua das Joias, 10", display: "embed",
          embedUrl: "https://maps.google.com/maps/embed?pb=nao-deve-ser-usado"
        }
      },
      {
        id: "faq", pluginId: "faq", config: {
          title: "Dúvidas", items: [{ question: "Posso agendar?", answer: "Sim, pelo catálogo.\nSem precisar de HTML." }]
        }
      }
    ]} />);

    expect(screen.getByRole("link", { name: "Abrir no Google Maps" })).toHaveAttribute("href", "https://www.google.com/maps/search/?api=1&query=Rua%20das%20Joias%2C%2010");
    expect(container.querySelector("iframe")).toBeNull();
    expect(screen.getByText(/sua privacidade/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Posso agendar?" }));
    expect(screen.getByText(/Sem precisar de HTML/)).toBeInTheDocument();
  });

  it("mantém SEO não visual e aplica fallback seguro", () => {
    const plugins = [{ id: "seo", pluginId: "seo_metadata", config: { title: "  Catálogo <seguro>  ", description: "Uma descrição", indexing: "noindex" } }];
    expect(getCatalogNativeSeoMetadata(plugins, { seo_title: "Ignorado" }, { brand_name: "Aura" })).toEqual({
      title: "Catálogo <seguro>", description: "Uma descrição", indexing: "noindex"
    });
    expect(normalizeCatalogNativePlugins([{ pluginId: "seo_metadata", enabled: false, config: { title: "x", description: "y" } }])).toEqual([]);

    const { container } = render(<CatalogNativePlugins plugins={plugins} settings={{}} theme={{}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("persiste consentimento e só então carrega o iframe de Maps", async () => {
    const user = userEvent.setup();
    const { container } = render(<CatalogNativePlugins plugins={[{
      id: "mapa", pluginId: "maps_location", config: {
        address: "Rua das Joias, 10", display: "embed", embedUrl: "https://maps.google.com/maps/embed?pb=example"
      }
    }]} />);

    expect(container.querySelector("iframe")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Aceitar todos" }));
    expect(container.querySelector("iframe")).toHaveAttribute("src", "https://maps.google.com/maps/embed?pb=example");
    expect(JSON.parse(localStorage.getItem("aura-catalog-plugin-consent:v1:plugin-test"))).toEqual({
      configured: true,
      purposes: { third_party_maps: true, analytics: false }
    });
  });

  it("carrega Analytics somente após consentimento e envia denied ao retirar", async () => {
    const user = userEvent.setup();
    const gtag = vi.fn();
    window.gtag = gtag;
    render(<CatalogNativePlugins plugins={[{
      id: "analytics", pluginId: "google_analytics", config: { measurementId: "G-AB12CD34" }
    }]} />);

    expect(document.querySelector("script[data-aura-google-analytics]")).toBeNull();
    expect(gtag).toHaveBeenCalledWith("consent", "update", expect.objectContaining({ analytics_storage: "denied" }));

    await user.click(screen.getByRole("button", { name: "Aceitar todos" }));
    await waitFor(() => expect(document.querySelector("script[data-aura-google-analytics='G-AB12CD34']")).toBeInTheDocument());
    expect(gtag).toHaveBeenCalledWith("consent", "update", expect.objectContaining({ analytics_storage: "granted" }));

    await user.click(screen.getByRole("button", { name: "Preferências de privacidade" }));
    await user.click(screen.getByLabelText("Medição de visitas"));
    await user.click(screen.getByRole("button", { name: "Salvar escolhas" }));
    await waitFor(() => expect(document.querySelector("script[data-aura-google-analytics]")).toBeNull());
    expect(gtag).toHaveBeenLastCalledWith("consent", "update", expect.objectContaining({ analytics_storage: "denied" }));
  });

  it("constrói o link de avaliação do Google a partir do Place ID", () => {
    render(<CatalogNativePlugins plugins={[{
      id: "review", pluginId: "google_review_link", config: { placeId: "ChIJN1t_tDeuEmsRUsoyG83frY4", label: "Avaliar a Aura" }
    }]} />);
    expect(screen.getByRole("link", { name: "Avaliar a Aura" })).toHaveAttribute("href", "https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4");
  });
});
