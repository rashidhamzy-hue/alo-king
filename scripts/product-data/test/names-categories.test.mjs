// Names, sizes and categories: proposals only, and the checks that keep a model from adding a claim or changing a number.
import { describe, expect, it } from "vitest";
import { validateName, proposeNames, lineFor } from "../lib/names.mjs";
import { checkCategories, proposeCategories, MIN_CATEGORIES } from "../lib/categories.mjs";

const SRC = (o = {}) => ({ sku: "AK-0100", name_en: "Tannourine Mineral Water 2L X6", name_ar: null, brand: "Tannourine", sell_unit: "Each", category: "Water", sub_type: null, off: null, ...o });
const OUT = (o = {}) => ({ sku: "AK-0100", name_en: "Tannourine Mineral Water", size_en: "6 x 2 L", name_ar: "مياه تنورين المعدنية", size_ar: "6 × 2 ل", ar_source: "model_written", ...o });

describe("validateName", () => {
  it("accepts a clean name with the size moved out, and keeps the source beside it", () => {
    const v = validateName(SRC(), OUT());
    expect(v.ok).toBe(true);
    expect(v.item).toMatchObject({ sku: "AK-0100", status: "proposed", ar_source: "model_written", current: { name_en: "Tannourine Mineral Water 2L X6" }, proposed: { name_en: "Tannourine Mineral Water", size_en: "6 x 2 L", size_ar: "6 × 2 ل" }, changed: { name_en: true } });
    expect(v.item.added_words).toEqual([]);
  });
  it("refuses a number that is not in the source, a missing Arabic name, and Arabic that is not Arabic", () => {
    expect(validateName(SRC(), OUT({ size_en: "6 x 1.5 L", size_ar: "6 × 1.5 ل" })).reasons.join()).toMatch(/number_not_in_source:1.5/);
    expect(validateName(SRC(), OUT({ name_ar: "" })).reasons).toContain("name_ar_missing");
    expect(validateName(SRC(), OUT({ name_ar: "Tannourine water" })).reasons).toContain("name_ar_not_arabic");
    expect(validateName(SRC(), OUT({ size_ar: "6 × 3 ل" })).ok).toBe(false);
  });
  it("Arabic-Indic digits are the same numbers", () => {
    expect(validateName(SRC(), OUT({ size_ar: "٦ × ٢ ل" })).ok).toBe(true);
  });
  it("refuses praise, health, diet and religion words the catalog did not have; allows one it already had", () => {
    const bad = validateName(SRC(), OUT({ name_en: "Tannourine Pure Natural Mineral Water" }));
    expect(bad.ok).toBe(false); expect(bad.reasons.join()).toMatch(/claim_words:.*pure.*natural|claim_words:.*natural.*pure/);
    expect(validateName(SRC(), OUT({ name_ar: "مياه تنورين الطبيعية الصحية" })).reasons.join()).toMatch(/claim_words_ar/);
    const had = SRC({ name_en: "Hawa Fresh Eggs 30Pcs", brand: "Hawa", name_ar: "بيض طازج" });
    expect(validateName(had, OUT({ name_en: "Hawa Fresh Eggs", size_en: "30 pieces", size_ar: "30 حبة", name_ar: "بيض طازج هوا", ar_source: "model_written" })).ok).toBe(true);
  });
  it("lists the words it added (spelling fixes show up for the reviewer) and flags a changed catalog Arabic name", () => {
    const v = validateName(SRC({ name_en: "Ulker Ulker Chocolat Baton 14G", brand: "Ulker", name_ar: "شوكولا اولكر" }), OUT({ name_en: "Ulker Chocolate Baton", size_en: "14 g", size_ar: "14 غ", name_ar: "شوكولا أولكر", ar_source: "catalog" }));
    expect(v.ok).toBe(true);
    expect(v.item.added_words).toEqual(["chocolate"]);
    expect(v.item.changed).toEqual({ name_en: true, name_ar: true });
    expect(v.item.ar_source).toBe("catalog");
  });
  it("an item sold by weight has no size, and a size with no number is refused", () => {
    const w = SRC({ name_en: "Halloum /Kg", brand: "Leentaanayel", sell_unit: "By weight (pre-pack)" });
    expect(validateName(w, OUT({ name_en: "Halloum", size_en: "", size_ar: "", name_ar: "حلوم" })).ok).toBe(true);
    expect(validateName(w, OUT({ name_en: "Halloum", size_en: "per kilo", size_ar: "للكيلو", name_ar: "حلوم" })).reasons).toContain("size_without_number");
  });
  it("Open Food Facts' quantity may supply a size the catalog name lacks", () => {
    const s = SRC({ name_en: "Candia Ayran", brand: "Candia", off: { name: "Ayran", quantity: "250 ml" } });
    expect(validateName(s, OUT({ name_en: "Candia Ayran", size_en: "250 ml", size_ar: "250 مل", name_ar: "كانديا عيران" })).ok).toBe(true);
    expect(lineFor(s)).toContain('quantity "250 ml"');
  });
});

