import { describe, expect, it } from "vitest";
import { buildSpread, parsePartyRequest, parsePartyTap, partyTapId, portionsNeeded, rankVendorsForParty, servesOf, spreadCard } from "./party.ts";
import { META } from "../_shared/meta-limits.ts";

const both = (n: number) => `$${n.toFixed(2)} · ${Math.round(n * 89500).toLocaleString("en-US")} LBP`;
const it_ = (id: string, section: string, price: number, extra: Record<string, unknown> = {}) => ({ item_id: id, item_name_en: id, section, price_usd: price, ...extra });

describe("parsePartyRequest", () => {
  it("the owner's example", () => expect(parsePartyRequest("breakfast for 5 adults and 2 kids")).toEqual({ adults: 5, kids: 2, meal: "breakfast" }));
  it("variants in English, Arabic and Arabizi", () => {
    expect(parsePartyRequest("lunch for 6 people")).toEqual({ adults: 6, kids: 0, meal: "lunch" });
    expect(parsePartyRequest("dinner for 4 adults, 3 children")).toEqual({ adults: 4, kids: 3, meal: "dinner" });
    expect(parsePartyRequest("فطور لـ 5 كبار و 2 أولاد")).toEqual({ adults: 5, kids: 2, meal: "breakfast" });
    expect(parsePartyRequest("بدي غداء لـ ٦ أشخاص")).toEqual({ adults: 6, kids: 0, meal: "lunch" });
    expect(parsePartyRequest("badde ftour la 5 kbar w 2 wlad")).toEqual({ adults: 5, kids: 2, meal: "breakfast" });
    expect(parsePartyRequest("food for 8")).toEqual({ adults: 8, kids: 0, meal: null });
  });
  it("small groups and unrelated numbers are not parties", () => {
    for (const t of ["breakfast for 2", "1 adult and 1 kid breakfast", "2 shawarma", "I live on floor 5 for 3 days", "table for 5 at 8 pm", "meeting for 10 minutes", "my number is 70123456", "hi", "pizza", "12:30 for 5 people", "for 5"]) expect(parsePartyRequest(t), t).toBeNull();
  });
});

describe("sizing from the portion data we already have", () => {
  it("serves first, then portion weight, else 1", () => { expect(servesOf({ serves: 4 })).toBe(4); expect(servesOf({ serves: null, portion_grams: 900 })).toBe(3); expect(servesOf({ portion_grams: 100 })).toBe(1); expect(servesOf({})).toBe(1); expect(servesOf({ serves: 99 })).toBe(20); });
  it("an adult is one portion, a child half", () => { expect(portionsNeeded({ adults: 5, kids: 2, meal: null })).toBe(6); expect(portionsNeeded({ adults: 3, kids: 1, meal: null })).toBe(4); });
});

