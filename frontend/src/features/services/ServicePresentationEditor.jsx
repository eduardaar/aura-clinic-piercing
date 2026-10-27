// Apresentação do serviço no agendamento online: imagem, descrição curta,
// seções da etapa final (ordenáveis) e pré-visualização com os mesmos
// componentes da página pública.
import { useRef, useState } from "react";
import { ArrowDown, ArrowUp, ImagePlus, Trash2 } from "lucide-react";
import { Button, Input, Select, Textarea } from "../../components/common/Ui";
import { ServiceCard, ServiceImage, ServiceInfoBlock } from "../../components/common/ServicePresentation";
import { apiFetch } from "../../lib/api";
import {
  SERVICE_INFO_SECTIONS,
  SHORT_DESCRIPTION_MAX,
  SHORT_DESCRIPTION_RECOMMENDED,
  serializeInfoSections,
  serviceCardSummary,
  serviceSectionDefinition
} from "../../lib/servicePresentation";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const IMAGE_MAX_BYTES = 6 * 1024 * 1024;

// Seções de coluna (`pre_service`, `aftercare`) ficam sempre na lista: elas
// alimentam a Agenda e o pós-atendimento, então só podem ser esvaziadas.
export function withColumnSections(sections = []) {
  const list = sections.map((section) => ({ ...section, uid: section.uid || nextSectionUid() }));
  for (const definition of SERVICE_INFO_SECTIONS.filter((item) => item.column)) {
    if (!list.some((section) => section.key === definition.key)) list.push({ key: definition.key, title: "", body: "", uid: nextSectionUid() });
  }
  return list;
}

// Identificador só da tela, para a lista manter foco e texto ao reordenar.
let sectionUidCounter = 0;
function nextSectionUid() {
  sectionUidCounter += 1;
  return `section-${sectionUidCounter}`;
}

// Converte o rascunho do formulário no corpo aceito por /api/services.
export function servicePresentationPayload(form) {
  const sections = Array.isArray(form.info_sections) ? form.info_sections : [];
  const columnText = (key) => String(sections.find((section) => section.key === key)?.body ?? "").trim();
  const { info_sections: _sections, ...rest } = form;
  return {
    ...rest,
    pre_service_notes: columnText("pre_service"),
    aftercare_instructions: columnText("aftercare"),
    public_info_sections: serializeInfoSections(sections)
  };
}

// O que a pré-visualização mostra: o formulário como o cliente verá.
export function previewService(form) {
  const payload = servicePresentationPayload(form);
  return { ...payload, price: form.base_price, public_info_sections: payload.public_info_sections };
}

/** @param {{ form: any, onChange: (patch: Record<string, any>) => any }} props */
export function ServiceImageField({ form, onChange }) {
  const input = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");

  async function upload(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!IMAGE_TYPES.includes(file.type)) return setMessage("Use uma imagem JPEG, PNG ou WebP.");
    if (file.size > IMAGE_MAX_BYTES) return setMessage("A imagem deve ter no máximo 6 MB.");
    setMessage("");
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await apiFetch("/uploads", { method: "POST", body });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 403) return setMessage("Seu perfil não pode enviar imagens. Peça a um administrador ou à recepção.");
      if (!response.ok || !payload.url) return setMessage(payload.error || "Não foi possível enviar a imagem.");
      onChange({ image_url: payload.url, image_alt: form.image_alt || `Imagem ilustrativa de ${form.name || "serviço"}` });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="service-image-field">
      <div className="service-image-field-preview service-presentation-theme"><ServiceImage service={form} /></div>
      <div className="stack">
        <div className="toolbar">
          <input ref={input} type="file" accept={IMAGE_TYPES.join(",")} hidden onChange={upload} />
          <Button type="button" variant="secondary" disabled={uploading} onClick={() => input.current?.click()}>
            <ImagePlus size={16} aria-hidden="true" /> {uploading ? "Enviando..." : form.image_url ? "Substituir imagem" : "Enviar imagem"}
          </Button>
          {form.image_url && <Button type="button" variant="ghost" onClick={() => onChange({ image_url: "", image_alt: "" })}>Remover imagem</Button>}
        </div>
        <small className="field-hint">Foto do procedimento ou do resultado, de preferência horizontal (4:3). JPEG, PNG ou WebP até 6 MB; o sistema otimiza o arquivo. Sem imagem, o cartão usa uma ilustração padrão.</small>
        {message && <small className="field-hint is-error" role="alert">{message}</small>}
        {form.image_url && <Input label="Texto alternativo da imagem" value={form.image_alt} onChange={(image_alt) => onChange({ image_alt })} maxLength={200} />}
      </div>
    </div>
  );
}

