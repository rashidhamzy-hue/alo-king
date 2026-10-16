// Catalogue rules the merchant agent learns (DECISIONS §39.15.4). One validator, validateCatalogItem(), used by:
//   - the catalogue sync: an item that fails is held out of Meta's catalogue (catalog_item_holds, the "held" count of
//     catalog_status_report) and stays orderable through the chat lists and the web menu;
//   - the demo photo pipeline (scripts/demo/demo-photos.ts), before a photo is saved;
//   - the merchant copilot, when a merchant adds or edits an item or sends an item photo: it says what Meta would refuse
//     and how to fix it, in the merchant's language, and nothing goes to Meta until the item passes.
// Pure (no I/O): it runs in Deno and Node. The rules' words live in one file, catalog-rules.json, which this module, the
// doc (scripts/catalog/rules-doc.ts → docs/catalog/META-CATALOG-RULES.md) and the seed of public.catalog_rules (every
// catalog_rules upsert in supabase/migrations, in order) all derive from; scripts/catalog/rules-doc.test.ts keeps them
// equal. Writing on a photo, a watermark or a collage cannot be seen without a vision model: those rules are listed with
// checkedHere false, Meta's own review decides them, and the learning loop records Meta's refusals.

import { alcNorm, isAlcohol } from "./alcohol.ts";
import { findMedicine, stripFoodAntibioticClaims } from "./medicine.ts";
import { titleCase } from "./item-text.ts";
// The rules' words, from catalog-rules.json through its generated TypeScript copy (no JSON module in the edge runtime).
import RULES_DATA from "./catalog-rules.data.ts";

export type CatalogLang = "ar" | "en" | "fr" | "arabizi";
export type Words = Record<CatalogLang, string>;
export type RuleField = "image" | "title" | "price" | "description" | "policy";
export const CATALOG_LANGS: CatalogLang[] = ["ar", "en", "fr", "arabizi"];

/** One rule: its plain words (the table's and the doc's), and what the merchant hears when an item breaks it. */
export type CatalogRule = {
  code: string;
  field: RuleField;
  /** validateCatalogItem checks it before anything reaches Meta; false: only Meta's own review can see it. */
  checkedHere: boolean;
  /** Where the rule comes from: Meta's published requirements or policy, or a decision of ours. */
  basis: string;
  rule: Words;
  /** The problem with this item; {w}, {h}, {n}, {max}, {found} and {suggestion} are filled in. */
  problem: Words;
  fix: Words;
};

export type CatalogIssue = { code: string; field: RuleField; message: Words; fix: Words };

// ---- The numbers the checks use (Meta's published minimum and our reading of "a square crop is possible") -----------
/** Meta's minimum product image: 500 × 500 pixels. */
export const MIN_IMAGE_SIDE = 500;
/** A square crop keeps at least half of the picture: the long side is at most twice the short side. */
export const MAX_IMAGE_ASPECT = 2;
/** A file this small is an empty image or a placeholder, never a photo of a dish (an 800 × 800 flat JPEG is ~2 KB). */
export const TINY_IMAGE_BYTES = 5_000;
/** A JPEG or WebP below this many bytes per pixel is a flat picture (a placeholder); real dish photos are 10× more. */
export const MIN_BYTES_PER_PIXEL = 0.008;
/** The largest side we read or store (menu_item_photos.width and height); a header claiming more is not a photo. */
export const MAX_IMAGE_PX = 20_000;
/** Meta's title limit as item-text.ts builds it (UTF-16 units). */
export const MAX_TITLE = 150;
/** Known placeholder files (SHA-256 of the bytes): the empty file; the review session adds what Meta's refusals show. */
export const PLACEHOLDER_SHA256 = new Set([
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
]);
/** Placeholder file names (a shop's site often serves these when an item has no photo). */
export const PLACEHOLDER_NAME =
  /(placeholder|no[-_ ]?(image|img|photo|picture)|default[-_ ]?(image|img|photo|product)|coming[-_ ]?soon|image[-_ ]?not[-_ ]?(available|found)|dummy|blank[-_ ]?(image|img)?\.)/i;

