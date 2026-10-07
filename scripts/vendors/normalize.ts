// Vendor seed normaliser (DECISIONS §15.2, §17). Turns the vendor file
// (alo_king_master_lebanon_vendors_cleaned.csv) into import rows and an exclusion list:
// - ratings and review counts are dropped, `phone_raw` and `is_whatsapp_candidate` are dropped;
// - names are split into Arabic, English and branch label;
// - the business type and cuisine tags come from Google's primary type, the import category and the name;
// - fuel stations, industry, hotels, coworking spaces and NGOs are excluded with a reason;
// - phones are normalised to E.164 and classed mobile or landline; a number shared by unrelated
//   businesses is a data error and is dropped from all of them (they claim with documents, §18.1 C);
// - links are classified (website, Instagram, Facebook, menu) and start unchecked;
// - chains get one brand (same normalised name or same website domain).
// Pure functions; the CLI at the bottom writes CSVs for scripts/load-seed.sh.

export type RawVendor = Record<string, string>;

export type BusinessType =
  | "restaurant"
  | "fast_food"
  | "cafe"
  | "bakery_manakish"
  | "sweets_pastry"
  | "ice_cream"
  | "grocery_supermarket"
  | "minimarket"
  | "butcher"
  | "poultry"
  | "fish_market"
  | "produce"
  | "roastery_nuts"
  | "home_essentials"
  | "other_food";

export type LinkKind = "website" | "instagram" | "facebook" | "menu";
export type Link = { kind: LinkKind; url: string; status: "unchecked" | "unsafe" };

export type VendorRow = {
  place_id: string;
  slug: string;
  name_ar: string | null;
  name_en: string | null;
  branch_label: string | null;
  business_type: BusinessType;
  cuisine_tags: string[];
  lat: number | null;
  lon: number | null;
  phone_seed: string | null;
  phone_seed_mobile: boolean | null;
  address_seed: string | null;
  brand_slug: string | null;
  brand_name_en: string | null;
  brand_name_ar: string | null;
  links: Link[];
  import_labels: Record<string, string>;
};

export type Exclusion = { place_id: string; name: string; reason: string };

// --- CSV ---------------------------------------------------------------------------------------------
export function parseCsv(text: string): RawVendor[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    if (row.some((f) => f !== "")) rows.push(row);
  }
  const [header, ...body] = rows;
  if (!header) return [];
  const keys = header.map((h) => h.trim().toLowerCase());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}

