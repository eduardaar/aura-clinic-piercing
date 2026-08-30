function optionalInteger(value, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) return null;
  return number;
}

function booleanValue(value, fallback = false) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "string") return ["1", "true", "sim", "yes", "on"].includes(value.toLowerCase());
  return Boolean(value);
}

function jsonValue(value) {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return value; }
}

export function normalizePostcareDays(value, fallback = [7, 15, 30]) {
  const source = Array.isArray(jsonValue(value)) ? jsonValue(value) : String(value || "").split(/[,;\s]+/);
  const days = [...new Set(source.map((item) => optionalInteger(item, { min: 1, max: 3650 })).filter(Boolean))].sort((a, b) => a - b);
  return days.length ? days : [...fallback];
}

function inherited(service, variation, key) {
  return variation?.[key] === null || variation?.[key] === undefined ? service?.[key] : variation[key];
}

// A variação sobrescreve somente o que foi configurado. Campos nulos herdam o
// serviço e a ausência completa resulta em regras neutras, sem bloquear o fluxo.
export function resolveServiceRules(service = {}, variation = null) {
  const postcareEnabled = booleanValue(inherited(service, variation, "postcare_enabled"), false);
  return {
    service_id: optionalInteger(service.id, { min: 1 }),
    procedure_id: optionalInteger(variation?.id, { min: 1 }),
    minimum_age_years: optionalInteger(inherited(service, variation, "minimum_age_years"), { min: 0, max: 120 }),
    requires_guardian: booleanValue(inherited(service, variation, "requires_guardian"), false),
    requires_signed_term: booleanValue(inherited(service, variation, "requires_signed_term"), false),
    return_after_days: optionalInteger(inherited(service, variation, "return_after_days"), { min: 1, max: 3650 }),
    scheduling_interval_minutes: optionalInteger(inherited(service, variation, "scheduling_interval_minutes"), { min: 0, max: 1440 }) || 0,
    minimum_advance_minutes: optionalInteger(inherited(service, variation, "minimum_advance_minutes"), { min: 0, max: 525600 }) || 0,
    postcare_enabled: postcareEnabled,
    postcare_days: postcareEnabled ? normalizePostcareDays(inherited(service, variation, "postcare_days")) : [],
    available_online: booleanValue(inherited(service, variation, "available_online"), booleanValue(service.active_online_booking, true)),
    aftercare_instructions: String(inherited(service, variation, "aftercare_instructions") || "").trim() || null
  };
}

export function ageOnDate(birthDate, referenceDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(birthDate || "")) || !/^\d{4}-\d{2}-\d{2}$/.test(String(referenceDate || ""))) return null;
  const [birthYear, birthMonth, birthDay] = String(birthDate).split("-").map(Number);
  const [year, month, day] = String(referenceDate).split("-").map(Number);
  let age = year - birthYear;
  if (month < birthMonth || (month === birthMonth && day < birthDay)) age -= 1;
  return age >= 0 && age <= 120 ? age : null;
}

export function validateClientServiceRules({ rules = [], client = {}, appointmentDate, guardianProvided = false } = {}) {
  for (const rule of Array.isArray(rules) ? rules : []) {
    if (rule.minimum_age_years === null && !rule.requires_guardian) continue;
    const age = ageOnDate(client.birth_date, appointmentDate);
    if (age === null) return "Informe a data de nascimento para validar as regras do procedimento.";
    if (rule.minimum_age_years !== null && age < Number(rule.minimum_age_years)) {
      return `Este procedimento exige idade mínima de ${rule.minimum_age_years} anos.`;
    }
    const hasGuardian = Boolean(client.guardian_client_id || guardianProvided);
    if (rule.requires_guardian && age < 18 && !hasGuardian) {
      return "Este procedimento exige a identificação de um responsável legal para clientes menores de 18 anos.";
    }
  }
  return "";
}

export function validateAppointmentTimingRules({ rules = [], appointmentDate, appointmentTime, now = new Date() } = {}) {
  const requiredAdvance = Math.max(0, ...(Array.isArray(rules) ? rules : []).map((rule) => Number(rule.minimum_advance_minutes || 0)));
  if (!requiredAdvance) return "";
  const requestedAt = new Date(`${appointmentDate}T${String(appointmentTime || "").slice(0, 5)}:00`).getTime();
  if (!Number.isFinite(requestedAt)) return "Data ou horário inválido para validar a antecedência mínima.";
  if (requestedAt < now.getTime() + requiredAdvance * 60_000) {
    return `Este procedimento exige antecedência mínima de ${requiredAdvance} minutos.`;
  }
  return "";
}

export function parseServiceRulesSnapshot(value) {
  const parsed = jsonValue(value);
  return Array.isArray(parsed) ? parsed : [];
}

export async function assertCompletionServiceRules(db, appointmentId) {
  const appointment = await db.get("SELECT service_rules_snapshot FROM appointments WHERE id=?", [appointmentId]);
  const rules = parseServiceRulesSnapshot(appointment?.service_rules_snapshot);
  if (!rules.some((rule) => Boolean(rule.requires_signed_term))) return;
  const signed = await db.get("SELECT id FROM digital_terms WHERE appointment_id=? LIMIT 1", [appointmentId]);
  if (!signed) throw new Error("Este atendimento exige termo digital assinado antes da conclusão.");
}
