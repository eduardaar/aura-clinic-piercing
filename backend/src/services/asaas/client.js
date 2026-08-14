// Cliente HTTP do Asaas — o ÚNICO ponto do sistema que fala com o gateway.
//
// É uma factory, não um singleton, porque existem duas credenciais em jogo: a
// da plataforma (Monitence cobrando as clínicas) e a de cada clínica (cobrando
// o cliente final). Um singleton global obrigaria a passar a chave em toda
// chamada — e uma troca acidental cobraria na conta errada.
import { ASAAS_BASE_URL, ASAAS_TIMEOUT_MS } from "../../config/index.js";

// Erro tipado do gateway. Carrega duas mensagens de propósito:
// - `message`: técnica, vai para log e para o admin da clínica.
// - `userMessage`: genérica, é a única que pode chegar ao cliente final numa
//   tela pública (a mensagem crua do provedor vaza detalhe de conta e de
//   integração para quem só está comprando um piercing).
export class AsaasError extends Error {
  constructor(message, { status = 0, code = null, userMessage = null, retryable = false } = {}) {
    super(message);
    this.name = "AsaasError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.userMessage =
      userMessage || "Não foi possível processar o pagamento agora. Tente novamente em instantes.";
  }
}

// Só dígitos. O Asaas recusa CPF/CNPJ, telefone e CEP com máscara — e é assim
// que o dado chega do formulário ("(11) 99999-8888").
export function onlyDigits(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits || null;
}

// O Asaas trabalha em REAIS decimais ("value": 149.90), não em centavos como
// Stripe/Pagar.me. Mandar 14990 cobraria quinze mil reais.
export function toAsaasValue(amount) {
  const number = Number(amount);
  if (!Number.isFinite(number) || number <= 0) {
    throw new AsaasError("Valor inválido para cobrança.", { status: 400 });
  }
  return Math.round(number * 100) / 100;
}

// Data no formato ISO yyyy-MM-dd, sem horário e sem fuso.
export function toAsaasDate(date) {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) throw new AsaasError("Data inválida.", { status: 400 });
  return value.toISOString().slice(0, 10);
}

// Vencimento mínimo: o gateway REJEITA dueDate no passado. Usar "hoje" já é
// arriscado perto da virada do dia (o Asaas usa horário de Brasília e o servidor
// pode estar em UTC), então o piso é amanhã.
export function minimumDueDate(daysAhead = 1) {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  return toAsaasDate(date);
}

// Remove chaves nulas/vazias: o Asaas valida campos presentes, então mandar
// `email: null` é diferente de não mandar `email`.
function compact(object) {
  const out = {};
  for (const [key, value] of Object.entries(object || {})) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && !value.trim()) continue;
    out[key] = typeof value === "string" ? value.trim() : value;
  }
  return out;
}

// Extrai a mensagem de erro do envelope do Asaas:
//   { "errors": [ { "code": "invalid_cpfCnpj", "description": "..." } ] }
function describeError(body, status) {
  const first = Array.isArray(body?.errors) ? body.errors[0] : null;
  if (first?.description) return { message: first.description, code: first.code || null };
  if (typeof body === "string" && body.trim()) return { message: body.slice(0, 300), code: null };
  return { message: `Falha na comunicação com o gateway (HTTP ${status}).`, code: null };
}

/**
 * @param {{ apiKey: string, baseUrl?: string, label?: string }} options
 *   `label` só aparece em log, para distinguir "platform" de "tenant:bella".
 */