export function toCsv(
  header: string[],
  rows: (string | number | boolean | null | undefined)[][],
): string {
  const esc = (v: string | number | boolean | null | undefined) => {
    if (v === null || v === undefined) return "";
    const t = String(v);
    return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return [header, ...rows].map((r) => r.map(esc).join(",")).join("\n") + "\n";
}

// --- Names ---------------------------------------------------------------------------------------------
const ARABIC = /[؀-ۿ]/;
const LATIN = /[A-Za-zÀ-ɏ]/;

export function splitName(raw: string): {
  name_ar: string | null;
  name_en: string | null;
  branch_label: string | null;
} {
  let name = raw.replace(/\s+/g, " ").trim();
  let branch: string | null = null;
  // "Name (Branch)" at the end.
  const paren = name.match(/^(.*\S)\s*\(([^()]{2,40})\)$/);
  if (paren) {
    name = paren[1];
    branch = paren[2].trim();
  }
  const parts = name
    .split(/\s+[-–—|]\s+|\s*\|\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  let ar: string | null = null;
  let en: string | null = null;
  const rest: string[] = [];
  for (const p of parts) {
    if (ARABIC.test(p) && !LATIN.test(p) && ar === null) ar = p;
    else if (LATIN.test(p) && !ARABIC.test(p) && en === null) en = p;
    else rest.push(p);
  }
  if (ar === null && en === null && parts.length) {
    // Mixed script in one part: keep it as the name in the script that dominates.
    const p = parts[0];
    const arCount = (p.match(/[؀-ۿ]/g) ?? []).length;
    if (arCount * 2 >= p.replace(/\s/g, "").length) ar = p;
    else en = p;
    rest.splice(rest.indexOf(p), 1);
  }
  // The last remaining short part is a branch ("Wooden Bakery - Hazmieh").
  if (!branch && rest.length) {
    const last = rest[rest.length - 1];
    if (last.split(" ").length <= 4) branch = last.replace(/^(branch|فرع)\s+/i, "");
  }
  return { name_ar: ar, name_en: en, branch_label: branch };
}

// Words that name a kind of shop, not a business: never enough to call two listings one business.
const GENERIC_WORDS = new Set(
  "al el the la le les de du and cafe coffee shop restaurant resto ice cream meat grill bakery furn sweets market mini minimarket supermarket store water gaz gas co company branch مطعم ملحمه فرن حلويات سوبرماركت ميني ماركت محل مقهى قهوه مؤسسه شركه".split(
    " ",
  ),
);

/** Distinctive words of a vendor's names (both scripts), Arabic article stripped. */
function nameWords(v: { name_en: string | null; name_ar: string | null }): Set<string> {
  const words = normName(`${v.name_en ?? ""} ${v.name_ar ?? ""}`)
    .split(/[^\p{L}\p{N}]+/u)
    .map((w) => w.replace(/^ال(?=.{3})/, ""))
    .filter((w) => w.length >= 3 && !GENERIC_WORDS.has(w));
  return new Set(words);
}

/** The leading words every English name shares ("Lakkis Farm" from "Lakkis Farm - Zahle"), if any. */
function commonName(names: (string | null)[]): string | null {
  const lists = names.filter((n): n is string => !!n).map((n) => n.split(/\s+/));
  if (lists.length < 2) return null;
  const out: string[] = [];
  for (let i = 0; lists.every((l) => i < l.length && normName(l[i]) === normName(lists[0][i])); i++)
    out.push(lists[0][i]);
  const name = out.join(" ").replace(/[\s\-–|/,]+$/, "");
  return normName(name).replace(/[^\p{L}\p{N}]/gu, "").length >= 3 ? name : null;
}

export function normName(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[ً-ْـ]/g, "")
    .replace(/\b(the|el|al|le|la|les)\b/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

// --- Categories (§17) ----------------------------------------------------------------------------------
type Rule = { type?: BusinessType; tags?: string[]; exclude?: string };

const GOOGLE_TYPES: Record<string, Rule> = {
  restaurant: { type: "restaurant" },
  meal_takeaway: { type: "restaurant" },
  meal_delivery: { type: "restaurant" },
  food: { type: "restaurant" },
  lebanese_restaurant: { type: "restaurant", tags: ["lebanese"] },
  middle_eastern_restaurant: { type: "restaurant", tags: ["lebanese"] },
  mediterranean_restaurant: { type: "restaurant", tags: ["mezze"] },
  turkish_restaurant: { type: "restaurant", tags: ["grills_mashawi"] },
  greek_restaurant: { type: "restaurant" },
  barbecue_restaurant: { type: "restaurant", tags: ["grills_mashawi"] },
  steak_house: { type: "restaurant", tags: ["grills_mashawi"] },
  fast_food_restaurant: { type: "fast_food" },
  hamburger_restaurant: { type: "fast_food", tags: ["burgers"] },
  sandwich_shop: { type: "fast_food", tags: ["sandwiches"] },
  pizza_restaurant: { type: "restaurant", tags: ["pizza"] },
  italian_restaurant: { type: "restaurant", tags: ["italian"] },
  sushi_restaurant: { type: "restaurant", tags: ["sushi_japanese"] },
  japanese_restaurant: { type: "restaurant", tags: ["sushi_japanese"] },
  ramen_restaurant: { type: "restaurant", tags: ["asian"] },
  chinese_restaurant: { type: "restaurant", tags: ["chinese"] },
  asian_restaurant: { type: "restaurant", tags: ["asian"] },
  thai_restaurant: { type: "restaurant", tags: ["asian"] },
  korean_restaurant: { type: "restaurant", tags: ["asian"] },
  indian_restaurant: { type: "restaurant", tags: ["asian"] },
  seafood_restaurant: { type: "restaurant", tags: ["seafood"] },
  breakfast_restaurant: { type: "restaurant", tags: ["breakfast"] },
  brunch_restaurant: { type: "restaurant", tags: ["brunch"] },
  vegan_restaurant: { type: "restaurant", tags: ["vegan"] },
  vegetarian_restaurant: { type: "restaurant", tags: ["healthy_salads"] },
  american_restaurant: { type: "restaurant", tags: ["burgers"] },
  french_restaurant: { type: "restaurant" },
  mexican_restaurant: { type: "restaurant" },
  cafe: { type: "cafe" },
  coffee_shop: { type: "cafe", tags: ["specialty_coffee"] },
  cafeteria: { type: "cafe" },
  tea_house: { type: "cafe" },
  juice_shop: { type: "cafe", tags: ["fresh_juices"] },
  bakery: { type: "bakery_manakish" },
  bagel_shop: { type: "bakery_manakish" },
  donut_shop: { type: "sweets_pastry" },
  dessert_shop: { type: "sweets_pastry" },
  dessert_restaurant: { type: "sweets_pastry" },
  confectionery: { type: "sweets_pastry" },
  candy_store: { type: "sweets_pastry" },
  chocolate_shop: { type: "sweets_pastry" },
  pastry_shop: { type: "sweets_pastry" },
  ice_cream_shop: { type: "ice_cream", tags: ["booza_ice_cream"] },
  coffee_roastery: { type: "roastery_nuts" },
  supermarket: { type: "grocery_supermarket" },
  grocery_store: { type: "grocery_supermarket" },
  food_store: { type: "grocery_supermarket" },
  hypermarket: { type: "grocery_supermarket" },
  convenience_store: { type: "minimarket" },
  liquor_store: { type: "minimarket" },
  butcher_shop: { type: "butcher" },
  market: { type: "produce" },
  // Excluded (§15.2).
  gas_station: { exclude: "fuel station" },
  lodging: { exclude: "hotel or guesthouse" },
  hotel: { exclude: "hotel or guesthouse" },
  resort_hotel: { exclude: "hotel or guesthouse" },
  guest_house: { exclude: "hotel or guesthouse" },
  bed_and_breakfast: { exclude: "hotel or guesthouse" },
  motel: { exclude: "hotel or guesthouse" },
  hostel: { exclude: "hotel or guesthouse" },
  beach: { exclude: "beach club" },
  coworking_space: { exclude: "coworking space" },
  non_profit_organization: { exclude: "NGO" },
  manufacturer: { exclude: "industrial or engineering firm" },
  corporate_office: { exclude: "industrial or engineering firm" },
  bar: { exclude: "bar (not a food vendor)" },
  night_club: { exclude: "bar (not a food vendor)" },
  wine_bar: { exclude: "bar (not a food vendor)" },
};

// Name and category keywords, Arabic and Latin. Order matters for the type: first match wins.
const KEYWORDS: { re: RegExp; rule: Rule }[] = [
  {
    re: /\b(total ?energies|totalenergies|medco|coral|hypco|wardieh|ipt|uniterminals)\b|محطة|station service/i,
    rule: { exclude: "fuel station" },
  },
  {
    re: /\b(hotel|h[oô]tel|guest ?house|motel|hostel|resort)\b|فندق|(?<![\p{L}])نزل(?![\p{L}])/iu,
    rule: { exclude: "hotel or guesthouse" },
  },
  { re: /\bbeach( club)?\b|بلاج/i, rule: { exclude: "beach club" } },
  { re: /\bco-?working\b/i, rule: { exclude: "coworking space" } },
  { re: /\b(ngo|association|foundation|charity)\b|جمعية/i, rule: { exclude: "NGO" } },
  {
    re: /\b(engineering|industr(y|ies|ial)|sofregaz|contracting|factory)\b|هندسة|مصنع/i,
    rule: { exclude: "industrial or engineering firm" },
  },
  {
    re: /\b(water|eau|mineral)\b.*\b(delivery|distribution)\b|مياه|\bgas\b|غاز|\blpg\b|قناني/i,
    rule: { type: "home_essentials" },
  },
  { re: /\b(butcher|boucherie|meat)\b|ملحمة|لحوم|لحام/i, rule: { type: "butcher" } },
  { re: /\b(poultry|volaille)\b|دواجن|فروج|فراريج/i, rule: { type: "poultry" } },
  {
    re: /\b(fish ?market|poissonnerie)\b|pescheria|مسمكة|اسماك/i,
    rule: { type: "fish_market", tags: ["seafood"] },
  },
  {
    re: /\b(fruits?|vegetables?|l[ée]gumes|produce)\b|خضار|خضرة|فواكه/i,
    rule: { type: "produce" },
  },
  {
    re: /\b(roaster[ys]?|roastery|nuts?|torr[ée]faction)\b|محمص|مكسرات/i,
    rule: { type: "roastery_nuts" },
  },
  {
    re: /\b(ice ?cream|gelato|glacier|booza)\b|بوظة|بوظه|ايس كريم/i,
    rule: { type: "ice_cream", tags: ["booza_ice_cream"] },
  },
  {
    re: /\b(sweets?|patisserie|p[aâ]tisserie|knefe|kunafa|kanafeh|baklava|maamoul)\b|حلويات|حلو|كنافة|كنافه/i,
    rule: { type: "sweets_pastry", tags: ["lebanese_sweets"] },
  },
  {
    re: /\b(cakes?|g[aâ]teaux?|cupcakes?)\b|قوالب/i,
    rule: { type: "sweets_pastry", tags: ["cakes"] },
  },
  {
    re: /\b(manakish|manakeesh|man'?oushe|mankoushe|furn|forn|bakery|boulangerie)\b|مناقيش|منقوشة|فرن|افران/i,
    rule: { type: "bakery_manakish", tags: ["manakish"] },
  },
  {
    re: /\b(supermarket|hypermarket|march[ée])\b|سوبرماركت|سوبر ماركت/i,
    rule: { type: "grocery_supermarket" },
  },
  {
    re: /\b(mini ?market|grocery|[ée]picerie|dekkene|dikkene)\b|دكان|ميني ماركت/i,
    rule: { type: "minimarket" },
  },
  { re: /\b(shawarma|shawerma)\b|شاورما/i, rule: { tags: ["shawarma"] } },
  { re: /\bfalafel\b|فلافل/i, rule: { tags: ["falafel"] } },
  { re: /\bsaj\b|صاج/i, rule: { tags: ["saj"] } },
  { re: /\bka'?ak\b|كعك/i, rule: { tags: ["kaak"] } },
  { re: /\bbroasted\b|بروستد/i, rule: { type: "fast_food", tags: ["broasted_chicken"] } },
  { re: /\bburgers?\b|برغر/i, rule: { tags: ["burgers"] } },
  { re: /\bpizz(a|eria)\b|بيتزا/i, rule: { tags: ["pizza"] } },
  { re: /\bsushi\b|سوشي/i, rule: { tags: ["sushi_japanese"] } },
  {
    re: /\b(grill|grills|mashawi|barbecue|bbq)\b|مشاوي|مشويات/i,
    rule: { tags: ["grills_mashawi"] },
  },
  { re: /\bmezze\b|مازة|مازه/i, rule: { tags: ["mezze"] } },
  { re: /\barmenian\b|ارمني/i, rule: { tags: ["armenian"] } },
  { re: /\b(halab|aleppo|syrian)\b|حلبي|سوري/i, rule: { tags: ["syrian_aleppan"] } },
  { re: /\b(crepes?|cr[eê]pe|waffles?)\b|كريب|وافل/i, rule: { tags: ["crepes_waffles"] } },
  { re: /\b(juice|juices|jus)\b|عصير|كوكتيل/i, rule: { tags: ["fresh_juices"] } },
  { re: /\b(sandwich(es)?|snack)\b|سناك|سندويش/i, rule: { tags: ["sandwiches"] } },
  { re: /\b(salad|healthy)\b|سلطات/i, rule: { tags: ["healthy_salads"] } },
  { re: /\bbreakfast\b|فطور|ترويقة/i, rule: { tags: ["breakfast"] } },
  { re: /\b(coffee|caf[eé]|espresso)\b|قهوة|كافيه/i, rule: { type: "cafe" } },
  { re: /\b(sea ?food|fish)\b|سمك|اسماك/i, rule: { tags: ["seafood"] } },
  { re: /\b(lebanese|libanais)\b|لبناني/i, rule: { tags: ["lebanese"] } },
  { re: /\b(restaurant|resto|mat3am)\b|مطعم/i, rule: { type: "restaurant" } },
  // The file's "essentials" label is the water and gas-cylinder list (§15.2): last, so a food keyword
  // in the name still wins.
  { re: /\bessentials\b/i, rule: { type: "home_essentials" } },
];

export function classify(
  googleType: string,
  category: string,
  name: string,
): { business_type: BusinessType; cuisine_tags: string[] } | { exclude: string } {
  const g = GOOGLE_TYPES[googleType.trim().toLowerCase()];
  const text = `${name} ${category.replace(/_/g, " ")}`;
  const kw = KEYWORDS.filter((k) => k.re.test(text)).map((k) => k.rule);
  const firstExclusion = [g?.exclude, ...kw.map((r) => r.exclude)].find(Boolean);
  // A Google food type outweighs an exclusion keyword in the name ("Hotel Dieu Bakery" stays a bakery),
  // except a fuel station, which is never imported.
  // Water and gas companies Google files as manufacturers or offices are kept as home essentials
  // (§15.2); an exclusion from the name (Sofregaz, a fuel station) still applies.
  const essentials = kw.some((r) => r.type === "home_essentials");
  const nameExclusion = kw.map((r) => r.exclude).find(Boolean);
  if (firstExclusion && (!g?.type || firstExclusion === "fuel station")) {
    if (!essentials || nameExclusion || firstExclusion === "fuel station")
      return { exclude: firstExclusion };
  }
  // Type: a specific keyword (butcher, sweets, bakery...) beats a generic Google type; Google beats a
  // generic keyword (restaurant, cafe).
  const generic = new Set<BusinessType>([
    "restaurant",
    "fast_food",
    "cafe",
    "grocery_supermarket",
    "other_food",
  ]);
  const kwType = kw.find((r) => r.type)?.type;
  let type: BusinessType =
    kwType && (!g?.type || (generic.has(g.type) && !generic.has(kwType)))
      ? kwType
      : (g?.type ?? kwType ?? "other_food");
  if (type === "restaurant" && kw.some((r) => r.tags?.includes("broasted_chicken")))
    type = "fast_food";
  const tags = new Set<string>([...(g?.tags ?? []), ...kw.flatMap((r) => r.tags ?? [])]);
  // Shop types do not carry dish tags.
  if (
    [
      "grocery_supermarket",
      "minimarket",
      "butcher",
      "poultry",
      "produce",
      "roastery_nuts",
      "home_essentials",
    ].includes(type)
  ) {
    tags.clear();
  }
  return { business_type: type, cuisine_tags: [...tags].sort() };
}

// --- Phones -------------------------------------------------------------------------------------------
export function normalizePhone(raw: string): { e164: string; mobile: boolean } | null {
  let d = raw.replace(/[^\d+]/g, "");
  if (!d) return null;
  if (d.startsWith("00")) d = "+" + d.slice(2);
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("961")) {
    // already national with country code
  } else if (d.startsWith("0")) d = "961" + d.slice(1);
  else d = "961" + d;
  if (!d.startsWith("961")) {
    return /^[1-9]\d{6,14}$/.test(d) ? { e164: "+" + d, mobile: false } : null;
  }
  const nat = d.slice(3).replace(/^0/, "");
  // Mobile: 3 + 6 digits, or 70/71/76/78/79/81 + 6 digits (§15.2). Landline: 1, 4-9 + 6 digits.
  if (/^3\d{6}$/.test(nat) || /^(70|71|76|78|79|81)\d{6}$/.test(nat))
    return { e164: "+961" + nat, mobile: true };
  if (/^[1-9]\d{6}$/.test(nat)) return { e164: "+961" + nat, mobile: false };
  return null;
}

// --- Links --------------------------------------------------------------------------------------------
// Known unsafe or hijacked domains (§15.3): never stored as a usable link.
export const UNSAFE_DOMAINS = new Set(["gialacucinadamore.com"]);

export function classifyLink(raw: string): Link | null {
  const t = raw.trim();
  if (!t) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol) || !url.hostname.includes(".")) return null;
  url.protocol = "https:";
  const host = url.hostname.replace(/^(www|m|web)\./, "").toLowerCase();
  const clean = url.toString();
  if (UNSAFE_DOMAINS.has(host)) return { kind: "website", url: clean, status: "unsafe" };
  if (host === "instagram.com" || host === "instagr.am")
    return { kind: "instagram", url: clean, status: "unchecked" };
  if (host === "facebook.com" || host === "fb.com" || host === "fb.me")
    return { kind: "facebook", url: clean, status: "unchecked" };
  if (/menu|qr|linktr\.ee|bento\.me/i.test(host + url.pathname))
    return { kind: "menu", url: clean, status: "unchecked" };
  return { kind: "website", url: clean, status: "unchecked" };
}

function siteDomain(links: Link[]): string | null {
  const w = links.find((l) => l.kind === "website" && l.status !== "unsafe");
  if (!w) return null;
  return new URL(w.url).hostname.replace(/^(www|m|web)\./, "").toLowerCase();
}

// --- Whole file -----------------------------------------------------------------------------------------
export type NormalizeResult = {
  vendors: VendorRow[];
  exclusions: Exclusion[];
  phoneIssues: { phone: string; place_ids: string[]; resolution: string }[];
};

export function normalizeVendors(rows: RawVendor[]): NormalizeResult {
  const vendors: VendorRow[] = [];
  const exclusions: Exclusion[] = [];
  const seen = new Set<string>();

  for (const r of rows) {
    const placeId = (r.place_id ?? "").trim();
    const rawName = (r.name ?? "").trim();
    if (!placeId) {
      exclusions.push({ place_id: "", name: rawName, reason: "no place_id" });
      continue;
    }
    if (seen.has(placeId)) {
      exclusions.push({ place_id: placeId, name: rawName, reason: "duplicate place_id" });
      continue;
    }
    seen.add(placeId);
    const names = splitName(rawName);
    if (!names.name_ar && !names.name_en) {
      exclusions.push({ place_id: placeId, name: rawName, reason: "no name" });
      continue;
    }
    const cls = classify(r.google_primary_type ?? "", r.alo_king_category ?? "", rawName);
    if ("exclude" in cls) {
      exclusions.push({ place_id: placeId, name: rawName, reason: cls.exclude });
      continue;
    }
    const lat = Number.parseFloat(r.latitude ?? "");
    const lon = Number.parseFloat(r.longitude ?? "");
    const inLebanon = lat >= 32.9 && lat <= 34.8 && lon >= 34.9 && lon <= 36.8;
    const phone = normalizePhone(r.phone_e164 || r.phone_raw || "");
    const links = (r.website_or_menu_link ?? "")
      .split(/[\s;,]+/)
      .map(classifyLink)
      .filter((l): l is Link => l !== null);
    const labels: Record<string, string> = {};
    for (const k of ["alo_king_category", "google_primary_type", "region_code"])
      if (r[k]) labels[k] = r[k];
    vendors.push({
      place_id: placeId,
      slug: "",
      ...names,
      ...cls,
      lat: inLebanon ? lat : null,
      lon: inLebanon ? lon : null,
      phone_seed: phone?.e164 ?? null,
      phone_seed_mobile: phone ? phone.mobile : null,
      address_seed: (r.address ?? "").trim() || null,
      brand_slug: null,
      brand_name_en: null,
      brand_name_ar: null,
      links,
      import_labels: labels,
    });
  }

  // Chains: the same normalised name (without branch) twice or more, or the same website domain.
  const keyOf = (v: VendorRow) => normName(v.name_en ?? v.name_ar);
  const byName = new Map<string, VendorRow[]>();
  const byDomain = new Map<string, VendorRow[]>();
  for (const v of vendors) {
    const k = keyOf(v);
    if (k) byName.set(k, [...(byName.get(k) ?? []), v]);
    const d = siteDomain(v.links);
    if (d) byDomain.set(d, [...(byDomain.get(d) ?? []), v]);
  }
  // One phone on listings that share a distinctive name word (Ata / Ata ice cream, ملحمة الجمال /
  // مطعم الجمّال) is one business listed twice: a brand, so the phone is kept.
  const byPhone = new Map<string, VendorRow[]>();
  for (const v of vendors)
    if (v.phone_seed) byPhone.set(v.phone_seed, [...(byPhone.get(v.phone_seed) ?? []), v]);
  const samePhoneBusiness = [...byPhone.values()].filter((group) => {
    if (group.length < 2) return false;
    const [head, ...rest] = group.map(nameWords);
    return [...head].some((w) => rest.every((r) => r.has(w)));
  });
  const brandOf = new Map<VendorRow, VendorRow[]>();
  for (const group of [...byName.values(), ...byDomain.values(), ...samePhoneBusiness]) {
    if (group.length < 2) continue;
    const merged = new Set<VendorRow>(group.flatMap((v) => brandOf.get(v) ?? [v]));
    const all = [...merged];
    for (const v of all) brandOf.set(v, all);
  }
  for (const [v, group] of brandOf) {
    const first = [...group].sort((a, b) => a.place_id.localeCompare(b.place_id))[0];
    const en =
      commonName(group.map((g) => g.name_en)) ?? group.map((g) => g.name_en).find(Boolean) ?? null;
    const ar = group.map((g) => g.name_ar).find(Boolean) ?? null;
    v.brand_name_en = en;
    v.brand_name_ar = ar;
    v.brand_slug =
      slugify(en ?? "") || `brand-${slugify(first.place_id.slice(-10)) || slugify(first.place_id)}`;
  }

  // Shared phones: branches of one brand keep it; unrelated businesses lose it (data error).
  const phoneIssues: NormalizeResult["phoneIssues"] = [];
  for (const [phone, group] of byPhone) {
    if (group.length < 2) continue;
    const brands = new Set(group.map((g) => g.brand_slug ?? `solo:${g.place_id}`));
    if (brands.size === 1) {
      phoneIssues.push({
        phone,
        place_ids: group.map((g) => g.place_id),
        resolution: "chain branches",
      });
    } else {
      for (const g of group) {
        g.phone_seed = null;
        g.phone_seed_mobile = null;
      }
      phoneIssues.push({
        phone,
        place_ids: group.map((g) => g.place_id),
        resolution: "data error: phone dropped",
      });
    }
  }

  // Slugs: name (and branch), unique, deterministic by place_id.
  const used = new Set<string>();
  for (const v of [...vendors].sort((a, b) => a.place_id.localeCompare(b.place_id))) {
    let base = slugify([v.name_en, v.branch_label].filter(Boolean).join(" "));
    // The place_id tail can start with '-' or '_' (ChIJ...-dUfOfTn8w); slugify it after slicing.
    if (!base) base = `v-${slugify(v.place_id.slice(-10)) || slugify(v.place_id)}`;
    let slug = base;
    for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
    used.add(slug);
    v.slug = slug;
  }
  return { vendors, exclusions, phoneIssues };
}

export const VENDOR_COLUMNS = [
  "place_id",
  "slug",
  "name_ar",
  "name_en",
  "branch_label",
  "business_type",
  "cuisine_tags",
  "lat",
  "lon",
  "phone_seed",
  "phone_seed_mobile",
  "address_seed",
  "brand_slug",
  "brand_name_en",
  "brand_name_ar",
  "links",
  "import_labels",
];

export function vendorCsv(vendors: VendorRow[]): string {
  return toCsv(
    VENDOR_COLUMNS,
    vendors.map((v) => [
      v.place_id,
      v.slug,
      v.name_ar,
      v.name_en,
      v.branch_label,
      v.business_type,
      `{${v.cuisine_tags.join(",")}}`,
      v.lat,
      v.lon,
      v.phone_seed,
      v.phone_seed_mobile,
      v.address_seed,
      v.brand_slug,
      v.brand_name_en,
      v.brand_name_ar,
      JSON.stringify(v.links),
      JSON.stringify(v.import_labels),
    ]),
  );
}
