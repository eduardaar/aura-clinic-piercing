import { useEffect, useMemo, useState } from "react";
import { Building2, MapPin, Search, SlidersHorizontal, X } from "lucide-react";
import { API, API_ORIGIN } from "../lib/api";
import { asArray, removeAccents } from "../lib/utils";
import { PublicTopNav } from "../components/layout/PublicTopNav";
import { Checkbox, Select } from "../components/common/Ui";

function logoUrl(url) {
  if (!url) return "";
  return String(url).startsWith("/uploads") ? `${API_ORIGIN}${url}` : url;
}

// Os dois diretórios são a mesma tela — muda o destino do card, o texto e,
// no agendamento, o recorte da lista (só clínicas com agendamento online).
const MODES = {
  catalog: {
    kicker: "Catálogos de piercing",
    title: "Encontre um estúdio e veja o catálogo",
    subtitle: "Busque por nome ou cidade e abra a vitrine de joias da clínica.",
    cta: "Ver catálogo",
    href: (slug) => `/catalogo?t=${encodeURIComponent(slug)}`,
    empty: "Nenhuma clínica com catálogo publicado"
  },
  booking: {
    kicker: "Agendamento online",
    title: "Encontre um estúdio e agende seu horário",
    subtitle: "Busque por nome ou cidade e marque direto na agenda da clínica.",
    cta: "Agendar horário",
    href: (slug) => `/agendar?t=${encodeURIComponent(slug)}`,
    empty: "Nenhuma clínica com agendamento online"
  }
};

const SORTS = [
  { code: "name", label: "Nome (A–Z)" },
  { code: "recent", label: "Mais recentes" }
];

function clinicLabel(clinic) {
  return clinic.store_short_name || clinic.name || clinic.slug;
}

