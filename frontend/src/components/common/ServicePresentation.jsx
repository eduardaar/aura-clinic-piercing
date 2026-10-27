// Cartão do serviço e bloco de informações completas do agendamento online.
// Usados pela página pública e pela pré-visualização do cadastro, para que o
// que a clínica vê ao editar seja exatamente o que o cliente vê.
import { useState } from "react";
import { ArrowRight, Check, Clock, Droplets, Gem, GraduationCap, HeartPulse, Palette, Repeat2, ScanSearch, Zap } from "lucide-react";
import { API_ORIGIN } from "../../lib/api";
import {
  formatDuration,
  publicInfoSections,
  serviceCardSummary,
  servicePrice,
  serviceRequirementFacts
} from "../../lib/servicePresentation";
import "../../styles/service-presentation.css";

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatServicePrice(value) {
  const amount = Number(value || 0);
  return Number.isInteger(amount) ? money.format(amount).replace(/,00$/, "") : money.format(amount);
}

export function serviceImageUrl(url) {
  const value = String(url || "").trim();
  return value.startsWith("/uploads/") ? `${API_ORIGIN}${value}` : value;
}

// Ícone da imagem padrão, escolhido pelo tipo de serviço para que dois
// serviços sem foto não pareçam o mesmo cartão.
function fallbackIcon(service = {}) {
  const words = `${service.category || ""} ${service.name || ""}`.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (/avalia|projeto|curadoria/.test(words)) return ScanSearch;
  if (/troca|atualiza|retorno|manutenc/.test(words)) return Repeat2;
  if (/anodiz/.test(words)) return Palette;
  if (/laser/.test(words)) return Zap;
  if (/limpeza|higien/.test(words)) return Droplets;
  if (/curso|mentoria|formac/.test(words)) return GraduationCap;
  if (/granuloma|tratamento/.test(words)) return HeartPulse;
  return Gem;
}

/** @param {{ service: any, className?: string }} props */
export function ServiceImage({ service = {}, className = "" }) {
  const src = serviceImageUrl(service.image_url);
  // Guarda qual endereço falhou: trocar a imagem no cadastro tenta de novo.
  const [failedSrc, setFailedSrc] = useState("");
  if (src && failedSrc !== src) {
    return (
      <img
        className={`service-image${className ? ` ${className}` : ""}`}
        src={src}
        alt={String(service.image_alt || "").trim() || `Imagem ilustrativa de ${service.name || "serviço"}`}
        loading="lazy"
        decoding="async"
        width="640"
        height="480"
        onError={() => setFailedSrc(src)}
      />
    );
  }
  const Icon = fallbackIcon(service);
  return (
    <span className={`service-image service-image-fallback${className ? ` ${className}` : ""}`} role="img" aria-label={`Imagem padrão de ${service.name || "serviço"}`}>
      <Icon size={40} strokeWidth={1.25} aria-hidden="true" />
    </span>
  );
}

/** @param {{ service: any, selected?: boolean, onToggle?: () => any, preview?: boolean }} props */
export function ServiceCard({ service = {}, selected = false, onToggle, preview = false }) {
  const summary = serviceCardSummary(service);
  const duration = formatDuration(service.duration_minutes);
  const content = (
    <>
      <span className="service-card-media">
        <ServiceImage service={service} />
        {selected && <span className="service-card-check" aria-hidden="true"><Check size={16} strokeWidth={3} /></span>}
      </span>
      <span className="service-card-body">
        <span className="service-card-heading">
          <strong className="service-card-title">{service.name || "Novo serviço"}</strong>
          <span className="service-card-price">{formatServicePrice(servicePrice(service))}</span>
        </span>
        {summary && <span className="service-card-summary">{summary}</span>}
        <span className="service-card-footer">
          <span className="service-card-duration">{duration && <><Clock size={15} aria-hidden="true" /> {duration}</>}</span>
          <span className="service-card-action">{selected ? <><Check size={15} aria-hidden="true" /> Selecionado</> : <>Selecionar <ArrowRight size={15} aria-hidden="true" /></>}</span>
        </span>
      </span>
    </>
  );
  if (preview) return <div className={`service-card is-preview${selected ? " is-selected" : ""}`}>{content}</div>;
  return (
    <button type="button" className={`service-card${selected ? " is-selected" : ""}`} aria-pressed={selected} onClick={onToggle}>
      {content}
    </button>
  );
}

// Texto livre em parágrafos curtos; linhas iniciadas por "-", "*" ou "•" viram lista.
export function ServiceRichText({ text }) {
  const blocks = String(text || "").split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  return blocks.map((block, index) => {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const key = `${index}-${block.slice(0, 24)}`;
    if (lines.every((line) => /^[-*•]\s+/.test(line))) {
      return (
        <ul key={key}>
          {lines.map((line, lineIndex) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: texto estático do cadastro; o índice desempata itens repetidos.
            <li key={`${lineIndex}-${line}`}>{line.replace(/^[-*•]\s+/, "")}</li>
          ))}
        </ul>
      );
    }
    return <p key={key}>{block}</p>;
  });
}

/** @param {{ service: any, showHeader?: boolean, children?: React.ReactNode }} props */
export function ServiceInfoBlock({ service = {}, showHeader = true, children }) {
  const facts = serviceRequirementFacts(service);
  const sections = publicInfoSections(service);
  const description = String(service.description || "").trim();
  const duration = formatDuration(service.duration_minutes);
  const deposit = Number(service.deposit_value || 0);
  return (
    <article className="service-info-block">
      {showHeader && (
        <header className="service-info-header">
          <ServiceImage service={service} />
          <div>
            <h3>{service.name || "Novo serviço"}</h3>
            <p>{serviceCardSummary(service)}</p>
          </div>
        </header>
      )}
      <dl className="service-info-facts">
        <div><dt>Valor</dt><dd>{formatServicePrice(servicePrice(service))}</dd></div>
        {duration && <div><dt>Duração estimada</dt><dd>{duration}</dd></div>}
        {deposit > 0 && <div><dt>Sinal</dt><dd>{formatServicePrice(deposit)}</dd></div>}
        {facts.map((fact) => <div key={fact.key}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
      </dl>
      {description && (
        <section className="service-info-section">
          <h4>Sobre o procedimento</h4>
          <ServiceRichText text={description} />
        </section>
      )}
      {sections.map((section, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: seções personalizadas repetem a chave; a lista não é reordenada aqui.
        <section className="service-info-section" key={`${section.key}-${index}`}>
          <h4>{section.title}</h4>
          <ServiceRichText text={section.body} />
        </section>
      ))}
      {!description && !sections.length && (
        <p className="service-info-empty">Não há informações adicionais cadastradas para este serviço. Em caso de dúvida, fale com o estúdio.</p>
      )}
      {children}
    </article>
  );
}
