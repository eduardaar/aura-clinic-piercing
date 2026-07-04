import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import { getDb } from "./database.js";
import { normalizeDbValue } from "./text-normalizer.js";
import { query as pgQuery, runCoreMigrations, testConnection } from "./database/connection.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
app.get("/api/health/db", async (_req, res) => {
  try {
    await testConnection();

    res.json({
      ok: true,
      database: "connected",
    });
  } catch (error) {
    console.error("DB health error:", error);

    res.status(500).json({
      ok: false,
      database: "error",
      message: error?.message || String(error),
      code: error?.code || null,
      detail: error?.detail || null,
    });
  }
});
const uploadsDir = path.join(__dirname, "data", "uploads");
fs.mkdirSync(uploadsDir, { recursive: true });
const upload = multer({ dest: uploadsDir });
const PORT = process.env.PORT || 4000;
const AUTH_SECRET = process.env.AUTH_SECRET || "aura-clinic-dev-secret";
const isProduction = process.env.NODE_ENV === "production";
const JEWELRY_CATEGORIES = [
  "Labret",
  "Argolas",
  "Barbell Reto",
  "Barbell Curvo",
  "Nostril",
  "Topos",
  "Microdermal",
  "Surface",
  "Ouro 14k",
  "Ouro 18k"
];
const ARGOLA_SUBCATEGORIES = ["Segmento", "Clicker", "D-Ring", "Captive", "Hinged Ring"];

app.use(cors());
app.use(express.json({ limit: "8mb" }));
app.use((_req, res, next) => {
  res.charset = "utf-8";
  next();
});
app.use("/uploads", express.static(path.join(__dirname, "data", "uploads")));

const withDb = (handler) => async (req, res) => {
  const db = await getDb();
  const originalJson = res.json.bind(res);
  res.json = (payload) => originalJson(normalizeDbValue(payload));
  try {
    if (requiresAuth(req)) {
      const user = await authenticateRequest(req, db);
      if (!user) return res.status(401).json({ error: "SessÃƒÂ£o invÃƒÂ¡lida ou expirada." });
      req.user = user;
    }
    await handler(req, res, db);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: process.env.NODE_ENV === "production" ? "Erro interno no servidor." : `Erro interno: ${error.message}`
    });
  } finally {
    await db.close();
  }
};

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, app: "Aura Clinic", timestamp: new Date().toISOString() });
});

const pg = (handler) => async (req, res) => {
  try {
    await handler(req, res);
  } catch (error) {
    console.error("PostgreSQL API error:", error);
    res.status(500).json({ error: error?.message || "Erro interno no PostgreSQL." });
  }
};

const rows = async (sql, params = []) => (await pgQuery(sql, params)).rows;
const one = async (sql, params = []) => (await pgQuery(sql, params)).rows[0] || null;
const money = (value) => Number(value || 0);
const bool = (value, fallback = true) => value === undefined ? fallback : Boolean(value);

function productPayload(body = {}) {
  const rawVariants = Array.isArray(body.variants) ? body.variants : [];
  const variants = rawVariants.map((variant, index) => ({
    id: variant.id || `${Date.now()}-${index + 1}`,
    sku: variant.sku || `${body.sku || "AURA"}-${String(index + 1).padStart(2, "0")}`,
    variation_name: variant.variation_name || `Variação ${index + 1}`,
    material: variant.material || body.material || "",
    color: variant.color || body.color || "",
    stone_color: variant.stone_color || "",
    side: variant.side || "",
    size: variant.size || body.size || "",
    thickness: variant.thickness || body.thickness || "",
    length: variant.length || body.length || body.stem_length || "",
    diameter: variant.diameter || body.diameter || "",
    thread_type: variant.thread_type || body.thread_type || "",
    supplier: variant.supplier || body.supplier || "",
    cost_value: money(variant.cost_value ?? body.cost_value),
    sale_value: money(variant.sale_value ?? body.sale_value),
    quantity: Number(variant.quantity || 0),
    low_stock_threshold: Number(variant.low_stock_threshold || body.low_stock_threshold || body.min_stock || 1),
    status: variant.status || "disponível",
    is_active: bool(variant.is_active, true)
  }));
  const firstVariant = variants[0] || {};
  const quantity = variants.length ? variants.reduce((sum, item) => sum + Number(item.quantity || 0), 0) : Number(body.quantity || 0);
  const sku = String(body.sku || firstVariant.sku || "").trim() || `AURA-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  return {
    name: body.name || "Produto Sem Nome",
    description: body.description || "",
    category: body.category || "",
    subcategory: body.subcategory || "",
    material: body.material || firstVariant.material || "",
    color: body.color || firstVariant.color || "",
    size: body.size || firstVariant.size || "",
    thickness: body.thickness || firstVariant.thickness || "",
    length: body.stem_length || body.length || firstVariant.length || "",
    diameter: body.diameter || firstVariant.diameter || "",
    thread_type: body.thread_type || firstVariant.thread_type || "",
    sku,
    image_url: body.image_url || body.photo_url || "",
    photo_url: body.photo_url || body.image_url || "",
    sale_value: money(body.sale_value ?? firstVariant.sale_value),
    cost_value: money(body.cost_value ?? firstVariant.cost_value),
    quantity,
    min_stock: Number(body.min_stock || body.low_stock_threshold || 1),
    supplier: body.supplier || firstVariant.supplier || "",
    notes: body.notes || "",
    status: body.status || "disponÃƒÂ­vel",
    is_catalog_active: bool(body.is_catalog_active, true),
    is_published: bool(body.is_published, true),
    is_featured: bool(body.is_featured, false),
    is_new: bool(body.is_new, false),
    is_most_wanted: bool(body.is_most_wanted, false),
    is_promotion: bool(body.is_promotion, false),
    is_last_units: bool(body.is_last_units, false),
    variants
  };
}

function productSelect() {
  return `
    SELECT *,
      image_url AS photo_url,
      length AS stem_length,
      min_stock AS low_stock_threshold,
      CASE
        WHEN quantity <= 0 THEN 'esgotado'
        WHEN quantity <= min_stock THEN 'baixo estoque'
        ELSE status
      END AS computed_status
    FROM products
  `;
}

app.get("/api/dashboard", pg(async (_req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const stats = await one(`
    SELECT
      COUNT(*) FILTER (WHERE appointment_date = CURRENT_DATE) AS today_count,
      COUNT(*) FILTER (WHERE status = 'pendente') AS pending_count,
      COUNT(*) FILTER (WHERE status = 'confirmado') AS confirmed_count,
      COALESCE(SUM(deposit_value) FILTER (WHERE TO_CHAR(appointment_date, 'YYYY-MM') = $1), 0) AS deposit_received,
      COALESCE(SUM(total_value) FILTER (WHERE TO_CHAR(appointment_date, 'YYYY-MM') = $1), 0) AS month_forecast
    FROM appointments
  `, [month]);
  const critical = await one("SELECT COUNT(*) AS total FROM products WHERE quantity <= min_stock");
  const revenue = await one("SELECT COALESCE(SUM(amount), 0) AS total FROM financial_transactions WHERE type = 'receita' AND transaction_date = CURRENT_DATE");
  const upcoming = await rows(`
    SELECT a.*, COALESCE(c.name, a.client_name, 'Cliente') AS client_name
    FROM appointments a
    LEFT JOIN clients c ON c.id = a.client_id
    WHERE a.appointment_date >= CURRENT_DATE
    ORDER BY a.appointment_date, a.appointment_time
    LIMIT 8
  `);
  res.json({
    stats: {
      todayCount: Number(stats?.today_count || 0),
      pendingCount: Number(stats?.pending_count || 0),
      confirmedCount: Number(stats?.confirmed_count || 0),
      depositReceived: Number(stats?.deposit_received || 0),
      monthForecast: Number(stats?.month_forecast || 0),
      revenue: Number(revenue?.total || 0),
      criticalStock: Number(critical?.total || 0),
      lowStockCount: Number(critical?.total || 0)
    },
    adminDashboard: {
      upcomingAppointments: upcoming,
      criticalStock: await rows("SELECT * FROM products WHERE quantity <= min_stock ORDER BY quantity ASC LIMIT 8"),
      birthdaysMonth: [],
      procedureRanking: [],
      jewelryRanking: [],
      categoryRanking: [],
      returnClients: [],
      dailyRevenue: [],
      weeklyRevenue: [],
      monthlyRevenue: []
    }
  });
}));

function clientSelect() {
  return `SELECT id, name, phone, whatsapp, instagram, email, birth_date, cpf, notes, created_at, updated_at FROM clients`;
}

function clientValues(body = {}) {
  return [
    body.name || "",
    body.phone || "",
    body.whatsapp || "",
    body.instagram || "",
    body.email || "",
    body.birth_date || "",
    body.cpf || "",
    body.notes || ""
  ];
}

app.get("/api/clients", pg(async (_req, res) => {
  const clients = await rows(`${clientSelect()} ORDER BY name`);
  res.json(clients);
}));

app.get("/api/clients/:id", pg(async (req, res) => {
  const client = await one(`${clientSelect()} WHERE id = $1`, [req.params.id]);
  if (!client) return res.status(404).json({ error: "Cliente nÃ£o encontrado." });
  client.history = await rows("SELECT *, client_name AS full_name FROM appointments WHERE client_id = $1 ORDER BY appointment_date DESC, appointment_time DESC", [req.params.id]);
  client.payments = await rows("SELECT * FROM financial_transactions WHERE client_id = $1 ORDER BY transaction_date DESC", [req.params.id]);
  client.medicalRecords = await rows("SELECT * FROM client_medical_records WHERE client_id = $1 ORDER BY record_date DESC, id DESC", [req.params.id]);
  client.loyalty = { points: 0, tier: "Cliente Aura", history: [] };
  res.json(client);
}));

app.post("/api/clients", pg(async (req, res) => {
  const body = req.body || {};
  if (!body.name?.trim()) {
    return res.status(400).json({ error: "Informe o nome do cliente." });
  }
  const client = await one(
    `INSERT INTO clients (name, phone, whatsapp, instagram, email, birth_date, cpf, notes)
     VALUES ($1, $2, $3, $4, $5, NULLIF($6, '')::date, $7, $8)
     RETURNING id, name, phone, whatsapp, instagram, email, birth_date, cpf, notes, created_at, updated_at`,
    clientValues(body)
  );
  res.status(201).json(client);
}));

app.put("/api/clients/:id", pg(async (req, res) => {
  const body = req.body || {};
  if (!body.name?.trim()) {
    return res.status(400).json({ error: "Informe o nome do cliente." });
  }
  const client = await one(
    `UPDATE clients SET name = $1, phone = $2, whatsapp = $3, instagram = $4, email = $5,
      birth_date = NULLIF($6, '')::date, cpf = $7, notes = $8, updated_at = NOW()
     WHERE id = $9 RETURNING id, name, phone, whatsapp, instagram, email, birth_date, cpf, notes, created_at, updated_at`,
    [...clientValues(body), req.params.id]
  );
  if (!client) return res.status(404).json({ error: "Cliente nÃ£o encontrado." });
  res.json(client);
}));

app.patch("/api/clients/:id", pg(async (req, res) => {
  const current = await one(`${clientSelect()} WHERE id = $1`, [req.params.id]);
  if (!current) return res.status(404).json({ error: "Cliente nÃ£o encontrado." });
  const body = { ...current, ...(req.body || {}) };
  const client = await one(
    `UPDATE clients SET name = $1, phone = $2, whatsapp = $3, instagram = $4, email = $5,
      birth_date = NULLIF($6, '')::date, cpf = $7, notes = $8, updated_at = NOW()
     WHERE id = $9 RETURNING id, name, phone, whatsapp, instagram, email, birth_date, cpf, notes, created_at, updated_at`,
    [...clientValues(body), req.params.id]
  );
  res.json(client);
}));

app.delete("/api/clients/:id", pg(async (req, res) => {
  await pgQuery("DELETE FROM clients WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
}));

app.post("/api/clients/:id/medical-records", upload.fields([{ name: "before_photo", maxCount: 1 }, { name: "after_photo", maxCount: 1 }]), pg(async (req, res) => {
  const client = await one("SELECT id FROM clients WHERE id = $1", [req.params.id]);
  if (!client) return res.status(404).json({ error: "Cliente não encontrado." });
  const body = req.body || {};
  const beforePhoto = req.files?.before_photo?.[0] ? `/uploads/${req.files.before_photo[0].filename}` : "";
  const afterPhoto = req.files?.after_photo?.[0] ? `/uploads/${req.files.after_photo[0].filename}` : "";
  const record = await one(
    `INSERT INTO client_medical_records
      (client_id, appointment_id, record_date, piercing_history, jewelry_used, before_photo_url, after_photo_url, occurrences, guidance, allergies_notes, healing_evolution, returns_done)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [req.params.id, body.appointment_id || null, body.record_date || new Date().toISOString().slice(0, 10), body.piercing_history || "", body.jewelry_used || "", beforePhoto, afterPhoto, body.occurrences || "", body.guidance || "", body.allergies_notes || "", body.healing_evolution || "", body.returns_done || ""]
  );
  res.status(201).json(record);
}));

app.delete("/api/clients/:clientId/medical-records/:recordId", pg(async (req, res) => {
  await pgQuery("DELETE FROM client_medical_records WHERE id = $1 AND client_id = $2", [req.params.recordId, req.params.clientId]);
  res.json({ ok: true });
}));

function validateService(body = {}) {
  if (!body.name?.trim()) return "Informe o nome do serviço.";
  if (Number(body.base_price ?? 0) < 0) return "Preço não pode ser negativo.";
  if (Number(body.duration_minutes ?? 0) <= 0) return "Duração deve ser um número positivo.";
  return "";
}

function serviceValues(body = {}) {
  return [
    body.name || "",
    body.description || "",
    money(body.base_price ?? body.price),
    Number(body.duration_minutes || 40),
    bool(body.is_active ?? body.active, true)
  ];
}

function validateProcedure(body = {}) {
  if (!body.name?.trim()) return "Informe o nome do procedimento.";
  if (!body.service_id) return "Procedimento precisa ter um serviço vinculado.";
  if (Number(body.price ?? 0) < 0) return "Preço não pode ser negativo.";
  if (Number(body.duration_minutes ?? 0) <= 0) return "Duração deve ser um número positivo.";
  return "";
}

function procedureValues(body = {}) {
  return [
    Number(body.service_id),
    body.name || "",
    body.body_area || "",
    body.description || "",
    money(body.price),
    Number(body.duration_minutes || 40),
    body.aftercare_instructions || "",
    bool(body.is_active ?? body.active, true)
  ];
}

app.get("/api/services", pg(async (_req, res) => {
  res.json(await rows("SELECT id, name, description, base_price, duration_minutes, is_active, created_at, updated_at FROM services ORDER BY name"));
}));

app.get("/api/services/:id", pg(async (req, res) => {
  const service = await one("SELECT id, name, description, base_price, duration_minutes, is_active, created_at, updated_at FROM services WHERE id = $1", [req.params.id]);
  if (!service) return res.status(404).json({ error: "Serviço não encontrado." });
  res.json(service);
}));

app.post("/api/services", pg(async (req, res) => {
  const body = req.body || {};
  const error = validateService(body);
  if (error) return res.status(400).json({ error });
  const service = await one(
    `INSERT INTO services (name, description, base_price, duration_minutes, is_active)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, description, base_price, duration_minutes, is_active, created_at, updated_at`,
    serviceValues(body)
  );
  res.status(201).json(service);
}));

app.put("/api/services/:id", pg(async (req, res) => {
  const body = req.body || {};
  const error = validateService(body);
  if (error) return res.status(400).json({ error });
  const service = await one(
    `UPDATE services SET name = $1, description = $2, base_price = $3, duration_minutes = $4, is_active = $5, updated_at = NOW()
     WHERE id = $6
     RETURNING id, name, description, base_price, duration_minutes, is_active, created_at, updated_at`,
    [...serviceValues(body), req.params.id]
  );
  if (!service) return res.status(404).json({ error: "Serviço não encontrado." });
  res.json(service);
}));

