// Cofre de credenciais de gateway da clínica — API da tela de ajustes.
//
// Aqui a clínica cola a chave da conta Asaas DELA (a que recebe o dinheiro do
// cliente final). Três consequências mandam no desenho deste arquivo:
//
//   1. Papel `admin` em TODAS as rotas, nem `finance`. Quem troca esta chave
//      redireciona o faturamento inteiro da clínica para outra conta.
//   2. Nenhuma resposta devolve segredo. O cofre guarda cifrado e a tela vive
//      da máscara (`secret_hint`) + booleanos — com a única exceção do token
//      recém-gerado, que precisa ser copiado para o painel do Asaas.
//   3. Nada é logado. Nem `console.error(error)` do objeto inteiro: o erro do
//      handshake pode ecoar o payload da requisição que carregava a chave.
//
// Usa `withDb`, e não `withFeature`: configurar o gateway é pré-requisito para
// a clínica usar cobrança online, então trancá-lo atrás da feature de plano
// criaria o ciclo "não posso configurar porque não tenho o recurso que só
// funciona configurado". Se a decisão for cobrar por isso, o lugar é a rota que
// CRIA cobrança (`payments`), que já usa withFeature("deposits").
import crypto from "crypto";
import { Router } from "express";
import { z } from "zod";
import { withDb } from "../middleware/withDb.js";
import { requireRole } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { PUBLIC_API_URL } from "../config/index.js";
import { AsaasError } from "../services/asaas/client.js";
import {
  integrationStatus,
  saveIntegration,
  removeIntegration,
  recordCheck,
  tenantClient
} from "../services/asaas/credentials.js";
import {
  removeWhatsAppCloudIntegration,
  saveWhatsAppCloudIntegration,
  testWhatsAppCloudConnection,
  whatsappCloudStatus
} from "../services/whatsappCloud.js";

const router = Router();

// URL por clínica: o Asaas posta sem sessão e sem X-Tenant, então o slug na
// URL é o que identifica o schema de destino (ver routes/webhooks.js).
function webhookUrl(req) {
  const slug = req.tenant?.slug || "";
  return `${PUBLIC_API_URL}/api/webhooks/asaas/${slug}`;
}

// Resposta padrão da tela: status seguro do cofre + a URL a cadastrar no painel.
async function statusPayload(req, db, extra = {}) {
  return { ...(await integrationStatus(db)), webhook_url: webhookUrl(req), ...extra };
}

// Aceita boolean de JSON e também "true"/"false" de formulário — a tela de
// ajustes pode postar como multipart e ali todo campo chega string.
const booleanLike = z.preprocess(
  (value) =>
    typeof value === "string" ? ["true", "1", "sim", "on"].includes(value.trim().toLowerCase()) : value,
  z.boolean({ error: "Use verdadeiro ou falso." })
);

// Schema local (não está em schemas/index.js: é o único consumidor, e o mínimo
// de 16 caracteres do token é regra de segurança desta rota, não de domínio).
const integrationSaveSchema = z
  .object({
    api_key: z
      .string({ error: "A chave da API deve ser um texto." })
      .trim()
      .min(1, "A chave da API não pode ficar em branco. Omita o campo para manter a atual.")
      .optional(),
    // O token do webhook é o ÚNICO segredo que protege uma rota pública capaz
    // de marcar cobrança como paga. Token curto é adivinhável em massa, então
    // recusamos em vez de aceitar calado.
    webhook_token: z
      .string({ error: "O token de webhook deve ser um texto." })
      .trim()
      .min(
        16,
        "O token de webhook precisa ter pelo menos 16 caracteres: ele é o único segredo que impede qualquer pessoa na internet de marcar uma cobrança sua como paga. Use o botão de gerar token."
      )
      .optional(),
    environment: z
      .enum(["sandbox", "production"], { error: "Ambiente deve ser 'sandbox' ou 'production'." })
      .optional(),
    enabled: booleanLike.optional()
  })
  .passthrough();

const whatsappCloudSaveSchema = z.object({
  access_token: z.string().trim().min(20, "O token de acesso parece inválido.").optional(),
  phone_number_id: z.string().trim().regex(/^\d+$/, "O ID do número deve conter somente dígitos.").optional(),
  business_account_id: z.string().trim().regex(/^\d*$/, "O ID da conta empresarial deve conter somente dígitos.").optional(),
  enabled: booleanLike.optional()
}).strict();

// Handshake real com o gateway + registro do diagnóstico.
//
// Nunca propaga exceção: uma chave recusada é resposta legítima da tela
// ("chave recusada pelo gateway"), não erro 500 do nosso servidor. O detalhe
// técnico do AsaasError pode aparecer para o admin da clínica — é ele quem
// precisa saber se o problema é chave errada, ambiente errado ou gateway fora.
async function handshake(db) {
  try {
    // requireEnabled: false — a clínica valida a chave ANTES de ligar a
    // cobrança; exigir `enabled` aqui obrigaria a ligar no escuro.
    const client = await tenantClient(db, { requireEnabled: false });
    if (!client) {
      const detail = "Nenhuma chave salva no cofre para testar.";
      await recordCheck(db, { status: "error", detail });
      return { ok: false, detail };
    }
    await client.validateCredentials();
    const detail = "Chave aceita pelo Asaas.";
    await recordCheck(db, { status: "ok", detail });
    return { ok: true, detail };
  } catch (error) {
    // Só a mensagem, jamais o objeto/payload: seria o caminho mais fácil para a
    // chave vazar para o log.
    const detail =
      error instanceof AsaasError
        ? error.message
        : error?.message || "Falha desconhecida ao falar com o gateway.";
    await recordCheck(db, { status: "error", detail });
    return { ok: false, detail };
  }
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

router.get("/api/integrations/asaas", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  res.json(await statusPayload(req, db));
}));

