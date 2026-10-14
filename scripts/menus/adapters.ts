// Menu-harvest adapters (DECISIONS §39.4 source 2): what a menu page loaded (its JSON responses, its HTML, a PDF's
// text) → a draft in the shape menu_draft_check() accepts, through the same validateDraft() as the merchant's own
// import, so the same rules hold: names as written, prices only as printed, a currency only when the page states
// one (a bare number stays "price without currency" and the merchant is asked at approval), instruction-like text
// dropped. Pure functions; scripts/menus/harvest.ts does the fetching.
//
// Platforms (Omega, qr-order.online, menutigr, qrscan-menu, Restbits/Thrubits, Coverbox, mymenus.site, ScanGOW) are
// single-page apps that load their menu as JSON. Rather than one brittle parser per platform, `fromJson` walks any
// JSON for lists of items that have a name and a price, under a parent that has a name (the section), with key
// preferences per platform where they are known. Directory pages (leb.directory, leb.guide) and plain sites carry
// schema.org Menu JSON-LD or a menu as text.
import {
  parseMenuText,
  validateDraft,
  type Draft,
} from "../../supabase/functions/_shared/menu-draft.ts";

type J = Record<string, unknown>;
const isObj = (v: unknown): v is J => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) =>
  typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
const ARABIC = /[؀-ۿ]/;

const NAME_KEYS = [
  "name",
  "title",
  "item_name",
  "itemName",
  "ItemName",
  "Name",
  "Title",
  "product_name",
  "productName",
  "label",
  "description_short",
];
const NAME_EN_KEYS = [
  "name_en",
  "nameEn",
  "NameEn",
  "en_name",
  "title_en",
  "english_name",
  "NameEN",
];
const NAME_AR_KEYS = [
  "name_ar",
  "nameAr",
  "NameAr",
  "ar_name",
  "title_ar",
  "arabic_name",
  "NameAR",
  "name_arabic",
];
const NAME_FR_KEYS = ["name_fr", "nameFr", "NameFr", "fr_name", "title_fr"];
const DESC_KEYS = [
  "description",
  "desc",
  "Description",
  "details",
  "ingredients",
  "subtitle",
  "description_en",
];
const PRICE_KEYS = [
  "price",
  "Price",
  "unit_price",
  "unitPrice",
  "UnitPrice",
  "sellingPrice",
  "selling_price",
  "salePrice",
  "sale_price",
  "amount",
  "cost",
  "price_usd",
  "priceUSD",
  "price_lbp",
  "priceLBP",
  "Price1",
  "price1",
];
const CURRENCY_KEYS = [
  "currency",
  "Currency",
  "currency_code",
  "currencyCode",
  "currencySymbol",
  "currency_symbol",
  "curr",
  "symbol",
];
const SECTION_KEYS = [
  "name",
  "title",
  "category_name",
  "categoryName",
  "CategoryName",
  "Name",
  "Title",
  "group_name",
  "section",
];
const PRICE_LIST_KEYS = ["prices", "Prices", "priceList", "price_list", "variants", "sizes"];
// Lists that hold items inside a section, as platforms name them.
const ITEM_LIST_KEYS = [
  "itemList",
  "item_list",
  "items",
  "products",
  "Items",
  "Products",
  "menu_items",
  "menuItems",
  "dishes",
  "children",
  "MenuItems",
  "articles",
];

/** A currency stated on the page: "$", "USD", "LBP", "LL", "L.L.", "ل.ل" → USD / LBP; anything else → null. */
export function currencyWord(v: unknown): "USD" | "LBP" | null {
  const s = str(v).toLowerCase().replace(/\s+/g, "");
  if (!s) return null;
  if (/^(\$|usd|us\$|dollars?|دولار)$/.test(s)) return "USD";
  if (/^(lbp|ll|l\.l\.?|ل\.?ل\.?|ليرة|lira|livres?)$/.test(s)) return "LBP";
  return null;
}