export function createAsaasClient({ apiKey, baseUrl = ASAAS_BASE_URL, label = "asaas" } = {}) {
  const token = String(apiKey || "").trim();
  const root = String(baseUrl || ASAAS_BASE_URL).replace(/\/+$/, "");

  async function request(method, path, body) {
    if (!token) {
      throw new AsaasError("Credencial do Asaas não configurada.", {
        status: 503,
        code: "not_configured"
      });
    }

    let response;
    try {
      response = await fetch(`${root}${path}`, {
        method,
        headers: {
          access_token: token,
          "Content-Type": "application/json",
          // O Asaas exige User-Agent identificável; requisições sem ele podem
          // ser barradas pelo WAF deles.
          "User-Agent": "AuraClinic/1.0"
        },
        body: body === undefined ? undefined : JSON.stringify(compact(body)),
        signal: AbortSignal.timeout(ASAAS_TIMEOUT_MS)
      });
    } catch (error) {
      // Timeout ou rede: pode ter chegado ao gateway. `retryable` é informativo
      // — quem chama decide, e para POST de cobrança a decisão é NÃO repetir
      // sem chave de idempotência, sob pena de cobrar duas vezes.
      throw new AsaasError(`[${label}] Falha de rede ao chamar o gateway: ${error.message}`, {
        status: 504,
        code: "network_error",
        retryable: true
      });
    }

    // DELETE devolve corpo vazio; JSON.parse de "" explodiria.
    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }

    if (!response.ok) {
      const { message, code } = describeError(payload, response.status);
      throw new AsaasError(`[${label}] ${message}`, {
        status: response.status,
        code,
        // 4xx é culpa do payload (CPF inválido, cartão recusado): repetir dá o
        // mesmo erro. 5xx é indisponibilidade do gateway.
        retryable: response.status >= 500,
        userMessage: response.status >= 500 ? null : message
      });
    }
    return payload;
  }

  return {
    label,
    // ---- Clientes (pagadores) ----
    createCustomer({ name, taxId, email, phone, externalReference }) {
      return request("POST", "/customers", {
        name,
        cpfCnpj: onlyDigits(taxId),
        email,
        mobilePhone: onlyDigits(phone),
        externalReference,
        notificationDisabled: false
      });
    },
    getCustomer(customerId) {
      return request("GET", `/customers/${encodeURIComponent(customerId)}`);
    },

    // ---- Cobranças avulsas ----
    //
    // billingType UNDEFINED faz o Asaas hospedar a página de fatura
    // (`invoiceUrl`) onde o pagador escolhe PIX, boleto ou cartão. É o que
    // elimina QR code, copia-e-cola e conciliação de PIX do nosso lado.
    createPayment({
      customer,
      value,
      dueDate,
      description,
      externalReference,
      billingType = "UNDEFINED"
    }) {
      return request("POST", "/payments", {
        customer,
        billingType,
        value: toAsaasValue(value),
        dueDate: dueDate || minimumDueDate(),
        description,
        externalReference
      });
    },
    getPayment(paymentId) {
      return request("GET", `/payments/${encodeURIComponent(paymentId)}`);
    },
    cancelPayment(paymentId) {
      return request("DELETE", `/payments/${encodeURIComponent(paymentId)}`);
    },
    // PIX e cartão: o Asaas efetiva o estorno por este endpoint. O status
    // interno só muda quando webhook/conciliação confirmar o efeito; responder
    // 200 aqui significa "pedido aceito", não "dinheiro já devolvido".
    refundPayment(paymentId, { value, description } = {}) {
      return request("POST", `/payments/${encodeURIComponent(paymentId)}/refund`, {
        value: value === undefined ? undefined : toAsaasValue(value),
        description
      });
    },
    // Boleto não devolve dinheiro imediatamente: cria um link para o pagador
    // informar conta e documentação. Não o misturamos com refundPayment.
    requestBankSlipRefund(paymentId) {
      return request("POST", `/payments/${encodeURIComponent(paymentId)}/bankSlip/refund`, {});
    },
    // Dados do PIX (QR code + copia-e-cola) de uma cobrança já criada.
    getPixQrCode(paymentId) {
      return request("GET", `/payments/${encodeURIComponent(paymentId)}/pixQrCode`);
    },

    // ---- Assinaturas recorrentes ----
    createSubscription({
      customer,
      value,
      nextDueDate,
      cycle = "MONTHLY",
      description,
      externalReference,
      billingType = "UNDEFINED"
    }) {
      if (String(billingType).toUpperCase() !== "UNDEFINED") {
        throw new AsaasError(
          "Assinaturas devem usar o checkout hospedado; cartão bruto não é aceito.",
          { status: 400, code: "hosted_checkout_required" }
        );
      }
      const body = {
        customer,
        billingType: "UNDEFINED",
        value: toAsaasValue(value),
        nextDueDate: nextDueDate || minimumDueDate(),
        cycle,
        description,
        externalReference
      };
      return request("POST", "/subscriptions", body);
    },
    getSubscription(subscriptionId) {
      return request("GET", `/subscriptions/${encodeURIComponent(subscriptionId)}`);
    },
    // Faturas geradas por uma assinatura. Envelope { data: [...] }.
    async getSubscriptionPayments(subscriptionId) {
      const body = await request(
        "GET",
        `/subscriptions/${encodeURIComponent(subscriptionId)}/payments`
      );
      return Array.isArray(body?.data) ? body.data : [];
    },
    // Atualizar assinatura no Asaas é POST no próprio recurso — não PUT/PATCH.
    updateSubscription(subscriptionId, { value, cycle, updatePendingPayments = true }) {
      return request("POST", `/subscriptions/${encodeURIComponent(subscriptionId)}`, {
        value: value === undefined ? undefined : toAsaasValue(value),
        cycle,
        updatePendingPayments
      });
    },
    cancelSubscription(subscriptionId) {
      return request("DELETE", `/subscriptions/${encodeURIComponent(subscriptionId)}`);
    },

    // Handshake barato para a tela de ajustes dizer "chave válida" na hora em
    // que a clínica cola a credencial, em vez de descobrir no primeiro checkout.
    async validateCredentials() {
      const body = await request("GET", "/customers?limit=1");
      return { ok: true, totalCount: body?.totalCount ?? 0 };
    }
  };
}
