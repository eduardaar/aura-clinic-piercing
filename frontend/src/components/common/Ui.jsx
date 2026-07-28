import React from "react";
import { ListFilter } from "lucide-react";
import { API_ORIGIN, apiFetch } from "../../lib/api";

/**
 * `<img>` que sabe buscar arquivo protegido: caminho `/api/private-files/…` vai
 * pelo `apiFetch` (com token) e vira object URL; qualquer outro caminho é usado
 * direto. Renderiza `null` enquanto não há URL.
 * @param {{ src?: string, alt?: string } & React.ImgHTMLAttributes<HTMLImageElement>} props
 */
export function SecureImage({ src, alt, ...props }) {
  const [url, setUrl] = React.useState("");
  React.useEffect(() => {
    let active = true;
    let objectUrl = "";
    if (!src) { setUrl(""); return undefined; }
    if (!String(src).startsWith("/api/private-files/")) {
      setUrl(String(src).startsWith("http") ? src : `${API_ORIGIN}${src}`);
      return undefined;
    }
    apiFetch(String(src).replace(/^\/api/, ""))
      .then((response) => response.ok ? response.blob() : Promise.reject())
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (active) setUrl(objectUrl);
      })
      .catch(() => active && setUrl(""));
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);
  return url ? <img src={url} alt={alt} {...props} /> : null;
}

/**
 * @param {{ label: React.ReactNode, value: React.ReactNode }} props
 */
export function Metric({ label, value }) {
  return (
    <article className="metric-card">
      <ListFilter size={20} />
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

// Campo controlado: `onChange` recebe o VALOR já extraído, não o evento.
/**
 * @param {object} props
 * @param {React.ReactNode} props.label
 * @param {string | number} props.value
 * @param {(value: string) => void} props.onChange
 * @param {string} [props.type] Padrão: "text".
 * @param {boolean} [props.required]
 */
export function Input({ label, value, onChange, type = "text", required }) {
  return (
    <label>
      {label}
      <input type={type} value={value} required={required} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

/**
 * @param {object} props
 * @param {React.ReactNode} [props.label]
 * @param {string | number} props.value
 * @param {(value: string) => void} props.onChange
 * @param {React.ReactNode} [props.children] As `<option>`.
 * @param {boolean} [props.required]
 */
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

// ATENÇÃO: esta lista de formas de pagamento é FIXA e precisa continuar
// coerente com os valores aceitos pelo backend (backend/src/services/payments.js).
// Opção que não existe lá é aceita na tela e recusada no salvamento.
/**
 * @param {Omit<React.ComponentProps<typeof Select>, "children">} props
 */
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

// A lista padrão é a do STATUS de AGENDAMENTO. Outras entidades (venda, ordem,
// assinatura) têm status próprios — passe `options` em vez de aceitar o padrão,
// senão a tela oferece um status que aquela entidade não conhece.
/**
 * @param {object} props
 * @param {string} props.value
 * @param {(value: string) => void} props.onChange
 * @param {string[]} [props.options]
 */
export function StatusSelect({ value, onChange, options = ["pendente", "confirmado", "recusado", "atendido", "cancelado", "remarcado"] }) {
  return (
    <Select label="Status" value={value} onChange={onChange}>
      {options.map((status) => <option key={status}>{status}</option>)}
    </Select>
  );
}

/**
 * @template {{ id: string | number }} T
 * @param {object} props
 * @param {React.ReactNode} props.title
 * @param {T[]} props.items
 * @param {string | number} props.value `id` selecionado (comparado como string).
 * @param {(id: T["id"]) => void} props.onSelect
 * @param {(item: T) => React.ReactNode} props.render
 */
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
/**
 * @param {object} props
 * @param {"primary" | "secondary" | "ghost" | "danger"} [props.variant]
 * @param {"button" | "submit" | "reset"} [props.type] Padrão: "button" — nunca deixe
 *   um botão dentro de `<form>` cair no "submit" implícito sem querer.
 * @param {string} [props.className] Classe EXTRA, somada à da variante.
 * @param {React.ReactNode} [props.children]
 */
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
  "baixo estoque": "warn", pendente: "warn", awaiting_deposit_proof: "warn", "aguardando retorno": "warn", aguardando: "warn",
  remarcado: "warn", planejado: "warn", novo: "info",
  esgotado: "danger", "sem estoque": "danger", cancelado: "danger", cancelada: "danger",
  suspenso: "danger", suspensa: "danger", recusado: "danger", critico: "danger", inativo: "danger",
};
/**
 * @param {object} props
 * @param {string} [props.status] Texto do status; também escolhe a cor pelo mapa.
 * @param {"ok" | "warn" | "info" | "danger" | "neutral"} [props.tone] Cor explícita,
 *   quando o texto não está no mapa. Status desconhecido cai em "neutral".
 * @param {React.ReactNode} [props.children] Rótulo alternativo ao `status`.
 * @param {string} [props.className]
 */
export function StatusBadge({ status, tone, children, className = "" }) {
  const label = children ?? (status === "awaiting_deposit_proof" ? "Aguardando sinal" : status) ?? "";
  const key = String(status ?? label).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  const resolved = tone || STATUS_TONE[key] || "neutral";
  return <span className={`status-badge tone-${resolved}${className ? ` ${className}` : ""}`}>{label}</span>;
}

/**
 * @param {object} props
 * @param {React.ReactNode} props.label
 * @param {string} props.value
 * @param {(value: string) => void} props.onChange
 * @param {number} [props.rows]
 * @param {boolean} [props.required]
 * @param {string} [props.placeholder]
 */
export function Textarea({ label, value, onChange, rows = 3, required, placeholder }) {
  return (
    <label>
      {label}
      <textarea value={value} rows={rows} required={required} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

/**
 * @param {object} props
 * @param {React.ReactNode} props.label
 * @param {boolean} props.checked
 * @param {(checked: boolean) => void} props.onChange Recebe o BOOLEANO, não o evento.
 */
export function Checkbox({ label, checked, onChange }) {
  return (
    <label className="checkbox-field">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

/**
 * Bloco de alertas com estado vazio embutido: filhos falsy são descartados, e
 * se não sobrar nenhum exibe `empty`.
 * @param {object} props
 * @param {React.ElementType} props.icon Componente de ícone (lucide-react).
 * @param {React.ReactNode} props.title
 * @param {React.ReactNode} [props.empty]
 * @param {React.ReactNode} [props.children]
 */
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