/** Translations as an object: {"en": …, "ar": …} or {"nameEnglish": …, "nameArabic": …}. */
function localized(v: unknown): { en?: string; ar?: string; fr?: string } {
  if (!isObj(v)) return {};
  const first = (keys: string[]) => keys.map((k) => str(v[k])).find(Boolean) || undefined;
  return {
    en: first(["en", "EN", "english", "English", "nameEnglish", "name_en"]),
    ar: first(["ar", "AR", "arabic", "Arabic", "nameArabic", "name_ar"]),
    fr: first(["fr", "FR", "french", "French", "nameFrench", "name_fr"]),
  };
}

/** The first non-empty value of the keys present on an object. */
const pick = (o: J, keys: string[]) => {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return v;
    const t = localized(v);
    if (t.en ?? t.ar ?? t.fr) return t.en ?? t.ar ?? t.fr;
  }
  return undefined;
};

/** A section's name from its holder object, in English and Arabic when the platform gives both. */
function sectionNames(holder: J | null): { name_en?: string; name_ar?: string } {
  if (!holder) return {};
  for (const k of SECTION_KEYS) {
    const t = localized(holder[k]);
    if (t.en || t.ar)
      return { ...(t.en ? { name_en: t.en } : {}), ...(t.ar ? { name_ar: t.ar } : {}) };
  }
  const n = pick(holder, SECTION_KEYS);
  return n === undefined ? {} : { [ARABIC.test(String(n)) ? "name_ar" : "name_en"]: String(n) };
}

/** A price value from an item: a number, a numeric string, a price string with a currency, or prices[0]. */
function priceOf(o: J): { text: string | null; currency: "USD" | "LBP" | null } {
  let raw: unknown = pick(o, PRICE_KEYS);
  let cur = currencyWord(pick(o, CURRENCY_KEYS));
  if (raw === undefined) {
    const list = PRICE_LIST_KEYS.map((k) => o[k]).find(Array.isArray);
    if (list?.length && isObj(list[0])) {
      raw = pick(list[0] as J, PRICE_KEYS);
      cur = currencyWord(pick(list[0] as J, CURRENCY_KEYS)) ?? cur;
    }
  }
  if (raw === undefined || raw === null || raw === "") return { text: null, currency: null };
  return { text: str(raw), currency: cur };
}

type RawItem = {
  category?: string;
  name?: string;
  name_ar?: string;
  name_en?: string;
  name_fr?: string;
  description?: string;
  price_text: string | null;
};

/** An object reads as a menu item when it has a name and a price-ish key (even a null price). */
function asItem(o: J, docCurrency: "USD" | "LBP" | null): RawItem | null {
  // {"name": {"nameEnglish": …, "nameArabic": …}} carries both languages.
  const t = NAME_KEYS.map((k) => localized(o[k])).find((x) => x.en || x.ar || x.fr) ?? {};
  const name = t.en || t.ar || t.fr ? undefined : pick(o, NAME_KEYS);
  const en = pick(o, NAME_EN_KEYS) ?? t.en;
  const ar = pick(o, NAME_AR_KEYS) ?? t.ar;
  const fr = pick(o, NAME_FR_KEYS) ?? t.fr;
  if (!name && !en && !ar && !fr) return null;
  const hasPriceKey = [...PRICE_KEYS, ...PRICE_LIST_KEYS].some((k) => k in o);
  if (!hasPriceKey) return null;
  const p = priceOf(o);
  const currency = p.currency ?? docCurrency;
  // A number with a currency stated by the page or the item becomes "9 USD" / "150000 LBP"; otherwise the number
  // alone (validateDraft keeps it and leaves the currency for the merchant).
  const price_text =
    p.text === null
      ? null
      : currency && !/[^\d.,\s]/.test(p.text)
        ? `${p.text} ${currency}`
        : p.text;
  const desc = pick(o, DESC_KEYS);
  const item: RawItem = { price_text };
  // A flat list of every item, each naming its category (J.O's House of Subs): split into sections later.
  const cat = ["category", "categoryName", "category_name", "CategoryName"]
    .map((k) => o[k])
    .find((v) => typeof v === "string" && v.trim());
  if (typeof cat === "string") item.category = cat.trim();
  if (ar) item.name_ar = String(ar);
  if (en) item.name_en = String(en);
  if (fr) item.name_fr = String(fr);
  if (name && !ar && !en && !fr) item.name = String(name);
  else if (name && !item[ARABIC.test(String(name)) ? "name_ar" : "name_en"])
    item[ARABIC.test(String(name)) ? "name_ar" : "name_en"] = String(name);
  if (typeof desc === "string" && desc !== name) item.description = desc;
  return item;
}

