// Serviços de termo digital (anamnese): geração de PDF e listagem.
import path from "path";
import fs from "fs";
import PDFDocument from "pdfkit";
import { uploadsDir } from "../config/index.js";
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

export async function listDigitalTerms(db) {
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

export async function createTermPdf(term, appointment) {
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

    writeTermSection(doc, "Termo De Consentimento");
    doc.text("Declaro que recebi orientações sobre o procedimento, cuidados, higienização, riscos, intercorrências, cicatrização e retornos. Também confirmo que os materiais utilizados são esterilizados, lacrados e descartados após o procedimento.", {
      lineGap: 2
    });

    if (formData.minor?.is_minor) {
      writeTermSection(doc, "Autorização Para Menores");
      writeTermLine(doc, "Responsável Legal", formData.minor?.responsible_name || "Não informado");
      writeTermLine(doc, "Documento Do Responsável", formData.minor?.responsible_document || "Não informado");
      writeTermLine(doc, "Nome Do Menor", formData.minor?.minor_name || "Não informado");
    }

    writeTermSection(doc, "Assinaturas");
    writeTermLine(doc, "Assinatura Da Cliente", "Assinatura digital anexada");
    writeTermLine(doc, "Assinatura Da Profissional", appointment.professional_name || "Profissional responsável");
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