export function PublicDirectory({ mode = "catalog" }) {
  const config = MODES[mode] || MODES.catalog;

  const [clinics, setClinics] = useState(null);
  const [query, setQuery] = useState("");
  const [state, setState] = useState("");
  const [city, setCity] = useState("");
  const [onlyBooking, setOnlyBooking] = useState(false);
  const [sort, setSort] = useState("name");
  const [filtersOpen, setFiltersOpen] = useState(false);   // só no mobile

  useEffect(() => {
    fetch(`${API}/clinics`)
      .then((response) => response.json())
      .then((payload) => setClinics(asArray(payload.clinics)))
      .catch(() => setClinics([]));
  }, []);

  // No modo agendamento a lista já nasce recortada: quem não tem a feature
  // não deveria nem aparecer como opção.
  const base = useMemo(() => {
    const list = asArray(clinics);
    return mode === "booking" ? list.filter((clinic) => clinic.has_booking) : list;
  }, [clinics, mode]);

  // As opções de filtro saem dos próprios dados — um grupo sem opção nenhuma
  // simplesmente não é renderizado, em vez de virar um select vazio.
  const states = useMemo(
    () => [...new Set(base.map((clinic) => clinic.state).filter(Boolean))].sort(),
    [base]
  );

  const cities = useMemo(() => {
    const scoped = state ? base.filter((clinic) => clinic.state === state) : base;
    return [...new Set(scoped.map((clinic) => clinic.city).filter(Boolean))].sort();
  }, [base, state]);

  const filtered = useMemo(() => {
    const term = removeAccents(query.trim().toLowerCase());
    let list = base.filter((clinic) => {
      if (state && clinic.state !== state) return false;
      if (city && clinic.city !== city) return false;
      if (onlyBooking && !clinic.has_booking) return false;
      if (!term) return true;
      const haystack = removeAccents(
        `${clinic.name || ""} ${clinic.store_short_name || ""} ${clinic.city || ""} ${clinic.state || ""}`.toLowerCase()
      );
      return haystack.includes(term);
    });
    list = [...list].sort((a, b) =>
      sort === "recent"
        ? String(b.created_at || "").localeCompare(String(a.created_at || ""))
        : clinicLabel(a).localeCompare(clinicLabel(b), "pt-BR")
    );
    return list;
  }, [base, query, state, city, onlyBooking, sort]);

  const activeFilters = [query.trim(), state, city, onlyBooking ? "1" : ""].filter(Boolean).length;

  function clearFilters() {
    setQuery("");
    setState("");
    setCity("");
    setOnlyBooking(false);
    setSort("name");
  }

  return (
    <div className="au-shell">
      <PublicTopNav />

      <main className="au-dir">
        <section className="au-dir-head">
          <span className="au-dir-kicker">{config.kicker}</span>
          <h1>{config.title}</h1>
          <p>{config.subtitle}</p>
        </section>

        <div className="au-dir-body">
          {/* Botão que revela os filtros no mobile — no desktop a coluna é fixa. */}
          <button
            type="button"
            className="au-dir-filters-toggle"
            onClick={() => setFiltersOpen((open) => !open)}
            aria-expanded={filtersOpen}
            aria-controls="au-dir-filters"
          >
            <SlidersHorizontal size={17} aria-hidden="true" />
            Filtros{activeFilters ? ` (${activeFilters})` : ""}
          </button>

          <aside
            id="au-dir-filters"
            className={`au-dir-side${filtersOpen ? " is-open" : ""}`}
            aria-label="Filtros"
          >
            <div className="au-dir-filter">
              <label htmlFor="au-dir-q">Buscar</label>
              <div className="au-dir-search">
                <Search size={17} aria-hidden="true" />
                <input
                  id="au-dir-q"
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Clínica ou cidade…"
                />
              </div>
            </div>

            {states.length > 0 && (
              <Select className="au-dir-filter" id="au-dir-uf" label="Estado" value={state} onChange={(value) => { setState(value); setCity(""); }}>
                  <option value="">Todos</option>
                  {states.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
              </Select>
            )}

            {cities.length > 0 && (
              <Select className="au-dir-filter" id="au-dir-city" label="Cidade" value={city} onChange={setCity}>
                  <option value="">Todas</option>
                  {cities.map((name) => <option key={name} value={name}>{name}</option>)}
              </Select>
            )}

            {/* No modo agendamento a lista já está recortada — o filtro seria redundante. */}
            {mode === "catalog" && (
              <div className="au-dir-filter">
                <Checkbox className="au-dir-check" label="Só com agendamento online" checked={onlyBooking} onChange={setOnlyBooking} />
              </div>
            )}

            <Select className="au-dir-filter" id="au-dir-sort" label="Ordenar por" value={sort} onChange={setSort}>
                {SORTS.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}
            </Select>

            {activeFilters > 0 && (
              <button type="button" className="au-dir-clear" onClick={clearFilters}>
                <X size={15} aria-hidden="true" /> Limpar filtros
              </button>
            )}

            <p className="au-dir-count" aria-live="polite">
              {clinics === null
                ? "Carregando…"
                : `${filtered.length} ${filtered.length === 1 ? "clínica" : "clínicas"}`}
            </p>
          </aside>

          <section className="au-dir-results">
            {clinics === null && <p className="au-dir-empty">Carregando clínicas…</p>}

            {clinics !== null && filtered.length === 0 && (
              <p className="au-dir-empty">
                {config.empty}{query.trim() ? ` para "${query.trim()}"` : ""}.
              </p>
            )}

            <div className="au-dir-grid">
              {filtered.map((clinic) => {
                const logo = logoUrl(clinic.logo_url);
                const place = [clinic.city, clinic.state].filter(Boolean).join(" · ");
                return (
                  <a key={clinic.slug} className="au-dir-card" href={config.href(clinic.slug)}>
                    <span className="au-dir-card-logo">
                      {logo
                        ? <img src={logo} alt="" loading="lazy" decoding="async" />
                        : <Building2 size={22} aria-hidden="true" />}
                    </span>
                    <span className="au-dir-card-body">
                      <strong>{clinicLabel(clinic)}</strong>
                      {place && <span className="au-dir-card-place"><MapPin size={13} aria-hidden="true" /> {place}</span>}
                      {mode === "catalog" && clinic.has_booking && (
                        <span className="au-dir-card-tag">Agenda online</span>
                      )}
                    </span>
                    <span className="au-dir-card-cta">{config.cta}</span>
                  </a>
                );
              })}
            </div>
          </section>
        </div>

        <footer className="au-dir-foot">
          <span>Feito com Aura · plataforma para estúdios de piercing.</span>
          <a href="/cadastro">Cadastrar minha clínica</a>
        </footer>
      </main>
    </div>
  );
}

export function CatalogDirectory() {
  return <PublicDirectory mode="catalog" />;
}

export function BookingDirectory() {
  return <PublicDirectory mode="booking" />;
}
