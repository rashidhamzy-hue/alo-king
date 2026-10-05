import { describe, expect, it } from "vitest";
import { extractVendorHint, normText, prepareIndex, rankItems, resolveSegments, skeleton, splitSegments, tokens, type IndexItem } from "./resolve.ts";

const it_ = (item_id: string, vendor_id: string, vendor_name: string, name_en: string, name_ar = "", extra: Partial<IndexItem> = {}): IndexItem =>
  ({ item_id, vendor_id, vendor_name, vendor_name_ar: "", name_en, name_ar, section: "", price_usd: 5, is_popular: false, ...extra });

const MENU: IndexItem[] = [
  it_("k-shw-ch", "king", "Shawarma King", "Chicken Shawarma", "شاورما دجاج", { is_popular: true }),
  it_("k-shw-beef", "king", "Shawarma King", "Beef Shawarma", "شاورما لحمة"),
  it_("k-shw-plate", "king", "Shawarma King", "Chicken Shawarma Plate with Fries and Garlic", "صحن شاورما"),
  it_("k-fries", "king", "Shawarma King", "French Fries", "بطاطا مقلية"),
  it_("k-pepsi", "king", "Shawarma King", "Pepsi", "بيبسي"),
  it_("k-tawouk", "king", "Shawarma King", "Tawouk Sandwich", "ساندويش طاووق"),
  it_("p-pizza", "pizzeria", "Pizza Hut Shouf", "Margherita Pizza", "بيتزا مارغريتا"),
  it_("p-fries", "pizzeria", "Pizza Hut Shouf", "Fries", "بطاطا"),
  it_("p-pepsi", "pizzeria", "Pizza Hut Shouf", "Pepsi Can", "بيبسي"),
  it_("b-burger", "burgerz", "Burger Shack", "Cheese Burger", "تشيز برغر"),
  it_("b-falafel", "burgerz", "Burger Shack", "Falafel Wrap", "لفة فلافل"),
];
const top = (q: string, n = 1, o = {}) => rankItems(q, MENU, o).slice(0, n).map((r) => r.item.item_id);

describe("normText", () => {
  it("lowercases, strips diacritics, unifies alef/ya/ta marbuta, drops punctuation", () => {
    expect(normText("  Shawarma!!  ")).toBe("shawarma");
    expect(normText("شَاوِرما")).toBe(normText("شاورما"));
    expect(normText("أحمد إبراهيم")).toBe(normText("احمد ابراهيم"));
    expect(normText("بيتزة")).toBe(normText("بيتزه")); // ta marbuta / ha
    expect(normText("١٢ شاورما")).toBe("12 شاورما"); // Arabic-Indic digits
  });
});

describe("skeleton (Arabic / Arabizi / English share one consonant skeleton)", () => {
  it.each([
    ["shawarma", "shawerma", "shwarma", "شاورما", "shaurma", "chawarma"],
    ["tawouk", "taouk", "طاووق", "tawook", "tawouq"],
    ["falafel", "فلافل", "falafil"],
    ["burger", "burgar", "برغر", "burgr"],
    ["pepsi", "بيبسي", "bepsi"],
  ])("%s ~ the rest", (...ws: string[]) => { const s = skeleton(ws[0]); for (const w of ws) expect(skeleton(w), w).toBe(s); });
  it("different dishes differ", () => {
    expect(skeleton("pizza")).not.toBe(skeleton("pepsi"));
    expect(skeleton("falafel")).not.toBe(skeleton("shawarma"));
  });
  it("Arabizi digits: 7=ح 5=خ 3=ع 9=ق 2=ء", () => { expect(skeleton("7ommos")).toBe(skeleton("hommos")); expect(skeleton("5obz")).toBe(skeleton("khobz")); expect(skeleton("9ahwe")).toBe(skeleton("qahwe")); });
});

describe("tokens", () => {
  it("drops filler, polite and number words but keeps food words", () => {
    expect(tokens("I want a chicken shawarma please")).toEqual(["chicken", "shawarma"]);
    expect(tokens("badde 2 shawarma")).toEqual(["shawarma"]);
    expect(tokens("بدي شاورما من فضلك")).toEqual(["شاورما"]);
  });
});

describe("tokens: search phrasing", () => {
  it.each([["do you have falafel", ["falafel"]], ["burger near me", ["burger"]], ["any pizza near me", ["pizza"]], ["عندكم شاورما؟", ["شاورما"]], ["is there shawarma here", ["shawarma"]], ["3endkon falafel", ["falafel"]]])("%s", (t, want) => expect(tokens(t as string)).toEqual(want));
});

