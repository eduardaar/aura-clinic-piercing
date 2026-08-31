const REQUIRED_BIOSAFETY_FIELDS = new Set([
  "material_lots", "sterilization_cycle", "sterilization_record", "applied_jewelry"
]);

function jsonValue(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function keyOf(value, fallback = "item") {
  const key = String(value || fallback).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
  return key || fallback;
}

export function normalizeChecklistConfig(value) {
  const rows = Array.isArray(jsonValue(value, [])) ? jsonValue(value, []) : [];
  const seen = new Set();
  return rows.slice(0, 30).map((item, index) => {
    const label = String(item?.label || "").trim().slice(0, 120);
    const key = keyOf(item?.key || label, `item_${index + 1}`);
    if (!label || seen.has(key)) return null;
    seen.add(key);
    return { key, label, required: Boolean(item?.required), enabled: item?.enabled !== false };
  }).filter(Boolean).filter((item) => item.enabled);
}

export function normalizeBiosafetyConfig(value) {
  const source = jsonValue(value, {}) || {};
  return {
    enabled: Boolean(source.enabled),
    required_fields: [...new Set((Array.isArray(source.required_fields) ? source.required_fields : [])
      .map(String).filter((field) => REQUIRED_BIOSAFETY_FIELDS.has(field)))]
  };
}

export async function getClinicOperationalSettings(db) {
  const settings = await db.get("SELECT * FROM service_operational_settings WHERE id=1");
  return {
    checklist: normalizeChecklistConfig(settings?.checklist_config),
    biosafety: normalizeBiosafetyConfig(settings?.biosafety_config)
  };
}

function override(value, fallback, normalizer) {
  return value === null || value === undefined ? fallback : normalizer(value);
}

export function resolveOperationalRequirements({ clinic = {}, service = {}, variation = null } = {}) {
  const clinicChecklist = normalizeChecklistConfig(clinic.checklist ?? clinic.checklist_config);
  const clinicBiosafety = normalizeBiosafetyConfig(clinic.biosafety ?? clinic.biosafety_config);
  const serviceChecklist = override(service.checklist_config, clinicChecklist, normalizeChecklistConfig);
  const serviceBiosafety = override(service.biosafety_config, clinicBiosafety, normalizeBiosafetyConfig);
  return {
    checklist: override(variation?.checklist_config, serviceChecklist, normalizeChecklistConfig),
    biosafety: override(variation?.biosafety_config, serviceBiosafety, normalizeBiosafetyConfig)
  };
}

export function mergeOperationalRequirements(values = []) {
  const checklist = new Map();
  const requiredFields = new Set();
  let biosafetyEnabled = false;
  for (const value of Array.isArray(values) ? values : []) {
    for (const item of normalizeChecklistConfig(value?.checklist)) {
      const existing = checklist.get(item.key);
      checklist.set(item.key, { ...item, required: Boolean(item.required || existing?.required) });
    }
    const biosafety = normalizeBiosafetyConfig(value?.biosafety);
    biosafetyEnabled ||= biosafety.enabled;
    biosafety.required_fields.forEach((field) => requiredFields.add(field));
  }
  return { checklist: [...checklist.values()], biosafety: { enabled: biosafetyEnabled, required_fields: [...requiredFields] } };
}

export function parseOperationalRequirements(value) {
  const parsed = jsonValue(value, {}) || {};
  return mergeOperationalRequirements([parsed]);
}

function normalizeMaterialLots(value) {
  return (Array.isArray(value) ? value : []).slice(0, 30).map((item) => ({
    inventory_item_id: Number(item?.inventory_item_id || 0) || null,
    inventory_item_lot_id: Number(item?.inventory_item_lot_id || 0) || null,
    batch_code: String(item?.batch_code || "").trim().slice(0, 120),
    quantity: Math.max(1, Number(item?.quantity || 1))
  })).filter((item) => item.inventory_item_id || item.inventory_item_lot_id || item.batch_code);
}

export function prepareOperationalCompletion({ requirements, checklist, biosafety, appointment, user } = {}) {
  const rules = parseOperationalRequirements(requirements);
  const submittedChecklist = Array.isArray(checklist) ? checklist : [];
  const completed = new Map(submittedChecklist.map((item) => [String(item?.key || ""), Boolean(item?.completed)]));
  const checklistSnapshot = rules.checklist.map((item) => ({
    ...item,
    completed: completed.get(item.key) || false,
    completed_at: completed.get(item.key) ? new Date().toISOString() : null,
    completed_by_user_id: completed.get(item.key) ? (user?.id || null) : null
  }));
  const missingChecklist = checklistSnapshot.filter((item) => item.required && !item.completed);
  if (missingChecklist.length) throw new Error(`Conclua o checklist obrigatório: ${missingChecklist.map((item) => item.label).join(", ")}.`);

  const source = jsonValue(biosafety, {}) || {};
  const biosafetySnapshot = rules.biosafety.enabled ? {
    enabled: true,
    material_lots: normalizeMaterialLots(source.material_lots),
    sterilization_cycle: String(source.sterilization_cycle || "").trim().slice(0, 160),
    sterilization_record: String(source.sterilization_record || "").trim().slice(0, 240),
    applied_jewelry_id: Number(source.applied_jewelry_id || 0) || null,
    applied_jewelry_variant_id: Number(source.applied_jewelry_variant_id || 0) || null,
    professional_id: appointment?.professional_id || null,
    performed_at: new Date().toISOString(),
    notes: String(source.notes || "").trim().slice(0, 2000)
  } : { enabled: false };
  const missingBiosafety = rules.biosafety.required_fields.filter((field) => {
    if (field === "material_lots") return !biosafetySnapshot.material_lots?.length;
    if (field === "applied_jewelry") return !biosafetySnapshot.applied_jewelry_id;
    return !String(biosafetySnapshot[field] || "").trim();
  });
  if (missingBiosafety.length) throw new Error(`Preencha a rastreabilidade obrigatória: ${missingBiosafety.join(", ")}.`);
  return { requirements: rules, checklistSnapshot, biosafetySnapshot };
}
