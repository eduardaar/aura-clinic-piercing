import React from "react";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import * as SelectPrimitive from "@radix-ui/react-select";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { BadgeCheck, Banknote, Check, ChevronDown, CircleDollarSign, Clock3, CreditCard, FileChartColumn, ListFilter, Receipt, Tag } from "lucide-react";
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
      <Accordion className="financial-composition">
        <Accordion.Item value="composition">
          <Accordion.Header><Accordion.Trigger>Ver composição do valor bruto</Accordion.Trigger></Accordion.Header>
          <Accordion.Content><div className="financial-composition-values"><span>Serviços <strong>{money(summary.serviceSubtotal ?? summary.service_value)}</strong></span><span>Produtos <strong>{money(summary.productSubtotal ?? summary.product_value)}</strong></span></div></Accordion.Content>
        </Accordion.Item>
      </Accordion>
      {couponCode && <div className="coupon-success"><BadgeCheck size={24} /><div><strong>Cupom aplicado com sucesso.</strong><span>Desconto de {money(discount)}{couponPercent > 0 ? ` (${couponPercent}%)` : ""} aplicado sobre o valor elegível.</span></div></div>}
    </section>
  );
}

/**
 * @typedef {Omit<React.ComponentPropsWithoutRef<"input">, "onChange" | "value" | "type"> & {
 *   label?: React.ReactNode,
 *   value?: string | number,
 *   onChange?: (value: string) => void,
 *   type?: React.HTMLInputTypeAttribute,
 *   fieldClassName?: string
 * }} InputProps
 */
// Campo controlado: `onChange` recebe o VALOR já extraído, não o evento.
export const Input = React.forwardRef(
  /** @param {InputProps} props @param {React.ForwardedRef<HTMLInputElement>} ref */
  function Input({ label, value, onChange, type = "text", fieldClassName = "", className = "", ...inputProps }, ref) {
  return (
    <label className={`ui-input-field${fieldClassName ? ` ${fieldClassName}` : ""}`}>
      {label && <span className="ui-input-label">{label}</span>}
      <input
        {...inputProps}
        ref={ref}
        type={type}
        className={`ui-input${className ? ` ${className}` : ""}`}
        value={value ?? ""}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
      />
    </label>
  );
  }
);

/** @typedef {{ label?: React.ReactNode, value?: string | number, onChange: (value: string) => void, children?: React.ReactNode, required?: boolean, className?: string, triggerClassName?: string, id?: string, ariaLabel?: string }} SelectProps */
const EMPTY_SELECT_VALUE = "__aura_empty_select_value__";

function selectItems(children) {
  return React.Children.toArray(children).flatMap((child) => {
    if (!React.isValidElement(child)) return [];
    if (child.type === "optgroup") {
      return (
        <SelectPrimitive.Group key={child.key ?? child.props.label}>
          <SelectPrimitive.Label className="ui-select-group-label">{child.props.label}</SelectPrimitive.Label>
          {selectItems(child.props.children)}
        </SelectPrimitive.Group>
      );
    }
    if (child.type !== "option") return [];
    const optionValue = child.props.value ?? child.props.children;
    const normalizedValue = String(optionValue ?? "") || EMPTY_SELECT_VALUE;
    return (
      <SelectPrimitive.Item key={child.key ?? normalizedValue} className="ui-select-item" value={normalizedValue} disabled={child.props.disabled}>
        <SelectPrimitive.ItemText>{child.props.children}</SelectPrimitive.ItemText>
        <SelectPrimitive.ItemIndicator className="ui-select-item-indicator"><Check size={15} /></SelectPrimitive.ItemIndicator>
      </SelectPrimitive.Item>
    );
  });
}

