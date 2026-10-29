import { ProcedureKitEditor } from "./ProcedureKitEditor";
import { ServiceImageField, ServiceInfoSectionsEditor, ServicePresentationPreview, ShortDescriptionField, servicePresentationPayload, withColumnSections } from "./ServicePresentationEditor";
import { useEffect, useState } from "react";
import { Button, Checkbox, Input, Select, StatusBadge, Switch, Textarea } from "../../components/common/Ui";
import { ConfirmDeleteModal, CrudHeader, Modal, RowActions } from "../../components/common/Crud";
import { DataView } from "../../components/common/DataView";
import { Loading } from "../../components/common/Feedback";
import { AdvancedFields, FormSection, FormWorkflow, ValidationSummary } from "../../components/common/FormWorkflow";
import { apiFetch, readStoredSession, tenantSlug, useApiInvalidate, useFetch } from "../../lib/api";
import { defaultServiceForm } from "../../lib/defaultForms";
import { useFormDraft } from "../../lib/useFormDraft";
import { asArray, asNumber, asObject } from "../../lib/utils";
import { currency } from "../shared/helpers";
import { editableInfoSections } from "../../lib/servicePresentation";

const CATEGORIES = ["Piercing", "Avaliação", "Retorno", "Troca de joia", "Manutenção", "Outro"];
const CHECKLIST_PRESETS = [
  ["client_registration_checked", "Cadastro do cliente conferido"],
  ["digital_term_signed", "Termo digital conferido"],
  ["guardian_validated", "Responsável legal validado"],
  ["jewelry_checked", "Joia conferida"],
  ["materials_prepared", "Materiais separados"],
  ["guidance_delivered", "Orientações entregues"]
];
const BIOSAFETY_FIELDS = [
  ["material_lots", "Lotes dos materiais"],
  ["sterilization_cycle", "Ciclo de esterilização"],
  ["sterilization_record", "Registro de esterilização"],
  ["applied_jewelry", "Joia aplicada"]
];

function rowsOf(value) {
  return asArray(value).length ? asArray(value) : asArray(asObject(value).items);
}

