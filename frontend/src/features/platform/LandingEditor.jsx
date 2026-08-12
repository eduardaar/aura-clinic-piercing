// Editor da landing pública (a página em "/"), dentro do painel da plataforma.
//
// O super-admin edita texto, imagem, ordem e ligado/desligado de cada bloco. O
// LAYOUT continua sendo código React em pages/Landing.jsx — aqui só se edita o
// conteúdo, e é isso que impede o painel de quebrar a página de vendas.
//
// A tela usa o mesmo desenho das outras do painel: a lista de blocos é um
// <DataView>, o formulário de um bloco é um <Modal> e cada item de lista dentro
// do formulário é `.panel` + `.panel-heading`. O que sobrou de CSS próprio está
// explicado no cabeçalho de styles/landing-editor.css.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ExternalLink, ImageIcon, Plus, Trash2 } from "lucide-react";
import { Button, Input, StatusBadge, Textarea } from "../../components/common/Ui";
import { Modal, RowActions } from "../../components/common/Crud";
import { DataView } from "../../components/common/DataView";
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
  // Rascunhos por bloco. Fechar o formulário NÃO joga fora o que foi digitado: o
  // rascunho fica aqui, a linha continua marcada como "Não salvo" e o banner do
  // topo lista o bloco pendente. Só o salvamento ou o descarte confirmado apagam
  // um rascunho — nenhum caminho de saída perde trabalho em silêncio.
  const [drafts, setDrafts] = useState({});
  // Uma edição por vez: o formulário é um <Modal>, como nas outras telas.
  const [editando, setEditando] = useState("");
  const [descartando, setDescartando] = useState("");
  const [feedback, setFeedback] = useState({ error: "", success: "" });
  // Erro do salvamento fica DENTRO do modal: o rodapé da página está atrás do
  // fundo escurecido e a mensagem do backend (endereço `javascript:` recusado,
  // por exemplo) é justamente o que explica por que o botão não funcionou.
  const [erroForm, setErroForm] = useState("");
  // Chave do bloco em operação (salvar, ligar/desligar, reordenar).
  const [ocupado, setOcupado] = useState("");

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

  // `showcase_links` foi aposentado da página pública. A chave antiga pode
  // continuar em bancos já existentes, mas não deve ocupar a lista de edição.
  const sectionList = asArray(sections).filter((section) => section.section_key !== "showcase_links");

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

  // A posição vira campo da linha para o DataView poder ORDENAR por ela: é a
  // ordem da página pública, e é a ordenação inicial da tabela. As setas usam
  // esta posição, e não a linha exibida — reordenar continua certo mesmo que a
  // tabela esteja ordenada por outra coluna.
  const linhas = sectionList.map((section, index) => ({
    ...section,
    posicao: index + 1,
    nome: sectionName(section.section_key),
    dica: SECTION_INFO[section.section_key]?.hint || "",
    naoSalvo: dirtyKeys.includes(section.section_key),
  }));

  const blocoEditado = sectionList.find((row) => row.section_key === editando) || null;
  const conteudoEditado = blocoEditado ? (drafts[editando] ?? asObject(blocoEditado.content)) : null;
  const editandoSujo = dirtyKeys.includes(editando);

  function editarRascunho(key, nextContent) {
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

  async function salvarBloco(key) {
    setOcupado(key);
    setErroForm("");
    setFeedback({ error: "", success: "" });
    try {
      const updated = await request(`/platform/landing/sections/${key}`, {
        method: "PUT",
        body: JSON.stringify({ content: cloneContent(drafts[key]) }),
      });
      replaceSection(updated);
      dropDraft(key);
      setEditando("");
      setFeedback({ error: "", success: `Bloco "${sectionName(key)}" salvo. A página pública já mostra o novo conteúdo.` });
    } catch (error) {
      setErroForm(error.message);
    } finally {
      setOcupado("");
    }
  }

  async function alternarBloco(section) {
    setOcupado(section.section_key);
    setFeedback({ error: "", success: "" });
    try {
      // Só `enabled` no corpo: o backend preserva o campo omitido, então ligar um
      // bloco não atropela o rascunho nem o conteúdo salvo.
      const updated = await request(`/platform/landing/sections/${section.section_key}`, {
        method: "PUT",
        body: JSON.stringify({ enabled: !section.enabled }),
      });
      replaceSection(updated);
    } catch (error) {
      setFeedback({ error: error.message, success: "" });
    } finally {
      setOcupado("");
    }
  }

  // A lista INTEIRA vai no PATCH, na ordem final — é o contrato do endpoint e
  // evita que duas reordenações rápidas cheguem fora de ordem no servidor.
  async function aplicarOrdem(nextList) {
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

  // Reordenar é BOTÃO, e não arrastar: arrastar não funciona por teclado e é
  // impreciso no toque.
  async function moverBloco(row, direction) {
    const nextList = moveInList(sectionList, row.posicao - 1, direction);
    if (nextList === sectionList) return;
    setOcupado(row.section_key);
    try {
      await aplicarOrdem(nextList);
    } finally {
      setOcupado("");
    }
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

  return (
    <div className="stack">
      {dirtyKeys.length > 0 && (
        <p className="platform-notice" role="status">
          Rascunho não salvo em: {dirtyKeys.map(sectionName).join(", ")}. O que você digitou continua guardado nesta
          tela, mas a página pública só muda depois de salvar o bloco.
        </p>
      )}

      {feedback.error && <span className="form-error">{feedback.error}</span>}
      {feedback.success && <span className="form-success">{feedback.success}</span>}

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Blocos da página</h2>
            <span>
              Cada bloco é uma faixa da página inicial, e a ordem aqui é a ordem lá. Ligar, desligar e reordenar valem
              na hora; texto e imagem só depois de salvar o bloco.
            </span>
          </div>
          <a className="secondary-button" href="/" target="_blank" rel="noreferrer">
            <ExternalLink size={16} aria-hidden="true" /> Ver a página
          </a>
        </div>

        <DataView
          rows={linhas}
          rowKey={(row) => row.section_key}
          loading={sections === null && !loadError}
          error={loadError}
          // Os blocos são seis e fixos (o super-admin não cria nem exclui faixa):
          // busca, filtro e paginação só somariam barra de ferramentas sem nada
          // para filtrar. O DataView entra pelo resto — cabeçalho ordenável,
          // ações por linha e os estados de carregando/erro/vazio no lugar certo.
          searchable={false}
          paginated={false}
          defaultSort={{ key: "posicao", dir: "asc" }}
          caption="Blocos da página inicial pública"
          columns={[
            { key: "posicao", label: "Ordem", align: "right", searchable: false, value: (row) => row.posicao },
            {
              key: "nome",
              label: "Bloco",
              value: (row) => row.nome,
              render: (row) => (
                <>
                  <strong>{row.nome}</strong>
                  <span className="field-hint">{row.dica}</span>
                </>
              ),
            },
            {
              key: "status",
              label: "Status",
              value: (row) => (row.enabled ? "Ligado" : "Desligado"),
              render: (row) => (
                <>
                  <StatusBadge tone={row.enabled ? "ok" : "neutral"}>
                    {row.enabled ? "Ligado" : "Desligado"}
                  </StatusBadge>{" "}
                  {row.naoSalvo && <StatusBadge tone="warn">Não salvo</StatusBadge>}
                </>
              ),
            },
          ]}
          actions={(row) => (
            <RowActions
              actions={[
                { label: "Editar", onClick: () => setEditando(row.section_key), primary: true },
                { label: row.enabled ? "Desligar" : "Ligar", onClick: () => alternarBloco(row), disabled: ocupado === row.section_key },
                { label: "Mover para cima", onClick: () => moverBloco(row, -1), disabled: row.posicao === 1 || Boolean(ocupado) },
                { label: "Mover para baixo", onClick: () => moverBloco(row, 1), disabled: row.posicao === linhas.length || Boolean(ocupado) },
              ]}
            />
          )}
          empty="Nenhum bloco cadastrado na landing."
        />
      </section>

      {/* Formulário do bloco. Fechar guarda o rascunho (a linha fica com o selo
          "Não salvo" e o banner do topo passa a listar o bloco); jogar o
          rascunho fora exige o "Descartar" e a confirmação logo abaixo. */}
      <Modal
        open={Boolean(editando)}
        size="lg"
        title={sectionName(editando)}
        subtitle={SECTION_INFO[editando]?.hint}
        onClose={() => setEditando("")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditando("")}>
              Fechar
            </Button>
            <Button variant="danger" disabled={!editandoSujo} onClick={() => setDescartando(editando)}>
              Descartar
            </Button>
            <Button disabled={!editandoSujo || ocupado === editando} onClick={() => salvarBloco(editando)}>
              {ocupado === editando ? "Salvando…" : "Salvar bloco"}
            </Button>
          </>
        }
      >
        {editando && (
          <>
            {editandoSujo && (
              <p className="platform-notice" role="status">
                Alterações não salvas neste bloco. Fechar guarda o rascunho nesta tela; a página pública só muda depois
                de "Salvar bloco".
              </p>
            )}
            {erroForm && <span className="form-error">{erroForm}</span>}
            <SectionFields
              sectionKey={editando}
              content={asObject(conteudoEditado)}
              onChange={(next) => editarRascunho(editando, next)}
              upload={upload}
            />
          </>
        )}
      </Modal>

      {/* Este diálogo vem DEPOIS do formulário no JSX para ficar por cima dele na
          tela: `.modal-backdrop` usa o mesmo z-index, então quem vem depois vence. */}
      <Modal
        open={Boolean(descartando)}
        title="Descartar alterações"
        size="sm"
        onClose={() => setDescartando("")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDescartando("")}>
              Continuar editando
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                dropDraft(descartando);
                setDescartando("");
              }}
            >
              Descartar
            </Button>
          </>
        }
      >
        <p>
          As alterações não salvas do bloco "{sectionName(descartando)}" serão perdidas e o conteúdo volta ao que está
          publicado.
        </p>
      </Modal>
    </div>
  );
}

