// Provedor oficial do WhatsApp Business Cloud API.
//
// O token nunca sai deste módulo em claro: ele vive cifrado no mesmo cofre de
// integrações por clínica usado pelo gateway de pagamentos. A fila continua
// oferecendo o link wa.me quando a clínica não optou pela API oficial.
import { decryptSecret, encryptSecret, secretHint } from "./asaas/vault.js";
import { WHATSAPP_GRAPH_API_VERSION, WHATSAPP_GRAPH_BASE_URL } from "../config/index.js";

export const WHATSAPP_CLOUD_PROVIDER = "whatsapp_cloud";

function safeSettings(row) {
  if (!row?.settings) return {};
  if (typeof row.settings === "string") {
    try { return JSON.parse(row.settings); } catch { return {}; }
  }
  return row.settings;
}

function phoneNumberId(value) {
  return String(value || "").trim().replace(/\s/g, "");
}

export async function whatsappCloudStatus(db) {
  const row = await db.get("SELECT * FROM tenant_integrations WHERE provider=?", [WHATSAPP_CLOUD_PROVIDER]);
  const settings = safeSettings(row);
  const configured = Boolean(row?.secret_encrypted && settings.phone_number_id);
  return {
    provider: WHATSAPP_CLOUD_PROVIDER,
    configured,
    enabled: configured && Boolean(row?.enabled),
    phone_number_id: settings.phone_number_id || null,
    business_account_id: settings.business_account_id || null,
    secret_hint: row?.secret_hint || null,
    api_version: WHATSAPP_GRAPH_API_VERSION,
    last_check_at: row?.last_check_at || null,
    last_check_status: row?.last_check_status || null,
    last_check_detail: row?.last_check_detail || null,
    updated_at: row?.updated_at || null
  };
}

export async function saveWhatsAppCloudIntegration(db, { accessToken, phoneNumberId: nextPhoneNumberId, businessAccountId, enabled, userId }) {
  const current = await db.get("SELECT * FROM tenant_integrations WHERE provider=?", [WHATSAPP_CLOUD_PROVIDER]);
  const currentSettings = safeSettings(current);
  const settings = {
    phone_number_id: nextPhoneNumberId === undefined ? currentSettings.phone_number_id || "" : phoneNumberId(nextPhoneNumberId),
    business_account_id: businessAccountId === undefined ? currentSettings.business_account_id || "" : String(businessAccountId || "").trim()
  };
  const secretEncrypted = accessToken ? encryptSecret(accessToken) : current?.secret_encrypted || null;
  const hint = accessToken ? secretHint(accessToken) : current?.secret_hint || null;
  const isEnabled = enabled === undefined ? Number(current?.enabled || 0) : enabled ? 1 : 0;

  if (current) {
    await db.run(
      `UPDATE tenant_integrations SET secret_encrypted=?, secret_hint=?, settings=?, enabled=?, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE provider=?`,
      [secretEncrypted, hint, JSON.stringify(settings), isEnabled, userId ?? null, WHATSAPP_CLOUD_PROVIDER]
    );
  } else {
    await db.run(
      `INSERT INTO tenant_integrations (provider, secret_encrypted, secret_hint, settings, enabled, updated_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [WHATSAPP_CLOUD_PROVIDER, secretEncrypted, hint, JSON.stringify(settings), isEnabled, userId ?? null]
    );
  }
  return whatsappCloudStatus(db);
}

export async function removeWhatsAppCloudIntegration(db) {
  await db.run("DELETE FROM tenant_integrations WHERE provider=?", [WHATSAPP_CLOUD_PROVIDER]);
  return whatsappCloudStatus(db);
}

export async function recordWhatsAppCloudCheck(db, { status, detail }) {
  await db.run(
    "UPDATE tenant_integrations SET last_check_at=CURRENT_TIMESTAMP, last_check_status=?, last_check_detail=? WHERE provider=?",
    [status, String(detail || "").slice(0, 500) || null, WHATSAPP_CLOUD_PROVIDER]
  );
}

async function credentials(db, { requireEnabled = true } = {}) {
  const row = await db.get("SELECT * FROM tenant_integrations WHERE provider=?", [WHATSAPP_CLOUD_PROVIDER]);
  const settings = safeSettings(row);
  if (!row || (requireEnabled && !row.enabled)) return null;
  const accessToken = decryptSecret(row.secret_encrypted);
  if (!accessToken || !settings.phone_number_id) return null;
  return { accessToken, phoneNumberId: settings.phone_number_id };
}

async function graphRequest(path, { accessToken, method = "GET", body } = {}) {
  let response;
  try {
    response = await fetch(`${WHATSAPP_GRAPH_BASE_URL}/${WHATSAPP_GRAPH_API_VERSION}${path}`, {
      method,
      headers: { Authorization: `Bearer ${accessToken}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000)
    });
  } catch {
    throw new Error("Não foi possível conectar à API oficial do WhatsApp.");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || "A API oficial do WhatsApp recusou a solicitação.";
    throw new Error(String(message).slice(0, 400));
  }
  return payload;
}

export async function testWhatsAppCloudConnection(db) {
  const config = await credentials(db, { requireEnabled: false });
  if (!config) {
    const detail = "Cadastre o token de acesso e o ID do número do WhatsApp Business antes de testar.";
    await recordWhatsAppCloudCheck(db, { status: "error", detail });
    return { ok: false, detail };
  }
  try {
    const result = await graphRequest(`/${encodeURIComponent(config.phoneNumberId)}?fields=id,display_phone_number`, config);
    const detail = result.display_phone_number
      ? `Conexão confirmada para o número ${result.display_phone_number}.`
      : "Token e número validados pela API oficial do WhatsApp.";
    await recordWhatsAppCloudCheck(db, { status: "ok", detail });
    return { ok: true, detail };
  } catch (error) {
    const detail = error?.message || "Falha ao validar a integração do WhatsApp.";
    await recordWhatsAppCloudCheck(db, { status: "error", detail });
    return { ok: false, detail };
  }
}

// Retorna null quando a clínica ainda usa o fluxo assistido (wa.me). Quem
// processa a fila usa isso para preservar o comportamento atual sem custo/API.
export async function sendWhatsAppCloudText(db, { destination, message }) {
  const config = await credentials(db);
  if (!config) return null;
  const to = String(destination || "").replace(/\D/g, "");
  if (!to) throw new Error("Destino inválido para a API oficial do WhatsApp.");
  const result = await graphRequest(`/${encodeURIComponent(config.phoneNumberId)}/messages`, {
    ...config,
    method: "POST",
    body: { messaging_product: "whatsapp", to, type: "text", text: { preview_url: false, body: String(message || "") } }
  });
  return { messageId: result?.messages?.[0]?.id || null };
}