app.delete("/api/services/:id", pg(async (req, res) => {
  await pgQuery("DELETE FROM services WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
}));

app.get("/api/procedures", pg(async (_req, res) => {
  res.json(await rows(`
    SELECT p.id, p.service_id, p.name, p.body_area, p.description, p.price, p.duration_minutes, p.aftercare_instructions, p.is_active, p.created_at, p.updated_at,
      s.name AS service_name
    FROM procedures p
    LEFT JOIN services s ON s.id = p.service_id
    ORDER BY s.name, p.name
  `));
}));

app.get("/api/procedures/:id", pg(async (req, res) => {
  const procedure = await one(`
    SELECT p.id, p.service_id, p.name, p.body_area, p.description, p.price, p.duration_minutes, p.aftercare_instructions, p.is_active, p.created_at, p.updated_at,
      s.name AS service_name
    FROM procedures p
    LEFT JOIN services s ON s.id = p.service_id
    WHERE p.id = $1
  `, [req.params.id]);
  if (!procedure) return res.status(404).json({ error: "Procedimento não encontrado." });
  res.json(procedure);
}));

app.post("/api/procedures", pg(async (req, res) => {
  const body = req.body || {};
  const error = validateProcedure(body);
  if (error) return res.status(400).json({ error });
  const procedure = await one(
    `INSERT INTO procedures (service_id, name, body_area, description, price, duration_minutes, aftercare_instructions, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, service_id, name, body_area, description, price, duration_minutes, aftercare_instructions, is_active, created_at, updated_at`,
    procedureValues(body)
  );
  res.status(201).json(procedure);
}));

app.put("/api/procedures/:id", pg(async (req, res) => {
  const body = req.body || {};
  const error = validateProcedure(body);
  if (error) return res.status(400).json({ error });
  const procedure = await one(
    `UPDATE procedures SET service_id = $1, name = $2, body_area = $3, description = $4, price = $5,
      duration_minutes = $6, aftercare_instructions = $7, is_active = $8, updated_at = NOW()
     WHERE id = $9
     RETURNING id, service_id, name, body_area, description, price, duration_minutes, aftercare_instructions, is_active, created_at, updated_at`,
    [...procedureValues(body), req.params.id]
  );
  if (!procedure) return res.status(404).json({ error: "Procedimento não encontrado." });
  res.json(procedure);
}));

app.delete("/api/procedures/:id", pg(async (req, res) => {
  await pgQuery("DELETE FROM procedures WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
}));

app.get(["/api/products", "/api/jewelry"], pg(async (req, res) => {
  const params = [];
  const clauses = [];
  if (req.query.search) {
    params.push(`%${req.query.search}%`);
    clauses.push(`(name ILIKE $${params.length} OR sku ILIKE $${params.length} OR category ILIKE $${params.length})`);
  }
  for (const field of ["category", "status", "material", "color", "size", "thickness"]) {
    if (req.query[field]) {
      params.push(req.query[field]);
      clauses.push(`${field} = $${params.length}`);
    }
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const products = await rows(`${productSelect()} ${where} ORDER BY category, name`, params);
  res.json(products.map((item) => ({ ...item, status: item.computed_status || item.status, variants: Array.isArray(item.variants) ? item.variants : [] })));
}));

app.post(["/api/products", "/api/jewelry"], pg(async (req, res) => {
  const item = productPayload(req.body);
  const product = await one(
    `INSERT INTO products
      (name, description, category, subcategory, material, color, size, thickness, length, diameter, thread_type, sku, image_url, photo_url,
       sale_value, cost_value, quantity, min_stock, supplier, notes, status, is_catalog_active, is_published, is_featured, is_new, is_most_wanted,
       is_promotion, is_last_units, variants)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)
     RETURNING *`,
    [item.name, item.description, item.category, item.subcategory, item.material, item.color, item.size, item.thickness, item.length, item.diameter, item.thread_type,
      item.sku, item.image_url, item.photo_url, item.sale_value, item.cost_value, item.quantity, item.min_stock, item.supplier, item.notes, item.status,
      item.is_catalog_active, item.is_published, item.is_featured, item.is_new, item.is_most_wanted, item.is_promotion, item.is_last_units, JSON.stringify(item.variants)]
  );
  res.status(201).json(product);
}));

app.patch(["/api/products/:id", "/api/jewelry/:id"], pg(async (req, res) => {
  const current = await one("SELECT * FROM products WHERE id = $1", [req.params.id]);
  if (!current) return res.status(404).json({ error: "Produto nÃƒÂ£o encontrado." });
  const item = productPayload({ ...current, ...req.body });
  const product = await one(
    `UPDATE products SET name=$1, description=$2, category=$3, subcategory=$4, material=$5, color=$6, size=$7, thickness=$8,
      length=$9, diameter=$10, thread_type=$11, sku=$12, image_url=$13, photo_url=$14, sale_value=$15, cost_value=$16,
      quantity=$17, min_stock=$18, supplier=$19, notes=$20, status=$21, is_catalog_active=$22, is_published=$23,
      is_featured=$24, is_new=$25, is_most_wanted=$26, is_promotion=$27, is_last_units=$28, variants=$29, updated_at=NOW()
     WHERE id=$30 RETURNING *`,
    [item.name, item.description, item.category, item.subcategory, item.material, item.color, item.size, item.thickness, item.length, item.diameter, item.thread_type,
      item.sku, item.image_url, item.photo_url, item.sale_value, item.cost_value, item.quantity, item.min_stock, item.supplier, item.notes, item.status,
      item.is_catalog_active, item.is_published, item.is_featured, item.is_new, item.is_most_wanted, item.is_promotion, item.is_last_units, JSON.stringify(item.variants), req.params.id]
  );
  res.json(product);
}));

app.delete(["/api/products/:id", "/api/jewelry/:id"], pg(async (req, res) => {
  await pgQuery("DELETE FROM products WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
}));

app.get("/api/jewelry/:id/movements", pg(async (req, res) => {
  const key = `product:${req.params.id}:movements`;
  const setting = await one("SELECT value FROM app_settings WHERE key = $1", [key]);
  res.json(Array.isArray(setting?.value) ? setting.value : []);
}));

app.post(["/api/jewelry/:id/movements", "/api/jewelry/:id/variants/:variantId/movements"], pg(async (req, res) => {
  const product = await one("SELECT * FROM products WHERE id = $1", [req.params.id]);
  if (!product) return res.status(404).json({ error: "Joia não encontrada." });
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const variantId = req.params.variantId || req.body?.variant_id || variants[0]?.id || "";
  const quantity = Math.max(1, Number(req.body?.quantity || 1));
  const movementType = req.body?.movement_type || "Ajuste";
  const normalized = String(movementType).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const delta = ["saida", "venda", "perda"].includes(normalized) ? -quantity : quantity;
  const nextVariants = variants.map((variant) => {
    if (String(variant.id) !== String(variantId)) return variant;
    const nextQuantity = Math.max(0, Number(variant.quantity || 0) + delta);
    return {
      ...variant,
      quantity: nextQuantity,
      status: nextQuantity <= 0 ? "esgotado" : nextQuantity <= Number(variant.low_stock_threshold || 1) ? "baixo estoque" : "disponível"
    };
  });
  const nextTotal = nextVariants.reduce((sum, variant) => sum + Number(variant.quantity || 0), 0);
  const nextStatus = nextTotal <= 0 ? "esgotado" : nextTotal <= Number(product.min_stock || 1) ? "baixo estoque" : "disponível";
  await pgQuery("UPDATE products SET variants = $1::jsonb, quantity = $2, status = $3, updated_at = NOW() WHERE id = $4", [JSON.stringify(nextVariants), nextTotal, nextStatus, req.params.id]);
  const key = `product:${req.params.id}:movements`;
  const current = await one("SELECT value FROM app_settings WHERE key = $1", [key]);
  const movements = Array.isArray(current?.value) ? current.value : [];
  const movement = {
    id: Date.now(),
    jewelry_id: Number(req.params.id),
    variant_id: variantId,
    movement_type: movementType,
    quantity,
    notes: req.body?.notes || "",
    movement_date: req.body?.movement_date || new Date().toISOString().slice(0, 10)
  };
  const nextMovements = [movement, ...movements].slice(0, 100);
  await pgQuery(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, JSON.stringify(nextMovements)]
  );
  res.status(201).json({ ok: true, movement, product: await one("SELECT * FROM products WHERE id = $1", [req.params.id]) });
}));

app.get("/api/catalog", pg(async (_req, res) => {
  const items = await rows(`${productSelect()} WHERE is_catalog_active = TRUE AND is_published = TRUE ORDER BY category, name`);
  res.json({
    title: "Escolha a joia perfeita para vocÃƒÂª",
    subtitle: "Joias selecionadas com cuidado, seguranÃƒÂ§a e estÃƒÂ©tica premium.",
    items: items.map((item) => ({ ...item, status: item.computed_status || item.status, variants: Array.isArray(item.variants) ? item.variants : [] })),
    categories: [...new Set(items.map((item) => item.category).filter(Boolean))],
    banners: [],
    promotions: []
  });
}));

app.get("/api/options", pg(async (_req, res) => {
  const products = await rows("SELECT * FROM products ORDER BY name");
  const services = await rows("SELECT id, name, description, base_price, duration_minutes, is_active, created_at, updated_at FROM services WHERE is_active = TRUE ORDER BY name");
  const professionals = await rows("SELECT * FROM professionals WHERE active = TRUE ORDER BY name");
  res.json({
    jewelry: products,
    inventoryJewelry: products,
    catalogJewelry: products.filter((item) => item.is_catalog_active && item.is_published),
    services,
    professionals,
    inventoryOptions: {
      category: [...new Set(products.map((item) => item.category).filter(Boolean))],
      size: [...new Set(products.map((item) => item.size).filter(Boolean))],
      thickness: [...new Set(products.map((item) => item.thickness).filter(Boolean))]
    }
  });
}));

app.get("/api/appointments", pg(async (_req, res) => {
  res.json(await rows(`
    SELECT a.*, COALESCE(c.name, a.client_name) AS client_name, COALESCE(c.name, a.client_name) AS full_name, c.instagram, s.name AS service_name, p.name AS professional_name
    FROM appointments a
    LEFT JOIN clients c ON c.id = a.client_id
    LEFT JOIN services s ON s.id = a.service_id
    LEFT JOIN professionals p ON p.id = a.professional_id
    ORDER BY a.appointment_date DESC, a.appointment_time DESC
  `));
}));

app.post("/api/appointments", upload.single("reference_photo"), pg(async (req, res) => {
  const body = req.body || {};
  let clientId = body.client_id || null;
  if (!clientId && (body.full_name || body.client_name || body.name)) {
    const client = await one(
      "INSERT INTO clients (name, phone, whatsapp, instagram, notes) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [body.full_name || body.client_name || body.name, body.phone || "", body.whatsapp || "", body.instagram || "", body.notes || ""]
    );
    clientId = client.id;
  }
  const appointment = await one(
    `INSERT INTO appointments
      (client_id, service_id, procedure_id, product_id, professional_id, client_name, whatsapp, procedure, description, piercing_region,
       appointment_date, appointment_time, end_time, total_value, deposit_value, remaining_value, deposit_payment_method, remaining_payment_method, status, notes, reference_photo_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
     RETURNING *`,
    [clientId, body.service_id || null, body.procedure_id || null, body.product_id || body.jewelry_id || null, body.professional_id || null,
      body.client_name || body.full_name || "", body.whatsapp || "", body.procedure || "", body.description || "", body.piercing_region || "",
      body.appointment_date, body.appointment_time, body.end_time || null, money(body.total_value), money(body.deposit_value),
      money(body.remaining_value), body.deposit_payment_method || "", body.remaining_payment_method || "", body.status || "pendente", body.notes || "", req.file ? `/uploads/${req.file.filename}` : body.reference_photo_url || ""]
  );
  if (money(body.deposit_value) > 0) {
    await pgQuery(
      `INSERT INTO financial_transactions (client_id, appointment_id, type, category, description, amount, payment_method, status, transaction_date)
       VALUES ($1, $2, 'receita', 'sinal', 'Sinal de agendamento', $3, $4, 'pago', $5)`,
      [clientId, appointment.id, money(body.deposit_value), body.deposit_payment_method || "", body.appointment_date]
    );
  }
  res.status(201).json(appointment);
}));

app.patch("/api/appointments/:id", pg(async (req, res) => {
  const body = req.body || {};
  const current = await one("SELECT * FROM appointments WHERE id = $1", [req.params.id]);
  if (!current) return res.status(404).json({ error: "Agendamento nÃƒÂ£o encontrado." });
  const appointment = await one(
    `UPDATE appointments SET status=COALESCE($1,status), appointment_date=COALESCE($2,appointment_date), appointment_time=COALESCE($3,appointment_time),
      notes=COALESCE($4,notes), total_value=COALESCE($5,total_value), deposit_value=COALESCE($6,deposit_value),
      remaining_value=COALESCE($7,remaining_value), updated_at=NOW()
     WHERE id=$8 RETURNING *`,
    [body.status ?? null, body.appointment_date ?? null, body.appointment_time ?? null, body.notes ?? null, body.total_value ?? null, body.deposit_value ?? null, body.remaining_value ?? null, req.params.id]
  );
  if (body.status === "atendido" && current.status !== "atendido") {
    if (current.product_id) {
      await pgQuery(
        `UPDATE products
         SET quantity = GREATEST(quantity - 1, 0),
             status = CASE WHEN GREATEST(quantity - 1, 0) <= 0 THEN 'esgotado' WHEN GREATEST(quantity - 1, 0) <= min_stock THEN 'baixo estoque' ELSE status END,
             updated_at = NOW()
         WHERE id = $1`,
        [current.product_id]
      );
    }
    for (const day of [7, 15, 30]) {
      await pgQuery(
        `INSERT INTO post_care (appointment_id, client_id, full_name, whatsapp, procedure, piercing_region, appointment_date, reminder_day, due_date, care_message, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$7::date + ($8::int * INTERVAL '1 day'),'Olá! Como está a cicatrização do seu piercing?', 'pendente')`,
        [current.id, current.client_id, current.client_name, current.whatsapp, current.procedure, current.piercing_region, current.appointment_date, day]
      );
    }
  }
  res.json(appointment);
}));

app.delete("/api/appointments/:id", pg(async (req, res) => {
  await pgQuery("DELETE FROM appointments WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
}));

app.get("/api/finance", pg(async (_req, res) => {
  const totals = await one(`
    SELECT
      COALESCE(SUM(amount) FILTER (WHERE type='receita' AND transaction_date = CURRENT_DATE), 0) AS day_total,
      COALESCE(SUM(amount) FILTER (WHERE type='receita' AND transaction_date >= CURRENT_DATE - INTERVAL '6 days'), 0) AS week_total,
      COALESCE(SUM(amount) FILTER (WHERE type='receita' AND TO_CHAR(transaction_date, 'YYYY-MM') = TO_CHAR(CURRENT_DATE, 'YYYY-MM')), 0) AS month_total,
      COALESCE(SUM(amount) FILTER (WHERE type='despesa' AND TO_CHAR(transaction_date, 'YYYY-MM') = TO_CHAR(CURRENT_DATE, 'YYYY-MM')), 0) AS expenses_total
    FROM financial_transactions
  `);
  const expenses = await rows("SELECT * FROM financial_transactions WHERE type='despesa' ORDER BY transaction_date DESC LIMIT 80");
  const methods = await rows("SELECT payment_method AS method, COUNT(*) AS total, COALESCE(SUM(amount),0) AS amount FROM financial_transactions WHERE type='receita' GROUP BY payment_method ORDER BY total DESC");
  res.json({
    day_total: Number(totals?.day_total || 0),
    week_total: Number(totals?.week_total || 0),
    month_total: Number(totals?.month_total || 0),
    pending_total: 0,
    forecast_total: Number(totals?.month_total || 0),
    expenses_summary: { total: Number(totals?.expenses_total || 0), fixed_total: 0, variable_total: Number(totals?.expenses_total || 0) },
    estimated_profit: Number(totals?.month_total || 0) - Number(totals?.expenses_total || 0),
    expenses,
    methods,
    monthlyRevenue: []
  });
}));

app.post(["/api/financial-transactions", "/api/expenses"], pg(async (req, res) => {
  const body = req.body || {};
  const isExpense = req.path.includes("expenses") || body.type === "despesa";
  const transaction = await one(
    `INSERT INTO financial_transactions (client_id, appointment_id, type, category, description, amount, payment_method, status, transaction_date, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [body.client_id || null, body.appointment_id || null, isExpense ? "despesa" : "receita", body.category || body.expense_type || "",
      body.description || "LanÃƒÂ§amento financeiro", money(body.amount), body.payment_method || "", body.status || "pago", body.transaction_date || body.due_date || new Date().toISOString().slice(0, 10), body.notes || ""]
  );
  res.status(201).json(transaction);
}));

app.delete(["/api/financial-transactions/:id", "/api/expenses/:id"], pg(async (req, res) => {
  await pgQuery("DELETE FROM financial_transactions WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
}));

app.get("/api/alerts", pg(async (_req, res) => {
  const lowStock = await rows("SELECT id, name, quantity, min_stock FROM products WHERE quantity <= min_stock ORDER BY quantity ASC LIMIT 10");
  const pending = await rows("SELECT id, client_name, appointment_date, appointment_time FROM appointments WHERE status = 'pendente' ORDER BY appointment_date, appointment_time LIMIT 10");
  const items = [
    ...lowStock.map((item) => ({ id: `stock-${item.id}`, title: "Estoque baixo", category: "Estoque", subject: item.name, description: `${item.quantity} unidade(s)`, priority: "alta", action_page: "catalog" })),
    ...pending.map((item) => ({ id: `appointment-${item.id}`, title: "Agendamento pendente", category: "Agenda", subject: item.client_name || "Cliente", description: `${item.appointment_date} ${item.appointment_time}`, priority: "normal", action_page: "agenda" }))
  ];
  res.json({ count: items.length, items });
}));

app.get("/api/erp", pg(async (_req, res) => {
  const [clientsCount, appointmentsCount, revenue] = await Promise.all([
    one("SELECT COUNT(*)::int AS total FROM clients"),
    one("SELECT COUNT(*)::int AS total FROM appointments"),
    one("SELECT COALESCE(SUM(amount),0) AS total FROM financial_transactions WHERE type = 'receita'")
  ]);
  res.json({
    product: {
      name: "Aura ERP",
      positioning: "Gestão local integrada para clínica de piercing.",
      stackTarget: ["PostgreSQL local", "React", "Express", "SQLite legado preservado"]
    },
    metrics: {
      studios: 1,
      clients: Number(clientsCount?.total || 0),
      appointments: Number(appointmentsCount?.total || 0),
      revenue: Number(revenue?.total || 0)
    },
    modules: [
      ["Agendamentos", "ativo", "Agenda, clientes, serviços e procedimentos"],
      ["Clientes e prontuários", "ativo", "Cadastro real de clientes em PostgreSQL"],
      ["Catálogo online", "ativo", "Produtos publicados e venda pública"],
      ["Financeiro", "ativo", "Receitas, despesas e exportações"],
      ["CRM", "planejado", "Funil, retornos e reativação"],
      ["Cursos", "planejado", "Cursos e consultorias"],
      ["Multiempresa", "planejado", "Base preparada para SaaS"]
    ].map(([name, status, description]) => ({ name, status, description })),
    crm: await rows("SELECT status AS name, COUNT(*)::int AS total FROM crm_interactions GROUP BY status"),
    catalogItems: await rows("SELECT id, name, category, quantity FROM products ORDER BY id DESC LIMIT 6"),
    coupons: [],
    influencers: [],
    consultancies: await rows("SELECT name, price, format FROM consultancies WHERE is_active = TRUE ORDER BY name LIMIT 6"),
    academy: await rows("SELECT name, price, format FROM courses WHERE is_active = TRUE ORDER BY name LIMIT 6"),
    contentPlanner: [],
    bodyMap: []
  });
}));

app.get("/api/professionals", pg(async (_req, res) => {
  res.json(await rows("SELECT * FROM professionals ORDER BY active DESC, name"));
}));

app.post("/api/professionals", pg(async (req, res) => {
  const body = req.body || {};
  if (!body.name?.trim()) return res.status(400).json({ error: "Informe o nome do profissional." });
  const professional = await one(
    "INSERT INTO professionals (name, specialty, active) VALUES ($1, $2, $3) RETURNING *",
    [body.name.trim(), body.specialty || "", bool(body.active, true)]
  );
  res.status(201).json(professional);
}));

app.patch("/api/professionals/:id", pg(async (req, res) => {
  const body = req.body || {};
  const professional = await one(
    "UPDATE professionals SET name = COALESCE($1, name), specialty = COALESCE($2, specialty), active = COALESCE($3, active), updated_at = NOW() WHERE id = $4 RETURNING *",
    [body.name ?? null, body.specialty ?? null, body.active ?? null, req.params.id]
  );
  if (!professional) return res.status(404).json({ error: "Profissional não encontrado." });
  res.json(professional);
}));

app.delete("/api/professionals/:id", pg(async (req, res) => {
  await pgQuery("DELETE FROM professionals WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
}));

app.get("/api/availability", pg(async (_req, res) => {
  const professionals = await rows("SELECT * FROM professionals WHERE active = TRUE ORDER BY name");
  for (const professional of professionals) {
    for (let weekday = 1; weekday <= 6; weekday += 1) {
      await pgQuery(
        `INSERT INTO professional_availability (professional_id, weekday)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [professional.id, weekday]
      );
    }
  }
  res.json(await rows(`
    SELECT pa.*, p.name AS professional_name
    FROM professional_availability pa
    LEFT JOIN professionals p ON p.id = pa.professional_id
    ORDER BY p.name, pa.weekday
  `));
}));

app.patch("/api/availability/:id", pg(async (req, res) => {
  const body = req.body || {};
  const item = await one(
    `UPDATE professional_availability SET is_active = $1, start_time = $2, end_time = $3, lunch_start = $4,
      lunch_end = $5, duration_minutes = $6, buffer_minutes = $7, updated_at = NOW()
     WHERE id = $8 RETURNING *`,
    [bool(body.is_active, true), body.start_time || "08:30", body.end_time || "18:00", body.lunch_start || "", body.lunch_end || "", Number(body.duration_minutes || 40), Number(body.buffer_minutes || 0), req.params.id]
  );
  if (!item) return res.status(404).json({ error: "Disponibilidade não encontrada." });
  res.json(item);
}));

app.get("/api/schedule-blocks", pg(async (_req, res) => {
  res.json(await rows(`
    SELECT sb.*, p.name AS professional_name
    FROM schedule_blocks sb
    LEFT JOIN professionals p ON p.id = sb.professional_id
    ORDER BY sb.start_datetime DESC
  `));
}));

app.post("/api/schedule-blocks", pg(async (req, res) => {
  const body = req.body || {};
  const block = await one(
    `INSERT INTO schedule_blocks (professional_id, reason, start_datetime, end_datetime, is_full_day, is_recurring, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [body.professional_id || null, body.reason || "", body.start_datetime, body.end_datetime, bool(body.is_full_day, false), bool(body.is_recurring, false), body.notes || ""]
  );
  res.status(201).json(block);
}));

app.delete("/api/schedule-blocks/:id", pg(async (req, res) => {
  await pgQuery("DELETE FROM schedule_blocks WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
}));

app.get("/api/inventory-options", pg(async (_req, res) => {
  res.json(await rows("SELECT * FROM inventory_options ORDER BY type, name"));
}));

app.post("/api/inventory-options", pg(async (req, res) => {
  const body = req.body || {};
  const item = await one(
    "INSERT INTO inventory_options (type, name) VALUES ($1, $2) ON CONFLICT (type, name) DO UPDATE SET name = EXCLUDED.name RETURNING *",
    [body.type, body.name]
  );
  res.status(201).json(item);
}));

app.patch("/api/inventory-options/:id", pg(async (req, res) => {
  const item = await one("UPDATE inventory_options SET name = COALESCE($1, name) WHERE id = $2 RETURNING *", [req.body?.name ?? null, req.params.id]);
  if (!item) return res.status(404).json({ error: "Opção não encontrada." });
  res.json(item);
}));

app.delete("/api/inventory-options/:id", pg(async (req, res) => {
  await pgQuery("DELETE FROM inventory_options WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
}));

app.get("/api/sales-orders", pg(async (_req, res) => {
  const orders = await rows("SELECT * FROM sales_orders ORDER BY created_at DESC");
  for (const order of orders) {
    order.items = await rows("SELECT * FROM sales_order_items WHERE sales_order_id = $1 ORDER BY id", [order.id]);
  }
  res.json(orders);
}));

app.post("/api/sales-orders", pg(async (req, res) => {
  const body = req.body || {};
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return res.status(400).json({ error: "Adicione ao menos um item." });
  const total = items.reduce((sum, item) => sum + Number(item.unit_price || 0) * Number(item.quantity || 1), 0);
  const order = await one(
    `INSERT INTO sales_orders (appointment_id, full_name, whatsapp, instagram, order_type, source, payment_method, status, total_value, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [body.appointment_id || null, body.full_name || "", body.whatsapp || "", body.instagram || "", body.order_type || "produto", body.source || "interno", body.payment_method || "", body.status || "concluida", total, body.notes || ""]
  );
  for (const item of items) {
    await pgQuery(
      `INSERT INTO sales_order_items (sales_order_id, item_type, product_id, service_id, item_name, quantity, unit_price, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [order.id, item.item_type || "produto", item.product_id || null, item.service_id || null, item.item_name || "Item", Number(item.quantity || 1), money(item.unit_price), item.notes || ""]
    );
    if ((item.item_type || "produto") === "produto" && item.product_id && order.status !== "cancelada") {
      await pgQuery(
        `UPDATE products
         SET quantity = GREATEST(quantity - $1, 0),
             status = CASE WHEN GREATEST(quantity - $1, 0) <= 0 THEN 'esgotado' WHEN GREATEST(quantity - $1, 0) <= min_stock THEN 'baixo estoque' ELSE status END,
             updated_at = NOW()
         WHERE id = $2`,
        [Number(item.quantity || 1), item.product_id]
      );
    }
  }
  if (order.status !== "cancelada") {
    await pgQuery(
      `INSERT INTO financial_transactions (type, category, description, amount, payment_method, status, transaction_date, notes)
       VALUES ('receita', 'venda', $1, $2, $3, 'pago', CURRENT_DATE, $4)`,
      [`Venda #${order.id}`, total, body.payment_method || "", body.notes || ""]
    );
  }
  order.items = await rows("SELECT * FROM sales_order_items WHERE sales_order_id = $1 ORDER BY id", [order.id]);
  res.status(201).json(order);
}));

app.patch("/api/sales-orders/:id", pg(async (req, res) => {
  const order = await one("UPDATE sales_orders SET status = COALESCE($1, status), updated_at = NOW() WHERE id = $2 RETURNING *", [req.body?.status ?? null, req.params.id]);
  if (!order) return res.status(404).json({ error: "Venda não encontrada." });
  res.json(order);
}));

app.get("/api/post-care", pg(async (_req, res) => {
  res.json(await rows("SELECT * FROM post_care ORDER BY due_date DESC NULLS LAST, id DESC"));
}));

app.patch("/api/post-care/:id", upload.single("client_photo"), pg(async (req, res) => {
  const body = req.body || {};
  const photo = req.file ? `/uploads/${req.file.filename}` : body.client_photo_url || null;
  const item = await one(
    `UPDATE post_care SET healing_status = COALESCE($1, healing_status), care_message = COALESCE($2, care_message),
      client_photo_url = COALESCE($3, client_photo_url), notes = COALESCE($4, notes), status = COALESCE($5, status), updated_at = NOW()
     WHERE id = $6 RETURNING *`,
    [body.healing_status ?? null, body.care_message ?? null, photo, body.notes ?? null, body.status ?? null, req.params.id]
  );
  if (!item) return res.status(404).json({ error: "Acompanhamento não encontrado." });
  res.json(item);
}));

app.get("/api/digital-terms", pg(async (_req, res) => {
  res.json(await rows("SELECT * FROM digital_terms ORDER BY signed_at DESC"));
}));

app.post("/api/digital-terms", pg(async (req, res) => {
  const body = req.body || {};
  if (!body.full_name?.trim()) return res.status(400).json({ error: "Informe o nome do cliente." });
  const term = await one(
    `INSERT INTO digital_terms (appointment_id, client_id, full_name, whatsapp, instagram, procedure, piercing_region, orientations_confirmed, health_declaration, form_data, signature_data_url, pdf_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [body.appointment_id || null, body.client_id || null, body.full_name, body.whatsapp || "", body.instagram || "", body.procedure || "", body.piercing_region || "", bool(body.orientations_confirmed, false), body.health_declaration || "", JSON.stringify(body.form_data || {}), body.signature_data_url || "", ""]
  );
  res.status(201).json(term);
}));

app.get("/api/users", pg(async (_req, res) => {
  res.json(await rows("SELECT id, name, email, role, created_at, updated_at FROM users ORDER BY name"));
}));

app.post("/api/users", pg(async (req, res) => {
  const body = req.body || {};
  const passwordHash = body.password ? await bcrypt.hash(body.password, 10) : null;
  const user = await one(
    "INSERT INTO users (name, email, role, password_hash) VALUES ($1,$2,$3,$4) RETURNING id, name, email, role, created_at, updated_at",
    [body.name, body.email, body.role || "reception", passwordHash]
  );
  res.status(201).json(user);
}));

app.patch("/api/users/:id", pg(async (req, res) => {
  const body = req.body || {};
  const current = await one("SELECT * FROM users WHERE id = $1", [req.params.id]);
  if (!current) return res.status(404).json({ error: "Usuário não encontrado." });
  const passwordHash = body.password ? await bcrypt.hash(body.password, 10) : current.password_hash;
  const user = await one(
    "UPDATE users SET name = COALESCE($1, name), email = COALESCE($2, email), role = COALESCE($3, role), password_hash = $4, updated_at = NOW() WHERE id = $5 RETURNING id, name, email, role, created_at, updated_at",
    [body.name ?? null, body.email ?? null, body.role ?? null, passwordHash, req.params.id]
  );
  res.json(user);
}));

app.delete("/api/users/:id", pg(async (req, res) => {
  await pgQuery("DELETE FROM users WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
}));

const defaultCatalogCustomization = {
  settings: {
    brand_name: "Aura Clinic Piercing",
    slogan: "Joias selecionadas com cuidado, segurança e estética premium.",
    logo_url: "",
    primary_color: "#C8A96A",
    secondary_color: "#D8C3A5",
    background_color: "#F8F5F0",
    button_color: "#C8A96A",
    title_font: "Playfair Display",
    body_font: "Inter",
    page_title: "Catálogo Online",
    page_subtitle: "Escolha a joia perfeita para você",
    footer_text: "Aura Clinic Piercing. Curadoria de joias, cuidado e atendimento especializado.",
    whatsapp: "",
    instagram: "",
    email: "",
    address: "",
    share_text: "Olá! Quero saber mais sobre esta joia da Aura Clinic."
  },
  theme: {
    theme_name: "premium",
    show_out_of_stock: false,
    show_stock_quantity: false,
    show_whatsapp_button: true,
    show_schedule_button: true,
    show_buy_button: true,
    show_favorites: true
  },
  banners: [],
  featuredCategories: [],
  featuredProducts: [],
  promotions: []
};

const mergeCatalogCustomization = (value = {}) => ({
  ...defaultCatalogCustomization,
  ...value,
  settings: { ...defaultCatalogCustomization.settings, ...(value.settings || {}) },
  theme: { ...defaultCatalogCustomization.theme, ...(value.theme || {}) },
  banners: Array.isArray(value.banners) ? value.banners : [],
  featuredCategories: Array.isArray(value.featuredCategories) ? value.featuredCategories : [],
  featuredProducts: Array.isArray(value.featuredProducts) ? value.featuredProducts : [],
  promotions: Array.isArray(value.promotions) ? value.promotions : []
});

app.get("/api/catalog-customization", pg(async (_req, res) => {
  const saved = await one("SELECT data FROM catalog_customization WHERE id = 1");
  res.json(mergeCatalogCustomization(saved?.data || {}));
}));

app.patch("/api/catalog-customization", pg(async (req, res) => {
  const data = mergeCatalogCustomization(req.body || {});
  await pgQuery(
    `INSERT INTO catalog_customization (id, data, updated_at)
     VALUES (1, $1::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    [JSON.stringify(data)]
  );
  res.json(data);
}));

app.post("/api/catalog-customization/publish", pg(async (req, res) => {
  const data = mergeCatalogCustomization(req.body || {});
  await pgQuery(
    `INSERT INTO catalog_customization (id, data, updated_at)
     VALUES (1, $1::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    [JSON.stringify(data)]
  );
  res.json({ ok: true, ...data });
}));

app.post("/api/catalog-customization/reset", pg(async (_req, res) => {
  await pgQuery(
    `INSERT INTO catalog_customization (id, data, updated_at)
     VALUES (1, $1::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    [JSON.stringify(defaultCatalogCustomization)]
  );
  res.json(defaultCatalogCustomization);
}));

app.get("/api/booking/config", pg(async (_req, res) => {
  const [services, procedures, professionals, products] = await Promise.all([
    rows("SELECT * FROM services WHERE is_active = TRUE ORDER BY name"),
    rows("SELECT p.*, s.name AS service_name FROM procedures p LEFT JOIN services s ON s.id = p.service_id WHERE p.is_active = TRUE ORDER BY p.name"),
    rows("SELECT * FROM professionals WHERE active = TRUE ORDER BY name"),
    rows("SELECT id, name, category, material, color, sale_value, quantity, image_url, photo_url FROM products WHERE is_catalog_active = TRUE AND is_published = TRUE ORDER BY name")
  ]);
  res.json({
    services,
    procedures,
    professionals,
    jewelry: products,
    settings: {
      min_notice_hours: 2,
      slot_interval_minutes: 15,
      default_duration_minutes: 40,
      business_hours: { start: "08:30", end: "18:00" }
    }
  });
}));

function buildSlots(start = "08:30", end = "18:00", step = 15) {
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  const slots = [];
  const current = new Date(2000, 0, 1, startHour, startMinute);
  const limit = new Date(2000, 0, 1, endHour, endMinute);
  while (current <= limit) {
    slots.push(current.toTimeString().slice(0, 5));
    current.setMinutes(current.getMinutes() + step);
  }
  return slots;
}

app.get("/api/booking/slots", pg(async (req, res) => {
  const date = req.query.date;
  if (!date) return res.status(400).json({ error: "Informe a data." });
  const professionalId = req.query.professional_id || null;
  const weekday = new Date(`${date}T12:00:00`).getDay() || 7;
  const availability = professionalId
    ? await one("SELECT * FROM professional_availability WHERE professional_id = $1 AND weekday = $2 AND is_active = TRUE LIMIT 1", [professionalId, weekday])
    : null;
  const takenRows = await rows(
    `SELECT appointment_time::text AS appointment_time
     FROM appointments
     WHERE appointment_date = $1
       AND status NOT IN ('cancelado')
       AND ($2::int IS NULL OR professional_id = $2)`,
    [date, professionalId]
  );
  const taken = new Set(takenRows.map((item) => String(item.appointment_time || "").slice(0, 5)));
  const slots = buildSlots(availability?.start_time || "08:30", availability?.end_time || "18:00", 15).map((time) => ({
    time,
    available: !taken.has(time)
  }));
  res.json({ date, slots });
}));

app.post("/api/booking/requests", upload.single("reference_photo"), pg(async (req, res) => {
  const body = req.body || {};
  if (!body.full_name?.trim()) return res.status(400).json({ error: "Informe o nome." });
  if (!body.appointment_date || !body.appointment_time) return res.status(400).json({ error: "Escolha data e horário." });
  const client = await one(
    `INSERT INTO clients (name, phone, whatsapp, instagram, email, notes)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [body.full_name.trim(), body.phone || "", body.whatsapp || "", body.instagram || "", body.email || "", body.notes || ""]
  );
  const appointment = await one(
    `INSERT INTO appointments (client_id, service_id, procedure_id, product_id, professional_id, client_name, whatsapp, procedure,
      appointment_date, appointment_time, total_value, deposit_value, remaining_value, status, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pendente',$14) RETURNING *`,
    [client.id, body.service_id || null, body.procedure_id || null, body.product_id || body.jewelry_id || null, body.professional_id || null,
      client.name, body.whatsapp || "", body.procedure || "", body.appointment_date, body.appointment_time,
      money(body.total_value), money(body.deposit_value), money(body.remaining_value), body.notes || ""]
  );
  res.status(201).json({ client, appointment });
}));

app.post("/api/sales-orders/public", pg(async (req, res) => {
  const body = req.body || {};
  const submittedItems = Array.isArray(body.items) ? body.items : [];
  const product = body.product_id ? await one("SELECT * FROM products WHERE id = $1", [body.product_id]) : null;
  const items = submittedItems.length ? submittedItems : product ? [{ item_type: "produto", product_id: product.id, item_name: product.name, quantity: body.quantity || 1, unit_price: body.total_value ?? product.sale_value, notes: body.notes || "" }] : [];
  if (!items.length) return res.status(400).json({ error: "Adicione ao menos um item ao pedido." });
  const total = items.reduce((sum, item) => sum + Number(item.unit_price || 0) * Number(item.quantity || 1), 0);
  const order = await one(
    `INSERT INTO sales_orders (full_name, whatsapp, instagram, order_type, source, payment_method, status, total_value, notes)
     VALUES ($1,$2,$3,'produto','catalogo',$4,'pendente',$5,$6) RETURNING *`,
    [body.full_name || "Cliente catálogo", body.whatsapp || "", body.instagram || "", body.payment_method || "", total, body.notes || ""]
  );
  for (const item of items) {
    await pgQuery(
      `INSERT INTO sales_order_items (sales_order_id, item_type, product_id, item_name, quantity, unit_price, notes)
       VALUES ($1,'produto',$2,$3,$4,$5,$6)`,
      [order.id, item.product_id || null, item.item_name || "Joia", Number(item.quantity || 1), money(item.unit_price), item.notes || ""]
    );
  }
  order.items = await rows("SELECT * FROM sales_order_items WHERE sales_order_id = $1 ORDER BY id", [order.id]);
  res.status(201).json(order);
}));

app.get("/api/finance/export.csv", pg(async (_req, res) => {
  const data = await rows("SELECT transaction_date, type, category, description, amount, payment_method, status FROM financial_transactions ORDER BY transaction_date DESC");
  const header = "data,tipo,categoria,descricao,valor,forma_pagamento,status";
  const lines = data.map((item) => [
    item.transaction_date,
    item.type,
    item.category,
    `"${String(item.description || "").replaceAll('"', '""')}"`,
    item.amount,
    item.payment_method,
    item.status
  ].join(","));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=relatorio-aura-clinic.csv");
  res.send([header, ...lines].join("\n"));
}));

app.get("/api/finance/export.pdf", pg(async (_req, res) => {
  const data = await rows("SELECT transaction_date, type, description, amount FROM financial_transactions ORDER BY transaction_date DESC LIMIT 80");
  const doc = new PDFDocument({ margin: 40 });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", "attachment; filename=relatorio-aura-clinic.pdf");
  doc.pipe(res);
  doc.fontSize(18).text("Relatório Financeiro Aura Clinic");
  doc.moveDown();
  data.forEach((item) => doc.fontSize(10).text(`${item.transaction_date} | ${item.type} | ${item.description} | R$ ${Number(item.amount || 0).toFixed(2)}`));
  doc.end();
}));

app.get("/api/finance/export.xlsx", pg(async (_req, res) => {
  const data = await rows("SELECT transaction_date, type, category, description, amount, payment_method, status FROM financial_transactions ORDER BY transaction_date DESC");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Financeiro");
  sheet.columns = [
    { header: "Data", key: "transaction_date", width: 16 },
    { header: "Tipo", key: "type", width: 14 },
    { header: "Categoria", key: "category", width: 18 },
    { header: "Descrição", key: "description", width: 36 },
    { header: "Valor", key: "amount", width: 14 },
    { header: "Pagamento", key: "payment_method", width: 18 },
    { header: "Status", key: "status", width: 14 }
  ];
  data.forEach((item) => sheet.addRow(item));
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", "attachment; filename=relatorio-aura-clinic.xlsx");
  await workbook.xlsx.write(res);
  res.end();
}));

app.get("/api/backup.sqlite", pg(async (_req, res) => {
  const backup = {
    exported_at: new Date().toISOString(),
    database: "aura_clinic",
    clients: await rows("SELECT * FROM clients ORDER BY id"),
    services: await rows("SELECT * FROM services ORDER BY id"),
    procedures: await rows("SELECT * FROM procedures ORDER BY id"),
    products: await rows("SELECT * FROM products ORDER BY id"),
    appointments: await rows("SELECT * FROM appointments ORDER BY id"),
    financial_transactions: await rows("SELECT * FROM financial_transactions ORDER BY id"),
    sales_orders: await rows("SELECT * FROM sales_orders ORDER BY id")
  };
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=backup-aura-clinic.json");
  res.json(backup);
}));

app.post("/api/admin/reset-demo-data", pg(async (_req, res) => {
  await pgQuery(`
    TRUNCATE digital_terms, post_care, sales_order_items, sales_orders, financial_transactions,
      appointments, notifications, crm_interactions, products, procedures, services, clients
    RESTART IDENTITY CASCADE
  `);
  res.json({ ok: true });
}));

app.get("/api/settings", pg(async (_req, res) => {
  const items = await rows("SELECT key, value FROM app_settings ORDER BY key");
  res.json(Object.fromEntries(items.map((item) => [item.key, item.value])));
}));

app.patch("/api/settings", pg(async (req, res) => {
  const entries = Object.entries(req.body || {});
  for (const [key, value] of entries) {
    await pgQuery(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, JSON.stringify(value)]
    );
  }
  res.json({ ok: true });
}));

app.get("/api/crm", pg(async (_req, res) => {
  res.json(await rows("SELECT ci.*, c.name AS client_name FROM crm_interactions ci LEFT JOIN clients c ON c.id = ci.client_id ORDER BY ci.created_at DESC"));
}));

app.post("/api/crm", pg(async (req, res) => {
  const body = req.body || {};
  const item = await one(
    "INSERT INTO crm_interactions (client_id, title, description, status, due_date) VALUES ($1,$2,$3,$4,$5) RETURNING *",
    [body.client_id || null, body.title || "Contato", body.description || "", body.status || "aberto", body.due_date || null]
  );
  res.status(201).json(item);
}));

app.get("/api/courses", pg(async (_req, res) => {
  res.json(await rows("SELECT * FROM courses ORDER BY is_active DESC, name"));
}));

app.post("/api/courses", pg(async (req, res) => {
  const body = req.body || {};
  const item = await one("INSERT INTO courses (name, description, price, format, is_active) VALUES ($1,$2,$3,$4,$5) RETURNING *", [body.name, body.description || "", money(body.price), body.format || "", bool(body.is_active, true)]);
  res.status(201).json(item);
}));

app.get("/api/consultancies", pg(async (_req, res) => {
  res.json(await rows("SELECT * FROM consultancies ORDER BY is_active DESC, name"));
}));

app.post("/api/consultancies", pg(async (req, res) => {
  const body = req.body || {};
  const item = await one("INSERT INTO consultancies (name, description, price, format, is_active) VALUES ($1,$2,$3,$4,$5) RETURNING *", [body.name, body.description || "", money(body.price), body.format || "", bool(body.is_active, true)]);
  res.status(201).json(item);
}));

app.get("/api/audit-logs", pg(async (_req, res) => {
  res.json(await rows("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 200"));
}));

app.get("/api/integrations", pg(async (_req, res) => {
  res.json(await rows("SELECT * FROM integrations ORDER BY name"));
}));

app.patch("/api/integrations/:id", pg(async (req, res) => {
  const body = req.body || {};
  const item = await one(
    "UPDATE integrations SET status = COALESCE($1,status), settings = COALESCE($2::jsonb,settings), updated_at = NOW() WHERE id = $3 RETURNING *",
    [body.status ?? null, body.settings ? JSON.stringify(body.settings) : null, req.params.id]
  );
  if (!item) return res.status(404).json({ error: "Integração não encontrada." });
  res.json(item);
}));

app.post("/api/login", pg(async (req, res) => {
  const { email = "admin@auraclinic.com", password = "" } = req.body || {};
  const user = await one("SELECT * FROM users WHERE email = $1 ORDER BY id LIMIT 1", [email]);
  if (!user) return res.status(401).json({ error: "Usuário não encontrado." });
  const localWithoutPassword = isLocalDevRequest(req) && !password;
  const validPassword = user.password_hash ? await bcrypt.compare(password, user.password_hash) : isLocalDevRequest(req);
  if (!localWithoutPassword && !validPassword) return res.status(401).json({ error: "Credenciais inválidas." });
  res.json({
    token: createToken(user),
    user: { id: user.id, name: user.name, email: user.email, role: user.role }
  });
}));

app.post("/api/login", withDb(async (req, res, db) => {
  const { email, password } = req.body;
  const user = await db.get("SELECT * FROM users WHERE email = ?", [email]);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: "Credenciais invÃƒÂ¡lidas." });
  }
  res.json({
    token: createToken(user),
    user: { id: user.id, name: user.name, email: user.email, role: user.role }
  });
}));

app.get("/api/catalog", withDb(async (_req, res, db) => {
  const customization = await getCatalogCustomization(db);
  const showOutOfStock = Boolean(Number(customization.theme.show_out_of_stock));
  const productRows = await db.all(`
    SELECT
      j.*,
      COALESCE(
        fp.badge,
        CASE
          WHEN j.is_promotion = 1 THEN 'PromoÃƒÂ§ÃƒÂ£o'
          WHEN j.is_last_units = 1 THEN 'ÃƒÅ¡ltimas unidades'
          WHEN j.is_most_wanted = 1 THEN 'Mais desejado'
          WHEN j.is_new = 1 THEN 'LanÃƒÂ§amento'
          WHEN j.is_featured = 1 THEN 'Destaque'
          ELSE ''
        END
      ) AS badge,
      fp.sort_order AS featured_order
    FROM jewelry_inventory j
    LEFT JOIN catalog_featured_products fp ON fp.product_id = j.id AND fp.is_active = 1
    WHERE j.is_catalog_active = 1 AND j.is_published = 1 AND j.status != 'arquivado'
    ORDER BY COALESCE(fp.sort_order, 9999), j.category, j.name
  `);
  const items = (await attachVariants(db, productRows))
    .filter((item) => showOutOfStock || item.quantity > 0)
    .map((item) => ({
      // Dados pÃƒÂºblicos
      id: item.id,
      name: item.name,
      photo_url: item.photo_url || item.image_url,
      gallery_urls: item.gallery_urls,
      category: item.category,
      subcategory: item.subcategory,
      material: item.material,
      color: item.color,
      stone: item.stone,
      size: item.size,
      thickness: item.thickness,
      sale_value: item.sale_value,
      quantity: item.quantity,
      variants: asArray(item.variants).map((v) => ({
        id: v.id,
        variation_name: v.variation_name,
        diameter: v.diameter,
        length: v.length,
        size: v.size,
        thickness: v.thickness,
        material: v.material,
        color: v.color,
        thread_type: v.thread_type,
        sale_value: v.sale_value || item.sale_value,
        quantity: v.quantity || item.quantity
      })),
      badge: item.badge,
      is_featured: item.is_featured,
      is_new: item.is_new,
      is_promotion: item.is_promotion,
      is_last_units: item.is_last_units
      // Dados privados OCULTOS: cost_value, supplier, physical_location, notes, description, etc.
    }));
  res.json({
    ...customization.settings,
    theme: customization.theme,
    banners: customization.banners,
    featuredCategories: customization.featuredCategories,
    featuredProducts: customization.featuredProducts,
    promotions: customization.promotions,
    categories: splitCatalogCategories(customization.settings.categories),
    items
  });
}));

app.get("/api/catalog-customization", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  const customization = await getCatalogCustomization(db);
  const products = await attachVariants(db, await db.all("SELECT * FROM jewelry_inventory ORDER BY name"));
  const options = await db.all("SELECT * FROM inventory_options ORDER BY type, name");
  res.json({ ...customization, products, inventoryOptions: groupInventoryOptions(options) });
}));

