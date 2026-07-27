import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "../src/database/connection.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.resolve(__dirname, "../src/data/uploads");
const fixSafe = process.argv.includes("--fix-safe");
const report = { mode: fixSafe ? "fix-safe" : "dry-run", tenants: [], totals: {} };
const add = (summary, key, count = 1) => {
  summary[key] = (summary[key] || 0) + count;
  report.totals[key] = (report.totals[key] || 0) + count;
};
const localFile = (url = "") => {
  if (!String(url).startsWith("/uploads/")) return null;
  const resolved = path.resolve(uploadsDir, path.basename(String(url)));
  return resolved.startsWith(`${uploadsDir}${path.sep}`) ? resolved : null;
};
const validUrl = (url = "") => /^\/uploads\/[^/]+$/.test(url) || /^https?:\/\/\S+$/i.test(url);

try {
  const client = await pool.connect();
  try {
    const tenants = await client.query("SELECT id, slug FROM platform.tenants ORDER BY id");
    for (const tenant of tenants.rows) {
      const schema = `tenant_${tenant.id}`;
      const summary = { tenant: tenant.slug, schema };
      await client.query(`SET search_path TO "${schema}", public`);
      const products = await client.query("SELECT id FROM jewelry_inventory");
      const images = await client.query(`
        SELECT pi.*, v.jewelry_id AS variation_product_id
        FROM product_images pi
        LEFT JOIN jewelry_variants v ON v.id = pi.variation_id
        ORDER BY pi.product_id, pi.variation_id NULLS FIRST, pi.sort_order, pi.id
      `);
      const productIds = new Set(products.rows.map((row) => Number(row.id)));
      const groups = new Map();
      const seenUrls = new Set();
      for (const image of images.rows) {
        const group = `${image.product_id}:${image.variation_id || "product"}`;
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group).push(image);
        if (!productIds.has(Number(image.product_id))) add(summary, "orphan_images");
        if (image.variation_id && Number(image.variation_product_id) !== Number(image.product_id)) {
          add(summary, "incorrect_links");
          if (fixSafe) await client.query("DELETE FROM product_images WHERE id = $1", [image.id]);
        }
        if (!validUrl(image.image_url)) add(summary, "invalid_urls");
        const file = localFile(image.image_url);
        if (file && !fs.existsSync(file)) add(summary, "missing_files");
        const duplicateKey = `${group}:${image.image_url}`;
        if (seenUrls.has(duplicateKey)) {
          add(summary, "duplicate_images");
          if (fixSafe) await client.query("DELETE FROM product_images WHERE id = $1", [image.id]);
        } else seenUrls.add(duplicateKey);
      }
      for (const rows of groups.values()) {
        const primaries = rows.filter((row) => Number(row.is_primary) === 1);
        if (primaries.length > 1) {
          add(summary, "duplicate_primaries", primaries.length - 1);
          if (fixSafe) {
            const keep = primaries.sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)[0].id;
            await client.query("UPDATE product_images SET is_primary = CASE WHEN id = $1 THEN 1 ELSE 0 END WHERE product_id = $2 AND variation_id IS NOT DISTINCT FROM $3", [keep, rows[0].product_id, rows[0].variation_id]);
          }
        }
      }
      const withoutImages = await client.query(`
        SELECT COUNT(*)::int AS total FROM jewelry_inventory j
        WHERE NOT EXISTS (SELECT 1 FROM product_images pi WHERE pi.product_id = j.id)
          AND COALESCE(NULLIF(j.image_url, ''), NULLIF(j.photo_url, '')) IS NULL
      `);
      add(summary, "products_without_images", withoutImages.rows[0].total);
      report.tenants.push(summary);
    }
  } finally {
    await client.query("SET search_path TO public").catch(() => {});
    client.release();
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  await pool.end();
}
