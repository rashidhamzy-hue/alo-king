import { describe, expect, it } from "vitest";
import { ar } from "@/content/ar";
import { en } from "@/content/en";
import { fr } from "@/content/fr";
import {
  declaredAllergens,
  itemCanOrder,
  itemCode,
  itemHead,
  itemImageUrl,
  itemWaText,
  optionRule,
} from "./item";
import type { SiteItemPage } from "./site-data";

const ID = "80000000-0000-0000-0000-000000000001";
const page = (over: Partial<SiteItemPage> = {}): SiteItemPage => ({
  item: {
    id: ID,
    name_ar: "شاورما دجاج",
    name_en: "Chicken shawarma",
    name_fr: "Shawarma poulet",
    description: "Garlic sauce, pickles, fries inside.",
    price_usd: 3.5,
    per_kg: false,
    est_weight_kg: null,
    available: true,
    vegetarian: false,
    vegan: false,
    spicy: 0,
    pork: false,
    alcohol: false,
    photo: true,
    photo_source: "merchant",
    credit: null,
  },
  vendor: {
    slug: "abou-ali-shawarma",
    name_ar: "شاورما أبو علي",
    name_en: "Abou Ali Shawarma",
    name_fr: null,
    place_slug: "chf-baakline",
    place_ar: "بعقلين",
    place_en: "Baakline",
    place_fr: "Baakline",
    orderable: true,
    paused: false,
    open_now: true,
    demo: false,
    public_page: true,
  },
  nutrition: null,
  allergens: null,
  options: [],
  goes_well: null,
  rate: 89500,
  ...over,
});
const info = { origin: "https://alo-king.example", indexing: true };
const robots = (h: ReturnType<typeof itemHead>) => h.meta.find((m) => m.name === "robots")?.content;

describe("Add in WhatsApp (§39.15.2): the bot adds the item from its code", () => {
  it("carries i-<item id> verbatim in all three languages", () => {
    for (const [lang, t] of [
      ["en", en],
      ["fr", fr],
      ["ar", ar],
    ] as const) {
      expect(t.wa.item).toContain("{code}");
      const text = itemWaText(t, page(), lang);
      expect(text).toContain(`i-${ID}`);
      expect(text).toContain(
        lang === "ar" ? "شاورما دجاج" : lang === "fr" ? "Shawarma" : "Chicken",
      );
    }
    expect(itemCode(ID)).toBe(`i-${ID}`);
  });
  it("is offered only when the item, the shop and its switch say so", () => {
    expect(itemCanOrder(page())).toBe(true);
    expect(itemCanOrder(page({ item: { ...page().item, available: false } }))).toBe(false);
    expect(itemCanOrder(page({ vendor: { ...page().vendor, paused: true } }))).toBe(false);
    expect(itemCanOrder(page({ vendor: { ...page().vendor, orderable: false } }))).toBe(false);
  });
  it("shows the photo through the catalogue image route", () => {
    expect(itemImageUrl(ID)).toMatch(
      new RegExp(`/functions/v1/dispatch\\?route=catalog-image&i=${ID}$`),
    );
  });
});

describe("extras rules", () => {
  const g = (min: number, max: number, n = 3) => ({
    min,
    max,
    options: Array.from({ length: n }, () => ({
      name_ar: null,
      name_en: "x",
      name_fr: null,
      price_usd: 0,
    })),
  });
  it("says what to choose, never more than the group offers", () => {
    expect(optionRule(g(1, 1), en)).toBe("Choose 1");
    expect(optionRule(g(1, 2), en)).toBe("Choose 1 to 2");
    expect(optionRule(g(0, 3), en)).toBe("Choose up to 3");
    expect(optionRule(g(0, 1), en)).toBe("Optional");
    expect(optionRule(g(0, 5, 2), en)).toBe("Choose up to 2");
    expect(optionRule(g(2, 2), fr)).toBe("Choisissez 2");
  });
});

describe("allergens (§32.3, §38.3): declared only", () => {
  it("says nothing when the shop declared none, never 'none' or 'safe'", () => {
    expect(declaredAllergens({ allergens: null }, en)).toBeNull();
    expect(declaredAllergens({ allergens: [] }, en)).toBeNull();
  });
  it("names the declared ones in the page's language, including the database's own keys", () => {
    expect(declaredAllergens({ allergens: ["gluten", "dairy", "nuts"] }, en)).toEqual([
      "gluten",
      "dairy",
      "nuts",
    ]);
    expect(declaredAllergens({ allergens: ["sesame", "shellfish"] }, fr)).toEqual([
      "sésame",
      "fruits de mer",
    ]);
  });
});

describe("item page head", () => {
  it("is indexable with its MenuItem and Offer in USD", () => {
    const h = itemHead(page(), "en", en, info);
    expect(robots(h)).toBe("index,follow,max-image-preview:large");
    expect(h.meta).toContainEqual({ title: "Chicken shawarma · Abou Ali Shawarma | Alo King" });
    expect(h.links).toContainEqual({
      rel: "canonical",
      href: `https://alo-king.example/en/i/${ID}`,
    });
    const ld = JSON.parse(h.scripts[0]!.children);
    expect(ld["@type"]).toBe("MenuItem");
    expect(ld.offers).toMatchObject({ "@type": "Offer", price: "3.50", priceCurrency: "USD" });
    expect(ld.offers.availability).toBe("https://schema.org/InStock");
  });
  it("prices a per-kg item per kilogram", () => {
    const h = itemHead(page({ item: { ...page().item, per_kg: true } }), "en", en, info);
    const ld = JSON.parse(h.scripts[0]!.children);
    expect(ld.offers.priceSpecification).toMatchObject({ unitCode: "KGM", price: "3.50" });
  });
  it("is noindex, with no structured data, for a demo shop's item (§39.12)", () => {
    const demo = page({ vendor: { ...page().vendor, demo: true, public_page: false } });
    for (const [lang, t] of [
      ["en", en],
      ["fr", fr],
      ["ar", ar],
    ] as const) {
      const h = itemHead(demo, lang, t, info, [{ "@type": "BreadcrumbList" }]);
      expect(robots(h)).toBe("noindex,nofollow");
      expect(h.scripts).toEqual([]);
    }
  });
});