app.patch("/api/catalog-customization", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  await saveCatalogCustomization(db, req.body || {});
  res.json(await getCatalogCustomization(db));
}));

app.post("/api/catalog-customization/publish", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  await saveCatalogCustomization(db, req.body || {});
  res.json({ ok: true, published_at: new Date().toISOString(), ...(await getCatalogCustomization(db)) });
}));

app.post("/api/catalog-customization/reset", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  await resetCatalogCustomization(db);
  res.json(await getCatalogCustomization(db));
}));

app.get("/api/catalog-settings", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  const settings = await getCatalogSettings(db);
  res.json({ ...settings, categories: splitCatalogCategories(settings.categories) });
}));

app.patch("/api/catalog-settings", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  const allowed = ["title", "subtitle", "hero_title", "hero_subtitle", "hero_image_url", "categories", "whatsapp_phone", "whatsapp_message", "company_instagram", "company_email", "company_address", "company_hours", "layout_style"];
  const entries = Object.entries(req.body).filter(([key]) => allowed.includes(key));
  for (const [key, value] of entries) {
    const cleanValue = Array.isArray(value) ? value.filter(Boolean).join(",") : String(value || "");
    await db.run(
      "INSERT INTO catalog_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [key, cleanValue]
    );
  }
  const settings = await getCatalogSettings(db);
  res.json({ ...settings, categories: splitCatalogCategories(settings.categories) });
}));

app.post("/api/uploads", upload.single("file"), withDb(async (req, res) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  if (!req.file) return res.status(400).json({ error: "Nenhum arquivo enviado." });
  res.status(201).json({ url: `/uploads/${req.file.filename}` });
}));

app.get("/api/booking/config", withDb(async (_req, res, db) => {
  const services = await db.all("SELECT * FROM services WHERE active_online_booking = 1 ORDER BY name");
  const professionals = await db.all(`
    SELECT DISTINCT p.*
    FROM professionals p
    JOIN professional_services ps ON ps.professional_id = p.id
    JOIN services s ON s.id = ps.service_id
    WHERE p.active = 1 AND s.active_online_booking = 1
    ORDER BY p.name
  `);
  res.json({
    services,
    professionals,
    rules: {
      cancellation: "RemarcaÃƒÂ§ÃƒÂµes e cancelamentos devem ser solicitados com antecedÃƒÂªncia.",
      payment: "O sinal reserva o horÃƒÂ¡rio; a confirmaÃƒÂ§ÃƒÂ£o ÃƒÂ© feita manualmente pela Aura Clinic."
    }
  });
}));

app.get("/api/booking/slots", withDb(async (req, res, db) => {
  const serviceId = Number(req.query.service_id || 0);
  const professionalId = Number(req.query.professional_id || 0);
  const date = String(req.query.date || "");
  if (!serviceId || !professionalId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "ServiÃƒÂ§o, profissional e data sÃƒÂ£o obrigatÃƒÂ³rios." });
  }
  const service = await db.get("SELECT * FROM services WHERE id = ? AND active_online_booking = 1", [serviceId]);
  if (!service) return res.status(404).json({ error: "ServiÃƒÂ§o nÃƒÂ£o encontrado." });
  const linked = await db.get("SELECT id FROM professional_services WHERE professional_id = ? AND service_id = ?", [professionalId, serviceId]);
  if (!linked) return res.status(409).json({ error: "Este profissional nÃƒÂ£o realiza o serviÃƒÂ§o selecionado." });
  const slots = await availableBookingSlots(db, { service, professionalId, date });
  res.json({ date, slots });
}));