function jsonValue(value, fallback) {
  if (value == null || value === "") return fallback;
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function dayList(value) {
  const parsed = jsonValue(value, value);
  return Array.isArray(parsed) ? parsed.join(", ") : String(parsed || "");
}

function ToggleList({ title, hint, items, selected, onChange }) {
  return (
    <div className="soft-card stack"><strong>{title}</strong>{hint && <small>{hint}</small>}
    {items.length ? (
        items.map((item) => (
          <Checkbox key={item.id} label={item.name} checked={selected.map(String).includes(String(item.id))} onChange={(checked) => onChange(checked ? [...selected, item.id] : selected.filter((id) => String(id) !== String(item.id)))} />))
      ) : (
        <small>Nenhuma opção disponível.</small>
      )}
  </div>
  );
}

/** @param {{ checklist?: any[], biosafety?: Record<string, any>, onChange?: (...args: any[]) => any }} props */
function OperationalEditor({ checklist = [], biosafety = {}, onChange }) {
  const rows = Array.isArray(checklist) ? checklist : [];
  const requiredFields = asArray(biosafety.required_fields);
  const [customLabel, setCustomLabel] = useState("");
  const toggle = (key, label, enabled) => {
    const current = rows.find((item) => item.key === key);
    onChange({ checklist: enabled ? [...rows.filter((item) => item.key !== key), current || { key, label, required: false }] : rows.filter((item) => item.key !== key), biosafety });
  };
  return (
    <div className="stack">
    <div className="soft-card stack"><strong>Checklist específico</strong><small>Se não personalizar, vale o padrão da clínica.</small>
      {CHECKLIST_PRESETS.map(([key, label]) => { const item = rows.find((row) => row.key === key); return (
            <div className="form-grid" key={key}><Checkbox label={label} checked={Boolean(item)} onChange={(checked) => toggle(key, label, checked)} /><Checkbox label="Obrigatório" disabled={!item} checked={Boolean(item?.required)} onChange={(required) => onChange({ checklist: rows.map((row) => (row.key === key ? { ...row, required } : row)), biosafety })} /></div>
          ); })}
      {rows.filter((row) => !CHECKLIST_PRESETS.some(([key]) => key === row.key)).map((item) => (
            <div className="form-grid" key={item.key}><Checkbox label={item.label} checked onChange={(checked) => toggle(item.key, item.label, checked)} /><Checkbox label="Obrigatório" checked={Boolean(item.required)} onChange={(required) => onChange({ checklist: rows.map((row) => (row.key === item.key ? { ...row, required } : row)), biosafety })} /></div>))}
      <div className="form-grid"><Input label="Novo item" value={customLabel} onChange={setCustomLabel} /><Button variant="secondary" disabled={!customLabel.trim()} onClick={() => { onChange({ checklist: [...rows, { key: `custom_${Date.now()}`, label: customLabel.trim(), required: false }], biosafety }); setCustomLabel(""); }}>Adicionar</Button></div>
    </div>
    <div className="soft-card stack"><Switch id="service-biosafety" label="Rastreabilidade de biossegurança" description="Opcional; marque abaixo somente o que deve ser exigido." checked={Boolean(biosafety.enabled)} onChange={(enabled) => onChange({ checklist: rows, biosafety: { ...biosafety, enabled } })} />
      {biosafety.enabled && BIOSAFETY_FIELDS.map(([field, label]) => (
            <Checkbox key={field} label={`${label} obrigatório`} checked={requiredFields.includes(field)} onChange={(checked) => onChange({ checklist: rows, biosafety: { ...biosafety, required_fields: checked ? [...requiredFields, field] : requiredFields.filter((value) => value !== field) } })} />))}
    </div>
  </div>
  );
}

export function ServicesWorkspace() {
  const { data: servicesData } = useFetch("/services");
  const { data: optionsData } = useFetch("/service-catalog-options");
  const { data: settingsData } = useFetch("/service-operational-settings");
  const invalidate = useApiInvalidate();
  const [form, setForm] = useState(defaultServiceForm());
  const [editingId, setEditingId] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(null);
  const [settings, setSettings] = useState({ checklist: [], biosafety: { enabled: false, required_fields: [] } });
  const [settingsMessage, setSettingsMessage] = useState("");
  const sessionUser = readStoredSession()?.user || {};
  const draft = useFormDraft({
    tenantId: tenantSlug() || "tenant",
    userId: sessionUser.id || "user",
    formId: editingId ? `service-${editingId}` : "service-new",
    // v3: apresentação do agendamento online (info_sections). Rascunhos v2 não
    // têm as seções e não são restaurados.
    schemaKey: "service-v3",
    value: form,
    onRestore: setForm,
    enabled: modalOpen
  });

  useEffect(() => {
    if (settingsData) setSettings({ checklist: jsonValue(settingsData.checklist, []), biosafety: jsonValue(settingsData.biosafety, { enabled: false, required_fields: [] }) });
  }, [settingsData]);

  if (servicesData == null || optionsData == null || settingsData == null) return <Loading />;
  const services = rowsOf(servicesData);
  const options = asObject(optionsData);
  const professionals = asArray(options.professionals);
  const inventoryItems = asArray(options.inventoryItems);
  const compatibleItems = inventoryItems.filter((item) => Boolean(item.can_sell));
  const refresh = () => invalidate("/services", "/options", "/booking/config", "/booking/readiness");

  function openNew() {
    setEditingId(null);
    setForm({ ...defaultServiceForm(), info_sections: withColumnSections([]) });
    setError("");
    setModalOpen(true);
  }

  function openEdit(item) {
    setEditingId(item.id);
    setForm({
      ...defaultServiceForm(), ...item,
      category: item.category || "Piercing",
      body_area: item.body_area || "",
      base_price: item.base_price ?? item.price ?? 0,
      postcare_days: dayList(item.postcare_days) || "7, 15, 30",
      is_active: Boolean(Number(item.is_active)),
      active_online_booking: Boolean(Number(item.active_online_booking)),
      requires_guardian: Boolean(Number(item.requires_guardian)),
      requires_signed_term: Boolean(Number(item.requires_signed_term)),
      postcare_enabled: Boolean(Number(item.postcare_enabled)),
      short_description: item.short_description || "",
      image_url: item.image_url || "",
      image_alt: item.image_alt || "",
      requires_evaluation: Boolean(item.requires_evaluation),
      requires_acknowledgement: Boolean(item.requires_acknowledgement),
      info_sections: withColumnSections(editableInfoSections(item)),
      professional_ids: asArray(item.professional_ids),
      inventory_items: asArray(item.inventory_items),
      compatible_jewelry_ids: asArray(item.compatible_jewelry_ids),
      checklist_config: item.checklist_config == null ? null : jsonValue(item.checklist_config, []),
      biosafety_config: item.biosafety_config == null ? null : jsonValue(item.biosafety_config, { enabled: false, required_fields: [] })
    });
    setError("");
    setModalOpen(true);
  }

  async function save(event) {
    event.preventDefault();
    if (!form.name.trim()) return setError("Informe o nome do tipo de atendimento.");
    if (Number(form.base_price || 0) < 0 || Number(form.deposit_value || 0) < 0) return setError("Preço e sinal não podem ser negativos.");
    if (Number(form.duration_minutes || 0) <= 0) return setError("Informe uma duração válida.");
    const payloadToSave = { ...servicePresentationPayload(form), inventory_items: form.inventory_items.filter((item) => item.inventory_item_id) };
    const response = await apiFetch(editingId ? `/services/${editingId}` : "/services", { method: editingId ? "PUT" : "POST", body: JSON.stringify(payloadToSave) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return setError(payload.error || "Não foi possível salvar o tipo de atendimento.");
    draft.clearDraft();
    setModalOpen(false);
    refresh();
  }

  function closeForm() {
    draft.flushDraft();
    setModalOpen(false);
  }

  function remove(item) {
    setError("");
    setDeleting({ message: `Excluir permanentemente ${item.name}? Esta ação não pode ser desfeita. Cadastros com histórico vinculado precisam ser desativados.`, run: async () => {
      const response = await apiFetch(`/services/${item.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "Não foi possível excluir.");
      refresh();
    } });
  }

  async function toggleActive(item) {
    setError("");
    try {
    const response = await apiFetch(`/services/${item.id}`, { method: "PATCH", body: JSON.stringify({ is_active: !Boolean(Number(item.is_active)) }) });
    if (!response.ok) return setError((await response.json().catch(() => ({}))).error || "Não foi possível alterar o status.");
    refresh();
    } catch {
      setError("Não foi possível alterar o status. Tente novamente.");
    }
  }

  async function saveSettings() {
    setSettingsMessage("");
    const response = await apiFetch("/service-operational-settings", { method: "PUT", body: JSON.stringify(settings) });
    setSettingsMessage(response.ok ? "Configuração salva." : "Não foi possível salvar.");
    if (response.ok) invalidate("/service-operational-settings");
  }

  return (
    <section className="booking-admin-page stack">
    <header className="availability-header agenda-settings-header"><div><span className="eyebrow">Configuração da Agenda</span><h2>Tipos de atendimento</h2><p>Procedimento, agenda, regras clínicas e recursos em um único cadastro.</p></div></header>
    {error && !modalOpen && !deleting && <p role="alert" className="form-error">{error}</p>}
    <div className="panel stack"><CrudHeader title="Checklist e biossegurança" subtitle="Padrão opcional da clínica, copiado para cada agendamento." /><OperationalEditor checklist={settings.checklist} biosafety={settings.biosafety} onChange={setSettings} /><div className="toolbar"><Button onClick={saveSettings}>Salvar padrão</Button>{settingsMessage && <small>{settingsMessage}</small>}</div></div>
    <div className="panel"><CrudHeader title="Procedimentos e tipos de atendimento" subtitle="Fonte única usada na Agenda, execução, estoque e agendamento online." actionLabel="Novo tipo de atendimento" onAction={openNew} />
      <DataView rows={services} defaultSort={{ key: "name", dir: "asc" }} searchPlaceholder="Buscar por nome, categoria ou região" filters={[{ key: "category", label: "Categoria", type: "select", options: CATEGORIES.map((value) => ({ value, label: value })) }]} columns={[
        { key: "name", label: "Atendimento", value: (item) => `${item.name} ${item.category} ${item.body_area}`, render: (item) => (
                <><strong>{item.name}</strong><br /><small>{item.category || "Sem categoria"}{item.body_area ? ` · ${item.body_area}` : ""}</small></>
              ),
            },
        { key: "duration_minutes", label: "Duração", render: (item) => `${item.duration_minutes || 0} min` },
        { key: "price", label: "Preço", value: (item) => asNumber(item.price), render: (item) => currency.format(item.price || 0) },
        { key: "deposit_value", label: "Sinal", render: (item) => currency.format(item.deposit_value || 0) },
        { key: "is_active", label: "Status", render: (item) => <StatusBadge status={Boolean(Number(item.is_active)) ? "Ativo" : "Inativo"} /> }
      ]} actions={(item) => (
            <RowActions actions={[{ label: "Editar cadastro", primary: true, onClick: () => openEdit(item) }, { label: Boolean(Number(item.is_active)) ? "Desativar" : "Ativar", onClick: () => toggleActive(item) }, sessionUser.role === "admin" ? { label: "Excluir permanentemente", danger: true, onClick: () => remove(item) } : null]} />
          )} empty="Cadastre o primeiro tipo de atendimento para liberar a Agenda." />
    </div>

    <Modal open={modalOpen} title={editingId ? "Editar tipo de atendimento" : "Novo tipo de atendimento"} subtitle="Cadastro único do procedimento" size="lg" onClose={closeForm} footer={<><Button variant="secondary" onClick={closeForm}>Cancelar</Button><Button type="submit" form="service-form">Salvar</Button></>}>
      <FormWorkflow as="form" id="service-form" className="stack" mobileFullscreen title="Tipo de atendimento" description="Dados principais primeiro; regras e operação ficam em seções opcionais." draft={draft} actions={draft.hasDraft ? (
              <><Button type="button" variant="secondary" onClick={draft.restoreDraft}>Restaurar</Button><Button type="button" variant="ghost" onClick={draft.discardDraft}>Descartar</Button></>
            ) : null} onSubmit={save}>
        <ValidationSummary errors={error ? [error] : []} />
        <FormSection title="Informações principais" badge="Essencial">
        <div className="form-grid"><Select label="Categoria" value={form.category} onChange={(category) => setForm({ ...form, category })}>{CATEGORIES.map((item) => (
                  <option key={item}>{item}</option>))}</Select><Input label="Nome" value={form.name} onChange={(name) => setForm({ ...form, name })} required /><Input label="Região do corpo" value={form.body_area} onChange={(body_area) => setForm({ ...form, body_area })} /><Input type="number" min="1" label="Duração (min)" value={form.duration_minutes} onChange={(duration_minutes) => setForm({ ...form, duration_minutes })} /><Input type="number" min="0" step="0.01" inputMode="decimal" label="Preço" value={form.base_price} onChange={(base_price) => setForm({ ...form, base_price })} /><Input type="number" min="0" step="0.01" inputMode="decimal" label="Sinal" value={form.deposit_value} onChange={(deposit_value) => setForm({ ...form, deposit_value })} /></div>
        <Textarea label="Descrição completa" value={form.description} onChange={(description) => setForm({ ...form, description })} />
        <small className="field-hint">Aparece na etapa final do agendamento online, em "Sobre o procedimento". O cartão usa a descrição curta abaixo.</small>
        </FormSection>
        <FormSection title="Apresentação no agendamento online" badge="Online">
        <ServiceImageField form={form} onChange={(patch) => setForm({ ...form, ...patch })} />
        <ShortDescriptionField value={form.short_description} onChange={(short_description) => setForm({ ...form, short_description })} />
        <div className="chip-toggle-grid"><Switch id="type-evaluation" label="Exige avaliação prévia" description="Informado ao cliente nas informações completas." checked={form.requires_evaluation} onChange={(requires_evaluation) => setForm({ ...form, requires_evaluation })} /><Switch id="type-acknowledgement" label="Exigir confirmação de leitura" description="O cliente confirma que leu as informações antes de enviar. Não substitui o termo assinado." checked={form.requires_acknowledgement} onChange={(requires_acknowledgement) => setForm({ ...form, requires_acknowledgement })} /></div>
        </FormSection>
        <AdvancedFields title="Informações completas para o cliente" description="Seções exibidas na etapa final do agendamento online, na ordem abaixo. Seções vazias não aparecem.">
        <ServiceInfoSectionsEditor sections={form.info_sections || []} onChange={(info_sections) => setForm({ ...form, info_sections })} />
        </AdvancedFields>
        <AdvancedFields title="Pré-visualização" description="Cartão público e apresentação completa, como o cliente verá.">
        <ServicePresentationPreview form={form} />
        </AdvancedFields>
        <AdvancedFields title="Regras e orientações" description="Idade, responsável, termo, retornos e comunicação pós-atendimento. Os textos de orientação ficam nas informações completas.">
        <div className="form-grid"><Input type="number" min="0" max="120" label="Idade mínima" value={form.minimum_age_years} onChange={(minimum_age_years) => setForm({ ...form, minimum_age_years })} /><Input type="number" min="1" label="Retorno após dias" value={form.return_after_days} onChange={(return_after_days) => setForm({ ...form, return_after_days })} /><Input type="number" min="0" label="Intervalo após atendimento (min)" value={form.scheduling_interval_minutes} onChange={(scheduling_interval_minutes) => setForm({ ...form, scheduling_interval_minutes })} /><Input type="number" min="0" label="Antecedência mínima (min)" value={form.minimum_advance_minutes} onChange={(minimum_advance_minutes) => setForm({ ...form, minimum_advance_minutes })} /></div>
        <div className="chip-toggle-grid"><Switch id="type-guardian" label="Exigir responsável para menor" description="" checked={form.requires_guardian} onChange={(requires_guardian) => setForm({ ...form, requires_guardian })} /><Switch id="type-term" label="Exigir termo assinado" description="" checked={form.requires_signed_term} onChange={(requires_signed_term) => setForm({ ...form, requires_signed_term })} /><Switch id="type-postcare" label="Gerar pós-atendimento" description="" checked={form.postcare_enabled} onChange={(postcare_enabled) => setForm({ ...form, postcare_enabled })} /><Switch id="type-online" label="Disponível online" description="" checked={form.active_online_booking} onChange={(active_online_booking) => setForm({ ...form, active_online_booking })} /><Switch id="type-active" label="Ativo" description="" checked={form.is_active} onChange={(is_active) => setForm({ ...form, is_active })} /></div>
        {form.postcare_enabled && (
              <><Input label="Dias do pós-atendimento" value={form.postcare_days} onChange={(postcare_days) => setForm({ ...form, postcare_days })} placeholder="7, 15, 30" /><small className="field-hint">As orientações enviadas no pós-atendimento ficam em "Informações completas para o cliente › Cuidados após o atendimento".</small></>
            )}
        </AdvancedFields>
        <AdvancedFields title="Equipe, estoque e operação" description="Profissionais habilitados, materiais, joias, checklist e biossegurança.">
        <ToggleList title="Profissionais habilitados" hint="Somente profissionais marcados poderão ser escolhidos." items={professionals} selected={form.professional_ids} onChange={(professional_ids) => setForm({ ...form, professional_ids })} />
        <ProcedureKitEditor
              items={form.inventory_items}
              inventoryItems={inventoryItems}
              name={form.inventory_kit_name || ""}
              onNameChange={(inventory_kit_name) => setForm({ ...form, inventory_kit_name })}
              onChange={(inventory_items) => setForm({ ...form, inventory_items })}
            /><ToggleList title="Joias compatíveis" hint="Opcional: restringe a seleção às joias adequadas para este atendimento." items={compatibleItems} selected={form.compatible_jewelry_ids} onChange={(compatible_jewelry_ids) => setForm({ ...form, compatible_jewelry_ids })} />
        <Switch id="type-operational" label="Personalizar checklist e biossegurança deste atendimento" description="Desativado: usa o padrão da clínica." checked={form.checklist_config !== null || form.biosafety_config !== null} onChange={(checked) => setForm({ ...form, checklist_config: checked ? [] : null, biosafety_config: checked ? { enabled: false, required_fields: [] } : null })} />
        {(form.checklist_config !== null || form.biosafety_config !== null) && (
              <OperationalEditor checklist={form.checklist_config || []} biosafety={form.biosafety_config || { enabled: false, required_fields: [] }} onChange={({ checklist, biosafety }) => setForm({ ...form, checklist_config: checklist, biosafety_config: biosafety })} />
            )}
        </AdvancedFields>
      </FormWorkflow>
    </Modal>
    <ConfirmDeleteModal open={Boolean(deleting)} message={<>{deleting?.message}{error && <span role="alert" className="form-error">{error}</span>}</>} onClose={() => setDeleting(null)} onConfirm={async () => { try { await deleting.run(); setDeleting(null); } catch (failure) { setError(failure.message); } }} />
  </section>
  );
}
