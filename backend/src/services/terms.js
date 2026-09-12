// Serviços de termo digital (anamnese): registro imutável, geração de PDF e listagem.
import crypto from "node:crypto";
import PDFDocument from "pdfkit";
import { limitOffset, countRows } from "./pagination.js";
import { buildKey, storage } from "./storage/index.js";
import {
  parseTermFormData,
  signatureBufferFromDataUrl,
  writeTermSection,
  writeTermLine,
  writeTermChecklistColumns,
  writeTermValueColumns,
  formatTermAnswer,
  HEALTH_HISTORY_FIELDS,
  STYLE_QUESTIONS
} from "./utils.js";

const DIGITAL_TERM_FROM = `
    digital_terms t
    LEFT JOIN appointments a ON a.id = t.appointment_id
    LEFT JOIN clients c ON c.id = t.client_id
    LEFT JOIN professionals p ON p.id = a.professional_id
`;

const DIGITAL_TERM_QUERY = `
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
      t.template_id,
      t.template_name,
      t.term_request_id,
      t.channel,
      t.content_hash,
      a.appointment_date,
      a.appointment_time,
      t.instagram AS term_instagram,
      c.instagram AS client_instagram,
      p.name AS professional_name
    FROM ${DIGITAL_TERM_FROM}
`;

// `paging` é opcional: sem ele o comportamento é o de sempre (lista inteira).
export async function listDigitalTerms(db, { where = "", params = [], paging = null } = {}) {
  const page = limitOffset(paging);
  const orderBy = paging?.orderBy || "ORDER BY t.signed_at DESC";
  return db.all(`${DIGITAL_TERM_QUERY} ${where} ${orderBy}${page.clause}`, [...params, ...page.params]);
}

export async function countDigitalTerms(db, { where = "", params = [] } = {}) {
  return countRows(db, { from: DIGITAL_TERM_FROM, where, params });
}

// Busca direta por id, para devolver o termo recém-criado sem varrer a lista.
export async function getDigitalTerm(db, id) {
  return db.get(`${DIGITAL_TERM_QUERY} WHERE t.id = ?`, [id]);
}

