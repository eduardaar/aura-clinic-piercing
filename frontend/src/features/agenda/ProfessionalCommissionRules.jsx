// Configuração de comissão do profissional (padrão de serviços, por serviço e
// para produtos/joias) com histórico de alterações.
//
// Contrato de props FIXO (usado por Agenda.jsx, no modal "Editar profissional").
//
// O salvamento é separado do cadastro do profissional: PUT
// /api/professionals/:id/commission-rules substitui o conjunto de regras
// (insere, atualiza e desativa — nunca apaga). Por isso a tela envia SEMPRE
// todas as regras que já existem, inclusive as inativas: regra omitida seria
// desativada pelo backend. Mudar uma regra não recalcula atendimentos passados.
//
// O título visível ("Comissão") é do pai (modal "Editar profissional"); aqui a
// seção só tem nome acessível. Mesmo que algum pai a coloque dentro de um
// <form>, não há <form> aninhado, os botões são `type="button"` e Enter num
// campo daqui não envia o cadastro.
import { useEffect, useMemo, useState } from "react";
import { History, Plus } from "lucide-react";
import { Accordion, Button, Input, Select, StatusBadge, Switch } from "../../components/common/Ui";
import { PlanUpgradeNotice } from "../../components/common/PlanUpgradeNotice";
import { apiFetch, readStoredSession, useApiInvalidate } from "../../lib/api";
import { can } from "../../lib/permissions";
import { asArray, asNumber, asObject } from "../../lib/utils";
import { currency } from "../shared/helpers";
import "../finance/commissions.css";

const RATE_TYPE_LABELS = { percentual: "Percentual (%)", valor_fixo: "Valor fixo (R$)" };
const SCOPE_LABELS = { servico_padrao: "Padrão de serviços", servico: "Serviço", produto_padrao: "Produtos e joias" };
const ACTION_LABELS = {
  rule_create: "Regra criada",
  rule_update: "Regra alterada",
  rule_deactivate: "Regra desativada"
};

let draftSequence = 0;
const nextKey = () => `nova-${++draftSequence}`;

/**
 * Valida o valor digitado de uma regra. Aceita vírgula ou ponto como decimal.
 * @param {"percentual"|"valor_fixo"} rateType
 * @param {unknown} raw
 * @returns {string} Mensagem de erro, ou "" quando válido.
 */
export function validateCommissionRate(rateType, raw) {
  const text = String(raw ?? "").trim().replace(",", ".");
  if (!text) return "Informe o valor.";
  if (text.startsWith("-")) return "O valor não pode ser negativo.";
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return "Use um número com até 2 casas decimais.";
  if (rateType === "percentual" && Number(text) > 100) return "O percentual deve estar entre 0 e 100.";
  return "";
}

function parseRate(raw) {
  return Number(String(raw ?? "").trim().replace(",", "."));
}

/** Valor da regra para exibição no campo: "10,5" em vez de "10.50". */
function rateInputValue(value) {
  if (value === null || value === undefined || value === "") return "";
  const number = asNumber(value, Number.NaN);
  if (!Number.isFinite(number)) return String(value);
  return String(Number(number.toFixed(2))).replace(".", ",");
}

