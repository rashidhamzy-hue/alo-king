import { describe, expect, it } from "vitest";
import { buildCategories, categorySlug, czNext, isDrinkItem, itemPageRows, parseBrowseTap, pickAddon, qtyRows } from "./browse";

const it_ = (id: string, section: string | null, extra: any = {}) => ({ item_id: id, item_name_en: id.toUpperCase(), item_name_ar: null, price_usd: 3, section, is_popular: false, sort_order: 0, contains_alcohol: false, ...extra });

describe("buildCategories", () => {
  it("merges case/spacing variants and keeps at most 10", () => {
    const items = [it_("a", "Hot Mezza"), it_("b", "HOT MEZZA"), it_("c", "hot  mezza"), ...Array.from({ length: 14 }, (_, i) => it_(`x${i}`, `Sec ${i}`))];
    const cats = buildCategories(items);
    expect(cats.length).toBeLessThanOrEqual(10);
    expect(cats[0].count).toBe(3);
    expect(cats.filter((c) => /hot mezza/i.test(c.title))).toHaveLength(1);
  });
  it("prefers a mixed-case title over ALL CAPS and handles null sections", () => {
    const cats = buildCategories([it_("a", "SALADS"), it_("b", "Salads"), it_("c", null)]);
    expect(cats.find((c) => c.key === "salads")?.title).toBe("Salads");
    expect(cats.some((c) => c.key === "menu")).toBe(true);
  });
  it("slug survives a round trip and never contains a pipe", () => {
    expect(categorySlug("Hot | Mezza")).not.toContain("|");
    expect(categorySlug("مازة ساخنة")).toBe(categorySlug("  مازة   ساخنة "));
  });
});

describe("itemPageRows", () => {
  const items = Array.from({ length: 23 }, (_, i) => it_(`item${i}`, "S", { item_name_en: "A very long dish name that overflows the row title", price_usd: 2.5 }));
  it("never exceeds 10 rows, titles ≤24, descriptions ≤72, and pages with a More row", () => {
    const p0 = itemPageRows(items, 0, "v1", "s", false, (n) => `$${n.toFixed(2)} · ${Math.round(n * 89500)} LBP`);
    expect(p0.length).toBe(10);
    expect(p0.every((r) => r.title.length <= 24 && (r.description ?? "").length <= 72)).toBe(true);
    expect(p0[9].id).toBe("CAT|v1|s|1");
    const p2 = itemPageRows(items, 2, "v1", "s", false, (n) => `$${n}`);
    expect(p2.length).toBe(5);
    expect(p2.some((r) => r.id.startsWith("CAT|"))).toBe(false);
  });
  it("uses Arabic names for Arabic customers when present", () => {
    const rows = itemPageRows([it_("a", "S", { item_name_ar: "فتوش" })], 0, "v", "s", true, (n) => `${n}`);
    expect(rows[0].title).toBe("فتوش");
  });
});

describe("qtyRows", () => {
  it("offers a short ladder of ADD ids", () => {
    const rows = qtyRows("v", "i", "Falafel", false);
    expect(rows.length).toBeLessThanOrEqual(10);
    expect(rows[0].id).toBe("ADD|v|i|1");
    expect(rows.every((r) => r.title.length <= 24)).toBe(true);
  });
});

describe("parseBrowseTap", () => {
  it.each([
    ["CAT|v|hot-mezza", { kind: "CAT", vendorId: "v", slug: "hot-mezza", page: 0 }],
    ["CAT|v|s|2", { kind: "CAT", vendorId: "v", slug: "s", page: 2 }],
    ["CATS|v", { kind: "CATS", vendorId: "v" }],
    ["ITEM|v|i", { kind: "ITEM", vendorId: "v", itemId: "i" }],
    ["ADD|v|i|3", { kind: "ADD", vendorId: "v", itemId: "i", qty: 3 }],
    ["QTY|v|i", { kind: "QTY", vendorId: "v", itemId: "i" }],
    ["CZ|v|i|2|0.1,1.0", { kind: "CZ", vendorId: "v", itemId: "i", qty: 2, picks: ["0.1", "1.0"] }],
    ["CZ|v|i|2|", { kind: "CZ", vendorId: "v", itemId: "i", qty: 2, picks: [] }],
  ])("%s", (id, want) => expect(parseBrowseTap(id)).toEqual(want));
  it("rejects malformed ids and clamps quantity", () => {
    expect(parseBrowseTap("ADD|v|i|0")).toBeNull();
    expect(parseBrowseTap("ADD|v|i|x")).toBeNull();
    expect(parseBrowseTap("ITEM|v")).toBeNull();
    expect(parseBrowseTap("CONFIRM|x")).toBeNull();
    expect(parseBrowseTap("ADD|v|i|99")).toMatchObject({ qty: 20 });
  });
});