describe("buildSpread", () => {
  const menu = [
    it_("Manoushe Zaatar", "Manakish", 2, { is_popular: true }), it_("Manoushe Cheese", "Manakish", 3), it_("Eggs and Foul", "Breakfast", 5, { serves: 2 }), it_("Labneh Plate", "Breakfast", 4),
    it_("Mixed Grill", "Plates", 20, { serves: 3 }), it_("Pepsi", "Drinks", 1), it_("Orange Juice", "Drinks", 2, { is_popular: true }), it_("Red Label", "Drinks", 1, { is_popular: true }), it_("Add Cheese", "Extras", 1), it_("Fries", "Sides", 2),
  ];
  const opt = { deliveryFee: 2, codCap: 150, now: new Date(Date.UTC(2026, 9, 6, 6, 0)) };
  it("5 adults + 2 kids at breakfast: breakfast mains from different sections, sized to feed at least 6, one drink each, no alcohol, no add-ons, no sides, no dinner dishes", () => {
    const r = buildSpread(menu, { adults: 5, kids: 2, meal: "breakfast" }, opt);
    expect(r.ok).toBe(true); if (!r.ok) return;
    const ids = r.spread.lines.map((l) => l.item.item_id);
    expect(ids).not.toContain("Mixed Grill"); expect(ids).not.toContain("Red Label"); expect(ids).not.toContain("Add Cheese"); expect(ids).not.toContain("Fries");
    expect(new Set(r.spread.lines.slice(0, 3).map((l) => l.item.section)).size).toBeGreaterThanOrEqual(2);
    expect(r.spread.feeds).toBeGreaterThanOrEqual(6);
    const drink = r.spread.lines.find((l) => l.item.item_id === "Orange Juice"); expect(drink?.qty).toBe(7); // popular non-alcoholic drink, one per head
    expect(r.spread.subtotal).toBeCloseTo(r.spread.lines.reduce((s, l) => s + Number(l.item.price_usd) * l.qty, 0), 2);
  });
  it("the meal defaults to the current daypart", () => {
    const r = buildSpread(menu, { adults: 4, kids: 0, meal: null }, { ...opt, now: new Date(Date.UTC(2026, 9, 6, 17, 0)) }); // 20:00 Beirut: dinner
    expect(r.ok && r.spread.lines.some((l) => l.item.item_id === "Mixed Grill")).toBe(true);
    expect(r.ok && r.spread.lines.some((l) => l.item.item_id === "Eggs and Foul")).toBe(false);
  });
  it("serves is used: one big platter instead of many portions", () => {
    const r = buildSpread([it_("Family Platter", "Plates", 30, { serves: 6 }), it_("Kafta", "Plates", 8, { serves: 1 })], { adults: 6, kids: 0, meal: "lunch" }, opt);
    expect(r.ok).toBe(true); if (r.ok) { const fp = r.spread.lines.find((l) => l.item.item_id === "Family Platter"); expect(fp?.qty).toBe(1); expect(r.spread.feeds).toBeGreaterThanOrEqual(6); }
  });
  it("dishes that need a choice are not offered (one tap cannot pick)", () => {
    const r = buildSpread([it_("Custom Pizza", "Pizza", 9, { customizations: [{ name: "Size", required: true, options: [{ name: "L" }] }] })], { adults: 4, kids: 0, meal: "dinner" }, opt);
    expect(r).toEqual({ ok: false, reason: "no_dishes" });
  });
  it("alcohol-only or empty menus give nothing", () => expect(buildSpread([it_("Red Label", "Drinks", 20)], { adults: 4, kids: 0, meal: "dinner" }, opt)).toEqual({ ok: false, reason: "no_dishes" }));
  it("respects the cash-on-delivery cap: drops the drink first, then says too big", () => {
    const big = [it_("Platter", "Plates", 60, { serves: 1 }), it_("Pepsi", "Drinks", 1)];
    expect(buildSpread(big, { adults: 4, kids: 0, meal: "lunch" }, opt)).toEqual({ ok: false, reason: "too_big" });
    const mid = buildSpread([it_("Platter A", "Plates", 36, { serves: 1 }), it_("Pepsi", "Drinks", 1)], { adults: 4, kids: 0, meal: "lunch" }, { ...opt, codCap: 148 });
    expect(mid.ok && mid.spread.lines.some((l) => l.item.item_id === "Pepsi")).toBe(false); // 4 x 36 + 2 = 146 fits, the drinks (+4) would not
  });
  it("never more than 20 of a line", () => { const r = buildSpread([it_("Man", "Manakish", 1, { serves: 1 })], { adults: 40, kids: 0, meal: "breakfast" }, opt); expect(r.ok && r.spread.lines.every((l) => l.qty <= 20)).toBe(true); });
});

