// Apresentação pública do serviço (agendamento online e pré-visualização do
// cadastro). O contrato das seções é validado no backend em
// `backend/src/services/servicePresentation.js`.

export const SHORT_DESCRIPTION_RECOMMENDED = 160;
export const SHORT_DESCRIPTION_MAX = 240;

// Ordem de referência para novas seções. `pre_service` e `aftercare` são
// editadas aqui, mas o texto fica nas colunas usadas pela Agenda e pelo
// pós-atendimento (`pre_service_notes` e `aftercare_instructions`).
export const SERVICE_INFO_SECTIONS = [
  { key: "how_it_works", title: "Como funciona", hint: "Etapas do procedimento e o que esperar no dia." },
  { key: "pre_service", title: "Antes do atendimento", column: "pre_service_notes", hint: "Preparação e cuidados antes de vir ao estúdio." },
  { key: "rules", title: "Regras e condições", hint: "Condições de realização, atrasos, remarcação." },
  { key: "eligibility", title: "Critérios de elegibilidade", hint: "Quem pode realizar o serviço." },
  { key: "evaluation", title: "Avaliação prévia", hint: "Quando e como a avaliação acontece." },
  { key: "contraindications", title: "Restrições e contraindicações", hint: "Situações em que o serviço deve ser adiado." },
  { key: "jewelry", title: "Joias e materiais", hint: "Materiais utilizados e joias compatíveis." },
  { key: "commercial", title: "Preço e condições comerciais", hint: "O que está incluso, formas de pagamento, sinal." },
  { key: "warranty", title: "Garantia" },
  { key: "warranty_limits", title: "O que a garantia não cobre" },
  { key: "aftercare", title: "Cuidados após o atendimento", column: "aftercare_instructions", hint: "Também usado nas mensagens de pós-atendimento." },
  { key: "returns", title: "Retornos previstos", hint: "Prazos e como agendar o retorno." },
  { key: "contact", title: "Contato e acompanhamento" },
  { key: "consent", title: "Termos e consentimentos" },
  { key: "custom", title: "Outras informações", repeatable: true }
];

const SECTION_BY_KEY = Object.fromEntries(SERVICE_INFO_SECTIONS.map((section) => [section.key, section]));

export function serviceSectionDefinition(key) {
  return SECTION_BY_KEY[key] || null;
}

function parseJson(value, fallback) {
  if (value == null || value === "") return fallback;
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function flag(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function text(value) {
  return String(value ?? "").trim();
}

// Resumo do cartão: a descrição curta da clínica ou, enquanto ela não existir,
// as primeiras frases da descrição completa, sem cortar palavra no meio.
export function serviceCardSummary(service = {}, limit = SHORT_DESCRIPTION_RECOMMENDED) {
  const short = text(service.short_description);
  if (short) return short;
  const full = text(service.description).replace(/\s+/g, " ");
  if (full.length <= limit) return full;
  const sentences = full.match(/[^.!?]+[.!?]+/g) || [];
  let summary = "";
  for (const sentence of sentences) {
    if ((summary + sentence).trim().length > limit) break;
    summary = `${summary}${sentence}`;
  }
  if (summary.trim()) return summary.trim();
  const cut = full.slice(0, limit);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), Math.floor(limit * 0.6))).replace(/[\s,;:–-]+$/, "")}…`;
}

// Lista editável do cadastro: as seções gravadas na ordem escolhida, com o
// texto das seções de coluna trazido do próprio cadastro.
export function editableInfoSections(service = {}) {
  const stored = asSectionList(service.public_info_sections);
  const sections = stored.map((section) => {
    const definition = SECTION_BY_KEY[section.key];
    return definition?.column ? { key: section.key, title: "", body: text(service[definition.column]) } : { key: section.key, title: text(section.title), body: String(section.body ?? "") };
  });
  for (const definition of SERVICE_INFO_SECTIONS.filter((item) => item.column)) {
    if (!sections.some((section) => section.key === definition.key) && text(service[definition.column])) {
      sections.push({ key: definition.key, title: "", body: text(service[definition.column]) });
    }
  }
  return sections;
}

function asSectionList(value) {
  const parsed = parseJson(value, []);
  return Array.isArray(parsed) ? parsed.filter((section) => SECTION_BY_KEY[section?.key]) : [];
}

// O que é gravado: a ordem das seções e o texto das que não têm coluna própria.
export function serializeInfoSections(sections = []) {
  return sections.map((section) => {
    const definition = SECTION_BY_KEY[section.key];
    if (definition?.column) return { key: section.key };
    return section.key === "custom" ? { key: "custom", title: text(section.title), body: text(section.body) } : { key: section.key, body: text(section.body) };
  });
}

// Seções exibidas ao cliente, já com título e sem as vazias.
export function publicInfoSections(service = {}) {
  return editableInfoSections(service)
    .map((section) => ({ ...section, title: section.key === "custom" ? section.title || SECTION_BY_KEY.custom.title : SECTION_BY_KEY[section.key].title, body: text(section.body) }))
    .filter((section) => section.body);
}

export function servicePrice(service = {}) {
  const value = Number(service.base_price ?? service.price ?? 0);
  return Number.isFinite(value) ? value : 0;
}

// Fatos objetivos do cadastro, mostrados só quando se aplicam ao serviço.
export function serviceRequirementFacts(service = {}) {
  const facts = [];
  const age = service.minimum_age_years;
  if (age !== null && age !== undefined && age !== "" && Number(age) > 0) facts.push({ key: "age", label: "Idade mínima", value: `${Number(age)} anos` });
  if (flag(service.requires_guardian)) facts.push({ key: "guardian", label: "Menores de idade", value: "Exigem responsável legal" });
  if (flag(service.requires_evaluation)) facts.push({ key: "evaluation", label: "Avaliação prévia", value: "Necessária antes da realização" });
  if (flag(service.requires_signed_term)) facts.push({ key: "term", label: "Termo de consentimento", value: "Deve estar assinado antes da conclusão do atendimento" });
  const returnDays = Number(service.return_after_days || 0);
  if (returnDays > 0) facts.push({ key: "return", label: "Retorno previsto", value: `${returnDays} ${returnDays === 1 ? "dia" : "dias"} após o atendimento` });
  if (flag(service.postcare_enabled)) {
    const days = parseJson(service.postcare_days, []);
    const list = Array.isArray(days) ? days.map(Number).filter((day) => day > 0) : [];
    if (list.length) facts.push({ key: "postcare", label: "Acompanhamento", value: `Contato da equipe em ${list.join(", ")} dias` });
  }
  return facts;
}

export function serviceHasFullInformation(service = {}) {
  return Boolean(text(service.description) || publicInfoSections(service).length || serviceRequirementFacts(service).length);
}

// Sinal da solicitação: a mesma regra do backend (`POST /api/booking/requests`),
// soma dos sinais dos serviços limitada ao total.
export function bookingDepositTotal(services = [], total = Infinity) {
  const deposit = services.reduce((sum, service) => sum + Math.max(0, Number(service.deposit_value || 0)), 0);
  return Math.min(deposit, Math.max(0, total));
}

export function bookingDurationTotal(services = []) {
  return services.reduce((sum, service) => sum + Math.max(0, Number(service.duration_minutes || 0)), 0);
}

export function formatDuration(minutes) {
  const value = Math.max(0, Math.round(Number(minutes || 0)));
  if (!value) return "";
  if (value < 60) return `${value} min`;
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}