// --- Campos reutilizados pelos formulários -----------------------------------

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
    <div className="form-section">
      <h3>{label}</h3>
      <div className="le-image">
        {preview ? (
          <img src={preview} alt={alt || "Pré-visualização da imagem escolhida"} />
        ) : (
          <div className="le-vazio">
            <ImageIcon size={22} aria-hidden="true" />
            <span>Nenhuma imagem</span>
          </div>
        )}
        <div>
          <p className="field-hint">
            Anexe uma imagem de até 6 MB. Ela será publicada no R2 em <code>plataforma/landing/</code> e usada pela
            página inicial.
          </p>
          <div className="header-actions">
            <label className="secondary-button le-arquivo">
              {uploading ? "Enviando…" : value ? "Substituir imagem" : "Anexar imagem"}
              <input type="file" accept="image/*" disabled={uploading} onChange={pick} />
            </label>
            {value && (
              <Button variant="ghost" onClick={() => onChange("")}>
                Remover imagem
              </Button>
            )}
          </div>
          {/* O erro do upload fica junto do botão que falhou, e não no rodapé do
              formulário: é a mensagem do backend que diz o motivo. */}
          {error && <span className="form-error">{error}</span>}
        </div>
      </div>
      <div>
        <Input label="Texto alternativo (alt)" value={alt || ""} onChange={onAltChange} />
        <p className="field-hint">{ALT_HINT}</p>
      </div>
    </div>
  );
}

