import { describe, expect, it } from "vitest";
import { buildSearchRows, haversineKm, looksLikeSearch, moodTerms, orderNearest, type SearchHit } from "./searchfirst.ts";
import { META } from "../_shared/meta-limits.ts";

const both = (n: number) => `$${n.toFixed(2)} · ${Math.round(n * 89500).toLocaleString("en-US")} LBP`;
const hit = (item_id: string, vendor_id: string, name_en: string, score: number, extra: Partial<SearchHit> = {}): SearchHit =>
  ({ item_id, vendor_id, vendor_name: vendor_id.toUpperCase(), name_en, name_ar: "", price_usd: 5, score, is_popular: false, km: null, ...extra });

describe("looksLikeSearch: any food word or mood, short, not an order, not a command", () => {
  it.each(["burger", "shawarma", "pizza?", "عندكم شاورما؟", "do you have falafel", "burger near me", "something light", "hungry", "sweet", "spicy", "healthy food", "breakfast", "شو في حلو", "فلافل", "cheap eats", "any pizza near me"])("%s", (t) => expect(looksLikeSearch(t)).toBe(true));
  it.each(["", "hi", "hello", "yes", "cancel", "thanks", "2 shawarma", "I want a burger", "badde shawarma", "checkout", "my basket", "where is my order", "I need to talk to a person", "delete my data", "make it 3", "stop", "Baakleen, near the church, building 3", "my name is Sami", "this is a very long sentence about something that is not a search at all but a story about my day and the food I ate yesterday"])("%j is not", (t) => expect(looksLikeSearch(t)).toBe(false));
});

describe("moodTerms (EN / AR / Arabizi)", () => {
  it.each([["something light", "light"], ["I want something sweet", "sweet"], ["شو في حلو", "sweet"], ["7ilo", "sweet"], ["spicy", "spicy"], ["حار", "spicy"], ["breakfast", "breakfast"], ["فطور", "breakfast"], ["healthy", "light"], ["خفيف", "light"], ["cheap", "cheap"], ["hungry", "popular"], ["جوعان", "popular"], ["surprise me", "popular"], ["what's good", "popular"]])("%s -> %s", (t, mood) => expect(moodTerms(t)?.mood).toBe(mood));
  it("a plain dish word is not a mood", () => { expect(moodTerms("burger")).toBeNull(); expect(moodTerms("shawarma")).toBeNull(); });
  it("each mood yields search terms, except 'popular' which means the popular dishes themselves", () => { for (const t of ["light", "sweet", "spicy", "breakfast", "cheap"]) expect(moodTerms(t)?.terms.length ?? 0).toBeGreaterThan(0); expect(moodTerms("hungry")?.terms).toEqual([]); });
});

describe("haversineKm", () => {
  it("zero for the same point, ~111 km per degree of latitude", () => { expect(haversineKm(33.6, 35.6, 33.6, 35.6)).toBe(0); expect(haversineKm(33, 35, 34, 35)).toBeGreaterThan(110); expect(haversineKm(33, 35, 34, 35)).toBeLessThan(112); });
});

describe("orderNearest", () => {
  it("relevance tier first, then nearest, then popular", () => {
    const hits = [hit("far-best", "v1", "Burger", 1, { km: 20 }), hit("near-best", "v2", "Burger", 0.98, { km: 2 }), hit("near-weak", "v3", "Burger Plate Large", 0.7, { km: 0.5 }), hit("pop", "v4", "Burger", 0.97, { km: 2, is_popular: true })];
    expect(orderNearest(hits).map((h) => h.item_id)).toEqual(["pop", "near-best", "far-best", "near-weak"]);
  });
  it("unknown distance sorts after known distance within a tier", () => {
    expect(orderNearest([hit("u", "a", "x", 1, { km: null }), hit("k", "b", "x", 1, { km: 9 })]).map((h) => h.item_id)).toEqual(["k", "u"]);
  });
});

describe("buildSearchRows", () => {
  const many = Array.from({ length: 30 }, (_, i) => hit(`i${i}`, `v${i % 8}`, `A fairly long dish name that needs clipping ${i}`, 1 - i / 100, { km: i }));
  it("at most 10 rows, at most 3 per vendor, titles <= 24, descriptions <= 72, ids <= 200", () => {
    for (const ar of [false, true]) {
      const rows = buildSearchRows(many, ar, both);
      expect(rows.length).toBe(10);
      const per = new Map<string, number>(); for (const r of rows) { const v = r.id.split("|")[1]; per.set(v, (per.get(v) ?? 0) + 1); }
      expect(Math.max(...per.values())).toBeLessThanOrEqual(3);
      for (const r of rows) { expect(r.title.length).toBeLessThanOrEqual(META.rowTitle); expect(r.description.length).toBeLessThanOrEqual(META.rowDescription); expect(r.id.length).toBeLessThanOrEqual(META.rowId); expect(r.id).toMatch(/^ITEM\|/); }
    }
  });
  it("description is vendor, then a dual-currency price", () => {
    const [r] = buildSearchRows([hit("a", "king", "Chicken Shawarma", 1, { price_usd: 4.5, vendor_name: "King" })], false, both);
    expect(r.description).toBe("King · $4.50 · 402,750 LBP"); expect(r.title).toBe("Chicken Shawarma");
  });
  it("uses the Arabic name when the customer writes Arabic and one exists", () => {
    const [r] = buildSearchRows([hit("a", "king", "Chicken Shawarma", 1, { name_ar: "شاورما دجاج" })], true, both); expect(r.title).toBe("شاورما دجاج");
  });
  it("shows the distance when known", () => {
    expect(buildSearchRows([hit("a", "king", "Fries", 1, { km: 2.34, vendor_name: "King" })], false, both)[0].description).toMatch(/2\.3 km/);
  });
  it("empty in, empty out", () => expect(buildSearchRows([], false, both)).toEqual([]));
});
