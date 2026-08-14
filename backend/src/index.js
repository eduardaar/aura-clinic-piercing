// Bootstrap da API Aura Clinic: middlewares globais, montagem dos routers,
// aplicação do schema e inicialização do servidor. Toda a lógica de negócio
// vive em src/services e cada domínio de rota em src/routes.
import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import { fileURLToPath } from "url";
import { PORT, isProduction } from "./config/index.js";
import { ensurePlatform, applyPlatformMigrations, applySchemaToAllTenants } from "./services/tenants.js";
import { loadPlansFromDb } from "./services/plans.js";
import { startReconcileWorker } from "./services/asaas/reconcile.js";
import { apiLimiter, webhookLimiter } from "./middleware/rateLimit.js";

// Routers por domínio.
import healthRoutes from "./routes/health.js";
import authRoutes from "./routes/auth.js";
import proceduresRoutes from "./routes/procedures.js";
import clientsRoutes from "./routes/clients.js";
import catalogRoutes from "./routes/catalog.js";
import uploadsRoutes from "./routes/uploads.js";
import bookingRoutes from "./routes/booking.js";
import servicesRoutes from "./routes/services.js";
import availabilityRoutes from "./routes/availability.js";
import scheduleBlocksRoutes from "./routes/scheduleBlocks.js";
import alertsRoutes from "./routes/alerts.js";
import dashboardRoutes from "./routes/dashboard.js";
import erpRoutes from "./routes/erp.js";
import usersRoutes from "./routes/users.js";
import adminRoutes from "./routes/admin.js";
import optionsRoutes from "./routes/options.js";
import professionalsRoutes from "./routes/professionals.js";
import appointmentsRoutes from "./routes/appointments.js";
import salesRoutes from "./routes/sales.js";
import termsRoutes from "./routes/terms.js";
import postcareRoutes from "./routes/postcare.js";
import jewelryRoutes from "./routes/jewelry.js";
import financeRoutes from "./routes/finance.js";
import platformRoutes from "./routes/platform.js";
import errorLogsRoutes from "./routes/errorLogs.js";
import storeRoutes from "./routes/store.js";
import notificationsRoutes from "./routes/notifications.js";
import paymentsRoutes from "./routes/payments.js";
import reportsRoutes from "./routes/reports.js";
import webhookRoutes from "./routes/webhooks.js";
import billingRoutes from "./routes/billing.js";
import integrationsRoutes from "./routes/integrations.js";
import landingRoutes from "./routes/landing.js";
import planAdminRoutes from "./routes/planAdmin.js";
import accountAdminRoutes from "./routes/accountAdmin.js";
import platformFinanceRoutes from "./routes/platformFinance.js";
import supportRoutes from "./routes/support.js";
import aiAssistantRoutes from "./routes/aiAssistant.js";
import privacyRoutes from "./routes/privacy.js";
import jobsRoutes from "./routes/jobs.js";
import { startJobWorker } from "./services/jobWorker.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

// Em produção a API roda atrás de Cloudflare + nginx (2 hops que preenchem o
// X-Forwarded-For). Confiar nesse número exato de proxies faz req.ip ser o IP
// REAL do cliente — sem isso o express-rate-limit agrupa todo mundo no IP do
// proxy (um balde único) e um pico coletivo derruba o limite pra todos, além de
// resistir a spoofing (só os 2 hops mais próximos são confiáveis). Em dev o
// acesso é direto (0 hops). Ajustável via TRUST_PROXY_HOPS se a topologia mudar.
app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS ?? (isProduction ? 2 : 0)));

// ---------- Middlewares globais ----------

// Cabeçalhos de segurança (Helmet). crossOriginResourcePolicy relaxado para
// permitir que o frontend consuma as imagens servidas em /uploads.
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
// CORS restrito à(s) origem(ns) configurada(s) em CORS_ORIGIN (separadas por vírgula).
app.use(cors({ origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : true, credentials: true }));
app.use(express.json({ limit: "8mb" }));
app.use((_req, res, next) => {
  res.charset = "utf-8";
  next();
});
// TRANSITÓRIO: com o R2 ligado, upload novo nenhum passa por aqui — a escrita
// vai toda para o bucket e a URL devolvida é a do CDN. Este static continua no
// ar porque o banco está cheio de `/uploads/<arquivo>` gravados antes da
// migração, e a migração roda DEPOIS do deploy. Só pode ser removido quando
// nenhuma linha de imagem apontar mais para um caminho relativo.
app.use("/uploads", express.static(path.join(__dirname, "data", "uploads")));

