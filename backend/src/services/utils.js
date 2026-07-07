// Funções utilitárias puras (sem acesso ao banco) e constantes de apoio,
// reutilizadas por vários serviços e rotas.
import { JEWELRY_CATEGORIES } from "../config/index.js";

// ---------- Conversões booleanas / tempo ----------

export function boolNumber(value) {
  return value === true || value === 1 || value === "1" || value === "true" ? 1 : 0;
}

export function timeToMinutes(time = "00:00") {
  const [hours, minutes] = String(time).split(":").map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

export function minutesToTime(value) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

export function addMinutesToTime(time, minutes) {
  return minutesToTime(timeToMinutes(time) + Number(minutes || 0));
}

export function dateTimeToDayMinutes(value) {
  return timeToMinutes(String(value || "").slice(11, 16));
}

export function rangesOverlap(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

export function dateAfter(date, days) {
  const next = new Date(`${date}T12:00:00`);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}

export function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// ---------- Formatação / exportações ----------

export function csvEscape(value) {
  const text = String(value ?? "");
  return text.includes(",") || text.includes("\"") ? `"${text.replaceAll("\"", "\"\"")}"` : text;
}

export function formatCurrency(value) {
  return Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function writePdfMetric(doc, label, value) {
  doc.fontSize(11).text(`${label}: ${formatCurrency(value || 0)}`);
}

// ---------- Fidelidade / pós-atendimento ----------

export function loyaltyLevel(points) {
  if (points >= 80) return "Aura Premium";
  if (points >= 40) return "Aura Gold";
  return "Cliente Aura";
}

export function loyaltyBenefits(level) {
  if (level === "Aura Premium") return ["15% de desconto em joias selecionadas", "prioridade em encaixes", "check-up de cicatrização cortesia"];
  if (level === "Aura Gold") return ["10% de desconto em joias selecionadas", "acesso antecipado a curadorias", "lembrete personalizado de retorno"];
  return ["5% de desconto em joias selecionadas", "histórico de pontos ativo", "comunicação de cuidados pós-atendimento"];
}

export function defaultCareMessage(day) {
  if (day === 7) return "Olá! Passando para acompanhar sua cicatrização. Evite atrito, não toque sem higienizar as mãos e mantenha os cuidados combinados. Pode nos enviar uma foto do piercing?";
  if (day === 15) return "Olá! Já se passaram 15 dias do procedimento. Observe vermelhidão, dor, secreção ou inchaço persistente e envie uma foto para avaliarmos a evolução.";
  return "Olá! Hoje completamos 30 dias de acompanhamento. Envie uma foto atual e conte como está a cicatrização para orientarmos os próximos cuidados.";
}

// ---------- Termo digital (PDF) ----------

export function parseTermFormData(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

export function writeTermSection(doc, title) {
  doc.moveDown(0.5);
  doc.fontSize(12).text(title, { underline: true });
  doc.moveDown(0.2);
}

export function writeTermLine(doc, label, value) {
  doc.text(`${label}: ${value || "Não informado"}`);
}

export function writeTermCheck(doc, label, checked) {
  doc.text(`${checked ? "[x]" : "[ ]"} ${label}`);
}

export function writeTermChecklistColumns(doc, items) {
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

export function writeTermValueColumns(doc, items) {
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
    const text = `${item.label}: ${item.value || "Não informado"}`;
    doc.text(text, x, y, { width: columnWidth });
    const height = doc.heightOfString(text, { width: columnWidth }) + 4;
    if (column === 0) leftY = y + height;
    else rightY = y + height;
  });
  doc.y = Math.max(leftY, rightY) + 4;
}

export function formatTermAnswer(value) {
  if (value === true) return "Sim";
  if (value === false) return "Não";
  if (value === null || value === undefined || value === "") return "Não informado";
  return String(value);
}

export const HEALTH_HISTORY_FIELDS = [
  { key: "epilepsia", label: "Epilepsia" },
  { key: "hemofilia", label: "Hemofilia" },
  { key: "diabetes", label: "Diabetes" },
  { key: "alteracoes_hormonais", label: "Alterações Hormonais" },
  { key: "doencas_cardiacas", label: "Doenças Cardíacas" },
  { key: "queloide", label: "Queloide" },
  { key: "ists", label: "IST's" },
  { key: "hepatite", label: "Hepatite" },
  { key: "dermatite", label: "Dermatite" },
  { key: "anemia", label: "Anemia" }
];

export const STYLE_QUESTIONS = [
  { key: "eats_well", label: "Alimenta-Se Bem?" },
  { key: "sleep_regular", label: "Tem Sono Regular?" },
  { key: "physical_activity", label: "Pratica Atividade Física?" },
  { key: "alcohol", label: "Bebe Álcool?" },
  { key: "smokes", label: "Fuma?" },
  { key: "health_problem", label: "Algum Problema De Saúde?" },
  { key: "medication", label: "Usa Algum Medicamento?" },
  { key: "treatment", label: "Faz Algum Tratamento?" },
  { key: "phobia", label: "Tem Alguma Fobia?" },
  { key: "blood_pressure", label: "Pressão Sanguínea" }
];

export function signatureBufferFromDataUrl(dataUrl) {
  const match = /^data:image\/png;base64,(.+)$/.exec(dataUrl || "");
  return match ? Buffer.from(match[1], "base64") : null;
}

// ---------- Agendamentos / vendas (normalização de payload) ----------

export function normalizeAppointment(body) {
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

export function normalizeSalesOrderItems(items = []) {
  return Array.isArray(items)
    ? items.map((item) => ({
      item_type: item.item_type || (item.service_id ? "servico" : "produto"),
      product_id: item.product_id ? Number(item.product_id) : null,
      product_variant_id: item.product_variant_id ? Number(item.product_variant_id) : null,
      service_id: item.service_id ? Number(item.service_id) : null,
      item_name: String(item.item_name || item.name || "").trim(),
      quantity: Math.max(1, Number(item.quantity || 1)),
      unit_price: Number(item.unit_price || item.price || 0),
      notes: String(item.notes || item.customer_notes || "")
    })).filter((item) => item.item_name)
    : [];
}

// ---------- Estoque / variações (helpers puros) ----------

export function groupInventoryOptions(rows) {
  return rows.reduce((acc, row) => {
    acc[row.type] ||= [];
    acc[row.type].push(row);
    return acc;
  }, { category: [], size: [], thickness: [] });
}

export function aggregateVariantStatus(variants = []) {
  if (!variants.length || variants.every((variant) => Number(variant.quantity || 0) <= 0)) return "esgotado";
  if (variants.some((variant) => variantStatus(variant.quantity, variant.low_stock_threshold) === "baixo estoque")) return "baixo estoque";
  return "disponível";
}

export function variantStatus(quantity, lowStockThreshold = 5) {
  const stock = Number(quantity || 0);
  if (stock <= 0) return "esgotado";
  if (stock <= Number(lowStockThreshold || 5)) return "baixo estoque";
  return "disponível";
}

export function variantFromLegacy(body = {}) {
  return {
    sku: body.sku,
    variation_name: body.variation_label || "Variação principal",
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

export function buildVariationName(variant = {}) {
  return [
    variant.size,
    variant.diameter,
    variant.length,
    variant.thickness,
    variant.material,
    variant.color,
    variant.thread_type
  ].filter(Boolean).join(" · ") || "Variação";
}

export function elegantProductName(value = "") {
  const smallWords = new Set(["de", "da", "do", "das", "dos", "e", "com", "para"]);
  const normalized = String(value || "")
    .replace(/tit\?nio/gi, "titânio")
    .replace(/titï¿½nio/gi, "titânio")
    .replace(/zirc\?nia/gi, "zircônia")
    .replace(/^Joias Premium\b/i, "Joia Premium")
    .replace(/\bTitanio\b/gi, "Titânio")
    .replace(/\bZirconia\b/gi, "Zircônia")
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

// ---------- Catálogo / clientes (helpers puros) ----------

export function splitCatalogCategories(value = "") {
  const categories = String(value).split(",").map((item) => item.trim()).filter(Boolean);
  return categories.length ? categories : ["Todos", ...JEWELRY_CATEGORIES];
}

export function nextBirthdays(clients, daysAhead) {
  const today = startOfDay(new Date());
  return clients
    .map((client) => {
      // birth_date pode vir vazio ou inválido ("", null, formato errado): nesses
      // casos ignoramos o cliente em vez de estourar em toISOString (RangeError).
      const [, month, day] = String(client.birth_date || "").split("-").map(Number);
      if (!month || !day || Number.isNaN(month) || Number.isNaN(day)) return null;
      let nextDate = new Date(today.getFullYear(), month - 1, day);
      if (Number.isNaN(nextDate.getTime())) return null;
      if (nextDate < today) nextDate = new Date(today.getFullYear() + 1, month - 1, day);
      return {
        ...client,
        next_birthday: nextDate.toISOString().slice(0, 10),
        days_until: Math.round((nextDate - today) / 86400000)
      };
    })
    .filter(Boolean)
    .filter((client) => client.days_until <= daysAhead)
    .sort((a, b) => a.days_until - b.days_until);
}

export function defaultCatalogTheme() {
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