/** The document-wide currency, when the JSON states exactly one. */
function docCurrencyOf(root: unknown): "USD" | "LBP" | null {
  const seen = new Set<string>();
  const walk = (v: unknown, depth: number) => {
    if (depth > 12 || seen.size > 1) return;
    if (Array.isArray(v)) v.forEach((x) => walk(x, depth + 1));
    else if (isObj(v)) {
      for (const k of CURRENCY_KEYS) {
        const c = currencyWord(v[k]);
        if (c) seen.add(c);
      }
      Object.values(v).forEach((x) => walk(x, depth + 1));
    }
  };
  walk(root, 0);
  return seen.size === 1 ? ([...seen][0] as "USD" | "LBP") : null;
}

/**
 * Any JSON → sections of items. A list where at least two entries read as items is a section, named after the
 * object holding the list (its name or title), else after the list's key. Lists of sections nest naturally.
 */
export function fromJson(root: unknown): Draft {
  const docCurrency = docCurrencyOf(root);
  const sections: { names: { name_en?: string; name_ar?: string }; items: RawItem[] }[] = [];
  const seenLists = new Set<unknown>();
  const walk = (v: unknown, holder: J | null, key: string | null, depth: number) => {
    if (depth > 14) return;
    if (Array.isArray(v)) {
      if (seenLists.has(v)) return;
      seenLists.add(v);
      const items = v.filter(isObj).map((o) => asItem(o, docCurrency));
      const found = items.filter((x): x is RawItem => !!x);
      // A list of sections whose entries also carry a price-ish key would read as items; prefer the nested lists.
      const nested = v.some(
        (o) =>
          isObj(o) && ITEM_LIST_KEYS.some((k) => Array.isArray(o[k]) && (o[k] as unknown[]).length),
      );
      if (found.length >= 2 && found.length >= v.length * 0.6 && !nested) {
        const cats = [...new Set(found.map((i) => i.category).filter(Boolean))] as string[];
        if (cats.length >= 2 && found.every((i) => i.category)) {
          for (const c of cats)
            sections.push({
              names: { [ARABIC.test(c) ? "name_ar" : "name_en"]: c },
              items: found.filter((i) => i.category === c),
            });
          return;
        }
        const names = sectionNames(holder);
        sections.push({
          names:
            names.name_en || names.name_ar
              ? names
              : key && !/^\d+$/.test(key) && !ITEM_LIST_KEYS.includes(key)
                ? { name_en: key }
                : {},
          items: found,
        });
        return;
      }
      v.forEach((x) => walk(x, holder, key, depth + 1));
    } else if (isObj(v)) {
      for (const [k, x] of Object.entries(v)) walk(x, v, k, depth + 1);
    }
  };
  walk(root, null, null, 0);
  // The same item list loaded twice (two endpoints) counts once.
  const uniq = new Map<string, (typeof sections)[number]>();
  for (const s of sections) {
    const sig = JSON.stringify(
      s.items.map((i) => [i.name ?? i.name_en ?? i.name_ar, i.price_text]),
    );
    if (!uniq.has(sig)) uniq.set(sig, s);
  }
  return validateDraft({
    sections: [...uniq.values()].map((s) => ({
      ...s.names,
      items: s.items.map(({ category: _c, ...i }) => i),
    })),
  });
}

