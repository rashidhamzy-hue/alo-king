// Menu ranking by time of day (P1-4). The daypart comes from Asia/Beirut; a dish is tagged for dayparts from its section and name (a keyword heuristic:
// there is no daypart column yet, so a vendor-set sort order or popularity flag still outranks everything below the daypart). No I/O.

export type Daypart = "breakfast" | "lunch" | "dinner" | "late";

/** breakfast 05:00-10:59, lunch 11:00-15:59, dinner 16:00-21:59, late night 22:00-04:59 (Asia/Beirut). */
export function daypartAt(d: Date = new Date()): Daypart {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Beirut", hour: "2-digit", hourCycle: "h23" }).format(d));
  return h >= 5 && h < 11 ? "breakfast" : h < 16 && h >= 11 ? "lunch" : h >= 16 && h < 22 ? "dinner" : "late";
}

const norm = (s: unknown) => String(s ?? "").normalize("NFKD").replace(/[̀-ًͯ-ٟـ]/g, "").toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/\s+/g, " ").trim();
// Arabic keywords match whole words only (حلو must not match حلوم, halloumi).
const AR = (words: string) => new RegExp(`(?<![\\u0600-\\u06ff])(?:${words})(?![\\u0600-\\u06ff])`);
// Tags are boosts for clear fits; ordinary all-day food (sandwiches, wraps, falafel, fries) is deliberately untagged. Score 0 only for a clear mismatch (breakfast food at dinner, dessert at breakfast).
const RULES: { re: RegExp; parts: Daypart[] }[] = [
  { re: /\b(?:breakfast|brunch|manakish|manoushe|manousheh|manaeesh|eggs?|omelet\w*|foul|fool|ful|labneh|croissants?|pancakes?|granola|oats|porridge|ftour)\b/, parts: ["breakfast"] },
  { re: AR("فطور|فطار|منقوشه|مناقيش|بيض|فول|لبنه|كرواسون|بان كيك"), parts: ["breakfast"] },
  { re: /\b(?:lunch|plates?|platters?|mains?|main dishes|stews?|kebbeh|kibbeh|mezze|mezza|grills?|grilled|mixed grill|tawook|taouk|kafta|kofta|musakhan|mjaddara)\b/, parts: ["lunch", "dinner"] },
  { re: AR("غداء|غدا|صحون|صحن|اطباق رئيسيه|طبق رئيسي|مشاوي|مشوي|كبه|كفته|طاووق|مجدره|مقبلات|مزه"), parts: ["lunch", "dinner"] },
  { re: /\b(?:dinner|pizzas?|burgers?|steaks?|pasta|lasagna|calzone|shawarma)\b/, parts: ["lunch", "dinner", "late"] },
  { re: AR("عشاء|بيتزا|برغر|ستيك|باستا|شاورما"), parts: ["lunch", "dinner", "late"] },
  { re: /\b(?:late night|desserts?|crepes?|waffles?|ice ?cream|knefe|kunafa|baklava|shakes?)\b/, parts: ["late", "dinner"] },
  { re: AR("حلويات|وافل|كريب|بوظه|كنافه|بقلاوه"), parts: ["late", "dinner"] },
];
/** The dayparts a dish is meant for (from its section and name), or null when nothing says (all day). */
export function itemDayparts(it: { section?: string | null; item_name_en?: string | null; item_name_ar?: string | null }): Daypart[] | null {
  const t = norm(`${it.section ?? ""} ${it.item_name_en ?? ""} ${it.item_name_ar ?? ""}`);
  const parts = new Set<Daypart>(); let hit = false;
  for (const r of RULES) if (r.re.test(t)) { hit = true; for (const p of r.parts) parts.add(p); }
  return hit ? [...parts] : null;
}
/** 2 = made for this time of day, 1 = all day, 0 = made for another time (breakfast at 8 pm). */
export function daypartScore(it: Parameters<typeof itemDayparts>[0], now: Daypart): 0 | 1 | 2 {
  const p = itemDayparts(it);
  return p === null ? 1 : p.includes(now) ? 2 : 0;
}

const EXTRA = new RegExp(`\\b(?:sides?|drinks?|beverages?|juices?|soft drinks?|sodas?|water|sauces?|dips?|breads?|extras?|add ?ons?|toppings?)\\b|(?<![\\u0600-\\u06ff])(?:مشروبات|مشروب|عصير|عصائر|صوص|صلصات|خبز|جانبي|جانبيه|اضافات)(?![\\u0600-\\u06ff])`);
/** Drinks, sides, sauces and bread: listed after the main dishes. Decided by the section only ("Pasta in Cream Sauce" is a main). */
export const isExtraItem = (it: { section?: string | null }): boolean => EXTRA.test(norm(it.section ?? ""));

export const daypartLabel = (d: Daypart, ar: boolean): string => ar
  ? { breakfast: "مناسب للفطور", lunch: "مناسب للغدا", dinner: "مناسب للعشا", late: "مناسب للسهرة" }[d]
  : { breakfast: "Suggested for breakfast", lunch: "Suggested for lunch", dinner: "Suggested for dinner", late: "Suggested for late night" }[d];
