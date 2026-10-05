import { describe, expect, it } from "vitest";
import { editLineId, editListRows, lineButtons, maybeEditText, parseBasketEdit, parseEditTap, setTapId, type EditLine } from "./basketedit.ts";
import { META } from "../_shared/meta-limits.ts";

const L = (id: string, en: string, ar: string, quantity = 1): EditLine => ({ id, name_en: en, name_ar: ar, quantity });
const BASKET = [L("l1", "Chicken Shawarma", "شاورما دجاج", 2), L("l2", "French Fries", "بطاطا مقلية", 1), L("l3", "Pepsi", "بيبسي", 1)];
const p = (t: string, lines = BASKET) => parseBasketEdit(t, lines);

describe("parseBasketEdit: set a quantity", () => {
  it.each([
    ["make it 3", { kind: "set", lineId: "l3", quantity: 3 }], // no name: the dish added last
    ["make that 4", { kind: "set", lineId: "l3", quantity: 4 }],
    ["only 2", { kind: "set", lineId: "l3", quantity: 2 }],
    ["change it to 5", { kind: "set", lineId: "l3", quantity: 5 }],
    ["make the fries 3", { kind: "set", lineId: "l2", quantity: 3 }],
    ["make fries 3", { kind: "set", lineId: "l2", quantity: 3 }],
    ["change the shawarma to 1", { kind: "set", lineId: "l1", quantity: 1 }],
    ["fries x3", { kind: "set", lineId: "l2", quantity: 3 }],
    ["3 pepsi instead", { kind: "set", lineId: "l3", quantity: 3 }],
    ["make the pepsi two", { kind: "set", lineId: "l3", quantity: 2 }],
    ["make it ٣", { kind: "set", lineId: "l3", quantity: 3 }],
  ])("%s", (t, want) => expect(p(t as string)).toEqual(want));
  it.each([
    ["خليهم 3", { kind: "set", lineId: "l3", quantity: 3 }],
    ["خليها ٣", { kind: "set", lineId: "l3", quantity: 3 }],
    ["خلي البطاطا 3", { kind: "set", lineId: "l2", quantity: 3 }],
    ["خليها اتنين", { kind: "set", lineId: "l3", quantity: 2 }],
    ["khalli 3", { kind: "set", lineId: "l3", quantity: 3 }],
    ["khalli el batata 3", { kind: "set", lineId: "l2", quantity: 3 }],
  ])("Arabic / Arabizi: %s", (t, want) => expect(p(t as string)).toEqual(want));
  it("quantity is capped at 20", () => expect(p("make it 50")).toEqual({ kind: "set", lineId: "l3", quantity: 20 }));
});

describe("parseBasketEdit: remove", () => {
  it.each([
    ["remove the fries", "l2"], ["remove fries", "l2"], ["delete the pepsi", "l3"], ["no fries", "l2"], ["drop the shawarma", "l1"], ["take out the fries", "l2"], ["cancel the pepsi", "l3"], ["I don't want the fries", "l2"], ["without the pepsi", "l3"],
    ["شيل البطاطا", "l2"], ["احذف البيبسي", "l3"], ["بلا بيبسي", "l3"], ["ما بدي بطاطا", "l2"], ["shil el batata", "l2"], ["sheel pepsi", "l3"], ["bala batata", "l2"], ["ma badde pepsi", "l3"],
  ])("%s", (t, id) => expect(p(t)).toEqual({ kind: "remove", lineId: id }));
  it("'remove it' / 'remove that' removes the dish added last", () => { expect(p("remove it")).toEqual({ kind: "remove", lineId: "l3" }); expect(p("شيلو")).toEqual({ kind: "remove", lineId: "l3" }); });
  it("'make it 0' removes", () => expect(p("make the fries 0")).toEqual({ kind: "remove", lineId: "l2" }));
});

describe("parseBasketEdit: when NOT to act (the model or the normal flow handles it)", () => {
  it.each(["", "hello", "checkout", "yes", "cancel", "cancel my order", "I want 2 more pepsi", "add a pepsi", "2 shawarma", "what's in my basket", "remove", "make it", "make it better", "no", "no thanks", "make it spicy", "حذف", "شيل", "no sauce", "remove the pickles", "no onions please"])("%j", (t) => expect(p(t).kind).toBe("none"));
  it("modifier words are requests about a dish, not basket removals", () => {
    const b = [L("s", "Chicken Shawarma", "شاورما دجاج"), L("o", "Onion Rings", "حلقات بصل"), L("g", "Garlic Sauce", "ثوم"), L("p", "Pepsi", "بيبسي")];
    for (const x of ["no onion", "without onions", "no sauce", "no garlic", "no chicken", "remove the onions", "bala toum", "بدون بصل", "no tomato"]) expect(parseBasketEdit(x, b).kind, x).toBe("none");
    expect(parseBasketEdit("remove the pepsi", b)).toEqual({ kind: "remove", lineId: "p" });
    expect(parseBasketEdit("remove the onion rings", b)).toEqual({ kind: "remove", lineId: "o" });
  });
  it("pronoun removal needs an explicit remove verb: cancel it / no that / don't want it are not basket edits", () => {
    for (const x of ["cancel it", "cancel this", "no that", "don't want it", "I don't want it", "drop it"]) expect(p(x).kind, x).toBe("none");
    expect(p("remove it")).toEqual({ kind: "remove", lineId: "l3" }); expect(p("take out that")).toEqual({ kind: "remove", lineId: "l3" });
  });
  it("an empty basket never matches", () => expect(parseBasketEdit("make it 3", []).kind).toBe("none"));
  it("two lines that both match the name: ask, do not guess", () => {
    const two = [L("a", "Chicken Shawarma", "شاورما دجاج"), L("b", "Beef Shawarma", "شاورما لحمة")];
    const r = parseBasketEdit("remove the shawarma", two);
    expect(r.kind).toBe("ambiguous"); expect((r as any).options.map((o: any) => o.id)).toEqual(["a", "b"]);
  });
});

