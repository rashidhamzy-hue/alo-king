// What a customer reads about an item in WhatsApp's catalogue and on its web page (DECISIONS §39.15.2, spec §2 items 2-3).
//   - Title: "<Item> · <Shop>". The item part in one language: the shop's Latin name for it, else English; Title Case,
//     never ALL CAPS; a size once. The shop names it because the header catalogue is one flat list of every shop.
//   - Description, one line each, in this order: shop · village; the Arabic name; what it is (the menu's text, else
//     "Usually made with …" from the dish library); estimated energy and protein; allergens only when the merchant declared
//     them; "Extras chosen after you add it" when it has options. Never a photo credit (credits live on the web page and
//     /credits), never "safe".
// Pure functions: the catalogue sync, the image route and the website all build the same words.

const SMALL = new Set([
  "a",
  "an",
  "and",
  "or",
  "of",
  "with",
  "w",
  "the",
  "in",
  "on",
  "to",
  "for",
  "de",
  "du",
  "des",
  "la",
  "le",
  "les",
  "et",
  "au",
  "aux",
  "al",
  "el",
]);
/** Short words kept in capitals when the merchant wrote them so. */
const ACRONYMS = new Set([
  "BBQ",
  "XL",
  "XXL",
  "XS",
  "BLT",
  "KFC",
  "USA",
  "VIP",
  "TV",
  "DIY",
  "OK",
  "PB",
  "J",
  "BF",
]);
const SIZE = /(\d+(?:[.,]\d+)?)\s*(ml|cl|l|ltr|litre|liter|g|gr|kg|oz)\b\.?/gi;

/** "330ML" → "330 ml", "1.5L" → "1.5 L": one way to write a size. */
function sizeText(num: string, unit: string): string {
  const u = unit.toLowerCase();
  const unitText = ["l", "ltr", "litre", "liter"].includes(u) ? "L" : u === "gr" ? "g" : u;
  return `${num.replace(",", ".")} ${unitText}`;
}