// ---- Words that mark promotional text, per language (short on purpose: whole words or phrases, normalised) ---------
export const PROMO_WORDS: Record<CatalogLang, string[]> = {
  en: [
    "discount",
    "discounted",
    "best price",
    "lowest price",
    "cheapest",
    "special offer",
    "limited offer",
    "buy one get one",
    "buy 1 get 1",
  ],
  fr: [
    "gratuit",
    "gratuite",
    "offert",
    "offerte",
    "remise",
    "promo",
    "promotion",
    "meilleur prix",
    "soldes",
  ],
  ar: [
    "مجانا",
    "مجاني",
    "مجانيه",
    "ببلاش",
    "خصم",
    "حسم",
    "عرض خاص",
    "افضل سعر",
    "ارخص سعر",
    "تنزيلات",
  ],
  arabizi: ["bbalesh", "b balesh", "5asem", "khasem", "a7san se3er", "arkhas se3er"],
};
/**
 * "free" is an offer only alone or opening a phrase ("Free fries", "Burger + free fries", "…, free delivery"); after a word
 * ("gluten-free", "Cholesterol Free", "seed free") it is a claim about the dish, and "free from", "free of" and
 * "free-range" are too.
 */
const FREE_OFFER = /(?:^|[\n.!?;:,(•+]\s*|\+\s*)free\b(?![\s-]*(?:range|from|of)\b)/i;
/** "off" only as a price cut: "20% off", "$2 off", "2$ off". */
const OFF_PROMO = /\d\s*%\s*off\b|\$\s*\d+(?:[.,]\d+)?\s*off\b|\d\s*\$\s*off\b/i;
const EXCLAIM = /!{3,}/;
const EMOJI = /\p{Extended_Pictographic}/gu;
/** Four or more emoji in a text read as decoration, not a description. */
export const MAX_EMOJI = 3;

const PHONE = /(?:\+|00)?[\d٠-٩](?:[\s.\-()]?[\d٠-٩]){7,}/;
const URL_RE =
  /\bhttps?:\/\/\S+|\bwww\.\S+|\b[a-z0-9-]+\.(?:com|net|org|lb|co|io|me|info|biz|shop|store|app)(?:\/\S*)?(?![\w.])/i;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/;
const PRICE_IN_TITLE = /\$\s?\d|\d\s?(?:\$|usd\b|lbp\b|l\.l\.?|ل\.ل)|ليرة|ليره|دولار/i;

// ---- Commerce policy: medicine (§38.3), alcohol (alcohol.ts) and tobacco ---------------------------------------------
const norm = (s: unknown) => alcNorm(s);
const TOBACCO_RAW = [
  "tobacco",
  "cigarette",
  "cigarettes",
  "cigar",
  "cigars",
  "cigarillo",
  "cigarillos",
  "shisha",
  "hookah",
  "nargile",
  "narghile",
  "nargileh",
  "argileh",
  "arguileh",
  "argile",
  "arguile",
  "vape",
  "vapes",
  "e cigarette",
  "e liquid",
  "nicotine",
  "marlboro",
  "gauloises",
  "gitanes",
  "heets",
  "iqos",
  "terea",
  "al fakher",
  "tabac",
  "cigare",
  "cigares",
  "chicha",
  "narguile",
  "vapoteuse",
  "دخان",
  "سجائر",
  "سيجاره",
  "سيكاره",
  "سيكار",
  "تبغ",
  "تنباك",
  "نرجيله",
  "اركيله",
  "ارجيله",
  "شيشه",
  "dekhan",
  "dukhan",
  "sigara",
  "sigarat",
  "tombak",
  "tenbek",
  "2argile",
  "2argileh",
  "m3assal",
];
/** The words a pastry is also called (cheese cigars, cigarettes russes, سيكار جبنة); others are tobacco whatever the menu. */
const PASTRY_NAMES = new Set([
  "cigar",
  "cigars",
  "cigarette",
  "cigarettes",
  "cigare",
  "cigares",
  "سيكار",
  "سيكاره",
]);
/** Pastries called cigars are food: judged against the item's names and its section together. */
const TOBACCO_FOOD =
  /\b(?:cheese|fromage|jebne|jibne|jebneh|lahme|lahmeh|meat|viande|chicken|poulet|djej|spinach|epinards?|sabanekh|kafta|halloumi|feta|chocolate|chocolat|nutella|pastry|pastries|rolls?|dough|russes?|sweet|sweets|rakakat|biscuits?)\b|جبنه|لحمه|دجاج|سبانخ|شوكولا|حلوم|رقاقات|حلو/;
/** Shops whose whole business is outside the catalogue (none is a business type today; a pharmacy never will be, §29.2). */
const MEDICINE_BUSINESS = /^(pharmacy|pharmacie|drugstore|parapharmacy)$/i;

const TOBACCO = TOBACCO_RAW.map(norm);
const PROMO = Object.fromEntries(
  Object.entries(PROMO_WORDS).map(([k, v]) => [k, v.map(norm)]),
) as Record<CatalogLang, string[]>;

const hasPhrase = (hay: string, phrase: string) => ` ${hay} `.includes(` ${phrase} `);
const anyPhrase = (hay: string, list: string[]) => list.find((w) => w && hasPhrase(hay, w)) ?? null;

// ---- The rules (catalog-rules.json) ------------------------------------------------------------------------------
export const CATALOG_RULES: CatalogRule[] = (RULES_DATA as { rules: CatalogRule[] }).rules;

const RULE = new Map(CATALOG_RULES.map((r) => [r.code, r]));

const fill = (t: Words, vars: Record<string, string | number>): Words =>
  Object.fromEntries(
    CATALOG_LANGS.map((l) => [
      l,
      t[l].replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)),
    ]),
  ) as Words;