function meaningful(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

export function ageFromBirthDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return null;
  const birth = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getUTCFullYear() - birth.getUTCFullYear();
  const beforeBirthday = today.getUTCMonth() < birth.getUTCMonth()
    || (today.getUTCMonth() === birth.getUTCMonth() && today.getUTCDate() < birth.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

// Assinatura chega como data URL de PNG desenhado no canvas. Limite folgado
// para o traço, apertado o bastante para não virar upload arbitrário.
const MAX_SIGNATURE_LENGTH = 2 * 1024 * 1024;
function validSignature(value) {
  const text = String(value || "");
  return /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(text) && text.length <= MAX_SIGNATURE_LENGTH;
}

// Regras do aceite, iguais no balcão e no link do cliente. Devolve a mensagem
// de erro ou null.
export function validateDigitalTermBody(body, { requireGuardianForMinors = true } = {}) {
  if (!body?.full_name?.trim() || !body.signature_data_url) {
    return "Dados obrigatorios do termo nao foram preenchidos.";
  }
  if (!validSignature(body.signature_data_url)) return "A assinatura digital é inválida.";
  if (!body.orientations_confirmed) {
    return "O cliente precisa confirmar que recebeu as orientacoes.";
  }
  const minor = body.form_data?.minor || {};
  const age = ageFromBirthDate(body.birth_date);
  if (age !== null && age < 18 && !minor.is_minor && requireGuardianForMinors) {
    return "Cliente menor de idade: informe e valide o responsável legal.";
  }
  if (minor.is_minor) {
    if (!meaningful(minor.responsible_name) || !meaningful(minor.responsible_document)) {
      return "Nome e documento do responsável legal são obrigatórios.";
    }
    if (!body.guardian_signature_data_url) return "A assinatura do responsável legal é obrigatória.";
    if (!validSignature(body.guardian_signature_data_url)) return "A assinatura do responsável legal é inválida.";
  }
  return null;
}

// Atualiza o cadastro do cliente com o que ele mesmo informou no termo
// (documento, nascimento, contato). Só campos preenchidos sobrescrevem.
export async function syncClientRegistration(db, client, body) {
  const candidates = { full_name: body.full_name, phone: body.phone, whatsapp: body.whatsapp, instagram: body.instagram, email: body.email, birth_date: body.birth_date, cpf: body.document_number };
  const next = { ...client };
  for (const [field, value] of Object.entries(candidates)) if (meaningful(value)) next[field] = String(value).trim();
  await db.run(`UPDATE clients SET full_name=?, phone=?, whatsapp=?, instagram=?, email=?, birth_date=?, cpf=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    [next.full_name, next.phone || "", next.whatsapp || "", next.instagram || "", next.email || "", next.birth_date || "", next.cpf || "", client.id]);
  return db.get("SELECT * FROM clients WHERE id=?", [client.id]);
}

// Impressão digital do aceite: qualquer alteração posterior no que foi assinado
// deixa de bater com o hash gravado (e o gatilho do banco já recusa a alteração).
export function digitalTermHash(fields) {
  return crypto.createHash("sha256").update(JSON.stringify(fields), "utf8").digest("hex");
}

// Grava o termo, gera o PDF e devolve o registro. Serve ao balcão (usuário
// autenticado) e ao link do cliente (sem usuário; `channel` diz de onde veio).
export async function createDigitalTermRecord(db, {
  body, client, appointment = null, userId = null, channel = "staff",
  template = null, requestId = null, ip = null, userAgent = null
}) {
  const minor = body.form_data?.minor || {};
  const signedAt = new Date().toISOString().slice(0, 19).replace("T", " ");
  const persisted = {
    appointment_id: body.appointment_id || appointment?.id || null,
    client_id: client.id,
    full_name: String(body.full_name).trim(),
    social_name: body.social_name || "",
    document_number: body.document_number || "",
    birth_date: body.birth_date || "",
    whatsapp: body.whatsapp || appointment?.whatsapp || "",
    instagram: body.instagram || appointment?.instagram || "",
    address: body.address || "",
    procedure: body.procedure || appointment?.procedure || "",
    piercing_region: body.piercing_region || appointment?.piercing_region || "",
    orientations_confirmed: body.orientations_confirmed ? 1 : 0,
    health_declaration: body.health_declaration || "",
    form_data: JSON.stringify(body.form_data || {}),
    signature_data_url: body.signature_data_url,
    guardian_signature_data_url: minor.is_minor ? body.guardian_signature_data_url : null,
    template_id: template?.id || null,
    template_name: template?.name || null,
    template_content: template?.content || null,
    term_request_id: requestId,
    channel,
    signed_at: signedAt
  };
  const contentHash = digitalTermHash({
    full_name: persisted.full_name, document_number: persisted.document_number, birth_date: persisted.birth_date,
    orientations_confirmed: persisted.orientations_confirmed, health_declaration: persisted.health_declaration,
    form_data: persisted.form_data, signature_data_url: persisted.signature_data_url,
    guardian_signature_data_url: persisted.guardian_signature_data_url, template_content: persisted.template_content, signed_at: signedAt
  });
  const columns = [...Object.keys(persisted), "accepted_ip", "accepted_user_agent", "content_hash"];
  const values = [...Object.values(persisted), ip ? String(ip).slice(0, 100) : null, userAgent ? String(userAgent).slice(0, 300) : null, contentHash];
  const result = await db.run(
    `INSERT INTO digital_terms (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")}) RETURNING id`,
    values
  );
  const term = await db.get("SELECT * FROM digital_terms WHERE id = ?", [result.returnedId]);
  const pdfUrl = await createTermPdf(db, term, appointment || {}, userId);
  // `pdf_url` é a única coluna que o gatilho de imutabilidade deixa mudar.
  await db.run("UPDATE digital_terms SET pdf_url = ? WHERE id = ?", [pdfUrl, result.returnedId]);
  return getDigitalTerm(db, result.returnedId);
}

// Id da clínica a partir da própria conexão: o `search_path` da requisição já
// aponta para `tenant_<id>` (ver middleware/withDb.js). Assim a chave do
// arquivo sai certa sem exigir que a rota passe o tenant à mão.
async function tenantIdFromDb(db) {
  const row = await db.get("SELECT current_schema() AS schema_name");
  const match = /^tenant_(\d+)$/.exec(String(row?.schema_name || ""));
  return match ? Number(match[1]) : null;
}

const CHANNEL_LABELS = { staff: "Preenchido no balcão pela equipe", in_studio: "Preenchido pelo cliente no estúdio", remote: "Preenchido pelo cliente por link" };

export async function createTermPdf(db, term, appointment = {}, userId = null) {
  const fileName = `termo-digital-${term.id}.pdf`;
  const signatureBuffer = signatureBufferFromDataUrl(term.signature_data_url);
  const guardianSignatureBuffer = signatureBufferFromDataUrl(term.guardian_signature_data_url);
  const formData = parseTermFormData(term.form_data);
  // O PDF é montado em memória e vai direto para o bucket privado — não passa
  // pelo disco: é justamente o termo de anamnese (dado de saúde) que não pode
  // continuar num diretório compartilhado por todas as clínicas.
  const pdfBuffer = await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 42, size: "A4" });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.fontSize(20).text("Aura Clinic Piercing", { align: "center" });
    doc.fontSize(14).text(term.template_name || "Ficha De Anamnese", { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(10.5);
    doc.text(`Paciente: ${term.full_name}`, { continued: true });
    doc.text(`   Data: ${new Date(term.signed_at).toLocaleDateString("pt-BR")}`, { align: "right" });
    doc.moveDown(0.4);

    writeTermSection(doc, "Dados Pessoais");
    writeTermLine(doc, "Nome Completo", term.full_name);
    writeTermLine(doc, "Nome Social", term.social_name || formData.personal?.social_name || "Não informado");
    writeTermLine(doc, "Data De Nascimento", term.birth_date || "Não informado");
    writeTermLine(doc, "Documento", term.document_number || "Não informado");
    writeTermLine(doc, "WhatsApp", term.whatsapp || appointment.whatsapp || "Não informado");
    writeTermLine(doc, "Instagram", term.instagram || appointment.instagram || "Não informado");
    writeTermLine(doc, "Endereço", term.address || "Não informado");

    writeTermSection(doc, "Histórico De Saúde");
    writeTermChecklistColumns(doc, HEALTH_HISTORY_FIELDS.map(({ label, key }) => ({ label, checked: Boolean(formData.health_history?.[key]) })));

    writeTermSection(doc, "Estilo De Vida");
    writeTermValueColumns(doc, STYLE_QUESTIONS.map(({ label, key }) => ({ label, value: formatTermAnswer(formData.lifestyle?.[key]) })));

    writeTermSection(doc, "Informações Do Atendimento");
    writeTermLine(doc, "Procedimento", term.procedure || appointment.procedure);
    writeTermLine(doc, "Região da Perfuração", term.piercing_region || appointment.piercing_region);
    writeTermLine(doc, "Local Da Aplicação", formData.information?.application_location || "Não informado");
    writeTermLine(doc, "Joia", formData.information?.jewelry || "Não informada");
    writeTermLine(doc, "Observação", formData.information?.observation || term.health_declaration || "Sem observações adicionais.");
    writeTermLine(doc, "Valor", formData.information?.value || "Não informado");

    writeTermSection(doc, term.template_name ? `Termo Aceito: ${term.template_name}` : "Termo De Consentimento");
    doc.text(term.template_content || "Declaro que recebi orientações sobre o procedimento, cuidados, higienização, riscos, intercorrências, cicatrização e retornos. Também confirmo que os materiais utilizados são esterilizados, lacrados e descartados após o procedimento.", {
      lineGap: 2
    });

    if (formData.minor?.is_minor) {
      writeTermSection(doc, "Autorização Para Menores");
      writeTermLine(doc, "Responsável Legal", formData.minor?.responsible_name || "Não informado");
      writeTermLine(doc, "Documento Do Responsável", formData.minor?.responsible_document || "Não informado");
      writeTermLine(doc, "Nome Do Menor", formData.minor?.minor_name || "Não informado");
      writeTermLine(doc, "Assinatura Do Responsável", guardianSignatureBuffer ? "Assinatura digital anexada" : "Ausente");
    }

    writeTermSection(doc, "Assinaturas");
    writeTermLine(doc, "Assinatura Da Cliente", "Assinatura digital anexada");
    writeTermLine(doc, "Assinatura Da Profissional", appointment.professional_name || "Profissional responsável");
    doc.text(`Assinado digitalmente em: ${new Date(term.signed_at).toLocaleString("pt-BR")}`);
    if (term.channel) doc.text(`Origem: ${CHANNEL_LABELS[term.channel] || term.channel}`);
    if (term.content_hash) doc.text(`Verificação: ${term.content_hash}`);
    if (signatureBuffer) {
      doc.moveDown(0.4);
      doc.text("Assinatura digital:");
      doc.image(signatureBuffer, { width: 260 });
    }
    if (formData.minor?.is_minor && guardianSignatureBuffer) {
      doc.moveDown(0.4);
      doc.text("Assinatura digital do responsável legal:");
      doc.image(guardianSignatureBuffer, { width: 260 });
    }
    doc.moveDown(0.4);
    doc.text("Aura Clinic Piercing  Atendimento premium e cuidadoso.", { align: "center" });
    doc.end();
  });
  const tenantId = await tenantIdFromDb(db);
  // `purpose: "digital_term"` é o que está no banco; a pasta correspondente é
  // `termos` (o apelido mora em services/storage/keys.js, para que a leitura em
  // GET /api/private-files e o script de migração cheguem à mesma chave).
  const key = buildKey({ scope: "private", tenantId, purpose: "digital_term", filename: fileName });
  await storage.putPrivate(key, pdfBuffer, { contentType: "application/pdf" });
  await db.run(
    "INSERT INTO private_files (filename, original_name, mime_type, purpose, uploaded_by) VALUES (?, ?, 'application/pdf', 'digital_term', ?) ON CONFLICT (filename) DO NOTHING",
    [fileName, fileName, userId]
  );
  return `/api/private-files/${fileName}`;
}
