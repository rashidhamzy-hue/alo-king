import { describe, expect, it } from "vitest";
import { buildAskCard, decideOrder, hasOrderIntent, parseOrder, type Cand } from "./orderparse.ts";

const qs = (t: string, known?: (w: string) => boolean) => parseOrder(t, known).segments.map((s) => [s.qty, s.query]);

describe("parseOrder: quantities in English, Arabic and Arabizi", () => {
  it("English with a vendor", () => {
    const p = parseOrder("2 shawarma, fries and a Pepsi from Shawarma King");
    expect(p.hint).toBe("Shawarma King");
    expect(p.segments.map((s) => [s.qty, s.query])).toEqual([[2, "shawarma"], [1, "fries"], [1, "Pepsi"]]);
  });
  it.each([
    ["two burgers and three pepsi", [[2, "burgers"], [3, "pepsi"]]],
    ["I want 2x falafel, 1x fries", [[2, "falafel"], [1, "fries"]]],
    ["falafel x2 and fries", [[2, "falafel"], [1, "fries"]]],
    ["can I get a chicken shawarma please", [[1, "chicken shawarma"]]],
    ["give me an orange juice", [[1, "orange juice"]]],
    ["a couple of pepsi", [[2, "pepsi"]]],
    ["10 falafel", [[10, "falafel"]]],
  ])("%s", (t, want) => expect(qs(t as string)).toEqual(want));
  it.each([
    ["badde etneen shawarma w batata w 3 pepsi", [[2, "shawarma"], [1, "batata"], [3, "pepsi"]]],
    ["bade wahad burger w tnein pepsi", [[1, "burger"], [2, "pepsi"]]],
    ["baddi tlete falafel", [[3, "falafel"]]],
    ["bdi arba3a manakish", [[4, "manakish"]]],
    ["badna 5amse shawarma", [[5, "shawarma"]]],
  ])("Arabizi: %s", (t, want) => expect(qs(t as string)).toEqual(want));
  it.each([
    ["بدي اتنين شاورما و بطاطا و 3 بيبسي", [[2, "شاورما"], [1, "بطاطا"], [3, "بيبسي"]]],
    ["بدي ٢ فلافل", [[2, "فلافل"]]],
    ["عطيني تلاتة برغر", [[3, "برغر"]]],
    ["شاورما و بيبسي", [[1, "شاورما"], [1, "بيبسي"]]],
    ["واحد شاورما دجاج", [[1, "شاورما دجاج"]]],
  ])("Arabic: %s", (t, want) => expect(qs(t as string)).toEqual(want));
  it("Arabic vendor hint", () => expect(parseOrder("بدي شاورما من الملك").hint).toBe("الملك"));
  it("attached waw is split only when the remainder is a known word and the whole is not", () => {
    const known = (w: string) => ["شاورما", "بطاطا", "وراق"].includes(w);
    expect(qs("شاورما وبطاطا", known)).toEqual([[1, "شاورما"], [1, "بطاطا"]]);
    expect(qs("وراق عنب", (w) => ["عنب", "وراق"].includes(w))).toEqual([[1, "وراق عنب"]]);
  });
  it("quantity is capped at 20 and never zero", () => { expect(qs("50 falafel")).toEqual([[20, "falafel"]]); expect(qs("0 falafel")).toEqual([[1, "falafel"]]); });
  it("at most 8 segments", () => expect(parseOrder("a1, a2, a3, a4, a5, a6, a7, a8, a9, a10").segments.length).toBe(8));
  it("empty", () => expect(parseOrder("").segments).toEqual([]));
});

