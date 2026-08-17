import { useId } from "react";
import {
  CATALOG_BUILDER_PLUGIN_REGISTRY,
  getCatalogBuilderPlugin,
  hasRequiredPluginFeature,
  normalizeCatalogBuilderPluginConfig
} from "./builderPluginRegistry";
import styles from "./CatalogPluginEditor.module.css";
import { Checkbox, Input, Select, Switch, Textarea } from "../../components/common/Ui";

const asArray = (value) => Array.isArray(value) ? value : [];
const asObject = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};

function safeInstanceId(value, fallback) {
  const compact = String(value || "").trim().replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 100);
  return compact || fallback;
}

function draftConfigFor(plugin) {
  const draft = {};
  for (const field of plugin.fields) {
    if (field.type === "faq_items") draft[field.key] = [{ question: "", answer: "" }];
    else if (field.defaultValue !== undefined) draft[field.key] = field.defaultValue;
    else draft[field.key] = "";
  }
  return normalizeCatalogBuilderPluginConfig(plugin.id, draft, { preserveEmptyItems: true }).config;
}

function normalizeEditorInstance(value, index) {
  const source = asObject(value);
  const plugin = getCatalogBuilderPlugin(source.pluginId);
  if (!plugin) return null;
  const normalized = normalizeCatalogBuilderPluginConfig(plugin.id, source.config, { preserveEmptyItems: true });
  return {
    id: safeInstanceId(source.id, `${plugin.id}-${index + 1}`),
    pluginId: plugin.id,
    enabled: source.enabled !== false,
    config: normalized.config
  };
}

function normalizedEditorPlugins(plugins) {
  return asArray(plugins).map(normalizeEditorInstance).filter(Boolean);
}

function pluginInstances(instances, pluginId) {
  return instances.filter((instance) => instance.pluginId === pluginId);
}

function fieldErrors(errors, fieldKey) {
  return errors.filter((error) => error.field === fieldKey || error.field.startsWith(`${fieldKey}.`));
}

function pluginStatusLabel(plugin) {
  return plugin.multiple ? "Várias instâncias" : "Uma instância";
}

function normalizedPluginLimit(value) {
  const limit = Number(value);
  return Number.isFinite(limit) && limit >= 0 ? Math.floor(limit) : Infinity;
}

