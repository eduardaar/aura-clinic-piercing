// Peças da vitrine comercial: faixa de coleções (campanhas), árvore de
// categorias e a página de uma coleção. A página da coleção também serve de
// prévia no painel, para a clínica ver exatamente o que vai ao ar.
import { useState } from "react";
import { CalendarClock, ChevronRight, LayoutGrid } from "lucide-react";
import { Accordion } from "../../components/common/Ui";
import { API_ORIGIN } from "../../lib/api";
import { publicUrl } from "../../lib/publicRoutes";
import "../../styles/catalog-collections.css";

export function collectionImageUrl(url) {
  const value = String(url || "").trim();
  return value.startsWith("/uploads/") ? `${API_ORIGIN}${value}` : value;
}

export function campaignUrl(slug) {
  return publicUrl(`/catalogo/colecao/${slug}`);
}

const dateFormat = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "long" });

export function campaignPeriodText(campaign = {}) {
  if (!campaign.ends_at) return "";
  const end = new Date(campaign.ends_at);
  return Number.isNaN(end.getTime()) ? "" : `Disponível até ${dateFormat.format(end)}`;
}

/** @param {{ campaign: any, className?: string, eager?: boolean }} props */
export function CampaignPicture({ campaign = {}, className = "", eager = false }) {
  const desktop = collectionImageUrl(campaign.banner_desktop_url || campaign.cover_url);
  const mobile = collectionImageUrl(campaign.banner_mobile_url || campaign.cover_url || campaign.banner_desktop_url);
  const [failed, setFailed] = useState("");
  const alt = String(campaign.image_alt || "").trim() || campaign.title || "Coleção";
  if (!desktop && !mobile) return <span className={`campaign-picture campaign-picture--empty ${className}`} aria-hidden="true" />;
  if (failed === `${desktop}|${mobile}`) return <span className={`campaign-picture campaign-picture--empty ${className}`} role="img" aria-label={alt} />;
  return (
    <picture className={`campaign-picture ${className}`}>
      {mobile && <source media="(max-width: 640px)" srcSet={mobile} />}
      <img src={desktop || mobile} alt={alt} loading={eager ? "eager" : "lazy"} decoding="async" onError={() => setFailed(`${desktop}|${mobile}`)} />
    </picture>
  );
}