describe("spreadCard and the accept id", () => {
  const spread = { lines: [{ item: it_("A1", "Manakish", 2.5), qty: 3 }, { item: it_("B2", "Breakfast", 5, { item_name_ar: "فول" }), qty: 2 }], subtotal: 17.5, feeds: 6 };
  const base = { vendorId: "v1", vendorName: "Manoushe House", req: { adults: 5, kids: 2, meal: "breakfast" as const }, spread, meal: "breakfast" as const, deliveryFee: 2, both };
  it("shows the lines, who it feeds, the total with delivery in both currencies, and two buttons", () => {
    const c = spreadCard({ ...base, ar: false })!;
    expect(c.body).toContain("Breakfast for 5 adults + 2 kids"); expect(c.body).toContain("3 × A1"); expect(c.body).toContain("Feeds about 6");
    expect(c.body).toContain("$19.50"); expect(c.body).toContain("LBP"); expect(c.buttons).toHaveLength(2);
    expect(c.buttons.every((b) => b.title.length <= META.buttonTitle)).toBe(true); expect(c.body.length).toBeLessThanOrEqual(META.body);
    expect(spreadCard({ ...base, ar: true })!.body).toContain("فطور");
  });
  it("the accept id round-trips and carries no prices", () => {
    const c = spreadCard({ ...base, ar: false })!;
    expect(c.buttons[0].id).toBe("PARTY|v1|A1:3,B2:2"); expect(parsePartyTap(c.buttons[0].id)).toEqual({ vendorId: "v1", lines: [{ item_id: "A1", qty: 3 }, { item_id: "B2", qty: 2 }] });
    expect(c.buttons[1].id).toBe("MENU|v1"); // Change opens the numbered menu
  });
  it("rejects malformed accept ids", () => { for (const id of ["PARTY|v1", "PARTY||A:1", "PARTY|v1|A:0", "PARTY|v1|A:21", "PARTY|v1|A:x", "PARTY|v1|a:1,b:1,c:1,d:1,e:1,f:1", "MENU|v1"]) expect(parsePartyTap(id), id).toBeNull(); expect(partyTapId("v", [{ item_id: "i", qty: 2 }])).toBe("PARTY|v|i:2"); });
  it("a card whose accept id would not fit is not built", () => { const long = { ...spread, lines: Array.from({ length: 5 }, (_, i) => ({ item: it_("x".repeat(50) + i, "S", 1), qty: 1 })) }; expect(spreadCard({ ...base, spread: long, ar: false })).toBeNull(); });
  it("worst-case names stay within WhatsApp limits in both languages", () => {
    const L = "Chicken shawarma sandwich with extra garlic sauce and pickles ".repeat(3);
    const s = { lines: Array.from({ length: 4 }, (_, i) => ({ item: { ...it_(`i${i}`, "S", 9.99), item_name_en: L, item_name_ar: L }, qty: 20 })), subtotal: 800, feeds: 80 };
    for (const ar of [false, true]) { const c = spreadCard({ ...base, spread: s, vendorName: "V".repeat(200), ar })!; expect(c.body.length).toBeLessThanOrEqual(META.body); expect(c.buttons.every((b) => b.title.length <= META.buttonTitle)).toBe(true); }
  });
});

describe("rankVendorsForParty", () => {
  const items = [
    ...["a", "b", "c"].map((n) => ({ vendor_id: "V1", section: "Breakfast", name_en: n, name_ar: "" })), ...["a", "b"].map((n) => ({ vendor_id: "V2", section: "Manakish", name_en: n, name_ar: "" })),
    { vendor_id: "V3", section: "Breakfast", name_en: "only one", name_ar: "" }, ...["g", "h", "i"].map((n) => ({ vendor_id: "V4", section: "Plates", name_en: n, name_ar: "" })),
  ];
  it("vendors with at least two dishes for the meal, nearest first, then by fit", () => expect(rankVendorsForParty(items, "breakfast", (v) => ({ V1: 5, V2: 2, V3: 1, V4: 0 } as any)[v])).toEqual(["V2", "V1"]));
  it("unknown distance goes last; ties by number of fitting dishes", () => expect(rankVendorsForParty(items, "breakfast", () => null)).toEqual(["V1", "V2"]));
});