describe("czNext (customizations as a list, one group at a time)", () => {
  const groups = [
    { name: "Size", required: true, min: 1, max: 1, options: [{ name: "Small", price_delta_usd: 0 }, { name: "Large", price_delta_usd: 1.5 }] },
    { name: "Extras", required: false, min: 0, max: 2, options: [{ name: "Cheese", price_delta_usd: 0.5 }] },
  ];
  const both = (n: number) => `$${n.toFixed(2)} · ${Math.round(n * 89500).toLocaleString("en-US")} LBP`;
  it("asks the first group with option ids that carry the pick path", () => {
    const s: any = czNext(groups, [], "CZ|v|i|1|", both, false);
    expect(s.kind).toBe("ask");
    expect(s.group).toBe("Size");
    expect(s.rows.map((r: any) => r.id)).toEqual(["CZ|v|i|1|0.0", "CZ|v|i|1|0.1"]);
    expect(s.rows[1].description).toContain("+$1.50");
    expect(s.rows.length).toBeLessThanOrEqual(10);
  });
  it("optional groups get a Skip row, and finishing returns named choices", () => {
    const s: any = czNext(groups, ["0.1"], "CZ|v|i|1|", both, false);
    expect(s.group).toBe("Extras");
    expect(s.rows.at(-1).id).toBe("CZ|v|i|1|0.1,1.-");
    const d: any = czNext(groups, ["0.1", "1.0"], "CZ|v|i|1|", both, false);
    expect(d).toEqual({ kind: "done", choices: [{ group: "Size", option: "Large" }, { group: "Extras", option: "Cheese" }] });
    const skipped: any = czNext(groups, ["0.0", "1.-"], "CZ|v|i|1|", both, false);
    expect(skipped.choices).toEqual([{ group: "Size", option: "Small" }]);
  });
  it("ignores out-of-range or tampered picks", () => {
    expect(czNext(groups, ["0.9"], "CZ|", both, false).kind).toBe("invalid");
    expect(czNext(groups, ["7.0"], "CZ|", both, false).kind).toBe("invalid");
  });
  it("no groups → done immediately", () => expect(czNext([], [], "CZ|", both, false)).toEqual({ kind: "done", choices: [] }));
});

describe("isDrinkItem / pickAddon", () => {
  it("recognises drinks and never alcohol", () => {
    expect(isDrinkItem(it_("a", "Cold Drinks"))).toBe(true);
    expect(isDrinkItem(it_("a", "عصير طازج"))).toBe(true);
    expect(isDrinkItem(it_("a", "BEER"))).toBe(false);
    expect(isDrinkItem(it_("a", "Alcoholic Drinks"))).toBe(false);
    expect(isDrinkItem(it_("a", "Drinks", { contains_alcohol: true }))).toBe(false);
    expect(isDrinkItem(it_("a", "Salads"))).toBe(false);
  });
  it("suggests the most popular non-alcoholic drink", () => {
    const menu = [it_("falafel", "Mezza"), it_("cola", "Drinks", { price_usd: 2 }), it_("juice", "Drinks", { price_usd: 3, is_popular: true }), it_("beer", "Beer")];
    expect(pickAddon(menu, ["falafel"])?.item_id).toBe("juice");
  });
  it("suggests nothing when the basket already has a drink or no drink exists", () => {
    const menu = [it_("falafel", "Mezza"), it_("cola", "Drinks")];
    expect(pickAddon(menu, ["cola"])).toBeNull();
    expect(pickAddon([it_("falafel", "Mezza")], ["falafel"])).toBeNull();
  });
});
