// Configuração central: variáveis de ambiente, constantes de domínio e caminhos.
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config();
dotenv.config({ path: path.join(__dirname, "../../../.env") });

export const PORT = process.env.PORT || 4000;
export const isProduction = process.env.NODE_ENV === "production";

// Valor padrão usado apenas em desenvolvimento local. Nunca deve ser aceito em produção.
export const DEV_AUTH_SECRET = "aura-clinic-dev-secret";

export const AUTH_SECRET =
  process.env.AUTH_SECRET || (isProduction ? "" : DEV_AUTH_SECRET);
if (!AUTH_SECRET) {
  throw new Error("AUTH_SECRET é obrigatória em produção. Defina-a no ambiente (.env).");
}
// Em produção, bloqueia o boot se o segredo for o default de desenvolvimento
// (evita rodar em produção com um segredo público/previsível).
if (isProduction && AUTH_SECRET === DEV_AUTH_SECRET) {
  throw new Error(
    "AUTH_SECRET não pode ser o valor padrão de desenvolvimento em produção. Defina um segredo forte no ambiente (.env)."
  );
}

// Diretório onde os uploads (fotos, PDFs de termos) são gravados/servidos.
// __dirname aqui é src/config, então subimos um nível para src/data/uploads.
export const uploadsDir = path.join(__dirname, "..", "data", "uploads");
fs.mkdirSync(uploadsDir, { recursive: true });

// Categorias principais de joalherias (usadas no catálogo e validações).
export const JEWELRY_CATEGORIES = [
  "Labret",
  "Segmento",
  "Argola",
  "Conector",
  "Argolas",
  "Barbell Reto",
  "Barbell Curvo",
  "Nostril",
  "Topo",
  "Topos",
  "Microdermal",
  "Transversal",
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
