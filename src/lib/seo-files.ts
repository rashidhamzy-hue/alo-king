// robots.txt, llms.txt and sitemaps (DECISIONS §24.5, §24.6, §5). Pure builders: tested in seo-files.test.ts.
import { LANGS, DEFAULT_LANG, localePath, pickName, usd, type RequestInfo } from "./site";
import { MIN_MERCHANTS_TO_INDEX } from "./site-config";
import type { SiteOverview } from "./site-data";

/** Paths that are never for search engines: private apps and tracking links. */
const PRIVATE = [
  "/merchant",
  "/driver",
  "/admin",
  "/claim",
  "/track",
  "/ar/track",
  "/en/track",
  "/fr/track",
  // Forms: useful to a person, nothing for a search result.
  ...(["ar", "en", "fr"] as const).flatMap((l) => [`/${l}/claim`, `/${l}/register`]),
];
/** The crawlers that answer questions in assistants and search (DECISIONS §24.6). */
const WELCOME = [
  "Googlebot",
  "Bingbot",
  "GPTBot",
  "ClaudeBot",
  "PerplexityBot",
  "Google-Extended",
  "Twitterbot",
  "facebookexternalhit",
];

export function robotsTxt(info: RequestInfo): string {
  // Until the site is switched to indexing (cut-over), every deployment asks crawlers to stay out.
  if (!info.indexing) return "User-agent: *\nDisallow: /\n";
  const disallow = PRIVATE.map((p) => `Disallow: ${p}`).join("\n");
  const allow = WELCOME.map((b) => `User-agent: ${b}\nAllow: /\n${disallow}\n`).join("\n");
  return `${allow}\nUser-agent: *\nAllow: /\n${disallow}\n\nSitemap: ${info.origin}/sitemap.xml\n`;
}

export const SITEMAP_KINDS = ["pages", "places", "cuisines", "vendors"] as const;
export type SitemapKind = (typeof SITEMAP_KINDS)[number];

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function sitemapIndex(origin: string, lastmod?: string): string {
  const items = SITEMAP_KINDS.map(
    (k) =>
      `<sitemap><loc>${esc(`${origin}/sitemap/${k}.xml`)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</sitemap>`,
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${items}</sitemapindex>\n`;
}

export type SitemapEntry = { path: string; lastmod?: string };

/** A urlset where every page lists its three language versions (hreflang) and an x-default. */
export function urlset(origin: string, entries: SitemapEntry[]): string {
  const body = entries
    .flatMap((e) =>
      LANGS.map((l) => {
        const alts = [
          ...LANGS.map(
            (a) =>
              `<xhtml:link rel="alternate" hreflang="${a}" href="${esc(origin + localePath(a, e.path))}"/>`,
          ),
          `<xhtml:link rel="alternate" hreflang="x-default" href="${esc(origin + localePath(DEFAULT_LANG, e.path))}"/>`,
        ].join("");
        return `<url><loc>${esc(origin + localePath(l, e.path))}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ""}${alts}</url>`;
      }),
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${body}</urlset>\n`;
}

const STATIC_PAGES = [
  "/",
  "/places",
  "/cuisine",
  "/send-home",
  "/help",
  "/contact",
  "/for-merchants",
  "/drivers",
  "/legal/terms",
  "/legal/privacy",
  "/legal/refund",
  "/legal/cookies",
  "/legal/merchant-terms",
  "/legal/collection-mandate",
];

export function sitemapEntries(
  kind: SitemapKind,
  overview: SiteOverview,
  vendors: { slug: string; updated_at: string }[],
): SitemapEntry[] {
  switch (kind) {
    case "pages":
      return STATIC_PAGES.map((path) => ({ path }));
    // Thin pages stay out of the sitemap, as they stay out of the index (§24.5).
    case "places":
      return overview.places
        .filter((p) => p.merchants >= MIN_MERCHANTS_TO_INDEX)
        .map((p) => ({ path: `/places/${p.slug}` }));
    case "cuisines":
      return overview.cuisines
        .filter((c) => c.vendors >= MIN_MERCHANTS_TO_INDEX)
        .map((c) => ({ path: `/cuisine/${c.tag}` }));
    case "vendors":
      return vendors.map((v) => ({ path: `/m/${v.slug}`, lastmod: v.updated_at.slice(0, 10) }));
  }
}

/** llms.txt: what Alo King is, where it delivers, how to order, and links to the live place and shop lists (§24.6). */
export function llmsTxt(
  origin: string,
  o: SiteOverview,
  vendors: { slug: string; updated_at: string }[],
): string {
  const url = (path: string) => `${origin}${localePath("en", path)}`;
  const fee =
    o.fees.min_usd != null && o.fees.max_usd != null
      ? ` Delivery costs ${usd(o.fees.min_usd)} to ${usd(o.fees.max_usd)}, by road distance, and is shown before you confirm.`
      : "";
  const places = o.places.length
    ? o.places
        .map(
          (p) =>
            `- [${pickName(p, "name", "en")}](${url(`/places/${p.slug}`)}): ${p.merchants} shop${p.merchants === 1 ? "" : "s"}`,
        )
        .join("\n")
    : "- Opening soon: Baakline, Bakaata, Semqanieh and Beiteddine in the Chouf, then village by village.";
  const cuisines = o.cuisines.length
    ? o.cuisines
        .map((c) => `- [${pickName(c, "name", "en")}](${url(`/cuisine/${c.tag}`)}): ${c.vendors}`)
        .join("\n")
    : "";
  const shops = vendors
    .slice(0, 200)
    .map((v) => `- ${url(`/m/${v.slug}`)}`)
    .join("\n");
  return `# Alo King (ألو كينغ)

> Alo King lets people in Lebanon order food and everyday essentials from local shops by chatting on WhatsApp, in Arabic, English, French or Arabizi. No app and no sign-up. Alo means "hello" in Arabic. Customers can also order for family in Lebanon from abroad (Send Home, opening soon).

## How to order
- Open WhatsApp from any page with "Order on WhatsApp", say hello, share your location pin, pick from the menu or type or send a voice note, check the summary, and tap Confirm.
- Pay cash on delivery, in US dollars or Lebanese pounds if the shop takes both. Totals are shown in both currencies at the day's rate.
- Prices are set by each shop. Alo King never adds to a menu price.${fee}

## Where it delivers
Each shop sets its own delivery radius${o.fees.max_km != null ? `, up to ${o.fees.max_km} km by road` : ""}. Places with shops switched on:
${places}
${cuisines ? `\n## Cuisines\n${cuisines}\n` : ""}${shops ? `\n## Shops (claimed by their owners)\n${shops}\n` : ""}
## Pages
- [Where Alo King delivers](${url("/places")})
- [Help and answers](${url("/help")})
- [Send Home: order for family in Lebanon from abroad](${url("/send-home")})
- [Contact](${url("/contact")})
- [For merchants: claim your shop and take orders on WhatsApp](${url("/for-merchants")})
- [Drive with Alo King](${url("/drivers")})
- [Privacy](${url("/legal/privacy")}), [Terms](${url("/legal/terms")}), [Refunds](${url("/legal/refund")})

## Languages
Every page exists in Arabic (${origin}/ar), English (${origin}/en) and French (${origin}/fr).

## Facts
- Operator: Alo King SARL (in formation), Lebanon.
- Unclaimed businesses have no page and no ratings. Alo King shows no reviews.
`;
}
