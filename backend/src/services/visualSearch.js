import fs from "fs/promises";
import path from "path";
import dns from "dns/promises";
import net from "net";
import { fileURLToPath } from "url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsRoot = path.resolve(__dirname, "..", "data", "uploads");

export async function perceptualHash(buffer) {
  const { data, info } = await sharp(buffer, { failOn: "error", limitInputPixels: 40_000_000 })
    .rotate()
    .resize(9, 8, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let bits = "";
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) bits += data[y * info.width + x] > data[y * info.width + x + 1] ? "1" : "0";
  }
  return BigInt(`0b${bits}`).toString(16).padStart(16, "0");
}

export function hashSimilarity(left, right) {
  if (!/^[0-9a-f]{16}$/i.test(left || "") || !/^[0-9a-f]{16}$/i.test(right || "")) return 0;
  let xor = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
  let distance = 0;
  while (xor) {
    distance += Number(xor & 1n);
    xor >>= 1n;
  }
  return Number(((1 - distance / 64) * 100).toFixed(1));
}

async function imageBuffer(imageUrl) {
  const value = String(imageUrl || "");
  if (value.startsWith("/uploads/")) {
    const name = path.basename(value);
    const resolved = path.resolve(uploadsRoot, name);
    if (!resolved.startsWith(`${uploadsRoot}${path.sep}`)) throw new Error("Caminho de imagem inválido.");
    return fs.readFile(resolved);
  }
  if (/^https:\/\//i.test(value)) {
    const parsed = new URL(value);
    const addresses = await dns.lookup(parsed.hostname, { all: true });
    if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new Error("Origem de imagem bloqueada.");
    const response = await fetch(parsed, { signal: AbortSignal.timeout(5000), redirect: "error" });
    if (!response.ok) throw new Error("Imagem remota indisponível.");
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > 8 * 1024 * 1024) throw new Error("Imagem remota excede o limite.");
    return Buffer.from(await response.arrayBuffer());
  }
  throw new Error("Imagem sem origem suportada.");
}

function isPrivateAddress(address) {
  if (!net.isIP(address)) return true;
  const normalized = address.toLowerCase();
  return normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:")
    || normalized.startsWith("127.") || normalized.startsWith("10.") || normalized.startsWith("192.168.")
    || normalized.startsWith("169.254.") || /^172\.(1[6-9]|2\d|3[01])\./.test(normalized)
    || normalized === "0.0.0.0";
}

export async function indexProductVisualHashes(db) {
  const products = await db.all(`
    SELECT j.id, j.photo_url, j.image_url,
      COALESCE((SELECT image_url FROM product_images pi WHERE pi.product_id=j.id AND pi.is_primary=1 ORDER BY pi.sort_order LIMIT 1), '') AS primary_image
    FROM jewelry_inventory j
    WHERE j.status != 'arquivado'
  `);
  let indexed = 0;
  for (const product of products) {
    const url = product.primary_image || product.photo_url || product.image_url;
    if (!url) continue;
    const existing = await db.get("SELECT id FROM product_visual_hashes WHERE product_id=? AND variation_id IS NULL AND image_url=?", [product.id, url]);
    if (existing) continue;
    try {
      const buffer = await imageBuffer(url);
      const metadata = await sharp(buffer).metadata();
      const hash = await perceptualHash(buffer);
      await db.run(
        `INSERT INTO product_visual_hashes (product_id, variation_id, image_url, perceptual_hash, width, height, file_size)
         VALUES (?, NULL, ?, ?, ?, ?, ?)
         ON CONFLICT (product_id, variation_id, image_url) DO UPDATE SET perceptual_hash=excluded.perceptual_hash, width=excluded.width, height=excluded.height, file_size=excluded.file_size, updated_at=CURRENT_TIMESTAMP`,
        [product.id, url, hash, metadata.width || null, metadata.height || null, buffer.length]
      );
      indexed += 1;
    } catch {
      // Imagens quebradas não interrompem o índice; permanecem disponíveis para correção no estoque.
    }
  }
  return indexed;
}

export async function visualSearch(db, buffer, metadata = {}) {
  const queryHash = await perceptualHash(buffer);
  await indexProductVisualHashes(db);
  const rows = await db.all(`
    SELECT h.perceptual_hash, h.image_url, j.id, j.name, j.sku, j.category, j.color, j.material, j.stone,
      j.quantity, j.sale_value, j.status
    FROM product_visual_hashes h
    JOIN jewelry_inventory j ON j.id=h.product_id
    WHERE j.status != 'arquivado'
  `);
  const terms = [metadata.category, metadata.color, metadata.material, metadata.stone].filter(Boolean).map((value) => String(value).toLowerCase());
  return rows.map((row) => {
    const visual = hashSimilarity(queryHash, row.perceptual_hash);
    const haystack = `${row.category} ${row.color} ${row.material} ${row.stone}`.toLowerCase();
    const metadataScore = terms.length ? terms.filter((term) => haystack.includes(term)).length / terms.length * 100 : visual;
    return { ...row, similarity: Number((visual * 0.85 + metadataScore * 0.15).toFixed(1)) };
  }).sort((a, b) => b.similarity - a.similarity).slice(0, 20);
}