export function formatCommissionRate(rateType, value) {
  if (rateType === "valor_fixo") return `${currency.format(asNumber(value))} fixo`;
  return `${asNumber(value).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

function emptyDefault(scope) {
  return { key: scope, id: null, scope, service_id: "", rate_type: "percentual", rate_value: "", active: false, notes: "", original: null };
}

function draftFromRule(rule) {
  return {
    key: rule.id ? `regra-${rule.id}` : nextKey(),
    id: rule.id ?? null,
    scope: rule.scope,
    service_id: rule.service_id ? String(rule.service_id) : "",
    rate_type: rule.rate_type === "valor_fixo" ? "valor_fixo" : "percentual",
    rate_value: rateInputValue(rule.rate_value),
    active: rule.active !== false && rule.active !== 0,
    notes: rule.notes || "",
    original: rule
  };
}

/** Separa as regras da API nos três blocos da tela. */
function draftFromRules(rules) {
  const list = asArray(rules);
  const serviceDefault = list.find((rule) => rule.scope === "servico_padrao");
  const productDefault = list.find((rule) => rule.scope === "produto_padrao");
  return {
    serviceDefault: serviceDefault ? draftFromRule(serviceDefault) : emptyDefault("servico_padrao"),
    productDefault: productDefault ? draftFromRule(productDefault) : emptyDefault("produto_padrao"),
    serviceRules: list.filter((rule) => rule.scope === "servico").map(draftFromRule)
  };
}

/** Erros por campo (`<key>.value`, `<key>.service`). Só valida o valor de regra ativa. */
function validateDraft(draft) {
  const errors = /** @type {Record<string, string>} */ ({});
  for (const rule of [draft.serviceDefault, draft.productDefault]) {
    if (!rule.active) continue;
    const message = validateCommissionRate(rule.rate_type, rule.rate_value);
    if (message) errors[`${rule.key}.value`] = message;
  }
  const seen = new Set();
  for (const rule of draft.serviceRules) {
    if (!rule.service_id) errors[`${rule.key}.service`] = "Escolha o serviço.";
    else if (seen.has(rule.service_id)) errors[`${rule.key}.service`] = "Este serviço já tem uma regra. Edite a regra existente.";
    else seen.add(rule.service_id);
    if (rule.active || !rule.id) {
      const message = validateCommissionRate(rule.rate_type, rule.rate_value);
      if (message) errors[`${rule.key}.value`] = message;
    }
  }
  return errors;
}

/**
 * Tipo e valor a enviar: os digitados quando válidos; senão (regra inativa, que
 * não é validada) os já GRAVADOS, juntos. Misturar o tipo novo com o valor
 * antigo mandaria, por exemplo, "percentual 250" e o backend recusaria o PUT.
 */
function payloadRate(rule) {
  if (!validateCommissionRate(rule.rate_type, rule.rate_value)) {
    return { rate_type: rule.rate_type, rate_value: parseRate(rule.rate_value) };
  }
  return {
    rate_type: rule.original?.rate_type === "valor_fixo" ? "valor_fixo" : "percentual",
    rate_value: asNumber(rule.original?.rate_value)
  };
}

/**
 * Corpo do PUT no formato da SPEC: `{ rules: [{ scope, service_id, rate_type, rate_value, active, notes }] }`.
 * Padrão sem regra gravada e desligado não é enviado (não há o que desativar).
 */
export function commissionRulesPayload(draft) {
  const rules = [];
  for (const rule of [draft.serviceDefault, draft.productDefault]) {
    if (!rule.id && !rule.active) continue;
    rules.push({
      scope: rule.scope,
      service_id: null,
      ...payloadRate(rule),
      active: Boolean(rule.active),
      notes: rule.notes.trim() || null
    });
  }
  for (const rule of draft.serviceRules) {
    rules.push({
      scope: "servico",
      service_id: Number(rule.service_id),
      ...payloadRate(rule),
      active: Boolean(rule.active),
      notes: rule.notes.trim() || null
    });
  }
  return { rules };
}

/**
 * Retrato do rascunho para saber se há edição não salva. Usa o texto digitado
 * (não o payload), porque o payload troca valor inválido pelo gravado e
 * esconderia a edição.
 */
function draftSignature(draft) {
  const pick = (rule) => [rule.scope, rule.service_id, rule.rate_type, String(rule.rate_value ?? ""), Boolean(rule.active), (rule.notes || "").trim()];
  return JSON.stringify([draft.serviceDefault, draft.productDefault, ...draft.serviceRules].map(pick));
}

async function readJson(response) {
  return response.json().catch(() => ({}));
}

function isPlanBlock(response, payload) {
  return response.status === 403 && asObject(payload).code === "plan_upgrade_required";
}

// Enter dentro desta seção não pode enviar o <form> do cadastro do profissional.
function blockImplicitSubmit(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (event.key === "Enter" && target?.tagName === "INPUT") event.preventDefault();
}

function CommissionPlanNotice({ onUpgrade }) {
  return (
    <PlanUpgradeNotice title="Comissões fazem parte do plano Studio" planName="Studio" onUpgrade={onUpgrade}>
      Configure percentuais ou valores fixos por serviço e para joias, com histórico de alterações e lançamento automático na finalização do atendimento.
    </PlanUpgradeNotice>
  );
}

/**
 * @param {{
 *   professionalId?: number|string|null,
 *   services?: Array<Record<string, any>>,
 *   features?: string[],
 *   onUpgrade?: () => void,
 *   onDirtyChange?: (dirty: boolean) => void
 * }} props
 * `onDirtyChange` avisa o modal pai quando há regra editada e não salva: as
 * regras têm salvamento próprio, fora do <form> do cadastro, e sem isso fechar
 * o modal perdia a edição sem perguntar.
 */
export function ProfessionalCommissionRules({ professionalId, services = [], features = [], onUpgrade, onDirtyChange }) {
  // `professional_id` não está no tipo da sessão (nem sempre vem do login).
  const user = /** @type {Record<string, any>} */ (readStoredSession()?.user || {});
  const canEdit = can(user, "commission.edit");
  const canViewAll = can(user, "commission.view_all");
  // `view_own` só serve para o próprio profissional; quando a sessão não traz o
  // vínculo, a tela tenta e o backend decide (403 vira aviso).
  const ownProfessional = user.professional_id == null || String(user.professional_id) === String(professionalId ?? "");
  const canView = canEdit || canViewAll || (can(user, "commission.view_own") && ownProfessional);
  const planAllowed = Array.isArray(features) && features.includes("commissions");

  let notice = null;
  if (!professionalId) notice = <p className="field-hint" role="note">Salve o profissional para configurar a comissão.</p>;
  else if (!planAllowed) notice = <CommissionPlanNotice onUpgrade={onUpgrade} />;
  else if (!canView) notice = <p className="field-hint" role="note">Você não tem permissão para ver a comissão deste profissional.</p>;

  // `data-modal-ignore-dirty`: o que se digita aqui não é do <form> do
  // cadastro; a pendência das regras chega ao modal por `onDirtyChange`.
  return (
    <section className="commission-rules" aria-label="Configuração da comissão" onKeyDown={blockImplicitSubmit} data-modal-ignore-dirty="">
      {notice || (
        <CommissionRulesEditor
          professionalId={professionalId}
          fallbackServices={services}
          canEdit={canEdit}
          onUpgrade={onUpgrade}
          onDirtyChange={onDirtyChange}
        />
      )}
    </section>
  );
}

function CommissionRulesEditor({ professionalId, fallbackServices, canEdit, onUpgrade, onDirtyChange }) {
  const invalidate = useApiInvalidate();
  const [load, setLoad] = useState({ loading: true, error: "", planBlocked: false, forbidden: false });
  const [apiServices, setApiServices] = useState(/** @type {any[] | null} */ (null));
  const [draft, setDraft] = useState(() => draftFromRules([]));
  const [errors, setErrors] = useState(/** @type {Record<string, string>} */ ({}));
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState({ type: "", text: "" });
  const [historyVersion, setHistoryVersion] = useState(0);
  const [reloadVersion, setReloadVersion] = useState(0);
  // Assinatura do que está gravado: atualizada ao carregar e ao salvar.
  const [savedSignature, setSavedSignature] = useState(() => draftSignature(draftFromRules([])));

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadVersion é o gatilho de releitura ("Tentar novamente" e salvamento sem regras na resposta).
  useEffect(() => {
    let active = true;
    setLoad({ loading: true, error: "", planBlocked: false, forbidden: false });
    (async () => {
      try {
        const response = await apiFetch(`/professionals/${professionalId}/commission-rules`);
        const payload = await readJson(response);
        if (!active) return;
        if (isPlanBlock(response, payload)) return setLoad({ loading: false, error: "", planBlocked: true, forbidden: false });
        if (response.status === 403) return setLoad({ loading: false, error: "", planBlocked: false, forbidden: true });
        if (!response.ok) return setLoad({ loading: false, error: asObject(payload).error || "Não foi possível carregar as regras de comissão.", planBlocked: false, forbidden: false });
        const data = asObject(payload);
        setApiServices(Array.isArray(data.services) ? data.services : null);
        const loaded = draftFromRules(data.rules);
        setDraft(loaded);
        setSavedSignature(draftSignature(loaded));
        setErrors({});
        setLoad({ loading: false, error: "", planBlocked: false, forbidden: false });
      } catch {
        if (active) setLoad({ loading: false, error: "Não foi possível conectar com a API.", planBlocked: false, forbidden: false });
      }
    })();
    return () => { active = false; };
  }, [professionalId, reloadVersion]);

  const dirty = canEdit && !load.loading && draftSignature(draft) !== savedSignature;
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  // Ao desmontar (troca de profissional, fechar o modal) não fica edição pendente presa no pai.
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const services = useMemo(() => {
    const list = apiServices && apiServices.length ? apiServices : asArray(fallbackServices);
    return list.filter((service) => service && service.id !== undefined && service.id !== null);
  }, [apiServices, fallbackServices]);
  const serviceName = (id, fallback = "") => services.find((service) => String(service.id) === String(id))?.name || fallback || (id ? `Serviço #${id}` : "");

  if (load.loading) return <p className="field-hint" aria-live="polite">Carregando regras de comissão…</p>;
  if (load.planBlocked) return <CommissionPlanNotice onUpgrade={onUpgrade} />;
  if (load.forbidden) return <p className="field-hint" role="note">Você não tem permissão para ver a comissão deste profissional.</p>;
  if (load.error) {
    return (
      <div className="stack">
        <p className="form-error" role="alert">{load.error}</p>
        <div><Button variant="secondary" onClick={() => setReloadVersion((value) => value + 1)}>Tentar novamente</Button></div>
      </div>
    );
  }

  function updateRule(key, patch) {
    setFeedback({ type: "", text: "" });
    setDraft((current) => {
      if (current.serviceDefault.key === key) return { ...current, serviceDefault: { ...current.serviceDefault, ...patch } };
      if (current.productDefault.key === key) return { ...current, productDefault: { ...current.productDefault, ...patch } };
      return { ...current, serviceRules: current.serviceRules.map((rule) => (rule.key === key ? { ...rule, ...patch } : rule)) };
    });
    // O erro do campo some quando a pessoa corrige; a validação completa roda no salvar.
    setErrors((current) => {
      const next = { ...current };
      for (const field of Object.keys(patch)) {
        if (field === "rate_value" || field === "rate_type" || field === "active") delete next[`${key}.value`];
        if (field === "service_id") delete next[`${key}.service`];
      }
      return next;
    });
  }

  function addServiceRule() {
    setFeedback({ type: "", text: "" });
    setDraft((current) => ({
      ...current,
      serviceRules: [...current.serviceRules, { key: nextKey(), id: null, scope: "servico", service_id: "", rate_type: "percentual", rate_value: "", active: true, notes: "", original: null }]
    }));
  }

  function removeNewRule(key) {
    setDraft((current) => ({ ...current, serviceRules: current.serviceRules.filter((rule) => rule.key !== key) }));
    setErrors((current) => {
      const next = { ...current };
      delete next[`${key}.value`];
      delete next[`${key}.service`];
      return next;
    });
  }

  async function save() {
    const found = validateDraft(draft);
    setErrors(found);
    if (Object.keys(found).length) {
      setFeedback({ type: "error", text: "Corrija os campos destacados antes de salvar." });
      return;
    }
    setSaving(true);
    setFeedback({ type: "", text: "" });
    try {
      const response = await apiFetch(`/professionals/${professionalId}/commission-rules`, {
        method: "PUT",
        body: JSON.stringify(commissionRulesPayload(draft))
      });
      const payload = await readJson(response);
      if (isPlanBlock(response, payload)) {
        setLoad({ loading: false, error: "", planBlocked: true, forbidden: false });
        return;
      }
      if (!response.ok) {
        setFeedback({ type: "error", text: asObject(payload).error || "Não foi possível salvar as regras de comissão." });
        return;
      }
      const data = asObject(payload);
      if (Array.isArray(data.rules)) {
        const saved = draftFromRules(data.rules);
        setDraft(saved);
        setSavedSignature(draftSignature(saved));
        if (Array.isArray(data.services)) setApiServices(data.services);
      } else {
        setReloadVersion((value) => value + 1);
      }
      setErrors({});
      setHistoryVersion((value) => value + 1);
      setFeedback({ type: "success", text: "Regras de comissão salvas. Valem para os próximos atendimentos finalizados." });
      invalidate("/professionals");
    } catch {
      setFeedback({ type: "error", text: "Não foi possível conectar com a API." });
    } finally {
      setSaving(false);
    }
  }

  const history = (
    <Accordion className="commission-history-accordion">
      <Accordion.Item value="history">
        <Accordion.Header><Accordion.Trigger><History size={15} aria-hidden="true" /> Histórico de alterações</Accordion.Trigger></Accordion.Header>
        <Accordion.Content>
          <CommissionRulesHistory professionalId={professionalId} version={historyVersion} serviceName={serviceName} />
        </Accordion.Content>
      </Accordion.Item>
    </Accordion>
  );

  if (!canEdit) {
    const rules = [draft.serviceDefault, draft.productDefault, ...draft.serviceRules].filter((rule) => rule.id);
    return (
      <div className="commission-rules">
        <p className="field-hint" role="note">Somente leitura: alterar a comissão exige a permissão “Editar comissões”.</p>
        {rules.length === 0 ? (
          <p className="field-hint">Nenhuma regra de comissão configurada para este profissional.</p>
        ) : (
          <ul className="commission-readonly-list" aria-label="Regras de comissão">
            {rules.map((rule) => (
              <li key={rule.key}>
                <span>{rule.scope === "servico" ? serviceName(rule.service_id, rule.original?.service_name) : SCOPE_LABELS[rule.scope]}</span>
                <span>
                  <strong>{formatCommissionRate(rule.rate_type, rule.original?.rate_value ?? parseRate(rule.rate_value))}</strong>{" "}
                  <StatusBadge status={rule.active ? "ativa" : "inativo"}>{rule.active ? "Ativa" : "Inativa"}</StatusBadge>
                </span>
                {rule.notes && <small>{rule.notes}</small>}
              </li>
            ))}
          </ul>
        )}
        {history}
      </div>
    );
  }

  const usedServiceIds = new Set(draft.serviceRules.map((rule) => rule.service_id).filter(Boolean));

  return (
    <div className="commission-rules">
      <p className="field-hint">
        Percentual de 0 a 100 ou valor fixo em reais, sobre a base líquida de cada item (bruto − desconto ± ajustes). Valor fixo nunca passa da base. Alterações valem para os próximos atendimentos finalizados.
      </p>

      <div className="commission-rules-group">
        <header>
          <h4>Serviços — regra padrão</h4>
          <p>Vale para todo serviço sem regra específica.</p>
        </header>
        <RuleCard rule={draft.serviceDefault} errors={errors} onChange={updateRule} toggleLabel="Comissão padrão em serviços" />
      </div>

      <div className="commission-rules-group">
        <header>
          <h4>Regras por serviço</h4>
          <p>Têm prioridade sobre o padrão de serviços. Regra salva não muda de serviço nem é apagada: para corrigir, desative e adicione outra.</p>
        </header>
        {draft.serviceRules.length === 0 && <p className="field-hint">Nenhuma regra específica. Todos os serviços usam o padrão.</p>}
        {draft.serviceRules.map((rule, index) => (
          <RuleCard
            key={rule.key}
            rule={rule}
            index={index}
            errors={errors}
            onChange={updateRule}
            onRemove={rule.id ? null : () => removeNewRule(rule.key)}
            toggleLabel="Regra ativa"
            serviceSelect={rule.id ? (
              // Regra gravada é identificada pelo serviço (único por profissional):
              // trocar o serviço aqui desativaria esta e criaria outra em silêncio.
              // Para mudar, desative esta regra e adicione uma nova.
              <div className="ui-input-field commission-rule-service">
                <span className="ui-input-label">Serviço</span>
                <strong>{serviceName(rule.service_id, rule.original?.service_name)}</strong>
              </div>
            ) : (
              <Select
                label="Serviço"
                ariaLabel={`Serviço da regra ${index + 1}`}
                value={rule.service_id}
                onChange={(value) => updateRule(rule.key, { service_id: value })}
              >
                <option value="">Escolha o serviço</option>
                {services.map((service) => (
                  <option
                    key={service.id}
                    value={String(service.id)}
                    disabled={usedServiceIds.has(String(service.id)) && String(service.id) !== rule.service_id}
                  >
                    {service.name}{[service.active, service.is_active].some((flag) => flag === 0 || flag === false) ? " (inativo)" : ""}
                  </option>
                ))}
              </Select>
            )}
          />
        ))}
        <div>
          <Button variant="secondary" onClick={addServiceRule} disabled={services.length === 0}>
            <Plus size={15} aria-hidden="true" /> Adicionar regra por serviço
          </Button>
          {services.length === 0 && <small className="field-hint">Cadastre serviços para criar regras específicas.</small>}
        </div>
      </div>

      <div className="commission-rules-group">
        <header>
          <h4>Produtos e joias</h4>
          <p>Joias e produtos aplicados no atendimento.</p>
        </header>
        <RuleCard rule={draft.productDefault} errors={errors} onChange={updateRule} toggleLabel="Comissão em produtos e joias" />
      </div>

      {feedback.text && (
        <p className={feedback.type === "error" ? "form-error" : "form-success"} role={feedback.type === "error" ? "alert" : "status"}>
          {feedback.text}
        </p>
      )}
      <div className="commission-rules-actions">
        <Button onClick={save} disabled={saving}>
          {saving ? "Salvando…" : "Salvar comissão"}
        </Button>
      </div>

      {history}
    </div>
  );
}