describe("edit tap ids and rows (Meta limits)", () => {
  it("round trips", () => {
    expect(parseEditTap(editLineId("11111111-2222-3333-4444-555555555555"))).toEqual({ kind: "LINE", id: "11111111-2222-3333-4444-555555555555" });
    expect(parseEditTap(setTapId("abc", 3))).toEqual({ kind: "SET", id: "abc", quantity: 3 });
    expect(parseEditTap("BEDIT|bk1")).toEqual({ kind: "EDIT", id: "bk1" });
  });
  it.each(["BSET|x|-1", "BSET|x|21", "BSET|x|a", "BSET||2", "BLINE|", "BEDIT|", "FOO|x", "BSET|x|2|y"])("rejects %j", (t) => expect(parseEditTap(t)).toBeNull());
  it("rows: one per dish plus clear and back, at most 10, titles <= 24, descriptions <= 72", () => {
    const many = Array.from({ length: 15 }, (_, i) => L(`l${i}`, `A very long dish name number ${i} with extras`, `صنف طويل جدا رقم ${i} مع اضافات`, i + 1));
    for (const ar of [false, true]) {
      const rows = editListRows("bk1", many, ar);
      expect(rows.length).toBeLessThanOrEqual(META.listRows);
      for (const r of rows) { expect(r.title.length).toBeLessThanOrEqual(META.rowTitle); expect((r.description ?? "").length).toBeLessThanOrEqual(META.rowDescription); expect(r.id.length).toBeLessThanOrEqual(META.rowId); }
      expect(rows.some((r) => r.id.startsWith("BCLR|"))).toBe(true);
      expect(rows.some((r) => r.id === "BASKET")).toBe(true);
    }
  });
  it("line buttons: one less / one more / remove, titles <= 20, one less hidden at quantity 1, one more hidden at 20", () => {
    const b1 = lineButtons({ id: "x", quantity: 1 }, false); expect(b1.map((b) => b.id)).toEqual(["BSET|x|2", "BSET|x|0", "BASKET"]);
    const b3 = lineButtons({ id: "x", quantity: 3 }, true); expect(b3.map((b) => b.id)).toEqual(["BSET|x|2", "BSET|x|4", "BSET|x|0"]);
    const b20 = lineButtons({ id: "x", quantity: 20 }, false); expect(b20.map((b) => b.id)).toEqual(["BSET|x|19", "BSET|x|0", "BASKET"]);
    for (const b of [...b1, ...b3, ...b20]) expect(b.title.length).toBeLessThanOrEqual(META.buttonTitle);
  });
});

describe("maybeEditText (cheap pre-filter)", () => {
  it.each(["make it 3", "remove the fries", "no fries", "fries x3", "3 pepsi instead", "خليها 3", "شيل البطاطا", "khalli 3", "shil el batata", "ma badde pepsi", "only 2", "without onions"])("%s", (x) => expect(maybeEditText(x)).toBe(true));
  it.each(["hello", "burger", "2 shawarma and fries", "checkout", "yes", "what do you have", "بدي شاورما", "", "x".repeat(100)])("%j", (x) => expect(maybeEditText(x)).toBe(false));
});

describe("maybeEditText: a bare 'no' is not an edit", () => { it.each(["no", "no thanks", "no please", "لا"])("%s", (x) => expect(maybeEditText(x)).toBe(false)); });

describe("the dish added last is the one 'make it 3' means", () => {
  it("adding an existing dish again moves its line to the end (basket_lines are ordered by created_at)", () => {
    const src = require("node:fs").readFileSync(require("node:path").resolve(process.cwd(), "supabase/functions/kapso-brain/index.ts"), "utf8");
    expect(src).toMatch(/update\(\{ quantity: Math\.min\(20, ex\.quantity \+ qty\), created_at: new Date\(\)\.toISOString\(\) \}\)/);
  });
});