function KnownField({ field, config, errors, baseId, onChange }) {
  const id = `${baseId}-${field.key}`;
  const messages = fieldErrors(errors, field.key);
  const describedBy = messages.length ? `${id}-error` : undefined;
  const value = config[field.key] ?? "";

  if (field.type === "faq_items") return <FaqItemsField field={field} value={asArray(value)} errors={messages} baseId={id} onChange={onChange} />;

  if (field.type === "boolean") {
    return (
      <Switch className={styles.checkField} label={field.label} checked={Boolean(value)} onChange={onChange} />
    );
  }

  if (field.type === "select") {
    return (
      <>
        <Select className={styles.field} id={id} label={`${field.label}${field.required ? " *" : ""}`} value={value} onChange={onChange}>
          {(field.options || []).map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
        </Select>
        {messages.length > 0 && <FieldErrors id={`${id}-error`} errors={messages} />}
      </>
    );
  }

  const inputType = field.type === "phone" ? "tel" : field.type === "url" ? "url" : "text";
  return (
    <>
      {field.type === "textarea" ? (
        <Textarea fieldClassName={styles.field} id={id} label={`${field.label}${field.required ? " *" : ""}`} value={value} maxLength={field.maxLength} aria-describedby={describedBy} onChange={onChange} />
      ) : (
        <Input fieldClassName={styles.field} id={id} label={`${field.label}${field.required ? " *" : ""}`} type={inputType} value={value} maxLength={field.maxLength} inputMode={field.type === "phone" ? "tel" : field.type === "url" ? "url" : undefined} aria-describedby={describedBy} onChange={onChange} />
      )}
      {field.type === "url" && <small>Somente URL HTTPS aprovada para esta integração.</small>}
      {messages.length > 0 && <FieldErrors id={`${id}-error`} errors={messages} />}
    </>
  );
}

function FieldErrors({ id, errors }) {
  return <span id={id} className={styles.fieldError} role="alert">{errors.map((error) => error.message).join(" ")}</span>;
}

function FaqItemsField({ field, value, errors, baseId, onChange }) {
  function updateItem(index, patch) {
    onChange(value.map((item, itemIndex) => itemIndex === index ? { ...asObject(item), ...patch } : item));
  }
  function removeItem(index) {
    onChange(value.filter((_, itemIndex) => itemIndex !== index));
  }
  return (
    <fieldset className={styles.faqField}>
      <legend>{field.label}{field.required ? " *" : ""}</legend>
      <ol>
        {value.map((item, index) => {
          const questionId = `${baseId}-${index}-question`;
          const answerId = `${baseId}-${index}-answer`;
          const itemErrors = errors.filter((error) => error.field === `items.${index}.question` || error.field === `items.${index}.answer`);
          return (
            <li key={`${index}-${item.question || "new"}`}>
              <Input id={questionId} label={`Pergunta ${index + 1}`} value={item.question || ""} maxLength={180} onChange={(question) => updateItem(index, { question })} />
              <Textarea id={answerId} label={`Resposta ${index + 1}`} value={item.answer || ""} maxLength={2000} onChange={(answer) => updateItem(index, { answer })} />
              <button type="button" className={styles.textButton} onClick={() => removeItem(index)} aria-label={`Remover pergunta ${index + 1}`}>Remover</button>
              {itemErrors.length > 0 && <FieldErrors id={`${baseId}-${index}-error`} errors={itemErrors} />}
            </li>
          );
        })}
      </ol>
      <button type="button" className={styles.secondaryButton} onClick={() => onChange([...value, { question: "", answer: "" }])}>Adicionar pergunta</button>
      {!value.length && <FieldErrors id={`${baseId}-error`} errors={errors} />}
    </fieldset>
  );
}

function PluginLibraryCard({ plugin, instances, available, atLimit, onAdd }) {
  const alreadyAdded = !plugin.multiple && instances.length > 0;
  const disabled = alreadyAdded || !available || atLimit;
  const reason = !available
    ? "Indisponível no plano atual"
    : atLimit
      ? "Limite de integrações atingido"
      : alreadyAdded
        ? "Já adicionado"
        : "";
  return (
    <article className={styles.libraryCard}>
      <div>
        <h4>{plugin.label}</h4>
        <p>{plugin.description}</p>
      </div>
      <div className={styles.badges}>
        <span>{pluginStatusLabel(plugin)}</span>
        <span>Plano: {plugin.featureFlag}</span>
        {reason && <span className={styles.unavailable}>{reason}</span>}
      </div>
      <button type="button" className={styles.secondaryButton} disabled={disabled} onClick={() => onAdd(plugin)} aria-label={`Adicionar ${plugin.label}`}>
        {reason || "Adicionar"}
      </button>
    </article>
  );
}

function PluginInstanceCard({ instance, index, canEnable, onUpdate, onRemove }) {
  const plugin = getCatalogBuilderPlugin(instance.pluginId);
  const normalized = normalizeCatalogBuilderPluginConfig(plugin.id, instance.config, { preserveEmptyItems: true });
  const titleId = `catalog-plugin-${instance.id}-heading`;
  const hosts = plugin.allowedHosts.length ? plugin.allowedHosts.join(", ") : "Nenhum host externo";
  return (
    <article className={styles.instanceCard} aria-labelledby={titleId}>
      <header>
        <div>
          <h4 id={titleId}>{plugin.label}</h4>
          <p>Integração nativa #{index + 1} · Recurso: <code>{plugin.featureFlag}</code></p>
        </div>
        <div className={styles.instanceActions}>
          <Switch className={styles.checkField} label="Ativo" checked={instance.enabled} disabled={!instance.enabled && !canEnable} onChange={(enabled) => onUpdate({ enabled })} />
          <button type="button" className={styles.removeButton} onClick={onRemove}>Remover</button>
        </div>
      </header>

      <dl className={styles.integrationFacts}>
        <div><dt>Hosts permitidos</dt><dd>{hosts}</dd></div>
        <div><dt>Consentimento</dt><dd>{plugin.consent.required ? `Obrigatório: ${plugin.consent.purpose}` : "Não necessário"}</dd></div>
      </dl>
      {plugin.consent.required && <p className={styles.consentNotice} role="status">{plugin.consent.description}</p>}
      {!instance.enabled && !canEnable && <p className={styles.consentNotice}>Remova ou desative outra integração antes de ativar esta.</p>}

      <div className={styles.fields}>
        {plugin.fields.map((field) => (
          <KnownField
            key={field.key}
            field={field}
            config={normalized.config}
            errors={normalized.errors}
            baseId={`catalog-plugin-${instance.id}-field`}
            onChange={(value) => onUpdate({ config: { ...normalized.config, [field.key]: value } })}
          />
        ))}
      </div>
    </article>
  );
}

/**
 * Editor controlado e ainda não conectado ao snapshot/publicação do catálogo.
 * `onChange` recebe exclusivamente `{ id, pluginId, enabled, config }[]`.
 *
 * Quando `enabledFeatures` é fornecido, deve ser um array de feature flags do
 * plano (ex.: `["public_catalog_customization", "whatsapp_link"]`).
 * `pluginLimit` é o máximo de instâncias ativas na vitrine. Sem essas props, mantemos o
 * comportamento legado: biblioteca inteira disponível e sem limite.
 */
export function CatalogPluginEditor({ plugins = [], onChange, enabledFeatures, pluginLimit }) {
  const headingId = useId();
  const instances = normalizedEditorPlugins(plugins);
  const featureContextAvailable = Array.isArray(enabledFeatures);
  const safeLimit = normalizedPluginLimit(pluginLimit);
  const activeInstances = instances.filter((instance) => instance.enabled !== false);
  const atLimit = activeInstances.length >= safeLimit;

  function isPluginAvailable(plugin) {
    return !featureContextAvailable || hasRequiredPluginFeature(plugin, enabledFeatures);
  }

  function emit(next) {
    onChange?.(normalizedEditorPlugins(next));
  }

  function addPlugin(plugin) {
    const samePluginCount = pluginInstances(instances, plugin.id).length;
    if (!isPluginAvailable(plugin) || activeInstances.length >= safeLimit || (!plugin.multiple && samePluginCount > 0)) return;
    const nextId = `${plugin.id}-${Date.now()}-${instances.length + 1}`;
    emit([...instances, { id: nextId, pluginId: plugin.id, enabled: true, config: draftConfigFor(plugin) }]);
  }

  function updatePlugin(id, patch) {
    emit(instances.map((instance) => instance.id === id ? { ...instance, ...patch, config: patch.config ? patch.config : instance.config } : instance));
  }

  function removePlugin(id) {
    emit(instances.filter((instance) => instance.id !== id));
  }

  return (
    <section className={styles.editor} aria-labelledby={headingId}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Integrações nativas</span>
          <h3 id={headingId}>Blocos seguros para sua página</h3>
          <p>Escolha integrações prontas. Campos desconhecidos e qualquer HTML, CSS ou JavaScript são descartados.</p>
        </div>
      </header>

      <div className={styles.library} aria-label="Plugins disponíveis">
        {CATALOG_BUILDER_PLUGIN_REGISTRY.map((plugin) => (
          <PluginLibraryCard key={plugin.id} plugin={plugin} instances={pluginInstances(instances, plugin.id)} available={isPluginAvailable(plugin)} atLimit={atLimit} onAdd={addPlugin} />
        ))}
      </div>

      <div className={styles.instances} aria-live="polite">
        <h4>Integrações adicionadas</h4>
        {!instances.length && <p className={styles.empty}>Nenhuma integração adicionada. Os blocos continuarão usando apenas componentes nativos do catálogo.</p>}
        {instances.map((instance, index) => (
          <PluginInstanceCard key={instance.id} instance={instance} index={index} canEnable={instance.enabled || !atLimit} onUpdate={(patch) => updatePlugin(instance.id, patch)} onRemove={() => removePlugin(instance.id)} />
        ))}
      </div>
    </section>
  );
}
