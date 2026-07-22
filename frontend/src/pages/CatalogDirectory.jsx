import React, { useEffect, useMemo, useState } from "react";
import { Gem, MapPin, Search } from "lucide-react";
import { API, API_ORIGIN } from "../lib/api";
import { asArray, initials, removeAccents } from "../lib/utils";

function logoUrl(url) {
  if (!url) return "";
  return String(url).startsWith("/uploads") ? `${API_ORIGIN}${url}` : url;
}

// Diretório público de clínicas (/catalogo sem ?t): lista as clínicas ativas
// e, ao clicar, abre o catálogo específico daquela clínica (/catalogo?t=slug).
export function CatalogDirectory() {
  const [clinics, setClinics] = useState(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch(`${API}/clinics`)
      .then((response) => response.json())
      .then((payload) => setClinics(asArray(payload.clinics)))
      .catch(() => setClinics([]));
  }, []);

  const filtered = useMemo(() => {
    const term = removeAccents(query.trim().toLowerCase());
    const list = asArray(clinics);
    if (!term) return list;
    return list.filter((clinic) => {
      const haystack = removeAccents(`${clinic.name || ""} ${clinic.store_short_name || ""} ${clinic.city || ""} ${clinic.state || ""}`.toLowerCase());
      return haystack.includes(term);
    });
  }, [clinics, query]);

  return (
    <main className="directory">
      <header className="directory-nav">
        <a className="directory-brand" href="/">
          <span className="directory-monogram">A</span>
          <strong>Aura</strong>
        </a>
        <a className="directory-login" href="/login">Entrar</a>
      </header>

      <section className="directory-hero">
        <span className="directory-kicker"><Gem size={14} /> Catálogos de piercing</span>
        <h1>Encontre um estúdio e veja o catálogo</h1>
        <p>Busque por nome ou cidade e abra o catálogo de joias e agendamento da clínica.</p>
        <div className="directory-search">
          <Search size={18} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por clínica ou cidade…"
            autoFocus
          />
        </div>
      </section>

      <section className="directory-results">
        {clinics === null && <p className="directory-empty">Carregando clínicas…</p>}
        {clinics !== null && filtered.length === 0 && (
          <p className="directory-empty">Nenhuma clínica encontrada{query ? ` para "${query}"` : ""}.</p>
        )}
        <div className="directory-grid">
          {filtered.map((clinic) => {
            const logo = logoUrl(clinic.logo_url);
            const place = [clinic.city, clinic.state].filter(Boolean).join(" · ");
            return (
              <a key={clinic.slug} className="directory-card" href={`/catalogo?t=${encodeURIComponent(clinic.slug)}`}>
                <div className="directory-card-logo">
                  {logo ? <img src={logo} alt={clinic.name} /> : <span>{initials(clinic.name || clinic.slug)}</span>}
                </div>
                <div className="directory-card-body">
                  <strong>{clinic.store_short_name || clinic.name}</strong>
                  {place && <span className="directory-card-place"><MapPin size={13} /> {place}</span>}
                </div>
                <span className="directory-card-cta">Ver catálogo</span>
              </a>
            );
          })}
        </div>
      </section>

      <footer className="directory-footer">
        <span>Feito com Aura · plataforma para estúdios de piercing.</span>
        <a href="/cadastro">Cadastrar minha clínica</a>
      </footer>
    </main>
  );
}
