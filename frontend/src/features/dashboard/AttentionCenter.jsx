import { useEffect, useState } from "react";
import { ArrowRight, Cake, Calendar, HeartPulse, LayoutGrid, Package, RefreshCw, X } from "lucide-react";
import { useFetch } from "../../lib/api";
import "./attention-center.css";

export function AttentionCenter({ setPage, onClose = undefined }) {
  const [period, setPeriod] = useState("today");
  const { data, refresh, loading, fetching } = useFetch(`/dashboard/attention?period=${period}`);
  useEffect(() => {
    const update = () => { if (!document.hidden) refresh(); };
    const timer = setInterval(update, 30000);
    window.addEventListener("focus", update);
    return () => { clearInterval(timer); window.removeEventListener("focus", update); };
  }, [refresh]);
  const cards = [
    { key: "appointments", title: "Agendamentos", description: "Pendências de agenda", action: "Ver agendamentos", page: "agenda", Icon: Calendar },
    { key: "sold_out", title: "Joias esgotadas", description: "Produtos sem estoque", action: "Ver estoque", page: "inventory", Icon: Package },
    { key: "birthdays", title: "Aniversários", description: "Clientes aniversariantes", action: "Ver clientes", page: "client-center", Icon: Cake },
    { key: "returns", title: "Retornos", description: "Contatos de acompanhamento", action: "Acompanhar clientes", page: "postcare", Icon: HeartPulse }
  ];
  const updated = data?.updated_at ? new Date(data.updated_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }) : null;
  return (
    <section className="attention-center" aria-labelledby="attention-title" aria-busy={loading}>
      <header className="attention-center__header">
        <div className="attention-center__intro"><span className="attention-center__symbol"><LayoutGrid size={22} /></span><div><h2 id="attention-title">Central de atenção</h2><p>Tudo o que precisa da sua atenção, organizado por categoria.</p></div></div>
        <div className="attention-center__controls">
          <div className="attention-center__period" role="group" aria-label="Período da Central de atenção">
            {[["today", "Hoje"], ["week", "Esta semana"], ["month", "Este mês"]].map(([value, label]) => <button type="button" key={value} aria-pressed={period === value} onClick={() => setPeriod(value)}>{label}</button>)}
          </div>
          <button type="button" className="attention-center__refresh" aria-label="Atualizar Central de atenção" disabled={loading || fetching} onClick={refresh}><RefreshCw size={17} /></button>
          {onClose && <button type="button" className="attention-center__refresh" aria-label="Fechar Central de atenção" onClick={onClose} autoFocus><X size={18} /></button>}
        </div>
      </header>
      {data?.error ? <p role="alert" className="form-error">{data.error}</p> : <div className="attention-center__grid">
        {cards.filter((card) => !data || data[card.key] !== null).map(({ key, title, description, action, page, Icon }) => <article className={`attention-center__card attention-center__card--${key}`} key={key}>
          <h3><Icon size={18} aria-hidden="true" />{title}</h3>
          <strong>{data?.[key] == null ? "—" : String(data[key]).padStart(2, "0")}</strong><p>{description}</p>
          <button type="button" onClick={() => setPage(page)}>{action}<ArrowRight size={15} aria-hidden="true" /></button>
        </article>)}
      </div>}
      <footer><span>Pendências, aniversários e retornos do período. Estoque atual.</span><span role="status">{updated ? `Atualizado às ${updated}` : data?.error ? "Atualização indisponível" : "Carregando indicadores…"}</span></footer>
    </section>
  );
}
