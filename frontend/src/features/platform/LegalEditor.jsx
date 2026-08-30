import { useCallback, useEffect, useState } from "react";
import { Button, Input, Textarea } from "../../components/common/Ui";
import { ArticleContent } from "../../components/common/ArticleContent";
import { API } from "../../lib/api";

const ORDER = ["terms_of_use", "privacy_policy"];

export function LegalEditor({ token, onUnauthorized }) {
  const [documents, setDocuments] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [histories, setHistories] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
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

  useEffect(() => {
    request("/platform/legal-documents")
      .then((payload) => {
        const list = (payload.documents || []).sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
        setDocuments(list);
        setDrafts(
          Object.fromEntries(
            list.map((document) => [document.key, { title: document.title, content: document.content }]),
          ),
        );
      })
      .catch((error) => setFeedback(error.message))
      .finally(() => setLoading(false));
  }, [request]);

  async function loadHistory(key) {
    if (histories[key]) return;
    try {
      const payload = await request(`/platform/legal-documents/${key}/versions`);
      setHistories((current) => ({ ...current, [key]: payload.versions || [] }));
    } catch (error) {
      setFeedback(error.message);
    }
  }

  async function save(key) {
    const draft = drafts[key];
    setSaving(key);
    setFeedback("");
    try {
      const payload = await request(`/platform/legal-documents/${key}`, {
        method: "PUT",
        body: JSON.stringify(draft),
      });
      setDocuments((current) => current.map((document) => (document.key === key ? payload.document : document)));
      setDrafts((current) => ({
        ...current,
        [key]: { title: payload.document.title, content: payload.document.content },
      }));
      setHistories((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      setFeedback(`${payload.document.title} publicada na versão ${payload.document.version}.`);
    } catch (error) {
      setFeedback(error.message);
    } finally {
      setSaving("");
    }
  }

  return (
    <section className="stack">
      <div className="panel-heading">
        <div>
          <h2>Termos e privacidade</h2>
          <p>
            Textos públicos, profissionais e versionados. Cada publicação preserva uma cópia integral para auditoria dos
            aceites anteriores.
          </p>
        </div>
      </div>
      {feedback && <p className="platform-notice">{feedback}</p>}
      {loading ? (
        <p className="muted">Carregando documentos…</p>
      ) : (
        documents.map((document) => {
          const draft = drafts[document.key] || {};
          const history = histories[document.key] || [];
          return (
            <section key={document.key} className="panel stack">
              <div className="panel-heading">
                <div>
                  <h3>{document.key === "terms_of_use" ? "Termos de Uso" : "Política de Privacidade"}</h3>
                  <p>
                    Versão atual {document.version}. Use parágrafos separados por uma linha em branco; títulos numerados
                    recebem destaque na página pública.
                  </p>
                </div>
              </div>
              <Input
                label="Título público"
                value={draft.title || ""}
                onChange={(title) => setDrafts((current) => ({ ...current, [document.key]: { ...draft, title } }))}
              />
              <Textarea
                label="Conteúdo"
                rows={18}
                value={draft.content || ""}
                onChange={(content) => setDrafts((current) => ({ ...current, [document.key]: { ...draft, content } }))}
              />
              <div className="header-actions">
                <Button onClick={() => save(document.key)} disabled={saving === document.key}>
                  {saving === document.key ? "Publicando…" : "Publicar nova versão"}
                </Button>
              </div>
              <details
                className="legal-history"
                onToggle={(event) => event.currentTarget.open && loadHistory(document.key)}
              >
                <summary>Histórico de versões ({document.version_count || document.version})</summary>
                {history.length ? (
                  <div className="stack">
                    {history.map((version) => (
                      <details key={version.version} className="panel legal-history-version">
                        <summary>
                          Versão {version.version} · {new Date(version.published_at).toLocaleDateString("pt-BR")}
                        </summary>
                        <h4>{version.title}</h4>
                        <ArticleContent content={version.content} className="legal-history-content" />
                      </details>
                    ))}
                  </div>
                ) : (
                  <p className="muted">Carregando histórico…</p>
                )}
              </details>
            </section>
          );
        })
      )}
    </section>
  );
}
