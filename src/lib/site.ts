// Public website helpers (DECISIONS §24, §37): languages in the URL, canonical and hreflang, the WhatsApp link, the head.
// Pure functions: unit-tested in site.test.ts.
import { WHATSAPP_NUMBER } from "./config";

export const LANGS = ["ar", "en", "fr"] as const;
export type SiteLang = (typeof LANGS)[number];
/** Arabic is the default for Lebanon (§24.5). */
export const DEFAULT_LANG: SiteLang = "ar";

export const isLang = (s: unknown): s is SiteLang =>
  typeof s === "string" && (LANGS as readonly string[]).includes(s);
export const dirOf = (l: SiteLang): "rtl" | "ltr" => (l === "ar" ? "rtl" : "ltr");
export const LANG_NAME: Record<SiteLang, string> = { ar: "العربية", en: "English", fr: "Français" };
export const OG_LOCALE: Record<SiteLang, string> = { ar: "ar_LB", en: "en_US", fr: "fr_LB" };

/** The language for a visitor with no language in the URL: the first supported one in Accept-Language, else Arabic. */
export function pickLang(acceptLanguage: string | null | undefined): SiteLang {
  const ranked = (acceptLanguage ?? "")
    .split(",")
    .map((part, i) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = Number(params.find((p) => p.trim().startsWith("q="))?.split("=")[1] ?? 1);
      return {
        base: tag.trim().toLowerCase().split("-")[0] ?? "",
        q: Number.isFinite(q) ? q : 0,
        i,
      };
    })
    .filter((x) => x.q > 0 && isLang(x.base))
    .sort((a, b) => b.q - a.q || a.i - b.i);
  return (ranked[0]?.base as SiteLang | undefined) ?? DEFAULT_LANG;
}

/**
 * The private apps: staff pages and claim links. Everything else is public and held to the website budgets (JavaScript under
 * 150 KB, no full error SDK, hydration after load).
 */
export const isPrivatePath = (pathname: string) =>
  /^\/(merchant|driver|admin|claim|for-business)(\/|$)/.test(pathname);

/** `/ar` + `/places/x` -> `/ar/places/x`; the home page is `/ar`. */
export const localePath = (lang: SiteLang, path = "/") =>
  path === "/" || path === "" ? `/${lang}` : `/${lang}${path.startsWith("/") ? path : `/${path}`}`;

/** Splits `/fr/places/x` into its language and the language-free path. */
export function splitLangPath(pathname: string): { lang: SiteLang | null; path: string } {
  const m = /^\/([a-z]{2})(\/.*)?$/.exec(pathname);
  if (m && isLang(m[1])) return { lang: m[1], path: m[2] || "/" };
  return { lang: null, path: pathname || "/" };
}
export const swapLang = (pathname: string, to: SiteLang) =>
  localePath(to, splitLangPath(pathname).path);

/** The `?u=` page of a "Not on Alo King yet" list (DECISIONS §39.3): 2-100, anything else is the first page. */
export function unclaimedPage(v: unknown): number | undefined {
  const n =
    typeof v === "number" ? v : typeof v === "string" && /^\d{1,3}$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 2 && n <= 100 ? n : undefined;
}

/** The `?page=` of a long list (the photo credits): 2-9999, anything else is the first page. */
export function listPage(v: unknown): number | undefined {
  const n =
    typeof v === "number" ? v : typeof v === "string" && /^\d{1,4}$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 2 && n <= 9999 ? n : undefined;
}

/** Fills {name} placeholders. A missing value leaves nothing behind. */
export const fmt = (s: string, v: Record<string, string | number | null | undefined> = {}) =>
  s.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ""));

/** Picks a record's name in a language, falling back to the other languages. */
export function pickName(
  r: Partial<Record<`${string}_ar` | `${string}_en` | `${string}_fr`, string | null | undefined>>,
  base: string,
  lang: SiteLang,
): string {
  const get = (l: SiteLang) =>
    (r as Record<string, string | null | undefined>)[`${base}_${l}`] ?? null;
  const order: SiteLang[] =
    lang === "ar" ? ["ar", "en", "fr"] : lang === "fr" ? ["fr", "en", "ar"] : ["en", "fr", "ar"];
  for (const l of order) {
    const v = get(l);
    if (v && v.trim()) return v.trim();
  }
  return "";
}