/**
 * Cartão de uma regra (padrão ou por serviço) no modo de edição.
 * @param {{ rule: any, index?: number, errors: Record<string, string>, onChange: (key: string, patch: Record<string, any>) => void, onRemove?: (() => void) | null, toggleLabel: string, serviceSelect?: React.ReactNode }} props
 */
function RuleCard({ rule, index, errors, onChange, onRemove = null, toggleLabel, serviceSelect = null }) {
  const isDefault = rule.scope !== "servico";
  const suffix = isDefault ? ` — ${SCOPE_LABELS[rule.scope].toLowerCase()}` : ` da regra ${(index ?? 0) + 1}`;
  const valueError = errors[`${rule.key}.value`];
  const serviceError = errors[`${rule.key}.service`];
  const showFields = !isDefault || rule.active;
  const isPercent = rule.rate_type === "percentual";

  return (
    <article className={`commission-rule-card${rule.active ? "" : " is-inactive"}${valueError || serviceError ? " is-invalid" : ""}`}>
      {showFields && (
        <div className="commission-rule-fields">
          {serviceSelect && (
            <div>
              {serviceSelect}
              {serviceError && <small className="field-hint is-error" role="alert">{serviceError}</small>}
            </div>
          )}
          <Select
            label="Tipo"
            ariaLabel={`Tipo${suffix}`}
            value={rule.rate_type}
            onChange={(value) => onChange(rule.key, { rate_type: value })}
          >
            <option value="percentual">{RATE_TYPE_LABELS.percentual}</option>
            <option value="valor_fixo">{RATE_TYPE_LABELS.valor_fixo}</option>
          </Select>
          <div>
            <Input
              label={isPercent ? "Percentual (%)" : "Valor (R$)"}
              aria-label={`${isPercent ? "Percentual (%)" : "Valor (R$)"}${suffix}`}
              inputMode="decimal"
              placeholder={isPercent ? "Ex.: 30" : "Ex.: 25,00"}
              value={rule.rate_value}
              aria-invalid={valueError ? true : undefined}
              onChange={(value) => onChange(rule.key, { rate_value: value })}
            />
            {valueError && <small className="field-hint is-error" role="alert">{valueError}</small>}
          </div>
          <Input
            fieldClassName="commission-rule-notes"
            label="Observações"
            aria-label={`Observações${suffix}`}
            placeholder="Opcional — ex.: acordo de setembro/2026"
            maxLength={500}
            value={rule.notes}
            onChange={(value) => onChange(rule.key, { notes: value })}
          />
        </div>
      )}
      <div className="commission-rule-footer">
        <Switch
          label={toggleLabel}
          aria-label={isDefault ? toggleLabel : `${toggleLabel}${suffix}`}
          description={isDefault && !rule.active ? (rule.id ? "Desativada: os próximos atendimentos não geram comissão por este padrão." : "Sem comissão padrão.") : undefined}
          checked={Boolean(rule.active)}
          onChange={(active) => onChange(rule.key, { active })}
        />
        {onRemove && <Button variant="ghost" onClick={onRemove} aria-label={`Remover regra ${(index ?? 0) + 1}`}>Remover</Button>}
      </div>
    </article>
  );
}

