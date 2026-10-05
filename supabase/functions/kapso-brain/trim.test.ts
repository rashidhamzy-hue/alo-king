import { describe, expect, it } from "vitest";
import { HISTORY_MAX_MESSAGES, isTerminalResult, matchesNote, slimSearchRow, trimHistory, allTerminal } from "./trim.ts";

const FULL_ROW = { item_id: "k-shw", item_name_en: "Chicken Shawarma", item_name_ar: "شاورما دجاج", description_en: "Marinated chicken, garlic sauce, pickles, wrapped in saj bread and grilled until crisp on the outside. ".repeat(3),
  section: "Sandwiches", price_usd: 4.5, serves: 1, portion_grams: 300, calories: 520, protein_grams: 31, carbs_grams: 40, fat_grams: 22, sugar_grams: 3, fiber_g: 2, sodium_mg: 900, nutrition_source: "estimate", nutrition_verified: false,
  ingredients: ["chicken", "garlic", "pickles", "bread", "oil", "spices", "toum"], allergens: "gluten, sesame", allergen_list: ["gluten", "sesame"], allergens_reviewed: true, is_vegan: false, is_vegetarian: false, is_gluten_free: false, is_keto: false, is_halal: true,
  is_dairy_free: true, contains_alcohol: false, contains_pork: false, spice_level: 1, prep_time_min: 12, customizations: [{ name: "Sauce", required: true, min: 1, max: 1, options: [{ name: "Garlic", price_delta_usd: 0 }, { name: "Spicy", price_delta_usd: 0 }] }],
  ai_notes: "Best seller. Customers love the garlic.", is_popular: true, is_chef_pick: false, vendor_id: "king", vendor_name: "Shawarma King", vendor_name_ar: "ملك الشاورما", village: "Baakleen", category: "restaurant", open_now: true, score: 2 };

describe("slimSearchRow", () => {
  it("keeps what the model needs to choose and to add", () => {
    const r: any = slimSearchRow(FULL_ROW);
    for (const k of ["item_id", "vendor_id", "vendor_name", "name_en", "name_ar", "price_usd", "open_now", "is_popular", "section"]) expect(r, k).toHaveProperty(k);
    expect(r.needs_choices).toBe(true);
    expect(r.choice_groups).toEqual([{ group: "Sauce", required: true, options: ["Garlic", "Spicy"] }]);
  });
  it("drops the heavy fields (ingredients, nutrition detail, ai notes, long description)", () => {
    const r: any = slimSearchRow(FULL_ROW);
    for (const k of ["ingredients", "sodium_mg", "carbs_grams", "fat_grams", "sugar_grams", "fiber_g", "ai_notes", "nutrition_source", "portion_grams", "serves", "customizations"]) expect(r, k).not.toHaveProperty(k);
    expect(JSON.stringify(r).length).toBeLessThan(JSON.stringify(FULL_ROW).length * 0.5);
  });
  it("keeps dietary/allergen facts only when they are true or confirmed (allergy answers stay correct)", () => {
    const r: any = slimSearchRow(FULL_ROW);
    expect(r.allergens_reviewed).toBe(true); expect(r.allergen_list).toEqual(["gluten", "sesame"]); expect(r.calories).toBe(520); expect(r.protein_grams).toBe(31); expect(r.is_halal).toBe(true);
    expect(r).not.toHaveProperty("contains_pork"); // false flags are omitted
  });
  it("a row without customizations has needs_choices false", () => { expect((slimSearchRow({ ...FULL_ROW, customizations: [] }) as any).needs_choices).toBe(false); });
  it("an item with only optional groups does not need choices", () => { expect((slimSearchRow({ ...FULL_ROW, customizations: [{ name: "Extra", required: false, options: [{ name: "Cheese" }] }] }) as any).needs_choices).toBe(false); });
});

describe("trimHistory", () => {
  const h = (n: number) => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `m${i}` }));
  it("keeps only the last few turns, starting on a user message", () => {
    const out = trimHistory(h(12));
    expect(out.length).toBeLessThanOrEqual(HISTORY_MAX_MESSAGES);
    expect(out[0].role).toBe("user");
    expect(out.at(-1)?.content).toBe("m11");
  });
  it("clips long assistant logs (card dumps) but not short user text", () => {
    const out = trimHistory([{ role: "user", content: "hi" }, { role: "assistant", content: "x".repeat(2000) }]);
    expect(out[0].content).toBe("hi"); expect(String(out[1].content).length).toBeLessThanOrEqual(401);
  });
  it("drops the [interactive …] noise lines from assistant logs, keeping the substance", () => {
    const log = "[interactive buttons: *🧾 YOUR ORDER* 1 × Shawarma | ✅ Confirm Order / ✏️ Change Order]\nDone";
    expect(String(trimHistory([{ role: "user", content: "x" }, { role: "assistant", content: log }])[1].content)).toContain("YOUR ORDER");
  });
  it("empty in, empty out", () => expect(trimHistory([])).toEqual([]));
});

describe("terminal tool results (the card was already sent: no second model call)", () => {
  it("recognises terminal:true results only", () => {
    expect(isTerminalResult(JSON.stringify({ ok: true, terminal: true }))).toBe(true);
    expect(isTerminalResult(JSON.stringify({ ok: true }))).toBe(false);
    expect(isTerminalResult(JSON.stringify({ error: "x", terminal: true }))).toBe(false); // errors always go back to the model
    expect(isTerminalResult("not json")).toBe(false);
    expect(isTerminalResult(JSON.stringify({ ok: true, basket_card_sent: true, instruction: "Basket card already delivered with real prices. Reply with nothing." }))).toBe(true); // existing tools
    expect(isTerminalResult(JSON.stringify({ ok: false, nothing_waiting: true, instruction: "No order summary was waiting. Reply with nothing." }))).toBe(false);
    expect(isTerminalResult(JSON.stringify({ ok: true, results: [], instruction: "Summary cards were sent for the ok ones. Explain each error in one short line." }))).toBe(false);
  });
  it("the loop stops only when every tool result in the batch is terminal", () => {
    const t = JSON.stringify({ ok: true, terminal: true }), n = JSON.stringify({ count: 3 });
    expect(allTerminal([t])).toBe(true); expect(allTerminal([t, t, t])).toBe(true);
    expect(allTerminal([t, n])).toBe(false); expect(allTerminal([n])).toBe(false); expect(allTerminal([])).toBe(false);
  });
});

describe("matchesNote (retrieval-first prompt block)", () => {
  const it1 = { item_id: "k-shw", vendor_id: "king", vendor_name: "Shawarma King", name_en: "Chicken Shawarma", name_ar: "شاورما دجاج", price_usd: 4.5, needs_choices: false, open_now: true };
  it("lists each typed segment with its server-resolved candidates, ids included, no prices", () => {
    const note = matchesNote([{ segment: "2 shawarma", candidates: [it1] }, { segment: "pepsi", candidates: [] }]);
    expect(note).toContain("k-shw"); expect(note).toContain("king"); expect(note).toContain("2 shawarma"); expect(note).toContain("no match");
    expect(note).not.toMatch(/4\.5|\$/);
  });
  it("is empty when nothing was resolved at all", () => expect(matchesNote([{ segment: "hello there", candidates: [] }])).toBe(""));
  it("is compact: under 1,200 characters for 4 segments x 3 candidates", () => {
    const seg = (s: string) => ({ segment: s, candidates: [it1, { ...it1, item_id: "b" }, { ...it1, item_id: "c" }] });
    expect(matchesNote([seg("a"), seg("b"), seg("c"), seg("d")]).length).toBeLessThan(1200);
  });
});