describe("hasOrderIntent", () => {
  it.each(["2 shawarma", "I want a burger", "badde shawarma", "بدي شاورما", "عطيني بيبسي", "add a pepsi", "shawarma and fries", "شاورما و بطاطا", "give me two falafel", "three pepsi"])("%s → order", (t) => expect(hasOrderIntent(t)).toBe(true));
  it.each(["do you have falafel and hummus?", "is there gluten in shawarma and fries", "the fries were cold and the pepsi warm", "remove pepsi and fries", "no onions and no pickles", "no pepsi and fries", "I am allergic to peanuts, what do you have", "شو في شاورما و بطاطا", "عندكم شاورما و بطاطا؟", "without onions and tomato", "shil el batata w el pepsi", "ma badde pepsi w batata"])("question / complaint / removal is NOT an order: %s", (t) => expect(hasOrderIntent(t)).toBe(false));
  it.each(["shawarma", "something light", "what's good", "hungry", "pizza?", "عندكم شاورما؟", "do you have falafel", "شو في", "burger near me", ""])("%s → search, not an order", (t) => expect(hasOrderIntent(t)).toBe(false));
});

const cand = (item_id: string, vendor_id: string, name: string, score: number, extra: Partial<Cand> = {}): Cand => ({ item_id, vendor_id, name, score, needs_choices: false, open_now: true, ...extra });
const seg = (qty: number, ...cands: Cand[]) => ({ qty, query: "x", cands });

describe("quantity safety", () => {
  it("risky quantities are flagged (0, above 10) and numbers inside dish names defer to the model", () => {
    expect(parseOrder("50 falafel").segments[0]).toMatchObject({ qty: 20, risky: true });
    expect(parseOrder("0 falafel").segments[0]).toMatchObject({ qty: 1, risky: true });
    expect(parseOrder("11 falafel").segments[0].risky).toBe(true);
    expect(parseOrder("10 falafel").segments[0].risky).toBe(false);
    expect(decideOrder([{ qty: 4, query: "cheese pizza", cands: [cand("p", "k", "4 Cheese Pizza", 0.95)] }]).kind).toBe("model");
    expect(decideOrder([{ qty: 6, query: "nuggets", cands: [cand("n", "k", "Chicken Nuggets 6 pcs", 0.95)] }]).kind).toBe("model");
    expect(decideOrder([{ qty: 2, query: "pizza", cands: [cand("p", "k", "Cheese Pizza 12 inch", 0.95)] }]).kind).toBe("add");
    expect(decideOrder([{ qty: 20, query: "falafel", risky: true, cands: [cand("f", "k", "Falafel", 1)] }]).kind).toBe("model");
  });
  it("ambiguous Arabic number words are not quantities", () => { expect(parseOrder("ست الحبايب").segments[0].qty).toBe(1); expect(parseOrder("ستة برغر").segments[0].qty).toBe(6); });
});

describe("buildAskCard", () => {
  it("names only, up to 3 buttons with ADD ids, titles <= 20", () => {
    const c = buildAskCard({ query: "badde shawarma", quantity: 2, added: ["1× Fries"], failed: ["Pepsi"], ar: false, options: [{ vendor_id: "k", item_id: "a", name: "Chicken Shawarma Sandwich Large" }, { vendor_id: "k", item_id: "b", name: "Beef" }, { vendor_id: "k", item_id: "c", name: "Mixed" }, { vendor_id: "k", item_id: "d", name: "Plate" }] });
    expect(c.buttons).toHaveLength(3); expect(c.buttons[0].id).toBe("ADD|k|a|2"); for (const b of c.buttons) expect(b.title.length).toBeLessThanOrEqual(20);
    expect(c.body).toContain("×2"); expect(c.body).toContain("Added: 1× Fries"); expect(c.body).toContain("Couldn't add: Pepsi"); expect(c.body).not.toMatch(/\$|LBP/);
    expect(c.body.length).toBeLessThanOrEqual(1024);
  });
  it("Arabic", () => expect(buildAskCard({ query: "شاورما", quantity: 1, added: [], failed: [], ar: true, options: [{ vendor_id: "k", item_id: "a", name: "x" }] }).body).toMatch(/[\u0600-\u06FF]/));
});

