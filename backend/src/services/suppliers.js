import { parseTaxId } from "./taxId.js";
import { normalizeWhatsappNumber } from "./notifications.js";

const PERSON_TYPES = new Set(["PF", "PJ"]);
const QUALITY_STATUSES = new Set(["approved", "review", "blocked"]);
const BRAZILIAN_STATES = new Set([
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"
]);

export class SupplierValidationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "SupplierValidationError";
    this.status = status;
  }
}

function text(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function optionalInteger(value, field, fallback = null) {
  if (value === undefined) return fallback;
  if (value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 3650) {
    throw new SupplierValidationError(`${field} deve ser um número inteiro entre 0 e 3650.`);
  }
  return parsed;
}

function optionalMoney(value, field, fallback = null) {
  if (value === undefined) return fallback;
  if (value === null || value === "") return null;
  const parsed = Number(String(value).replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 9999999999) {
    throw new SupplierValidationError(`${field} deve ser um valor positivo válido.`);
  }
  return Math.round(parsed * 100) / 100;
}

export function normalizeSupplierList(value, fallback = []) {
  if (value === undefined) return Array.isArray(fallback) ? fallback : [];
  const source = Array.isArray(value) ? value : String(value || "").split(/[,;\n]/);
  return [...new Set(source.map((item) => text(item)).filter(Boolean))].slice(0, 50);
}

function normalizeEmail(value, fallback = "") {
  const email = text(value, fallback).replace(/\s/g, "").toLowerCase();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new SupplierValidationError("Informe um e-mail válido.");
  }
  return email;
}

function normalizePhone(value, field, fallback = "") {
  const digits = text(value, fallback).replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  if (digits && !/^\d{10,11}$/.test(digits)) {
    throw new SupplierValidationError(`${field} deve conter DDD e 10 ou 11 dígitos.`);
  }
  return digits;
}

function normalizeWebsite(value, fallback = "") {
  const raw = text(value, fallback);
  if (!raw) return "";
  const instagram = raw.startsWith("@") ? `https://instagram.com/${raw.slice(1)}` : raw;
  const candidate = /^https?:\/\//i.test(instagram) ? instagram : `https://${instagram}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:" || !parsed.hostname.includes(".")) throw new Error();
    return parsed.toString();
  } catch {
    throw new SupplierValidationError("Informe um site HTTPS ou perfil do Instagram válido.");
  }
}

function normalizeBoolean(value, fallback = true) {
  if (value === undefined) return Boolean(Number(fallback ?? 1));
  return ![false, 0, "0", "false", "inactive"].includes(value);
}

export function normalizeSupplierInput(body = {}, current = {}) {
  const name = text(body.name, current.name);
  if (!name) throw new SupplierValidationError("Informe o nome do fornecedor.");

  const personType = text(body.person_type, current.person_type || "PJ").toUpperCase();
  if (!PERSON_TYPES.has(personType)) throw new SupplierValidationError("Tipo de pessoa inválido.");

  const rawDocument = text(body.document, current.document);
  let document = "";
  if (rawDocument) {
    const parsed = parseTaxId(rawDocument);
    if (!parsed.ok) throw new SupplierValidationError(parsed.error);
    if ((personType === "PF" && parsed.type !== "CPF") || (personType === "PJ" && parsed.type !== "CNPJ")) {
      throw new SupplierValidationError(`O documento deve ser um ${personType === "PF" ? "CPF" : "CNPJ"}.`);
    }
    document = parsed.value;
  }

  const postalCode = text(body.postal_code, current.postal_code).replace(/\D/g, "");
  if (postalCode && postalCode.length !== 8) throw new SupplierValidationError("CEP deve conter 8 dígitos.");
  const state = text(body.state, current.state).toUpperCase();
  if (state && !BRAZILIAN_STATES.has(state)) throw new SupplierValidationError("Selecione uma UF brasileira válida.");
  const qualityStatus = text(body.quality_status, current.quality_status || "review").toLowerCase();
  if (!QUALITY_STATUSES.has(qualityStatus)) throw new SupplierValidationError("Situação de qualidade inválida.");
  const phone = normalizePhone(body.phone, "Telefone", current.phone);
  const whatsappDigits = normalizePhone(body.whatsapp, "WhatsApp", current.whatsapp);

  return {
    name,
    person_type: personType,
    legal_name: text(body.legal_name, current.legal_name),
    trade_name: text(body.trade_name, current.trade_name),
    document,
    state_registration: text(body.state_registration, current.state_registration).toUpperCase(),
    contact_name: text(body.contact_name, current.contact_name),
    phone,
    whatsapp: whatsappDigits ? normalizeWhatsappNumber(whatsappDigits) : "",
    email: normalizeEmail(body.email, current.email),
    website: normalizeWebsite(body.website, current.website),
    postal_code: postalCode,
    street: text(body.street, current.street),
    street_number: text(body.street_number, current.street_number),
    address_complement: text(body.address_complement, current.address_complement),
    neighborhood: text(body.neighborhood, current.neighborhood),
    city: text(body.city, current.city),
    state,
    country: text(body.country, current.country || "Brasil") || "Brasil",
    categories: normalizeSupplierList(body.categories, current.categories),
    brands: normalizeSupplierList(body.brands, current.brands),
    certifications: normalizeSupplierList(body.certifications, current.certifications),
    material_references: normalizeSupplierList(body.material_references, current.material_references),
    lot_references: normalizeSupplierList(body.lot_references, current.lot_references),
    payment_terms: text(body.payment_terms, current.payment_terms),
    payment_method: text(body.payment_method, current.payment_method),
    payment_days: optionalInteger(body.payment_days, "Prazo de pagamento", current.payment_days),
    lead_time_days: optionalInteger(body.lead_time_days, "Prazo de entrega", current.lead_time_days),
    minimum_order_value: optionalMoney(body.minimum_order_value, "Pedido mínimo", current.minimum_order_value),
    freight_terms: text(body.freight_terms, current.freight_terms),
    notes: text(body.notes, current.notes),
    quality_status: qualityStatus,
    is_active: normalizeBoolean(body.is_active, current.is_active),
  };
}

export const SUPPLIER_COLUMNS = Object.freeze(Object.keys(normalizeSupplierInput({ name: "schema" })));
export const SUPPLIER_JSON_COLUMNS = Object.freeze(new Set([
  "categories", "brands", "certifications", "material_references", "lot_references"
]));