// Cabeçalho de um item de lista (card, imagem, link): título + reordenar e,
// quando permitido, remover.
function ItemHeading({ title, index, total, onMove, onRemove }) {
  return (
    <div className="panel-heading">
      <h3>{title}</h3>
      <div className="header-actions">
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
          <button type="button" className="icon-button le-remover" aria-label={`Remover ${title}`} onClick={onRemove}>
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
    const screens = asArray(content.screens);
    const patchScreen = (index, patch) => set({ screens: screens.map((screen, position) => (position === index ? { ...screen, ...patch } : screen)) });
    return (
      <div className="stack">
        <div className="form-grid">
          <Input label="Etiqueta acima do título" value={content.kicker || ""} onChange={(value) => set({ kicker: value })} />
          <Input label="Título" value={content.title || ""} onChange={(value) => set({ title: value })} />
        </div>
        <Textarea label="Subtítulo" value={content.subtitle || ""} onChange={(value) => set({ subtitle: value })} />
        <div>
          <div className="form-grid">
            <Input label="Rótulo do botão principal" value={content.primary_label || ""} onChange={(value) => set({ primary_label: value })} />
            <Input label="Endereço do botão principal" value={content.primary_href || ""} onChange={(value) => set({ primary_href: value })} />
            <Input label="Rótulo do botão secundário" value={content.secondary_label || ""} onChange={(value) => set({ secondary_label: value })} />
            <Input label="Endereço do botão secundário" value={content.secondary_href || ""} onChange={(value) => set({ secondary_href: value })} />
          </div>
          <p className="field-hint">{HREF_HINT}</p>
        </div>
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
        <section className="panel stack">
          <div className="panel-heading"><div><h3>Telas do sistema em destaque</h3><p>Envie capturas reais do painel. Elas ocupam a faixa ampla do topo e alternam automaticamente.</p></div></div>
          {screens.map((screen, index) => <ImageField key={`${screen.image || "screen"}-${index}`} label={`Tela ${index + 1}`} value={screen.image} alt={screen.image_alt} onChange={(value) => patchScreen(index, { image: value })} onAltChange={(value) => patchScreen(index, { image_alt: value })} upload={upload} />)}
          {screens.length < 5 && <Button variant="secondary" onClick={() => set({ screens: [...screens, { image: "", image_alt: "" }] })}><Plus size={16} /> Adicionar tela</Button>}
        </section>
      </div>
    );
  }

  if (sectionKey === "features") {
    return (
      <div className="stack">
        <div>
          <div className="form-grid">
            <Input label="Título do bloco" value={content.title || ""} onChange={(value) => set({ title: value })} />
            <Input label="Subtítulo do bloco" value={content.subtitle || ""} onChange={(value) => set({ subtitle: value })} />
          </div>
          <p className="field-hint">A página foi desenhada para quatro cards. Menos que isso deixa a faixa desequilibrada.</p>
        </div>
        {items.map((item, index) => (
          <section
            className="panel"
            // biome-ignore lint/suspicious/noArrayIndexKey: os cards não têm id; a chave pela posição é o que mantém o foco no campo enquanto se digita.
            key={index}
          >
            <ItemHeading
              title={`Card ${index + 1}`}
              index={index}
              total={items.length}
              onMove={(direction) => setItems(moveInList(items, index, direction))}
            />
            <div className="stack">
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
            </div>
          </section>
        ))}
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
      <div className="stack">
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
        {items.map((item, index) => (
          <section
            className="panel"
            // biome-ignore lint/suspicious/noArrayIndexKey: as imagens não têm id; a chave pela posição é o que mantém o foco no campo enquanto se digita.
            key={index}
          >
            <ItemHeading
              title={`Imagem ${index + 1}`}
              index={index}
              total={items.length}
              onMove={(direction) => setItems(moveInList(items, index, direction))}
              onRemove={() => setItems(items.filter((_, position) => position !== index))}
            />
            <div className="stack">
              <ImageField
                label="Imagem"
                value={item.image}
                alt={item.image_alt}
                onChange={(value) => patchItem(index, { image: value })}
                onAltChange={(value) => patchItem(index, { image_alt: value })}
                upload={upload}
              />
              <Input label="Legenda (opcional)" value={item.caption || ""} onChange={(value) => patchItem(index, { caption: value })} />
            </div>
          </section>
        ))}
        <Button variant="secondary" onClick={() => setItems([...items, { image: "", image_alt: "", caption: "" }])}>
          <Plus size={16} /> Adicionar imagem
        </Button>
      </div>
    );
  }

  if (sectionKey === "plans") {
    return (
      <div className="stack">
        <div>
          <div className="form-grid">
            <Input label="Título do bloco" value={content.title || ""} onChange={(value) => set({ title: value })} />
            <Input label="Subtítulo do bloco" value={content.subtitle || ""} onChange={(value) => set({ subtitle: value })} />
            <Input label="Rótulo do botão" value={content.cta_label || ""} onChange={(value) => set({ cta_label: value })} />
            <Input label="Endereço do botão" value={content.cta_href || ""} onChange={(value) => set({ cta_href: value })} />
          </div>
          <p className="field-hint">{HREF_HINT}</p>
        </div>
        <p className="platform-notice">
          Os cards de plano (nome, preço e recursos) vêm do cadastro de planos da plataforma, não desta tela. Aqui você
          edita só o título, o subtítulo e o botão da faixa.
        </p>
      </div>
    );
  }

  if (sectionKey === "showcase_links") {
    return (
      <div className="stack">
        <div className="form-grid">
          <Input label="Título do bloco" value={content.title || ""} onChange={(value) => set({ title: value })} />
          <Input label="Subtítulo do bloco" value={content.subtitle || ""} onChange={(value) => set({ subtitle: value })} />
        </div>
        {items.map((item, index) => (
          <section
            className="panel"
            // biome-ignore lint/suspicious/noArrayIndexKey: os links não têm id; a chave pela posição é o que mantém o foco no campo enquanto se digita.
            key={index}
          >
            <ItemHeading
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
          </section>
        ))}
        <p className="field-hint">{HREF_HINT}</p>
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
      <div className="stack">
        <div>
          <div className="form-grid">
            <Input label="Título" value={content.title || ""} onChange={(value) => set({ title: value })} />
            <Input label="Rótulo do botão" value={content.primary_label || ""} onChange={(value) => set({ primary_label: value })} />
            <Input label="Endereço do botão" value={content.primary_href || ""} onChange={(value) => set({ primary_href: value })} />
            <Input label="Nota abaixo do botão" value={content.note || ""} onChange={(value) => set({ note: value })} />
          </div>
          <p className="field-hint">{HREF_HINT}</p>
        </div>
        {images.map((image, index) => (
          <section
            className="panel"
            // biome-ignore lint/suspicious/noArrayIndexKey: as imagens não têm id; a chave pela posição é o que mantém o foco no campo enquanto se digita.
            key={index}
          >
            <ItemHeading
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
          </section>
        ))}
        {images.length < 2 && (
          <Button variant="secondary" onClick={() => set({ images: [...images, { image: "", image_alt: "" }] })}>
            <Plus size={16} /> Adicionar imagem
          </Button>
        )}
        <div className="form-grid">
          <Input label="Texto do rodapé" value={content.footer_text || ""} onChange={(value) => set({ footer_text: value })} />
          <Input label="Rótulo do link do rodapé" value={content.footer_link_label || ""} onChange={(value) => set({ footer_link_label: value })} />
          <Input label="Endereço do link do rodapé" value={content.footer_link_href || ""} onChange={(value) => set({ footer_link_href: value })} />
          <Input label="WhatsApp público" value={content.contact_whatsapp || ""} onChange={(value) => set({ contact_whatsapp: value })} placeholder="Ex.: +55 77 9863-2417" />
          <Input type="email" label="E-mail público" value={content.contact_email || ""} onChange={(value) => set({ contact_email: value })} placeholder="contato@suaempresa.com" />
          <Input label="Instagram público" value={content.contact_instagram || ""} onChange={(value) => set({ contact_instagram: value })} placeholder="https://instagram.com/seuperfil" />
        </div>
        <p className="field-hint">Estes são os canais exibidos no rodapé da Landing. Eles são independentes dos dados de cada clínica.</p>
      </div>
    );
  }

  return <p className="empty-state">Este bloco ainda não tem editor nesta tela.</p>;
}
