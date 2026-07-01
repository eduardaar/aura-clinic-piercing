// Bootstrap da API Aura Clinic: middlewares globais, montagem dos routers,
// aplicação do schema e inicialização do servidor. Toda a lógica de negócio
// vive em src/services e cada domínio de rota em src/routes.
import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import { fileURLToPath } from "url";
import { PORT } from "./config/index.js";
import { runSchema } from "./db/sqliteCompat.js";

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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

// ---------- Middlewares globais ----------

// Cabeçalhos de segurança (Helmet). crossOriginResourcePolicy relaxado para
// permitir que o frontend consuma as imagens servidas em /uploads.
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
// CORS restrito à(s) origem(ns) configurada(s) em CORS_ORIGIN (separadas por vírgula).
app.use(cors({ origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : true }));
app.use(express.json({ limit: "8mb" }));
app.use((_req, res, next) => {
  res.charset = "utf-8";
  next();
});
app.use("/uploads", express.static(path.join(__dirname, "data", "uploads")));

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

// ---------- Inicialização ----------
await runSchema();
app.listen(PORT, () => {
  console.log(`Aura Clinic API em http://localhost:${PORT}`);
});
