// Resolução de credencial: dado um escopo, devolve um cliente do Asaas pronto.
//
// Dois escopos, com origens de segredo diferentes de propósito:
//
//   PLATAFORMA  chave da Monitence, só do ambiente (ASAAS_API_KEY). Cobra a
//               assinatura das clínicas. Nunca vem do banco — uma clínica não
//               pode, por nenhum caminho, influenciar a conta que recebe o
//               dinheiro da plataforma.
//   CLÍNICA     chave que a própria clínica cadastrou no cofre
//               (`tenant_integrations`), cifrada. Cobra o cliente final; o
//               dinheiro cai na conta da clínica.
//
// A separação é o que dispensa subconta e split — e, com isso, a pendência de
// a conta raiz da Monitence precisar ser CNPJ.
import {
  ASAAS_API_KEY,
  ASAAS_BASE_URL,
  ASAAS_WEBHOOK_TOKEN,
  asaasPlatformEnabled
} from "../../config/index.js";
import { createAsaasClient } from "./client.js";
import { decryptSecret, encryptSecret, needsRewrap, secretHint, vaultKeyConfigured } from "./vault.js";

export const PROVIDER = "asaas";

// URL de produção quando a clínica marca o ambiente como "production"; sandbox
// caso contrário. A clínica escolhe o ambiente na tela; a plataforma, no .env.
const PRODUCTION_URL = "https://api.asaas.com/v3";
const SANDBOX_URL = "https://api-sandbox.asaas.com/v3";

// ---------------------------------------------------------------------------
// Escopo da plataforma
// ---------------------------------------------------------------------------

export function platformClient() {
  return createAsaasClient({
    apiKey: ASAAS_API_KEY,
    baseUrl: ASAAS_BASE_URL,
    label: "platform"
  });
}

export function platformWebhookToken() {
  return ASAAS_WEBHOOK_TOKEN;
}

export function isPlatformEnabled() {
  return asaasPlatformEnabled;
}

// ---------------------------------------------------------------------------
// Escopo da clínica (cofre)
// ---------------------------------------------------------------------------

// Linha crua do cofre. `db` já aponta para o schema da clínica.
export async function readIntegration(db) {
  const row = await db.get("SELECT * FROM tenant_integrations WHERE provider=?", [PROVIDER]);
  if (row) await rewrapIfLegacy(db, row);
  return row;
}

// Regrava a linha quando os segredos ainda estão cifrados com a derivação antiga
// (a que vinha do AUTH_SECRET, usada enquanto ASAAS_VAULT_KEY não existia).
//
// Acontece sozinho na primeira leitura depois que a chave nova entra, e é o que
// torna a introdução do ASAAS_VAULT_KEY indolor: sem isto, o cofre continuaria
// legível só enquanto a chave legada permanecesse na lista, e uma futura rotação
// do AUTH_SECRET quebraria tudo de uma vez.
//
// Best-effort de propósito: falhar aqui não pode derrubar uma cobrança. O valor
// já foi decifrado com sucesso; a regravação é otimização de durabilidade, e a
// próxima leitura tenta de novo.
async function rewrapIfLegacy(db, row) {
  if (!vaultKeyConfigured) return;
  const secretLegacy = needsRewrap(row.secret_encrypted);
  const webhookLegacy = needsRewrap(row.webhook_token_encrypted);
  if (!secretLegacy && !webhookLegacy) return;
  try {
    const secret = secretLegacy ? encryptSecret(decryptSecret(row.secret_encrypted)) : row.secret_encrypted;
    const webhook = webhookLegacy
      ? encryptSecret(decryptSecret(row.webhook_token_encrypted))
      : row.webhook_token_encrypted;
    await db.run(
      "UPDATE tenant_integrations SET secret_encrypted=?, webhook_token_encrypted=? WHERE provider=?",
      [secret, webhook, PROVIDER]
    );
    row.secret_encrypted = secret;
    row.webhook_token_encrypted = webhook;
    console.log(`[Asaas] cofre regravado com a chave atual (provider=${PROVIDER}).`);
  } catch (error) {
    console.warn(`[Asaas] não consegui regravar o cofre agora: ${error.message}`);
  }
}

// Versão segura para a interface: nunca inclui segredo decifrado, só a máscara
// e o diagnóstico do último handshake.
export async function integrationStatus(db) {
  const row = await readIntegration(db);
  if (!row) {
    return {
      provider: PROVIDER,
      configured: false,
      enabled: false,
      environment: "sandbox",
      secret_hint: null,
      webhook_configured: false,
      last_check_at: null,
      last_check_status: null,
      last_check_detail: null
    };
  }
  return {
    provider: PROVIDER,
    configured: Boolean(row.secret_encrypted),
    enabled: Boolean(row.enabled) && Boolean(row.secret_encrypted),
    environment: row.environment,
    secret_hint: row.secret_hint,
    // Booleano, jamais o token: quem o lê consegue forjar "pagamento
    // confirmado" para esta clínica.
    webhook_configured: Boolean(row.webhook_token_encrypted),
    last_check_at: row.last_check_at,
    last_check_status: row.last_check_status,
    last_check_detail: row.last_check_detail,
    updated_at: row.updated_at
  };
}