app.post("/api/booking/requests", upload.fields([{ name: "reference_photo", maxCount: 1 }, { name: "payment_proof", maxCount: 1 }]), withDb(async (req, res, db) => {
  const body = req.body;
  const service = await db.get("SELECT * FROM services WHERE id = ? AND active_online_booking = 1", [body.service_id]);
  if (!service) return res.status(404).json({ error: "ServiÃƒÂ§o nÃƒÂ£o encontrado." });
  const professionalId = Number(body.professional_id || 0);
  const date = String(body.appointment_date || "");
  const time = String(body.appointment_time || "");
  const slots = await availableBookingSlots(db, { service, professionalId, date });
  if (!slots.some((slot) => slot.time === time)) return res.status(409).json({ error: "Este horÃƒÂ¡rio nÃƒÂ£o estÃƒÂ¡ mais disponÃƒÂ­vel." });
  if (!body.full_name?.trim() || !body.whatsapp?.trim()) return res.status(400).json({ error: "Nome e WhatsApp sÃƒÂ£o obrigatÃƒÂ³rios." });
  const client = await upsertClient(db, {
    full_name: body.full_name,
    whatsapp: body.whatsapp,
    instagram: body.instagram || "",
    birth_date: "",
    notes: body.notes || ""
  });
  const referencePhoto = req.files?.reference_photo?.[0] ? `/uploads/${req.files.reference_photo[0].filename}` : "";
  const paymentProof = req.files?.payment_proof?.[0] ? `/uploads/${req.files.payment_proof[0].filename}` : "";
  const endTime = addMinutesToTime(time, Number(service.duration_minutes || 40));
  const result = await db.run(
    `INSERT INTO appointments
    (client_id, professional_id, service_id, procedure, description, piercing_region, appointment_date, appointment_time, end_time, total_value, deposit_value, remaining_value, deposit_payment_method, remaining_payment_method, status, notes, reference_photo_url, payment_proof_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      client.id,
      professionalId,
      service.id,
      service.name,
      service.description || "",
      service.name,
      date,
      time,
      endTime,
      Number(service.price || 0),
      Number(service.deposit_value || 0),
      Math.max(Number(service.price || 0) - Number(service.deposit_value || 0), 0),
      "Pix",
      "Pix",
      "pendente",
      body.notes || "",
      referencePhoto,
      paymentProof
    ]
  );
  res.status(201).json(await listAppointments(db, "WHERE a.id = ?", [result.lastID]).then((rows) => rows[0]));
}));

app.get("/api/services", withDb(async (_req, res, db) => {
  res.json(await listServices(db));
}));

app.post("/api/services", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  const result = await db.run(
    "INSERT INTO services (name, description, duration_minutes, price, deposit_value, active_online_booking, pre_service_notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [req.body.name, req.body.description || "", Number(req.body.duration_minutes || 40), Number(req.body.price || 0), Number(req.body.deposit_value || 0), boolNumber(req.body.active_online_booking), req.body.pre_service_notes || ""]
  );
  await replaceProfessionalServices(db, result.lastID, req.body.professional_ids || []);
  res.status(201).json(await db.get("SELECT * FROM services WHERE id = ?", [result.lastID]));
}));

app.patch("/api/services/:id", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  const service = await db.get("SELECT * FROM services WHERE id = ?", [req.params.id]);
  if (!service) return res.status(404).json({ error: "ServiÃƒÂ§o nÃƒÂ£o encontrado." });
  await db.run(
    `UPDATE services SET name = ?, description = ?, duration_minutes = ?, price = ?, deposit_value = ?, active_online_booking = ?, pre_service_notes = ? WHERE id = ?`,
    [
      req.body.name || service.name,
      req.body.description || service.description,
      Number(req.body.duration_minutes || service.duration_minutes),
      Number(req.body.price || service.price),
      Number(req.body.deposit_value || service.deposit_value),
      boolNumber(req.body.active_online_booking || service.active_online_booking),
      req.body.pre_service_notes || service.pre_service_notes,
      req.params.id
    ]
  );
  if (req.body.professional_ids) await replaceProfessionalServices(db, req.params.id, req.body.professional_ids);
  res.json(await db.get("SELECT * FROM services WHERE id = ?", [req.params.id]));
}));

app.delete("/api/services/:id", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  await db.run("UPDATE services SET active_online_booking = 0 WHERE id = ?", [req.params.id]);
  res.json({ ok: true });
}));

app.get("/api/availability", withDb(async (_req, res, db) => {
  res.json(await db.all(`
    SELECT a.*, p.name AS professional_name
    FROM professional_availability a
    JOIN professionals p ON p.id = a.professional_id
    ORDER BY p.name, a.weekday
  `));
}));

app.patch("/api/availability/:id", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  const current = await db.get("SELECT * FROM professional_availability WHERE id = ?", [req.params.id]);
  if (!current) return res.status(404).json({ error: "Disponibilidade nÃƒÂ£o encontrada." });
  await db.run(
    `UPDATE professional_availability
     SET is_active = ?, start_time = ?, end_time = ?, lunch_start = ?, lunch_end = ?, duration_minutes = ?, buffer_minutes = ?
     WHERE id = ?`,
    [
      boolNumber(req.body.is_active || current.is_active),
      req.body.start_time || current.start_time,
      req.body.end_time || current.end_time,
      req.body.lunch_start || current.lunch_start,
      req.body.lunch_end || current.lunch_end,
      Number(req.body.duration_minutes || current.duration_minutes),
      Number(req.body.buffer_minutes || current.buffer_minutes),
      req.params.id
    ]
  );
  res.json(await db.get("SELECT * FROM professional_availability WHERE id = ?", [req.params.id]));
}));

app.get("/api/schedule-blocks", withDb(async (_req, res, db) => {
  res.json(await db.all(`
    SELECT b.*, p.name AS professional_name
    FROM schedule_blocks b
    JOIN professionals p ON p.id = b.professional_id
    ORDER BY b.start_datetime DESC
  `));
}));

app.post("/api/schedule-blocks", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  const result = await db.run(
    "INSERT INTO schedule_blocks (professional_id, start_datetime, end_datetime, reason, notes, is_full_day, is_recurring) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [req.body.professional_id, req.body.start_datetime, req.body.end_datetime, req.body.reason || "Bloqueio", req.body.notes || "", boolNumber(req.body.is_full_day), boolNumber(req.body.is_recurring)]
  );
  res.status(201).json(await db.get("SELECT * FROM schedule_blocks WHERE id = ?", [result.lastID]));
}));

app.delete("/api/schedule-blocks/:id", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  await db.run("DELETE FROM schedule_blocks WHERE id = ?", [req.params.id]);
  res.json({ ok: true });
}));

app.get("/api/alerts", withDb(async (_req, res, db) => {
  const today = new Date().toISOString().slice(0, 10);
  const jewelry = await db.all(`
    SELECT id, name, category, color, size, thickness, quantity, status, sku
    FROM jewelry_inventory
    WHERE status != 'arquivado' AND quantity <= COALESCE(low_stock_threshold, 5)
    ORDER BY quantity ASC, name
    LIMIT 12
  `);
  const clients = await db.all("SELECT id, full_name, whatsapp, instagram, birth_date FROM clients WHERE birth_date IS NOT NULL");
  const birthdays = nextBirthdays(clients, 30).slice(0, 10);
  const topClients = await db.all(`
    SELECT c.id, c.full_name, c.whatsapp, c.instagram,
      COUNT(a.id) AS appointment_count,
      SUM(CASE WHEN LOWER(COALESCE(a.procedure, '')) LIKE '%retorno%' OR LOWER(COALESCE(a.description, '')) LIKE '%retorno%' THEN 1 ELSE 0 END) AS return_count,
      MAX(a.appointment_date) AS last_visit
    FROM clients c
    JOIN appointments a ON a.client_id = c.id
    GROUP BY c.id
    HAVING COUNT(a.id) >= 2
    ORDER BY appointment_count DESC, return_count DESC, last_visit DESC
    LIMIT 8
  `);

  const alerts = [
    ...jewelry.map((item) => ({
      id: `stock-${item.id}`,
      title: item.quantity <= 0 ? "Joia esgotada" : "Joia acabando",
      category: "Estoque",
      subject: item.name,
      description: `${item.name} possui ${Number(item.quantity || 0)} unidade(s) disponÃƒÂ­vel(is).`,
      priority: item.quantity <= 0 ? "high" : item.quantity <= 2 ? "high" : "medium",
      related_date: today,
      action_label: "Ver estoque",
      action_page: "catalog",
      created_at: today
    })),
    ...birthdays.map((item) => ({
      id: `birthday-${item.id}`,
      title: item.days_until === 0 ? "AniversÃƒÂ¡rio hoje" : "AniversÃƒÂ¡rio prÃƒÂ³ximo",
      category: "Clientes",
      subject: item.full_name,
      description: item.days_until === 0 ? `${item.full_name} faz aniversÃƒÂ¡rio hoje.` : `${item.full_name} faz aniversÃƒÂ¡rio em ${item.days_until} dia(s).`,
      priority: item.days_until <= 7 ? "medium" : "low",
      related_date: item.next_birthday,
      action_label: "Ver cliente",
      action_page: "client-center",
      created_at: today
    })),
    ...topClients.map((item) => ({
      id: `client-${item.id}`,
      title: "Cliente frequente",
      category: "Relacionamento",
      subject: item.full_name,
      description: `${item.full_name} possui ${Number(item.appointment_count || 0)} atendimento(s) e ${Number(item.return_count || 0)} retorno(s).`,
      priority: "low",
      related_date: item.last_visit,
      action_label: "Ver clientes",
      action_page: "client-center",
      created_at: today
    }))
  ];

  res.json({ count: alerts.length, items: alerts });
}));

app.get("/api/dashboard", withDb(async (_req, res, db) => {
  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const stats = await db.get(`
    SELECT
      SUM(CASE WHEN appointment_date = ? THEN 1 ELSE 0 END) AS today_count,
      SUM(CASE WHEN status = 'pendente' THEN 1 ELSE 0 END) AS pending_count,
      SUM(CASE WHEN status = 'confirmado' THEN 1 ELSE 0 END) AS confirmed_count,
      SUM(CASE WHEN appointment_date LIKE ? THEN total_value ELSE 0 END) AS month_forecast
    FROM appointments
  `, [today, `${month}%`]);
  const deposit = await db.get("SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE payment_type = 'sinal' AND status = 'pago'");
  const lowStock = await db.get("SELECT COUNT(*) AS count FROM jewelry_inventory WHERE quantity > 0 AND quantity <= COALESCE(critical_stock_threshold, 3)");
  const todaysAppointments = await listAppointments(db, "WHERE a.appointment_date = ?", [today]);
  const lowStockJewelry = await db.all(`
    SELECT id, name, category, color, size, thickness, quantity, status, sku
    FROM jewelry_inventory
    WHERE quantity > 0 AND quantity <= COALESCE(critical_stock_threshold, 3)
    ORDER BY quantity ASC, name
    LIMIT 8
  `);
  const clients = await db.all("SELECT id, full_name, whatsapp, instagram, birth_date FROM clients WHERE birth_date IS NOT NULL");
  const birthdays = nextBirthdays(clients, 30).slice(0, 8);
  const topClients = await db.all(`
    SELECT
      c.id,
      c.full_name,
      c.whatsapp,
      c.instagram,
      COUNT(a.id) AS appointment_count,
      SUM(CASE WHEN LOWER(a.procedure) LIKE '%retorno%' OR LOWER(a.description) LIKE '%retorno%' THEN 1 ELSE 0 END) AS return_count,
      MAX(a.appointment_date) AS last_visit
    FROM clients c
    JOIN appointments a ON a.client_id = c.id
    GROUP BY c.id
    ORDER BY appointment_count DESC, return_count DESC, last_visit DESC
    LIMIT 6
  `);
  const finance = await buildFinanceReport(db);
  const procedureRanking = await db.all(`
    SELECT procedure AS label, COUNT(*) AS total
    FROM appointments
    WHERE status = 'atendido'
    GROUP BY procedure
    ORDER BY total DESC
    LIMIT 6
  `);
  const jewelryRanking = await db.all(`
    SELECT j.name AS label, COUNT(*) AS total
    FROM appointments a
    JOIN jewelry_inventory j ON j.id = a.jewelry_id
    WHERE a.status = 'atendido'
    GROUP BY j.id
    ORDER BY total DESC
    LIMIT 6
  `);
  const categoryRanking = await db.all(`
    SELECT j.category AS label, COUNT(*) AS total
    FROM appointments a
    JOIN jewelry_inventory j ON j.id = a.jewelry_id
    WHERE a.status = 'atendido'
    GROUP BY j.category
    ORDER BY total DESC
    LIMIT 6
  `);
  const birthdaysMonth = await db.all(`
    SELECT id, full_name, whatsapp, instagram, birth_date
    FROM clients
    WHERE birth_date IS NOT NULL AND SUBSTR(birth_date, 6, 2) = ?
    ORDER BY SUBSTR(birth_date, 9, 2)
    LIMIT 8
  `, [today.slice(5, 7)]);
  const upcomingAppointments = await listAppointments(db, "WHERE a.appointment_date >= ? AND a.status IN ('pendente', 'confirmado', 'remarcado')", [today]).then((rows) => rows.slice(0, 8));
  const returnClients = await db.all(`
    SELECT f.*, c.full_name, c.whatsapp, a.procedure
    FROM post_care_followups f
    JOIN clients c ON c.id = f.client_id
    JOIN appointments a ON a.id = f.appointment_id
    WHERE f.status != 'concluido'
    ORDER BY f.due_date ASC
    LIMIT 8
  `);
  res.json({
    stats: {
      todayCount: stats?.todayCount ?? 0,
      pendingCount: stats?.pendingCount || 0,
      confirmedCount: stats?.confirmedCount || 0,
      lowStockCount: stats?.lowStockCount || 0,
      depositReceived: stats?.depositReceived || 0,
      monthForecast: stats?.monthForecast || 0
    },
    todaysAppointments,
    alerts: { lowStockJewelry, birthdays, topClients },
    adminDashboard: {
      monthlyRevenue: finance.monthlyRevenue,
      weeklyRevenue: finance.weeklyRevenue,
      dailyRevenue: finance.dailyRevenue,
      procedureRanking,
      jewelryRanking,
      categoryRanking,
      criticalStock: lowStockJewelry,
      birthdaysMonth,
      upcomingAppointments,
      returnClients
    }
  });
}));

app.get("/api/erp", withDb(async (_req, res, db) => {
  if (!requireRole(_req, res, ["admin"])) return;
  const clientsCount = await db.get("SELECT COUNT(*) AS count FROM clients");
  const appointmentsCount = await db.get("SELECT COUNT(*) AS count FROM appointments");
  const jewelryCount = await db.get("SELECT COUNT(*) AS count FROM jewelry_inventory");
  const paid = await db.get("SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE status = 'pago'");
  const catalogItems = await db.all(`
    SELECT id, name, photo_url, category, material, color, size, quantity, sale_value
    FROM jewelry_inventory
    WHERE quantity > 0
    ORDER BY name
    LIMIT 6
  `);
  const crm = await db.all(`
    SELECT stage, COUNT(*) AS total
    FROM (
      SELECT
        c.id,
        CASE
          WHEN COUNT(a.id) >= 4 THEN 'Cliente VIP'
          WHEN COUNT(a.id) >= 2 THEN 'Cliente recorrente'
          WHEN COUNT(a.id) = 1 THEN 'Cliente'
          ELSE 'Lead'
        END AS stage
      FROM clients c
      LEFT JOIN appointments a ON a.client_id = c.id
      GROUP BY c.id
    )
    GROUP BY stage
    ORDER BY total DESC
  `);
  const bodyMap = await db.all(`
    SELECT piercing_region AS region, COUNT(*) AS total
    FROM appointments
    WHERE piercing_region IS NOT NULL AND piercing_region != ''
    GROUP BY piercing_region
    ORDER BY total DESC
    LIMIT 8
  `);

  res.json({
    product: {
      name: "Aura Clinic ERP",
      positioning: "SaaS premium para body piercing, joalherias corporais, consultorias, cursos e CRM.",
      stackTarget: ["React", "Vite", "TypeScript", "TailwindCSS", "Framer Motion", "Node.js", "Express", "PostgreSQL", "Cloudinary", "JWT"],
      tenancy: "Preparado para multiempresa com separacao futura por studio_id/tenant_id."
    },
    metrics: {
      studios: 1,
      clients: clientsCount.count || 0,
      appointments: appointmentsCount.count || 0,
      jewelry: jewelryCount.count || 0,
      revenue: paid.total || 0
    },
    modules: [
      ["Dashboard", "ativo", "Indicadores, alertas, graficos e agenda do dia"],
      ["Agendamentos", "ativo", "Calendario, status, sinais, profissionais e joias"],
      ["Clientes e prontuÃƒÂ¡rios", "ativo", "HistÃƒÂ³rico, fotos, intercorrÃƒÂªncias, fidelidade e retornos"],
      ["Termo digital", "ativo", "Assinatura, aceite e PDF automÃƒÂ¡tico"],
      ["Estoque de joalherias", "ativo", "Cadastro, filtros, baixa automÃƒÂ¡tica e alertas"],
      ["Catalogo online", "planejado", "Vitrine publica com reserva, compra e agendamento"],
      ["Financeiro", "ativo", "Entradas, saidas, lucro e exportaÃƒÂ§ÃƒÂµes"],
      ["CRM", "planejado", "Funil, automaÃƒÂ§ÃƒÂµes, reativaÃƒÂ§ÃƒÂ£o e aniversÃƒÂ¡rios"],
      ["Aura Rewards", "ativo", "Pontos, niveis e resgates"],
      ["Indique e Ganhe", "planejado", "Indicacoes, beneficios e acompanhamento"],
      ["Cupons", "planejado", "Cupons fixos, percentuais, validade e limite"],
      ["Influenciadores", "planejado", "Cupons, cliques, vendas, conversoes e comissoes"],
      ["Consultorias", "planejado", "Agenda, pagamento e Google Meet"],
      ["Aura Academy", "planejado", "Cursos, videos, PDFs e certificados"],
      ["ConteÃƒÂºdo", "planejado", "CalendÃƒÂ¡rio editorial, ideias, hashtags e legendas IA"],
      ["Mapa corporal", "planejado", "Modelo anatÃƒÂ´mico com histÃƒÂ³rico de perfuraÃƒÂ§ÃƒÂµes"],
      ["Administrativo", "ativo", "PermissÃƒÂµes por perfil e usuÃƒÂ¡rios"],
      ["Relatorios", "ativo", "Financeiro, clientes, estoque e exportaÃƒÂ§ÃƒÂµes"],
      ["Configuracoes", "planejado", "Logo, cores, horarios, profissionais e mensagens"]
    ].map(([name, status, description]) => ({ name, status, description })),
    crm,
    catalogItems,
    bodyMap,
    coupons: [
      { code: "AURA15", type: "percentual", value: 15, status: "ativo" },
      { code: "JULIA10", type: "percentual", value: 10, status: "influenciador" }
    ],
    influencers: [
      { name: "Julia Mendes", instagram: "@juliamendes", coupon: "JULIA10", conversions: 12, commission: 420 },
      { name: "Marina Glow", instagram: "@marinaglow", coupon: "GLOWAURA", conversions: 8, commission: 280 }
    ],
    consultancies: [
      { name: "Consultoria individual", price: 497, format: "Google Meet" },
      { name: "Mentoria Aura Pro", price: 1497, format: "Online ao vivo" }
    ],
    academy: [
      { name: "Biosseguranca para Body Piercer", lessons: 12, students: 34 },
      { name: "Curadoria de Joias Premium", lessons: 8, students: 19 }
    ],
    contentPlanner: [
      ["Segunda", "Reels"],
      ["Terca", "Antes e depois"],
      ["Quarta", "Mitos"],
      ["Quinta", "Bastidores"],
      ["Sexta", "Promocoes"],
      ["Sabado", "Clientes"],
      ["Domingo", "Autoridade"]
    ].map(([day, theme]) => ({ day, theme }))
  });
}));

app.get("/api/users", withDb(async (_req, res, db) => {
  if (!requireRole(_req, res, ["admin"])) return;
  res.json(await db.all("SELECT id, name, email, role, created_at FROM users ORDER BY name"));
}));

app.post("/api/users", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  const { name, email, password, role } = req.body;
  const validRoles = ["admin", "piercer", "reception", "finance"];
  if (!name?.trim() || !email?.trim() || !password || !validRoles.includes(role)) {
    return res.status(400).json({ error: "Dados de usuÃƒÂ¡rio invÃƒÂ¡lidos." });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const result = await db.run(
    "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)",
    [name.trim(), email.trim(), passwordHash, role]
  );
  res.status(201).json(await db.get("SELECT id, name, email, role, created_at FROM users WHERE id = ?", [result.lastID]));
}));

app.patch("/api/users/:id", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  const user = await db.get("SELECT * FROM users WHERE id = ?", [req.params.id]);
  if (!user) return res.status(404).json({ error: "UsuÃƒÂ¡rio nÃƒÂ£o encontrado." });
  const role = req.body.role || user.role;
  if (!["admin", "piercer", "reception", "finance"].includes(role)) return res.status(400).json({ error: "NÃƒÂ­vel de acesso invÃƒÂ¡lido." });
  const passwordHash = req.body.password ? await bcrypt.hash(req.body.password, 10) : user.password_hash;
  await db.run(
    "UPDATE users SET name = ?, email = ?, role = ?, password_hash = ? WHERE id = ?",
    [req.body.name || user.name, req.body.email || user.email, role, passwordHash, req.params.id]
  );
  res.json(await db.get("SELECT id, name, email, role, created_at FROM users WHERE id = ?", [req.params.id]));
}));

app.delete("/api/users/:id", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  if (Number(req.params.id) === Number(req.user.id)) {
    return res.status(409).json({ error: "VocÃƒÂª nÃƒÂ£o pode apagar o prÃƒÂ³prio acesso." });
  }
  const target = await db.get("SELECT id, role FROM users WHERE id = ?", [req.params.id]);
  if (!target) return res.status(404).json({ error: "UsuÃƒÂ¡rio nÃƒÂ£o encontrado." });
  if (target.role === "admin") {
    const admins = await db.get("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'");
    if ((admins.count || 0) <= 1) return res.status(409).json({ error: "Mantenha ao menos um administrador ativo." });
  }
  await db.run("DELETE FROM users WHERE id = ?", [req.params.id]);
  res.json({ ok: true });
}));

app.post("/api/admin/reset-demo-data", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  if (req.body?.confirmation !== "RESETAR") {
    return res.status(400).json({ error: "Digite RESETAR para confirmar a limpeza dos dados." });
  }

  const tables = [
    "post_care_followups",
    "digital_terms",
    "client_medical_records",
    "loyalty_points",
    "loyalty_redemptions",
    "sales_order_items",
    "sales_orders",
    "payments",
    "appointments",
    "schedule_blocks",
    "stock_movements",
    "catalog_featured_products",
    "catalog_promotions",
    "expenses",
    "jewelry_variants",
    "jewelry_inventory",
    "clients"
  ];

  const removed = {};
  await db.exec("BEGIN IMMEDIATE TRANSACTION");
  try {
    for (const table of tables) {
      const count = await db.get(`SELECT COUNT(*) AS count FROM ${table}`);
      removed[table] = Number(count?.count || 0);
      await db.run(`DELETE FROM ${table}`);
    }
    await db.run(
      `DELETE FROM sqlite_sequence WHERE name IN (${tables.map(() => "?").join(", ")})`,
      tables
    );
    await db.exec("COMMIT");
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }

  res.json({
    ok: true,
    message: "Dados de demonstraÃƒÂ§ÃƒÂ£o removidos. UsuÃƒÂ¡rios, categorias e configuraÃƒÂ§ÃƒÂµes foram preservados.",
    removed
  });
}));

app.get("/api/options", withDb(async (_req, res, db) => {
  const professionals = await db.all("SELECT * FROM professionals WHERE active = 1 ORDER BY name");
  const jewelry = await attachVariants(db, await db.all("SELECT * FROM jewelry_inventory ORDER BY name"));
  const inventoryOptions = await db.all("SELECT * FROM inventory_options ORDER BY type, name");
  res.json({
    professionals,
    jewelry,
    jewelryCategories: JEWELRY_CATEGORIES,
    jewelrySubcategories: { Argolas: ARGOLA_SUBCATEGORIES },
    inventoryOptions: groupInventoryOptions(inventoryOptions)
  });
}));

app.post("/api/inventory-options", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  const { type, name } = req.body;
  if (!["category", "size", "thickness"].includes(type) || !name?.trim()) {
    return res.status(400).json({ error: "OpÃƒÂ§ÃƒÂ£o invÃƒÂ¡lida." });
  }
  const cleanName = name.trim();
  const existing = await db.get("SELECT * FROM inventory_options WHERE type = ? AND name = ?", [type, cleanName]);
  if (existing) return res.json(existing);
  const result = await db.run("INSERT INTO inventory_options (type, name) VALUES (?, ?)", [type, cleanName]);
  res.status(201).json(await db.get("SELECT * FROM inventory_options WHERE id = ?", [result.lastID]));
}));

app.patch("/api/inventory-options/:id", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  const option = await db.get("SELECT * FROM inventory_options WHERE id = ?", [req.params.id]);
  if (!option) return res.status(404).json({ error: "OpÃƒÂ§ÃƒÂ£o nÃƒÂ£o encontrada." });
  const name = req.body.name?.trim();
  if (!name) return res.status(400).json({ error: "Nome obrigatÃƒÂ³rio." });
  const duplicate = await db.get("SELECT id FROM inventory_options WHERE type = ? AND name = ? AND id != ?", [option.type, name, req.params.id]);
  if (duplicate) return res.status(409).json({ error: "JÃƒÂ¡ existe uma opÃƒÂ§ÃƒÂ£o com esse nome." });
  const fieldByType = { category: "category", size: "size", thickness: "thickness" };
  const field = fieldByType[option.type];
  if (!field) return res.status(400).json({ error: "ObservaÃƒÂ§ÃƒÂ£o de cor agora ÃƒÂ© texto livre." });
  await db.run("UPDATE inventory_options SET name = ? WHERE id = ?", [name, req.params.id]);
  await db.run(`UPDATE jewelry_inventory SET ${field} = ? WHERE ${field} = ?`, [name, option.name]);
  res.json(await db.get("SELECT * FROM inventory_options WHERE id = ?", [req.params.id]));
}));

app.delete("/api/inventory-options/:id", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  const option = await db.get("SELECT * FROM inventory_options WHERE id = ?", [req.params.id]);
  if (!option) return res.status(404).json({ error: "OpÃƒÂ§ÃƒÂ£o nÃƒÂ£o encontrada." });
  const usage = await countOptionUsage(db, option);
  if (usage > 0) return res.status(409).json({ error: "Esta opÃƒÂ§ÃƒÂ£o estÃƒÂ¡ em uso no estoque e nÃƒÂ£o pode ser apagada." });
  await db.run("DELETE FROM inventory_options WHERE id = ?", [req.params.id]);
  res.json({ ok: true });
}));

app.post("/api/professionals", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  const { name, specialty } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Nome do profissional ÃƒÂ© obrigatÃƒÂ³rio." });
  const result = await db.run("INSERT INTO professionals (name, specialty, active) VALUES (?, ?, 1)", [name.trim(), specialty || ""]);
  res.status(201).json(await db.get("SELECT * FROM professionals WHERE id = ?", [result.lastID]));
}));

app.patch("/api/professionals/:id", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  const professional = await db.get("SELECT * FROM professionals WHERE id = ?", [req.params.id]);
  if (!professional) return res.status(404).json({ error: "Profissional nÃƒÂ£o encontrado." });
  await db.run("UPDATE professionals SET name = ?, specialty = ? WHERE id = ?", [req.body.name?.trim() || professional.name, req.body.specialty || professional.specialty, req.params.id]);
  res.json(await db.get("SELECT * FROM professionals WHERE id = ?", [req.params.id]));
}));

app.delete("/api/professionals/:id", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  const linked = await db.get("SELECT COUNT(*) AS count FROM appointments WHERE professional_id = ?", [req.params.id]);
  if (linked.count > 0) {
    await db.run("UPDATE professionals SET active = 0 WHERE id = ?", [req.params.id]);
    return res.json({ ok: true, archived: true });
  }
  await db.run("DELETE FROM professionals WHERE id = ?", [req.params.id]);
  res.json({ ok: true, archived: false });
}));

app.get("/api/appointments", withDb(async (req, res, db) => {
  const clauses = [];
  const params = [];
  if (req.query.professional_id) {
    clauses.push("a.professional_id = ?");
    params.push(req.query.professional_id);
  }
  if (req.query.status) {
    clauses.push("a.status = ?");
    params.push(req.query.status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  res.json(await listAppointments(db, where, params));
}));

app.post("/api/appointments", upload.single("reference_photo"), withDb(async (req, res, db) => {
  const body = normalizeAppointment(req.body);
  // Bloqueia horÃƒÂ¡rios jÃƒÂ¡ ocupados para o mesmo profissional.
  const conflict = await db.get(
    `SELECT id FROM appointments
     WHERE professional_id = ? AND appointment_date = ? AND appointment_time = ?
     AND status NOT IN ('cancelado', 'remarcado')`,
    [body.professional_id, body.appointment_date, body.appointment_time]
  );
  if (conflict) {
    return res.status(409).json({ error: "HorÃƒÂ¡rio ocupado para este profissional." });
  }
  const photoUrl = req.file ? `/uploads/${req.file.filename}` : body.reference_photo_url || "";
  const client = await upsertClient(db, body);
  const service = body.service_id ? await db.get("SELECT * FROM services WHERE id = ?", [body.service_id]) : null;
  const endTime = service ? addMinutesToTime(body.appointment_time, Number(service.duration_minutes || 40)) : null;
  const result = await db.run(
    `INSERT INTO appointments
    (client_id, professional_id, service_id, jewelry_id, jewelry_variant_id, procedure, description, piercing_region, appointment_date, appointment_time, end_time, total_value, deposit_value, remaining_value, deposit_payment_method, remaining_payment_method, status, notes, reference_photo_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [client.id, body.professional_id, body.service_id || null, body.jewelry_id || null, body.jewelry_variant_id || null, body.procedure, body.description, body.piercing_region, body.appointment_date, body.appointment_time, endTime, body.total_value, body.deposit_value, body.remaining_value, body.deposit_payment_method, body.remaining_payment_method, body.status, body.notes, photoUrl]
  );
  if (body.deposit_value > 0) {
    await db.run(
      "INSERT INTO payments (appointment_id, client_id, amount, payment_type, method, status, paid_at) VALUES (?, ?, ?, 'sinal', ?, 'pago', ?)",
      [result.lastID, client.id, body.deposit_value, body.deposit_payment_method, `${body.appointment_date}T${body.appointment_time}:00`]
    );
  }
  res.status(201).json(await db.get("SELECT * FROM appointments WHERE id = ?", [result.lastID]));
}));

app.patch("/api/appointments/:id", withDb(async (req, res, db) => {
  const appointment = await db.get("SELECT * FROM appointments WHERE id = ?", [req.params.id]);
  if (!appointment) return res.status(404).json({ error: "Agendamento nÃƒÂ£o encontrado." });

  const fields = ["status", "appointment_date", "appointment_time", "end_time", "professional_id", "service_id", "jewelry_id", "jewelry_variant_id", "procedure", "description", "piercing_region", "total_value", "deposit_value", "remaining_value", "deposit_payment_method", "remaining_payment_method", "notes"];
  const updates = fields.filter((field) => req.body[field] !== undefined);
  if (updates.length) {
    await db.run(
      `UPDATE appointments SET ${updates.map((field) => `${field} = ?`).join(", ")} WHERE id = ?`,
      [...updates.map((field) => req.body[field]), req.params.id]
    );
  }

  if (req.body.status === "atendido") {
    await deductJewelryStock(db, req.params.id);
    await registerRemainingPayment(db, req.params.id);
    await ensurePostCareFollowups(db, req.params.id);
    await awardLoyaltyForAppointment(db, req.params.id);
  }
  res.json(await listAppointments(db, "WHERE a.id = ?", [req.params.id]).then((rows) => rows[0]));
}));

app.get("/api/sales-orders", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "finance", "reception", "piercer"])) return;
  res.json(await listSalesOrders(db));
}));