function issue(code: string, vars: Record<string, string | number> = {}): CatalogIssue {
  const r = RULE.get(code);
  if (!r) throw new Error(`unknown catalogue rule ${code}`);
  return { code, field: r.field, message: fill(r.problem, vars), fix: fill(r.fix, vars) };
}

// ---- Image header: width and height from the first bytes, no decoder -------------------------------------------------
export type ImageHeader = { format: "png" | "jpeg" | "webp"; width: number; height: number };

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u32be = (b: Uint8Array, i: number) =>
  ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const ascii = (b: Uint8Array, i: number, n: number) =>
  String.fromCharCode(...Array.from(b.subarray(i, i + n)));

/** Width and height read from a PNG (IHDR), JPEG (the SOF marker) or WebP (VP8, VP8L, VP8X) header; null otherwise. */
export function imageHeader(b: Uint8Array | null | undefined): ImageHeader | null {
  if (!b || b.length < 24) return null;
  // PNG: the signature, then IHDR with width and height (big-endian).
  if (b[0] === 0x89 && ascii(b, 1, 3) === "PNG" && ascii(b, 12, 4) === "IHDR") {
    const width = u32be(b, 16);
    const height = u32be(b, 20);
    return width && height ? { format: "png", width, height } : null;
  }
  // JPEG: walk the markers to the first start-of-frame (SOF0-3, 5-7, 9-11, 13-15).
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 3 < b.length) {
      if (b[i] !== 0xff) return null;
      let m = b[i + 1];
      while (m === 0xff && i + 2 < b.length) m = b[++i + 1]; // fill bytes
      if (m === 0xd9 || m === 0xda) return null; // end of image, or the scan before any frame
      if ((m >= 0xd0 && m <= 0xd7) || m === 0x01) {
        i += 2;
        continue;
      }
      const len = u16be(b, i + 2);
      if (len < 2) return null;
      const sof = m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
      if (sof) {
        if (i + 8 >= b.length) return null;
        const height = u16be(b, i + 5);
        const width = u16be(b, i + 7);
        return width && height ? { format: "jpeg", width, height } : null;
      }
      i += 2 + len;
    }
    return null;
  }
  // WebP: RIFF....WEBP, then the first chunk.
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP" && b.length >= 30) {
    const chunk = ascii(b, 12, 4);
    if (chunk === "VP8 " && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
      const width = (b[26] | (b[27] << 8)) & 0x3fff;
      const height = (b[28] | (b[29] << 8)) & 0x3fff;
      return width && height ? { format: "webp", width, height } : null;
    }
    if (chunk === "VP8L" && b[20] === 0x2f) {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { format: "webp", width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X")
      return { format: "webp", width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  }
  return null;
}

// ---- The validator ----------------------------------------------------------------------------------------------------
export type CatalogItemCheck = {
  /** What Meta shows as the title ("<Item> · <Shop>"), or the merchant's name for the item. */
  title?: string | null;
  /** The item part of the title, which the one-language and capitals rules apply to (default: the title). */
  item_name?: string | null;
  name_en?: string | null;
  name_ar?: string | null;
  name_fr?: string | null;
  section?: string | null;
  section_en?: string | null;
  description?: string | null;
  /** The price in cents (the sync) or in dollars (the copilot); checked when either key is given. */
  price_minor?: number | null;
  price_usd?: number | string | null;
  /** The merchant's flag (menu_items.contains_alcohol). */
  contains_alcohol?: boolean | null;
  business_type?: string | null;
};

export type CatalogPhotoCheck = {
  /** The address Meta fetches the image from. */
  url?: string | null;
  /** The file itself: width and height come from its header, its length is its size. */
  bytes?: Uint8Array | null;
  /** Used when there are no bytes, or their header cannot be read (another format a decoder measured). */
  width?: number | null;
  height?: number | null;
  /** The file's size in bytes when the bytes are not given. */
  size?: number | null;
  /** The file name or storage path. */
  name?: string | null;
  /** SHA-256 of the bytes (hex), for the known placeholders. */
  sha256?: string | null;
  /** The format, when the caller measured the file itself. */
  format?: string | null;
};

const LATIN = /[A-Za-zÀ-ÿ]/;
const ARABIC = /\p{Script=Arabic}/u;
const UNIT_AFTER_NUMBER =
  /[\d٠-٩]+(?:[.,][\d٠-٩]+)?\s*(?:ml|cl|l|ltr|g|gr|kg|oz|cm|mm|pcs|pc|x)\b\.?/gi;

/**
 * The Latin words of a name: single letters, units after a number ("330 ml") and words that start with a digit ("7UP",
 * which Title Case leaves as written) are left out; brackets and punctuation around a word are dropped.
 */
const latinWords = (s: string) =>
  s
    .replace(UNIT_AFTER_NUMBER, " ")
    .split(/[\s/,;:()[\]{}·•|+&]+/)
    .map((x) => x.replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, ""))
    .filter(
      (x) => !/^[\d٠-٩]/.test(x) && !ARABIC.test(x) && x.replace(/[^A-Za-zÀ-ÿ]/g, "").length >= 2,
    );

