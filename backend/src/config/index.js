// Configuração central: variáveis de ambiente, constantes de domínio e caminhos.
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config();
dotenv.config({ path: path.join(__dirname, "../../../.env") });

export const PORT = process.env.PORT || 4000;
export const isProduction = process.env.NODE_ENV === "production";
export const API_BIND_HOST = process.env.API_BIND_HOST || (isProduction ? "0.0.0.0" : "127.0.0.1");

// Valor padrão usado apenas em desenvolvimento local. Nunca deve ser aceito em produção.
export const DEV_AUTH_SECRET = "aura-clinic-dev-secret";

export const AUTH_SECRET =
  process.env.AUTH_SECRET || (isProduction ? "" : DEV_AUTH_SECRET);
if (!AUTH_SECRET) {
  throw new Error("AUTH_SECRET é obrigatória em produção. Defina-a no ambiente (.env).");
}
// Em produção, bloqueia o boot se o segredo for o default de desenvolvimento
// (evita rodar em produção com um segredo público/previsível).
if (isProduction && AUTH_SECRET === DEV_AUTH_SECRET) {
  throw new Error(
    "AUTH_SECRET não pode ser o valor padrão de desenvolvimento em produção. Defina um segredo forte no ambiente (.env)."
  );
}
if (isProduction && Buffer.byteLength(AUTH_SECRET, "utf8") < 32) {
  throw new Error("AUTH_SECRET deve ter pelo menos 32 bytes em produção.");
}

// Guardas de deploy: opções que existem para a suíte/local nunca podem ser
// habilitadas por acidente numa instância pública.
const insecureTestEnvironment = process.env.ALLOW_INSECURE_TEST_ENV === "true";
if (isProduction && process.env.DISABLE_RATE_LIMIT === "true" && !insecureTestEnvironment) {
  throw new Error("DISABLE_RATE_LIMIT=true é proibido em produção.");
}
if (isProduction && process.env.ALLOW_LOCAL_AUTH_BYPASS === "true" && !insecureTestEnvironment) {
  throw new Error("ALLOW_LOCAL_AUTH_BYPASS=true é proibido em produção.");
}
if (isProduction && !process.env.CORS_ORIGIN) {
  throw new Error("CORS_ORIGIN é obrigatória em produção.");
}
if (isProduction && String(process.env.CORS_ORIGIN || "").split(",").some((origin) => origin.trim() === "*")) {
  throw new Error("CORS_ORIGIN não pode conter '*' em produção.");
}

// ---------- Integração com o Asaas (gateway de pagamento) ----------
//
// Dois níveis de credencial, de propósito:
//
// 1. PLATAFORMA — a conta da Monitence, que cobra a assinatura das clínicas.
//    Chave única, vem só do ambiente (nunca do banco, nunca de input).
// 2. CLÍNICA — cada clínica cadastra a PRÓPRIA chave para cobrar o cliente
//    final (sinal de agendamento, venda de joias). Fica no cofre criptografado
//    `tenant_integrations`, no schema da clínica. Ver services/asaas/vault.js.
//
// O dinheiro de cada nível cai na conta de quem cobrou — não há split nem
// subconta, o que evita a dependência de a conta raiz ser CNPJ.
export const ASAAS_BASE_URL =
  process.env.ASAAS_BASE_URL || "https://api-sandbox.asaas.com/v3";
export const ASAAS_API_KEY = process.env.ASAAS_API_KEY || "";
export const ASAAS_WEBHOOK_TOKEN = process.env.ASAAS_WEBHOOK_TOKEN || "";
// Timeout de rede. O Asaas responde em ~1s; 20s é folga para o pior caso sem
// prender um worker do Node indefinidamente.
export const ASAAS_TIMEOUT_MS = Number(process.env.ASAAS_TIMEOUT_MS || 20000);

// Meta WhatsApp Business Cloud API. Tokens e IDs das clínicas ficam no cofre
// por tenant, nunca no .env e nunca são devolvidos pela API.
export const WHATSAPP_GRAPH_BASE_URL = (process.env.WHATSAPP_GRAPH_BASE_URL || "https://graph.facebook.com").replace(/\/+$/, "");
export const WHATSAPP_GRAPH_API_VERSION = (process.env.WHATSAPP_GRAPH_API_VERSION || "v23.0").replace(/^\/+|\/+$/g, "");

// E-mail transacional via Resend. Esta é uma integração da plataforma: a
// chave fica apenas no ambiente do servidor e nunca é enviada ao navegador ou
// armazenada por clínica. Sem as duas variáveis, a fila continua no modo
// assistido ("ready"), sem débito de créditos nem tentativa de envio.
export const RESEND_API_KEY = (process.env.RESEND_API_KEY || "").trim();
export const EMAIL_FROM = (process.env.EMAIL_FROM || "").trim();
export const RESEND_API_URL = (process.env.RESEND_API_URL || "https://api.resend.com").trim().replace(/\/+$/, "");
export const EMAIL_TIMEOUT_MS = Math.min(Math.max(Number(process.env.EMAIL_TIMEOUT_MS || 15000), 1000), 60000);
export const resendEmailEnabled = Boolean(RESEND_API_KEY && EMAIL_FROM);