app.post("/api/sales-orders", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "finance", "reception", "piercer"])) return;
  const order = await createSalesOrder(db, req.body || {}, req.user);
  if (!order) return res.status(400).json({ error: "NÃƒÂ£o foi possÃƒÂ­vel criar a venda." });
  res.status(201).json(order);
}));

app.post("/api/sales-orders/public", withDb(async (req, res, db) => {
  const order = await createSalesOrder(db, req.body || {}, null);
  if (!order) return res.status(400).json({ error: "NÃƒÂ£o foi possÃƒÂ­vel criar a venda." });
  res.status(201).json(order);
}));

app.patch("/api/sales-orders/:id", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "finance", "reception"])) return;
  const current = await db.get("SELECT * FROM sales_orders WHERE id = ?", [req.params.id]);
  if (!current) return res.status(404).json({ error: "Venda nÃƒÂ£o encontrada." });
  await db.run(
    "UPDATE sales_orders SET status = ?, payment_method = ?, notes = ? WHERE id = ?",
    [req.body.status || current.status, req.body.payment_method || current.payment_method, req.body.notes || current.notes, req.params.id]
  );
  res.json((await listSalesOrders(db)).find((item) => item.id === Number(req.params.id)));
}));

app.get("/api/digital-terms", withDb(async (_req, res, db) => {
  res.json(await listDigitalTerms(db));
}));

app.post("/api/digital-terms", withDb(async (req, res, db) => {
  const body = req.body;
  if (!body.appointment_id || !body.client_id || !body.full_name?.trim() || !body.signature_data_url) {
    return res.status(400).json({ error: "Dados obrigatÃƒÂ³rios do termo nÃƒÂ£o foram preenchidos." });
  }
  if (!body.orientations_confirmed) {
    return res.status(400).json({ error: "O cliente precisa confirmar que recebeu as orientaÃƒÂ§ÃƒÂµes." });
  }
  const appointment = await listAppointments(db, "WHERE a.id = ?", [body.appointment_id]).then((rows) => rows[0]);
  if (!appointment) return res.status(404).json({ error: "Agendamento nÃƒÂ£o encontrado." });

  const result = await db.run(
    `INSERT INTO digital_terms
    (appointment_id, client_id, full_name, social_name, document_number, birth_date, whatsapp, instagram, address, procedure, piercing_region, orientations_confirmed, health_declaration, form_data, signature_data_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      body.appointment_id,
      body.client_id,
      body.full_name,
      body.social_name || "",
      body.document_number || "",
      body.birth_date || "",
      body.whatsapp || "",
      body.instagram || appointment.instagram || "",
      body.address || "",
      body.procedure || appointment.procedure,
      body.piercing_region || appointment.piercing_region,
      body.orientations_confirmed ? 1 : 0,
      body.health_declaration || "",
      JSON.stringify(body.form_data || {}),
      body.signature_data_url
    ]
  );
  const term = await db.get("SELECT * FROM digital_terms WHERE id = ?", [result.lastID]);
  const pdfUrl = await createTermPdf(term, appointment);
  await db.run("UPDATE digital_terms SET pdf_url = ? WHERE id = ?", [pdfUrl, result.lastID]);
  res.status(201).json((await listDigitalTerms(db)).find((item) => item.id === result.lastID));
}));

app.get("/api/post-care", withDb(async (_req, res, db) => {
  await ensureFollowupsForCompletedAppointments(db);
  res.json(await listPostCareFollowups(db));
}));

app.patch("/api/post-care/:id", upload.single("client_photo"), withDb(async (req, res, db) => {
  const existing = await db.get("SELECT * FROM post_care_followups WHERE id = ?", [req.params.id]);
  if (!existing) return res.status(404).json({ error: "Acompanhamento nÃƒÂ£o encontrado." });
  const photoUrl = req.file ? `/uploads/${req.file.filename}` : existing.client_photo_url;
  await db.run(
    `UPDATE post_care_followups
     SET care_message = ?, healing_status = ?, client_notes = ?, status = ?, client_photo_url = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      req.body.care_message || existing.care_message,
      req.body.healing_status || existing.healing_status,
      req.body.client_notes || existing.client_notes,
      req.body.status || existing.status,
      photoUrl,
      req.params.id
    ]
  );
  res.json((await listPostCareFollowups(db)).find((item) => item.id === Number(req.params.id)));
}));

app.get("/api/jewelry", withDb(async (req, res, db) => {
  const clauses = [];
  const params = [];
  if (req.query.search) {
    clauses.push(`(
      j.name LIKE ? OR j.description LIKE ? OR j.category LIKE ? OR j.subcategory LIKE ?
      OR EXISTS (
        SELECT 1 FROM jewelry_variants v
        WHERE v.jewelry_id = j.id
          AND (v.sku LIKE ? OR v.material LIKE ? OR v.color LIKE ? OR v.size LIKE ? OR v.thickness LIKE ? OR v.length LIKE ? OR v.diameter LIKE ? OR v.thread_type LIKE ? OR v.supplier LIKE ?)
      )
    )`);
    params.push(...Array(13).fill(`%${req.query.search}%`));
  }
  for (const field of ["category", "subcategory", "status", "physical_location"]) {
    if (req.query[field]) {
      clauses.push(`j.${field} = ?`);
      params.push(req.query[field]);
    }
  }
  for (const field of ["material", "color", "size", "thickness", "length", "diameter", "thread_type", "supplier"]) {
    if (req.query[field]) {
      clauses.push(`EXISTS (SELECT 1 FROM jewelry_variants v WHERE v.jewelry_id = j.id AND v.${field} LIKE ?)`);
      params.push(`%${req.query[field]}%`);
    }
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await db.all(`SELECT j.* FROM jewelry_inventory j ${where} ORDER BY j.category, j.name`, params);
  res.json(await attachVariants(db, rows));
}));

app.post("/api/jewelry", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  if (!JEWELRY_CATEGORIES.includes(req.body.category)) {
    return res.status(400).json({ error: "Selecione uma categoria principal vÃƒÂ¡lida." });
  }
  if (!req.body.name?.trim()) return res.status(400).json({ error: "Informe o nome do produto." });
  const result = await db.run(
    `INSERT INTO jewelry_inventory
    (name, description, photo_url, gallery_urls, category, subcategory, variant_group, variation_label, material, color, stone, size, thickness, stem_length, thread_type, piercing_type, weight_grams, package_length_cm, package_width_cm, package_height_cm, package_type, virtual_store_active, preparation_days, shipping_info, seo_title, seo_description, freight_notes, quantity, cost_value, sale_value, supplier, physical_location, sku, is_catalog_active, is_featured, is_new, is_most_wanted, is_promotion, is_last_units, notes, status, low_stock_threshold, critical_stock_threshold)
    VALUES (${Array(43).fill("?").join(", ")})`,
    [
      elegantProductName(req.body.name),
      req.body.description || "",
      req.body.photo_url,
      JSON.stringify(req.body.gallery_urls || []),
      req.body.category,
      req.body.subcategory || "",
      req.body.variant_group || "",
      req.body.variation_label || "",
      req.body.material || "",
      req.body.color || "",
      req.body.stone,
      req.body.size,
      req.body.thickness,
      req.body.stem_length,
      req.body.thread_type,
      req.body.piercing_type || "",
      Number(req.body.weight_grams || 0),
      Number(req.body.package_length_cm || 0),
      Number(req.body.package_width_cm || 0),
      Number(req.body.package_height_cm || 0),
      req.body.package_type || "",
      boolNumber(req.body.virtual_store_active),
      Number(req.body.preparation_days || 1),
      req.body.shipping_info || "",
      req.body.seo_title || "",
      req.body.seo_description || "",
      req.body.freight_notes || "",
      Number(req.body.quantity || 0),
      Number(req.body.cost_value || 0),
      Number(req.body.sale_value || 0),
      req.body.supplier,
      req.body.physical_location || "",
      req.body.sku || await generateSku(db, req.body),
      boolNumber(req.body.is_catalog_active),
      boolNumber(req.body.is_featured),
      boolNumber(req.body.is_new),
      boolNumber(req.body.is_most_wanted),
      boolNumber(req.body.is_promotion),
      boolNumber(req.body.is_last_units),
      req.body.notes,
      req.body.status || "disponÃƒÂ­vel",
      Number(req.body.low_stock_threshold || 5),
      Number(req.body.critical_stock_threshold || 3)
    ]
  );
  await replaceJewelryVariants(db, result.lastID, req.body.variants || [variantFromLegacy(req.body)]);
  res.status(201).json((await attachVariants(db, [await db.get("SELECT * FROM jewelry_inventory WHERE id = ?", [result.lastID])]))[0]);
}));

app.patch("/api/jewelry/:id", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  const jewelry = await db.get("SELECT * FROM jewelry_inventory WHERE id = ?", [req.params.id]);
  if (!jewelry) return res.status(404).json({ error: "Joia nÃƒÂ£o encontrada." });
  const fields = ["name", "description", "photo_url", "image_url", "gallery_urls", "category", "subcategory", "variant_group", "variation_label", "material", "color", "stone", "size", "thickness", "stem_length", "thread_type", "piercing_type", "weight_grams", "package_length_cm", "package_width_cm", "package_height_cm", "package_type", "virtual_store_active", "preparation_days", "shipping_info", "seo_title", "seo_description", "freight_notes", "quantity", "cost_value", "sale_value", "supplier", "physical_location", "sku", "is_catalog_active", "is_featured", "is_new", "is_most_wanted", "is_promotion", "is_last_units", "is_published", "notes", "status", "low_stock_threshold", "critical_stock_threshold"];
  const updates = fields.filter((field) => req.body[field] !== undefined);
  if (updates.length) {
    await db.run(
      `UPDATE jewelry_inventory SET ${updates.map((field) => `${field} = ?`).join(", ")} WHERE id = ?`,
      [...updates.map((field) => {
        if (["quantity", "cost_value", "sale_value", "low_stock_threshold", "critical_stock_threshold", "weight_grams", "package_length_cm", "package_width_cm", "package_height_cm", "preparation_days", "is_catalog_active", "is_featured", "is_new", "is_most_wanted", "is_promotion", "is_last_units", "virtual_store_active", "is_published"].includes(field)) return Number(req.body[field] || 0);
        if (field === "gallery_urls") return typeof req.body.gallery_urls === "string" ? req.body.gallery_urls : JSON.stringify(req.body.gallery_urls || []);
        return field === "name" ? elegantProductName(req.body[field]) : req.body[field];
      }), req.params.id]
    );
  }
  if (Array.isArray(req.body.variants)) await replaceJewelryVariants(db, jewelry.id, req.body.variants);
  res.json((await attachVariants(db, [await db.get("SELECT * FROM jewelry_inventory WHERE id = ?", [req.params.id])]))[0]);
}));

app.post("/api/jewelry/:id/variants/:variantId/movements", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  const variant = await db.get(
    "SELECT * FROM jewelry_variants WHERE id = ? AND jewelry_id = ?",
    [req.params.variantId, req.params.id]
  );
  if (!variant) return res.status(404).json({ error: "VariaÃƒÂ§ÃƒÂ£o nÃƒÂ£o encontrada." });
  const quantity = Math.max(0, Number(req.body.quantity || 0));
  const movementType = req.body.movement_type || "Ajuste";
  const normalizedMovement = String(movementType).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const nextQuantity = Math.max(0, Number(variant.quantity || 0) + (["saida", "venda", "perda"].includes(normalizedMovement) ? -quantity : quantity));
  const status = variantStatus(nextQuantity, variant.low_stock_threshold);
  await db.run(
    "INSERT INTO stock_movements (jewelry_id, variant_id, movement_type, quantity, notes, movement_date) VALUES (?, ?, ?, ?, ?, ?)",
    [req.params.id, variant.id, movementType, quantity, req.body.notes || "", req.body.movement_date || new Date().toISOString().slice(0, 10)]
  );
  await db.run(
    "UPDATE jewelry_variants SET quantity = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [nextQuantity, status, variant.id]
  );
  await syncProductInventory(db, req.params.id);
  res.json({ ok: true, product: (await attachVariants(db, [await db.get("SELECT * FROM jewelry_inventory WHERE id = ?", [req.params.id])]))[0] });
}));

app.get("/api/jewelry/:id/movements", withDb(async (req, res, db) => {
  const movements = await db.all(
    `SELECT * FROM stock_movements WHERE jewelry_id = ? ORDER BY movement_date DESC, id DESC LIMIT 20`,
    [req.params.id]
  );
  res.json(movements);
}));

app.post("/api/jewelry/:id/movements", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  const jewelry = await db.get("SELECT * FROM jewelry_inventory WHERE id = ?", [req.params.id]);
  if (!jewelry) return res.status(404).json({ error: "Joia nÃƒÂ£o encontrada." });
  const quantity = Math.max(0, Number(req.body.quantity || 0));
  const movementType = req.body.movement_type || "Ajuste";
  const notes = req.body.notes || "";
  const decreaseTypes = new Set(["SaÃƒÂ­da", "Venda", "Perda"]);
  const delta = decreaseTypes.has(movementType) ? -quantity : quantity;
  const nextQuantity = Math.max(0, Number(jewelry.quantity || 0) + delta);
  const criticalThreshold = Number(jewelry.critical_stock_threshold || 3);
  const lowThreshold = Number(jewelry.low_stock_threshold || 5);
  const status = nextQuantity <= 0 ? "esgotado" : nextQuantity <= criticalThreshold ? "crÃƒÂ­tico" : nextQuantity <= lowThreshold ? "baixo estoque" : "disponÃƒÂ­vel";
  await db.run("INSERT INTO stock_movements (jewelry_id, movement_type, quantity, notes, movement_date) VALUES (?, ?, ?, ?, ?)", [
    jewelry.id,
    movementType,
    quantity,
    notes,
    req.body.movement_date || new Date().toISOString().slice(0, 10)
  ]);
  await db.run("UPDATE jewelry_inventory SET quantity = ?, status = ? WHERE id = ?", [nextQuantity, status, req.params.id]);
  res.json({
    ok: true,
    jewelry: await db.get("SELECT * FROM jewelry_inventory WHERE id = ?", [req.params.id]),
    movements: await db.all("SELECT * FROM stock_movements WHERE jewelry_id = ? ORDER BY movement_date DESC, id DESC LIMIT 20", [req.params.id])
  });
}));

