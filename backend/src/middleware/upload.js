// Instância única do multer para upload de arquivos (fotos e comprovantes).
import multer from "multer";
import { uploadsDir } from "../config/index.js";

export const upload = multer({ dest: uploadsDir });
