import { Accordion, Button, Checkbox, Input, Select, Textarea } from "../../components/common/Ui";
import { CatalogImageField } from "./CatalogAdminFields";
import { useFetch } from "../../lib/api";
import { asArray } from "../../lib/utils";
import { BOUTIQUE_FIELDS, BOUTIQUE_GROUPS, BOUTIQUE_SECTION_TYPES, BOUTIQUE_ICONS, BOUTIQUE_FILTERS, defaultBoutiqueConfig } from "./boutiqueConfig";
import "../../styles/catalog-boutique-editor.css";

const iconLabels = { gem: "Joia", heart: "Cora\u00e7\u00e3o", shield: "Escudo", message: "Mensagem", star: "Estrela", clock: "Hor\u00e1rio", map: "Localiza\u00e7\u00e3o", instagram: "Instagram" };
const id = (prefix) => `${prefix}-${globalThis.crypto.randomUUID()}`;
const move = (items, index, delta) => { const next = [...items]; const target = index + delta; if (target >= 0 && target < next.length) [next[index], next[target]] = [next[target], next[index]]; return next; };
const parse = (value) => { try { return typeof value === "string" ? JSON.parse(value) : value; } catch { return {}; } };

function ListActions({ index, count, onMove, onRemove }) {
  return <div className="boutique-editor-actions"><Button type="button" variant="secondary" disabled={!index} onClick={() => onMove(-1)}>Subir</Button><Button type="button" variant="secondary" disabled={index === count - 1} onClick={() => onMove(1)}>Descer</Button>{onRemove && <Button type="button" variant="ghost" onClick={onRemove}>Remover</Button>}</div>;
}

function LinksEditor({ items, onChange, label }) {
  return <div className="stack"><strong>{label}</strong>{items.map((item, index) => <div className="boutique-editor-item" key={item.id}>
    <div className="form-grid"><Input label="Texto do link" value={item.label} onChange={(label) => onChange(items.map((row, i) => i === index ? { ...row, label } : row))} /><Input label="Destino do link" value={item.url} onChange={(url) => onChange(items.map((row, i) => i === index ? { ...row, url } : row))} placeholder="https://, /agendar ou @whatsapp" /></div>
    <ListActions index={index} count={items.length} onMove={(delta) => onChange(move(items, index, delta))} onRemove={() => onChange(items.filter((_, i) => i !== index))} />
  </div>)}<Button type="button" variant="secondary" disabled={items.length >= 20} onClick={() => onChange([...items, { id: id("link"), label: "Novo link", url: "" }])}>Adicionar link</Button></div>;
}

