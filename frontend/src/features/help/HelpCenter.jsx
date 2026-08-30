import { useEffect, useMemo, useState } from "react";
import { BookOpen, Newspaper, Search } from "lucide-react";
import { ArticleContent } from "../../components/common/ArticleContent";
import { Loading } from "../../components/common/Feedback";
import { apiFetch } from "../../lib/api";
import { asArray } from "../../lib/utils";
import "../../styles/content-hub.css";

function useHelpArticles(path) {
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    apiFetch(path)
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "Não foi possível carregar o conteúdo.");
        if (active) setArticles(asArray(payload.articles));
      })
      .catch((requestError) => active && setError(requestError.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [path]);

  return { articles, loading, error };
}

function fold(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function HelpLayout({ eyebrow, title, description, icon: Icon, articles, loading, error, manual = false }) {
  const [search, setSearch] = useState("");
  const [selectedSlug, setSelectedSlug] = useState("");
  const filtered = useMemo(() => {
    const term = fold(search);
    if (!term) return articles;
    return articles.filter((article) =>
      fold(`${article.title} ${article.summary} ${article.category} ${article.content}`).includes(term),
    );
  }, [articles, search]);
  const selected =
    filtered.find((article) => article.slug === selectedSlug) ||
    articles.find((article) => article.slug === selectedSlug) ||
    filtered[0] ||
    null;

  if (loading) return <Loading />;

  return (
    <section className="help-center stack">
      <header className="help-center-header">
        <span className="eyebrow">{eyebrow}</span>
        <div className="help-center-heading">
          <span className="help-center-icon" aria-hidden="true">
            <Icon size={24} />
          </span>
          <div>
            <h1>{title}</h1>
            <p>{description}</p>
          </div>
        </div>
      </header>
      {error && <p className="error-message">{error}</p>}
      <label className="help-search">
        <Search size={18} aria-hidden="true" />
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={manual ? "Buscar uma orientação…" : "Buscar novidade…"}
        />
      </label>
      <div className="help-center-layout">
        <nav className="help-article-nav" aria-label={manual ? "Capítulos do manual" : "Lista de novidades"}>
          {filtered.map((article) => (
            <button
              key={article.id}
              type="button"
              className={selected?.id === article.id ? "is-active" : ""}
              onClick={() => setSelectedSlug(article.slug)}
            >
              <small>{article.category}</small>
              <strong>{article.title}</strong>
              {article.summary && <span>{article.summary}</span>}
            </button>
          ))}
          {!filtered.length && <p className="muted">Nenhum conteúdo corresponde à busca.</p>}
        </nav>
        <article className="help-article panel">
          {selected ? (
            <>
              <span className="eyebrow">{selected.category}</span>
              <h2>{selected.title}</h2>
              {selected.summary && <p className="help-article-summary">{selected.summary}</p>}
              {!manual && selected.published_at && (
                <p className="help-article-date">
                  Publicado em {new Date(selected.published_at).toLocaleDateString("pt-BR")}
                </p>
              )}
              <ArticleContent content={selected.content} />
            </>
          ) : (
            <p className="muted">Nenhum conteúdo publicado.</p>
          )}
        </article>
      </div>
    </section>
  );
}

export function UserManual() {
  const content = useHelpArticles("/manual");
  return (
    <HelpLayout
      {...content}
      manual
      eyebrow="Ajuda"
      title="Manual do usuário"
      description="Orientações objetivas para executar os principais fluxos da clínica."
      icon={BookOpen}
    />
  );
}

export function ProductNews() {
  const content = useHelpArticles("/news");
  return (
    <HelpLayout
      {...content}
      eyebrow="Produto"
      title="Novidades"
      description="Melhorias, recursos e mudanças importantes da plataforma."
      icon={Newspaper}
    />
  );
}
