// Recebimento de arquivo (fotos, comprovantes, PDFs) — multer + persistência.
//
// O multer trabalha em MEMÓRIA, não em disco. O limite de 6 MB por arquivo já
// existia e é o que torna isso seguro: o buffer é validado, sobe para o object
// storage e é descartado. Gravar em disco primeiro deixaria de existir o único
// lugar onde o arquivo de uma clínica se mistura com o de outra.
//
// Onde cada tipo é persistido:
//
//   PÚBLICO  — aqui mesmo, em `parseUpload`, assim que o conteúdo é validado.
//              A categoria é do chamador (padrão "geral").
//   PRIVADO  — em `registerPrivateFiles`, e não antes: a chave privada leva o
//              `purpose` dentro (`tenant_<id>/<purpose>/<arquivo>`) e quem sabe
//              o purpose é a rota, no momento em que registra o arquivo.
import crypto from "node:crypto";
import multer from "multer";
import sharp from "sharp";
import { buildKey, storage } from "../services/storage/index.js";

const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf"
]);

const fileFilter = (_req, file, cb) => {
  if (!allowedMimeTypes.has(file.mimetype)) {
    return cb(new Error("Tipo de arquivo não permitido."));
  }
  cb(null, true);
};

// O escopo (público/privado) é uma propriedade do multer que a rota escolheu,
// mas `parseUpload` recebe o MIDDLEWARE já construído (`upload.single(...)`),
// não a instância. Marcar o middleware na saída de cada método preserva todas
// as chamadas existentes nas rotas — nenhuma precisa passar o escopo à mão.
function withScope(instance, scope) {
  for (const method of ["single", "array", "fields", "none", "any"]) {
    const original = instance[method].bind(instance);
    instance[method] = (...args) => Object.assign(original(...args), { storageScope: scope });
  }
  return instance;
}

export const upload = withScope(
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 6 * 1024 * 1024, files: 1, fields: 50, fieldSize: 64 * 1024, parts: 51 },
    fileFilter
  }),
  "public"
);

export const privateUpload = withScope(
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 6 * 1024 * 1024, files: 2, fields: 50, fieldSize: 64 * 1024, parts: 52 },
    fileFilter
  }),
  "private"
);

function uploadedFiles(req) {
  return [
    ...(req.file ? [req.file] : []),
    ...Object.values(req.files || {}).flat()
  ];
}

/**
 * Validação de CONTEÚDO, não de extensão nem de Content-Type.
 *
 * É esta função que impede subir um executável renomeado para .png: o
 * navegador declara o mimetype, e declarar é grátis. PDF e GIF são conferidos
 * pela assinatura no início do arquivo; as demais imagens têm de ser
 * decodificáveis pelo sharp (que estoura em qualquer coisa que não seja
 * imagem de verdade). Exportada para o teste poder exercitá-la sem HTTP.
 */
export async function validateFileContents(file) {
  const buffer = file?.buffer;
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error("Conteúdo de arquivo inválido.");

  if (file.mimetype === "application/pdf") {
    if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("Conteúdo de arquivo inválido.");
    if (!buffer.subarray(Math.max(0, buffer.length - 2048)).includes(Buffer.from("%%EOF"))) {
      throw new Error("Conteúdo de arquivo inválido.");
    }
    return;
  }
  if (file.mimetype === "image/gif") {
    if (!["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"))) {
      throw new Error("Conteúdo de arquivo inválido.");
    }
    await sharp(buffer, { limitInputPixels: 40_000_000, animated: true }).metadata();
    return;
  }
  await sharp(buffer, { limitInputPixels: 40_000_000 }).metadata();
}

// Nome do arquivo: 32 hex, sem extensão — o mesmo formato que o multer em
// disco gerava. Mantido de propósito: é o que já está gravado nas colunas de
// URL do banco e o que o regex de `GET /api/private-files/:filename` aceita.
function generateFilename() {
  return crypto.randomBytes(16).toString("hex");
}

/**
 * Roda o multer, valida o conteúdo de tudo que chegou e persiste o que for
 * público. Contrato inalterado para as rotas: resolve vazio, e o que interessa
 * continua em `req.file` / `req.files`.
 *
 * Cada arquivo sai daqui com:
 *   `filename`   nome final (o que vai para o banco);
 *   `tenantId`   clínica dona (null na landing da plataforma);
 *   `storageKey` + `publicUrl`, só nos públicos.
 *
 * @param {Function} middleware  ex.: `upload.single("file")`
 * @param {object} [options]
 * @param {string} [options.category] categoria do bucket público (ver keys.js)
 */
export function parseUpload(middleware, req, res, { category = "geral", imagesOnly = false } = {}) {
  const scope = middleware?.storageScope === "private" ? "private" : "public";
  return new Promise((resolve, reject) => middleware(req, res, async (error) => {
    if (error) return reject(error);
    const files = uploadedFiles(req);
    try {
      if (imagesOnly && files.some((file) => !String(file.mimetype || "").startsWith("image/"))) {
        throw new Error("Envie somente imagens.");
      }
      // Valida TUDO antes de gravar QUALQUER coisa: numa requisição com dois
      // arquivos, subir o primeiro e recusar o segundo deixaria lixo no bucket.
      await Promise.all(files.map(validateFileContents));
    } catch {
      return reject(new Error("Conteúdo de arquivo inválido."));
    }
    try {
      for (const file of files) {
        file.filename = file.filename || generateFilename();
        file.tenantId = req.tenant?.id ?? null;
        if (scope !== "public") continue;
        const key = buildKey({ scope: "public", tenantId: file.tenantId, category, filename: file.filename });
        const { url } = await storage.putPublic(key, file.buffer, { contentType: file.mimetype });
        file.storageKey = key;
        file.publicUrl = url;
      }
      resolve();
    } catch (uploadError) {
      reject(uploadError);
    }
  }));
}

/**
 * Registra os arquivos privados na tabela `private_files` (que vive DENTRO do
 * schema da clínica) e sobe cada um para o bucket privado.
 *
 * A gravação acontece aqui, e não em `parseUpload`, porque a chave privada é
 * `tenant_<id>/<purpose>/<arquivo>` — sem o purpose não há chave. O efeito
 * colateral bom: rota que valida o arquivo e desiste antes de registrar não
 * deixa órfão em bucket nenhum.
 */
export async function registerPrivateFiles(db, files, purpose, userId = null) {
  const list = Array.isArray(files) ? files : files ? [files] : [];
  for (const file of list) {
    file.filename = file.filename || generateFilename();
    const key = buildKey({
      scope: "private",
      tenantId: file.tenantId ?? null,
      purpose,
      filename: file.filename
    });
    if (Buffer.isBuffer(file.buffer)) {
      await storage.putPrivate(key, file.buffer, { contentType: file.mimetype });
      file.storageKey = key;
    }
    await db.run(
      "INSERT INTO private_files (filename, original_name, mime_type, purpose, uploaded_by) VALUES (?, ?, ?, ?, ?) ON CONFLICT (filename) DO NOTHING",
      [file.filename, String(file.originalname || "").slice(0, 255), file.mimetype, purpose, userId]
    );
  }
}
