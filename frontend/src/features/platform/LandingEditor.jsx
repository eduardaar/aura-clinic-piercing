// Editor da landing pública (a página em "/"), dentro do painel da plataforma.
//
// O super-admin edita texto, imagem, ordem e ligado/desligado de cada bloco. O
// LAYOUT continua sendo código React em pages/Landing.jsx — aqui só se edita o
// conteúdo, e é isso que impede o painel de quebrar a página de vendas.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ExternalLink, ImageIcon, Plus, Trash2 } from "lucide-react";
import { Button, Checkbox, Input, StatusBadge, Textarea } from "../../components/common/Ui";
import { Modal } from "../../components/common/Crud";
import { ApiError, Loading } from "../../components/common/Feedback";
import { API, API_ORIGIN } from "../../lib/api";
import { asArray, asObject } from "../../lib/utils";
import "../../styles/landing-editor.css";

// Nome amigável e a explicação de onde cada bloco aparece na página. A chave
// crua ("showcase_links") não diz nada a quem só quer trocar um texto.
const SECTION_INFO = {
  hero: {
    name: "Topo da página",
    hint: "Primeira dobra: título, os dois botões e a imagem de abertura.",
  },
  features: {
    name: "Recursos do sistema",
    hint: "Os quatro cards que explicam o que a plataforma faz.",
  },
  carousel: {
    name: "Carrossel de imagens",
    hint: "Faixa de fotos que passam sozinhas. Nasce desligado.",
  },
  plans: {
    name: "Planos",
    hint: "Chamada dos planos. Os preços vêm do cadastro de planos.",
  },
  showcase_links: {
    name: "Veja quem já usa",
    hint: "Os dois links para as vitrines públicas das clínicas.",
  },
  closing: {
    name: "Fechamento e rodapé",
    hint: "Última chamada para ação e os textos do rodapé.",
  },
};

const sectionName = (key) => SECTION_INFO[key]?.name || key;

// Explicação do alt fica em UM lugar só: repetir o texto por campo faria a tela
// virar um paredão, mas omitir faria o campo parecer opcional — e ele não é.
const ALT_HINT = "Descreva a imagem em uma frase. É o que leitores de tela anunciam e o que o Google usa para entender a página.";

const HREF_HINT = "Use um caminho do próprio site (ex.: /cadastro) ou um endereço https://.";

// `/uploads/...` é servido pelo backend, que roda em outra origem em
// desenvolvimento; `/assets/...` é arquivo estático do próprio front.
function previewSrc(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  return value.startsWith("/uploads/") ? `${API_ORIGIN}${value}` : value;
}

function moveInList(list, index, direction) {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= list.length) return list;
  const copy = [...list];
  const [item] = copy.splice(index, 1);
  copy.splice(nextIndex, 0, item);
  return copy;
}

// Cópia profunda barata: o rascunho não pode compartilhar objetos com o que veio
// do servidor, senão a comparação "tem alteração não salva?" nunca acusaria nada.
const cloneContent = (value) => JSON.parse(JSON.stringify(asObject(value)));

const hasChanges = (draft, saved) => JSON.stringify(draft) !== JSON.stringify(asObject(saved));