// Grava/atualiza a credencial. Campos ausentes são PRESERVADOS: a tela envia
// só o que mudou, e um PATCH sem `apiKey` não pode apagar a chave em uso.
export async function saveIntegration(db, { apiKey, webhookToken, environment, enabled, userId }) {
  const current = await readIntegration(db);

  const secretEncrypted = apiKey ? encryptSecret(apiKey) : current?.secret_encrypted ?? null;
  const hint = apiKey ? secretHint(apiKey) : current?.secret_hint ?? null;
  const webhookEncrypted = webhookToken
    ? encryptSecret(webhookToken)
    : current?.webhook_token_encrypted ?? null;
  const env = environment || current?.environment || "sandbox";
  const isEnabled = enabled === undefined ? (current?.enabled ?? 0) : enabled ? 1 : 0;

  if (current) {
    await db.run(
      `UPDATE tenant_integrations
          SET secret_encrypted=?, secret_hint=?, webhook_token_encrypted=?,
              environment=?, enabled=?, updated_by=?, updated_at=CURRENT_TIMESTAMP
        WHERE provider=?`,
      [secretEncrypted, hint, webhookEncrypted, env, isEnabled, userId ?? null, PROVIDER]
    );
  } else {
    await db.run(
      `INSERT INTO tenant_integrations
         (provider, secret_encrypted, secret_hint, webhook_token_encrypted, environment, enabled, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [PROVIDER, secretEncrypted, hint, webhookEncrypted, env, isEnabled, userId ?? null]
    );
  }

  // Chave nova (ou troca de ambiente) = OUTRA conta no Asaas. Os
  // `asaas_customer_id` já gravados pertencem à conta anterior e lá não
  // existem: mantê-los faria toda cobrança seguinte falhar com "customer not
  // found", e o sintoma apareceria só na hora de cobrar o cliente. Zerar é
  // seguro — o id é recriado sob demanda no próximo checkout.
  const trocouAmbiente = Boolean(current && environment && environment !== current.environment);
  if (apiKey || trocouAmbiente) {
    await forgetCustomerIds(db);
  }

  return integrationStatus(db);
}

// Esquece as identidades de pagador vinculadas à credencial anterior.
// Exportada para que o mesmo cuidado possa ser aplicado de fora (ex.: um
// script de suporte que troca a chave direto no banco).
export async function forgetCustomerIds(db) {
  const result = await db.run(
    "UPDATE clients SET asaas_customer_id=NULL WHERE asaas_customer_id IS NOT NULL"
  );
  if (result.changes) {
    console.warn(
      `[Asaas] credencial trocada: ${result.changes} cliente(s) desvinculado(s) da conta anterior.`
    );
  }
  return result.changes;
}

export async function removeIntegration(db) {
  await db.run("DELETE FROM tenant_integrations WHERE provider=?", [PROVIDER]);
  // Mesma razão do saveIntegration: sem a credencial, os ids de pagador ficam
  // órfãos e voltariam a ser usados contra uma conta diferente se a clínica
  // cadastrasse outra chave depois.
  await forgetCustomerIds(db);
  return integrationStatus(db);
}

// Registra o resultado do último handshake, para a tela explicar POR QUE a
// integração não está funcionando sem obrigar a olhar log de servidor.
export async function recordCheck(db, { status, detail }) {
  await db.run(
    `UPDATE tenant_integrations
        SET last_check_at=CURRENT_TIMESTAMP, last_check_status=?, last_check_detail=?
      WHERE provider=?`,
    [status, detail ? String(detail).slice(0, 500) : null, PROVIDER]
  );
}

// Cliente do Asaas da clínica, ou `null` se ela não configurou / desligou.
//
// Devolve null em vez de lançar porque a ausência de gateway é um estado
// NORMAL: a maioria das clínicas opera só com pagamento presencial, e o fluxo
// de agendamento não pode quebrar por causa disso.
export async function tenantClient(db, { requireEnabled = true } = {}) {
  const row = await readIntegration(db);
  if (!row) return null;
  if (requireEnabled && !row.enabled) return null;
  const apiKey = decryptSecret(row.secret_encrypted);
  if (!apiKey) return null;
  return createAsaasClient({
    apiKey,
    baseUrl: row.environment === "production" ? PRODUCTION_URL : SANDBOX_URL,
    label: "tenant"
  });
}

// Token de webhook da clínica, em claro, para a validação do POST recebido.
// Único lugar do sistema que decifra esse valor.
export async function tenantWebhookToken(db) {
  const row = await readIntegration(db);
  if (!row) return null;
  return decryptSecret(row.webhook_token_encrypted);
}
