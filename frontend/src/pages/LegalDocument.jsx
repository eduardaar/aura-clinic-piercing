import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { API } from "../lib/api";
import { PublicTopNav } from "../components/layout/PublicTopNav";
import { PublicFooter } from "../components/layout/PublicFooter";
import { ArticleContent } from "../components/common/ArticleContent";
import "../styles/legal.css";

const FALLBACK = {
  terms_of_use: { title: "Termos de Uso", content: "Os Termos de Uso estão sendo carregados. Tente novamente em instantes." },
  privacy_policy: { title: "Política de Privacidade", content: "A Política de Privacidade está sendo carregada. Tente novamente em instantes." }
};

export function LegalDocument({ documentKey }) {
  const [document, setDocument] = useState(FALLBACK[documentKey]);
  useEffect(() => {
    let active = true;
    fetch(`${API}/legal-documents`)
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((payload) => {
        const next = (payload.documents || []).find((item) => item.key === documentKey);
        if (active && next) setDocument(next);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [documentKey]);

  return <div className="au-shell">
    <PublicTopNav />
    <main className="legal-page">
      <a className="legal-back" href="/"><ArrowLeft size={17} aria-hidden="true" /> Voltar para a página inicial</a>
      <article className="legal-document">
        <span className="legal-kicker">Aura · documento legal</span>
        <h1>{document.title}</h1>
        {document.version && <p className="legal-version">Versão {document.version} · atualizada em {new Date(document.updated_at).toLocaleDateString("pt-BR")}</p>}
        <ArticleContent content={document.content} className="legal-content" />
      </article>
    </main>
    <PublicFooter />
  </div>;
}
