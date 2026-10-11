import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractMenu, parsePrice, validateDraft } from "./menu-draft";

describe("parsePrice: never invents a currency", () => {
  it.each([
    ["4$", 4, "USD"],
    ["$4.50", 4.5, "USD"],
    ["4,5 USD", 4.5, "USD"],
    ["٤ دولار", 4, "USD"],
    ["150,000 L.L.", 150000, "LBP"],
    ["150.000 LL", 150000, "LBP"],
    ["150 ألف", 150000, "LBP"],
    ["LBP 90000", 90000, "LBP"],
    ["200,000 ل.ل", 200000, "LBP"],
    ["5", 5, null],
    [5, 5, null],
  ] as const)("%s", (raw, price, currency) => {
    expect(parsePrice(raw)).toEqual({ price, currency });
  });
  it("no number, negative, or a contradiction is not a price in a currency", () => {
    expect(parsePrice("ask")).toEqual({ price: null, currency: null });
    expect(parsePrice(null)).toEqual({ price: null, currency: null });
    expect(parsePrice(-3)).toEqual({ price: null, currency: null });
    expect(parsePrice("4$ / 360,000 LL").currency).toBeNull();
  });
});

describe("validateDraft on a test menu (fixture written by Claude Code, §32.7)", () => {
  const raw = JSON.parse(readFileSync("evals/menus/snack-baakline.raw.json", "utf8"));
  const d = validateDraft(raw);
  const items = d.sections.flatMap((s) => s.items);
  it("keeps names in their language and drops empty sections", () => {
    expect(d.sections).toHaveLength(2);
    expect(d.sections[0].name_ar).toBe("سندويشات");
    expect(items.find((i) => i.name_ar === "منقوشة زعتر")).toBeTruthy();
    expect(items.find((i) => i.name_en === "Cheese manoushe")).toBeTruthy();
  });
  it("prices exactly as read: USD, LBP, bare numbers without currency, and missing prices", () => {
    const by = (n: string) => items.find((i) => [i.name_ar, i.name_en].includes(n))!;
    expect(by("Chicken Shawarma")).toMatchObject({ price: 4, currency: "USD" });
    expect(by("فلافل")).toMatchObject({ price: 200000, currency: "LBP" });
    expect(by("بطاطا")).toMatchObject({ price: 150000, currency: "LBP" });
    expect(by("Kafta")).toMatchObject({ price: 5, currency: null });
    expect(by("Escalope")).toMatchObject({ price: null, currency: null });
    expect(by("Escalope").options?.[0].choices[1]).toEqual({ name: "Large", price: 1, currency: "USD" });
  });
  it("menu text that looks like instructions is dropped and reported, never followed", () => {
    expect(items.some((i) => /IGNORE/i.test(i.name_en ?? ""))).toBe(false);
    expect(d.warnings.some((w) => /instruction-like/.test(w))).toBe(true);
  });
  it("never adds flags, allergens or diet tags", () => {
    for (const i of items) {
      expect(Object.keys(i)).not.toContain("allergens");
      expect(Object.keys(i)).not.toContain("vegan");
    }
  });
  it("warns about every item the merchant must price", () => {
    expect(d.warnings.filter((w) => /no price|without currency/.test(w))).toHaveLength(2);
  });
});

describe("extractMenu", () => {
  it("malformed model output gives an empty draft, not a guess", async () => {
    const d = await extractMenu(async () => "Sorry, I cannot read this", [{ type: "text", text: "x" }]);
    expect(d.sections).toEqual([]);
    expect(d.warnings.join()).toMatch(/no usable JSON|no menu items/);
  });
  it("passes the system prompt that forbids invented prices", async () => {
    let sys = "";
    await extractMenu(async (r) => {
      sys = r.system;
      return '{"sections":[]}';
    }, []);
    expect(sys).toMatch(/Never guess a price or a currency/);
  });
});

import { parseMenuText } from "./menu-draft";
describe("parseMenuText: a pasted menu without a model", () => {
  const d = parseMenuText(
    [
      "سندويشات",
      "شاورما دجاج 4$",
      "طاووق - 4.5 $",
      "فلافل 200,000 ل.ل",
      "",
      "Manakish",
      "Zaatar 1 USD",
      "150 ألف جبنة",
      "Kafta 5",
      "Special of the day",
    ].join("\n"),
  );
  it("never glues currency letters from a name (\"Roll 3\" is not LBP)", () => {
    const t = parseMenuText("Falafel Roll 3\nMixed Grill 12\nAll in one 4$\nShell 2 LL");
    const items = t.sections.flatMap((s) => s.items);
    expect(items[0]).toMatchObject({ name_en: "Falafel Roll", price: 3, currency: null });
    expect(items[1]).toMatchObject({ name_en: "Mixed Grill", price: 12, currency: null });
    expect(items[2]).toMatchObject({ name_en: "All in one", price: 4, currency: "USD" });
    expect(items[3]).toMatchObject({ name_en: "Shell", price: 2, currency: "LBP" });
  });
  it("a model's separate currency field is ignored; only the printed text counts", () => {
    const d = validateDraft({ sections: [{ items: [{ name_en: "Kafta", price_text: "4", currency: "USD" }] }] });
    expect(d.sections[0].items[0]).toMatchObject({ price: 4, currency: null });
  });
  it("finds sections and prices with their currency", () => {
    expect(d.sections.map((s) => s.name_ar ?? s.name_en)).toEqual(["سندويشات", "Manakish"]);
    const items = d.sections.flatMap((s) => s.items);
    expect(items.find((i) => i.name_ar === "شاورما دجاج")).toMatchObject({ price: 4, currency: "USD" });
    expect(items.find((i) => i.name_ar === "فلافل")).toMatchObject({ price: 200000, currency: "LBP" });
    expect(items.find((i) => i.name_ar === "جبنة")).toMatchObject({ price: 150000, currency: "LBP" });
    expect(items.find((i) => i.name_en === "Kafta")).toMatchObject({ price: 5, currency: null });
  });
});