app.delete("/api/jewelry/:id", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  const linked = await db.get(`
    SELECT
      (SELECT COUNT(*) FROM appointments WHERE jewelry_id = ?) +
      (SELECT COUNT(*) FROM stock_movements WHERE jewelry_id = ?) +
      (SELECT COUNT(*) FROM sales_order_items WHERE product_id = ?) AS count
  `, [req.params.id, req.params.id, req.params.id]);
  if (linked.count > 0) {
    await db.run("UPDATE jewelry_inventory SET status = 'arquivado', is_catalog_active = 0 WHERE id = ?", [req.params.id]);
    return res.json({ ok: true, archived: true });
  }
  await db.run("DELETE FROM jewelry_inventory WHERE id = ?", [req.params.id]);
  res.json({ ok: true, archived: false });
}));

app.get("/api/clients", withDb(async (_req, res, db) => {
  const clients = await db.all("SELECT * FROM clients ORDER BY full_name");
  for (const client of clients) {
    client.history = await listAppointments(db, "WHERE a.client_id = ?", [client.id]);
    client.payments = await db.all("SELECT * FROM payments WHERE client_id = ? ORDER BY paid_at DESC", [client.id]);
    client.medicalRecords = await listMedicalRecords(db, client.id);
    client.loyalty = await getClientLoyalty(db, client.id);
  }
  res.json(clients);
}));

app.patch("/api/clients/:id", withDb(async (req, res, db) => {
  const client = await db.get("SELECT * FROM clients WHERE id = ?", [req.params.id]);
  if (!client) return res.status(404).json({ error: "Cliente nÃƒÂ£o encontrado." });
  await db.run(
    "UPDATE clients SET full_name = ?, whatsapp = ?, instagram = ?, birth_date = ?, notes = ? WHERE id = ?",
    [
      req.body.full_name || client.full_name,
      req.body.whatsapp || client.whatsapp,
      req.body.instagram || client.instagram,
      req.body.birth_date || client.birth_date,
      req.body.notes || client.notes,
      req.params.id
    ]
  );
  res.json(await db.get("SELECT * FROM clients WHERE id = ?", [req.params.id]));
}));

app.get("/api/backup.sqlite", withDb(async (req, res) => {
  if (!requireRole(req, res, ["admin"])) return;
  const dbPath = fileURLToPath(new URL("./data/aura-clinic.sqlite", import.meta.url));
  res.download(dbPath, `backup-aura-clinic-${new Date().toISOString().slice(0, 10)}.sqlite`);
}));

app.post("/api/clients/:id/loyalty-redemptions", withDb(async (req, res, db) => {
  const client = await db.get("SELECT id FROM clients WHERE id = ?", [req.params.id]);
  if (!client) return res.status(404).json({ error: "Cliente nÃƒÂ£o encontrado." });
  const points = Number(req.body.points_used || 0);
  const discount = Number(req.body.discount_value || 0);
  const loyalty = await getClientLoyalty(db, req.params.id);
  if (points <= 0 || points > loyalty.availablePoints) {
    return res.status(400).json({ error: "Pontos insuficientes para resgate." });
  }
  await db.run(
    "INSERT INTO loyalty_redemptions (client_id, points_used, discount_value, notes) VALUES (?, ?, ?, ?)",
    [req.params.id, points, discount, req.body.notes || ""]
  );
  res.status(201).json(await getClientLoyalty(db, req.params.id));
}));

app.post("/api/clients/:id/medical-records", upload.fields([{ name: "before_photo", maxCount: 1 }, { name: "after_photo", maxCount: 1 }]), withDb(async (req, res, db) => {
  const client = await db.get("SELECT id FROM clients WHERE id = ?", [req.params.id]);
  if (!client) return res.status(404).json({ error: "Cliente nÃƒÂ£o encontrado." });
  const body = req.body;
  const beforePhoto = req.files?.before_photo?.[0] ? `/uploads/${req.files.before_photo[0].filename}` : "";
  const afterPhoto = req.files?.after_photo?.[0] ? `/uploads/${req.files.after_photo[0].filename}` : "";
  const result = await db.run(
    `INSERT INTO client_medical_records
    (client_id, appointment_id, record_date, piercing_history, jewelry_used, before_photo_url, after_photo_url, occurrences, guidance, allergies_notes, healing_evolution, returns_done)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      req.params.id,
      body.appointment_id || null,
      body.record_date || new Date().toISOString().slice(0, 10),
      body.piercing_history || "",
      body.jewelry_used || "",
      beforePhoto,
      afterPhoto,
      body.occurrences || "",
      body.guidance || "",
      body.allergies_notes || "",
      body.healing_evolution || "",
      body.returns_done || ""
    ]
  );
  res.status(201).json((await listMedicalRecords(db, req.params.id)).find((record) => record.id === result.lastID));
}));

app.delete("/api/clients/:clientId/medical-records/:recordId", withDb(async (req, res, db) => {
  await db.run("DELETE FROM client_medical_records WHERE id = ? AND client_id = ?", [req.params.recordId, req.params.clientId]);
  res.json({ ok: true });
}));

app.get("/api/finance", withDb(async (_req, res, db) => {
  if (!requireRole(_req, res, ["admin", "finance"])) return;
  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const finance = await buildFinanceReport(db);
  res.json(finance);
}));

app.post("/api/expenses", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "finance"])) return;
  const { description, expense_type, category, amount, due_date, status, payment_method, notes } = req.body;
  if (!description?.trim() || !["fixa", "variavel"].includes(expense_type) || !due_date) {
    return res.status(400).json({ error: "Dados da despesa invÃƒÂ¡lidos." });
  }
  const result = await db.run(
    `INSERT INTO expenses (description, expense_type, category, amount, due_date, status, payment_method, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [description.trim(), expense_type, category || "", Number(amount || 0), due_date, status || "paga", payment_method || "", notes || ""]
  );
  res.status(201).json(await db.get("SELECT * FROM expenses WHERE id = ?", [result.lastID]));
}));

app.delete("/api/expenses/:id", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "finance"])) return;
  await db.run("DELETE FROM expenses WHERE id = ?", [req.params.id]);
  res.json({ ok: true });
}));

async function buildFinanceReport(db) {
  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const totals = await db.get(`
    SELECT
      SUM(CASE WHEN DATE(paid_at) = ? THEN amount ELSE 0 END) AS day_total,
      SUM(CASE WHEN paid_at >= DATE(?, '-6 days') THEN amount ELSE 0 END) AS week_total,
      SUM(CASE WHEN paid_at LIKE ? THEN amount ELSE 0 END) AS month_total
    FROM payments WHERE status = 'pago'
  `, [today, today, `${month}%`]);
  const salesTotals = await db.get(`
    SELECT
      SUM(CASE WHEN DATE(created_at) = ? THEN total_value ELSE 0 END) AS day_total,
      SUM(CASE WHEN created_at >= DATE(?, '-6 days') THEN total_value ELSE 0 END) AS week_total,
      SUM(CASE WHEN created_at LIKE ? THEN total_value ELSE 0 END) AS month_total
    FROM sales_orders
    WHERE status != 'cancelada' AND appointment_id IS NULL
  `, [today, today, `${month}%`]);
  const deposits = await db.get("SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE payment_type = 'sinal' AND status = 'pago' AND paid_at LIKE ?", [`${month}%`]);
  const forecast = await db.get("SELECT COALESCE(SUM(total_value), 0) AS total, COALESCE(SUM(remaining_value), 0) AS pending FROM appointments WHERE status IN ('pendente', 'confirmado')");
  const methods = await db.all("SELECT method, COUNT(*) AS total, COALESCE(SUM(amount), 0) AS amount FROM payments GROUP BY method ORDER BY total DESC");
  const orderMethods = await db.all("SELECT payment_method AS method, COUNT(*) AS total, COALESCE(SUM(total_value), 0) AS amount FROM sales_orders WHERE status != 'cancelada' AND appointment_id IS NULL GROUP BY payment_method ORDER BY total DESC");
  const expensesSummary = await db.get(`
    SELECT
      COALESCE(SUM(CASE WHEN expense_type = 'fixa' THEN amount ELSE 0 END), 0) AS fixed_total,
      COALESCE(SUM(CASE WHEN expense_type = 'variavel' THEN amount ELSE 0 END), 0) AS variable_total,
      COALESCE(SUM(amount), 0) AS total
    FROM expenses WHERE due_date LIKE ?
  `, [`${month}%`]);
  const expenses = await db.all("SELECT * FROM expenses ORDER BY due_date DESC, id DESC LIMIT 80");
  const monthlyRevenue = await db.all(`
    SELECT month, SUM(total) AS total FROM (
      SELECT SUBSTR(paid_at, 1, 7) AS month, amount AS total
      FROM payments
      WHERE status = 'pago'
      UNION ALL
      SELECT SUBSTR(created_at, 1, 7) AS month, total_value AS total
      FROM sales_orders
      WHERE status != 'cancelada' AND appointment_id IS NULL
    )
    GROUP BY month
    ORDER BY month
    LIMIT 12
  `);
  const dailyRevenue = await db.all(`
    SELECT label, SUM(total) AS total FROM (
      SELECT DATE(paid_at) AS label, amount AS total
      FROM payments
      WHERE status = 'pago' AND DATE(paid_at) >= DATE(?, '-6 days')
      UNION ALL
      SELECT DATE(created_at) AS label, total_value AS total
      FROM sales_orders
      WHERE status != 'cancelada' AND appointment_id IS NULL AND DATE(created_at) >= DATE(?, '-6 days')
    )
    GROUP BY label
    ORDER BY label
  `, [today, today]);
  const weeklyRevenue = await db.all(`
    SELECT label, SUM(total) AS total FROM (
      SELECT STRFTIME('%Y-W%W', paid_at) AS label, amount AS total
      FROM payments
      WHERE status = 'pago' AND DATE(paid_at) >= DATE(?, '-42 days')
      UNION ALL
      SELECT STRFTIME('%Y-W%W', created_at) AS label, total_value AS total
      FROM sales_orders
      WHERE status != 'cancelada' AND appointment_id IS NULL AND DATE(created_at) >= DATE(?, '-42 days')
    )
    GROUP BY label
    ORDER BY label
  `, [today, today]);
  const monthRevenue = (totals.month_total || 0) + (salesTotals.month_total || 0);
  return {
    totals: {
      day_total: (totals.day_total || 0) + (salesTotals.day_total || 0),
      week_total: (totals.week_total || 0) + (salesTotals.week_total || 0),
      month_total: monthRevenue
    },
    deposits: { monthTotal: deposits.total || 0 },
    forecast,
    expensesSummary,
    profit: { estimated: monthRevenue - (expensesSummary.total || 0) },
    mostUsedMethod: [...methods, ...orderMethods].sort((a, b) => Number(b.total || 0) - Number(a.total || 0))[0]?.method || "Sem registros",
    methods: [...methods, ...orderMethods],
    expenses,
    monthlyRevenue,
    weeklyRevenue,
    dailyRevenue
  };
}

app.get("/api/finance/export.csv", withDb(async (_req, res, db) => {
  if (!requireRole(_req, res, ["admin", "finance"])) return;
  const rows = await db.all(`
    SELECT p.id, c.full_name AS cliente, p.amount AS valor, p.payment_type AS tipo, p.method AS metodo, p.status, p.paid_at AS data, 'pagamento' AS origem
    FROM payments p JOIN clients c ON c.id = p.client_id
    UNION ALL
    SELECT so.id, c.full_name AS cliente, so.total_value AS valor, so.order_type AS tipo, so.payment_method AS metodo, so.status, so.created_at AS data, 'venda' AS origem
    FROM sales_orders so JOIN clients c ON c.id = so.client_id
    ORDER BY data DESC
  `);
  const header = "id,cliente,valor,tipo,metodo,status,data,origem";
  const csv = [header, ...rows.map((row) => Object.values(row).map(csvEscape).join(","))].join("\n");
  res.header("Content-Type", "text/csv; charset=utf-8");
  res.attachment("relatorio-aura-clinic.csv");
  res.send(csv);
}));

app.get("/api/finance/export.pdf", withDb(async (_req, res, db) => {
  if (!requireRole(_req, res, ["admin", "finance"])) return;
  const report = await buildFinanceReport(db);
  const doc = new PDFDocument({ margin: 42, size: "A4" });
  res.header("Content-Type", "application/pdf");
  res.attachment("relatorio-financeiro-aura.pdf");
  doc.pipe(res);
  doc.fontSize(20).text("Aura Clinic Piercing", { align: "center" });
  doc.fontSize(14).text("Relatorio financeiro administrativo", { align: "center" });
  doc.moveDown();
  writePdfMetric(doc, "Faturamento diario", report.totals.day_total);
  writePdfMetric(doc, "Faturamento semanal", report.totals.week_total);
  writePdfMetric(doc, "Faturamento mensal", report.totals.month_total);
  writePdfMetric(doc, "Sinais recebidos no mes", report.deposits.monthTotal);
  writePdfMetric(doc, "Valores pendentes", report.forecast.pending);
  writePdfMetric(doc, "Despesas fixas", report.expensesSummary.fixed_total);
  writePdfMetric(doc, "Despesas variaveis", report.expensesSummary.variable_total);
  writePdfMetric(doc, "Lucro estimado", report.profit.estimated);
  doc.moveDown().fontSize(13).text("Formas de pagamento mais usadas");
  report.methods.forEach((item) => doc.fontSize(10).text(`${item.method}: ${item.total} registro(s) - ${formatCurrency(item.amount)}`));
  doc.moveDown().fontSize(13).text("Despesas recentes");
  report.expenses.slice(0, 18).forEach((item) => doc.fontSize(10).text(`${item.due_date} | ${item.expense_type} | ${item.description} | ${formatCurrency(item.amount)} | ${item.status}`));
  doc.end();
}));

app.get("/api/finance/export.xlsx", withDb(async (_req, res, db) => {
  if (!requireRole(_req, res, ["admin", "finance"])) return;
  const report = await buildFinanceReport(db);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Aura Clinic Piercing";

  const summary = workbook.addWorksheet("Resumo");
  summary.columns = [{ header: "Indicador", key: "label", width: 32 }, { header: "Valor", key: "value", width: 18 }];
  summary.addRows([
    { label: "Faturamento diario", value: report.totals.day_total || 0 },
    { label: "Faturamento semanal", value: report.totals.week_total || 0 },
    { label: "Faturamento mensal", value: report.totals.month_total || 0 },
    { label: "Sinais recebidos no mes", value: report.deposits.monthTotal || 0 },
    { label: "Valores pendentes", value: report.forecast.pending || 0 },
    { label: "Despesas fixas", value: report.expensesSummary.fixed_total || 0 },
    { label: "Despesas variaveis", value: report.expensesSummary.variable_total || 0 },
    { label: "Lucro estimado", value: report.profit.estimated || 0 }
  ]);

  const expensesSheet = workbook.addWorksheet("Despesas");
  expensesSheet.columns = [
    { header: "Descricao", key: "description", width: 30 },
    { header: "Tipo", key: "expense_type", width: 14 },
    { header: "Categoria", key: "category", width: 18 },
    { header: "Valor", key: "amount", width: 14 },
    { header: "Vencimento", key: "due_date", width: 16 },
    { header: "Status", key: "status", width: 14 },
    { header: "Pagamento", key: "payment_method", width: 18 }
  ];
  expensesSheet.addRows(report.expenses);

  const monthlySheet = workbook.addWorksheet("Faturamento mensal");
  monthlySheet.columns = [{ header: "Mes", key: "month", width: 14 }, { header: "Total", key: "total", width: 16 }];
  monthlySheet.addRows(report.monthlyRevenue);

  res.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.attachment("relatorio-financeiro-aura.xlsx");
  await workbook.xlsx.write(res);
  res.end();
}));

async function listAppointments(db, where = "", params = []) {
  return db.all(`
    SELECT a.*, c.full_name, c.whatsapp, c.instagram, p.name AS professional_name,
      j.name AS jewelry_name, j.photo_url AS jewelry_photo,
      v.variation_name AS jewelry_variation_name, v.sku AS jewelry_variant_sku,
      s.name AS service_name
    FROM appointments a
    JOIN clients c ON c.id = a.client_id
    JOIN professionals p ON p.id = a.professional_id
    LEFT JOIN jewelry_inventory j ON j.id = a.jewelry_id
    LEFT JOIN jewelry_variants v ON v.id = a.jewelry_variant_id
    LEFT JOIN services s ON s.id = a.service_id
    ${where}
    ORDER BY a.appointment_date, a.appointment_time
  `, params);
}

async function listServices(db) {
  const services = await db.all("SELECT * FROM services ORDER BY active_online_booking DESC, name");
  for (const service of services) {
    service.professional_ids = (await db.all("SELECT professional_id FROM professional_services WHERE service_id = ?", [service.id])).map((item) => item.professional_id);
  }
  return services;
}

async function replaceProfessionalServices(db, serviceId, professionalIds) {
  const ids = Array.isArray(professionalIds) ? professionalIds : String(professionalIds || "").split(",");
  await db.run("DELETE FROM professional_services WHERE service_id = ?", [serviceId]);
  for (const id of ids.filter(Boolean)) {
    await db.run("INSERT OR IGNORE INTO professional_services (professional_id, service_id) VALUES (?, ?)", [Number(id), Number(serviceId)]);
  }
}

async function availableBookingSlots(db, { service, professionalId, date }) {
  const weekday = new Date(`${date}T12:00:00`).getDay();
  const availability = await db.get(
    "SELECT * FROM professional_availability WHERE professional_id = ? AND weekday = ? AND is_active = 1",
    [professionalId, weekday]
  );
  if (!availability) return [];
  const duration = Number(service.duration_minutes || availability.duration_minutes || 40);
  const step = duration + Number(availability.buffer_minutes || 0);
  const appointments = await db.all(
    `SELECT appointment_time, end_time
     FROM appointments
     WHERE professional_id = ? AND appointment_date = ? AND status NOT IN ('cancelado', 'recusado')`,
    [professionalId, date]
  );
  const blocks = await db.all(
    `SELECT *
     FROM schedule_blocks
     WHERE professional_id = ? AND DATE(start_datetime) <= DATE(?) AND DATE(end_datetime) >= DATE(?)`,
    [professionalId, date, date]
  );
  const slots = [];
  for (let cursor = timeToMinutes(availability.start_time); cursor + duration <= timeToMinutes(availability.end_time); cursor += step) {
    const start = cursor;
    const end = cursor + duration;
    if (availability.lunch_start && availability.lunch_end && rangesOverlap(start, end, timeToMinutes(availability.lunch_start), timeToMinutes(availability.lunch_end))) continue;
    if (appointments.some((item) => rangesOverlap(start, end, timeToMinutes(item.appointment_time), timeToMinutes(item.end_time || addMinutesToTime(item.appointment_time, duration))))) continue;
    if (blocks.some((block) => block.is_full_day || rangesOverlap(start, end, dateTimeToDayMinutes(block.start_datetime), dateTimeToDayMinutes(block.end_datetime)))) continue;
    slots.push({ time: minutesToTime(start), end_time: minutesToTime(end) });
  }
  return slots;
}

