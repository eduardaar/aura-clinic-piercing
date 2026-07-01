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
