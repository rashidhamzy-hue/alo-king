import { LBP_RATE, WHATSAPP_NUMBER } from "./config";

/** Returns null for placeholder values like "0.0", "", "null". */
export const clean = (s: string | null | undefined): string | null => {
  const t = (s ?? "").toString().trim();
  return !t || /^0(\.0+)?$/.test(t) || t.toLowerCase() === "null" ? null : t;
};

export type ExploreRow = {
  vendor_id: string;
  slug: string;
  name_en: string | null;
  name_ar: string | null;
  category: string | null;
  village: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  claimed: boolean;
  open_now: boolean | null;
  menu_count: number | null;
  price_tier: number | null;
  cuisine_tags: string[] | null;
  logo_url: string | null;
  cover_url: string | null;
  tagline_en: string | null;
  tagline_ar: string | null;
  matched_items: string[] | null;
  total_count: number;
};

export type Hours = Partial<Record<DayKey, [string, string][]>>;
export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export const DAYS: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export const DAY_LABEL: Record<DayKey, [string, string]> = {
  mon: ["Monday", "الإثنين"],
  tue: ["Tuesday", "الثلاثاء"],
  wed: ["Wednesday", "الأربعاء"],
  thu: ["Thursday", "الخميس"],
  fri: ["Friday", "الجمعة"],
  sat: ["Saturday", "السبت"],
  sun: ["Sunday", "الأحد"],
};

export type VendorProfile = {
  vendor_id: string;
  claimed_at?: string | null;
  tagline_en?: string | null;
  tagline_ar?: string | null;
  description_en?: string | null;
  description_ar?: string | null;
  story?: string | null;
  cuisine_tags?: string[] | null;
  features?: string[] | null;
  price_tier?: number | null;
  established_year?: number | null;
  opened_on?: string | null;
  logo_url?: string | null;
  cover_url?: string | null;
  gallery_urls?: string[] | null;
  public_phone?: string | null;
  whatsapp_orders_number?: string | null;
  instagram_url?: string | null;
  facebook_url?: string | null;
  tiktok_url?: string | null;
  website_url?: string | null;
  google_maps_url?: string | null;
  hours?: Hours | null;
  closed_dates?: { from: string; to: string; note?: string }[] | null;
  accepts_orders?: boolean | null;
  paused_until?: string | null;
  prep_time_min?: number | null;
  prep_time_max?: number | null;
  delivery_villages?: string[] | null;
  delivery_radius_km?: number | null;
  min_order_usd?: number | null;
  accepts_usd?: boolean | null;
  accepts_lbp?: boolean | null;
  halal_certified?: boolean | null;
  allergen_policy?: string | null;
  kitchen_notes?: string | null;
  languages?: string[] | null;
  faqs?: { q: string; a: string }[] | null;
  ai_instructions?: string | null;
};

export type VendorPrivate = {
  vendor_id: string;
  owner_name?: string | null;
  owner_phone_urgent?: string | null;
  backup_phone?: string | null;
  owner_email?: string | null;
  order_alert_whatsapp?: string | null;
  notes_for_team?: string | null;
};

export type Customization = {
  name: string;
  required: boolean;
  min: number;
  max: number;
  options: { name: string; price_delta_usd: number }[];
};

export type MenuItem = {
  item_id: string;
  vendor_id: string;
  item_name_en: string | null;
  item_name_ar: string | null;
  section: string | null;
  price_usd: number | null;
  price_value?: number | null;
  price_currency?: string | null;
  available: boolean | null;
  serves?: number | null;
  description_en?: string | null;
  description_ar?: string | null;
  ingredients?: string[] | null;
  image_url?: string | null;
  portion_grams?: number | null;
  allergen_list?: string[] | null;
  allergens_reviewed?: boolean | null;
  is_vegan?: boolean | null;
  is_vegetarian?: boolean | null;
  is_gluten_free?: boolean | null;
  is_dairy_free?: boolean | null;
  is_keto?: boolean | null;
  is_halal?: boolean | null;
  contains_alcohol?: boolean | null;
  contains_pork?: boolean | null;
  spice_level?: number | null;
  prep_time_min?: number | null;
  cooking_method?: string | null;
  calories?: number | null;
  protein_grams?: number | null;
  carbs_grams?: number | null;
  fat_grams?: number | null;
  sugar_grams?: number | null;
  fiber_g?: number | null;
  saturated_fat_g?: number | null;
  sodium_mg?: number | null;
  customizations?: Customization[] | null;
  tags?: string[] | null;
  is_popular?: boolean | null;
  is_chef_pick?: boolean | null;
  sort_order?: number | null;
  ai_notes?: string | null;
  nutrition_source?: string | null;
  nutrition_confidence?: string | null;
  nutrition_verified?: boolean | null;
};

