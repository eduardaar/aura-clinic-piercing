// Instância única do multer para upload de arquivos (fotos e comprovantes).
import multer from "multer";
import fs from "node:fs/promises";
import sharp from "sharp";
import { privateUploadsDir, uploadsDir } from "../config/index.js";

const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf"
]);

export const upload = multer({
  dest: uploadsDir,
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      return cb(new Error("Tipo de arquivo não permitido."));
    }
    cb(null, true);
  }
});

export const privateUpload = multer({
  dest: privateUploadsDir,
  limits: { fileSize: 6 * 1024 * 1024, files: 2 },
  fileFilter: (_req, file, cb) => {
    if (!allowedMimeTypes.has(file.mimetype)) return cb(new Error("Tipo de arquivo não permitido."));
    cb(null, true);
  }
});

function uploadedFiles(req) {
  return [
    ...(req.file ? [req.file] : []),
    ...Object.values(req.files || {}).flat()
  ];
}

async function validateFileContents(file) {
  if (file.mimetype === "application/pdf") {
    const handle = await fs.open(file.path, "r");
    try {
      const header = Buffer.alloc(5);
      await handle.read(header, 0, header.length, 0);
      if (header.toString("ascii") !== "%PDF-") throw new Error("Conteúdo de arquivo inválido.");
    } finally {
      await handle.close();
    }
    return;
  }
  if (file.mimetype === "image/gif") {
    const handle = await fs.open(file.path, "r");
    try {
      const header = Buffer.alloc(6);
      await handle.read(header, 0, header.length, 0);
      if (!["GIF87a", "GIF89a"].includes(header.toString("ascii"))) throw new Error("Conteúdo de arquivo inválido.");
    } finally {
      await handle.close();
    }
    return;
  }
  await sharp(file.path, { limitInputPixels: 40_000_000 }).metadata();
}

export function parseUpload(middleware, req, res) {
  return new Promise((resolve, reject) => middleware(req, res, async (error) => {
    if (error) return reject(error);
    const files = uploadedFiles(req);
    try {
      await Promise.all(files.map(validateFileContents));
      resolve();
    } catch {
      await Promise.all(files.map((file) => fs.unlink(file.path).catch(() => {})));
      reject(new Error("Conteúdo de arquivo inválido."));
    }
  }));
}

export async function registerPrivateFiles(db, files, purpose, userId = null) {
  const list = Array.isArray(files) ? files : files ? [files] : [];
  for (const file of list) {
    await db.run(
      "INSERT INTO private_files (filename, original_name, mime_type, purpose, uploaded_by) VALUES (?, ?, ?, ?, ?) ON CONFLICT (filename) DO NOTHING",
      [file.filename, String(file.originalname || "").slice(0, 255), file.mimetype, purpose, userId]
    );
  }
}
