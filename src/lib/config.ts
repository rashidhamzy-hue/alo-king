export const LBP_RATE = 89500;
export const COD_CAP = 150;
export const DELIVERY_FEE = 2;

export const WHATSAPP_NUMBER = "12014835474"; // production number "Kabsi" (+1 201-483-5474; Kapso phone_number_id 1384772384720496, kind: production)
export const WHATSAPP_DISPLAY = "+1 201-483-5474";
export const WHATSAPP_LINK = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent("Hi Alo King")}`;

const env = import.meta.env as Record<string, string | undefined>;
export const SUPABASE_URL = env["VITE_SUPABASE_URL"] || "https://hnjkietmwvkgbyrcnweq.supabase.co";
export const SUPABASE_KEY =
  env["VITE_SUPABASE_PUBLISHABLE_KEY"] || "sb_publishable_xYOtf64oGjVcterTkS_saQ_tHSLthhy";
export const MAPBOX_TOKEN = env["VITE_MAPBOX_TOKEN"] || "";

export const DEMO_CHAT_URL = `${SUPABASE_URL}/functions/v1/demo-chat`;

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
