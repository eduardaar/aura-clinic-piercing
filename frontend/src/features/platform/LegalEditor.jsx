import { useEffect, useState } from "react";
import { Button, Input, Textarea } from "../../components/common/Ui";
import { API } from "../../lib/api";

const ORDER = ["terms_of_use", "privacy_policy"];

export function LegalEditor({ token, onUnauthorized }) {
  const [documents, setDocuments] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    fetch(`${API}/platform/legal-documents`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => {
        if (response.status === 401) { onUnauthorized(); throw new Error("Sessão expirada."); }
        if (!response.ok) throw new Error("Não foi possível carregar os documentos.");
        return response.json();
      })
      .then((payload) => {
        const list = (payload.documents || []).sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
        setDocuments(list);
        setDrafts(Object.fromEntries(list.map((document) => [document.key, { title: document.title, content: document.content }])));
      })
      .catch((error) => setFeedback(error.message))
      .finally(() => setLoading(false));
  }, [token, onUnauthorized]);

  async function save(key) {
    const draft = drafts[key];
    setSaving(key); setFeedback("");
    try {
      const response = await fetch(`${API}/platform/legal-documents/${key}`, {
        method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(draft)
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 401) { onUnauthorized(); return; }
      if (!response.ok) throw new Error(payload.error || "Não foi possível salvar.");
      setDocuments((current) => current.map((document) => document.key === key ? payload.document : document));
      setDrafts((current) => ({ ...current, [key]: { title: payload.document.title, content: payload.document.content } }));
      setFeedback(`${payload.document.title} publicada na versão ${payload.document.version}.`);
    } catch (error) { setFeedback(error.message); } finally { setSaving(""); }
  }

  return <section className="stack">
    <div className="panel-heading"><div><h2>Termos e privacidade</h2><p>Textos públicos e aceites obrigatórios no cadastro. Ao salvar, uma nova versão passa a valer imediatamente.</p></div></div>
    {feedback && <p className="platform-notice">{feedback}</p>}
    {loading ? <p className="muted">Carregando documentos…</p> : documents.map((document) => {
      const draft = drafts[document.key] || {};
      return <section key={document.key} className="panel stack">
        <div className="panel-heading"><div><h3>{document.key === "terms_of_use" ? "Termos de Uso" : "Política de Privacidade"}</h3><p>Versão atual {document.version}. Use parágrafos separados por uma linha em branco.</p></div></div>
        <Input label="Título público" value={draft.title || ""} onChange={(value) => setDrafts((current) => ({ ...current, [document.key]: { ...draft, title: value } }))} />
        <Textarea label="Conteúdo" rows={14} value={draft.content || ""} onChange={(value) => setDrafts((current) => ({ ...current, [document.key]: { ...draft, content: value } }))} />
        <div><Button onClick={() => save(document.key)} disabled={saving === document.key}>{saving === document.key ? "Publicando…" : "Publicar nova versão"}</Button></div>
      </section>;
    })}
  </section>;
}
