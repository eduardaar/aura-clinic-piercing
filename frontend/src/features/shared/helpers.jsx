// Helpers e constantes compartilhados entre as features do painel administrativo.
// Extraídos de main.jsx para permitir a modularização por feature sem duplicar lógica.
import { CircleDollarSign, Gem, Heart, LayoutGrid, ShieldCheck, Sparkles, Star } from "lucide-react";
import { asArray, asObject, formatDate, removeAccents } from "../../lib/utils";
import { API_ORIGIN } from "../../lib/api";
import { JEWELRY_CATEGORY_OPTIONS } from "../../lib/defaultForms";
import { elegantProductName } from "../catalog/catalogUtils";

// Formatador monetário padrão (Real brasileiro).
export const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

// Mapa de status de agendamento para classes de estilo.
export const statusClass = {
  pendente: "status-pendente",
  awaiting_deposit_proof: "status-pendente",
  confirmado: "status-confirmado",
  atendido: "status-atendido",
  cancelado: "status-cancelado",
  remarcado: "status-remarcado"
};

export function calcRemaining(form) {
  return { ...form, remaining_value: Math.max(Number(form.total_value || 0) - Number(form.deposit_value || 0), 0) };
}

export function statuses() {
  return ["pendente", "awaiting_deposit_proof", "confirmado", "recusado", "atendido", "cancelado", "remarcado"];
}

export function personName(item = {}) {
  const safeItem = asObject(item);
  return safeItem.name || safeItem.client_name || safeItem.full_name || "Cliente";
}

export function weekdayLabel(day) {
  return ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"][Number(day)] || "Dia";
}

export function formatRevenueLabel(item, mode) {
  const label = item.label || item.month || "";
  if (mode === "diario" && label) return formatDate(label);
  if (mode === "semanal") return label.replace("-W", " semana ");
  if (label.length === 7) return `${label.slice(5)}/${label.slice(0, 4)}`;
  return label || "Período";
}

export function formatRevenueAxisLabel(item, mode) {
  const label = item.label || item.month || "";
  if (mode === "diario" && label) return label.slice(8, 10);
  if (mode === "semanal" && label) return label.slice(-2);
  if (label.length === 7) return label.slice(5);
  return label.slice(0, 4);
}

export function matchesClientSearch(client, search) {
  const safeClient = asObject(client);
  const term = String(search || "").trim().toLowerCase();
  if (!term) return true;
  return `${safeClient.full_name || safeClient.name || ""} ${safeClient.phone || ""} ${safeClient.whatsapp || ""} ${safeClient.instagram || ""} ${safeClient.email || ""} ${safeClient.cpf || ""} ${safeClient.notes || ""}`.toLowerCase().includes(term);
}

