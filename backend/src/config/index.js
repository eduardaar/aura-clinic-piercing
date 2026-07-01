// Configuração central: variáveis de ambiente, constantes de domínio e caminhos.
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PORT = process.env.PORT || 4000;
export const isProduction = process.env.NODE_ENV === "production";

export const AUTH_SECRET =
  process.env.AUTH_SECRET || (isProduction ? "" : "aura-clinic-dev-secret");
if (!AUTH_SECRET) {
  throw new Error("AUTH_SECRET é obrigatória em produção. Defina-a no ambiente (.env).");
}

// Diretório onde os uploads (fotos, PDFs de termos) são gravados/servidos.
// __dirname aqui é src/config, então subimos um nível para src/data/uploads.
export const uploadsDir = path.join(__dirname, "..", "data", "uploads");
fs.mkdirSync(uploadsDir, { recursive: true });

// Categorias principais de joalherias (usadas no catálogo e validações).
export const JEWELRY_CATEGORIES = [
  "Labret",
  "Argolas",
  "Barbell Reto",
  "Barbell Curvo",
  "Nostril",
  "Topos",
  "Microdermal",
  "Surface",
  "Ouro 14k",
  "Ouro 18k"
];

export const ARGOLA_SUBCATEGORIES = [
  "Segmento",
  "Clicker",
  "D-Ring",
  "Captive",
  "Hinged Ring"
];
