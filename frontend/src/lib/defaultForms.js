import { localDateValue } from "./utils";
import { normalizeJewelryMaterial, normalizeJewelryThread, splitColorOptions } from "../features/catalog/catalogUtils";

export const ANODIZATION_COLOR_OPTIONS = [
  { name: "Natural", color: "#B8B8B3" },
  { name: "Bronze", color: "#9A6A3A" },
  { name: "Dourado", color: "#D6AE4B" },
  { name: "Champagne", color: "#D7B98E" },
  { name: "Rosé", color: "#C98F88" },
  { name: "Rosa", color: "#D97AA8" },
  { name: "Fúcsia", color: "#B62A83" },
  { name: "Roxo", color: "#7650A8" },
  { name: "Azul Escuro", color: "#244F93" },
  { name: "Azul", color: "#3D78C5" },
  { name: "Azul Claro", color: "#65A9D8" },
  { name: "Turquesa", color: "#3AA9A0" },
  { name: "Verde", color: "#5A9A63" },
  { name: "Verde Petróleo", color: "#397A75" },
  { name: "Preto", color: "#252525" }
];
export const JEWELRY_LENGTH_OPTIONS = Array.from({ length: 39 }, (_, index) => `${index + 2}mm`);
export const JEWELRY_THICKNESS_OPTIONS = ["0.8mm", "1.0mm", "1.2mm", "1.6mm", "2.0mm", "2.5mm"];
export const JEWELRY_THREAD_OPTIONS = ["Interna", "Externa", "Push Pin"];
export const PRICE_MULTIPLIER_OPTIONS = [3, 4];
export const PRICE_ROUNDING_OPTIONS = [
  { value: "exact", label: "Exato" },
  { value: "end_90", label: "Final ,90" },
  { value: "end_99", label: "Final ,99" },
  { value: "next_5", label: "Próximo múltiplo de R$5,00" }
];

export function moneyToCents(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Math.max(0, Math.round(value * 100));
  const text = String(value).trim().replace(/[^\d,.-]/g, "");
  const normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
  const number = Number(normalized);
  return Number.isFinite(number) ? Math.max(0, Math.round(number * 100)) : 0;
}

export function centsToMoney(cents) {
  return Math.max(0, Math.round(Number(cents || 0))) / 100;
}

export function normalizeLengthOption(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const match = raw.match(/\d+(?:[,.]\d+)?/);
  if (!match) return raw;
  const number = Number(match[0].replace(",", "."));
  if (!Number.isFinite(number) || number <= 0) return "";
  return Number.isInteger(number) ? `${number}mm` : `${String(number).replace(".", ",")}mm`;
}

export function applyPriceRounding(cents, mode = "exact") {
  const value = Math.max(0, Math.round(Number(cents || 0)));
  if (mode === "end_90") {
    const reais = Math.floor(value / 100);
    const candidate = reais * 100 + 90;
    return candidate >= value ? candidate : (reais + 1) * 100 + 90;
  }
  if (mode === "end_99") {
    const reais = Math.floor(value / 100);
    const candidate = reais * 100 + 99;
    return candidate >= value ? candidate : (reais + 1) * 100 + 99;
  }
  if (mode === "next_5") return Math.ceil(value / 500) * 500;
  return value;
}

export function calculateVariantPricing(variant = {}, settings = {}) {
  let purchase = moneyToCents(variant.purchase_cost ?? variant.cost_value);
  const freight = moneyToCents(variant.allocated_freight ?? centsToMoney(variant.allocated_freight_cents));
  const additional = moneyToCents(variant.additional_cost ?? centsToMoney(variant.additional_cost_cents));
  const multiplier = [3, 4].includes(Number(variant.price_multiplier)) ? Number(variant.price_multiplier) : Number(settings.default_price_multiplier || 3);
  const rounding = variant.price_rounding_mode || settings.price_rounding_mode || "exact";
  const saleInput = moneyToCents(variant.sale_value);
  const estimateRequested = Boolean(variant.estimate_cost_from_sale);
  const hasRealCost = purchase > 0 && !estimateRequested;
  const costEstimated = Boolean(saleInput > 0 && (!hasRealCost || estimateRequested));
  if (costEstimated) {
    purchase = Math.max(0, Math.round(saleInput / multiplier) - freight - additional);
  }
  const total = purchase + freight + additional;
  const suggested = applyPriceRounding(Math.round(total * multiplier), rounding);
  const manual = Boolean(variant.price_manually_overridden);
  const sale = manual ? saleInput : suggested;
  return {
    cost_value: centsToMoney(purchase),
    purchase_cost: centsToMoney(purchase),
    purchase_cost_cents: purchase,
    allocated_freight_cents: freight,
    additional_cost_cents: additional,
    total_cost_cents: total,
    price_multiplier: multiplier,
    price_rounding_mode: rounding,
    suggested_price_cents: suggested,
    sale_price_cents: sale,
    sale_value: centsToMoney(sale),
    price_manually_overridden: manual,
    cost_estimated: costEstimated,
    estimate_cost_from_sale: false
  };
}