function titleIssues(item: CatalogItemCheck): CatalogIssue[] {
  const out: CatalogIssue[] = [];
  const title = String(item.title ?? item.item_name ?? "").trim();
  const name = String(item.item_name ?? item.title ?? "").trim();
  if (!title && !name) return [issue("title_missing")];
  if (title.length > MAX_TITLE)
    out.push(issue("title_too_long", { n: title.length, max: MAX_TITLE }));
  // Never ALL CAPS: every Latin word in capitals, beyond the acronyms Title Case keeps (BBQ, XL).
  const words = latinWords(name);
  const shouting = words.filter((x) => x === x.toUpperCase() && x !== x.toLowerCase());
  if (words.length && shouting.length === words.length && shouting.some((x) => titleCase(x) !== x))
    out.push(issue("title_all_caps", { suggestion: titleCase(name) }));
  // One language: Arabic and Latin letters together (a size's unit and a lone letter do not count).
  const latin = words.join(" ");
  if (latin && ARABIC.test(name))
    out.push(issue("title_mixed_language", { found: latin.slice(0, 40) }));
  const found = promotional(title, true) ?? contact(title);
  if (found) out.push(issue("title_promotional", { found }));
  return out;
}

/** Contact details in a text: a phone number, a link or an email; null when none. */
function contact(s: string): string | null {
  const m = PHONE.exec(s) ?? EMAIL.exec(s) ?? URL_RE.exec(s);
  return m ? m[0].trim().slice(0, 40) : null;
}

/** Promotional words or decoration in a text; null when none. */
function promotional(s: string, title = false): string | null {
  if (EXCLAIM.test(s)) return "!!!";
  if ((s.match(EMOJI) ?? []).length > MAX_EMOJI) return "emoji";
  if (title && PRICE_IN_TITLE.test(s)) return (PRICE_IN_TITLE.exec(s) as RegExpExecArray)[0];
  if (OFF_PROMO.test(s)) return "% off";
  if (FREE_OFFER.test(s)) return "free";
  const t = norm(s);
  for (const l of CATALOG_LANGS) {
    const hit = anyPhrase(t, PROMO[l]);
    if (hit) return hit;
  }
  return null;
}

function policyIssues(item: CatalogItemCheck): CatalogIssue[] {
  // The item's own names: the title only when no item part is given (the shop's name in "<Item> · <Shop>" never counts).
  const names = [item.item_name ?? item.title, item.name_en, item.name_ar, item.name_fr].filter(
    (x): x is string => typeof x === "string" && !!x.trim(),
  );
  const sections = [item.section, item.section_en].filter(
    (x): x is string => typeof x === "string" && !!x.trim(),
  );
  const out: CatalogIssue[] = [];
  const hay = [...names, ...sections].map(norm);
  const med = MEDICINE_BUSINESS.test(String(item.business_type ?? ""))
    ? String(item.business_type)
    : hay.map((h) => findMedicine(stripFoodAntibioticClaims(h))).find(Boolean);
  if (med) out.push(issue("policy_medicine", { found: med }));
  const alcohol =
    item.contains_alcohol === true
      ? "contains_alcohol"
      : (names.find((n) => isAlcohol({ name_en: n })) ??
        (sections.some((s) => isAlcohol({ section: s })) ? sections[0] : null));
  if (alcohol) out.push(issue("policy_alcohol", { found: String(alcohol).slice(0, 40) }));
  // "Cigars" in a Pastries section, or "Cheese cigars", is food: the names and the section are read together.
  const food = TOBACCO_FOOD.test(hay.join(" "));
  const tob = hay
    .map((h) => {
      const hit = anyPhrase(h, TOBACCO);
      return hit && !(food && PASTRY_NAMES.has(hit)) ? hit : null;
    })
    .find(Boolean);
  if (tob) out.push(issue("policy_tobacco", { found: tob }));
  return out;
}

