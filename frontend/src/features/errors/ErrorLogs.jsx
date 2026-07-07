import React, { useState } from "react";
import { Bug, CheckCircle2, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { Button, Metric, Select, StatusBadge } from "../../components/common/Ui";
import { ApiError, Loading } from "../../components/common/Feedback";
import { asArray } from "../../lib/utils";
import { apiFetch, useFetch } from "../../lib/api";

function formatWhen(value) {
  if (!value) return "—";
  const date = new Date(String(value).replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("pt-BR");
}

export function ErrorLogs() {
  const [source, setSource] = useState("");
  const [status, setStatus] = useState("open");

  const params = new URLSearchParams();
  if (source) params.set("source", source);
  if (status === "open") params.set("resolved", "false");
  if (status === "resolved") params.set("resolved", "true");
  params.set("limit", "300");

  const { data, refresh } = useFetch(`/error-logs?${params.toString()}`);

  if (!data) return <Loading />;
  if (data.error) return <ApiError message={data.error} />;

  const items = asArray(data.items);

  async function setResolved(id, resolved) {
    await apiFetch(`/error-logs/${id}`, { method: "PATCH", body: JSON.stringify({ resolved }) });
    refresh();
  }
  async function remove(id) {
    await apiFetch(`/error-logs/${id}`, { method: "DELETE" });
    refresh();
  }

  return (
    <section className="error-logs">
      <div className="error-logs-metrics">
        <Metric label="Total registrado" value={data.total ?? items.length} />
        <Metric label="Em aberto" value={data.unresolved ?? "—"} />
        <Metric label="Exibindo" value={items.length} />
      </div>

      <div className="error-logs-toolbar panel">
        <Select label="Origem" value={source} onChange={setSource}>
          <option value="">Todas</option>
          <option value="backend">Backend</option>
          <option value="frontend">Frontend</option>
        </Select>
        <Select label="Situação" value={status} onChange={setStatus}>
          <option value="open">Em aberto</option>
          <option value="resolved">Resolvidos</option>
          <option value="all">Todos</option>
        </Select>
        <Button variant="secondary" onClick={refresh}><RefreshCw size={15} /> Atualizar</Button>
      </div>

      {items.length === 0 ? (
        <div className="panel error-logs-empty">
          <Bug size={28} />
          <h3>Nenhum erro por aqui</h3>
          <p>Quando o backend ou o frontend registrarem um erro, ele aparece nesta lista.</p>
        </div>
      ) : (
        <div className="error-logs-list">
          {items.map((item) => (
            <article className={`panel error-log-card ${item.resolved ? "is-resolved" : ""}`} key={item.id}>
              <header className="error-log-head">
                <div className="error-log-tags">
                  <StatusBadge tone={item.source === "frontend" ? "info" : "warn"}>{item.source}</StatusBadge>
                  {item.status_code ? <StatusBadge tone="neutral">HTTP {item.status_code}</StatusBadge> : null}
                  {item.resolved ? <StatusBadge tone="ok">resolvido</StatusBadge> : <StatusBadge tone="danger">aberto</StatusBadge>}
                </div>
                <time className="error-log-when">{formatWhen(item.created_at)}</time>
              </header>

              <p className="error-log-message">{item.message}</p>

              <dl className="error-log-meta">
                {item.method || item.url ? <div><dt>Rota</dt><dd>{[item.method, item.url].filter(Boolean).join(" ")}</dd></div> : null}
                {item.user_email ? <div><dt>Usuário</dt><dd>{item.user_email}</dd></div> : null}
                {item.user_agent ? <div><dt>Navegador</dt><dd>{item.user_agent}</dd></div> : null}
              </dl>

              {item.stack ? (
                <details className="error-log-details">
                  <summary>Stack trace</summary>
                  <pre>{item.stack}</pre>
                </details>
              ) : null}
              {item.context ? (
                <details className="error-log-details">
                  <summary>Contexto</summary>
                  <pre>{typeof item.context === "string" ? item.context : JSON.stringify(item.context, null, 2)}</pre>
                </details>
              ) : null}

              <footer className="error-log-actions">
                {item.resolved ? (
                  <Button variant="ghost" onClick={() => setResolved(item.id, false)}><RotateCcw size={15} /> Reabrir</Button>
                ) : (
                  <Button variant="secondary" onClick={() => setResolved(item.id, true)}><CheckCircle2 size={15} /> Marcar resolvido</Button>
                )}
                <Button variant="danger" onClick={() => remove(item.id)}><Trash2 size={15} /> Excluir</Button>
              </footer>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
