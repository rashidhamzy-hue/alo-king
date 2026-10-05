import { describe, expect, it } from "vitest";
import { buildNumberedPage, orderForList, parseNumberedReply, numberedTapId, parseNumberedTap, NUMBERED_MAX_PER_PAGE, isMoreWord } from "./numbered.ts";
import { META } from "../_shared/meta-limits.ts";

const both = (n: number) => `$${n.toFixed(2)} · ${Math.round(n * 89500).toLocaleString("en-US")} LBP`;
const mk = (i: number, extra: any = {}) => ({ item_id: `it${i}`, item_name_en: `Dish number ${i}`, item_name_ar: `صنف ${i}`, price_usd: 2 + i / 10, is_popular: false, sort_order: i, section: "Mains", customizations: [], ...extra });
const MENU = Array.from({ length: 40 }, (_, i) => mk(i + 1));

describe("orderForList", () => {
  it("popular first, then sort_order, then name; unavailable-priced items are dropped", () => {
    const o = orderForList([mk(3), mk(1, { is_popular: true }), mk(2), mk(9, { price_usd: 0 }), mk(4, { is_popular: true, sort_order: 0 })]);
    expect(o.map((x) => x.item_id)).toEqual(["it4", "it1", "it2", "it3"]);
  });
});

describe("buildNumberedPage", () => {
  const page = (p: number, ar = false, menu: any[] = MENU) => buildNumberedPage({ vendorName: "Shawarma King", items: orderForList(menu), page: p, ar, both });
  it("numbers from 1, shows name and a dual-currency price on every line", () => {
    const r = page(0);
    expect(r.shown[0]).toEqual({ n: 1, item_id: "it1" });
    expect(r.body).toMatch(/^\*Shawarma King\*/m);
    expect(r.body).toContain("1. Dish number 1 — $2.10 · 187,950 LBP");
    for (const l of r.body.split("\n").filter((x) => /^\d+\. /.test(x))) expect(l).toMatch(/\$\d+\.\d\d · [\d,]+ LBP/);
  });
  it("body stays within WhatsApp's 1024 limit on every page, even with long names", () => {
    const long = Array.from({ length: 60 }, (_, i) => mk(i + 1, { item_name_en: "Extra Large Mixed Grill Platter with Rice Salad and Garlic Sauce " + i, item_name_ar: "مشاوي مشكلة كبيرة مع رز وسلطة وثوم " + i }));
    for (const ar of [false, true]) for (let p = 0; p < 6; p++) { const r = page(p, ar, long); expect(r.body.length, `p${p} ar=${ar}`).toBeLessThanOrEqual(META.body); }
  });
  it("at most NUMBERED_MAX_PER_PAGE dishes and always at least one", () => {
    const r = page(0); expect(r.shown.length).toBeLessThanOrEqual(NUMBERED_MAX_PER_PAGE); expect(r.shown.length).toBeGreaterThan(0);
  });
  it("pages are disjoint and cover the menu in order; hasMore is true until the last page", () => {
    const seen: string[] = []; let p = 0, r;
    do { r = page(p); seen.push(...r.shown.map((s) => s.item_id)); p++; } while (r.hasMore && p < 50);
    expect(seen).toEqual(orderForList(MENU).map((m) => m.item_id));
    expect(r.hasMore).toBe(false);
    expect(page(0).hasMore).toBe(true);
  });
  it("numbers restart at 1 on each page (a reply always refers to the page just shown)", () => { expect(page(1).shown[0].n).toBe(1); });
  it("marks dishes that need a choice, and says so in the legend", () => {
    const r = page(0, false, [mk(1, { customizations: [{ name: "Sauce", required: true, options: [{ name: "Garlic" }] }] }), mk(2)]);
    expect(r.body).toMatch(/1\. .*⚙/); expect(r.body).not.toMatch(/2\. .*⚙/); expect(r.body).toContain("⚙");
  });
  it("tells the customer how to reply, in their language", () => {
    expect(page(0).body).toMatch(/1x2/); expect(page(0, true).body).toMatch(/1x2/); expect(page(0, true).body).toMatch(/[؀-ۿ]/);
  });
  it("last page does not offer more; an empty menu yields no shown dishes", () => {
    const small = page(0, false, [mk(1), mk(2)]); expect(small.hasMore).toBe(false); expect(small.body).not.toMatch(/more/i);
    expect(page(0, false, []).shown).toEqual([]);
  });
  it("a page past the end is empty", () => { expect(page(99).shown).toEqual([]); });
});