export const DIGITAL_TERM_HEALTH_ITEMS = [
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

export const DIGITAL_TERM_LIFESTYLE_ITEMS = [
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

export function defaultDigitalTerm() {
  return {
    appointment_id: "",
    client_id: "",
    full_name: "",
    social_name: "",
    document_number: "",
    birth_date: "",
    whatsapp: "",
    instagram: "",
    address: "",
    procedure: "",
    piercing_region: "",
    health_declaration: "",
    orientations_confirmed: false,
    form_data: {
      health_history: Object.fromEntries(DIGITAL_TERM_HEALTH_ITEMS.map((item) => [item.key, false])),
      lifestyle: Object.fromEntries(DIGITAL_TERM_LIFESTYLE_ITEMS.map((item) => [item.key, ""])),
      information: {
        application_location: "",
        jewelry: "",
        observation: "",
        value: ""
      },
      minor: {
        is_minor: false,
        responsible_name: "",
        responsible_document: "",
        minor_name: ""
      }
    },
    signature_data_url: ""
  };
}

export function defaultAppointment() {
  const today = localDateValue(new Date());
  return {
    client_id: "",
    full_name: "",
    whatsapp: "",
    instagram: "",
    birth_date: "",
    procedure: "",
    description: "",
    piercing_region: "",
    service_id: "",
    jewelry_id: "",
    jewelry_variant_id: "",
    appointment_kind: "Atendimento",
    reference_photo: null,
    appointment_date: today,
    appointment_time: "",
    professional_id: "",
    total_value: 0,
    deposit_value: 0,
    remaining_value: 0,
    deposit_payment_method: "Pix",
    remaining_payment_method: "Pix",
    status: "pendente",
    notes: ""
  };
}

export function defaultPublicBooking() {
  const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  return {
    service_id: params.get("service_id") || "",
    professional_id: params.get("professional_id") || "",
    appointment_date: params.get("appointment_date") || "",
    appointment_time: params.get("appointment_time") || "",
    jewelry_id: params.get("jewelry_id") || "",
    jewelry_variant_id: params.get("jewelry_variant_id") || "",
    selected_color: params.get("selected_color") || "",
    full_name: "",
    whatsapp: "",
    instagram: "",
    notes: "",
    idempotency_key: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    reference_photo: null,
    payment_proof: null
  };
}

export function nextBookingDates(total = 10) {
  return Array.from({ length: total }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() + index);
    return {
      value: localDateValue(date),
      day: String(date.getDate()).padStart(2, "0"),
      weekday: date.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "").toUpperCase(),
      month: date.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")
    };
  });
}