// ---- WhatsApp ------------------------------------------------------------------------------------------------------
/**
 * The "Order on WhatsApp" link to the Customer number, with text pre-filled from context (§37.1). While no number is
 * configured (VITE_WHATSAPP_NUMBER, set when the Customer number exists) it returns null and the caller links to the
 * contact page instead; a dead wa.me link must never ship.
 */
export function waLink(text: string, number: string = WHATSAPP_NUMBER): string | null {
  const n = (number || "").replace(/\D/g, "");
  if (!n) return null;
  return `https://wa.me/${n}?text=${encodeURIComponent(text.slice(0, 900))}`;
}

/**
 * The shop a pre-filled WhatsApp text is about, as the bot reads it (CUSTOMER-EXPERIENCE §3.1 #2): "(shop:<slug>)" after the
 * shop's name, so a shop page's "Order on WhatsApp" (or a QR printed from it) opens exactly that shop after the location step,
 * never a guess from its name. Nothing for a slug that is not one.
 */
export const shopRef = (slug: string | null | undefined): string =>
  typeof slug === "string" && /^[a-z0-9]+(-[a-z0-9]+){0,15}$/.test(slug) ? `(shop:${slug})` : "";
/** "Eatout (shop:eatout-baakline)": the name a vendor's wa text shows, with the bot's key right after it. */
export const withShop = (name: string, slug: string | null | undefined): string =>
  [name, shopRef(slug)].filter(Boolean).join(" ");

// ---- Head ----------------------------------------------------------------------------------------------------------
export type RequestInfo = { origin: string; indexing: boolean };

type Meta = Record<string, string>;
export type HeadInput = {
  lang: SiteLang;
  /** Language-free path of this page: `/`, `/places/chf-baakline`. */
  path: string;
  title: string;
  description: string;
  info: RequestInfo;
  /** A page that must not be indexed even when the site is (thin place pages, private pages). */
  noindex?: boolean;
  type?: "website" | "article" | "restaurant.restaurant";
  jsonLd?: unknown[];
  image?: string;
};

export function buildHead(i: HeadInput) {
  const url = (l: SiteLang) => `${i.info.origin}${localePath(l, i.path)}`;
  const robots =
    i.info.indexing && !i.noindex ? "index,follow,max-image-preview:large" : "noindex,nofollow";
  const image = i.image ?? `${i.info.origin}/og-image.png`;
  const meta: Meta[] = [
    { title: i.title },
    { name: "description", content: i.description },
    { name: "robots", content: robots },
    { property: "og:site_name", content: "Alo King" },
    { property: "og:type", content: i.type ?? "website" },
    { property: "og:title", content: i.title },
    { property: "og:description", content: i.description },
    { property: "og:url", content: url(i.lang) },
    { property: "og:locale", content: OG_LOCALE[i.lang] },
    ...LANGS.filter((l) => l !== i.lang).map((l) => ({
      property: "og:locale:alternate",
      content: OG_LOCALE[l],
    })),
    { property: "og:image", content: image },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: i.title },
    { name: "twitter:description", content: i.description },
  ];
  const links = [
    { rel: "canonical", href: url(i.lang) },
    ...LANGS.map((l) => ({ rel: "alternate", hrefLang: l, href: url(l) })),
    { rel: "alternate", hrefLang: "x-default", href: url(DEFAULT_LANG) },
  ];
  const scripts = (i.jsonLd ?? []).map((o) => ({
    type: "application/ld+json",
    children: JSON.stringify(o).replace(/</g, "\\u003c"),
  }));
  return { meta, links, scripts };
}

/** Head for a private or utility page: never indexed, no alternates. */
export function privateHead(title: string, description = "") {
  return {
    meta: [
      { title },
      { name: "description", content: description },
      { name: "robots", content: "noindex,nofollow" },
    ],
  };
}

// ---- Money ---------------------------------------------------------------------------------------------------------
export const usd = (n: number | string | null | undefined) => `$${(Number(n) || 0).toFixed(2)}`;
/** LBP at a given rate (never a hard-coded one): rounded to a whole number, grouped. */
export const lbpAt = (usdAmount: number, rate: number, lang: SiteLang = "en") =>
  `${Math.round(usdAmount * rate).toLocaleString(lang === "ar" ? "en-US" : lang === "fr" ? "fr-FR" : "en-US")}`;

/** A value set inside running text in its own direction (U+2068 … U+2069), so "$2.00" or "20 km" reads right in Arabic. */
export const iso = (v: string | number) => `⁨${v}⁩`;
