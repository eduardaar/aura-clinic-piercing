// Validação de CPF/CNPJ.
//
// Existe para dar um erro ÚTIL antes de gastar uma ida ao gateway. O Asaas
// recusa documento inválido com "invalid_cpfCnpj", que não diz à pessoa se ela
// digitou um dígito a menos, inverteu dois números ou preencheu o campo errado.
// Aqui o erro é local, imediato e específico.

// Dígito verificador do CPF: soma ponderada decrescente, módulo 11.
function cpfCheckDigit(digits, length) {
  let sum = 0;
  for (let i = 0; i < length; i++) {
    sum += Number(digits[i]) * (length + 1 - i);
  }
  const rest = (sum * 10) % 11;
  return rest === 10 ? 0 : rest;
}

function isValidCpf(digits) {
  if (digits.length !== 11) return false;
  // 111.111.111-11 e afins passam no cálculo do módulo 11, mas não existem.
  if (/^(\d)\1{10}$/.test(digits)) return false;
  return (
    cpfCheckDigit(digits, 9) === Number(digits[9]) &&
    cpfCheckDigit(digits, 10) === Number(digits[10])
  );
}

// Dígito verificador do CNPJ: pesos cíclicos de 2 a 9, da direita para a esquerda.
function cnpjCheckDigit(digits, length) {
  let sum = 0;
  let weight = length - 7;
  for (let i = 0; i < length; i++) {
    sum += Number(digits[i]) * weight;
    weight = weight - 1 < 2 ? 9 : weight - 1;
  }
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

function isValidCnpj(digits) {
  if (digits.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(digits)) return false;
  return (
    cnpjCheckDigit(digits, 12) === Number(digits[12]) &&
    cnpjCheckDigit(digits, 13) === Number(digits[13])
  );
}

/**
 * Normaliza e valida um CPF ou CNPJ.
 * @returns {{ ok: true, value: string, type: "CPF"|"CNPJ" } | { ok: false, error: string }}
 */
export function parseTaxId(input) {
  const digits = String(input ?? "").replace(/\D/g, "");
  if (!digits) return { ok: false, error: "Informe o CPF ou CNPJ." };
  if (digits.length === 11) {
    return isValidCpf(digits)
      ? { ok: true, value: digits, type: "CPF" }
      : { ok: false, error: "CPF inválido. Confira os números digitados." };
  }
  if (digits.length === 14) {
    return isValidCnpj(digits)
      ? { ok: true, value: digits, type: "CNPJ" }
      : { ok: false, error: "CNPJ inválido. Confira os números digitados." };
  }
  return {
    ok: false,
    error: `Documento deve ter 11 dígitos (CPF) ou 14 (CNPJ); recebi ${digits.length}.`
  };
}

/**
 * Regra do CPF no agendamento público.
 *
 * O documento é OPCIONAL por padrão — a maioria das clínicas opera sem gateway,
 * cobra o sinal por Pix e confere o comprovante na mão; exigir CPF ali só
 * afastaria cliente. Ele vira OBRIGATÓRIO quando a solicitação nasce com sinal
 * e a clínica tem gateway configurado: o Asaas recusa criar o pagador sem
 * documento (`invalid_cpfCnpj`), e sem pagador não existe link de pagamento.
 *
 * Sem esta guarda o pedido seria aceito, a cobrança falharia depois da
 * transação (é best-effort, de propósito) e o cliente terminaria numa tela que
 * promete link e entrega WhatsApp. Melhor pedir o campo antes.
 *
 * @param {{ value?: unknown, requiresOnlineCharge?: boolean }} input
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
export function bookingTaxId({ value, requiresOnlineCharge = false } = {}) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return requiresOnlineCharge
      ? {
          ok: false,
          error: "Informe o CPF: sem ele o gateway não cria o pagador e o sinal online não pode ser gerado."
        }
      : { ok: true, value: "" };
  }
  // Preenchido é sempre validado, com ou sem gateway: guardar um CPF errado em
  // `clients.tax_id` só adia o erro para a primeira cobrança daquele cliente.
  return parseTaxId(raw);
}

// Máscara para exibir na tela sem mostrar o documento inteiro.
// Guarda os quatro últimos dígitos, que bastam para a pessoa reconhecer o seu.
export function maskTaxId(input) {
  const digits = String(input ?? "").replace(/\D/g, "");
  if (digits.length < 5) return null;
  return `${"•".repeat(digits.length - 4)}${digits.slice(-4)}`;
}
