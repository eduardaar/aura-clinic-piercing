import { useEffect, useState } from "react";
import { ArrowLeft, CalendarDays } from "lucide-react";
import { ArticleContent } from "../components/common/ArticleContent";
import { PublicFooter } from "../components/layout/PublicFooter";
import { PublicTopNav } from "../components/layout/PublicTopNav";
import { API } from "../lib/api";
import { asArray } from "../lib/utils";
import "../styles/content-hub.css";

function currentSlug() {
  const [, slug = ""] = window.location.pathname.match(/^\/novidades\/?(.*)$/) || [];
  try {
    return decodeURIComponent(slug).replace(/^\/+|\/+$/g, "");
  } catch {
    return "";
  }
}

export function NewsPage() {
  const slug = currentSlug();
  const [articles, setArticles] = useState([]);
  const [article, setArticle] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch(`${API}${slug ? `/news/${encodeURIComponent(slug)}` : "/news"}`)
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "Não foi possível carregar as novidades.");
        if (!active) return;
        if (slug) setArticle(payload.article || null);
        else setArticles(asArray(payload.articles));
      })
      .catch((requestError) => active && setError(requestError.message));
    return () => {
      active = false;
    };
  }, [slug]);

  return (
    <div className="au-shell">
      <PublicTopNav current="news" />
      <main className="public-news-page">
        {slug ? (
          <>
            <a className="legal-back" href="/novidades">
              <ArrowLeft size={17} aria-hidden="true" /> Voltar para novidades
            </a>
            {article && (
              <article className="public-news-article">
                <span className="au-l-kicker">{article.category}</span>
                <h1>{article.title}</h1>
                <p className="public-news-meta">
                  <CalendarDays size={16} aria-hidden="true" />
                  {new Date(article.published_at).toLocaleDateString("pt-BR")}
                </p>
                {article.summary && <p className="public-news-lead">{article.summary}</p>}
                <ArticleContent content={article.content} />
              </article>
            )}
          </>
        ) : (
          <>
            <header className="public-news-header">
              <span className="au-l-kicker">Aura Clinic</span>
              <h1>Notícias e novidades</h1>
              <p>Acompanhe lançamentos, melhorias e orientações para aproveitar melhor a plataforma.</p>
            </header>
            <section className="public-news-grid">
              {articles.map((item) => (
                <article key={item.id} className="public-news-card">
                  <span>{item.category}</span>
                  <h2>{item.title}</h2>
                  <p>{item.summary}</p>
                  <a href={`/novidades/${item.slug}`}>Ler novidade</a>
                </article>
              ))}
            </section>
          </>
        )}
        {error && <p className="error-message">{error}</p>}
      </main>
      <PublicFooter content={null} />
    </div>
  );
}