export function LandingEditor({ token, onUnauthorized }) {
  const [sections, setSections] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [activeKey, setActiveKey] = useState("");
  // Rascunhos por bloco: trocar de bloco não pode jogar fora o que foi digitado,
  // então o que está sendo editado vive aqui até o salvamento (ou o descarte).
  const [drafts, setDrafts] = useState({});
  const [feedback, setFeedback] = useState({ error: "", success: "" });
  const [savingKey, setSavingKey] = useState("");
  const [discarding, setDiscarding] = useState("");
  const [dragKey, setDragKey] = useState("");

  // O callback de 401 vem do painel e é recriado a cada render dele. Guardado em
  // ref, `request` deixa de mudar de identidade — sem isso o efeito de carga
  // dispararia de novo a cada render do painel.
  const unauthorizedRef = useRef(onUnauthorized);
  useEffect(() => {
    unauthorizedRef.current = onUnauthorized;
  }, [onUnauthorized]);

  // Fetch da plataforma: Bearer do token de plataforma e sem X-Tenant (o
  // super-admin não pertence a clínica nenhuma). O Content-Type NÃO é forçado em
  // FormData — definir o header manualmente apagaria o boundary e o upload
  // chegaria ilegível no multer.
  const request = useCallback(
    async (path, options = {}) => {
      const headers = new Headers(options.headers || {});
      const isForm = options.body instanceof FormData;
      if (options.body !== undefined && !isForm && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }
      if (token) headers.set("Authorization", `Bearer ${token}`);
      let response;
      try {
        response = await fetch(`${API}${path}`, { ...options, headers });
      } catch {
        throw new Error("Não foi possível conectar ao servidor.");
      }
      const payload = await response.json().catch(() => ({}));
      if (response.status === 401) {
        unauthorizedRef.current?.();
        throw new Error("Sessão de plataforma expirada. Entre novamente.");
      }
      // A mensagem do backend é sempre preferida: é ela que explica o motivo real
      // (endereço javascript: recusado, arquivo grande demais, tipo inválido).
      if (!response.ok) throw new Error(payload?.error || "Não foi possível concluir a operação.");
      return payload;
    },
    [token],
  );

  useEffect(() => {
    let active = true;
    request("/platform/landing")
      .then((payload) => {
        if (active) setSections(asArray(payload?.sections));
      })
      .catch((error) => {
        if (active) setLoadError(error.message);
      });
    return () => {
      active = false;
    };
  }, [request]);

  const sectionList = asArray(sections);

  const dirtyKeys = useMemo(
    () => sectionList.filter((row) => drafts[row.section_key] && hasChanges(drafts[row.section_key], row.content)).map((row) => row.section_key),
    [sectionList, drafts],
  );

  // Fechar a aba com edição pendente perde trabalho sem aviso nenhum: o
  // navegador só pergunta se houver um handler registrado.
  useEffect(() => {
    if (!dirtyKeys.length) return undefined;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirtyKeys.length]);

  const activeSection = sectionList.find((row) => row.section_key === activeKey) || null;
  const activeContent = activeSection ? (drafts[activeKey] ?? asObject(activeSection.content)) : null;
  const activeDirty = dirtyKeys.includes(activeKey);

  function editContent(key, nextContent) {
    setDrafts((current) => ({ ...current, [key]: nextContent }));
  }

  function dropDraft(key) {
    setDrafts((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function replaceSection(updated) {
    setSections((current) => asArray(current).map((row) => (row.section_key === updated.section_key ? { ...row, ...updated } : row)));
  }

  async function saveSection(key) {
    setSavingKey(key);
    setFeedback({ error: "", success: "" });
    try {
      const updated = await request(`/platform/landing/sections/${key}`, {
        method: "PUT",
        body: JSON.stringify({ content: cloneContent(drafts[key]) }),
      });
      replaceSection(updated);
      dropDraft(key);
      setFeedback({ error: "", success: `Bloco "${sectionName(key)}" salvo. A página pública já mostra o novo conteúdo.` });
    } catch (error) {
      setFeedback({ error: error.message, success: "" });
    } finally {
      setSavingKey("");
    }
  }

  async function toggleEnabled(section, enabled) {
    setFeedback({ error: "", success: "" });
    try {
      // Só `enabled` no corpo: o backend preserva o campo omitido, então ligar um
      // bloco não atropela o rascunho nem o conteúdo salvo.
      const updated = await request(`/platform/landing/sections/${section.section_key}`, {
        method: "PUT",
        body: JSON.stringify({ enabled }),
      });
      replaceSection(updated);
    } catch (error) {
      setFeedback({ error: error.message, success: "" });
    }
  }

  // A lista INTEIRA vai no PATCH, na ordem final — é o contrato do endpoint e
  // evita que duas reordenações rápidas cheguem fora de ordem no servidor.
  async function applyOrder(nextList) {
    const previous = sectionList;
    setSections(nextList);
    setFeedback({ error: "", success: "" });
    try {
      const payload = await request("/platform/landing/order", {
        method: "PATCH",
        body: JSON.stringify({ keys: nextList.map((row) => row.section_key) }),
      });
      setSections(asArray(payload?.sections));
      setFeedback({ error: "", success: "Ordem dos blocos atualizada." });
    } catch (error) {
      // Reverte: a lista na tela precisa refletir o que está no banco, senão o
      // super-admin acha que reordenou e a página pública mostra outra coisa.
      setSections(previous);
      setFeedback({ error: error.message, success: "" });
    }
  }

  function moveSection(index, direction) {
    const nextList = moveInList(sectionList, index, direction);
    if (nextList === sectionList) return;
    applyOrder(nextList);
  }

  // Arrastar é COMPLEMENTO das setas ↑/↓, nunca o único caminho: arrastar não
  // funciona por teclado e é impreciso no toque.
  function dropOn(targetKey) {
    const from = sectionList.findIndex((row) => row.section_key === dragKey);
    const to = sectionList.findIndex((row) => row.section_key === targetKey);
    setDragKey("");
    if (from < 0 || to < 0 || from === to) return;
    applyOrder(moveInList(sectionList, from, to - from));
  }

  const upload = useCallback(
    async (file) => {
      const body = new FormData();
      body.append("file", file);
      const payload = await request("/platform/landing/uploads", { method: "POST", body });
      return payload?.url || "";
    },
    [request],
  );

  if (sections === null && !loadError) return <Loading />;
  if (loadError) return <ApiError message={loadError} />;

  return (
    <div className="le-root">
      <div className="panel le-intro">
        <div>
          <h2>Landing pública</h2>
          <p>
            Cada bloco abaixo é uma faixa da página inicial. Ligue, desligue, reordene e edite os textos e as imagens. As
            alterações valem para todos os visitantes assim que você salvar.
          </p>
        </div>
        <a className="secondary-button le-view-link" href="/" target="_blank" rel="noreferrer">
          <ExternalLink size={16} /> Ver a página
        </a>
      </div>

      {dirtyKeys.length > 0 && (
        <p className="le-unsaved-banner" role="status">
          Você tem alterações não salvas em: {dirtyKeys.map(sectionName).join(", ")}. Elas ficam guardadas enquanto você
          navega entre os blocos, mas só vão para a página depois de salvar.
        </p>
      )}

      {feedback.error && <span className="form-error">{feedback.error}</span>}
      {feedback.success && <span className="form-success">{feedback.success}</span>}

      <div className="le-columns">
        <section className="panel le-list-panel">
          <div className="panel-heading">
            <h2>Blocos da página</h2>
            <span>A ordem aqui é a ordem na página pública.</span>
          </div>

          <ul className="le-list">
            {sectionList.map((section, index) => {
              const key = section.section_key;
              const info = SECTION_INFO[key] || {};
              return (
                <li
                  key={key}
                  className={`le-item${activeKey === key ? " is-active" : ""}${section.enabled ? "" : " is-off"}`}
                  draggable
                  onDragStart={() => setDragKey(key)}
                  onDragEnd={() => setDragKey("")}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => dropOn(key)}
                >
                  <div className="le-item-head">
                    <span className="le-item-position" aria-hidden="true">
                      {index + 1}
                    </span>
                    <div className="le-item-title">
                      <strong>{info.name || key}</strong>
                      <span>{info.hint}</span>
                    </div>
                    <div className="le-item-badges">
                      <StatusBadge tone={section.enabled ? "ok" : "neutral"}>
                        {section.enabled ? "Ligado" : "Desligado"}
                      </StatusBadge>
                      {dirtyKeys.includes(key) && <StatusBadge tone="warn">Não salvo</StatusBadge>}
                    </div>
                  </div>

                  <div className="le-item-actions">
                    <div className="le-move">
                      <button
                        type="button"
                        className="icon-button"
                        disabled={index === 0}
                        aria-label={`Mover "${sectionName(key)}" para cima`}
                        onClick={() => moveSection(index, -1)}
                      >
                        <ArrowUp size={16} />
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        disabled={index === sectionList.length - 1}
                        aria-label={`Mover "${sectionName(key)}" para baixo`}
                        onClick={() => moveSection(index, 1)}
                      >
                        <ArrowDown size={16} />
                      </button>
                    </div>
                    <Checkbox
                      label="Mostrar na página"
                      checked={Boolean(section.enabled)}
                      onChange={(value) => toggleEnabled(section, value)}
                    />
                    <Button variant={activeKey === key ? "primary" : "secondary"} onClick={() => setActiveKey(key)}>
                      Editar
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="panel le-editor-panel">
          {!activeSection ? (
            <p className="le-placeholder">Escolha um bloco na lista para editar os textos e as imagens dele.</p>
          ) : (
            <>
              <div className="panel-heading">
                <div>
                  <h2>{sectionName(activeKey)}</h2>
                  <span>{SECTION_INFO[activeKey]?.hint}</span>
                </div>
                <div className="le-editor-actions">
                  <Button variant="secondary" disabled={!activeDirty} onClick={() => setDiscarding(activeKey)}>
                    Descartar
                  </Button>
                  <Button disabled={!activeDirty || savingKey === activeKey} onClick={() => saveSection(activeKey)}>
                    {savingKey === activeKey ? "Salvando…" : "Salvar bloco"}
                  </Button>
                </div>
              </div>

              {activeDirty && (
                <p className="le-unsaved-inline" role="status">
                  Alterações não salvas neste bloco.
                </p>
              )}

              <SectionFields
                sectionKey={activeKey}
                content={asObject(activeContent)}
                onChange={(next) => editContent(activeKey, next)}
                upload={upload}
              />
            </>
          )}
        </section>
      </div>

      <Modal
        open={Boolean(discarding)}
        title="Descartar alterações"
        size="sm"
        onClose={() => setDiscarding("")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDiscarding("")}>
              Continuar editando
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                dropDraft(discarding);
                setDiscarding("");
              }}
            >
              Descartar
            </Button>
          </>
        }
      >
        <p>
          As alterações não salvas do bloco "{sectionName(discarding)}" serão perdidas e o conteúdo volta ao que está
          publicado.
        </p>
      </Modal>
    </div>
  );
}

// --- Campos reutilizados pelos formulários -----------------------------------

function FieldHint({ children }) {
  return <p className="le-hint">{children}</p>;
}

// Imagem + alt no MESMO bloco, sempre juntos: alt escondido num "avançado" é
// alt que ninguém preenche, e esta é a página pública do produto.
function ImageField({ label, value, alt, onChange, onAltChange, upload }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function pick(event) {
    const file = event.target.files?.[0];
    // Zera o input para permitir reenviar o MESMO arquivo depois de um erro.
    event.target.value = "";
    if (!file) return;
    setError("");
    setUploading(true);
    try {
      const url = await upload(file);
      if (url) onChange(url);
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      setUploading(false);
    }
  }

  const preview = previewSrc(value);
  return (
    <div className="le-image-field">
      <span className="le-image-label">{label}</span>
      <div className="le-image-body">
        {preview ? (
          <img className="le-image-preview" src={preview} alt={alt || "Pré-visualização da imagem escolhida"} />
        ) : (
          <div className="le-image-empty">
            <ImageIcon size={22} aria-hidden="true" />
            <span>Nenhuma imagem</span>
          </div>
        )}
        <div className="le-image-controls">
          <Input label="Endereço da imagem" value={value || ""} onChange={onChange} />
          <FieldHint>Envie um arquivo (até 6 MB) ou cole aqui o endereço de uma imagem já publicada.</FieldHint>
          <div className="le-image-buttons">
            <label className="secondary-button le-file-button">
              {uploading ? "Enviando…" : "Enviar arquivo"}
              <input type="file" accept="image/*" disabled={uploading} onChange={pick} />
            </label>
            {value && (
              <Button variant="ghost" onClick={() => onChange("")}>
                Remover imagem
              </Button>
            )}
          </div>
          {error && <span className="form-error">{error}</span>}
        </div>
      </div>
      <Input label="Texto alternativo (alt)" value={alt || ""} onChange={onAltChange} />
      <FieldHint>{ALT_HINT}</FieldHint>
    </div>
  );
}

// Barra de cada item de lista: reordenar e (quando permitido) remover.
function ItemToolbar({ title, index, total, onMove, onRemove }) {
  return (
    <div className="le-item-toolbar">
      <strong>{title}</strong>
      <div className="le-move">
        <button
          type="button"
          className="icon-button"
          disabled={index === 0}
          aria-label={`Mover ${title} para cima`}
          onClick={() => onMove(-1)}
        >
          <ArrowUp size={16} />
        </button>
        <button
          type="button"
          className="icon-button"
          disabled={index === total - 1}
          aria-label={`Mover ${title} para baixo`}
          onClick={() => onMove(1)}
        >
          <ArrowDown size={16} />
        </button>
        {onRemove && (
          <button type="button" className="icon-button le-remove" aria-label={`Remover ${title}`} onClick={onRemove}>
            <Trash2 size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

// --- Formulário de cada tipo de bloco ----------------------------------------

function SectionFields({ sectionKey, content, onChange, upload }) {
  // `content` é sempre copiado por inteiro: campos que este formulário não
  // conhece (adicionados por uma versão futura) continuam no JSON salvo.
  const set = (patch) => onChange({ ...content, ...patch });
  const items = asArray(content.items);
  const setItems = (next) => set({ items: next });
  const patchItem = (index, patch) => setItems(items.map((item, position) => (position === index ? { ...item, ...patch } : item)));

  if (sectionKey === "hero") {
    return (
      <div className="stack le-form">
        <div className="form-grid">
          <Input label="Etiqueta acima do título" value={content.kicker || ""} onChange={(value) => set({ kicker: value })} />
          <Input label="Título" value={content.title || ""} onChange={(value) => set({ title: value })} />
        </div>
        <Textarea label="Subtítulo" value={content.subtitle || ""} onChange={(value) => set({ subtitle: value })} />
        <div className="form-grid">
          <Input label="Rótulo do botão principal" value={content.primary_label || ""} onChange={(value) => set({ primary_label: value })} />
          <Input label="Endereço do botão principal" value={content.primary_href || ""} onChange={(value) => set({ primary_href: value })} />
          <Input label="Rótulo do botão secundário" value={content.secondary_label || ""} onChange={(value) => set({ secondary_label: value })} />
          <Input label="Endereço do botão secundário" value={content.secondary_href || ""} onChange={(value) => set({ secondary_href: value })} />
        </div>
        <FieldHint>{HREF_HINT}</FieldHint>
        <div className="form-grid">
          <Input label="Nota abaixo dos botões" value={content.note || ""} onChange={(value) => set({ note: value })} />
          <Input label="Legenda da imagem" value={content.caption || ""} onChange={(value) => set({ caption: value })} />
        </div>
        <ImageField
          label="Imagem de abertura"
          value={content.image}
          alt={content.image_alt}
          onChange={(value) => set({ image: value })}
          onAltChange={(value) => set({ image_alt: value })}
          upload={upload}
        />
      </div>
    );
  }

  if (sectionKey === "features") {
    return (
      <div className="stack le-form">
        <div className="form-grid">
          <Input label="Título do bloco" value={content.title || ""} onChange={(value) => set({ title: value })} />
          <Input label="Subtítulo do bloco" value={content.subtitle || ""} onChange={(value) => set({ subtitle: value })} />
        </div>
        <FieldHint>A página foi desenhada para quatro cards. Menos que isso deixa a faixa desequilibrada.</FieldHint>
        <div className="le-cards">
          {items.map((item, index) => (
            <article
              className="le-card"
              // biome-ignore lint/suspicious/noArrayIndexKey: os cards não têm id; a chave pela posição é o que mantém o foco no campo enquanto se digita.
              key={index}
            >
              <ItemToolbar
                title={`Card ${index + 1}`}
                index={index}
                total={items.length}
                onMove={(direction) => setItems(moveInList(items, index, direction))}
              />
              <div className="form-grid">
                <Input label="Título do card" value={item.title || ""} onChange={(value) => patchItem(index, { title: value })} />
                <Input label="Texto do card" value={item.text || ""} onChange={(value) => patchItem(index, { text: value })} />
              </div>
              <ImageField
                label="Imagem do card"
                value={item.image}
                alt={item.image_alt}
                onChange={(value) => patchItem(index, { image: value })}
                onAltChange={(value) => patchItem(index, { image_alt: value })}
                upload={upload}
              />
            </article>
          ))}
        </div>
        {items.length < 4 && (
          <Button variant="secondary" onClick={() => setItems([...items, { title: "", text: "", image: "", image_alt: "" }])}>
            <Plus size={16} /> Adicionar card
          </Button>
        )}
      </div>
    );
  }

  if (sectionKey === "carousel") {
    return (
      <div className="stack le-form">
        <div className="form-grid">
          <Input label="Título do bloco" value={content.title || ""} onChange={(value) => set({ title: value })} />
          <Input label="Subtítulo do bloco" value={content.subtitle || ""} onChange={(value) => set({ subtitle: value })} />
          <Input
            type="number"
            label="Segundos entre as imagens"
            value={content.autoplay_seconds ?? ""}
            onChange={(value) => set({ autoplay_seconds: value === "" ? "" : Number(value) })}
          />
        </div>
        <div className="le-cards">
          {items.map((item, index) => (
            <article
              className="le-card"
              // biome-ignore lint/suspicious/noArrayIndexKey: as imagens não têm id; a chave pela posição é o que mantém o foco no campo enquanto se digita.
              key={index}
            >
              <ItemToolbar
                title={`Imagem ${index + 1}`}
                index={index}
                total={items.length}
                onMove={(direction) => setItems(moveInList(items, index, direction))}
                onRemove={() => setItems(items.filter((_, position) => position !== index))}
              />
              <ImageField
                label="Imagem"
                value={item.image}
                alt={item.image_alt}
                onChange={(value) => patchItem(index, { image: value })}
                onAltChange={(value) => patchItem(index, { image_alt: value })}
                upload={upload}
              />
              <Input label="Legenda (opcional)" value={item.caption || ""} onChange={(value) => patchItem(index, { caption: value })} />
            </article>
          ))}
        </div>
        <Button variant="secondary" onClick={() => setItems([...items, { image: "", image_alt: "", caption: "" }])}>
          <Plus size={16} /> Adicionar imagem
        </Button>
      </div>
    );
  }

  if (sectionKey === "plans") {
    return (
      <div className="stack le-form">
        <div className="form-grid">
          <Input label="Título do bloco" value={content.title || ""} onChange={(value) => set({ title: value })} />
          <Input label="Subtítulo do bloco" value={content.subtitle || ""} onChange={(value) => set({ subtitle: value })} />
          <Input label="Rótulo do botão" value={content.cta_label || ""} onChange={(value) => set({ cta_label: value })} />
          <Input label="Endereço do botão" value={content.cta_href || ""} onChange={(value) => set({ cta_href: value })} />
        </div>
        <FieldHint>{HREF_HINT}</FieldHint>
        <p className="le-notice">
          Os cards de plano (nome, preço e recursos) vêm do cadastro de planos da plataforma, não desta tela. Aqui você
          edita só o título, o subtítulo e o botão da faixa.
        </p>
      </div>
    );
  }

  if (sectionKey === "showcase_links") {
    return (
      <div className="stack le-form">
        <div className="form-grid">
          <Input label="Título do bloco" value={content.title || ""} onChange={(value) => set({ title: value })} />
          <Input label="Subtítulo do bloco" value={content.subtitle || ""} onChange={(value) => set({ subtitle: value })} />
        </div>
        <div className="le-cards">
          {items.map((item, index) => (
            <article
              className="le-card"
              // biome-ignore lint/suspicious/noArrayIndexKey: os links não têm id; a chave pela posição é o que mantém o foco no campo enquanto se digita.
              key={index}
            >
              <ItemToolbar
                title={`Link ${index + 1}`}
                index={index}
                total={items.length}
                onMove={(direction) => setItems(moveInList(items, index, direction))}
              />
              <div className="form-grid">
                <Input label="Título" value={item.title || ""} onChange={(value) => patchItem(index, { title: value })} />
                <Input label="Texto" value={item.text || ""} onChange={(value) => patchItem(index, { text: value })} />
                <Input label="Endereço" value={item.href || ""} onChange={(value) => patchItem(index, { href: value })} />
              </div>
            </article>
          ))}
        </div>
        <FieldHint>{HREF_HINT}</FieldHint>
        {items.length < 2 && (
          <Button variant="secondary" onClick={() => setItems([...items, { title: "", text: "", href: "" }])}>
            <Plus size={16} /> Adicionar link
          </Button>
        )}
      </div>
    );
  }

  if (sectionKey === "closing") {
    const images = asArray(content.images);
    const patchImage = (index, patch) =>
      set({ images: images.map((image, position) => (position === index ? { ...image, ...patch } : image)) });
    return (
      <div className="stack le-form">
        <div className="form-grid">
          <Input label="Título" value={content.title || ""} onChange={(value) => set({ title: value })} />
          <Input label="Rótulo do botão" value={content.primary_label || ""} onChange={(value) => set({ primary_label: value })} />
          <Input label="Endereço do botão" value={content.primary_href || ""} onChange={(value) => set({ primary_href: value })} />
          <Input label="Nota abaixo do botão" value={content.note || ""} onChange={(value) => set({ note: value })} />
        </div>
        <FieldHint>{HREF_HINT}</FieldHint>
        <div className="le-cards">
          {images.map((image, index) => (
            <article
              className="le-card"
              // biome-ignore lint/suspicious/noArrayIndexKey: as imagens não têm id; a chave pela posição é o que mantém o foco no campo enquanto se digita.
              key={index}
            >
              <ItemToolbar
                title={`Imagem ${index + 1}`}
                index={index}
                total={images.length}
                onMove={(direction) => set({ images: moveInList(images, index, direction) })}
              />
              <ImageField
                label="Imagem"
                value={image.image}
                alt={image.image_alt}
                onChange={(value) => patchImage(index, { image: value })}
                onAltChange={(value) => patchImage(index, { image_alt: value })}
                upload={upload}
              />
            </article>
          ))}
        </div>
        {images.length < 2 && (
          <Button variant="secondary" onClick={() => set({ images: [...images, { image: "", image_alt: "" }] })}>
            <Plus size={16} /> Adicionar imagem
          </Button>
        )}
        <div className="form-grid">
          <Input label="Texto do rodapé" value={content.footer_text || ""} onChange={(value) => set({ footer_text: value })} />
          <Input label="Rótulo do link do rodapé" value={content.footer_link_label || ""} onChange={(value) => set({ footer_link_label: value })} />
          <Input label="Endereço do link do rodapé" value={content.footer_link_href || ""} onChange={(value) => set({ footer_link_href: value })} />
        </div>
      </div>
    );
  }

  return <p className="le-placeholder">Este bloco ainda não tem editor nesta tela.</p>;
}