function historyRows(payload) {
  const data = asObject(payload);
  if (Array.isArray(payload)) return payload;
  for (const key of ["history", "items", "events"]) if (Array.isArray(data[key])) return data[key];
  return [];
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Resumo legível de um estado da regra (antes ou depois). */
function describeRuleState(state, serviceName) {
  const value = asObject(state);
  const rule = Object.keys(asObject(value.rule)).length ? asObject(value.rule) : value;
  if (!Object.keys(rule).length) return "—";
  const target = rule.scope === "servico"
    ? (rule.service_name || serviceName(rule.service_id))
    : SCOPE_LABELS[rule.scope] || "";
  const rate = rule.rate_value !== undefined ? formatCommissionRate(rule.rate_type, rule.rate_value) : "";
  const status = rule.active === false || rule.active === 0 ? "inativa" : rule.active === undefined ? "" : "ativa";
  return [target, rate, status].filter(Boolean).join(" · ") || "—";
}

/**
 * Trilha de alterações (auditoria central): usuário, data e antes → depois.
 * @param {{ professionalId: number|string, version: number, serviceName: (id: any) => string }} props
 */
function CommissionRulesHistory({ professionalId, version, serviceName }) {
  const [state, setState] = useState({ loading: true, error: "", rows: [] });

  // biome-ignore lint/correctness/useExhaustiveDependencies: version é o gatilho de releitura depois de salvar as regras.
  useEffect(() => {
    let active = true;
    setState((current) => ({ ...current, loading: true, error: "" }));
    (async () => {
      try {
        const response = await apiFetch(`/professionals/${professionalId}/commission-rules/history`);
        const payload = await readJson(response);
        if (!active) return;
        if (!response.ok) return setState({ loading: false, error: asObject(payload).error || "Não foi possível carregar o histórico.", rows: [] });
        setState({ loading: false, error: "", rows: historyRows(payload) });
      } catch {
        if (active) setState({ loading: false, error: "Não foi possível conectar com a API.", rows: [] });
      }
    })();
    return () => { active = false; };
  }, [professionalId, version]);

  if (state.loading) return <p className="field-hint" aria-live="polite">Carregando histórico…</p>;
  if (state.error) return <p className="form-error" role="alert">{state.error}</p>;
  if (!state.rows.length) return <p className="field-hint">Nenhuma alteração registrada.</p>;

  return (
    <ol className="commission-history" aria-label="Histórico de alterações da comissão">
      {state.rows.map((entry, index) => {
        const before = entry.before ?? entry.before_data;
        const after = entry.after ?? entry.after_data;
        const author = entry.actor_name || entry.user_name || entry.changed_by_name || entry.created_by_name || "Usuário não identificado";
        return (
          <li key={entry.id ?? `${entry.created_at}-${index}`}>
            <strong>{ACTION_LABELS[entry.action] || entry.action_label || "Alteração"}</strong>
            <span className="commission-history-meta">{formatDateTime(entry.created_at || entry.changed_at)} · {author}</span>
            <span className="commission-history-change">
              {before ? describeRuleState(before, serviceName) : "Sem regra"} → {after ? describeRuleState(after, serviceName) : "—"}
            </span>
            {entry.reason && <small className="commission-history-meta">Motivo: {entry.reason}</small>}
          </li>
        );
      })}
    </ol>
  );
}