/** @param {SelectProps} props */
export function Select({ label, value, onChange, children, required, className = "", triggerClassName = "", id, ariaLabel }) {
  const normalizedValue = String(value ?? "") || EMPTY_SELECT_VALUE;
  const content = (
    <SelectPrimitive.Root value={normalizedValue} onValueChange={(nextValue) => onChange(nextValue === EMPTY_SELECT_VALUE ? "" : nextValue)} required={required}>
      <SelectPrimitive.Trigger id={id} className={`ui-select-trigger${triggerClassName ? ` ${triggerClassName}` : ""}`} aria-label={ariaLabel || (typeof label === "string" ? label : undefined)}>
        <SelectPrimitive.Value />
        <SelectPrimitive.Icon className="ui-select-icon"><ChevronDown size={17} /></SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content className="ui-select-content" position="popper" sideOffset={6}>
          <SelectPrimitive.Viewport className="ui-select-viewport">{selectItems(children)}</SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
  return (
    <label className={`ui-select-field${className ? ` ${className}` : ""}`}>
      {label && <span className="ui-select-label">{label}</span>}
      {content}
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
/** @param {{ value?: string, onChange: (value: string) => void, options?: string[] }} props */
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
/** @typedef {Omit<React.ComponentPropsWithoutRef<"button">, "type"> & { variant?: "primary" | "secondary" | "ghost" | "danger", type?: "button" | "submit" | "reset" }} ButtonProps */
export const Button = React.forwardRef(
  /** @param {ButtonProps} props @param {React.ForwardedRef<HTMLButtonElement>} ref */
  function Button({ variant = "primary", type = "button", className = "", children, ...props }, ref) {
  const base = BUTTON_VARIANT[variant] || BUTTON_VARIANT.primary;
  return (
    <button {...props} ref={ref} type={type} className={`${base}${className ? ` ${className}` : ""}`}>
      {children}
    </button>
  );
  }
);

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

/** @typedef {Omit<React.ComponentPropsWithoutRef<"textarea">, "onChange" | "value"> & { label?: React.ReactNode, value?: string | number, onChange?: (value: string) => void, fieldClassName?: string }} TextareaProps */
export const Textarea = React.forwardRef(
  /** @param {TextareaProps} props @param {React.ForwardedRef<HTMLTextAreaElement>} ref */
  function Textarea({ label, value, onChange, rows = 3, fieldClassName = "", className = "", ...textareaProps }, ref) {
  return (
    <label className={`ui-textarea-field${fieldClassName ? ` ${fieldClassName}` : ""}`}>
      {label && <span className="ui-textarea-label">{label}</span>}
      <textarea
        {...textareaProps}
        ref={ref}
        rows={rows}
        className={`ui-textarea${className ? ` ${className}` : ""}`}
        value={value ?? ""}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
      />
    </label>
  );
  }
);

/** @param {{ label: React.ReactNode, checked: boolean, onChange: (checked: boolean) => void, disabled?: boolean, className?: string }} props */
export function Checkbox({ label, checked, onChange, disabled = false, className = "" }) {
  return (
    <label className={`checkbox-field${className ? ` ${className}` : ""}`}>
      <CheckboxPrimitive.Root className="ui-checkbox" checked={checked} disabled={disabled} onCheckedChange={(nextChecked) => onChange(Boolean(nextChecked))}>
        <CheckboxPrimitive.Indicator><Check size={14} /></CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      <span>{label}</span>
    </label>
  );
}

/**
 * Abas acessíveis baseadas em Radix. Use a composição `Tabs.List`,
 * `Tabs.Trigger` e `Tabs.Content`; `onChange` é um alias de `onValueChange`
 * para manter a convenção dos campos controlados da aplicação.
 */
/** @param {{ value?: string, defaultValue?: string, onValueChange?: (value: string) => void, onChange?: (value: string) => void, className?: string, children?: React.ReactNode, [key: string]: any }} props */
export function Tabs({ value, defaultValue, onValueChange, onChange, className = "", children, ...props }) {
  const handleValueChange = (nextValue) => {
    onValueChange?.(nextValue);
    onChange?.(nextValue);
  };
  return (
    <TabsPrimitive.Root {...props} value={value} defaultValue={defaultValue} onValueChange={handleValueChange} className={`ui-tabs${className ? ` ${className}` : ""}`}>
      {children}
    </TabsPrimitive.Root>
  );
}

/** @param {{ className?: string, children?: React.ReactNode, "aria-label"?: string, [key: string]: any }} props */
Tabs.List = function TabsList({ className = "", children, "aria-label": ariaLabel = "Abas", ...props }) {
  return <TabsPrimitive.List {...props} aria-label={ariaLabel} className={`ui-tabs-list${className ? ` ${className}` : ""}`}>{children}</TabsPrimitive.List>;
};
/** @param {{ value: string, className?: string, children?: React.ReactNode, [key: string]: any }} props */
Tabs.Trigger = function TabsTrigger({ className = "", children, ...props }) {
  return <TabsPrimitive.Trigger {...props} className={`ui-tabs-trigger${className ? ` ${className}` : ""}`}>{children}</TabsPrimitive.Trigger>;
};
/** @param {{ value: string, className?: string, children?: React.ReactNode, [key: string]: any }} props */
Tabs.Content = function TabsContent({ className = "", children, ...props }) {
  return <TabsPrimitive.Content {...props} className={`ui-tabs-content${className ? ` ${className}` : ""}`}>{children}</TabsPrimitive.Content>;
};

/**
 * Área expansível acessível. `type="single"` permite `collapsible`; em
 * `multiple`, `value` e `defaultValue` são arrays conforme o contrato Radix.
 */
/** @param {{ type?: "single" | "multiple", value?: string | string[], defaultValue?: string | string[], onValueChange?: (value: string | string[]) => void, collapsible?: boolean, className?: string, children?: React.ReactNode, [key: string]: any }} props */
export function Accordion({ type = "single", value, defaultValue, onValueChange, collapsible = true, className = "", children, ...props }) {
  const rootClassName = `ui-accordion${className ? ` ${className}` : ""}`;
  if (type === "multiple") {
    return (
      <AccordionPrimitive.Root
        {...props}
        type="multiple"
        value={Array.isArray(value) ? value : undefined}
        defaultValue={Array.isArray(defaultValue) ? defaultValue : undefined}
        onValueChange={(nextValue) => onValueChange?.(nextValue)}
        className={rootClassName}
      >
        {children}
      </AccordionPrimitive.Root>
    );
  }
  return (
    <AccordionPrimitive.Root
      {...props}
      type="single"
      value={typeof value === "string" ? value : undefined}
      defaultValue={typeof defaultValue === "string" ? defaultValue : undefined}
      onValueChange={(nextValue) => onValueChange?.(nextValue)}
      collapsible={collapsible}
      className={rootClassName}
    >
      {children}
    </AccordionPrimitive.Root>
  );
}

/** @param {{ value: string, className?: string, children?: React.ReactNode, [key: string]: any }} props */
Accordion.Item = function AccordionItem({ className = "", children, ...props }) {
  return <AccordionPrimitive.Item {...props} className={`ui-accordion-item${className ? ` ${className}` : ""}`}>{children}</AccordionPrimitive.Item>;
};
/** @param {{ className?: string, children?: React.ReactNode, [key: string]: any }} props */
Accordion.Header = function AccordionHeader({ className = "", children, ...props }) {
  return <AccordionPrimitive.Header {...props} className={`ui-accordion-header${className ? ` ${className}` : ""}`}>{children}</AccordionPrimitive.Header>;
};
/** @param {{ className?: string, children?: React.ReactNode, [key: string]: any }} props */
Accordion.Trigger = function AccordionTrigger({ className = "", children, ...props }) {
  return <AccordionPrimitive.Trigger {...props} className={`ui-accordion-trigger${className ? ` ${className}` : ""}`}>{children}<ChevronDown className="ui-accordion-chevron" size={18} aria-hidden="true" /></AccordionPrimitive.Trigger>;
};
/** @param {{ className?: string, children?: React.ReactNode, [key: string]: any }} props */
Accordion.Content = function AccordionContent({ className = "", children, ...props }) {
  return <AccordionPrimitive.Content {...props} className={`ui-accordion-content${className ? ` ${className}` : ""}`}><div className="ui-accordion-content-inner">{children}</div></AccordionPrimitive.Content>;
};

/**
 * Toggle booleano acessível. `onChange` recebe booleano; `className` estiliza
 * o invólucro e `switchClassName` o controle Radix.
 */
export function Switch({ label, description, checked, defaultChecked, onChange, disabled = false, id, className = "", switchClassName = "", ...props }) {
  const generatedId = React.useId();
  const controlId = id || generatedId;
  const control = (
    <SwitchPrimitive.Root
      {...props}
      id={controlId}
      checked={checked}
      defaultChecked={defaultChecked}
      disabled={disabled}
      onCheckedChange={(nextChecked) => onChange?.(Boolean(nextChecked))}
      className={`ui-switch${switchClassName ? ` ${switchClassName}` : ""}`}
    >
      <SwitchPrimitive.Thumb className="ui-switch-thumb" />
    </SwitchPrimitive.Root>
  );
  if (!label && !description) return control;
  return (
    <div className={`ui-switch-field${className ? ` ${className}` : ""}`}>
      {control}
      <label htmlFor={controlId}>
        {label && <span className="ui-switch-label">{label}</span>}
        {description && <small className="ui-switch-description">{description}</small>}
      </label>
    </div>
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
