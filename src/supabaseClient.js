import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

export function productFromSupabase(row = {}) {
  const quantity = Number(row.stock_quantity || 0);
  const minimum = Number(row.min_stock || 0);
  const status = quantity <= 0 ? "esgotado" : quantity <= minimum ? "baixo estoque" : "disponível";
  return {
    id: row.id,
    supabase_source: true,
    supabase_id: row.id,
    name: row.name || "Joia sem nome",
    category: row.category || "",
    subcategory: row.subcategory || "",
    material: row.material || "",
    size: row.size || "",
    thickness: row.thickness || "",
    color: row.color || "",
    sale_value: Number(row.price || 0),
    quantity,
    low_stock_threshold: minimum,
    photo_url: row.image_url || "",
    is_catalog_active: row.is_active === false ? 0 : 1,
    is_featured: row.is_featured ? 1 : 0,
    status,
    created_at: row.created_at,
    variants: [{
      id: `product-${row.id}`,
      sku: row.sku || "",
      variation_name: [row.size, row.thickness].filter(Boolean).join(" · ") || "Variação principal",
      material: row.material || "",
      color: row.color || "",
      size: row.size || "",
      thickness: row.thickness || "",
      sale_value: Number(row.price || 0),
      quantity,
      low_stock_threshold: minimum,
      status,
      is_active: true
    }]
  };
}

export function productToSupabase(item = {}) {
  const variant = Array.isArray(item.variants) ? item.variants[0] || {} : {};
  return {
    name: item.name || "",
    category: item.category || "",
    subcategory: item.subcategory || "",
    material: variant.material || item.material || "",
    size: variant.size || variant.length || variant.diameter || item.size || "",
    thickness: variant.thickness || item.thickness || "",
    color: variant.color || item.color || "",
    price: Number(variant.sale_value || item.sale_value || 0),
    stock_quantity: Array.isArray(item.variants)
      ? item.variants.reduce((sum, entry) => sum + Number(entry.quantity || 0), 0)
      : Number(item.quantity || 0),
    min_stock: Number(variant.low_stock_threshold || item.low_stock_threshold || 0),
    image_url: item.photo_url || item.image_url || "",
    is_active: Boolean(item.is_catalog_active ?? item.is_active ?? true),
    is_featured: Boolean(item.is_featured)
  };
}