/** schema.org Menu / MenuSection / MenuItem in <script type="application/ld+json"> blocks. */
export function fromJsonLd(html: string): Draft {
  const blocks = [
    ...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi),
  ].map((m) => m[1]);
  const sections: { name?: string; items: RawItem[] }[] = [];
  const types = (o: J) =>
    Array.isArray(o["@type"]) ? (o["@type"] as string[]) : [str(o["@type"])];
  const itemOf = (o: J): RawItem => {
    const offers = Array.isArray(o.offers) ? (o.offers[0] as J) : (o.offers as J | undefined);
    const price = offers ? str(offers.price) : "";
    const cur = offers ? currencyWord(offers.priceCurrency) : null;
    return {
      name: str(o.name),
      ...(str(o.description) ? { description: str(o.description) } : {}),
      price_text: price ? (cur ? `${price} ${cur}` : price) : null,
    };
  };
  const walk = (v: unknown, depth: number) => {
    if (depth > 10) return;
    if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1));
    if (!isObj(v)) return;
    if (types(v).includes("MenuSection")) {
      const items = (
        Array.isArray(v.hasMenuItem) ? v.hasMenuItem : v.hasMenuItem ? [v.hasMenuItem] : []
      )
        .filter(isObj)
        .map(itemOf);
      if (items.length) sections.push({ name: str(v.name) || undefined, items });
      walk(v.hasMenuSection, depth + 1);
      return;
    }
    if (types(v).includes("MenuItem")) {
      sections.push({ items: [itemOf(v)] });
      return;
    }
    for (const x of Object.values(v)) walk(x, depth + 1);
  };
  for (const b of blocks) {
    try {
      walk(JSON.parse(b), 0);
    } catch {
      // a broken block is skipped
    }
  }
  return validateDraft({
    sections: sections.map((s) => ({ ...(s.name ? { name_en: s.name } : {}), items: s.items })),
  });
}

/**
 * A page's visible text read as a menu by the same rules as a pasted menu (parseMenuText), keeping only priced
 * lines: navigation, addresses and opening hours on a website are not items.
 */
const PHONE = /\+\s?\d{2,3}[\s-]?\d|\b\d{1,2}[\s-]\d{3}[\s-]\d{3}\b|\b\d{8}\b/;
const HOURS = /\b\d{1,2}(:\d{2})?\s?(am|pm)\b|\b\d{1,2}:\d{2}\s?[-–]\s?\d{1,2}:\d{2}\b/i;

export function fromText(text: string, opts: { requireCurrency?: boolean } = {}): Draft {
  // Phone numbers, opening hours and years are numbers, not prices.
  const d = parseMenuText(
    text
      .split(/\r?\n/)
      .filter((l) => !PHONE.test(l) && !HOURS.test(l) && !/©|\b(19|20)\d{2}\b/.test(l))
      .join("\n"),
  );
  // On a web page, a bare number is too often a rating, a review count or a date ("Service: 5.0", "reviews 29"):
  // there only lines with a stated currency count. A PDF menu keeps bare numbers (the merchant is asked).
  const sections = d.sections
    .map((s) => ({
      ...s,
      items: s.items.filter(
        (i) => i.price !== null && (!opts.requireCurrency || i.currency !== null),
      ),
    }))
    .filter((s) => s.items.length);
  return { sections, warnings: d.warnings.filter((w) => !w.startsWith("no price for")) };
}

export const pricedItems = (d: Draft) =>
  d.sections.reduce((n, s) => n + s.items.filter((i) => i.price !== null).length, 0);
export const allItems = (d: Draft) => d.sections.reduce((n, s) => n + s.items.length, 0);

/** The candidate with the most priced items (ties: more items), or null below `minPriced` priced items. */
export function bestDraft(
  candidates: { method: string; draft: Draft }[],
  minPriced = 3,
): { method: string; draft: Draft } | null {
  const ok = candidates.filter((c) => pricedItems(c.draft) >= minPriced);
  ok.sort(
    (a, b) => pricedItems(b.draft) - pricedItems(a.draft) || allItems(b.draft) - allItems(a.draft),
  );
  return ok[0] ?? null;
}

/** Visible text of an HTML page: scripts, styles and tags removed, block elements on their own lines. */
export function htmlText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h[1-6]|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

/** Links on a page that look like its menu (same site, or a PDF / Google Drive file), best first. */
export function menuLinks(html: string, base: string): string[] {
  const out: string[] = [];
  const baseUrl = new URL(base);
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let u: URL;
    try {
      u = new URL(m[1], baseUrl);
    } catch {
      continue;
    }
    const label = htmlText(m[2]).toLowerCase();
    const isMenu =
      /\b(menu|menus|carte|our food|food|order|shop|products)\b|منيو|قائمة|المنيو|لائحة/.test(
        label,
      ) || /menu|carte|^\/shop\b/i.test(u.pathname);
    const isFile = /\.pdf$/i.test(u.pathname) || /^(drive|docs)\.google\.com$/.test(u.hostname);
    if (
      (isMenu && u.hostname === baseUrl.hostname) ||
      (isFile && (isMenu || /\.pdf$/i.test(u.pathname)))
    )
      out.push(u.toString());
  }
  return [...new Set(out)].slice(0, 3);
}

