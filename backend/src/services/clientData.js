import { parseTaxId } from "./taxId.js";

const BRAZIL_STATES = new Set([
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
]);
const CONTACT_CHANNELS = new Set(["whatsapp", "email", "phone"]);
const CLIENT_STATUSES = new Set(["active", "inactive", "blocked"]);

function text(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function digits(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function boolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return Boolean(fallback);
  return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
}

function tags(value) {
  const entries = Array.isArray(value) ? value : String(value ?? "").split(",");
  return [...new Set(entries.map((entry) => text(entry).toLowerCase()).filter(Boolean))].slice(0, 30);
}

function optionalId(value, field, errors) {
  if (value === undefined || value === null || value === "") return null;
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) errors[field] = "Selecione um cliente válido.";
  return Number.isInteger(id) && id > 0 ? id : null;
}

function brazilianPhone(value, field, errors, required = false) {
  let normalized = digits(value);
  if (normalized.startsWith("55") && [12, 13].includes(normalized.length)) normalized = normalized.slice(2);
  if (!normalized) {
    if (required) errors[field] = "Informe o WhatsApp com DDD.";
    return "";
  }
  if (![10, 11].includes(normalized.length)) {
    errors[field] = "Informe DDD e telefone no padrão brasileiro.";
  }
  return normalized;
}

function emailAddress(value, errors) {
  const normalized = text(value).toLowerCase().replace(/\s/g, "");
  if (normalized && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
    errors.email = "Informe um e-mail válido.";
  }
  return normalized;
}

function birthDate(value, errors) {
  const normalized = text(value);
  if (!normalized) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (!match) {
    errors.birth_date = "Informe a data de nascimento completa.";
    return normalized;
  }
  const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== Number(match[1]) ||
    parsed.getUTCMonth() !== Number(match[2]) - 1 ||
    parsed.getUTCDate() !== Number(match[3]) ||
    parsed.getTime() > Date.now()
  ) {
    errors.birth_date = "Informe uma data de nascimento válida.";
  }
  return normalized;
}

function cpf(value, errors) {
  const normalized = digits(value);
  if (!normalized) return "";
  const parsed = parseTaxId(normalized);
  if (!parsed.ok || parsed.type !== "CPF") errors.cpf = "Informe um CPF válido.";
  return normalized;
}

function instagram(value, errors) {
  const username = text(value).replace(/^@+/, "");
  if (!username) return "";
  if (!/^[a-zA-Z0-9._]{1,30}$/.test(username)) errors.instagram = "Informe somente o usuário do Instagram.";
  return `@${username.toLowerCase()}`;
}

/**
 * Fonte única da normalização do cadastro administrativo de clientes.
 * Campos vazios opcionais são aceitos; nome e WhatsApp continuam obrigatórios.
 */
export function normalizeClientData(body = {}, current = {}) {
  const errors = {};
  const rawName = body.full_name ?? body.name ?? current.full_name ?? "";
  const rawWhatsapp = body.whatsapp ?? current.whatsapp ?? body.phone ?? "";
  const rawCpf = body.cpf ?? body.tax_id ?? current.cpf ?? current.tax_id ?? "";
  const preferredContact = text(body.preferred_contact ?? current.preferred_contact ?? "whatsapp").toLowerCase();
  const postalCode = digits(body.postal_code ?? body.cep ?? current.postal_code ?? "");
  const state = text(body.state ?? body.uf ?? current.state ?? "").toUpperCase();
  const fullName = text(rawName);
  const lifecycleStatus = text(body.lifecycle_status ?? current.lifecycle_status ?? "active").toLowerCase();

  if (!fullName) errors.full_name = "Informe o nome civil completo.";
  if (postalCode && postalCode.length !== 8) errors.postal_code = "Informe um CEP com 8 dígitos.";
  if (state && !BRAZIL_STATES.has(state)) errors.state = "Selecione uma UF brasileira válida.";
  if (!CONTACT_CHANNELS.has(preferredContact)) errors.preferred_contact = "Selecione um canal de contato válido.";
  if (!CLIENT_STATUSES.has(lifecycleStatus)) errors.lifecycle_status = "Selecione um status válido.";

  const data = {
    full_name: fullName,
    social_name: text(body.social_name ?? current.social_name ?? ""),
    phone: brazilianPhone(body.phone ?? current.phone ?? "", "phone", errors),
    whatsapp: brazilianPhone(rawWhatsapp, "whatsapp", errors, true),
    instagram: instagram(body.instagram ?? current.instagram ?? "", errors),
    email: emailAddress(body.email ?? current.email ?? "", errors),
    birth_date: birthDate(body.birth_date ?? body.birthday ?? body.birthDate ?? current.birth_date ?? "", errors),
    cpf: cpf(rawCpf, errors),
    preferred_contact: preferredContact,
    postal_code: postalCode,
    address_line: text(body.address_line ?? body.street ?? current.address_line ?? ""),
    address_number: text(body.address_number ?? current.address_number ?? ""),
    address_complement: text(body.address_complement ?? current.address_complement ?? ""),
    neighborhood: text(body.neighborhood ?? current.neighborhood ?? ""),
    city: text(body.city ?? current.city ?? ""),
    state,
    acquisition_source: text(body.acquisition_source ?? current.acquisition_source ?? ""),
    referred_by_client_id: optionalId(body.referred_by_client_id ?? current.referred_by_client_id, "referred_by_client_id", errors),
    tags: tags(body.tags ?? current.tags ?? []),
    lifecycle_status: lifecycleStatus,
    blocked_reason: lifecycleStatus === "blocked" ? text(body.blocked_reason ?? current.blocked_reason ?? "") : "",
    operational_consent: boolean(body.operational_consent, current.operational_consent),
    marketing_consent: boolean(body.marketing_consent, current.marketing_consent),
    emergency_contact_name: text(body.emergency_contact_name ?? current.emergency_contact_name ?? ""),
    emergency_contact_phone: brazilianPhone(body.emergency_contact_phone ?? current.emergency_contact_phone ?? "", "emergency_contact_phone", errors),
    guardian_client_id: optionalId(body.guardian_client_id ?? current.guardian_client_id, "guardian_client_id", errors),
    guardian_relationship: text(body.guardian_relationship ?? current.guardian_relationship ?? ""),
    notes: String(body.notes ?? current.notes ?? "").trim(),
  };

  return { data, errors, valid: Object.keys(errors).length === 0 };
}

export function firstClientError(errors = {}) {
  return Object.values(errors)[0] || "Revise os dados do cliente.";
}