function timeToMinutes(time = "00:00") {
  const [hours, minutes] = String(time).split(":").map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

function minutesToTime(value) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function addMinutesToTime(time, minutes) {
  return minutesToTime(timeToMinutes(time) + Number(minutes || 0));
}

function dateTimeToDayMinutes(value) {
  return timeToMinutes(String(value || "").slice(11, 16));
}

function rangesOverlap(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

async function listMedicalRecords(db, clientId) {
  return db.all(`
    SELECT
      r.*,
      a.procedure,
      a.piercing_region,
      a.appointment_date,
      p.name AS professional_name,
      j.name AS appointment_jewelry
    FROM client_medical_records r
    LEFT JOIN appointments a ON a.id = r.appointment_id
    LEFT JOIN professionals p ON p.id = a.professional_id
    LEFT JOIN jewelry_inventory j ON j.id = a.jewelry_id
    WHERE r.client_id = ?
    ORDER BY r.record_date DESC, r.id DESC
  `, [clientId]);
}

async function listDigitalTerms(db) {
  return db.all(`
    SELECT
      t.id,
      t.appointment_id,
      t.client_id,
      t.full_name,
      t.social_name,
      t.document_number,
      t.birth_date,
      t.whatsapp,
      t.instagram,
      t.address,
      t.procedure,
      t.piercing_region,
      t.orientations_confirmed,
      t.health_declaration,
      t.form_data,
      t.pdf_url,
      t.signed_at,
      a.appointment_date,
      a.appointment_time,
      t.instagram AS term_instagram,
      c.instagram AS client_instagram,
      p.name AS professional_name
    FROM digital_terms t
    JOIN appointments a ON a.id = t.appointment_id
    JOIN clients c ON c.id = t.client_id
    JOIN professionals p ON p.id = a.professional_id
    ORDER BY t.signed_at DESC
  `);
}

async function listPostCareFollowups(db) {
  return db.all(`
    SELECT
      f.*,
      c.full_name,
      c.whatsapp,
      c.instagram,
      a.procedure,
      a.piercing_region,
      a.appointment_date,
      a.appointment_time,
      p.name AS professional_name,
      j.name AS jewelry_name
    FROM post_care_followups f
    JOIN clients c ON c.id = f.client_id
    JOIN appointments a ON a.id = f.appointment_id
    JOIN professionals p ON p.id = a.professional_id
    LEFT JOIN jewelry_inventory j ON j.id = a.jewelry_id
    ORDER BY f.due_date ASC, f.reminder_day ASC
  `);
}

async function ensureFollowupsForCompletedAppointments(db) {
  const appointments = await db.all("SELECT id FROM appointments WHERE status = 'atendido'");
  for (const appointment of appointments) {
    await ensurePostCareFollowups(db, appointment.id);
  }
}

async function ensurePostCareFollowups(db, appointmentId) {
  const appointment = await db.get("SELECT * FROM appointments WHERE id = ?", [appointmentId]);
  if (!appointment || appointment.status !== "atendido") return;
  const reminders = [7, 15, 30];
  for (const day of reminders) {
    await db.run(
      `INSERT OR IGNORE INTO post_care_followups
      (appointment_id, client_id, reminder_day, due_date, care_message)
      VALUES (?, ?, ?, ?, ?)`,
      [appointment.id, appointment.client_id, day, dateAfter(appointment.appointment_date, day), defaultCareMessage(day)]
    );
  }
}

async function awardLoyaltyForAppointment(db, appointmentId) {
  const appointment = await db.get("SELECT * FROM appointments WHERE id = ?", [appointmentId]);
  if (!appointment || appointment.status !== "atendido") return;
  await db.run(
    `INSERT OR IGNORE INTO loyalty_points (client_id, appointment_id, points, event_type, description)
     VALUES (?, ?, ?, ?, ?)`,
    [appointment.client_id, appointment.id, 10, "procedimento", `Procedimento atendido: ${appointment.procedure}`]
  );
  if (appointment.jewelry_id) {
    const jewelry = await db.get("SELECT name FROM jewelry_inventory WHERE id = ?", [appointment.jewelry_id]);
    await db.run(
      `INSERT OR IGNORE INTO loyalty_points (client_id, appointment_id, points, event_type, description)
       VALUES (?, ?, ?, ?, ?)`,
      [appointment.client_id, appointment.id, 5, "compra_joia", `Compra de joia: ${jewelry?.name || "joia vinculada"}`]
    );
  }
}

async function getClientLoyalty(db, clientId) {
  const earned = await db.get("SELECT COALESCE(SUM(points), 0) AS total FROM loyalty_points WHERE client_id = ?", [clientId]);
  const redeemed = await db.get("SELECT COALESCE(SUM(points_used), 0) AS total FROM loyalty_redemptions WHERE client_id = ?", [clientId]);
  const history = await db.all("SELECT * FROM loyalty_points WHERE client_id = ? ORDER BY created_at DESC, id DESC", [clientId]);
  const redemptions = await db.all("SELECT * FROM loyalty_redemptions WHERE client_id = ? ORDER BY redeemed_at DESC, id DESC", [clientId]);
  const totalEarned = earned.total || 0;
  const availablePoints = totalEarned - (redeemed.total || 0);
  const level = loyaltyLevel(totalEarned);
  return {
    totalEarned,
    availablePoints,
    redeemedPoints: redeemed.total || 0,
    level,
    benefits: loyaltyBenefits(level),
    history,
    redemptions
  };
}

function loyaltyLevel(points) {
  if (points >= 80) return "Aura Premium";
  if (points >= 40) return "Aura Gold";
  return "Cliente Aura";
}

function loyaltyBenefits(level) {
  if (level === "Aura Premium") return ["15% de desconto em joias selecionadas", "prioridade em encaixes", "check-up de cicatrizaÃƒÂ§ÃƒÂ£o cortesia"];
  if (level === "Aura Gold") return ["10% de desconto em joias selecionadas", "acesso antecipado a curadorias", "lembrete personalizado de retorno"];
  return ["5% de desconto em joias selecionadas", "histÃƒÂ³rico de pontos ativo", "comunicaÃƒÂ§ÃƒÂ£o de cuidados pÃƒÂ³s-atendimento"];
}

function dateAfter(date, days) {
  const next = new Date(`${date}T12:00:00`);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}

function defaultCareMessage(day) {
  if (day === 7) return "OlÃƒÂ¡! Passando para acompanhar sua cicatrizaÃƒÂ§ÃƒÂ£o. Evite atrito, nÃƒÂ£o toque sem higienizar as mÃƒÂ£os e mantenha os cuidados combinados. Pode nos enviar uma foto do piercing?";
  if (day === 15) return "OlÃƒÂ¡! JÃƒÂ¡ se passaram 15 dias do procedimento. Observe vermelhidÃƒÂ£o, dor, secreÃƒÂ§ÃƒÂ£o ou inchaÃƒÂ§o persistente e envie uma foto para avaliarmos a evoluÃƒÂ§ÃƒÂ£o.";
  return "OlÃƒÂ¡! Hoje completamos 30 dias de acompanhamento. Envie uma foto atual e conte como estÃƒÂ¡ a cicatrizaÃƒÂ§ÃƒÂ£o para orientarmos os prÃƒÂ³ximos cuidados.";
}

async function createTermPdf(term, appointment) {
  const fileName = `termo-digital-${term.id}.pdf`;
  const filePath = path.join(uploadsDir, fileName);
  const signatureBuffer = signatureBufferFromDataUrl(term.signature_data_url);
  const formData = parseTermFormData(term.form_data);
  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 42, size: "A4" });
    const stream = fs.createWriteStream(filePath);
    stream.on("finish", resolve);
    stream.on("error", reject);
    doc.pipe(stream);
    doc.fontSize(20).text("Aura Clinic Piercing", { align: "center" });
    doc.fontSize(14).text("Ficha De Anamnese", { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(10.5);
    doc.text(`Paciente: ${term.full_name}`, { continued: true });
    doc.text(`   Data: ${new Date(term.signed_at).toLocaleDateString("pt-BR")}`, { align: "right" });
    doc.moveDown(0.4);

    writeTermSection(doc, "Dados Pessoais");
    writeTermLine(doc, "Nome Completo", term.full_name);
    writeTermLine(doc, "Nome Social", term.social_name || formData.personal?.social_name || "NÃƒÂ£o informado");
    writeTermLine(doc, "Data De Nascimento", term.birth_date || "NÃƒÂ£o informado");
    writeTermLine(doc, "Documento", term.document_number || "NÃƒÂ£o informado");
    writeTermLine(doc, "WhatsApp", term.whatsapp || appointment.whatsapp || "NÃƒÂ£o informado");
    writeTermLine(doc, "Instagram", term.instagram || appointment.instagram || "NÃƒÂ£o informado");
    writeTermLine(doc, "EndereÃƒÂ§o", term.address || "NÃƒÂ£o informado");

    writeTermSection(doc, "HistÃƒÂ³rico De SaÃƒÂºde");
    writeTermChecklistColumns(doc, HEALTH_HISTORY_FIELDS.map(({ label, key }) => ({ label, checked: Boolean(formData.health_history?.[key]) })));

    writeTermSection(doc, "Estilo De Vida");
    writeTermValueColumns(doc, STYLE_QUESTIONS.map(({ label, key }) => ({ label, value: formatTermAnswer(formData.lifestyle?.[key]) })));

    writeTermSection(doc, "Informa?es Do Atendimento");
    writeTermLine(doc, "Procedimento", term.procedure || appointment.procedure);
    writeTermLine(doc, "RegiÃƒÂ£o da PerfuraÃƒÂ§ÃƒÂ£o", term.piercing_region || appointment.piercing_region);
    writeTermLine(doc, "Local Da AplicaÃƒÂ§ÃƒÂ£o", formData.information?.application_location || "NÃƒÂ£o informado");
    writeTermLine(doc, "Joia", formData.information?.jewelry || "NÃƒÂ£o informada");
    writeTermLine(doc, "ObservaÃƒÂ§ÃƒÂ£o", formData.information?.observation || term.health_declaration || "Sem observa?es adicionais.");
    writeTermLine(doc, "Valor", formData.information?.value || "NÃƒÂ£o informado");

    writeTermSection(doc, "Termo De Consentimento");
    doc.text("Declaro que recebi orientaÃƒÂ§ÃƒÂµes sobre o procedimento, cuidados, higienizaÃƒÂ§ÃƒÂ£o, riscos, intercorrÃƒÂªncias, cicatrizaÃƒÂ§ÃƒÂ£o e retornos. Tamb?m confirmo que os materiais utilizados sÃƒÂ£o esterilizados, lacrados e descartados apÃƒÂ³s o procedimento.", {
      lineGap: 2
    });

    if (formData.minor?.is_minor) {
      writeTermSection(doc, "AutorizaÃƒÂ§ÃƒÂ£o Para Menores");
      writeTermLine(doc, "ResponsÃƒÂ¡vel Legal", formData.minor?.responsible_name || "NÃƒÂ£o informado");
      writeTermLine(doc, "Documento Do ResponsÃƒÂ¡vel", formData.minor?.responsible_document || "NÃƒÂ£o informado");
      writeTermLine(doc, "Nome Do Menor", formData.minor?.minor_name || "NÃƒÂ£o informado");
    }

    writeTermSection(doc, "Assinaturas");
    writeTermLine(doc, "Assinatura Da Cliente", "Assinatura digital anexada");
    writeTermLine(doc, "Assinatura Da Profissional", appointment.professional_name || "Profissional responsÃƒÂ¡vel");
    doc.text(`Assinado digitalmente em: ${new Date(term.signed_at).toLocaleString("pt-BR")}`);
    if (signatureBuffer) {
      doc.moveDown(0.4);
      doc.text("Assinatura digital:");
      doc.image(signatureBuffer, { width: 260 });
    }
    doc.moveDown(0.4);
    doc.text("Aura Clinic Piercing  Atendimento premium e cuidadoso.", { align: "center" });
    doc.end();
  });
  return `/uploads/${fileName}`;
}

function parseTermFormData(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function writeTermSection(doc, title) {
  doc.moveDown(0.5);
  doc.fontSize(12).text(title, { underline: true });
  doc.moveDown(0.2);
}

function writeTermLine(doc, label, value) {
  doc.text(`${label}: ${value || "NÃƒÂ£o informado"}`);
}

function writeTermCheck(doc, label, checked) {
  doc.text(`${checked ? "[x]" : "[ ]"} ${label}`);
}

function writeTermChecklistColumns(doc, items) {
  const columnWidth = 235;
  const gap = 18;
  const startX = doc.page.margins.left;
  const startY = doc.y;
  let leftY = startY;
  let rightY = startY;
  items.forEach((item, index) => {
    const column = index % 2;
    const x = startX + column * (columnWidth + gap);
    const y = column === 0 ? leftY : rightY;
    doc.text(`${item.checked ? "[x]" : "[ ]"} ${item.label}`, x, y, { width: columnWidth });
    const height = doc.heightOfString(`${item.checked ? "[x]" : "[ ]"} ${item.label}`, { width: columnWidth }) + 4;
    if (column === 0) leftY = y + height;
    else rightY = y + height;
  });
  doc.y = Math.max(leftY, rightY) + 4;
}

function writeTermValueColumns(doc, items) {
  const columnWidth = 235;
  const gap = 18;
  const startX = doc.page.margins.left;
  const startY = doc.y;
  let leftY = startY;
  let rightY = startY;
  items.forEach((item, index) => {
    const column = index % 2;
    const x = startX + column * (columnWidth + gap);
    const y = column === 0 ? leftY : rightY;
    const text = `${item.label}: ${item.value || "NÃƒÂ£o informado"}`;
    doc.text(text, x, y, { width: columnWidth });
    const height = doc.heightOfString(text, { width: columnWidth }) + 4;
    if (column === 0) leftY = y + height;
    else rightY = y + height;
  });
  doc.y = Math.max(leftY, rightY) + 4;
}

function formatTermAnswer(value) {
  if (value === true) return "Sim";
  if (value === false) return "NÃƒÂ£o";
  if (value === null || value === undefined || value === "") return "NÃƒÂ£o informado";
  return String(value);
}

const HEALTH_HISTORY_FIELDS = [
  { key: "epilepsia", label: "Epilepsia" },
  { key: "hemofilia", label: "Hemofilia" },
  { key: "diabetes", label: "Diabetes" },
  { key: "alteracoes_hormonais", label: "AlteraÃƒÂ§ÃƒÂµes Hormonais" },
  { key: "doencas_cardiacas", label: "DoenÃƒÂ§as CardÃƒÂ­acas" },
  { key: "queloide", label: "Queloide" },
  { key: "ists", label: "IST's" },
  { key: "hepatite", label: "Hepatite" },
  { key: "dermatite", label: "Dermatite" },
  { key: "anemia", label: "Anemia" }
];

const STYLE_QUESTIONS = [
  { key: "eats_well", label: "Alimenta-Se Bem?" },
  { key: "sleep_regular", label: "Tem Sono Regular?" },
  { key: "physical_activity", label: "Pratica Atividade FÃƒÂ­sica?" },
  { key: "alcohol", label: "Bebe ÃƒÂlcool?" },
  { key: "smokes", label: "Fuma?" },
  { key: "health_problem", label: "Algum Problema De SaÃƒÂºde?" },
  { key: "medication", label: "Usa Algum Medicamento?" },
  { key: "treatment", label: "Faz Algum Tratamento?" },
  { key: "phobia", label: "Tem Alguma Fobia?" },
  { key: "blood_pressure", label: "PressÃƒÂ£o SanguÃƒÂ­nea" }
];

function signatureBufferFromDataUrl(dataUrl) {
  const match = /^data:image\/png;base64,(.+)$/.exec(dataUrl || "");
  return match ? Buffer.from(match[1], "base64") : null;
}

async function upsertClient(db, body) {
  if (body.client_id) {
    const selected = await db.get("SELECT * FROM clients WHERE id = ?", [body.client_id]);
    if (selected) return selected;
  }

  const existing = await db.get("SELECT * FROM clients WHERE whatsapp = ?", [body.whatsapp]);
  if (existing) {
    await db.run(
      "UPDATE clients SET full_name = ?, instagram = ?, birth_date = COALESCE(?, birth_date), notes = ? WHERE id = ?",
      [body.full_name, body.instagram, body.birth_date || null, body.client_notes || "", existing.id]
    );
    return { ...existing, full_name: body.full_name };
  }
  const result = await db.run(
    "INSERT INTO clients (full_name, whatsapp, instagram, birth_date, notes) VALUES (?, ?, ?, ?, ?)",
    [body.full_name, body.whatsapp, body.instagram, body.birth_date || null, body.client_notes || ""]
  );
  return { id: result.lastID };
}

async function deductJewelryStock(db, appointmentId) {
  const appointment = await db.get("SELECT * FROM appointments WHERE id = ?", [appointmentId]);
  if (!appointment?.jewelry_id || appointment.stock_deducted) return;
  let variantId = appointment.jewelry_variant_id;
  if (!variantId) {
    const firstAvailable = await db.get(
      "SELECT id FROM jewelry_variants WHERE jewelry_id = ? AND is_active = 1 AND quantity > 0 ORDER BY id LIMIT 1",
      [appointment.jewelry_id]
    );
    variantId = firstAvailable?.id;
  }
  if (variantId) {
    const variant = await db.get("SELECT * FROM jewelry_variants WHERE id = ?", [variantId]);
    const nextQuantity = Math.max(0, Number(variant.quantity || 0) - 1);
    await db.run(
      "UPDATE jewelry_variants SET quantity = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [nextQuantity, variantStatus(nextQuantity, variant.low_stock_threshold), variantId]
    );
    await db.run(
      "INSERT INTO stock_movements (jewelry_id, variant_id, movement_type, quantity, notes) VALUES (?, ?, 'SaÃƒÂ­da', 1, ?)",
      [appointment.jewelry_id, variantId, `Baixa automÃƒÂ¡tica do atendimento #${appointmentId}`]
    );
    await db.run("UPDATE appointments SET jewelry_variant_id = ? WHERE id = ?", [variantId, appointmentId]);
    await syncProductInventory(db, appointment.jewelry_id);
  }
  await db.run("UPDATE appointments SET stock_deducted = 1 WHERE id = ?", [appointmentId]);
}

async function registerRemainingPayment(db, appointmentId) {
  const appointment = await db.get("SELECT * FROM appointments WHERE id = ?", [appointmentId]);
  if (!appointment || Number(appointment.remaining_value || 0) <= 0) return;

  const existing = await db.get(
    "SELECT id FROM payments WHERE appointment_id = ? AND payment_type = 'restante'",
    [appointmentId]
  );
  if (existing) return;

  await db.run(
    "INSERT INTO payments (appointment_id, client_id, amount, payment_type, method, status, paid_at) VALUES (?, ?, ?, 'restante', ?, 'pago', ?)",
    [
      appointment.id,
      appointment.client_id,
      Number(appointment.remaining_value || 0),
      appointment.remaining_payment_method || "Pix",
      new Date().toISOString().slice(0, 19)
    ]
  );
}

async function createSalesOrder(db, body, user) {
  const items = normalizeSalesOrderItems(body.items || []);
  if (!items.length) return null;
  const fullName = String(body.full_name || body.customer_name || body.name || "").trim();
  const whatsapp = String(body.whatsapp || "").trim();
  if (!fullName || !whatsapp) return null;

  const client = await upsertClient(db, {
    client_id: body.client_id,
    full_name: fullName,
    whatsapp,
    instagram: body.instagram || "",
    birth_date: body.birth_date || "",
    client_notes: body.notes || body.client_notes || ""
  });
  if (!client?.id) return null;

  const total = items.reduce((sum, item) => sum + Number(item.unit_price || 0) * Number(item.quantity || 1), 0);
  const orderType = String(body.order_type || "produto");
  const source = String(body.source || "site");
  const status = String(body.status || "concluida");
  const result = await db.run(
    `INSERT INTO sales_orders
    (client_id, appointment_id, order_type, source, status, payment_method, total_value, notes, created_by_user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      client.id,
      body.appointment_id ? Number(body.appointment_id) : null,
      orderType,
      source,
      status,
      body.payment_method || "Pix",
      total,
      body.notes || "",
      user?.id || null
    ]
  );

  for (const item of items) {
    await db.run(
      `INSERT INTO sales_order_items (sales_order_id, item_type, product_id, service_id, item_name, quantity, unit_price, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        result.lastID,
        item.item_type || "produto",
        item.product_id ? Number(item.product_id) : null,
        item.service_id ? Number(item.service_id) : null,
        item.item_name,
        Number(item.quantity || 1),
        Number(item.unit_price || 0),
        item.notes || ""
      ]
    );
  }

  if (total > 0) {
    await db.run(
      "INSERT INTO payments (appointment_id, client_id, amount, payment_type, method, status, paid_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        body.appointment_id ? Number(body.appointment_id) : result.lastID,
        client.id,
        total,
        orderType,
        body.payment_method || "Pix",
        status === "cancelada" ? "pendente" : "pago",
        new Date().toISOString().slice(0, 19)
      ]
    );
  }

  return (await listSalesOrders(db)).find((item) => item.id === result.lastID) || null;
}

async function listSalesOrders(db) {
  const orders = await db.all(`
    SELECT
      so.*,
      c.full_name,
      c.whatsapp,
      c.instagram,
      a.procedure AS appointment_procedure,
      a.appointment_date,
      a.appointment_time
    FROM sales_orders so
    JOIN clients c ON c.id = so.client_id
    LEFT JOIN appointments a ON a.id = so.appointment_id
    ORDER BY so.created_at DESC, so.id DESC
    LIMIT 120
  `);
  const ids = orders.map((item) => item.id);
  const items = ids.length ? await db.all(`
    SELECT *
    FROM sales_order_items
    WHERE sales_order_id IN (${ids.map(() => "?").join(",")})
    ORDER BY id
  `, ids) : [];
  const grouped = items.reduce((acc, item) => {
    acc[item.sales_order_id] ||= [];
    acc[item.sales_order_id].push(item);
    return acc;
  }, {});
  return orders.map((order) => ({ ...order, items: grouped[order.id] || [] }));
}

function normalizeAppointment(body) {
  const total = Number(body.total_value || 0);
  const deposit = Number(body.deposit_value || 0);
  return {
    ...body,
    professional_id: Number(body.professional_id),
    service_id: body.service_id ? Number(body.service_id) : null,
    jewelry_id: body.jewelry_id ? Number(body.jewelry_id) : null,
    jewelry_variant_id: body.jewelry_variant_id ? Number(body.jewelry_variant_id) : null,
    total_value: total,
    deposit_value: deposit,
    remaining_value: body.remaining_value !== undefined ? Number(body.remaining_value) : total - deposit
  };
}

function csvEscape(value) {
  const text = String(value ?? "");
  return text.includes(",") || text.includes("\"") ? `"${text.replaceAll("\"", "\"\"")}"` : text;
}

function writePdfMetric(doc, label, value) {
  doc.fontSize(11).text(`${label}: ${formatCurrency(value || 0)}`);
}

