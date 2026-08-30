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

function text(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function digits(value) {
  return String(value ?? "").replace(/\D/g, "");
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

  if (!fullName) errors.full_name = "Informe o nome civil completo.";
  if (postalCode && postalCode.length !== 8) errors.postal_code = "Informe um CEP com 8 dígitos.";
  if (state && !BRAZIL_STATES.has(state)) errors.state = "Selecione uma UF brasileira válida.";
  if (!CONTACT_CHANNELS.has(preferredContact)) errors.preferred_contact = "Selecione um canal de contato válido.";

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
    notes: String(body.notes ?? current.notes ?? "").trim(),
  };

  return { data, errors, valid: Object.keys(errors).length === 0 };
}

export function firstClientError(errors = {}) {
  return Object.values(errors)[0] || "Revise os dados do cliente.";
}
