import React from "react";
import { BadgeCheck, Banknote, CircleDollarSign, Clock3, CreditCard, FileChartColumn, ListFilter, Receipt, Tag } from "lucide-react";
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

/** @param {{ summary?: Record<string, any> }} props */
export function FinancialSummary({ summary = {} }) {
  const gross = Number(summary.grossTotal ?? summary.gross_total ?? summary.total_bruto ?? 0);
  const discount = Number(summary.discountTotal ?? summary.discount_value ?? summary.discount ?? 0);
  const net = Number(summary.netTotal ?? summary.net_total ?? summary.total_liquido ?? 0);
  const deposit = Number(summary.depositPaid ?? summary.deposit_value ?? summary.sinal ?? 0);
  const otherPayments = Number(summary.otherPayments ?? summary.other_payments ?? 0);
  const totalPaid = Number(summary.totalPaid ?? summary.total_paid ?? 0);
  const outstanding = Number(summary.outstandingBalance ?? summary.outstanding_balance ?? 0);
  const overpayment = Number(summary.overpaymentAmount ?? summary.overpayment_amount ?? 0);
  const status = String(summary.paymentStatus ?? summary.status ?? "pendente").toLowerCase();
  const couponCode = summary.couponCode ?? summary.coupon_code;
  const couponPercent = Number(summary.couponPercent ?? summary.coupon_percent ?? 0);
  const money = (value) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const statusLabels = { pending: "Pendente", pendente: "Pendente", partial: "Parcial", parcial: "Parcial", paid: "Pago", pago: "Pago", overpaid: "Excedente", excedente: "Excedente", canceled: "Cancelado", cancelado: "Cancelado" };
  const tone = ["paid", "pago"].includes(status) ? "ok" : ["canceled", "cancelado"].includes(status) ? "danger" : ["overpaid", "excedente"].includes(status) ? "warn" : "info";
  const Card = ({ icon: Icon, label, value, variant = "" }) => <article className={`financial-metric ${variant}`}><span><Icon size={20} aria-hidden="true" />{label}</span><strong>{value}</strong></article>;

  return (
    <section className="soft-card financial-summary" aria-label="Resumo financeiro">
      <div className="financial-summary-header"><strong><FileChartColumn size={22} aria-hidden="true" />Resumo financeiro</strong><span className={`status-badge tone-${tone}`}>{statusLabels[status] || status}</span></div>
      <div className="financial-equation">
        <Card icon={Receipt} label="Valor bruto" value={money(gross)} />
        <span className="financial-operator" aria-hidden="true">−</span>
        <Card icon={Tag} label="Descontos" value={`− ${money(discount)}`} variant="discount" />
        <span className="financial-operator" aria-hidden="true">=</span>
        <Card icon={CreditCard} label="Valor líquido" value={money(net)} variant="featured" />
        <span className="financial-operator" aria-hidden="true">+</span>
        <Card icon={Banknote} label="Sinal pago" value={money(deposit)} variant="paid" />
        <span className="financial-operator" aria-hidden="true">→</span>
        <Card icon={CircleDollarSign} label="Total pago" value={money(totalPaid)} variant="paid featured" />
      </div>
      <div className="financial-details">
        <div><Clock3 size={19} /><span>Valor restante</span><strong>{money(outstanding)}</strong></div>
        <div><CreditCard size={19} /><span>Outros pagamentos</span><strong>{money(otherPayments)}</strong></div>
        <div><CircleDollarSign size={19} /><span>{overpayment > 0 ? "Excedente" : "Saldo final"}</span><strong>{money(overpayment > 0 ? overpayment : outstanding)}</strong></div>
        {couponCode && <div><Tag size={19} /><span>Cupom aplicado</span><strong>{couponCode} <BadgeCheck size={17} aria-label="válido" /></strong><small>− {money(discount)}{couponPercent > 0 ? ` (${couponPercent}%)` : ""}</small></div>}
      </div>
      <details className="financial-composition"><summary>Ver composição do valor bruto</summary><div><span>Serviços <strong>{money(summary.serviceSubtotal ?? summary.service_value)}</strong></span><span>Produtos <strong>{money(summary.productSubtotal ?? summary.product_value)}</strong></span></div></details>
      {couponCode && <div className="coupon-success"><BadgeCheck size={24} /><div><strong>Cupom aplicado com sucesso.</strong><span>Desconto de {money(discount)}{couponPercent > 0 ? ` (${couponPercent}%)` : ""} aplicado sobre o valor elegível.</span></div></div>}
    </section>
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