function imageIssues(p: CatalogPhotoCheck): CatalogIssue[] {
  const out: CatalogIssue[] = [];
  if (p.url != null && !/^https:\/\//i.test(String(p.url).trim()))
    out.push(issue("image_not_https"));
  const head = imageHeader(p.bytes);
  const width = head?.width ?? (Number(p.width) > 0 ? Number(p.width) : null);
  const height = head?.height ?? (Number(p.height) > 0 ? Number(p.height) : null);
  const size = p.bytes
    ? p.bytes.length
    : Number(p.size) >= 0 && p.size != null
      ? Number(p.size)
      : null;
  const format = head?.format ?? (p.format ? String(p.format).toLowerCase() : null);
  // Unreadable: bytes we cannot read, or a size no photo has (a header claiming more than 20000 px, the database's limit).
  if (
    (p.bytes && !head && !(width && height)) ||
    (width != null && width > MAX_IMAGE_PX) ||
    (height != null && height > MAX_IMAGE_PX)
  ) {
    out.push(issue("image_unreadable"));
    return out;
  }
  const where = [p.name, p.url].filter(Boolean).map((x) => String(x).split("?")[0]);
  const placeholder =
    (p.sha256 && PLACEHOLDER_SHA256.has(String(p.sha256).toLowerCase())) ||
    where.some((x) => PLACEHOLDER_NAME.test(x.split("/").pop() ?? "")) ||
    (size != null && size < TINY_IMAGE_BYTES) ||
    (size != null &&
      width &&
      height &&
      /^(jpe?g|webp)$/.test(format ?? "") &&
      size / (width * height) < MIN_BYTES_PER_PIXEL);
  if (placeholder) out.push(issue("image_placeholder"));
  if (width && height) {
    if (Math.min(width, height) < MIN_IMAGE_SIDE)
      out.push(issue("image_too_small", { w: width, h: height }));
    else if (Math.max(width, height) > MAX_IMAGE_ASPECT * Math.min(width, height))
      out.push(issue("image_not_square", { w: width, h: height }));
  }
  return out;
}

/**
 * Everything Meta would refuse about an item (and its photo, when one is given), as issues with the problem and the
 * fix in Arabic, English, French and Arabizi; empty when it may go to Meta. A part that is not given is not checked:
 * the title when no title, name or item name is given; the price when neither price key is given; the description
 * when none is given; the photo when no photo is given. Policy reads every name, the section and the flags.
 */
export function validateCatalogItem(
  item: CatalogItemCheck,
  photo?: CatalogPhotoCheck | null,
): CatalogIssue[] {
  const out: CatalogIssue[] = [];
  if (photo) out.push(...imageIssues(photo));
  if ("title" in item || "item_name" in item) out.push(...titleIssues(item));
  if ("price_minor" in item || "price_usd" in item) {
    const p =
      "price_minor" in item && item.price_minor != null
        ? Number(item.price_minor) / 100
        : Number(item.price_usd ?? NaN);
    if (!(Number.isFinite(p) && p > 0)) out.push(issue("price_not_positive"));
  }
  if (typeof item.description === "string" && item.description.trim()) {
    const d = item.description;
    const c = contact(d);
    if (c) out.push(issue("description_contact", { found: c }));
    const pr = promotional(d);
    if (pr) out.push(issue("description_promotional", { found: pr }));
  }
  out.push(...policyIssues(item));
  return out;
}

/** One rule by its code (null when there is none). */
export function ruleFor(code: string): CatalogRule | null {
  return RULE.get(code) ?? null;
}

/**
 * What the merchant reads about the issues, in one language: one line per issue ("<problem> <fix>"), each rule once.
 */
export function issuesText(issues: CatalogIssue[], lang: CatalogLang): string {
  const seen = new Set<string>();
  return issues
    .filter((i) => !seen.has(i.code) && seen.add(i.code))
    .map((i) => `• ${i.message[lang]} ${i.fix[lang]}`)
    .join("\n");
}
