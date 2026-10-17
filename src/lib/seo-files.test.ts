import { describe, expect, it } from "vitest";
import { EMPTY_OVERVIEW, type SiteOverview } from "./site-data";
import { llmsTxt, robotsTxt, sitemapEntries, sitemapIndex, urlset } from "./seo-files";

const overview: SiteOverview = {
  ...EMPTY_OVERVIEW,
  places: [
    {
      id: "LB-CHF-BAAKLINE",
      slug: "chf-baakline",
      name_ar: "بعقلين",
      name_en: "Baakline",
      name_fr: "Baakline",
      kind: "village",
      district_code: "CHF",
      lat: 33.67,
      lon: 35.56,
      merchants: 4,
    },
    {
      id: "LB-CHF-BAKAATA",
      slug: "chf-bakaata",
      name_ar: "بقعاتا",
      name_en: "Bakaata",
      name_fr: "Bakaata",
      kind: "village",
      district_code: "CHF",
      lat: 33.66,
      lon: 35.6,
      merchants: 1,
    },
  ],
  cuisines: [
    {
      tag: "shawarma",
      name_ar: "شاورما",
      name_en: "Shawarma",
      name_fr: "Shawarma",
      sort_order: 4,
      vendors: 3,
    },
    { tag: "kaak", name_ar: "كعك", name_en: "Kaak", name_fr: "Kaak", sort_order: 8, vendors: 1 },
  ],
  fees: { min_usd: 2, max_usd: 4.5, max_km: 10 },
};
const vendors = [{ slug: "abou-ali-shawarma", updated_at: "2026-10-12T10:00:00Z" }];

describe("robots.txt", () => {
  it("asks every crawler to stay out until indexing is switched on", () => {
    expect(robotsTxt({ origin: "https://x", indexing: false })).toBe(
      "User-agent: *\nDisallow: /\n",
    );
  });
  it("welcomes the search and assistant crawlers once it is, keeps private paths out, and names the sitemap", () => {
    const t = robotsTxt({ origin: "https://aloking.com", indexing: true });
    for (const b of [
      "GPTBot",
      "ClaudeBot",
      "PerplexityBot",
      "Google-Extended",
      "Googlebot",
      "Bingbot",
    ])
      expect(t).toContain(`User-agent: ${b}\nAllow: /`);
    expect(t).toContain("Disallow: /merchant");
    expect(t).toContain("Disallow: /en/track");
    expect(t).toContain("Sitemap: https://aloking.com/sitemap.xml");
  });
});

describe("sitemaps", () => {
  it("indexes one sitemap per page type", () => {
    const x = sitemapIndex("https://aloking.com");
    for (const k of ["pages", "places", "cuisines", "vendors"])
      expect(x).toContain(`https://aloking.com/sitemap/${k}.xml`);
  });
  it("lists every page in three languages with hreflang alternates and an Arabic x-default", () => {
    const x = urlset("https://aloking.com", [{ path: "/help" }]);
    expect((x.match(/<url>/g) ?? []).length).toBe(3);
    expect(x).toContain("<loc>https://aloking.com/fr/help</loc>");
    expect(x).toContain('hreflang="x-default" href="https://aloking.com/ar/help"');
  });
  it("leaves thin place and cuisine pages out (fewer than 3 live merchants)", () => {
    expect(sitemapEntries("places", overview, []).map((e) => e.path)).toEqual([
      "/places/chf-baakline",
    ]);
    expect(sitemapEntries("cuisines", overview, []).map((e) => e.path)).toEqual([
      "/cuisine/shawarma",
    ]);
    expect(sitemapEntries("vendors", overview, vendors)).toEqual([
      { path: "/m/abou-ali-shawarma", lastmod: "2026-10-12" },
    ]);
    expect(sitemapEntries("pages", overview, []).map((e) => e.path)).toContain("/legal/privacy");
  });
  it("escapes XML", () => {
    expect(urlset("https://x", [{ path: "/m/a&b" }])).toContain("a&amp;b");
  });
});

describe("llms.txt", () => {
  it("says what Alo King is, how to order, where it delivers and links the live lists", () => {
    const t = llmsTxt("https://aloking.com", overview, vendors);
    expect(t).toContain("# Alo King");
    expect(t).toContain("How to order");
    expect(t).toContain(
      "[Baakline](https://aloking.com/en/places/chf-baakline) (4 shops on Alo King)",
    );
    // Every village of the area is listed, live or not, and none reads "0 shops" (§39.15.5).
    expect(t).toContain("- Around Baakline:");
    expect(t).toContain("Ain Zhalta");
    expect(t).not.toMatch(/\b0 shops/);
    expect(t).toContain("https://aloking.com/en/m/abou-ali-shawarma");
    expect(t).toContain("Delivery costs $2.00 to $4.50");
    expect(t).toContain("no ratings");
  });
  it("before launch it says opening soon and invents nothing", () => {
    const t = llmsTxt("https://x", EMPTY_OVERVIEW, []);
    expect(t).toContain("Opening soon");
    expect(t).toContain("- Around Moukhtara:");
    expect(t).not.toContain("](https://x/en/places/");
    expect(t).not.toContain("Shops (claimed");
    expect(t).not.toContain("Delivery costs");
  });
});