// WhatsApp Business Cloud API: configuração segura por tenant. O GET nunca
// retorna o access token, apenas a máscara e o último diagnóstico.
router.get("/api/integrations/whatsapp", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  res.json(await whatsappCloudStatus(db));
}));

router.put("/api/integrations/whatsapp", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  if (!validateBody(whatsappCloudSaveSchema, req, res)) return;
  const current = await whatsappCloudStatus(db);
  const { access_token: accessToken, phone_number_id: phoneNumberId, business_account_id: businessAccountId, enabled } = req.body;
  const finalPhoneNumberId = phoneNumberId === undefined ? current.phone_number_id : phoneNumberId;
  if (enabled === true && (!accessToken && !current.configured || !finalPhoneNumberId)) {
    return res.status(400).json({ error: "Cadastre o token de acesso e o ID do número do WhatsApp Business antes de ativar a integração." });
  }
  await saveWhatsAppCloudIntegration(db, { accessToken, phoneNumberId, businessAccountId, enabled, userId: req.user?.id });
  res.json(await whatsappCloudStatus(db));
}));

router.post("/api/integrations/whatsapp/test", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  res.json(await testWhatsAppCloudConnection(db));
}));

router.delete("/api/integrations/whatsapp", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  if (req.body?.confirm !== true && req.body?.confirm !== "true") {
    return res.status(400).json({ error: "Confirmação obrigatória: envie { \"confirm\": true }." });
  }
  await removeWhatsAppCloudIntegration(db);
  res.json(await whatsappCloudStatus(db));
}));

// ---------------------------------------------------------------------------
// Gravação
// ---------------------------------------------------------------------------

router.put("/api/integrations/asaas", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  if (!validateBody(integrationSaveSchema, req, res)) return;

  const { api_key: apiKey, webhook_token: webhookToken, environment, enabled } = req.body;
  const current = await integrationStatus(db);

  // Ligar sem chave deixaria a integração num estado que só se revela quebrado
  // no primeiro checkout do cliente final — o serviço já derruba `enabled` sem
  // segredo, mas silenciosamente. Melhor explicar agora.
  if (enabled === true && !apiKey && !current.configured) {
    return res.status(400).json({
      error: "Cadastre a chave da API do Asaas antes de ativar a cobrança online."
    });
  }

  await saveIntegration(db, {
    apiKey,
    webhookToken,
    environment,
    enabled,
    userId: req.user?.id
  });

  // Handshake só quando a chave mudou: trocar apenas ambiente ou o interruptor
  // não justifica uma ida à rede (e o Asaas contabiliza chamadas).
  const check = apiKey ? await handshake(db) : null;

  res.json(await statusPayload(req, db, check ? { check } : {}));
}));

// Handshake sob demanda: o botão "testar conexão" da tela. Serve para o caso em
// que a chave era válida e deixou de ser (revogada no painel do Asaas), que
// nenhum evento nosso detecta sozinho.
router.post("/api/integrations/asaas/test", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  const { ok, detail } = await handshake(db);
  res.json({ ok, detail });
}));

// Gera o token do webhook em vez de deixar a clínica inventar um.
//
// O valor em claro aparece nesta resposta e SÓ nesta: depois de salvo ele fica
// cifrado no cofre e é decifrado apenas pelo webhook, ao comparar com o header
// que o Asaas ecoa. O GET nunca o devolve. Se a clínica perder o valor antes de
// colar no painel, o caminho é gerar outro — não recuperar este.
router.post("/api/integrations/asaas/webhook-token", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  // 32 bytes de aleatoriedade criptográfica em base64url: cabe no campo do
  // painel do Asaas (sem caractere que precise de escape) e é inadivinhável.
  const token = crypto.randomBytes(32).toString("base64url");
  await saveIntegration(db, { webhookToken: token, userId: req.user?.id });
  res.json(
    await statusPayload(req, db, {
      webhook_token: token,
      warning:
        "Copie o token agora e cadastre-o no painel do Asaas. Ele não será exibido novamente."
    })
  );
}));

// ---------------------------------------------------------------------------
// Remoção
// ---------------------------------------------------------------------------

// Apagar a credencial derruba a cobrança online da clínica inteira, e o segredo
// cifrado não tem como voltar. Por isso a confirmação explícita no corpo: um
// DELETE disparado por engano (ou por um clique duplo na tela) não pode ser
// suficiente.
router.delete("/api/integrations/asaas", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  const confirm = req.body?.confirm;
  if (confirm !== true && confirm !== "true") {
    return res.status(400).json({
      error:
        "Confirmação obrigatória: envie { \"confirm\": true }. Remover a credencial desativa a cobrança online da clínica e a chave precisará ser cadastrada de novo."
    });
  }
  await removeIntegration(db);
  res.json(await statusPayload(req, db));
}));

export default router;