/** Faixa de coleções na página inicial do catálogo. @param {{ campaigns: any[], title?: string }} props */
export function CatalogCampaignBand({ campaigns = [], title = "Coleções especiais" }) {
  if (!campaigns.length) return null;
  const [featured, ...rest] = [...campaigns].sort((a, b) => Number(Boolean(b.highlighted)) - Number(Boolean(a.highlighted)));
  return (
    <section className="catalog-campaign-band" aria-label={title}>
      <a className={`catalog-campaign-card catalog-campaign-card--featured${featured.highlighted ? " is-highlighted" : ""}`} href={campaignUrl(featured.slug)}>
        <CampaignPicture campaign={featured} eager />
        <span className="catalog-campaign-card__copy">
          <small>{featured.highlighted ? "Em destaque" : "Coleção"}</small>
          <strong>{featured.title}</strong>
          {featured.summary && <span>{featured.summary}</span>}
          <em>Ver coleção <ChevronRight size={16} aria-hidden="true" /></em>
        </span>
      </a>
      {rest.length > 0 && (
        <div className="catalog-campaign-band__rest">
          {rest.map((campaign) => (
            <a key={campaign.id} className="catalog-campaign-card" href={campaignUrl(campaign.slug)}>
              <CampaignPicture campaign={campaign} />
              <span className="catalog-campaign-card__copy"><strong>{campaign.title}</strong><em>Ver coleção <ChevronRight size={15} aria-hidden="true" /></em></span>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

/** Árvore expansível de categorias. @param {{ tree: any[], activeSlug: string, onSelect: (slug: string) => any }} props */
export function CatalogCategoryTree({ tree = [], activeSlug = "", onSelect }) {
  const renderNodes = (nodes, depth) => (
    <ul className={`catalog-category-tree__list depth-${Math.min(depth, 4)}`}>
      {nodes.map((node) => (
        <li key={node.id}>
          {node.children.length ? (
            <Accordion type="multiple" className="catalog-category-tree__group">
              <Accordion.Item value={`category-${node.id}`}>
                <div className="catalog-category-tree__row">
                  <button type="button" className={activeSlug === node.slug ? "is-active" : ""} aria-current={activeSlug === node.slug ? "true" : undefined} onClick={() => onSelect(node.slug)}>{node.name}</button>
                  <Accordion.Header><Accordion.Trigger aria-label={`Subcategorias de ${node.name}`}><span className="sr-only">Subcategorias de {node.name}</span></Accordion.Trigger></Accordion.Header>
                </div>
                <Accordion.Content>{renderNodes(node.children, depth + 1)}</Accordion.Content>
              </Accordion.Item>
            </Accordion>
          ) : (
            <div className="catalog-category-tree__row">
              <button type="button" className={activeSlug === node.slug ? "is-active" : ""} aria-current={activeSlug === node.slug ? "true" : undefined} onClick={() => onSelect(node.slug)}>{node.name}</button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
  return (
    <nav className="catalog-category-tree" aria-label="Categorias do catálogo">
      <button type="button" className={`catalog-category-tree__all${!activeSlug || activeSlug === "Todos" ? " is-active" : ""}`} onClick={() => onSelect("Todos")}><LayoutGrid size={16} aria-hidden="true" /> Todas as joias</button>
      {renderNodes(tree, 0)}
    </nav>
  );
}

/**
 * Página de uma coleção. `children` é a grade de produtos já filtrada pela
 * subcategoria escolhida.
 * @param {{ campaign: any, sectionSlug?: string, onSectionChange?: (slug: string) => any, count: number, children?: React.ReactNode, backHref?: string }} props
 */
export function CampaignShowcase({ campaign = {}, sectionSlug = "", onSectionChange, count, children, backHref }) {
  const sections = Array.isArray(campaign.sections) ? campaign.sections : [];
  const period = campaignPeriodText(campaign);
  return (
    <section className="catalog-campaign-page" aria-labelledby={`campaign-title-${campaign.id || "preview"}`}>
      <div className="catalog-campaign-hero">
        <CampaignPicture campaign={campaign} eager className="catalog-campaign-hero__image" />
        <div className="catalog-campaign-hero__copy">
          <span className="catalog-campaign-kicker">Coleção</span>
          <h1 id={`campaign-title-${campaign.id || "preview"}`}>{campaign.title || "Nova coleção"}</h1>
          {campaign.summary && <p>{campaign.summary}</p>}
          <div className="catalog-campaign-meta">
            {period && <span><CalendarClock size={15} aria-hidden="true" /> {period}</span>}
            {campaign.promotion?.badge && <span className="catalog-campaign-badge">{campaign.promotion.badge}</span>}
          </div>
          {campaign.promotion?.legal_text && <small className="catalog-campaign-legal">{campaign.promotion.legal_text}</small>}
        </div>
      </div>
      {sections.length > 0 && (
        <div className="catalog-campaign-sections" role="group" aria-label="Subcategorias da coleção">
          <button type="button" aria-pressed={!sectionSlug} className={!sectionSlug ? "is-active" : ""} onClick={() => onSectionChange?.("")}>Todos</button>
          {sections.map((section) => (
            <button type="button" key={section.id} aria-pressed={sectionSlug === section.slug} className={sectionSlug === section.slug ? "is-active" : ""} onClick={() => onSectionChange?.(section.slug)}>{section.name}</button>
          ))}
        </div>
      )}
      <div className="catalog-campaign-results">
        <strong>{count} {count === 1 ? "joia" : "joias"}</strong>
        {backHref && <a href={backHref}>Ver catálogo completo</a>}
      </div>
      {count > 0 ? children : <p className="empty-state catalog-empty">Ainda não há joias disponíveis nesta coleção. Volte em breve ou veja o catálogo completo.</p>}
    </section>
  );
}

/** Link expirado ou fora do ar. @param {{ state: string, title?: string, backHref: string }} props */
export function CampaignUnavailable({ state, title, backHref }) {
  const ended = state === "ended";
  return (
    <section className="catalog-campaign-unavailable">
      <span className="catalog-campaign-kicker">Coleção</span>
      <h1>{ended ? `A coleção ${title || ""} foi encerrada` : "Esta coleção não está disponível"}</h1>
      <p>{ended ? "Obrigado pelo interesse! As joias continuam no catálogo enquanto houver estoque." : "O endereço pode ter mudado ou a coleção ainda não começou."}</p>
      <a className="primary-button" href={backHref}>Ver catálogo</a>
    </section>
  );
}
