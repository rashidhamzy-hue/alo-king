// Menu ranking by time of day (P1-4). The daypart comes from Asia/Beirut; a dish is tagged for dayparts from its section and name (a keyword heuristic:
// there is no daypart column yet, so a vendor-set sort order or popularity flag still outranks everything below the daypart). No I/O.

export type Daypart = "breakfast" | "lunch" | "dinner" | "late";

/** breakfast 05:00-10:59, lunch 11:00-15:59, dinner 16:00-21:59, late night 22:00-04:59 (Asia/Beirut). */
export function daypartAt(d: Date = new Date()): Daypart {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Beirut", hour: "2-digit", hourCycle: "h23" }).format(d));
  return h >= 5 && h < 11 ? "breakfast" : h < 16 && h >= 11 ? "lunch" : h >= 16 && h < 22 ? "dinner" : "late";
}

const norm = (s: unknown) => String(s ?? "").normalize("NFKD").replace(/[̀-ًͯ-ٟـ]/g, "").toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/\s+/g, " ").trim();
const RULES: { re: RegExp; parts: Daypart[] }[] = [
  { re: /\b(?:breakfast|brunch|manakish|manoushe|manousheh|manaeesh|eggs?|omelet\w*|foul|fool|ful|labneh|croissants?|pancakes?|granola|oats|porridge|ftour)\b|فطور|فطار|منقوشه|مناقيش|بيض|فول|لبنه|كرواسون|بان كيك/, parts: ["breakfast"] },
  { re: /\b(?:lunch|plates?|platters?|mains?|main dishes|stews?|rice|kebbeh|kibbeh|mezze|mezza|grills?|grilled|mixed grill|tawook|taouk|kafta|kofta|musakhan|mjaddara)\b|غداء|غدا|صحون|صحن|اطباق رئيسيه|طبق رئيسي|مشاوي|مشوي|كبه|كفته|طاووق|مجدره|مقبلات|مزه/, parts: ["lunch", "dinner"] },
  { re: /\b(?:dinner|pizzas?|burgers?|steaks?|pasta|lasagna|calzone)\b|عشاء|بيتزا|برغر|ستيك|باستا/, parts: ["dinner", "late"] },
  { re: /\b(?:late night|snacks?|shawarma|fries|nuggets?|wings?|wraps?|sandwich\w*|falafel|desserts?|sweets?|crepes?|waffles?|ice ?cream|knefe|kunafa|baklava|shakes?)\b|سناك|شاورما|بطاطا|وافل|كريب|بوظه|كنافه|حلويات|حلو|ساندويش|فلافل/, parts: ["late", "dinner"] },
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

const EXTRA = /\b(?:sides?|drinks?|beverages?|juices?|soft|sodas?|water|sauces?|dips?|breads?|extras?|add ?ons?|toppings?)\b|مشروبات|مشروب|عصير|عصائر|صوص|صلصه|خبز|جانبي|اضافات|إضافات/;
/** Drinks, sides, sauces and bread: listed after the main dishes. */
export const isExtraItem = (it: { section?: string | null; item_name_en?: string | null; item_name_ar?: string | null }): boolean => EXTRA.test(norm(`${it.section ?? ""} ${it.item_name_en ?? ""} ${it.item_name_ar ?? ""}`));

export const daypartLabel = (d: Daypart, ar: boolean): string => ar
  ? { breakfast: "مناسب للفطور", lunch: "مناسب للغدا", dinner: "مناسب للعشا", late: "مناسب للسهرة" }[d]
  : { breakfast: "Suggested for breakfast", lunch: "Suggested for lunch", dinner: "Suggested for dinner", late: "Suggested for late night" }[d];
