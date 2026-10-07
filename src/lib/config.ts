export const LBP_RATE = 89500;
export const COD_CAP = 150;
export const DELIVERY_FEE = 2;

const env = import.meta.env as Record<string, string | undefined>;

// Alo King's own customer number (Kapso project "Alo King"). Unset until the number is connected;
// the old +1 201 number belongs to Kabsi, a separate business, and is never used (DECISIONS §2).
export const WHATSAPP_NUMBER = (env["VITE_WHATSAPP_NUMBER"] || "").replace(/\D/g, "");
export const WHATSAPP_DISPLAY = WHATSAPP_NUMBER ? `+${WHATSAPP_NUMBER}` : "";
export const WHATSAPP_LINK = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent("Hi Alo King")}`;

// alo-king-staging (Frankfurt). Public values: the URL and the publishable key are safe in the browser.
// Vercel's Supabase integration provides SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY; vite.config.ts maps them.
export const SUPABASE_URL = env["VITE_SUPABASE_URL"] || "https://tzugbbatfbvrfzxuacqx.supabase.co";
export const SUPABASE_KEY =
  env["VITE_SUPABASE_PUBLISHABLE_KEY"] || "sb_publishable_yTJpOCEOQ6PyqTgyJLKuGg_Sy3gpGi6";

export const VENDOR_COLUMNS =
  "vendor_id,slug,name_en,name_ar,category_canonical,village_canonical,address,latitude,longitude,open_days,open_time,close_time,menu_available,is_live,is_active";

export const ALLERGENS = [
  "gluten",
  "crustaceans",
  "eggs",
  "fish",
  "peanuts",
  "soy",
  "milk",
  "tree_nuts",
  "celery",
  "mustard",
  "sesame",
  "sulphites",
  "lupin",
  "molluscs",
] as const;
export const MEDIA_BUCKET = "vendor-media";