if ((RESEND_API_KEY || EMAIL_FROM) && !resendEmailEnabled) {
  console.warn("[email] Configure RESEND_API_KEY e EMAIL_FROM juntos; o envio transacional permanecerá desativado até lá.");
}

if (isProduction && !process.env.SMTP_VAULT_KEY) {
  console.warn(
    "[email] SMTP_VAULT_KEY não definida: a senha SMTP será cifrada com AUTH_SECRET. Defina uma chave dedicada antes de rotacionar AUTH_SECRET."
  );
}

// A integração da plataforma só liga com chave E token de webhook. Sem o token
// o webhook seria uma rota pública capaz de marcar fatura como paga — por isso
// o par é indivisível: falta um, a integração fica desligada inteira.
export const asaasPlatformEnabled = Boolean(ASAAS_API_KEY && ASAAS_WEBHOOK_TOKEN);

if (isProduction && ASAAS_API_KEY && !ASAAS_WEBHOOK_TOKEN) {
  throw new Error(
    "ASAAS_API_KEY definida sem ASAAS_WEBHOOK_TOKEN. Sem o token o webhook do Asaas fica aberto: qualquer POST marcaria assinatura como paga. Defina os dois (e cadastre o mesmo token no painel do Asaas)."
  );
}
// Sandbox em produção quase sempre é engano de deploy (cobra de mentira e o
// cliente acha que pagou). Avisa alto, mas não derruba o boot: pode ser
// homologação intencional.
if (isProduction && ASAAS_BASE_URL.includes("sandbox")) {
  console.warn(
    "[Asaas] ATENÇÃO: rodando em produção apontando para o SANDBOX. Defina ASAAS_BASE_URL=https://api.asaas.com/v3 para cobrar de verdade."
  );
}

// Endereço público da API, SEM o /api final (as rotas já declaram o caminho
// completo). Serve para dizer à clínica qual URL cadastrar como webhook no
// painel do Asaas dela: <PUBLIC_API_URL>/api/webhooks/asaas/<slug>.
export const PUBLIC_API_URL = (
  process.env.PUBLIC_API_URL || `http://localhost:${PORT}`
).replace(/\/+$/, "");
// Origem do painel usada nos retornos do Checkout Asaas. Na instalação atual
// API e SPA compartilham o domínio, por isso PUBLIC_API_URL é um fallback
// seguro; instalações separadas podem definir PUBLIC_APP_URL explicitamente.
export const PUBLIC_APP_URL = (
  process.env.PUBLIC_APP_URL || PUBLIC_API_URL
).replace(/\/+$/, "");

// Sem esta variável em produção, a tela de Integrações entrega à clínica uma
// URL apontando para localhost. Ela cadastra, o Asaas nunca consegue entregar,
// e o sintoma aparece só lá na frente como "o pagamento não baixa" — bem longe
// da causa. Por isso o aviso é explícito no boot.
if (isProduction && (!process.env.PUBLIC_API_URL || !PUBLIC_API_URL.startsWith("https://")) && !insecureTestEnvironment) {
  throw new Error("PUBLIC_API_URL deve ser uma URL HTTPS pública em produção.");
}

// Sem ASAAS_VAULT_KEY o cofre das credenciais das clínicas deriva do
// AUTH_SECRET. Não quebra nada hoje, e definir a variável depois é seguro (o
// cofre lê pelas duas chaves e regrava sozinho — ver services/asaas/vault.js).
// O que continua valendo é o acoplamento: enquanto ela não existir, rotacionar o
// AUTH_SECRET torna ilegível toda credencial já salva.
if (isProduction && !process.env.ASAAS_VAULT_KEY) {
  console.warn(
    "[Asaas] ASAAS_VAULT_KEY não definida: o cofre das credenciais das clínicas está derivado do AUTH_SECRET. Defina uma chave dedicada — enquanto não definir, trocar o AUTH_SECRET obriga cada clínica a recadastrar a chave do gateway."
  );
}

// Diretório onde os uploads (fotos, PDFs de termos) são gravados/servidos.
// __dirname aqui é src/config, então subimos um nível para src/data/uploads.
//
// TRANSITÓRIO: com o R2 configurado a ESCRITA vai toda para o bucket; o disco
// continua existindo porque a LEITURA cai nele quando o objeto não está no R2
// (o parque de arquivos antigo só sobe no script de migração, que roda depois
// do deploy). Ver services/storage/index.js.
export const uploadsDir = path.join(__dirname, "..", "data", "uploads");
fs.mkdirSync(uploadsDir, { recursive: true });
export const privateUploadsDir = path.join(__dirname, "..", "data", "private-uploads");
fs.mkdirSync(privateUploadsDir, { recursive: true });

