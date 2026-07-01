import React from "react";
import { ListFilter } from "lucide-react";

export function Metric({ label, value }) {
  return (
    <article className="metric-card">
      <ListFilter size={20} />
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

export function Input({ label, value, onChange, type = "text", required }) {
  return (
    <label>
      {label}
      <input type={type} value={value} required={required} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

export function Select({ label, value, onChange, children, required }) {
  return (
    <label>
      {label}
      <select value={value} required={required} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </label>
  );
}

export function PaymentSelect(props) {
  return (
    <Select {...props}>
      <option>Pix</option>
      <option>dinheiro</option>
      <option>cartão de crédito</option>
      <option>cartão de débito</option>
    </Select>
  );
}

export function StatusSelect({ value, onChange, options = ["pendente", "confirmado", "recusado", "atendido", "cancelado", "remarcado"] }) {
  return (
    <Select label="Status" value={value} onChange={onChange}>
      {options.map((status) => <option key={status}>{status}</option>)}
    </Select>
  );
}

export function BookingChoiceGrid({ title, items, value, onSelect, render }) {
  const safeItems = Array.isArray(items) ? items : [];
  return (
    <section className="booking-panel">
      <h2>{title}</h2>
      <div className="booking-choice-grid">
        {safeItems.map((item) => (
          <button key={item.id} className={String(value) === String(item.id) ? "active" : ""} onClick={() => onSelect(item.id)}>
            {render(item)}
          </button>
        ))}
      </div>
    </section>
  );
}

// Botão padrão do sistema. variant: primary | secondary | ghost | danger.
// Reaproveita as classes já estilizadas para não fragmentar o CSS.
const BUTTON_VARIANT = {
  primary: "primary-button",
  secondary: "secondary-button",
  ghost: "ghost-button",
  danger: "danger-button",
};
export function Button({ variant = "primary", type = "button", className = "", children, ...props }) {
  const base = BUTTON_VARIANT[variant] || BUTTON_VARIANT.primary;
  return (
    <button type={type} className={`${base}${className ? ` ${className}` : ""}`} {...props}>
      {children}
    </button>
  );
}

// Etiqueta de status colorida (Disponível=verde, Aviso=amarelo, Sem estoque=vermelho…).
// Mapeia o texto do status para um tom da paleta; aceita `tone` explícito.
const STATUS_TONE = {
  disponivel: "ok", ativo: "ok", ativa: "ok", pago: "ok", paga: "ok", concluida: "ok",
  concluido: "ok", confirmado: "ok", atendido: "ok", aprovado: "ok",
  "baixo estoque": "warn", pendente: "warn", "aguardando retorno": "warn", aguardando: "warn",
  remarcado: "warn", planejado: "warn", novo: "info",
  esgotado: "danger", "sem estoque": "danger", cancelado: "danger", cancelada: "danger",
  suspenso: "danger", suspensa: "danger", recusado: "danger", critico: "danger", inativo: "danger",
};
export function StatusBadge({ status, tone, children, className = "" }) {
  const label = children ?? status ?? "";
  const key = String(status ?? label).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  const resolved = tone || STATUS_TONE[key] || "neutral";
  return <span className={`status-badge tone-${resolved}${className ? ` ${className}` : ""}`}>{label}</span>;
}

export function Textarea({ label, value, onChange, rows = 3, required, placeholder }) {
  return (
    <label>
      {label}
      <textarea value={value} rows={rows} required={required} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

export function Checkbox({ label, checked, onChange }) {
  return (
    <label className="checkbox-field">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function AlertBlock({ icon: Icon, title, empty, children }) {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <div className="alert-block">
      <h3>
        <Icon size={17} /> {title}
      </h3>
      <div className="alert-list">
        {items.length ? items : <p className="empty-state">{empty}</p>}
      </div>
    </div>
  );
}