export function legacyLocalDateValue(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function defaultServiceForm() {
  return {
    name: "",
    description: "",
    base_price: 0,
    deposit_value: 25,
    duration_minutes: 40,
    is_active: true
  };
}

export function defaultProcedureForm() {
  return {
    service_id: "",
    name: "",
    body_area: "",
    description: "",
    price: 0,
    duration_minutes: 40,
    aftercare_instructions: "",
    is_active: true
  };
}

export function defaultProfessionalForm() {
  return {
    name: "",
    specialty: "",
    phone: "",
    whatsapp: "",
    email: "",
    notification_opt_in: true,
    calendar_color: "#C8A96A",
    active: true,
    service_ids: []
  };
}

export function defaultSalesOrderForm() {
  return {
    full_name: "",
    whatsapp: "",
    instagram: "",
    appointment_id: "",
    payment_method: "Pix",
    status: "concluida",
    notes: ""
  };
}

export function defaultSalesLine() {
  return {
    item_type: "produto",
    product_id: "",
    product_variant_id: "",
    service_id: "",
    quantity: 1,
    unit_price: 0,
    notes: ""
  };
}

export function defaultScheduleBlock() {
  const today = new Date().toISOString().slice(0, 10);
  return {
    professional_id: "",
    start_datetime: `${today}T09:00`,
    end_datetime: `${today}T18:00`,
    block_type: "block",
    reason: "Bloqueio",
    notes: "",
    is_full_day: false,
    is_recurring: false,
    lunch_start: "",
    lunch_end: "",
    duration_minutes: "",
    buffer_minutes: ""
  };
}

export const JEWELRY_CATEGORY_OPTIONS = [
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

export function defaultJewelry() {
  return {
    name: "",
    description: "",
    photo_url: "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?auto=format&fit=crop&w=900&q=80",
    image_url: "",
    images: [],
    gallery_urls: "",
    category: "",
    subcategory: "",
    variant_group: "",
    variation_label: "",
    material: "",
    color: "",
    stone: "",
    size: "",
    thickness: "",
    stem_length: "",
    thread_type: "",
    piercing_type: "",
    weight_grams: 50,
    package_length_cm: 15,
    package_width_cm: 10,
    package_height_cm: 3,
    package_type: "Envelope / caixa pequena",
    virtual_store_active: true,
    preparation_days: 1,
    shipping_info: "",
    seo_title: "",
    seo_description: "",
    freight_notes: "",
    quantity: 0,
    low_stock_threshold: 5,
    critical_stock_threshold: 3,
    cost_value: 0,
    sale_value: 0,
    purchase_cost_cents: 0,
    allocated_freight_cents: 0,
    additional_cost_cents: 0,
    total_cost_cents: 0,
    price_multiplier: 3,
    price_rounding_mode: "exact",
    suggested_price_cents: 0,
    sale_price_cents: 0,
    price_manually_overridden: false,
    cost_estimated: false,
    supplier: "",
    physical_location: "",
    sku: "",
    is_catalog_active: true,
    is_featured: false,
    is_new: false,
    is_most_wanted: false,
    is_promotion: false,
    is_last_units: false,
    is_published: false,
    notes: "",
    status: "disponível",
    variants: [defaultJewelryVariant()]
  };
}

export function defaultJewelryVariant(index = 1) {
  return {
    id: null,
    sku: "",
    sku_manually_edited: false,
    images: [],
    variation_name: `Variação ${index}`,
    material: "Titânio ASTM F136",
    color: "Natural",
    stone_color: "",
    side: "",
    size: "",
    thickness: "1.2mm",
    length: "",
    diameter: "",
    thread_type: "Interna",
    supplier: "",
    cost_value: 0,
    sale_value: 0,
    purchase_cost: 0,
    allocated_freight: 0,
    additional_cost: 0,
    purchase_cost_cents: 0,
    allocated_freight_cents: 0,
    additional_cost_cents: 0,
    total_cost_cents: 0,
    price_multiplier: 3,
    price_rounding_mode: "exact",
    suggested_price_cents: 0,
    sale_price_cents: 0,
    price_manually_overridden: false,
    cost_estimated: false,
    quantity: 0,
    low_stock_threshold: 5,
    status: "disponível",
    is_active: true
  };
}

export function normalizeJewelryForm(item = {}) {
  let galleryUrls = item.gallery_urls || "";
  if (Array.isArray(galleryUrls)) {
    galleryUrls = galleryUrls.join("\n");
  } else if (typeof galleryUrls === "string") {
    try {
      const parsed = JSON.parse(galleryUrls);
      galleryUrls = Array.isArray(parsed) ? parsed.join("\n") : galleryUrls;
    } catch {
      galleryUrls = galleryUrls;
    }
  }
  return {
    ...defaultJewelry(),
    ...item,
    images: normalizeJewelryImages(item),
    gallery_urls: galleryUrls,
    virtual_store_active: Boolean(Number(item.virtual_store_active ?? 1)),
    is_catalog_active: Boolean(Number(item.is_catalog_active ?? 1)),
    is_featured: Boolean(Number(item.is_featured)),
    is_new: Boolean(Number(item.is_new)),
    is_most_wanted: Boolean(Number(item.is_most_wanted)),
    is_promotion: Boolean(Number(item.is_promotion)),
    is_last_units: Boolean(Number(item.is_last_units)),
    weight_grams: Number(item.weight_grams || 50),
    package_length_cm: Number(item.package_length_cm || 15),
    package_width_cm: Number(item.package_width_cm || 10),
    package_height_cm: Number(item.package_height_cm || 3),
    preparation_days: Number(item.preparation_days || 1),
    low_stock_threshold: Number(item.low_stock_threshold || 5),
    critical_stock_threshold: Number(item.critical_stock_threshold || 3),
    variants: Array.isArray(item.variants) && item.variants.length
      ? item.variants.map((variant, index) => ({
          ...defaultJewelryVariant(index + 1),
          ...variant,
          material: normalizeJewelryMaterial(variant.material),
          color: splitColorOptions(variant.color).join(", "),
          length: normalizeLengthOption(variant.length),
          thread_type: normalizeJewelryThread(variant.thread_type),
          purchase_cost: centsToMoney(variant.purchase_cost_cents || moneyToCents(variant.cost_value)),
          allocated_freight: centsToMoney(variant.allocated_freight_cents),
          additional_cost: centsToMoney(variant.additional_cost_cents),
          price_multiplier: Number(variant.price_multiplier || 3),
          price_rounding_mode: variant.price_rounding_mode || "exact",
          price_manually_overridden: Boolean(Number(variant.price_manually_overridden)),
          cost_estimated: Boolean(Number(variant.cost_estimated)),
          sale_value: centsToMoney(variant.sale_price_cents || moneyToCents(variant.sale_value)),
          sku_manually_edited: false,
          images: normalizeJewelryImages(variant),
          is_active: Boolean(Number(variant.is_active ?? 1))
        }))
      : [defaultJewelryVariant()]
  };
}

function normalizeJewelryImages(item = {}) {
  const images = Array.isArray(item.images) ? item.images : [];
  if (images.length) {
    return images.map((image, index) => ({
      image_url: image.image_url || image.url || "",
      alt_text: image.alt_text || "",
      sort_order: Number(image.sort_order || index + 1),
      is_primary: Boolean(Number(image.is_primary ?? index === 0))
    })).filter((image) => image.image_url);
  }
  const urls = parseGalleryUrls(item.gallery_urls);
  const fallback = [item.image_url || item.photo_url, ...urls].filter(Boolean);
  return [...new Set(fallback)].map((url, index) => ({
    image_url: url,
    alt_text: item.name || "",
    sort_order: index + 1,
    is_primary: index === 0
  }));
}

export function parseGalleryUrls(value = "") {
  return String(value)
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function defaultCatalogSettings() {
  return {
    title: "Escolha a joia perfeita para você",
    subtitle: "Curadoria premium da Aura Clinic Piercing",
    hero_title: "Joias de alta qualidade",
    hero_subtitle: "para realçar sua essência",
    hero_image_url: "https://images.unsplash.com/photo-1602751584552-8ba73aad10e1?auto=format&fit=crop&w=1200&q=85",
    categories: `Todos, ${JEWELRY_CATEGORY_OPTIONS.join(", ")}`,
    whatsapp_phone: "",
    whatsapp_message: "Olá! Vim pelo catálogo online da Aura Clinic e quero ajuda para escolher uma joia.",
    company_instagram: "",
    company_email: "",
    company_address: "",
    company_hours: "",
    layout_style: "premium"
  };
}

export function defaultExpense() {
  return {
    description: "",
    expense_type: "fixa",
    category: "",
    amount: 0,
    due_date: new Date().toISOString().slice(0, 10),
    status: "paga",
    payment_method: "Pix",
    notes: ""
  };
}

export function defaultAccessUser() {
  return { name: "", email: "", password: "", role: "reception" };
}

export function defaultMedicalRecord() {
  return {
    appointment_id: "",
    record_date: new Date().toISOString().slice(0, 10),
    piercing_history: "",
    jewelry_used: "",
    occurrences: "",
    guidance: "",
    allergies_notes: "",
    healing_evolution: "",
    returns_done: ""
  };
}
