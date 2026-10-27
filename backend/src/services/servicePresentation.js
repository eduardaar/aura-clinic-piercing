// Apresentação pública do serviço: cartão do agendamento online e informações
// completas da etapa final. O contrato das seções é o mesmo do frontend
// (`frontend/src/lib/servicePresentation.js`).
import { createHash } from "crypto";

export const SHORT_DESCRIPTION_MAX = 240;
const SECTION_TITLE_MAX = 80;
const SECTION_BODY_MAX = 6000;
const SECTIONS_MAX = 24;

// Seções com chave fixa aparecem no máximo uma vez; `custom` pode se repetir
// com título próprio. `pre_service` e `aftercare` guardam só a posição: o texto
// continua nas colunas usadas pela Agenda e pelo pós-atendimento.
export const SERVICE_INFO_SECTION_KEYS = new Set([
  "how_it_works", "pre_service", "rules", "eligibility", "evaluation", "contraindications", "jewelry",
  "commercial", "warranty", "warranty_limits", "aftercare", "returns", "contact", "consent", "custom"
]);
const COLUMN_BACKED_SECTIONS = { pre_service: "pre_service_notes", aftercare: "aftercare_instructions" };

export class ServicePresentationError extends Error {}

function parseJson(value, fallback) {
  if (value == null || value === "") return fallback;
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function cleanText(value, max) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim().slice(0, max);
}

export function normalizePublicInfoSections(value) {
  const source = parseJson(value, null);
  if (!Array.isArray(source)) throw new ServicePresentationError("As informações completas do serviço estão em formato inválido.");
  if (source.length > SECTIONS_MAX) throw new ServicePresentationError(`Use no máximo ${SECTIONS_MAX} seções de informações por serviço.`);
  const seen = new Set();
  const sections = [];
  for (const raw of source) {
    const key = String(raw?.key || "").trim();
    if (!SERVICE_INFO_SECTION_KEYS.has(key)) throw new ServicePresentationError("Seção de informações desconhecida.");
    if (key !== "custom") {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    if (COLUMN_BACKED_SECTIONS[key]) {
      sections.push({ key });
      continue;
    }
    const body = cleanText(raw?.body, SECTION_BODY_MAX);
    const title = cleanText(raw?.title, SECTION_TITLE_MAX);
    if (key === "custom" && !title && body) throw new ServicePresentationError("Dê um título para cada seção personalizada.");
    sections.push(key === "custom" ? { key, title, body } : { key, body });
  }
  return sections;
}

// Campos da apresentação aceitos em POST/PUT /api/services. Só devolve o que
// veio no corpo, para o PUT preservar o que não foi enviado.
export function servicePresentationFields(body = {}) {
  const fields = {};
  if (body.short_description !== undefined) {
    const value = cleanText(body.short_description, SHORT_DESCRIPTION_MAX + 1);
    if (value.length > SHORT_DESCRIPTION_MAX) throw new ServicePresentationError(`A descrição curta deve ter no máximo ${SHORT_DESCRIPTION_MAX} caracteres.`);
    fields.short_description = value;
  }
  if (body.image_url !== undefined) {
    const value = String(body.image_url || "").trim();
    // Mesma origem dos uploads do painel: caminho local ou URL HTTPS do CDN.
    if (value && !/^\/uploads\/[\w./-]+$/.test(value) && !/^https:\/\/[^\s"'<>]+$/i.test(value)) {
      throw new ServicePresentationError("Imagem do serviço inválida. Envie a imagem pelo cadastro.");
    }
    fields.image_url = value.slice(0, 1000);
  }
  if (body.image_alt !== undefined) fields.image_alt = cleanText(body.image_alt, 200);
  if (body.requires_evaluation !== undefined) fields.requires_evaluation = booleanValue(body.requires_evaluation);
  if (body.requires_acknowledgement !== undefined) fields.requires_acknowledgement = booleanValue(body.requires_acknowledgement);
  if (body.public_info_sections !== undefined) fields.public_info_sections = JSON.stringify(normalizePublicInfoSections(body.public_info_sections));
  return fields;
}

function booleanValue(value) {
  if (typeof value === "string") return ["1", "true", "sim", "on"].includes(value.toLowerCase());
  return Boolean(Number(value) || value === true);
}

export async function saveServicePresentation(db, serviceId, body) {
  const fields = servicePresentationFields(body);
  const keys = Object.keys(fields);
  if (!keys.length) return;
  await db.run(
    `UPDATE services SET ${keys.map((key) => `${key}=${key === "public_info_sections" ? "?::jsonb" : "?"}`).join(",")} WHERE id=?`,
    [...keys.map((key) => fields[key]), serviceId]
  );
}

// Seções efetivamente exibidas ao cliente, na ordem configurada: posições de
// `pre_service`/`aftercare` resolvidas pelas colunas e seções vazias omitidas.
export function resolvedInfoSections(service = {}) {
  const stored = (() => {
    try { return normalizePublicInfoSections(service.public_info_sections ?? []); } catch { return []; }
  })();
  const sections = stored.map((section) => (COLUMN_BACKED_SECTIONS[section.key]
    ? { key: section.key, body: cleanText(service[COLUMN_BACKED_SECTIONS[section.key]], SECTION_BODY_MAX) }
    : section));
  for (const [key, column] of Object.entries(COLUMN_BACKED_SECTIONS)) {
    if (!sections.some((section) => section.key === key)) sections.push({ key, body: cleanText(service[column], SECTION_BODY_MAX) });
  }
  return sections.filter((section) => section.body);
}

// Hash do conteúdo que o cliente viu ao confirmar a leitura. Muda quando a
// clínica edita o texto, o que permite saber qual versão foi aceita.
export function serviceAcknowledgementHash(service = {}) {
  const content = {
    name: String(service.name || ""),
    description: cleanText(service.description, SECTION_BODY_MAX),
    sections: resolvedInfoSections(service),
    minimum_age_years: service.minimum_age_years ?? null,
    requires_guardian: booleanValue(service.requires_guardian),
    requires_signed_term: booleanValue(service.requires_signed_term),
    requires_evaluation: booleanValue(service.requires_evaluation)
  };
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

export function parseAcknowledgedServiceIds(value) {
  const parsed = parseJson(value, Array.isArray(value) ? value : String(value || "").split(","));
  return new Set((Array.isArray(parsed) ? parsed : []).map(Number).filter((id) => Number.isInteger(id) && id > 0));
}
