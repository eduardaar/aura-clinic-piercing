// Instância única do multer para upload de arquivos (fotos e comprovantes).
import multer from "multer";
import { uploadsDir } from "../config/index.js";

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
