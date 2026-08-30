import React from "react";
import { AlertCircle, Check, ChevronDown, Pencil, Save } from "lucide-react";
import { Accordion, Button } from "./Ui";
import "./form-workflow.css";

function classNames(...values) {
  return values.filter(Boolean).join(" ");
}

function formatSavedAt(savedAt) {
  if (!savedAt) return "";
  const date = new Date(savedAt);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/** Estrutura externa consistente para páginas e modais com formulários longos. */
export function FormWorkflow({
  title,
  description,
  eyebrow,
  actions,
  draft,
  children,
  className = "",
  as: Component = "div",
  ...props
}) {
  const Root = /** @type {React.ElementType} */ (Component);
  const draftLabel = draft?.error
    ? "Não foi possível salvar o rascunho"
    : draft?.isSaving
      ? "Salvando rascunho…"
      : draft?.hasDraft
        ? "Rascunho anterior disponível"
        : draft?.savedAt
          ? `Rascunho salvo às ${formatSavedAt(draft.savedAt)}`
          : "";

  return (
    <Root {...props} className={classNames("form-workflow", className)}>
      <header className="form-workflow__header">
        <div className="form-workflow__heading">
          {eyebrow && <span className="form-workflow__eyebrow">{eyebrow}</span>}
          <h1>{title}</h1>
          {description && <p>{description}</p>}
        </div>
        {(draftLabel || actions) && (
          <div className="form-workflow__header-actions">
            {draftLabel && (
              <span
                className={classNames("form-workflow__draft-status", draft?.error && "is-error")}
                role={draft?.error ? "alert" : "status"}
              >
                {draft?.error ? <AlertCircle size={16} /> : <Save size={16} />}
                {draftLabel}
              </span>
            )}
            {actions}
          </div>
        )}
      </header>
      {children}
    </Root>
  );
}

/** Painel da etapa atual, utilizável também sem o invólucro FormWorkflow. */
export function FormPage({ title, description, actions, children, className = "", ...props }) {
  const headingId = React.useId();
  return (
    <section
      {...props}
      aria-labelledby={title ? headingId : undefined}
      className={classNames("form-workflow__page", className)}
    >
      {(title || description || actions) && (
        <header className="form-workflow__page-header">
          <div>
            {title && <h2 id={headingId}>{title}</h2>}
            {description && <p>{description}</p>}
          </div>
          {actions && <div className="form-workflow__page-actions">{actions}</div>}
        </header>
      )}
      <div className="form-workflow__page-content">{children}</div>
    </section>
  );
}

FormWorkflow.Page = FormPage;

/** Agrupa campos relacionados e mantém instruções junto ao contexto. */
export function FormSection({ title, description, badge, actions, children, className = "", ...props }) {
  const headingId = React.useId();
  return (
    <section
      {...props}
      aria-labelledby={title ? headingId : undefined}
      className={classNames("form-workflow__section", className)}
    >
      {(title || description || badge || actions) && (
        <header className="form-workflow__section-header">
          <div>
            <div className="form-workflow__section-title">
              {title && <h3 id={headingId}>{title}</h3>}
              {badge && <span>{badge}</span>}
            </div>
            {description && <p>{description}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className="form-workflow__section-content">{children}</div>
    </section>
  );
}

/** Navegação acessível entre etapas, com suporte a fluxo linear ou livre. */
export function StepNavigator({
  steps = [],
  currentStep,
  onStepChange,
  linear = false,
  canNavigateTo,
  ariaLabel = "Etapas do formulário",
  className = "",
}) {
  const currentIndex = steps.findIndex((step) => String(step.id) === String(currentStep));
  return (
    <nav className={classNames("form-workflow__steps", className)} aria-label={ariaLabel}>
      <ol>
        {steps.map((step, index) => {
          const active = index === currentIndex;
          const complete = step.completed ?? (currentIndex >= 0 && index < currentIndex);
          const permitted = canNavigateTo ? canNavigateTo(step, index) : !(linear && index > currentIndex + 1);
          const disabled = active || !onStepChange || step.disabled || !permitted;
          return (
            <li
              key={step.id}
              className={classNames(active && "is-active", complete && "is-complete", step.invalid && "is-invalid")}
            >
              <button
                type="button"
                aria-current={active ? "step" : undefined}
                aria-label={`${index + 1}. ${step.label}${step.optional ? ", opcional" : ""}`}
                disabled={disabled}
                onClick={() => onStepChange?.(step.id, index)}
              >
                <span className="form-workflow__step-marker" aria-hidden="true">
                  {complete ? <Check size={16} /> : index + 1}
                </span>
                <span className="form-workflow__step-copy">
                  <strong>{step.label}</strong>
                  {step.description && <small>{step.description}</small>}
                  {step.optional && <em>Opcional</em>}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Campos pouco usados ficam disponíveis sem competir com o fluxo principal. */
export function AdvancedFields({
  title = "Campos avançados",
  description = "Preencha apenas se for necessário.",
  count,
  open,
  defaultOpen = false,
  onOpenChange,
  children,
  className = "",
}) {
  const controlledProps =
    open === undefined ? { defaultValue: defaultOpen ? "advanced" : "" } : { value: open ? "advanced" : "" };
  return (
    <Accordion
      {...controlledProps}
      onValueChange={(nextValue) => onOpenChange?.(Boolean(nextValue))}
      className={classNames("form-workflow__advanced", className)}
    >
      <Accordion.Item value="advanced">
        <Accordion.Header>
          <Accordion.Trigger>
            <span>
              <strong>{title}</strong>
              {description && <small>{description}</small>}
            </span>
            {Number.isFinite(count) && <em>{count}</em>}
            <ChevronDown className="form-workflow__advanced-icon" size={18} aria-hidden="true" />
          </Accordion.Trigger>
        </Accordion.Header>
        <Accordion.Content>{children}</Accordion.Content>
      </Accordion.Item>
    </Accordion>
  );
}

function normalizeError(error, index) {
  if (typeof error === "string") return { id: String(index), message: error };
  return {
    id: String(error?.id ?? error?.field ?? index),
    field: error?.field,
    label: error?.label,
    message: error?.message ?? String(error ?? "Erro de validação"),
  };
}

/** Resumo no topo para não obrigar a pessoa a caçar erros em formulários longos. */
export function ValidationSummary({ errors = [], title, onErrorClick, className = "" }) {
  const normalizedErrors = errors.filter(Boolean).map(normalizeError);
  if (!normalizedErrors.length) return null;
  const resolvedTitle = title ?? `Revise ${normalizedErrors.length === 1 ? "o campo indicado" : "os campos indicados"}`;

  return (
    <section className={classNames("form-workflow__validation", className)} role="alert" aria-live="assertive">
      <AlertCircle size={20} aria-hidden="true" />
      <div>
        <strong>{resolvedTitle}</strong>
        <ul>
          {normalizedErrors.map((error) => (
            <li key={error.id}>
              {onErrorClick && error.field ? (
                <button type="button" onClick={() => onErrorClick(error.field, error)}>
                  {error.label && <b>{error.label}: </b>}
                  {error.message}
                </button>
              ) : (
                <span>
                  {error.label && <b>{error.label}: </b>}
                  {error.message}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function displayValue(value, emptyLabel) {
  if (value === null || value === undefined || value === "") return emptyLabel;
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (Array.isArray(value)) return value.length ? value.join(", ") : emptyLabel;
  if (React.isValidElement(value)) return value;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Conferência final por grupos antes do salvamento definitivo. */
export function ReviewSummary({
  title = "Confira os dados",
  description,
  sections,
  items = [],
  emptyLabel = "Não informado",
  onEdit,
  className = "",
}) {
  const normalizedSections = sections?.length ? sections : [{ id: "summary", items }];
  return (
    <section className={classNames("form-workflow__review", className)}>
      <header>
        <div>
          <h3>{title}</h3>
          {description && <p>{description}</p>}
        </div>
      </header>
      <div className="form-workflow__review-sections">
        {normalizedSections.map((section, index) => (
          <section key={section.id ?? section.title ?? index}>
            {(section.title || (onEdit && section.editable !== false)) && (
              <header>
                {section.title && <h4>{section.title}</h4>}
                {onEdit && section.editable !== false && (
                  <Button variant="ghost" onClick={() => onEdit(section.id, section)}>
                    <Pencil size={15} aria-hidden="true" /> Editar
                  </Button>
                )}
              </header>
            )}
            <dl>
              {(section.items ?? []).map((item, itemIndex) => (
                <div key={item.id ?? item.label ?? itemIndex}>
                  <dt>{item.label}</dt>
                  <dd>{displayValue(item.value, item.emptyLabel ?? emptyLabel)}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </section>
  );
}