/** A Google Drive file link → its direct download URL; other links unchanged. */
export function driveDownloadUrl(link: string): string {
  const m = link.match(/\/file\/d\/([\w-]{10,})/) ?? link.match(/[?&]id=([\w-]{10,})/);
  return m && /google\.com/.test(link)
    ? `https://drive.google.com/uc?export=download&id=${m[1]}`
    : link;
}

/**
 * Omega Software menus (menu.omegasoftware.ca/<slug>): `getRestaurantMenu` (categories → groups → items, each with
 * PRICE and modifier groups) and `getRestaurantData` (the branch's currency: DESCRIPTION "USD" / "LBP" and
 * DIGITNUMBER, the decimals it prints). A price is the number the menu shows, rounded to those decimals, in that
 * currency; modifier groups become options (MANDATORY → at least one, QTY → at most that many). Omega's "A" names
 * are a second name, Arabic only on some menus: they are kept as name_ar only when written in Arabic.
 */
export function fromOmega(menu: unknown, data: unknown): Draft {
  const m = isObj(menu) ? menu : {};
  const c = isObj(data) && isObj(data.currency) ? (data.currency as J) : {};
  // The currency the menu prints is the branch's main one; a `currency` that is not it (the branch's second
  // currency) leaves the prices without a currency, asked at approval.
  const branch =
    isObj(data) && isObj(data.branch) ? (data.branch as J) : isObj(m.branch) ? (m.branch as J) : {};
  const isMain = branch.MAINCURRENCY === undefined || String(branch.MAINCURRENCY) === String(c.ID);
  const currency = isMain ? (currencyWord(c.DESCRIPTION) ?? currencyWord(c.SYNBOL)) : null;
  const digits = Number.isInteger(c.DIGITNUMBER)
    ? Math.min(3, Math.max(0, c.DIGITNUMBER as number))
    : 2;
  const round = (v: unknown) => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) && n >= 0 ? Number(n.toFixed(digits)) : null;
  };
  const priceText = (v: unknown) => {
    const n = round(v);
    if (n === null) return null;
    const t = n.toFixed(digits).replace(/\.0+$/, "");
    return currency ? `${t} ${currency}` : t;
  };
  const names = (en: unknown, alt: unknown) => {
    const a = str(en);
    const b = str(alt);
    const out: { name_en?: string; name_ar?: string } = {};
    if (a) out[ARABIC.test(a) ? "name_ar" : "name_en"] = a;
    if (b && ARABIC.test(b) && !out.name_ar) out.name_ar = b;
    return out;
  };
  const sections: unknown[] = [];
  for (const cat of Array.isArray(m.menu) ? m.menu.filter(isObj) : []) {
    const groups = (Array.isArray(cat.groups) ? cat.groups.filter(isObj) : []).filter(
      (g) => Array.isArray(g.items) && g.items.length,
    );
    for (const g of groups) {
      const items = (g.items as unknown[]).filter(isObj).map((it) => {
        const sizes = (Array.isArray(it.sizes) ? it.sizes.filter(isObj) : []).filter(
          (z) => pick(z, ["SIZENAME", "SIZE", "ITEMNAME", "DESCRIPTION", "NAME"]) !== undefined,
        );
        // A choice's price is what it adds (menu_options.price_delta_usd): with sizes, the item costs its cheapest
        // size and each size adds the difference, so "Single 500,000 / Double 800,000" stays exactly as printed.
        const sizePrices = sizes.map((z) => round(z.PRICE));
        const base = sizePrices.every((p) => p !== null)
          ? Math.min(...(sizePrices as number[]))
          : null;
        const options = [
          ...(sizes.length
            ? [
                {
                  name: "Size",
                  min: 1,
                  max: 1,
                  choices: sizes.map((z, i) => ({
                    name: String(pick(z, ["SIZENAME", "SIZE", "ITEMNAME", "DESCRIPTION", "NAME"])),
                    price_text:
                      base === null
                        ? null
                        : priceText(Number(((sizePrices[i] as number) - base).toFixed(digits))),
                  })),
                },
              ]
            : []),
          ...(Array.isArray(it.modifiers) ? it.modifiers.filter(isObj) : [])
            .filter((mg) => Array.isArray(mg.items) && mg.items.length)
            .map((mg) => {
              const choices = (mg.items as unknown[]).filter(isObj).map((x) => ({
                name: str(x.ITEMNAME),
                price_text: priceText(x.PRICE),
              }));
              const qty = Number(mg.QTY);
              return {
                name: str(mg.GROUPNAME) || "Options",
                min: Number(mg.MANDATORY) ? 1 : 0,
                max: qty > 0 ? qty : choices.length,
                choices,
              };
            }),
        ];
        // Without a price for every size, the sizes carry no price and the merchant prices them at approval.
        const price = sizes.length
          ? base !== null
            ? priceText(base)
            : null
          : Number(it.PRICE) > 0
            ? priceText(it.PRICE)
            : null;
        return {
          ...names(it.ITEMNAME, it.AITEMNAME),
          ...(str(it.ITEMDESCRIPTION) ? { description: str(it.ITEMDESCRIPTION) } : {}),
          price_text: price,
          confidence: 0.9,
          ...(options.length ? { options } : {}),
        };
      });
      sections.push({
        ...(groups.length === 1
          ? names(cat.DESCRIPTION, cat.ADESCRIPTION)
          : names(g.GROUPNAME, g.AGROUPNAME)),
        items,
      });
    }
  }
  return validateDraft({ sections });
}