describe("decideOrder: add / ask / model", () => {
  it("every segment has one clear dish in one open vendor: add them all", () => {
    const d = decideOrder([seg(2, cand("shw", "king", "Chicken Shawarma", 1)), seg(1, cand("fr", "king", "Fries", 0.97), cand("fr2", "pizza", "Fries", 0.97)), seg(1, cand("pp", "king", "Pepsi", 1), cand("pp2", "pizza", "Pepsi Can", 0.94))]);
    expect(d).toEqual({ kind: "add", vendorId: "king", items: [{ item_id: "shw", quantity: 2, name: "Chicken Shawarma" }, { item_id: "fr", quantity: 1, name: "Fries" }, { item_id: "pp", quantity: 1, name: "Pepsi" }] });
  });
  it("the basket-preferred / common vendor wins when the same dish exists elsewhere", () => {
    const d = decideOrder([seg(1, cand("a", "v1", "Pepsi", 1), cand("b", "v2", "Pepsi", 1))], { preferVendors: new Set(["v2"]) });
    expect(d).toMatchObject({ kind: "add", vendorId: "v2" });
  });
  it("the same dish at two vendors with no signal: model (a vendor question is the model's one short question)", () => {
    expect(decideOrder([seg(1, cand("a", "v1", "Pepsi", 1), cand("b", "v2", "Pepsi", 1))]).kind).toBe("model");
  });
  it("two different close dishes in the chosen vendor: ask ONE question with up to 3 options and add the clear ones now", () => {
    const d: any = decideOrder([seg(1, cand("fr", "king", "Fries", 1)), seg(2, cand("c", "king", "Chicken Shawarma", 0.9), cand("b", "king", "Beef Shawarma", 0.9), cand("m", "king", "Mixed Shawarma", 0.88), cand("z", "king", "Shawarma Plate", 0.86))]);
    expect(d.kind).toBe("ask");
    expect(d.vendorId).toBe("king");
    expect(d.addNow).toEqual([{ item_id: "fr", quantity: 1, name: "Fries" }]);
    expect(d.question.quantity).toBe(2);
    expect(d.question.options.map((o: any) => o.item_id)).toEqual(["c", "b", "m"]);
  });
  it("a clear winner (margin) is not a question", () => {
    expect(decideOrder([seg(1, cand("c", "king", "Chicken Shawarma", 1), cand("p", "king", "Chicken Shawarma Plate", 0.84))]).kind).toBe("add");
  });
  it("two ambiguous segments: still only the first question; nothing from the second is added yet", () => {
    const d: any = decideOrder([seg(1, cand("a", "k", "Alpha One", 0.9), cand("b", "k", "Alpha Two", 0.9)), seg(1, cand("c", "k", "Beta One", 0.9), cand("d", "k", "Beta Two", 0.9))]);
    expect(d.kind).toBe("ask"); expect(d.addNow).toEqual([]);
  });
  it.each([
    ["a segment with no match", [seg(1, cand("a", "k", "A", 1)), seg(1)]],
    ["a dish that needs choices", [seg(1, cand("a", "k", "A", 1, { needs_choices: true }))]],
    ["a closed vendor", [seg(1, cand("a", "k", "A", 1, { open_now: false }))]],
    ["a weak match", [seg(1, cand("a", "k", "A", 0.7))]],
    ["no segments", []],
    ["dishes from two vendors with nothing in common", [seg(1, cand("a", "v1", "A", 1)), seg(1, cand("b", "v2", "B", 1))]],
  ])("falls back to the model for %s", (_n, segs) => expect(decideOrder(segs as any).kind).toBe("model"));
  it("never more than 10 lines", () => {
    const many = Array.from({ length: 12 }, (_, i) => seg(1, cand(`i${i}`, "k", `D${i}`, 1)));
    expect(decideOrder(many as any).kind).toBe("model");
  });
});