describe("proposeNames", () => {
  const items = ["AK-1", "AK-2", "AK-3"].map((sku, n) => SRC({ sku, name_en: `Brand Thing ${n + 1}0G`, brand: "Brand" }));
  const good = (sku, n) => OUT({ sku, name_en: "Brand Thing", size_en: `${n}0 g`, size_ar: `${n}0 غ`, name_ar: "براند شيء" });
  const pool = (list, fn) => Promise.all(list.map(fn));

  it("a refused item is asked once more with the reasons, and what still fails is reported, never guessed", async () => {
    const asked = [];
    const call = async (content) => {
      asked.push(content);
      if (asked.length === 1) return { items: [good("AK-1", 1), { ...good("AK-2", 2), size_en: "99 g", size_ar: "99 غ" }, { ...good("AK-3", 3), name_en: "Brand Best Thing" }] };
      return { items: [good("AK-2", 2), { ...good("AK-3", 3), name_en: "Brand Best Thing" }] };
    };
    const r = await proposeNames(items, { call, batch: 25, pool });
    expect(r.proposals.map((p) => p.sku)).toEqual(["AK-1", "AK-2"]);
    expect(r.rejected).toEqual([{ sku: "AK-3", name_en: "Brand Thing 30G", reasons: [expect.stringMatching(/claim_words:best/)] }]);
    expect(asked[1]).toMatch(/AK-2: number_not_in_source:99/);
    expect(asked[1]).not.toMatch(/AK-1 \|/);
  });
  it("an item the model leaves out is asked again, and a made-up sku is ignored", async () => {
    let n = 0;
    const call = async () => (++n === 1 ? { items: [good("AK-1", 1), { ...good("AK-9", 9) }] } : { items: [good("AK-2", 2), good("AK-3", 3)] });
    const r = await proposeNames(items, { call, pool });
    expect(r.proposals.map((p) => p.sku)).toEqual(["AK-1", "AK-2", "AK-3"]);
    expect(r.rejected).toEqual([]);
  });
});

