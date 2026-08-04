// Rota de upload genérico de arquivos.
import { Router } from "express";
import { withDb } from "../middleware/withDb.js";
import { requireRole } from "../middleware/auth.js";
import { upload, parseUpload } from "../middleware/upload.js";
import { buildKey, storage } from "../services/storage/index.js";

const router = Router();

// Upload genérico do painel da clínica. O arquivo vai para o bucket PÚBLICO,
// sob `tenant_<id>/geral/`, e a resposta continua sendo `{ url }` — o que muda
// é o conteúdo: agora é a URL completa do CDN, não mais um caminho relativo.
// (No modo disco, sem R2 configurado, continua saindo `/uploads/<arquivo>`.)
router.post("/api/uploads", withDb(async (req, res) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  await parseUpload(upload.single("file"), req, res, { category: "geral" });
  if (!req.file) return res.status(400).json({ error: "Nenhum arquivo enviado." });
  res.status(201).json({ url: req.file.publicUrl });
}));

// Leitura de arquivo privado — comprovante, foto clínica, PDF de termo.
//
// Continua saindo PELA API, com stream do bucket, e não por URL assinada: as
// checagens abaixo (papel, `purpose` para a recepção, `Cache-Control:
// private, no-store`) são a barreira de acesso. Uma URL assinada seria um
// link que funciona fora da sessão e sobrevive a qualquer encaminhamento.
router.get("/api/private-files/:filename", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception", "piercer"])) return;
  const filename = String(req.params.filename || "");
  if (!/^[a-zA-Z0-9_-]+(?:\.pdf)?$/.test(filename)) return res.status(400).json({ error: "Arquivo inválido." });
  // O registro vive no schema DA clínica: arquivo de outro tenant simplesmente
  // não é encontrado aqui, e é isso que impede a leitura cruzada.
  const file = await db.get("SELECT id, purpose, original_name, mime_type FROM private_files WHERE filename=?", [filename]);
  if (!file) return res.status(404).json({ error: "Arquivo não encontrado." });
  if (req.user?.role === "reception" && !["appointment_reference", "public_booking"].includes(file.purpose)) {
    return res.status(403).json({ error: "Acesso negado." });
  }

  // A chave é reconstruída a partir do tenant + purpose; se o objeto ainda não
  // subiu para o bucket, a camada de storage cai no disco local sozinha.
  const key = buildKey({ scope: "private", tenantId: req.tenant?.id, purpose: file.purpose, filename });
  const object = await storage.getPrivateStream(key);
  if (!object) return res.status(404).json({ error: "Arquivo não encontrado." });

  res.type(file.mime_type || "application/pdf");
  const safeName = String(file.original_name || "ficha-anamnese.pdf").replace(/[\r\n"\\]/g, "-");
  res.setHeader("Content-Disposition", `inline; filename="${safeName.replace(/[^\x20-\x7E]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(safeName)}`);
  res.setHeader("Cache-Control", "private, no-store");
  if (object.contentLength) res.setHeader("Content-Length", String(object.contentLength));
  object.body.on("error", () => {
    // Stream que morre no meio já mandou cabeçalho: só resta cortar a conexão,
    // senão o cliente fica esperando um corpo que não vem.
    if (!res.headersSent) res.status(404).json({ error: "Arquivo não encontrado." });
    else res.destroy();
  });
  object.body.pipe(res);
}));

export default router;