export function whatsappUrl(phone, message) {
  const digits = String(phone || "").replace(/\D/g, "");
  const normalized = digits.startsWith("55") ? digits : `55${digits}`;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

export function appointmentWhatsAppMessage(item = {}) {
  const name = personName(item);
  const date = item.appointment_date ? formatDate(item.appointment_date) : "data a confirmar";
  const time = item.appointment_time || "horário a confirmar";
  const service = item.service_name || item.procedure || "seu atendimento";
  const professional = item.professional_name ? ` com ${item.professional_name}` : "";
  return `Olá, ${name}, tudo bem? Aqui é da Aura Clinic. Estamos entrando em contato para confirmar, reagendar ou informar uma atualização sobre ${service}${professional}, marcado para ${date} às ${time}.`;
}

export function instagramCatalogUrl(handle = "") {
  const username = String(handle).trim().replace(/^@/, "");
  return username ? `https://www.instagram.com/${encodeURIComponent(username)}/` : "https://www.instagram.com/";
}

export function whatsappCatalogUrl(message, phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  const normalized = digits ? (digits.startsWith("55") ? digits : `55${digits}`) : "";
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message || "Olá! Vim pelo catálogo online da Aura Clinic.")}`;
}

export function catalogProductUrl(id) {
  return `/catalogo/produto/${id}`;
}

export function catalogImageUrl(url) {
  if (!url) return "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?auto=format&fit=crop&w=900&q=80";
  return url.startsWith("/uploads") ? `${API_ORIGIN}${url}` : url;
}

export function catalogCategories(names = []) {
  const iconByCategory = {
    Todos: LayoutGrid,
    Nariz: Sparkles,
    Orelha: Heart,
    Umbigo: CircleDollarSign,
    Surface: Sparkles,
    "Ouro 14k": Gem,
    "Ouro 18k": Gem,
    "Titânio": CircleDollarSign,
    Titanio: CircleDollarSign,
    Opalas: Gem,
    "Lançamentos": Star,
    Lancamentos: Star
  };
  const safeNames = asArray(names);
  const categoryNames = safeNames.length ? safeNames : ["Todos", ...JEWELRY_CATEGORY_OPTIONS];
  return categoryNames.map((name) => ({ name, icon: iconByCategory[name] || Gem }));
}

export function catalogIcon(icon) {
  return {
    gem: Gem,
    heart: Heart,
    star: Star,
    sparkles: Sparkles,
    shield: ShieldCheck,
    circle: CircleDollarSign
  }[icon] || Gem;
}

export function inventoryStatusLabel(item) {
  const state = inventoryStockState(item);
  if (state === "sold-out") return "Esgotado";
  if (state === "critical") return "Crítico";
  return "Ativo";
}

export function inventoryStatusClass(item) {
  return removeAccents(inventoryStatusLabel(item)).replace(/\s+/g, "-").toLowerCase();
}

export function inventoryStockState(item) {
  const quantity = Number(item.quantity || 0);
  const minimum = Number(item.low_stock_threshold || 5);
  if (quantity <= 0) return "sold-out";
  if (quantity <= minimum) return "critical";
  return "active";
}

export function subcategoryOptions(category = "") {
  const normalized = removeAccents(String(category).toLowerCase());
  if (normalized.includes("nariz")) return ["Nostril", "D-Ring", "Segment Clicker", "Argola Clicker", "Screw", "L Shape", "Septo"];
  if (normalized.includes("orelha")) return ["Hélix", "Tragus", "Conch", "Daith", "Rook", "Flat", "Forward Helix", "Lóbulo", "Anti-Hélix"];
  if (normalized.includes("boca")) return ["Labret", "Side Labret", "Medusa", "Monroe", "Ashley", "Vertical Labret"];
  if (normalized.includes("corpo")) return ["Umbigo", "Mamilo", "Surface", "Microdermal", "Sobrancelha"];
  if (normalized.includes("joias premium")) return ["Ouro 14k", "Ouro 18k", "Titânio ASTM F136", "Cluster", "Trinity", "Opala", "Navete", "Correntes"];
  if (normalized.includes("acessor")) return ["Hastes", "Discos", "Topos", "Bases de Microdermal", "Correntes", "Extensores"];
  return [];
}

export function generateLocalSku(item = {}) {
  const materialCode = {
    "titânio grau implante": "TIT",
    "titanio grau implante": "TIT",
    "titanio astm f136": "TIT",
    "ouro 14k": "G14",
    "ouro 18k": "G18",
    aco: "ACO",
    outro: "OUT"
  }[removeAccents(String(item.material || "").toLowerCase())] || "JWL";
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
  }[removeAccents(String(item.subcategory || item.category || "").toLowerCase())] || "GEN";
  const variation = [
    item.variant_group,
    item.variation_label,
    item.size,
    item.thickness,
    item.color,
    item.stem_length
  ].filter(Boolean).map((part) => removeAccents(String(part).toUpperCase()).replace(/[^A-Z0-9]+/g, "")).join("");
  const key = `${materialCode}-${categoryCode}`;
  const hashSource = `${key}-${variation || removeAccents(String(item.name || "JOIA").toUpperCase()).replace(/[^A-Z0-9]+/g, "")}`;
  const hash = Array.from(hashSource).reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 1000000, 7);
  const suffix = String(hash).padStart(6, "0").slice(0, 6);
  return `${key}-${suffix}`;
}

export function jewelrySkuBase(item = {}) {
  const existingSku = (item.variants || []).map((variant) => variant.sku).find(Boolean) || item.sku || "";
  const existingBase = String(existingSku).replace(/-\d{2,3}$/, "");
  if (existingBase) return existingBase;
  const firstVariant = item.variants?.[0] || {};
  return generateLocalSku({ ...item, ...firstVariant });
}

export function variantCatalogLabel(variant = {}) {
  const measurement = variant.length
    ? `Comprimento ${variant.length}`
    : variant.diameter
      ? `Diâmetro ${variant.diameter}`
      : variant.size
        ? `Tamanho ${variant.size}`
        : variant.variation_name || variant.sku || "Variação";
  return [
    measurement,
    variant.thickness,
    variant.material && elegantProductName(variant.material),
    variant.thread_type && `Rosca ${elegantProductName(variant.thread_type)}`
  ].filter(Boolean).join(" · ");
}

export function countAlerts(alerts) {
  const safeAlerts = asObject(alerts);
  if (Array.isArray(safeAlerts.items)) return safeAlerts.items.length;
  return [safeAlerts.lowStockJewelry, safeAlerts.birthdays, safeAlerts.topClients].reduce((total, list) => total + asArray(list).length, 0);
}

export function roleLabel(role) {
  return {
    admin: "Administrador Geral",
    piercer: "Body Piercer",
    reception: "Recepção",
    finance: "Financeiro"
  }[role] || "Administrador Geral";
}

export function saleOrderTypeLabel(type = "") {
  return {
    produto: "Venda de produto",
    servico: "Venda de serviço",
    ordem_servico: "Ordem de serviço",
    mista: "Venda mista"
  }[type] || "Venda";
}

export function saleItemLabel(type = "") {
  return {
    produto: "Produto",
    servico: "Serviço"
  }[type] || "Item";
}