describe("parseNumberedReply (deterministic, no model)", () => {
  const ok = (t: string, max = 8) => parseNumberedReply(t, max);
  it("N, NxQ and lists", () => {
    expect(ok("3")).toEqual({ kind: "order", lines: [{ n: 3, qty: 1 }] });
    expect(ok("1x2, 3, 5")).toEqual({ kind: "order", lines: [{ n: 1, qty: 2 }, { n: 3, qty: 1 }, { n: 5, qty: 1 }] });
    expect(ok("2x1")).toEqual({ kind: "order", lines: [{ n: 2, qty: 1 }] });
  });
  it("repeated numbers add up: '1 1 3' is two of #1 and one of #3", () => {
    expect(ok("1 1 3")).toEqual({ kind: "order", lines: [{ n: 1, qty: 2 }, { n: 3, qty: 1 }] });
    expect(ok("1x2, 1")).toEqual({ kind: "order", lines: [{ n: 1, qty: 3 }] });
  });
  it.each(["1*2", "1×2", "1 x 2", "1X2", "١x٢", "1 و 3", "1 and 3", "1+3", "1,3", "1، 3", "  1   3  "])("separators and digits: %j", (t) => expect(ok(t).kind).toBe("order"));
  it("Arabic-Indic digits", () => expect(ok("١x٢, ٣")).toEqual({ kind: "order", lines: [{ n: 1, qty: 2 }, { n: 3, qty: 1 }] }));
  it("first-seen order is kept, quantity capped at 20 per dish", () => {
    expect(ok("5, 2, 5x30")).toEqual({ kind: "order", lines: [{ n: 5, qty: 20 }, { n: 2, qty: 1 }] });
  });
  it.each(["more", "More", "next", "المزيد", "كمان", "mazeed", "next page", "اكتر", "more please"])("more words: %s", (t) => expect(ok(t)).toEqual({ kind: "more" }));
  it("a pair with a number outside the list, or a zero quantity, is rejected as a whole with a hint", () => {
    expect(ok("9x2")).toEqual({ kind: "invalid", bad: [9] });
    expect(ok("1x2, 12x1, 0x1")).toEqual({ kind: "invalid", bad: [12, 0] });
    expect(ok("3x0")).toEqual({ kind: "invalid", bad: [3] });
    expect(ok("1 2 3 4 5 6 7 8 1 2 3 4 5 6 7 8 1 2 3 4 5 6 7 8 1 2 3 4 5 6 7 8 1 2 3 4 5 6 7 8 1 2 3 4 5 6 7 8").kind).toBe("invalid"); // > 40 tokens
  });
  it.each(["9", "12", "1 2 15", "70 12 34 56", "03 12 34 56", "7:30", "1:30", "2:2", "40", "99"])("bare out-of-range numbers, times and phone digits are not a list reply: %j", (x) => expect(ok(x).kind).toBe("none"));
  it.each(["", "   ", "hello", "2 shawarma", "make it 3", "I want 1x2", "1x2 please", "yes", "3 people", "12 Main street", "+96170123456", "1.5", "1x2x3", "x", "x2", "-1", "٣ دجاج"])("not a numbered reply: %j", (t) => expect(ok(t).kind).toBe("none"));
  it("a 8+ digit number (phone, building) is never a dish number", () => { expect(ok("96170123456").kind).toBe("none"); expect(ok("70123456").kind).toBe("none"); });
});

describe("isMoreWord", () => { it("exact words only", () => { expect(isMoreWord("more")).toBe(true); expect(isMoreWord("more cheese please")).toBe(false); }); });

describe("tap ids", () => {
  it("round trip, within the 256-char id limit", () => {
    expect(parseNumberedTap(numberedTapId("al-kooz-cafe-37036", 2))).toEqual({ vendorId: "al-kooz-cafe-37036", page: 2 });
    expect(numberedTapId("v".repeat(150), 3).length).toBeLessThanOrEqual(META.buttonId);
  });
  it.each(["NUM|", "NUM|v|x", "NUM|v|-1", "ADD|v|1", "", "NUM|v|1|extra"])("rejects %j", (t) => expect(parseNumberedTap(t)).toBeNull());
});