/** Collapses a size written twice ("Pepsi 330ml (330 ML)") to once, written one way. */
export function sizeOnce(s: string): string {
  const seen = new Set<string>();
  const out = s.replace(SIZE, (_m, num: string, unit: string) => {
    const t = sizeText(num, unit);
    if (seen.has(t)) return "";
    seen.add(t);
    return t;
  });
  return out
    .replace(/\(\s*\)|\[\s*\]/g, "")
    .replace(/\s+([,.)])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function capWord(w: string): string {
  // Each part of "SAJ-BREAD" or "J.O" starts with a capital, the rest lower case. After an apostrophe only when the word
  // starts with one letter before it (D'Or, L'Exquis, O'Neill), never in "Jo's", "J.O's", "Man'oushe" or "Ka'ak".
  return w
    .toLowerCase()
    .replace(/(^|[-/(.])(\p{L})/gu, (_m, p: string, c: string) => p + c.toUpperCase())
    .replace(
      /(^|[-/(])(\p{L})'(\p{L})/gu,
      (_m, p: string, a: string, c: string) => `${p}${a}'${c.toUpperCase()}`,
    );
}

/** Size units stay as sizeOnce wrote them ("330 ml", "1.5 L", "270 g"). */
const UNIT = /^(ml|cl|L|g|kg|oz)$/;

/**
 * Title Case for a Latin item name, never ALL CAPS: "HOT DOG" → "Hot Dog", "chicken BURGER with fries" → "Chicken Burger
 * with Fries", "BBQ wings" keeps BBQ, "McFlurry" keeps its own capitals. Arabic and other scripts are left as they are.
 */
export function titleCase(s: string): string {
  // "YOGURT(with" is two words: a bracket after a letter gets a space, so each word's case is judged on its own.
  const words = sizeOnce(
    s
      .replace(/(\p{L})\(/gu, "$1 (")
      .replace(/\s+/g, " ")
      .trim(),
  ).split(" ");
  return words
    .map((w, i) => {
      const letters = w.replace(/[^\p{L}]/gu, "");
      if (!letters || !/[A-Za-zÀ-ÿ]/.test(letters)) return w;
      if (i > 0 && /^\d/.test(words[i - 1]) && UNIT.test(w)) return w;
      const upper = letters === letters.toUpperCase();
      const lower = letters === letters.toLowerCase();
      if (upper && ACRONYMS.has(letters)) return w;
      if (i > 0 && SMALL.has(letters.toLowerCase())) return w.toLowerCase();
      // The merchant's own mixed case (McFlurry, iPhone) stays; ALL CAPS and all lower case get a capital first.
      if (!upper && !lower) return w;
      return capWord(w);
    })
    .join(" ");
}

/**
 * At most `max` UTF-16 units (how Meta and JavaScript count), cut between whole characters, never inside an emoji;
 * `ellipsis` ends a shortened text with "…".
 */
export function fit(s: string, max: number, ellipsis = false): string {
  if (s.length <= max) return s;
  const room = ellipsis ? max - 1 : max;
  let out = "";
  for (const ch of s) {
    if (out.length + ch.length > room) break;
    out += ch;
  }
  return ellipsis ? out.trimEnd() + "…" : out;
}

export type ItemText = {
  name_ar?: string | null;
  name_en?: string | null;
  name_fr?: string | null;
  /** The menu's own text for the item. */
  menu_text?: string | null;
  shop_en?: string | null;
  shop_ar?: string | null;
  village_en?: string | null;
  village_ar?: string | null;
  /** Estimated from the dish library (§32.3); shown as estimated, never as a claim. */
  kcal?: number | string | null;
  protein_g?: number | string | null;
  /** Allergens the merchant declared (allergens_confirmed_at set); empty: nothing is said. */
  allergens_declared?: string[] | null;
  /** The dish library's main ingredients, by weight, when the menu has no text of its own. */
  usually?: string[] | null;
  has_options?: boolean | null;
  /** "≈ 0.5 kg, final by weight" for an item sold by weight. */
  weight_kg?: number | string | null;
  /** The photo is a picture of the dish, not of this shop's own (source = illustrative). */
  illustrative?: boolean | null;
  /** The item's public page; while there is none, a CC BY photo's credit stays in the description. */
  link?: string | null;
  /** "<author> · <license>" for a CC BY or CC BY-SA photo, else null. */
  photo_credit?: string | null;
};

const ALLERGEN_EN: Record<string, string> = {
  gluten: "gluten",
  nuts: "tree nuts",
  dairy: "milk",
  eggs: "eggs",
  sesame: "sesame",
  fish: "fish",
  shellfish: "shellfish",
  soy: "soy",
  peanuts: "peanuts",
  mustard: "mustard",
  celery: "celery",
  sulphites: "sulphites",
  lupin: "lupin",
  molluscs: "molluscs",
};

const clean = (s: string | null | undefined) =>
  (s ?? "")
    // No phone numbers or links in a catalogue text (Meta refuses them; §39.15.4).
    .replace(/https?:\/\/\S+|www\.\S+/gi, "")
    .replace(/\+?\d[\d\s-]{6,}\d/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** The item part of the title: the shop's Latin name for it, else English, else French, else Arabic. */
export function itemName(t: ItemText): string {
  const latin = [t.name_en, t.name_fr].map((x) => clean(x)).find((x) => /[A-Za-zÀ-ÿ]/.test(x));
  return latin ? titleCase(latin) : clean(t.name_ar) || clean(t.name_en) || "";
}

/**
 * "<Item> · <Shop>", at most 150 UTF-16 units (Meta's limit): the item part is shortened, never the shop. An item with
 * only an Arabic name takes the shop's Arabic name, so the title stays in one script.
 */
export function catalogTitle(t: ItemText, max = 150): string {
  const item = itemName(t);
  const arabic = !/[A-Za-zÀ-ÿ]/.test(item) && /\p{Script=Arabic}/u.test(item);
  const shop = (arabic && clean(t.shop_ar)) || clean(t.shop_en) || clean(t.shop_ar);
  if (!shop) return fit(item, max, true);
  return `${fit(item, Math.max(max - shop.length - 3, 2), true)} · ${shop}`;
}

/** The description lines, in the decided order; at most `max` characters (Meta: 5,000; we keep 500). */
export function catalogDescription(t: ItemText, max = 500): string {
  const shop = clean(t.shop_en) || clean(t.shop_ar);
  const village = clean(t.village_en) || clean(t.village_ar);
  const lines: string[] = [];
  if (shop) lines.push(village ? `${shop} · ${village}` : shop);
  const ar = clean(t.name_ar);
  if (ar && ar !== itemName(t)) lines.push(ar);
  const what = clean(t.menu_text);
  const usual = (t.usually ?? [])
    .map((x) => clean(x))
    .filter(Boolean)
    .slice(0, 5);
  const whatLine = what
    ? what
    : usual.length
      ? `Usually made with ${usual.length > 1 ? `${usual.slice(0, -1).join(", ")} and ${usual[usual.length - 1]}` : usual[0]}.`
      : "";
  const kcal = Number(t.kcal);
  const protein = Number(t.protein_g);
  const energy =
    Number.isFinite(kcal) && kcal > 0
      ? `≈ ${Math.round(kcal / 10) * 10} kcal${Number.isFinite(protein) && protein > 0 ? ` · ${Math.round(protein)} g protein` : ""} (estimated)`
      : "";
  const allergens = (t.allergens_declared ?? []).map((a) => ALLERGEN_EN[a] ?? a);
  const tail = [
    energy,
    allergens.length ? `Contains ${allergens.join(", ")} (declared by the shop)` : "",
    t.has_options ? "Extras chosen after you add it" : "",
    Number(t.weight_kg) > 0 ? `≈ ${Number(t.weight_kg)} kg, final price by weight` : "",
    t.illustrative ? "Photo for illustration" : "",
    // Until the item has its page (which credits the photo), a CC BY photo's credit stays here (§38.1, §39.13).
    !t.link && clean(t.photo_credit) ? `📷 ${fit(clean(t.photo_credit), 120, true)}` : "",
  ].filter(Boolean);
  // What it is gets whatever room the other lines leave (all in UTF-16 units); the other lines are never cut.
  const fixed = [...lines, ...tail].join("\n").length + (whatLine ? 1 : 0);
  const room = max - fixed;
  if (whatLine && room > 20) lines.push(fit(whatLine, room, true));
  return fit([...lines, ...tail].join("\n"), max);
}
