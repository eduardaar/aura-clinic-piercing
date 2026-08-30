const digits = (value, max) => String(value ?? "").replace(/\D/g, "").slice(0, max);

export const SUPPLIER_CATEGORIES = [
  "Joias", "Materiais descartáveis", "Produtos de cuidado", "Equipamentos",
  "Embalagens", "Manutenção", "Outros"
];

export const BRAZILIAN_STATES = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"
];

export function emptySupplier() {
  return {
    name: "", person_type: "PJ", legal_name: "", trade_name: "", document: "", state_registration: "",
    contact_name: "", phone: "", whatsapp: "", email: "", website: "",
    postal_code: "", street: "", street_number: "", address_complement: "", neighborhood: "", city: "", state: "", country: "Brasil",
    categories: "", brands: "", certifications: "", material_references: "", lot_references: "",
    payment_terms: "", payment_method: "", payment_days: "", lead_time_days: "", minimum_order_value: "", freight_terms: "",
    quality_status: "review", notes: "", is_active: true
  };
}

export function formatSupplierTaxId(value, personType = "PJ") {
  const valueDigits = digits(value, personType === "PF" ? 11 : 14);
  if (personType === "PF") {
    return valueDigits.replace(/^(\d{3})(\d)/, "$1.$2").replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  }
  return valueDigits.replace(/^(\d{2})(\d)/, "$1.$2").replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d)/, ".$1/$2").replace(/(\d{4})(\d{1,2})$/, "$1-$2");
}

export function formatBrazilianPhone(value) {
  const rawDigits = String(value ?? "").replace(/\D/g, "");
  const valueDigits = (rawDigits.startsWith("55") && rawDigits.length >= 12 ? rawDigits.slice(2) : rawDigits).slice(0, 11);
  if (valueDigits.length <= 10) return valueDigits.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d{1,4})$/, "$1-$2");
  return valueDigits.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d{1,4})$/, "$1-$2");
}

export function formatPostalCode(value) {
  return digits(value, 8).replace(/^(\d{5})(\d)/, "$1-$2");
}

function cpfDigit(value, length) {
  let sum = 0;
  for (let index = 0; index < length; index++) sum += Number(value[index]) * (length + 1 - index);
  const rest = (sum * 10) % 11;
  return rest === 10 ? 0 : rest;
}

function cnpjDigit(value, length) {
  let sum = 0;
  let weight = length - 7;
  for (let index = 0; index < length; index++) {
    sum += Number(value[index]) * weight;
    weight = weight - 1 < 2 ? 9 : weight - 1;
  }
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

function validDocument(value, type) {
  const valueDigits = digits(value, 14);
  if (!valueDigits) return true;
  if (type === "PF") return valueDigits.length === 11 && !/^(\d)\1{10}$/.test(valueDigits)
    && cpfDigit(valueDigits, 9) === Number(valueDigits[9]) && cpfDigit(valueDigits, 10) === Number(valueDigits[10]);
  return valueDigits.length === 14 && !/^(\d)\1{13}$/.test(valueDigits)
    && cnpjDigit(valueDigits, 12) === Number(valueDigits[12]) && cnpjDigit(valueDigits, 13) === Number(valueDigits[13]);
}

export function supplierFormErrors(form) {
  const errors = [];
  if (!String(form.name || "").trim()) errors.push({ field: "name", label: "Nome", message: "Informe o nome do fornecedor." });
  if (!new Set(["PF", "PJ"]).has(form.person_type)) errors.push({ field: "person_type", label: "Tipo", message: "Selecione pessoa física ou jurídica." });
  if (form.document && !validDocument(form.document, form.person_type)) errors.push({ field: "document", label: form.person_type === "PF" ? "CPF" : "CNPJ", message: "Documento inválido." });
  for (const [field, label] of [["phone", "Telefone"], ["whatsapp", "WhatsApp"]]) {
    const valueDigits = digits(form[field], 20);
    if (valueDigits && ![10, 11].includes(valueDigits.length)) errors.push({ field, label, message: "Informe DDD e 10 ou 11 dígitos." });
  }
  if (form.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(form.email).trim())) errors.push({ field: "email", label: "E-mail", message: "Informe um e-mail válido." });
  if (form.postal_code && digits(form.postal_code, 20).length !== 8) errors.push({ field: "postal_code", label: "CEP", message: "Informe os 8 dígitos." });
  if (form.website && !/^(@[a-z0-9._]+|https:\/\/.+\..+)$/i.test(String(form.website).trim())) errors.push({ field: "website", label: "Site/Instagram", message: "Use HTTPS ou @perfil." });
  return errors;
}

const listText = (value) => Array.isArray(value) ? value.join(", ") : String(value || "");
const listValue = (value) => [...new Set(String(value || "").split(/[,;\n]/).map((item) => item.trim()).filter(Boolean))];

export function supplierToForm(item = {}) {
  const base = emptySupplier();
  const next = { ...base, ...item, is_active: Boolean(Number(item.is_active ?? 1)) };
  for (const field of ["categories", "brands", "certifications", "material_references", "lot_references"]) next[field] = listText(item[field]);
  next.document = formatSupplierTaxId(item.document, next.person_type);
  next.phone = formatBrazilianPhone(item.phone);
  next.whatsapp = formatBrazilianPhone(item.whatsapp);
  next.postal_code = formatPostalCode(item.postal_code);
  return next;
}

export function supplierPayload(form) {
  return {
    ...form,
    name: String(form.name || "").trim(),
    email: String(form.email || "").replace(/\s/g, "").toLowerCase(),
    document: digits(form.document, 14),
    phone: digits(form.phone, 11),
    whatsapp: digits(form.whatsapp, 11),
    postal_code: digits(form.postal_code, 8),
    state: String(form.state || "").toUpperCase(),
    categories: listValue(form.categories),
    brands: listValue(form.brands),
    certifications: listValue(form.certifications),
    material_references: listValue(form.material_references),
    lot_references: listValue(form.lot_references),
    payment_days: form.payment_days === "" ? null : Number(form.payment_days),
    lead_time_days: form.lead_time_days === "" ? null : Number(form.lead_time_days),
    minimum_order_value: form.minimum_order_value === "" ? null : Number(form.minimum_order_value)
  };
}