// ---------- Object storage (Cloudflare R2, S3-compatível) ----------
//
// Dois buckets, por motivo de exposição e não de organização:
//
// 1. PÚBLICO  — imagem de joia, catálogo, banner, logo. Servido por domínio
//    próprio (CDN) direto ao navegador, sem passar pela API.
// 2. PRIVADO  — comprovante de pagamento, foto clínica, PDF de termo. Nunca
//    ganha URL pública: sai sempre por `GET /api/private-files/:filename`, que
//    confere papel e propósito antes de deixar o byte passar.
export const R2_ENDPOINT = (process.env.R2_ENDPOINT || "").trim().replace(/\/+$/, "");
export const R2_ACCESS_KEY_ID = (process.env.R2_ACCESS_KEY_ID || "").trim();
export const R2_SECRET_ACCESS_KEY = (process.env.R2_SECRET_ACCESS_KEY || "").trim();
export const R2_BUCKET_PUBLIC = (process.env.R2_BUCKET_PUBLIC || "").trim();
export const R2_BUCKET_PRIVATE = (process.env.R2_BUCKET_PRIVATE || "").trim();
// Domínio próprio na frente do bucket público (ex.: https://cdn.dominio.com).
// Sem barra no fim: a chave já entra com a sua.
export const R2_PUBLIC_BASE_URL = (process.env.R2_PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");

// Nomear um bucket é a declaração de intenção de usar o R2. A partir daí, o
// conjunto é indivisível — endpoint, credencial, OS DOIS buckets e o domínio
// público. Meia configuração produz o pior dos mundos: upload que "funciona" e
// devolve URL quebrada, ou arquivo privado gravado num bucket que não existe.
const r2Declared = Boolean(R2_BUCKET_PUBLIC || R2_BUCKET_PRIVATE);
const r2Missing = [
  ["R2_ENDPOINT", R2_ENDPOINT],
  ["R2_ACCESS_KEY_ID", R2_ACCESS_KEY_ID],
  ["R2_SECRET_ACCESS_KEY", R2_SECRET_ACCESS_KEY],
  ["R2_BUCKET_PUBLIC", R2_BUCKET_PUBLIC],
  ["R2_BUCKET_PRIVATE", R2_BUCKET_PRIVATE],
  ["R2_PUBLIC_BASE_URL", R2_PUBLIC_BASE_URL]
].filter(([, value]) => !value).map(([name]) => name);

// Mesma régua do par ASAAS_API_KEY/ASAAS_WEBHOOK_TOKEN: em produção, meia
// integração derruba o boot. Em desenvolvimento, avisa e cai para o disco —
// quem clonou o projeto não precisa de bucket para rodar.
if (r2Declared && r2Missing.length) {
  const detalhe = `R2 parcialmente configurado. Falta(m): ${r2Missing.join(", ")}.`;
  if (isProduction) {
    throw new Error(
      `${detalhe} Ou configure tudo, ou apague R2_BUCKET_PUBLIC/R2_BUCKET_PRIVATE para seguir no disco local. Meia configuração grava arquivo que ninguém consegue ler depois.`
    );
  }
  console.warn(`[storage] ${detalhe} Usando DISCO LOCAL.`);
}

// Ligado só com a configuração inteira de pé.
export const r2Enabled = r2Declared && r2Missing.length === 0;

if (isProduction && !r2Enabled && !insecureTestEnvironment) {
  throw new Error("Cloudflare R2 é obrigatório em produção para isolar e persistir uploads públicos e privados.");
}

// ---------- Assistente de IA ----------
// As chaves pertencem exclusivamente ao ambiente do servidor. Nunca são
// persistidas no tenant nem devolvidas pelas rotas. `auto` prefere OpenAI e
// usa Gemini quando somente ele estiver configurado.
export const AI_PROVIDER = (process.env.AI_PROVIDER || "auto").trim().toLowerCase();
export const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || "").trim();
export const OPENAI_MODEL = (process.env.OPENAI_MODEL || "gpt-4o-mini").trim();
export const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || "").trim();
export const GEMINI_MODEL = (process.env.GEMINI_MODEL || "gemini-2.0-flash-lite").trim();
export const AI_TIMEOUT_MS = Math.min(Math.max(Number(process.env.AI_TIMEOUT_MS || 20000), 1000), 60000);
export const AI_MAX_OUTPUT_TOKENS = Math.min(Math.max(Number(process.env.AI_MAX_OUTPUT_TOKENS || 500), 64), 1200);

// Categorias principais de joalherias (usadas no catálogo e validações).
export const JEWELRY_CATEGORIES = [
  "Labret",
  "Segmento",
  "Argola",
  "Conector",
  "Argolas",
  "Barbell Reto",
  "Barbell Curvo",
  "Nostril",
  "Topo",
  "Topos",
  "Microdermal",
  "Transversal",
  "Surface",
  "Ouro 14k",
  "Ouro 18k"
];

export const ARGOLA_SUBCATEGORIES = [
  "Segmento",
  "Clicker",
  "D-Ring",
  "Captive",
  "Hinged Ring"
];