/** @param {{value?: any, onChange: (value: any) => void, categories?: any[]}} props */
export function CatalogBoutiqueEditor({ value, onChange, categories = [] }) {
  const { data: commercialCategories } = useFetch("/catalog-categories");
  categories = [...new Map([...asArray(commercialCategories).map((row) => ({ name: row.path || row.name, value: row.slug })), ...categories].map((row) => [row.value || row.name, row])).values()];
  const config = { ...defaultBoutiqueConfig(), ...parse(value) };
  const set = (key, value) => onChange({ ...config, [key]: value });
  const update = (key, index, patch) => set(key, config[key].map((row, i) => i === index ? { ...row, ...patch } : row));
  return <section className="panel stack boutique-editor" aria-label="Componentes e opções da loja Boutique">
    <div className="panel-heading"><div><h2>Componentes da loja Boutique</h2><p>Edite o conteúdo, a ordem e a aparência. Salve o rascunho e publique quando estiver pronto.</p></div></div>
    <Accordion type="multiple" defaultValue={["sections"]}>
      <Accordion.Item value="sections"><Accordion.Header><Accordion.Trigger>Ordem e visibilidade dos componentes</Accordion.Trigger></Accordion.Header><Accordion.Content><div className="stack">
        {config.sections.map((section, index) => <article className="boutique-editor-item" key={section.id}>
          <Checkbox label={BOUTIQUE_SECTION_TYPES[section.type]} checked={section.enabled} onChange={(enabled) => update("sections", index, { enabled })} />
          <small className="field-hint">Atalho para links do menu: #{section.id}</small>
          {section.type === "custom" && <><Input label="Título do conteúdo" value={section.title || ""} onChange={(title) => update("sections", index, { title })} /><Textarea label="Texto do conteúdo" value={section.text || ""} onChange={(text) => update("sections", index, { text })} /><CatalogImageField label="Imagem do conteúdo" value={section.image_url || ""} onChange={(image_url) => update("sections", index, { image_url })} /><div className="form-grid"><Input label="Texto do botão" value={section.link_label || ""} onChange={(link_label) => update("sections", index, { link_label })} /><Input label="Destino do botão" value={section.link_url || ""} onChange={(link_url) => update("sections", index, { link_url })} /></div></>}
          <ListActions index={index} count={config.sections.length} onMove={(delta) => set("sections", move(config.sections, index, delta))} onRemove={section.type === "custom" ? () => set("sections", config.sections.filter((_, i) => i !== index)) : undefined} />
        </article>)}
        <Button type="button" variant="secondary" disabled={config.sections.length >= 24} onClick={() => set("sections", [...config.sections, { id: id("custom"), type: "custom", enabled: true, title: "", text: "", image_url: "", link_label: "", link_url: "" }])}>Adicionar conteúdo personalizado</Button>
      </div></Accordion.Content></Accordion.Item>
      {Object.entries(BOUTIQUE_GROUPS).map(([group, title]) => <Accordion.Item value={group} key={group}><Accordion.Header><Accordion.Trigger>{title}</Accordion.Trigger></Accordion.Header><Accordion.Content><div className="stack">
        <div className="form-grid">{Object.entries(BOUTIQUE_FIELDS).filter(([, field]) => field.group === group).map(([key, field]) => field.type === "boolean"
          ? <Checkbox key={key} label={field.label} checked={config[key]} onChange={(value) => set(key, value)} />
          : field.type === "textarea" ? <Textarea key={key} label={field.label} value={config[key]} onChange={(value) => set(key, value)} />
          : field.type === "select" ? <Select key={key} label={field.label} value={config[key]} onChange={(value) => set(key, value)}>{field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</Select>
          : <Input key={key} label={field.label} type={field.type === "number" ? "number" : field.type === "color" ? "color" : "text"} min={field.min} max={field.max} value={config[key]} onChange={(value) => set(key, field.type === "number" && value !== "" ? Number(value) : value)} />)}</div>
        {group === "header" && <LinksEditor label="Links adicionais do menu" items={config.navigation_links} onChange={(items) => set("navigation_links", items)} />}
        {group === "benefits" && <><p className="field-hint">Os itens podem ser removidos, ocultados ou reordenados. Use @whatsapp para o contato configurado da clínica.</p>{config.benefits.map((item, index) => <article className="boutique-editor-item" key={item.id}>
          <Checkbox label="Exibir benefício" checked={item.enabled} onChange={(enabled) => update("benefits", index, { enabled })} /><div className="form-grid"><Input label="Título do benefício" value={item.title} onChange={(title) => update("benefits", index, { title })} /><Select label="Ícone" value={item.icon} onChange={(icon) => update("benefits", index, { icon })}>{BOUTIQUE_ICONS.map((icon) => <option key={icon} value={icon}>{iconLabels[icon]}</option>)}</Select></div><Input label="Descrição do benefício" value={item.text} onChange={(text) => update("benefits", index, { text })} /><Input label="Link do benefício" value={item.url} onChange={(url) => update("benefits", index, { url })} />
          <ListActions index={index} count={config.benefits.length} onMove={(delta) => set("benefits", move(config.benefits, index, delta))} onRemove={() => set("benefits", config.benefits.filter((_, i) => i !== index))} />
        </article>)}<Button type="button" variant="secondary" disabled={config.benefits.length >= 12} onClick={() => set("benefits", [...config.benefits, { id: id("benefit"), icon: "gem", title: "", text: "", url: "", enabled: true }])}>Adicionar benefício</Button></>}
        {group === "categories" && <div className="stack"><strong>Categorias em destaque e sua ordem</strong><p className="field-hint">Sem seleção, acompanha a ordem das categorias cadastradas. As imagens são gerenciadas no cadastro das categorias.</p>{config.category_keys.map((key, index) => <div className="boutique-editor-item" key={key}><strong>{categories.find((row) => (row.value || row.name) === key)?.name || key}</strong><ListActions index={index} count={config.category_keys.length} onMove={(delta) => set("category_keys", move(config.category_keys, index, delta))} onRemove={() => set("category_keys", config.category_keys.filter((value) => value !== key))} /></div>)}<Select label="Adicionar categoria aos destaques" value="" onChange={(key) => key && !config.category_keys.includes(key) && set("category_keys", [...config.category_keys, key])}><option value="">Selecione uma categoria</option>{categories.filter((row) => row.name !== "Todos" && !config.category_keys.includes(row.value || row.name)).map((row) => <option key={row.value || row.name} value={row.value || row.name}>{row.name}</option>)}</Select></div>}
        {group === "products" && <div className="stack"><strong>Filtros disponíveis</strong><p className="field-hint">Só aparecem filtros habilitados que tenham dados cadastrados.</p>{Object.entries(BOUTIQUE_FILTERS).map(([key, label]) => <Checkbox key={key} label={label} checked={config.filters.includes(key)} onChange={(checked) => set("filters", checked ? [...config.filters, key] : config.filters.filter((value) => value !== key))} />)}</div>}
        {group === "footer" && <>{config.footer_columns.map((column, index) => <article className="boutique-editor-item" key={column.id}><Checkbox label="Exibir coluna" checked={column.enabled} onChange={(enabled) => update("footer_columns", index, { enabled })} /><div className="form-grid"><Input label="Título da coluna" value={column.title} onChange={(title) => update("footer_columns", index, { title })} /><Select label="Conteúdo da coluna" value={column.type} onChange={(type) => update("footer_columns", index, { type })}><option value="brand">Marca e apresentação</option><option value="categories">Categorias</option><option value="contact">Contatos e horários</option><option value="location">Localização</option><option value="text">Texto livre</option><option value="links">Links</option></Select></div><Textarea label="Texto da coluna" value={column.text} onChange={(text) => update("footer_columns", index, { text })} /><Checkbox label="Mostrar logo nesta coluna" checked={Boolean(column.show_logo)} onChange={(show_logo) => update("footer_columns", index, { show_logo })} /><Checkbox label="Mostrar Instagram nesta coluna" checked={Boolean(column.show_instagram)} onChange={(show_instagram) => update("footer_columns", index, { show_instagram })} /><LinksEditor label="Links da coluna" items={column.links} onChange={(links) => update("footer_columns", index, { links })} /><ListActions index={index} count={config.footer_columns.length} onMove={(delta) => set("footer_columns", move(config.footer_columns, index, delta))} onRemove={() => set("footer_columns", config.footer_columns.filter((_, i) => i !== index))} /></article>)}<Button type="button" variant="secondary" disabled={config.footer_columns.length >= 6} onClick={() => set("footer_columns", [...config.footer_columns, { id: id("column"), type: "text", title: "", text: "", links: [], enabled: true }])}>Adicionar coluna ao rodapé</Button><p className="field-hint">Cores e dados da empresa continuam disponíveis em Rodapé e identidade e Contato e políticas.</p></>}
      </div></Accordion.Content></Accordion.Item>)}
    </Accordion>
  </section>;
}
