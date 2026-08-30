export const BRAZIL_STATE_OPTIONS = [
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
];

export function onlyDigits(value) {
  return String(value ?? "").replace(/\D/g, "");
}

export function formatBrazilianPhone(value) {
  let digits = onlyDigits(value).slice(0, 13);
  if (digits.startsWith("55") && digits.length > 11) digits = digits.slice(2);
  digits = digits.slice(0, 11);
  if (!digits) return "";
  if (digits.length <= 2) return `(${digits}`;
  const ddd = digits.slice(0, 2);
  const number = digits.slice(2);
  const split = number.length > 8 ? 5 : 4;
  return `(${ddd}) ${number.slice(0, split)}${number.length > split ? `-${number.slice(split)}` : ""}`;
}

export function formatCpf(value) {
  const digits = onlyDigits(value).slice(0, 11);
  return digits
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1-$2");
}

export function formatCep(value) {
  return onlyDigits(value)
    .slice(0, 8)
    .replace(/^(\d{5})(\d)/, "$1-$2");
}

export function normalizeEmailInput(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s/g, "");
}

export function normalizeInstagramInput(value) {
  const username = String(value ?? "")
    .trim()
    .replace(/^@+/, "")
    .replace(/[^a-zA-Z0-9._]/g, "")
    .slice(0, 30);
  return username ? `@${username.toLowerCase()}` : "";
}

export function isValidCpf(value) {
  const digits = onlyDigits(value);
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false;
  const digit = (length) => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) sum += Number(digits[index]) * (length + 1 - index);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return digit(9) === Number(digits[9]) && digit(10) === Number(digits[10]);
}

/** @returns {Record<string, string>} */
export function validateClientForm(form) {
  const errors = /** @type {Record<string, string>} */ ({});
  const whatsappDigits = onlyDigits(form.whatsapp);
  const phoneDigits = onlyDigits(form.phone);
  if (!String(form.full_name || "").trim()) errors.full_name = "Informe o nome civil completo.";
  if (!form.birth_date) errors.birth_date = "Informe a data de nascimento.";
  if (![10, 11].includes(whatsappDigits.length)) errors.whatsapp = "Informe o WhatsApp com DDD.";
  if (phoneDigits && ![10, 11].includes(phoneDigits.length)) errors.phone = "Informe o telefone com DDD.";
  if (form.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) errors.email = "Informe um e-mail válido.";
  if (form.cpf && !isValidCpf(form.cpf)) errors.cpf = "Informe um CPF válido.";
  if (form.postal_code && onlyDigits(form.postal_code).length !== 8) errors.postal_code = "Informe um CEP válido.";
  return errors;
}
