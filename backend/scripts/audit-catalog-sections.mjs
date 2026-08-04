import { pool } from "../src/database/connection.js";

const tenantArg = process.argv.find((arg) => arg.startsWith("--tenant="))?.split("=").slice(1).join("=").trim();
const fixSafe = process.argv.includes("--fix-safe");
const dryRun = process.argv.includes("--dry-run") || !fixSafe;
const text = (value) => Boolean(String(value || "").trim());
const contentFields = ["title", "subtitle", "media_url", "button_text", "button_link", "body_text"];
const contentDependentTypes = new Set(["custom_content", "location", "instagram", "banner", "video", "iframe", "contact"]);

if (!tenantArg) {
  console.error("Uso: npm run audit:catalog-sections -- --tenant=aura-clinic --dry-run|--fix-safe");
  process.exitCode = 1;
} else {
  const report = { tenant: tenantArg, mode: dryRun ? "dry-run" : "fix-safe", settings: {}, sections: [], changes: [] };
  const client = await pool.connect();
  try {
    const tenantResult = await client.query("SELECT id, slug FROM platform.tenants WHERE slug = $1", [tenantArg]);
    const tenant = tenantResult.rows[0];
    if (!tenant) throw new Error(`Tenant não encontrado: ${tenantArg}`);
    await client.query(`SET search_path TO "tenant_${Number(tenant.id)}", public`);

    const settings = await client.query(`SELECT key, value FROM catalog_settings WHERE key IN
      ('footer_enabled','footer_logo_url','footer_logo_max_width','footer_logo_max_height','footer_background_color',
       'footer_spacing','whatsapp_phone','company_instagram','company_email','company_hours','company_address') ORDER BY key`);
    report.settings = Object.fromEntries(settings.rows.map(({ key, value }) => [key, value]));

    const sections = await client.query(`SELECT s.*, l.status AS layout_status
      FROM catalog_sections s JOIN catalog_layouts l ON l.id = s.layout_id
      ORDER BY l.status, s.sort_order, s.id`);
    for (const section of sections.rows) {
      const empty = contentDependentTypes.has(section.section_type)
        && !contentFields.some((field) => text(section[field]));
      const invalidHeight = text(section.height) && (!Number.isFinite(Number(section.height)) || Number(section.height) < 0);
      const excessiveEmptyHeight = empty && Number(section.height || 0) > 200;
      const finding = {
        id: section.id,
        layout: section.layout_status,
        type: section.section_type,
        active: Boolean(Number(section.is_active)),
        order: section.sort_order,
        background: section.background || "",
        height: section.height,
        spacing: section.spacing,
        empty,
        invalid_height: invalidHeight,
        excessive_empty_height: excessiveEmptyHeight
      };
      report.sections.push(finding);
      if (fixSafe && (invalidHeight || excessiveEmptyHeight)) {
        await client.query("UPDATE catalog_sections SET height = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1", [section.id]);
        report.changes.push({ id: section.id, action: "clear_invalid_height" });
      }
      if (fixSafe && empty && Boolean(Number(section.is_active))) {
        await client.query("UPDATE catalog_sections SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = $1", [section.id]);
        report.changes.push({ id: section.id, action: "disable_empty_section" });
      }
    }
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await client.query("SET search_path TO public").catch(() => {});
    client.release();
    await pool.end();
  }
}