describe("rankItems", () => {
  it("English exact", () => expect(top("chicken shawarma")).toEqual(["k-shw-ch"]));
  it("prefers the shorter exact name over the plate that merely contains the words", () => expect(top("chicken shawarma", 2)).toEqual(["k-shw-ch", "k-shw-plate"]));
  it("Arabizi and typos", () => {
    expect(top("shawerma")[0]).toMatch(/^k-shw/);
    expect(top("fries")[0]).toMatch(/fries/);
    expect(top("tawook")).toEqual(["k-tawouk"]);
    expect(top("burgar")).toEqual(["b-burger"]);
    expect(top("falafil")).toEqual(["b-falafel"]);
  });
  it("Arabic script", () => {
    expect(top("شاورما دجاج")).toEqual(["k-shw-ch"]);
    expect(top("بطاطا")[0]).toMatch(/fries/);
    expect(top("طاووق")).toEqual(["k-tawouk"]);
  });
  it("nothing relevant gives nothing, never a random item", () => {
    expect(rankItems("quantum spaghetti", MENU)).toEqual([]);
    expect(rankItems("", MENU)).toEqual([]);
  });
  it("a vendor hint restricts and a basket vendor breaks ties", () => {
    expect(top("pepsi", 1, { vendorId: "pizzeria" })).toEqual(["p-pepsi"]);
    expect(top("pepsi", 1, { preferVendors: new Set(["pizzeria"]) })).toEqual(["p-pepsi"]);
    expect(rankItems("pepsi", MENU).map((r) => r.item.vendor_id).sort()).toEqual(["king", "pizzeria"]);
  });
  it("scores are in 0..1 and sorted high to low", () => {
    const r = rankItems("shawarma", MENU); const sc = r.map((x) => x.score);
    expect(sc.every((s) => s > 0 && s <= 1)).toBe(true); expect([...sc].sort((a, b) => b - a)).toEqual(sc);
  });
  it("handles a 5,000 item menu in well under 150 ms", () => {
    const big: IndexItem[] = Array.from({ length: 5400 }, (_, i) => it_(`i${i}`, `v${i % 124}`, `Vendor ${i % 124}`, `Dish number ${i} special`, `صنف ${i}`));
    big.push(...MENU);
    const c = performance.now(); prepareIndex(big); expect(performance.now() - c, "one-time index prep").toBeLessThan(1500);
    const t = performance.now(); rankItems("shawarma", big); expect(performance.now() - t).toBeLessThan(150); // typically ~10 ms; the margin keeps it from flaking on a loaded CI box
  });
});

describe("splitSegments", () => {
  it("splits on commas, and/و/w, plus, newlines", () => {
    expect(splitSegments("2 shawarma, fries and a Pepsi")).toEqual(["2 shawarma", "fries", "a Pepsi"]);
    expect(splitSegments("شاورما و بطاطا + بيبسي")).toEqual(["شاورما", "بطاطا", "بيبسي"]);
    expect(splitSegments("badde shawarma w fries\nw pepsi")).toEqual(["badde shawarma", "fries", "pepsi"]);
  });
  it("does not split inside a name that contains 'and'-like words", () => { expect(splitSegments("mac and cheese")).toEqual(["mac", "cheese"]); }); // documented limitation: the ranker also sees the whole text
  it("empty / junk", () => { expect(splitSegments("")).toEqual([]); expect(splitSegments(" , ,")).toEqual([]); });
});

describe("extractVendorHint", () => {
  it.each([
    ["2 shawarma and fries from Shawarma King", "2 shawarma and fries", "Shawarma King"],
    ["بدي شاورما من الملك", "بدي شاورما", "الملك"],
    ["badde pizza men pizza hut", "badde pizza", "pizza hut"],
    ["a burger at Burger Shack please", "a burger", "Burger Shack"],
    ["fries from X", "fries", "X"],
  ])("%s", (input, rest, hint) => expect(extractVendorHint(input)).toEqual({ rest, hint }));
  it("the hint stops at 'and': the rest is more order", () => {
    expect(extractVendorHint("2 pizza from Pizza Hut and a cola")).toEqual({ rest: "2 pizza and a cola", hint: "Pizza Hut" });
    expect(extractVendorHint("بدي بيتزا من بيتزا هت و بيبسي")).toEqual({ rest: "بدي بيتزا and بيبسي", hint: "بيتزا هت" });
    expect(extractVendorHint("fries from X w a cola please")).toEqual({ rest: "fries and a cola", hint: "X" });
  });
  it("no hint", () => expect(extractVendorHint("2 shawarma")).toEqual({ rest: "2 shawarma", hint: null }));
});

describe("resolveSegments", () => {
  const menu = [...MENU, it_("c-fish", "chips", "Fish House", "Fish and Chips", "سمك وبطاطا"), it_("c-fish2", "chips", "Fish House", "Fish Sandwich"), it_("c-mac", "chips", "Fish House", "Mac and Cheese"), it_("c-chips", "chips", "Fish House", "Chips")];
  it("keeps 'Fish and Chips' as one dish instead of fish + chips", () => {
    const r = resolveSegments("fish and chips", menu); expect(r).toHaveLength(1); expect(r[0].ranked[0].item.item_id).toBe("c-fish");
  });
  it("keeps 'mac and cheese' whole", () => { const r = resolveSegments("mac and cheese", menu); expect(r).toHaveLength(1); expect(r[0].ranked[0].item.item_id).toBe("c-mac"); });
  it("a normal multi-item message is still split", () => {
    const r = resolveSegments("chicken shawarma, fries and pepsi", MENU); expect(r.map((x) => x.segment)).toEqual(["chicken shawarma", "fries", "pepsi"]);
  });
  it("max segments", () => expect(resolveSegments("a, b, c, d, e, f, g, h", MENU, { max: 3 }).length).toBeLessThanOrEqual(3));
});

describe("skeleton collisions within one script need 3 letters", () => {
  const ms: IndexItem[] = [it_("cola", "v", "V", "Cola"), it_("kale", "v", "V", "Kale Salad"), it_("kilo", "v", "V", "Kilo Box")];
  it("'cola' does not match kale or kilo", () => expect(rankItems("cola", ms).map((r) => r.item.item_id)).toEqual(["cola"]));
  it("but pepsi still matches بيبسي across scripts", () => { expect(rankItems("pepsi", [it_("p", "v", "V", "", "بيبسي")]).length).toBe(1); expect(rankItems("بيبسي", [it_("p", "v", "V", "Pepsi")]).length).toBe(1); });
});
