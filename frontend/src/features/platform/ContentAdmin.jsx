import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Input, Select, Textarea } from "../../components/common/Ui";
import { CrudHeader, Modal, RowActions } from "../../components/common/Crud";
import { DataView } from "../../components/common/DataView";
import { API } from "../../lib/api";
import { asArray } from "../../lib/utils";
import "../../styles/content-hub.css";

const EMPTY_FORM = {
  content_type: "news",
  title: "",
  slug: "",
  summary: "",
  category: "Geral",
  content: "",
  status: "draft",
  sort_order: 0,
};

const TYPE_LABELS = { news: "Notícias", manual: "Manual do usuário" };
const STATUS_LABELS = { draft: "Rascunho", published: "Publicado", archived: "Arquivado" };

export function ContentAdmin({ token, onUnauthorized }) {
  const [articles, setArticles] = useState([]);
  const [activeType, setActiveType] = useState("news");
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");

  const request = useCallback(
    async (path, options = {}) => {
      const response = await fetch(`${API}${path}`, {
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...(options.headers || {}),
        },
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 401) {
        onUnauthorized();
        throw new Error("Sessão expirada.");
      }
      if (!response.ok) throw new Error(payload.error || "Não foi possível concluir a operação.");
      return payload;
    },
    [token, onUnauthorized],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await request("/platform/content");
      setArticles(asArray(payload.articles));
    } catch (error) {
      setFeedback(error.message);
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(
    () => articles.filter((article) => article.content_type === activeType),
    [activeType, articles],
  );

  function openNew() {
    setEditing({ id: null });
    setForm({ ...EMPTY_FORM, content_type: activeType });
    setFeedback("");
  }

  function openEdit(article) {
    setEditing(article);
    setForm({
      content_type: article.content_type,
      title: article.title,
      slug: article.slug,
      summary: article.summary || "",
      category: article.category || "Geral",
      content: article.content,
      status: article.status,
      sort_order: Number(article.sort_order || 0),
    });
    setFeedback("");
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setFeedback("");
    try {
      const path = editing?.id ? `/platform/content/${editing.id}` : "/platform/content";
      await request(path, {
        method: editing?.id ? "PUT" : "POST",
        body: JSON.stringify({ ...form, sort_order: Number(form.sort_order || 0) }),
      });
      setEditing(null);
      setFeedback("Conteúdo salvo com sucesso.");
      await load();
    } catch (error) {
      setFeedback(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function archive(article) {
    try {
      await request(`/platform/content/${article.id}`, { method: "DELETE" });
      setFeedback(`${article.title} foi arquivado.`);
      await load();
    } catch (error) {
      setFeedback(error.message);
    }
  }

  const columns = [
    {
      key: "title",
      label: "Título",
      render: (article) => (
        <div className="content-admin-title">
          <strong>{article.title}</strong>
          <small>/{article.slug}</small>
        </div>
      ),
      value: (article) => `${article.title} ${article.slug} ${article.summary}`,
    },
    { key: "category", label: "Categoria" },
    { key: "status", label: "Status", render: (article) => STATUS_LABELS[article.status] || article.status },
    { key: "version", label: "Versão" },
    {
      key: "updated_at",
      label: "Atualizado",
      render: (article) => new Date(article.updated_at).toLocaleDateString("pt-BR"),
    },
  ];

  return (
    <section className="stack content-admin">
      <CrudHeader
        title="Conteúdo e ajuda"
        subtitle="Publique novidades na landing page e mantenha o manual disponível para toda a equipe."
        actionLabel={activeType === "news" ? "Nova notícia" : "Novo capítulo"}
        onAction={openNew}
      />
      <div className="content-type-switch" aria-label="Tipo de conteúdo">
        {Object.entries(TYPE_LABELS).map(([type, label]) => (
          <button
            key={type}
            type="button"
            className={activeType === type ? "is-active" : ""}
            aria-pressed={activeType === type}
            onClick={() => setActiveType(type)}
          >
            {label}
          </button>
        ))}
      </div>
      {feedback && <p className="platform-notice">{feedback}</p>}
      <DataView
        rows={visible}
        columns={columns}
        loading={loading}
        searchPlaceholder={`Buscar em ${TYPE_LABELS[activeType].toLowerCase()}…`}
        empty={activeType === "news" ? "Nenhuma notícia cadastrada." : "Nenhum capítulo no manual."}
        actions={(article) => (
          <RowActions
            actions={[
              { label: "Editar", onClick: () => openEdit(article) },
              article.status !== "archived" && { label: "Arquivar", danger: true, onClick: () => archive(article) },
            ]}
          />
        )}
      />

      <Modal
        open={Boolean(editing)}
        title={editing?.id ? "Editar conteúdo" : activeType === "news" ? "Nova notícia" : "Novo capítulo do manual"}
        subtitle="Texto simples e seguro; separe parágrafos com uma linha em branco."
        size="lg"
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={saving}>
              Cancelar
            </Button>
            <Button type="submit" form="content-admin-form" disabled={saving}>
              {saving ? "Salvando…" : "Salvar"}
            </Button>
          </>
        }
      >
        <form id="content-admin-form" className="stack" onSubmit={save}>
          <div className="form-grid">
            <Select
              label="Tipo"
              value={form.content_type}
              onChange={(content_type) => setForm({ ...form, content_type })}
            >
              <option value="news">Notícia</option>
              <option value="manual">Manual</option>
            </Select>
            <Select label="Status" value={form.status} onChange={(status) => setForm({ ...form, status })}>
              <option value="draft">Rascunho</option>
              <option value="published">Publicado</option>
              <option value="archived">Arquivado</option>
            </Select>
          </div>
          <Input label="Título" required value={form.title} onChange={(title) => setForm({ ...form, title })} />
          <Input
            label="Endereço amigável"
            value={form.slug}
            onChange={(slug) => setForm({ ...form, slug })}
            placeholder="gerado pelo título se ficar vazio"
          />
          <div className="form-grid">
            <Input label="Categoria" value={form.category} onChange={(category) => setForm({ ...form, category })} />
            <Input
              type="number"
              label="Ordem"
              value={form.sort_order}
              onChange={(sort_order) => setForm({ ...form, sort_order: Number(sort_order || 0) })}
            />
          </div>
          <Textarea
            label="Resumo"
            rows={3}
            value={form.summary}
            onChange={(summary) => setForm({ ...form, summary })}
          />
          <Textarea
            label="Conteúdo"
            required
            rows={16}
            value={form.content}
            onChange={(content) => setForm({ ...form, content })}
          />
        </form>
      </Modal>
    </section>
  );
}