/** @param {{ value: string, onChange: (value: string) => any }} props */
export function ShortDescriptionField({ value, onChange }) {
  const length = String(value || "").length;
  const tone = length > SHORT_DESCRIPTION_RECOMMENDED ? " is-error" : "";
  return (
    <div className="stack">
      <Textarea label="Descrição curta do cartão" value={value} maxLength={SHORT_DESCRIPTION_MAX} onChange={onChange} rows={3} />
      <small className={`field-hint${tone}`}>
        {length}/{SHORT_DESCRIPTION_RECOMMENDED} caracteres recomendados. Uma ou duas frases; regras e orientações ficam nas informações completas.
      </small>
    </div>
  );
}

/** @param {{ sections: any[], onChange: (sections: any[]) => any }} props */
export function ServiceInfoSectionsEditor({ sections = [], onChange }) {
  const [adding, setAdding] = useState("");
  const used = new Set(sections.map((section) => section.key));
  const available = SERVICE_INFO_SECTIONS.filter((definition) => definition.repeatable || !used.has(definition.key));

  const update = (index, patch) => onChange(sections.map((section, current) => (current === index ? { ...section, ...patch } : section)));
  const move = (index, direction) => {
    const target = index + direction;
    if (target < 0 || target >= sections.length) return;
    const next = [...sections];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    onChange(next);
  };
  const add = (key) => {
    if (!key) return;
    onChange([...sections, { key, title: "", body: "", uid: nextSectionUid() }]);
    setAdding("");
  };

  return (
    <div className="stack service-info-editor">
      {sections.map((section, index) => {
        const definition = serviceSectionDefinition(section.key);
        const title = section.key === "custom" ? section.title || definition.title : definition.title;
        return (
          <div className="soft-card stack service-info-editor-item" key={section.uid || `${section.key}-${section.title}`}>
            <div className="service-info-editor-head">
              <strong>{title}</strong>
              <div className="row-actions">
                <Button type="button" variant="ghost" aria-label={`Mover ${title} para cima`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={16} /></Button>
                <Button type="button" variant="ghost" aria-label={`Mover ${title} para baixo`} disabled={index === sections.length - 1} onClick={() => move(index, 1)}><ArrowDown size={16} /></Button>
                {!definition.column && <Button type="button" variant="ghost" aria-label={`Remover ${title}`} onClick={() => onChange(sections.filter((_, current) => current !== index))}><Trash2 size={16} /></Button>}
              </div>
            </div>
            {section.key === "custom" && <Input label="Título da seção" value={section.title} maxLength={80} onChange={(value) => update(index, { title: value })} />}
            <Textarea label={section.key === "custom" ? "Texto" : `Texto de "${definition.title}"`} value={section.body} rows={4} onChange={(body) => update(index, { body })} />
            <small className="field-hint">{definition.hint ? `${definition.hint} ` : ""}Parágrafos separados por linha em branco; linhas iniciadas por "-" viram lista.{definition.column ? " Seção vazia não aparece para o cliente." : ""}</small>
          </div>
        );
      })}
      <div className="toolbar">
        <Select label="Adicionar seção" value={adding} onChange={setAdding}>
          <option value="">Escolha uma seção</option>
          {available.map((definition) => <option key={definition.key} value={definition.key}>{definition.title}</option>)}
        </Select>
        <Button type="button" variant="secondary" disabled={!adding} onClick={() => add(adding)}>Adicionar</Button>
      </div>
    </div>
  );
}

/** @param {{ form: any }} props */
export function ServicePresentationPreview({ form }) {
  const service = previewService(form);
  return (
    <div className="service-presentation-theme service-preview">
      <div className="stack">
        <strong>Cartão na escolha do serviço</strong>
        <ServiceCard service={service} preview />
        {!String(form.short_description || "").trim() && serviceCardSummary(service) && (
          <small className="field-hint">Sem descrição curta, o cartão mostra o início da descrição completa.</small>
        )}
      </div>
      <div className="stack">
        <strong>Informações completas na etapa final</strong>
        <div className="service-preview-info"><ServiceInfoBlock service={service} /></div>
      </div>
    </div>
  );
}