describe("categories", () => {
  const cat = (code, en, ar) => ({ code, name_en: en, name_ar: ar });
  const GOOD = [["produce", "Fruit & Vegetables", "فواكه وخضار"], ["dairy_eggs", "Dairy & Eggs", "ألبان وبيض"], ["bakery", "Bakery", "مخبوزات"], ["meat_poultry", "Meat & Poultry", "لحوم ودواجن"], ["deli", "Deli & Cheese", "مأكولات باردة"],
    ["frozen", "Frozen", "مجمدات"], ["pantry", "Pantry", "مونة"], ["canned", "Canned & Jarred", "معلبات"], ["snacks", "Snacks & Sweets", "تسالي وحلويات"], ["drinks", "Drinks", "مشروبات"],
    ["water", "Water", "مياه"], ["coffee_tea", "Coffee & Tea", "قهوة وشاي"], ["household", "Cleaning & Household", "تنظيف ومنزل"], ["personal_care", "Personal Care", "عناية شخصية"]].map((x) => cat(...x));

  it("accepts 12 to 15 neutral categories with Arabic names", () => {
    expect(checkCategories(GOOD)).toEqual([]);
    expect(GOOD.length).toBeGreaterThanOrEqual(MIN_CATEGORIES);
  });
  it("refuses the wrong count, a catch-all, a claim, a duplicate and a name that is not Arabic", () => {
    expect(checkCategories(GOOD.slice(0, 5)).join()).toMatch(/need 12 to 15/);
    expect(checkCategories([...GOOD.slice(0, 13), cat("other", "Other", "أخرى")]).join()).toMatch(/other is a catch-all/);
    expect(checkCategories([...GOOD.slice(0, 13), cat("healthy", "Healthy Food", "طعام صحي")]).join()).toMatch(/claim words: healthy/);
    expect(checkCategories([...GOOD.slice(0, 13), cat("top", "Top Sellers", "الأكثر مبيعا")]).join()).toMatch(/claim words/);
    expect(checkCategories([...GOOD.slice(0, 13), cat("halal_meat", "Halal Meat", "لحوم حلال")]).join()).toMatch(/halal/);
    expect(checkCategories([...GOOD.slice(0, 13), cat("dairy_eggs", "Dairy 2", "ألبان")]).join()).toMatch(/duplicate code/);
    expect(checkCategories([...GOOD.slice(0, 13), cat("tea", "Tea", "Tea")]).join()).toMatch(/not Arabic/);
  });

  const items = Array.from({ length: 30 }, (_, i) => ({ sku: `AK-${100 + i}`, name_en: `Item ${String(200 - i).padStart(3, "0")}`, brand: "B", category: i % 2 ? "Dairy & Eggs" : "Bakery", sub_type: null }));
  const pool = (list, fn) => Promise.all(list.map(fn));
  it("asks again after a refused list, places every item once, orders items by name, and reports what could not be placed", async () => {
    let a = 0; const feedback = [];
    const callA = async (content) => { a++; feedback.push(content); return a === 1 ? { categories: GOOD.slice(0, 4) } : { categories: GOOD }; };
    const callB = async (content, codes) => ({ items: content.includes("AK-129") && !content.includes("missed") ? [] : [...content.matchAll(/^(AK-\d+) \|/gm)].map((m) => ({ sku: m[1], category: Number(m[1].slice(3)) % 2 ? "dairy_eggs" : "bakery" })) });
    const r = await proposeCategories(items, { callA, callB, batch: 15, pool });
    expect(a).toBe(2);
    expect(feedback[1]).toMatch(/refused: need 12 to 15 categories, got 4/);
    expect(r.categories.length).toBe(14);
    expect(r.assignments.length).toBe(30); expect(r.unplaced).toEqual([]);
    expect(new Set(r.assignments.map((x) => x.sku)).size).toBe(30);
    const dairy = r.assignments.filter((x) => x.category === "dairy_eggs");
    expect(dairy.map((x) => x.sort_in_category)).toEqual(dairy.map((_, i) => i + 1));
    expect(dairy.map((x) => x.name_en)).toEqual([...dairy.map((x) => x.name_en)].sort());
    expect(dairy[0].name_en < dairy[1].name_en).toBe(true);
    expect(r.categories.find((c) => c.code === "bakery")).toMatchObject({ sort_order: 3, products: 15, from_catalog_categories: { Bakery: 15 } });
    expect(r.empty.length).toBe(12);
  });
  it("the retry says which codes came back and to merge, when the list was too long (it was 22 on staging)", async () => {
    const many = Array.from({ length: 22 }, (_, i) => cat(`c${i}`, `Group ${String.fromCharCode(65 + i)}`, "فئة"));
    const feedback = []; let a = 0;
    const callA = async (content) => { feedback.push(content); return ++a === 1 ? { categories: many } : { categories: GOOD }; };
    await proposeCategories(items, { callA, callB: async (c) => ({ items: [...c.matchAll(/^(AK-\d+) \|/gm)].map((m) => ({ sku: m[1], category: "pantry" })) }), pool });
    expect(feedback[1]).toMatch(/It had 22 categories \(c0, c1,/);
    expect(feedback[1]).toMatch(/Merge related ones until there are between 12 and 15/);
  });
  it("gives up with the reasons when the list keeps failing", async () => {
    await expect(proposeCategories(items, { callA: async () => ({ categories: GOOD.slice(0, 3) }), callB: async () => ({ items: [] }), pool })).rejects.toThrow(/categories_refused/);
  });
  it("an item the model will not place stays unplaced and is named", async () => {
    const r = await proposeCategories(items, { callA: async () => ({ categories: GOOD }), callB: async (c) => ({ items: [...c.matchAll(/^(AK-\d+) \|/gm)].filter((m) => m[1] !== "AK-105").map((m) => ({ sku: m[1], category: "pantry" })) }), pool });
    expect(r.unplaced).toEqual(["AK-105"]);
  });
});