export type VendorPage = {
  vendor: {
    vendor_id: string;
    slug: string;
    name_en: string | null;
    name_ar: string | null;
    category_canonical: string | null;
    village_canonical: string | null;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
  };
  profile: VendorProfile | null;
  claimed: boolean;
  open_now: boolean | null;
};

export const vendorName = (v: { name_en: string | null; name_ar: string | null }) =>
  clean(v.name_en) || clean(v.name_ar) || "Unnamed";

export const priceTier = (n: number | null | undefined) =>
  n && n > 0 ? "$".repeat(Math.min(4, n)) : null;

export const waLink = (text: string, number = WHATSAPP_NUMBER) =>
  `https://wa.me/${number.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;

export const mapsLink = (lat: number | null | undefined, lng: number | null | undefined) =>
  lat != null && lng != null
    ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
    : null;

export const toLbp = (usd: number) => Math.round(usd * LBP_RATE);

/** Category -> gradient classes for card/hero fallbacks (uses theme tokens). */
export function categoryGradient(cat: string | null | undefined) {
  const c = (cat ?? "").toLowerCase();
  if (c.includes("caf")) return "from-gold/30 via-card to-background";
  if (c.includes("bak")) return "from-warning/30 via-card to-background";
  if (c.includes("groc") || c.includes("market")) return "from-success/25 via-card to-background";
  if (c.includes("sweet") || c.includes("dessert"))
    return "from-destructive/25 via-card to-background";
  return "from-emerald/60 via-card to-background";
}

/** Current day key and HH:MM in Asia/Beirut. */
export function beirutNow(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Beirut",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const wd = (parts.find((p) => p.type === "weekday")?.value ?? "Mon")
    .slice(0, 3)
    .toLowerCase() as DayKey;
  const h = parts.find((p) => p.type === "hour")?.value ?? "00";
  const m = parts.find((p) => p.type === "minute")?.value ?? "00";
  return { day: wd, time: `${h === "24" ? "00" : h}:${m}` };
}

export function openFromHours(hours: Hours | null | undefined): boolean | null {
  if (!hours || !Object.keys(hours).length) return null;
  const { day, time } = beirutNow();
  const idx = DAYS.indexOf(day);
  const prev = DAYS[(idx + 6) % 7]!;
  for (const [a, b] of hours[day] ?? []) {
    if (b > a ? time >= a && time < b : time >= a) return true;
  }
  for (const [a, b] of hours[prev] ?? []) {
    if (b <= a && time < b) return true;
  }
  return false;
}

export const ALLERGEN_LABEL: Record<string, [string, string]> = {
  gluten: ["Gluten", "غلوتين"],
  crustaceans: ["Crustaceans", "قشريات"],
  eggs: ["Eggs", "بيض"],
  fish: ["Fish", "سمك"],
  peanuts: ["Peanuts", "فول سوداني"],
  soy: ["Soy", "صويا"],
  milk: ["Milk", "حليب"],
  tree_nuts: ["Tree nuts", "مكسرات"],
  celery: ["Celery", "كرفس"],
  mustard: ["Mustard", "خردل"],
  sesame: ["Sesame", "سمسم"],
  sulphites: ["Sulphites", "كبريتات"],
  lupin: ["Lupin", "ترمس"],
  molluscs: ["Molluscs", "رخويات"],
};

export const FEATURES: { key: string; en: string; ar: string }[] = [
  { key: "dine_in", en: "Dine-in", ar: "جلوس داخلي" },
  { key: "takeaway", en: "Takeaway", ar: "سفري" },
  { key: "outdoor_seating", en: "Outdoor seating", ar: "جلسات خارجية" },
  { key: "parking", en: "Parking", ar: "موقف سيارات" },
  { key: "wifi", en: "Wi-Fi", ar: "واي فاي" },
  { key: "kids_friendly", en: "Kids friendly", ar: "مناسب للأطفال" },
  { key: "family_section", en: "Family section", ar: "قسم عائلي" },
  { key: "catering", en: "Catering", ar: "تموين" },
  { key: "live_music", en: "Live music", ar: "موسيقى حية" },
];

export const uuid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
