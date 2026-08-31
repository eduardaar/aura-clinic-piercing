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
  return <div className="soft-card stack"><strong>{title}</strong>{hint && <small>{hint}</small>}
    {items.length ? items.map((item) => <Checkbox key={item.id} label={item.name} checked={selected.map(String).includes(String(item.id))} onChange={(checked) => onChange(checked ? [...selected, item.id] : selected.filter((id) => String(id) !== String(item.id)))} />) : <small>Nenhuma opção disponível.</small>}
  </div>;
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
  return <div className="stack">
    <div className="soft-card stack"><strong>Checklist específico</strong><small>Se não personalizar, vale o padrão da clínica.</small>
      {CHECKLIST_PRESETS.map(([key, label]) => { const item = rows.find((row) => row.key === key); return <div className="form-grid" key={key}><Checkbox label={label} checked={Boolean(item)} onChange={(checked) => toggle(key, label, checked)} /><Checkbox label="Obrigatório" disabled={!item} checked={Boolean(item?.required)} onChange={(required) => onChange({ checklist: rows.map((row) => row.key === key ? { ...row, required } : row), biosafety })} /></div>; })}
      {rows.filter((row) => !CHECKLIST_PRESETS.some(([key]) => key === row.key)).map((item) => <div className="form-grid" key={item.key}><Checkbox label={item.label} checked onChange={(checked) => toggle(item.key, item.label, checked)} /><Checkbox label="Obrigatório" checked={Boolean(item.required)} onChange={(required) => onChange({ checklist: rows.map((row) => row.key === item.key ? { ...row, required } : row), biosafety })} /></div>)}
      <div className="form-grid"><Input label="Novo item" value={customLabel} onChange={setCustomLabel} /><Button variant="secondary" disabled={!customLabel.trim()} onClick={() => { onChange({ checklist: [...rows, { key: `custom_${Date.now()}`, label: customLabel.trim(), required: false }], biosafety }); setCustomLabel(""); }}>Adicionar</Button></div>
    </div>
    <div className="soft-card stack"><Switch id="service-biosafety" label="Rastreabilidade de biossegurança" description="Opcional; marque abaixo somente o que deve ser exigido." checked={Boolean(biosafety.enabled)} onChange={(enabled) => onChange({ checklist: rows, biosafety: { ...biosafety, enabled } })} />
      {biosafety.enabled && BIOSAFETY_FIELDS.map(([field, label]) => <Checkbox key={field} label={`${label} obrigatório`} checked={requiredFields.includes(field)} onChange={(checked) => onChange({ checklist: rows, biosafety: { ...biosafety, required_fields: checked ? [...requiredFields, field] : requiredFields.filter((value) => value !== field) } })} />)}
    </div>
  </div>;
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
    schemaKey: "service-v2",
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
    setForm(defaultServiceForm());
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
    const payloadToSave = { ...form, inventory_items: form.inventory_items.filter((item) => item.inventory_item_id) };
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
    setDeleting({ message: `Excluir ${item.name}? Se já estiver em uso, será arquivado para preservar o histórico.`, run: async () => {
      const response = await apiFetch(`/services/${item.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "Não foi possível excluir.");
      refresh();
    } });
  }

  async function saveSettings() {
    setSettingsMessage("");
    const response = await apiFetch("/service-operational-settings", { method: "PUT", body: JSON.stringify(settings) });
    setSettingsMessage(response.ok ? "Configuração salva." : "Não foi possível salvar.");
    if (response.ok) invalidate("/service-operational-settings");
  }

  function addMaterial() {
    setForm({ ...form, inventory_items: [...form.inventory_items, { inventory_item_id: "", quantity: 1, notes: "" }] });
  }

  return <section className="booking-admin-page stack">
    <header className="availability-header agenda-settings-header"><div><span className="eyebrow">Configuração da Agenda</span><h2>Tipos de atendimento</h2><p>Procedimento, agenda, regras clínicas e recursos em um único cadastro.</p></div></header>
    <div className="panel stack"><CrudHeader title="Checklist e biossegurança" subtitle="Padrão opcional da clínica, copiado para cada agendamento." /><OperationalEditor checklist={settings.checklist} biosafety={settings.biosafety} onChange={setSettings} /><div className="toolbar"><Button onClick={saveSettings}>Salvar padrão</Button>{settingsMessage && <small>{settingsMessage}</small>}</div></div>
    <div className="panel"><CrudHeader title="Procedimentos e tipos de atendimento" subtitle="Fonte única usada na Agenda, execução, estoque e agendamento online." actionLabel="Novo tipo de atendimento" onAction={openNew} />
      <DataView rows={services} defaultSort={{ key: "name", dir: "asc" }} searchPlaceholder="Buscar por nome, categoria ou região" filters={[{ key: "category", label: "Categoria", type: "select", options: CATEGORIES.map((value) => ({ value, label: value })) }]} columns={[
        { key: "name", label: "Atendimento", value: (item) => `${item.name} ${item.category} ${item.body_area}`, render: (item) => <><strong>{item.name}</strong><br /><small>{item.category || "Sem categoria"}{item.body_area ? ` · ${item.body_area}` : ""}</small></> },
        { key: "duration_minutes", label: "Duração", render: (item) => `${item.duration_minutes || 0} min` },
        { key: "price", label: "Preço", value: (item) => asNumber(item.price), render: (item) => currency.format(item.price || 0) },
        { key: "deposit_value", label: "Sinal", render: (item) => currency.format(item.deposit_value || 0) },
        { key: "is_active", label: "Status", render: (item) => <StatusBadge status={Boolean(Number(item.is_active)) ? "Ativo" : "Inativo"} /> }
      ]} actions={(item) => <RowActions actions={[{ label: "Editar cadastro", primary: true, onClick: () => openEdit(item) }, { label: "Excluir", danger: true, onClick: () => remove(item) }]} />} empty="Cadastre o primeiro tipo de atendimento para liberar a Agenda." />
    </div>

    <Modal open={modalOpen} title={editingId ? "Editar tipo de atendimento" : "Novo tipo de atendimento"} subtitle="Cadastro único do procedimento" size="lg" onClose={closeForm} footer={<><Button variant="secondary" onClick={closeForm}>Cancelar</Button><Button type="submit" form="service-form">Salvar</Button></>}>
      <FormWorkflow as="form" id="service-form" className="stack" mobileFullscreen title="Tipo de atendimento" description="Dados principais primeiro; regras e operação ficam em seções opcionais." draft={draft} actions={draft.hasDraft ? <><Button type="button" variant="secondary" onClick={draft.restoreDraft}>Restaurar</Button><Button type="button" variant="ghost" onClick={draft.discardDraft}>Descartar</Button></> : null} onSubmit={save}>
        <ValidationSummary errors={error ? [error] : []} />
        <FormSection title="Informações principais" badge="Essencial">
        <div className="form-grid"><Select label="Categoria" value={form.category} onChange={(category) => setForm({ ...form, category })}>{CATEGORIES.map((item) => <option key={item}>{item}</option>)}</Select><Input label="Nome" value={form.name} onChange={(name) => setForm({ ...form, name })} required /><Input label="Região do corpo" value={form.body_area} onChange={(body_area) => setForm({ ...form, body_area })} /><Input type="number" min="1" label="Duração (min)" value={form.duration_minutes} onChange={(duration_minutes) => setForm({ ...form, duration_minutes })} /><Input type="number" min="0" label="Preço" value={form.base_price} onChange={(base_price) => setForm({ ...form, base_price })} /><Input type="number" min="0" label="Sinal" value={form.deposit_value} onChange={(deposit_value) => setForm({ ...form, deposit_value })} /></div>
        <Textarea label="Descrição" value={form.description} onChange={(description) => setForm({ ...form, description })} />
        </FormSection>
        <AdvancedFields title="Regras e orientações" description="Idade, responsável, termo, retornos e comunicação pós-atendimento.">
        <Textarea label="Orientações pré-atendimento" value={form.pre_service_notes} onChange={(pre_service_notes) => setForm({ ...form, pre_service_notes })} />
        <div className="form-grid"><Input type="number" min="0" max="120" label="Idade mínima" value={form.minimum_age_years} onChange={(minimum_age_years) => setForm({ ...form, minimum_age_years })} /><Input type="number" min="1" label="Retorno após dias" value={form.return_after_days} onChange={(return_after_days) => setForm({ ...form, return_after_days })} /><Input type="number" min="0" label="Intervalo após atendimento (min)" value={form.scheduling_interval_minutes} onChange={(scheduling_interval_minutes) => setForm({ ...form, scheduling_interval_minutes })} /><Input type="number" min="0" label="Antecedência mínima (min)" value={form.minimum_advance_minutes} onChange={(minimum_advance_minutes) => setForm({ ...form, minimum_advance_minutes })} /></div>
        <div className="chip-toggle-grid"><Switch id="type-guardian" label="Exigir responsável para menor" description="" checked={form.requires_guardian} onChange={(requires_guardian) => setForm({ ...form, requires_guardian })} /><Switch id="type-term" label="Exigir termo assinado" description="" checked={form.requires_signed_term} onChange={(requires_signed_term) => setForm({ ...form, requires_signed_term })} /><Switch id="type-postcare" label="Gerar pós-atendimento" description="" checked={form.postcare_enabled} onChange={(postcare_enabled) => setForm({ ...form, postcare_enabled })} /><Switch id="type-online" label="Disponível online" description="" checked={form.active_online_booking} onChange={(active_online_booking) => setForm({ ...form, active_online_booking })} /><Switch id="type-active" label="Ativo" description="" checked={form.is_active} onChange={(is_active) => setForm({ ...form, is_active })} /></div>
        {form.postcare_enabled && <><Input label="Dias do pós-atendimento" value={form.postcare_days} onChange={(postcare_days) => setForm({ ...form, postcare_days })} placeholder="7, 15, 30" /><Textarea label="Orientações pós-atendimento" value={form.aftercare_instructions} onChange={(aftercare_instructions) => setForm({ ...form, aftercare_instructions })} /></>}
        </AdvancedFields>
        <AdvancedFields title="Equipe, estoque e operação" description="Profissionais habilitados, materiais, joias, checklist e biossegurança.">
        <ToggleList title="Profissionais habilitados" hint="Somente profissionais marcados poderão ser escolhidos." items={professionals} selected={form.professional_ids} onChange={(professional_ids) => setForm({ ...form, professional_ids })} />
        <div className="soft-card stack"><div className="section-inline-header"><strong>Materiais previstos</strong><Button variant="secondary" onClick={addMaterial}>Adicionar material</Button></div><small>A ficha técnica baixa o estoque quando o atendimento é concluído.</small>{form.inventory_items.map((material, index) => <div className="form-grid" key={index}><Select label="Item de estoque" value={material.inventory_item_id} onChange={(inventory_item_id) => setForm({ ...form, inventory_items: form.inventory_items.map((row, rowIndex) => rowIndex === index ? { ...row, inventory_item_id } : row) })}><option value="">Selecione</option>{inventoryItems.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select><Input type="number" min="1" label="Quantidade" value={material.quantity} onChange={(quantity) => setForm({ ...form, inventory_items: form.inventory_items.map((row, rowIndex) => rowIndex === index ? { ...row, quantity } : row) })} /><Input label="Observação" value={material.notes} onChange={(notes) => setForm({ ...form, inventory_items: form.inventory_items.map((row, rowIndex) => rowIndex === index ? { ...row, notes } : row) })} /><Button variant="secondary" onClick={() => setForm({ ...form, inventory_items: form.inventory_items.filter((_, rowIndex) => rowIndex !== index) })}>Remover</Button></div>)}</div>
        <ToggleList title="Joias compatíveis" hint="Opcional: restringe a seleção às joias adequadas para este atendimento." items={compatibleItems} selected={form.compatible_jewelry_ids} onChange={(compatible_jewelry_ids) => setForm({ ...form, compatible_jewelry_ids })} />
        <Switch id="type-operational" label="Personalizar checklist e biossegurança deste atendimento" description="Desativado: usa o padrão da clínica." checked={form.checklist_config !== null || form.biosafety_config !== null} onChange={(checked) => setForm({ ...form, checklist_config: checked ? [] : null, biosafety_config: checked ? { enabled: false, required_fields: [] } : null })} />
        {(form.checklist_config !== null || form.biosafety_config !== null) && <OperationalEditor checklist={form.checklist_config || []} biosafety={form.biosafety_config || { enabled: false, required_fields: [] }} onChange={({ checklist, biosafety }) => setForm({ ...form, checklist_config: checklist, biosafety_config: biosafety })} />}
        </AdvancedFields>
      </FormWorkflow>
    </Modal>
    <ConfirmDeleteModal open={Boolean(deleting)} message={deleting?.message} onClose={() => setDeleting(null)} onConfirm={async () => { await deleting.run(); setDeleting(null); }} />
  </section>;
}