// Webhooks de gateway ANTES do rate limit global, com limite próprio: o Asaas
// entrega de poucos IPs fixos e todas as clínicas caem no mesmo bucket, então
// o teto global devolveria 429 numa rajada — e 429 faz o provedor reentregar e
// acabar pausando a fila da conta. A rota se autentica pelo token do provedor.
app.use("/api/webhooks", webhookLimiter);
app.use(webhookRoutes);

// Rate limit global leve em toda a API (300 req/min por IP). O /login mantém
// o limite estrito próprio, aplicado no router de auth.
app.use("/api", apiLimiter);

// ---------- Montagem dos routers ----------
// Cada router declara seus caminhos absolutos (/api/...), preservando o comportamento original.
app.use(healthRoutes);
app.use(proceduresRoutes);
app.use(clientsRoutes);
app.use(authRoutes);
app.use(catalogRoutes);
app.use(uploadsRoutes);
app.use(bookingRoutes);
app.use(servicesRoutes);
app.use(availabilityRoutes);
app.use(scheduleBlocksRoutes);
app.use(alertsRoutes);
app.use(dashboardRoutes);
app.use(erpRoutes);
app.use(usersRoutes);
app.use(adminRoutes);
app.use(optionsRoutes);
app.use(professionalsRoutes);
app.use(appointmentsRoutes);
app.use(salesRoutes);
app.use(termsRoutes);
app.use(postcareRoutes);
app.use(jewelryRoutes);
app.use(financeRoutes);
app.use(platformRoutes);
app.use(errorLogsRoutes);
app.use(storeRoutes);
app.use(notificationsRoutes);
app.use(paymentsRoutes);
app.use(reportsRoutes);
app.use(billingRoutes);
app.use(integrationsRoutes);
app.use(landingRoutes);
// Painel do super-admin: planos, contas/cotas, financeiro e suporte.
app.use(planAdminRoutes);
app.use(accountAdminRoutes);
app.use(platformFinanceRoutes);
app.use(supportRoutes);
app.use(aiAssistantRoutes);
app.use(privacyRoutes);
app.use(jobsRoutes);

// ---------- Inicialização ----------
// 1) Garante o schema de controle `platform` (tenants + superadmin inicial).
// 2) Aplica o schema.sql idempotente legado em TODOS os tenants. Migrations
//    incrementais só rodam no boot quando RUN_MIGRATIONS_ON_BOOT=true; o
//    pipeline de deploy deve chamá-las explicitamente antes de subir a API.
// 3) Liga o worker de conciliação com o Asaas (rede de segurança para webhook
//    perdido). DESLIGADO por padrão: só sobe com ASAAS_RECONCILE_ENABLED=true.
//    Depende do schema já aplicado, por isso vem depois dos dois passos acima.
if (process.env.SKIP_DATABASE_BOOTSTRAP !== "true") {
  await ensurePlatform();
  if (process.env.RUN_MIGRATIONS_ON_BOOT === "true") {
    await applyPlatformMigrations();
  }
  await applySchemaToAllTenants();
} else {
  console.log("[platform] Bootstrap de banco ignorado por SKIP_DATABASE_BOOTSTRAP=true.");
}
// 3) Carrega os planos do banco para o registro em memória. A partir daqui o
//    BANCO é a fonte da verdade de preço, features e limites; se a leitura
//    falhar, o registro fica com os planos-semente do código — nunca vazio,
//    porque lista vazia trancaria todas as clínicas fora do sistema.
await loadPlansFromDb();
startReconcileWorker();
startJobWorker();
app.listen(PORT, () => {
  console.log(`Aura Clinic API em http://localhost:${PORT}`);
});