function formatCurrency(value) {
  return Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function groupInventoryOptions(rows) {
  return rows.reduce((acc, row) => {
    acc[row.type] ||= [];
    acc[row.type].push(row);
    return acc;
  }, { category: [], size: [], thickness: [] });
}

async function getCatalogSettings(db) {
  const rows = await db.all("SELECT key, value FROM catalog_settings");
  const defaults = {
    brand_name: "Aura Clinic",
    slogan: "Piercing premium e joalherias selecionadas",
    logo_url: "",
    title: "Escolha a joia perfeita para vocÃƒÂª",
    subtitle: "Curadoria premium da Aura Clinic Piercing",
    hero_title: "Joias de alta qualidade",
    hero_subtitle: "para realÃƒÂ§ar sua essÃƒÂªncia",
    hero_image_url: "https://images.unsplash.com/photo-1602751584552-8ba73aad10e1?auto=format&fit=crop&w=1200&q=85",
    categories: `Todos,${JEWELRY_CATEGORIES.join(",")}`,
    whatsapp_phone: "",
    whatsapp_message: "OlÃƒÂ¡! Vim pelo catÃƒÂ¡logo online da Aura Clinic e quero ajuda para escolher uma joia.",
    company_instagram: "",
    company_email: "",
    company_address: "",
    company_hours: "",
    layout_style: "premium",
    page_title: "CatÃƒÂ¡logo Online",
    unavailable_message: "Produto indisponÃƒÂ­vel no momento.",
    low_stock_message: "Poucas unidades",
    institutional_text: "Joias selecionadas com cuidado, seguranÃƒÂ§a e estÃƒÂ©tica premium.",
    footer_text: "Aura Clinic Piercing. Curadoria de joias, cuidado e atendimento especializado.",
    seo_title: "Aura Clinic Piercing | CatÃƒÂ¡logo Online",
    seo_description: "Escolha joias premium para piercing na Aura Clinic.",
    share_image_url: "",
    product_share_text: "Olha essa joia da Aura Clinic:",
    content_sections: JSON.stringify([{
      kicker: "Guia Aura",
      title: "Escolha sua joia com orientaÃƒÂ§ÃƒÂ£o profissional",
      text: "Veja materiais, medidas, anodizaÃƒÂ§ÃƒÂ£o e cuidados antes de reservar sua joia.",
      media_type: "image",
      media_url: "https://images.unsplash.com/photo-1602751584552-8ba73aad10e1?auto=format&fit=crop&w=1200&q=85",
      button_text: "Agendar atendimento",
      button_link: "/agendar",
      active: true,
      order: 1
    }]
    )
  };
  return rows.reduce((acc, row) => ({ ...acc, [row.key]: row.value }), defaults);
}

async function getCatalogCustomization(db) {
  const settings = await getCatalogSettings(db);
  const theme = await db.get("SELECT * FROM catalog_theme WHERE id = 1") || defaultCatalogTheme();
  const banners = await db.all("SELECT * FROM catalog_banners ORDER BY sort_order, id");
  const featuredCategories = await db.all("SELECT * FROM catalog_featured_categories ORDER BY sort_order, id");
  const featuredProducts = await db.all(`
    SELECT fp.*, j.name, j.photo_url, j.category, j.material, j.sale_value, j.quantity
    FROM catalog_featured_products fp
    JOIN jewelry_inventory j ON j.id = fp.product_id
    ORDER BY fp.sort_order, fp.id
  `);
  const promotions = await db.all("SELECT * FROM catalog_promotions ORDER BY start_date DESC, id DESC");
  return {
    settings: {
      ...settings,
      brand_name: theme.brand_name || settings.brand_name,
      slogan: theme.slogan || settings.slogan,
      logo_url: theme.logo_url || settings.logo_url,
      footer_text: theme.footer_text || settings.footer_text,
      layout_style: theme.theme || settings.layout_style
    },
    theme,
    banners,
    featuredCategories,
    featuredProducts,
    promotions
  };
}

async function saveCatalogCustomization(db, body) {
  if (body.settings) {
    const allowed = [
      "title", "subtitle", "hero_title", "hero_subtitle", "hero_image_url", "categories", "whatsapp_phone", "whatsapp_message", "layout_style",
      "company_instagram", "company_email", "company_address", "company_hours",
      "page_title", "unavailable_message", "low_stock_message", "institutional_text", "footer_text", "seo_title", "seo_description", "share_image_url", "product_share_text", "content_sections"
    ];
    for (const [key, value] of Object.entries(body.settings).filter(([key]) => allowed.includes(key))) {
      await db.run(
        "INSERT INTO catalog_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [key, Array.isArray(value) ? value.join(",") : String(value ?? "")]
      );
    }
  }

  if (body.theme) {
    const theme = { ...defaultCatalogTheme(), ...body.theme };
    await db.run(
      `INSERT INTO catalog_theme
      (id, brand_name, slogan, logo_url, primary_color, secondary_color, background_color, button_color, title_font, body_font, theme,
       show_out_of_stock, show_stock_quantity, stock_display_mode, show_whatsapp_button, show_schedule_button, show_buy_button, show_favorites, footer_text)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        brand_name = excluded.brand_name,
        slogan = excluded.slogan,
        logo_url = excluded.logo_url,
        primary_color = excluded.primary_color,
        secondary_color = excluded.secondary_color,
        background_color = excluded.background_color,
        button_color = excluded.button_color,
        title_font = excluded.title_font,
        body_font = excluded.body_font,
        theme = excluded.theme,
        show_out_of_stock = excluded.show_out_of_stock,
        show_stock_quantity = excluded.show_stock_quantity,
        stock_display_mode = excluded.stock_display_mode,
        show_whatsapp_button = excluded.show_whatsapp_button,
        show_schedule_button = excluded.show_schedule_button,
        show_buy_button = excluded.show_buy_button,
        show_favorites = excluded.show_favorites,
        footer_text = excluded.footer_text`,
      [
        theme.brand_name,
        theme.slogan,
        theme.logo_url,
        theme.primary_color,
        theme.secondary_color,
        theme.background_color,
        theme.button_color,
        theme.title_font,
        theme.body_font,
        theme.theme,
        boolNumber(theme.show_out_of_stock),
        boolNumber(theme.show_stock_quantity),
        theme.stock_display_mode,
        boolNumber(theme.show_whatsapp_button),
        boolNumber(theme.show_schedule_button),
        boolNumber(theme.show_buy_button),
        boolNumber(theme.show_favorites),
        theme.footer_text
      ]
    );
  }

  if (Array.isArray(body.banners)) {
    await db.run("DELETE FROM catalog_banners");
    for (const banner of body.banners) {
      await db.run(
        `INSERT INTO catalog_banners (title, subtitle, image_url, button_text, button_link, banner_width, banner_height, banner_fit, is_active, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          banner.title || "Banner",
          banner.subtitle || "",
          banner.image_url || "",
          banner.button_text || "",
          banner.button_link || "",
          Number(banner.banner_width || 0),
          Number(banner.banner_height || 340),
          banner.banner_fit || "cover",
          boolNumber(banner.is_active),
          Number(banner.sort_order || 0)
        ]
      );
    }
  }

  if (Array.isArray(body.featuredCategories)) {
    await db.run("DELETE FROM catalog_featured_categories");
    for (const category of body.featuredCategories) {
      await db.run(
        `INSERT INTO catalog_featured_categories (category_id, public_name, icon, image_url, is_active, sort_order)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [category.category_id || category.public_name || "categoria", category.public_name || category.category_id || "Categoria", category.icon || "gem", category.image_url || "", boolNumber(category.is_active), Number(category.sort_order || 0)]
      );
    }
  }

  if (Array.isArray(body.featuredProducts)) {
    await db.run("DELETE FROM catalog_featured_products");
    for (const product of body.featuredProducts.filter((item) => item.product_id)) {
      await db.run(
        `INSERT INTO catalog_featured_products (product_id, badge, is_active, sort_order)
         VALUES (?, ?, ?, ?)`,
        [Number(product.product_id), product.badge || "", boolNumber(product.is_active), Number(product.sort_order || 0)]
      );
    }
  }

  if (Array.isArray(body.promotions)) {
    await db.run("DELETE FROM catalog_promotions");
    for (const promotion of body.promotions) {
      await db.run(
        `INSERT INTO catalog_promotions (name, discount_type, discount_value, start_date, end_date, applies_to, product_ids, category_ids, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          promotion.name || "PromoÃƒÂ§ÃƒÂ£o",
          promotion.discount_type || "percent",
          Number(promotion.discount_value || 0),
          promotion.start_date || "",
          promotion.end_date || "",
          promotion.applies_to || "products",
          Array.isArray(promotion.product_ids) ? promotion.product_ids.join(",") : String(promotion.product_ids || ""),
          Array.isArray(promotion.category_ids) ? promotion.category_ids.join(",") : String(promotion.category_ids || ""),
          boolNumber(promotion.is_active)
        ]
      );
    }
  }
}

async function resetCatalogCustomization(db) {
  await db.run("DELETE FROM catalog_banners");
  await db.run("DELETE FROM catalog_featured_categories");
  await db.run("DELETE FROM catalog_featured_products");
  await db.run("DELETE FROM catalog_promotions");
  await db.run("DELETE FROM catalog_theme");
  await db.run("DELETE FROM catalog_settings");
  await db.run(
    `INSERT INTO catalog_theme
    (id, brand_name, slogan, logo_url, primary_color, secondary_color, background_color, button_color, title_font, body_font, theme, footer_text)
    VALUES (1, 'Aura Clinic', 'Piercing premium e joalherias selecionadas', '', '#C8A96A', '#D8C3A5', '#F8F5F0', '#C8A96A', 'Georgia', 'Inter', 'premium', 'Aura Clinic Piercing. Curadoria de joias, cuidado e atendimento especializado.')`
  );
  await saveCatalogCustomization(db, {
    settings: await getCatalogSettings(db),
    banners: [{
      title: "Escolha a joia perfeita para vocÃƒÂª",
      subtitle: "Joias de alta qualidade para realÃƒÂ§ar sua essÃƒÂªncia.",
      image_url: "https://images.unsplash.com/photo-1602751584552-8ba73aad10e1?auto=format&fit=crop&w=1200&q=85",
      button_text: "Ver todas as joias",
      button_link: "#catalog-products",
      banner_width: 0,
      banner_height: 340,
      banner_fit: "cover",
      is_active: 1,
      sort_order: 1
    }],
    featuredCategories: JEWELRY_CATEGORIES.map((name, index) => ({
      category_id: name,
      public_name: name,
      icon: index === 4 ? "shield" : "gem",
      image_url: "",
      is_active: 1,
      sort_order: index + 1
    }))
  });
}

function defaultCatalogTheme() {
  return {
    brand_name: "Aura Clinic",
    slogan: "Piercing premium e joalherias selecionadas",
    logo_url: "",
    primary_color: "#C8A96A",
    secondary_color: "#D8C3A5",
    background_color: "#F8F5F0",
    button_color: "#C8A96A",
    title_font: "Georgia",
    body_font: "Inter",
    theme: "premium",
    show_out_of_stock: 0,
    show_stock_quantity: 0,
    stock_display_mode: "status",
    show_whatsapp_button: 1,
    show_schedule_button: 1,
    show_buy_button: 0,
    show_favorites: 1,
    footer_text: "Aura Clinic Piercing. Curadoria de joias, cuidado e atendimento especializado."
  };
}

function boolNumber(value) {
  return value === true || value === 1 || value === "1" || value === "true" ? 1 : 0;
}

function normalizeSalesOrderItems(items = []) {
  return Array.isArray(items)
    ? items.map((item) => ({
      item_type: item.item_type || (item.service_id ? "servico" : "produto"),
      product_id: item.product_id ? Number(item.product_id) : null,
      service_id: item.service_id ? Number(item.service_id) : null,
      item_name: String(item.item_name || item.name || "").trim(),
      quantity: Math.max(1, Number(item.quantity || 1)),
      unit_price: Number(item.unit_price || item.price || 0),
      notes: String(item.notes || item.customer_notes || "")
    })).filter((item) => item.item_name)
    : [];
}

async function generateSku(db, body = {}) {
  const normalize = (value = "") => String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  const materialCode = {
    titanio: "TIT",
    titanioimplante: "TIT",
    titanioastmf136: "TIT",
    ouro14k: "G14",
    ouro18k: "G18",
    aco: "ACO",
    outro: "OUT"
  }[normalize(body.material)] || "JWL";

  const categorySource = body.subcategory || body.category || "";
  const categoryCode = {
    labret: "LAB",
    nostril: "NOS",
    clicker: "CLK",
    argola: "ARG",
    banana: "BAN",
    microdermal: "MDR",
    surface: "SRF",
    umbigo: "UMB",
    mamilo: "MAM",
    topo: "TOP",
    haste: "HST"
  }[normalize(categorySource)] || "GEN";

  const prefix = `${materialCode}-${categoryCode}`;
  const row = await db.get(
    "SELECT sku FROM jewelry_inventory WHERE sku LIKE ? ORDER BY id DESC LIMIT 1",
    [`${prefix}-%`]
  );
  const nextNumber = row?.sku
    ? Number(String(row.sku).split("-").pop()) + 1
    : 1;
  return `${prefix}-${String(nextNumber).padStart(3, "0")}`;
}

function splitCatalogCategories(value = "") {
  const categories = String(value).split(",").map((item) => item.trim()).filter(Boolean);
  return categories.length ? categories : ["Todos", ...JEWELRY_CATEGORIES];
}

async function countOptionUsage(db, option) {
  const fieldByType = {
    category: "category",
    size: "size",
    thickness: "thickness"
  };
  const field = fieldByType[option.type];
  if (!field) return 0;
  const row = await db.get(`SELECT COUNT(*) AS count FROM jewelry_inventory WHERE ${field} = ?`, [option.name]);
  return row.count;
}

function nextBirthdays(clients, daysAhead) {
  const today = startOfDay(new Date());
  return clients
    .map((client) => {
      const [, month, day] = client.birth_date.split("-").map(Number);
      let nextDate = new Date(today.getFullYear(), month - 1, day);
      if (nextDate < today) nextDate = new Date(today.getFullYear() + 1, month - 1, day);
      return {
        ...client,
        next_birthday: nextDate.toISOString().slice(0, 10),
        days_until: Math.round((nextDate - today) / 86400000)
      };
    })
    .filter((client) => client.days_until <= daysAhead)
    .sort((a, b) => a.days_until - b.days_until);
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

async function attachVariants(db, products = []) {
  if (!products.length) return [];
  const ids = products.map((product) => Number(product.id)).filter(Boolean);
  const placeholders = ids.map(() => "?").join(", ");
  const variants = await db.all(
    `SELECT * FROM jewelry_variants
     WHERE jewelry_id IN (${placeholders}) AND is_active = 1
     ORDER BY jewelry_id, id`,
    ids
  );
  const byProduct = variants.reduce((map, variant) => {
    if (!map.has(variant.jewelry_id)) map.set(variant.jewelry_id, []);
    map.get(variant.jewelry_id).push(variant);
    return map;
  }, new Map());
  return products.map((product) => {
    const productVariants = byProduct.get(product.id) || [];
    const quantity = productVariants.reduce((sum, variant) => sum + Number(variant.quantity || 0), 0);
    const saleValues = productVariants.map((variant) => Number(variant.sale_value || 0)).filter((value) => value > 0);
    const costValue = productVariants.reduce((sum, variant) => sum + Number(variant.cost_value || 0) * Number(variant.quantity || 0), 0);
    const unique = (field) => [...new Set(productVariants.map((variant) => variant[field]).filter(Boolean))].join(", ");
    return {
      ...product,
      variants: productVariants,
      variant_count: productVariants.length,
      quantity,
      sale_value: saleValues.length ? Math.min(...saleValues) : Number(product.sale_value || 0),
      cost_value: quantity ? costValue / quantity : Number(product.cost_value || 0),
      material: unique("material") || product.material,
      color: unique("color") || product.color,
      size: unique("size") || product.size,
      thickness: unique("thickness") || product.thickness,
      stem_length: unique("length") || product.stem_length,
      diameter: unique("diameter"),
      thread_type: unique("thread_type") || product.thread_type,
      supplier: unique("supplier") || product.supplier,
      status: product.status === "arquivado" ? "arquivado" : aggregateVariantStatus(productVariants)
    };
  });
}

function aggregateVariantStatus(variants = []) {
  if (!variants.length || variants.every((variant) => Number(variant.quantity || 0) <= 0)) return "esgotado";
  if (variants.some((variant) => variantStatus(variant.quantity, variant.low_stock_threshold) === "baixo estoque")) return "baixo estoque";
  return "disponÃƒÂ­vel";
}

function variantStatus(quantity, lowStockThreshold = 5) {
  const stock = Number(quantity || 0);
  if (stock <= 0) return "esgotado";
  if (stock <= Number(lowStockThreshold || 5)) return "baixo estoque";
  return "disponÃƒÂ­vel";
}

function variantFromLegacy(body = {}) {
  return {
    sku: body.sku,
    variation_name: body.variation_label || "VariaÃƒÂ§ÃƒÂ£o principal",
    material: body.material,
    color: body.color,
    stone_color: body.stone_color,
    side: body.side,
    size: body.size,
    thickness: body.thickness,
    length: body.stem_length,
    diameter: body.diameter,
    thread_type: body.thread_type,
    supplier: body.supplier,
    cost_value: body.cost_value,
    sale_value: body.sale_value,
    quantity: body.quantity,
    low_stock_threshold: body.low_stock_threshold,
    status: body.status
  };
}

async function replaceJewelryVariants(db, jewelryId, variants = []) {
  if (!Array.isArray(variants) || variants.length === 0) {
    throw new Error("Cadastre ao menos uma variaÃƒÂ§ÃƒÂ£o para o produto.");
  }
  const current = await db.all("SELECT * FROM jewelry_variants WHERE jewelry_id = ?", [jewelryId]);
  const product = await db.get("SELECT sku, material, category, subcategory, name FROM jewelry_inventory WHERE id = ?", [jewelryId]);
  const suppliedSku = variants.map((variant) => String(variant?.sku || "").trim()).find(Boolean);
  const existingSku = current.map((variant) => String(variant.sku || "").trim()).find(Boolean);
  const productSku = String(product?.sku || "").trim();
  const skuBase = (existingSku || suppliedSku || productSku || await generateSku(db, {
    ...product,
    material: variants[0]?.material || product?.material
  })).replace(/-\d{2,3}$/, "");
  const retainedIds = [];
  for (let index = 0; index < variants.length; index += 1) {
    const variant = variants[index] || {};
    const sku = String(variant.sku || `${skuBase}-${String(index + 1).padStart(2, "0")}`).trim();
    const values = [
      sku,
      variant.variation_name || buildVariationName(variant),
      variant.material || "",
      variant.color || "",
      variant.stone_color || "",
      variant.side || "",
      variant.size || "",
      variant.thickness || "",
      variant.length || "",
      variant.diameter || "",
      variant.thread_type || "",
      variant.supplier || "",
      Number(variant.cost_value || 0),
      Number(variant.sale_value || 0),
      Number(variant.quantity || 0),
      Number(variant.low_stock_threshold || 5),
      variantStatus(variant.quantity, variant.low_stock_threshold),
      variant.is_active === false ? 0 : 1
    ];
    const existing = current.find((item) => Number(item.id) === Number(variant.id));
    if (existing) {
      await db.run(
        `UPDATE jewelry_variants
         SET sku = ?, variation_name = ?, material = ?, color = ?, stone_color = ?, side = ?, size = ?, thickness = ?, length = ?, diameter = ?,
             thread_type = ?, supplier = ?, cost_value = ?, sale_value = ?, quantity = ?, low_stock_threshold = ?,
             status = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND jewelry_id = ?`,
        [...values, existing.id, jewelryId]
      );
      retainedIds.push(existing.id);
    } else {
      const result = await db.run(
        `INSERT INTO jewelry_variants
         (jewelry_id, sku, variation_name, material, color, stone_color, side, size, thickness, length, diameter, thread_type, supplier,
          cost_value, sale_value, quantity, low_stock_threshold, status, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [jewelryId, ...values]
      );
      retainedIds.push(result.lastID);
    }
  }
  for (const variant of current.filter((item) => !retainedIds.includes(item.id))) {
    const used = await db.get(
      `SELECT
        (SELECT COUNT(*) FROM stock_movements WHERE variant_id = ?) +
        (SELECT COUNT(*) FROM appointments WHERE jewelry_variant_id = ?) +
        (SELECT COUNT(*) FROM sales_order_items WHERE product_variant_id = ?) AS count`,
      [variant.id, variant.id, variant.id]
    );
    if (Number(used.count || 0) > 0) {
      await db.run("UPDATE jewelry_variants SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [variant.id]);
    } else {
      await db.run("DELETE FROM jewelry_variants WHERE id = ?", [variant.id]);
    }
  }
  await syncProductInventory(db, jewelryId);
}

function buildVariationName(variant = {}) {
  return [
    variant.size,
    variant.diameter,
    variant.length,
    variant.thickness,
    variant.material,
    variant.color,
    variant.thread_type
  ].filter(Boolean).join(" Ã‚Â· ") || "VariaÃƒÂ§ÃƒÂ£o";
}

async function syncProductInventory(db, jewelryId) {
  const variants = await db.all("SELECT * FROM jewelry_variants WHERE jewelry_id = ? AND is_active = 1", [jewelryId]);
  const quantity = variants.reduce((sum, variant) => sum + Number(variant.quantity || 0), 0);
  const saleValues = variants.map((variant) => Number(variant.sale_value || 0)).filter((value) => value > 0);
  const costValues = variants.map((variant) => Number(variant.cost_value || 0)).filter((value) => value > 0);
  const first = variants[0] || {};
  await db.run(
    `UPDATE jewelry_inventory
     SET quantity = ?, sale_value = ?, cost_value = ?, material = ?, color = ?, size = ?, thickness = ?,
         stem_length = ?, thread_type = ?, supplier = ?, sku = ?, status = ?
     WHERE id = ?`,
    [
      quantity,
      saleValues.length ? Math.min(...saleValues) : 0,
      costValues.length ? Math.min(...costValues) : 0,
      first.material || "",
      first.color || "",
      first.size || "",
      first.thickness || "",
      first.length || "",
      first.thread_type || "",
      first.supplier || "",
      first.sku || `AURA-${jewelryId}`,
      aggregateVariantStatus(variants),
      jewelryId
    ]
  );
}

function elegantProductName(value = "") {
  const smallWords = new Set(["de", "da", "do", "das", "dos", "e", "com", "para"]);
  const normalized = String(value || "")
    .replace(/tit\?nio/gi, "titÃƒÂ¢nio")
    .replace(/titÃ¯Â¿Â½nio/gi, "titÃƒÂ¢nio")
    .replace(/zirc\?nia/gi, "zircÃƒÂ´nia")
    .replace(/^Joias Premium\b/i, "Joia Premium")
    .replace(/\bTitanio\b/gi, "TitÃƒÂ¢nio")
    .replace(/\bZirconia\b/gi, "ZircÃƒÂ´nia")
    .replace(/\s+/g, " ")
    .trim();
  return normalized
    .toLocaleLowerCase("pt-BR")
    .split(" ")
    .map((word, index) => {
      if (/^\d+(?:k|mm)?$/i.test(word)) return word.toLowerCase();
      if (index > 0 && smallWords.has(word)) return word;
      return word.charAt(0).toLocaleUpperCase("pt-BR") + word.slice(1);
    })
    .join(" ");
}

function requiresAuth(req) {
  if (!req.path.startsWith("/api")) return false;
  if (["/api/login", "/api/health", "/api/catalog", "/api/sales-orders/public"].includes(req.path)) return false;
  if (req.path.startsWith("/api/booking")) return false;
  return true;
}

function isLocalDevRequest(req) {
  const host = String(req.hostname || "").toLowerCase();
  const forwardedHost = String(req.headers["x-forwarded-host"] || "").toLowerCase();
  return !isProduction && ["localhost", "127.0.0.1", "::1"].includes(host || forwardedHost);
}

function createToken(user) {
  const payload = Buffer.from(JSON.stringify({
    sub: user.id,
    role: user.role,
    exp: Date.now() + 1000 * 60 * 60 * 12
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", AUTH_SECRET).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

async function authenticateRequest(req, db) {
  try {
    if (isLocalDevRequest(req)) {
      const localAdmin = await db.get("SELECT id, name, email, role FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
      return localAdmin || { id: 1, name: "Administrador Aura", email: "admin@auraclinic.com", role: "admin" };
    }
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return null;
    const [payload, signature] = token.split(".");
    if (!payload || !signature) return null;
    const expected = crypto.createHmac("sha256", AUTH_SECRET).update(payload).digest("base64url");
    if (Buffer.byteLength(signature) !== Buffer.byteLength(expected)) return null;
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!decoded.sub || decoded.exp < Date.now()) return null;
    return db.get("SELECT id, name, email, role FROM users WHERE id = ?", [decoded.sub]);
  } catch {
    return null;
  }
}

function requireRole(req, res, roles) {
  if (!roles.includes(req.user?.role)) {
    res.status(403).json({ error: "VocÃƒÂª nÃƒÂ£o tem permissÃƒÂ£o para esta aÃƒÂ§ÃƒÂ£o." });
    return false;
  }
  return true;
}

await runCoreMigrations();
app.listen(PORT, () => {
  console.log(`Aura Clinic API em http://localhost:${PORT}`);
});