/**
 * Odoo eCommerce product cards (Batloun Dairy): `<div class="oe_product_cart" aria-label="Name">` with the price in
 * `<span class="oe_currency_value">3.60</span>` after or before its currency symbol. One "Products" section.
 */
export function fromProductCards(html: string): Draft {
  const items: unknown[] = [];
  const seen = new Set<string>();
  const cards = html.split(/(?=<div[^>]+class="[^"]*\boe_product_cart\b)/);
  for (const card of cards.filter((c) => /^<div[^>]+class="[^"]*\boe_product_cart\b/.test(c))) {
    const name = htmlText(card.match(/aria-label="([^"]+)"/)?.[1] ?? "");
    const price = card.match(
      /data-oe-type="monetary"[^>]*>([\s\S]{0,40}?)<span class="oe_currency_value">([\d.,]+)<\/span>([\s\S]{0,40}?)<\/span>/,
    );
    if (!name || !price || seen.has(name)) continue;
    seen.add(name);
    const cur = currencyWord(htmlText(price[1])) ?? currencyWord(htmlText(price[3]));
    items.push({ name, price_text: cur ? `${price[2]} ${cur}` : price[2], confidence: 0.9 });
  }
  return validateDraft({ sections: items.length ? [{ name_en: "Products", items }] : [] });
}

// Menu platforms whose API lives on their own host, not the merchant's.
const PLATFORM_HOSTS = /(^|\.)(omegasoftware\.ca|menutigr\.com|qr-order\.online|qrscan-menu\.com)$/;
// The registrable part of a host: "x.com.lb" (Lebanese second-level domains), else the last two labels.
const site = (host: string) => {
  const labels = host.replace(/^www\./, "").split(".");
  const n = labels.length >= 3 && /^(com|org|net|edu|gov)$/.test(labels[labels.length - 2]) ? 3 : 2;
  return labels.slice(-n).join(".");
};

/**
 * Whether a JSON response belongs to the menu page that loaded it: same site, a known menu platform, or an API host
 * named after the site ("joshouseofsubs-api.onrender.com" for joshouseofsubs.com). Ads, analytics and feature-flag
 * services (googleadservices, amplitude, featureassets, stripe…) are not the merchant's menu.
 */
export function jsonFromSite(jsonUrl: string, pageUrl: string): boolean {
  let j: URL;
  let p: URL;
  try {
    j = new URL(jsonUrl);
    p = new URL(pageUrl);
  } catch {
    return false;
  }
  if (site(j.hostname) === site(p.hostname) || PLATFORM_HOSTS.test(j.hostname)) return true;
  const key = site(p.hostname).split(".")[0];
  return key.length >= 5 && j.hostname.split(".")[0].includes(key);
}
