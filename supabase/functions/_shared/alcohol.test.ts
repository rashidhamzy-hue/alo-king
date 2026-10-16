import { describe, expect, it } from "vitest";
import { alcoholRefusal, asksForAlcohol, isAlcohol, withoutAlcohol } from "./alcohol.ts";
import { orderForList } from "../kapso-brain/numbered.ts";
import { buildCategories, pickAddon } from "../kapso-brain/browse.ts";

const item = (name: string, section = "Drinks", extra: Record<string, unknown> = {}) => ({ item_id: name, item_name_en: name, section, price_usd: 3, ...extra });

describe("isAlcohol: from data", () => {
  it("trusts the contains_alcohol flag", () => expect(isAlcohol(item("House special", "Mains", { contains_alcohol: true }))).toBe(true));
  it("flags alcohol sections", () => {
    for (const s of ["Alcohol", "Beers", "Wine", "Spirits", "Whisky", "مشروبات كحولية", "خمور", "نبيذ", "بيرة"]) expect(isAlcohol(item("Anything", s))).toBe(true);
  });
  it("does not flag ordinary sections", () => { for (const s of ["Drinks", "Salad bar", "Sandwiches", "Cocktails", "Juices"]) expect(isAlcohol(item("Lemonade", s))).toBe(false); });
});

describe("isAlcohol: brand and keyword list", () => {
  it("catches Red Label and Black Label (the owner's case) even with no flag and a Drinks section", () => {
    expect(isAlcohol(item("Red Label"))).toBe(true);
    expect(isAlcohol(item("Johnnie Walker Black Label 70cl"))).toBe(true);
    expect(isAlcohol(item("black label"))).toBe(true);
  });
  it("catches beers, wine, spirits in English", () => {
    for (const n of ["Almaza Beer", "Amstel 33cl", "Heineken", "Budweiser", "Carlsberg", "Red Wine Glass", "House Wine", "Vodka Shot", "Arak Ksara", "Whisky", "Whiskey on the rocks", "Jack Daniels", "Chateau Ksara", "Baileys", "Champagne"]) expect(isAlcohol(item(n)), n).toBe(true);
  });
  it("catches Arabic names", () => {
    for (const n of ["بيرة المازة", "ألماظة", "امستل", "هاينكن", "نبيذ أحمر", "ويسكي", "فودكا", "عرق", "ريد ليبل", "بلاك ليبل"]) expect(isAlcohol({ item_id: n, item_name_ar: n, section: "مشروبات" }), n).toBe(true);
  });
  it("catches Arabizi", () => { for (const n of ["bira", "3arak", "wiski", "nbeez", "fodka"]) expect(isAlcohol(item(n)), n).toBe(true); });
  it("ignores diacritics and spacing", () => { expect(isAlcohol(item("  HEINEKEN!! "))).toBe(true); expect(isAlcohol({ item_id: "x", item_name_ar: "عَرَق", section: "x" })).toBe(true); });
  it("does not flag soft drinks, malt drinks, licorice juice or food", () => {
    for (const n of ["Root Beer", "Ginger Beer", "Ginger Ale", "Heineken 0.0", "Non-alcoholic beer", "Virgin Mojito", "Pepsi", "Lemonade", "Jallab", "Corona Chicken Wrap", "Gin Gin Chicken", "Laziza Malt Drink", "Moussy", "Fruit Cocktail Juice", "Wine vinegar salad", "Garlic toum"]) {
      expect(isAlcohol(item(n)), n).toBe(false);
    }
    expect(isAlcohol({ item_id: "a", item_name_ar: "عرق سوس", section: "عصائر" })).toBe(false);
    expect(isAlcohol({ item_id: "b", item_name_ar: "جلاب", section: "مشروبات" })).toBe(false);
  });
  it("does not flag vine leaves written as wine leaves, or licorice juice in Latin letters (§39.15.4 review)", () => {
    for (const n of ["Wine Leaves", "Stuffed Wine Leaves", "Vine leaves", "Arak Soos", "Arak sous", "Erk Soos", "3erk soos"]) expect(isAlcohol(item(n)), n).toBe(false);
    // Penne vodka has vodka in its sauce: it stays alcohol (docs/decisions/DATA-ISSUES.md).
    expect(isAlcohol(item("Penne Vodka"))).toBe(true);
  });
  it("a bare ambiguous word counts only as the whole name or next to a drink word", () => {
    expect(isAlcohol(item("Gin"))).toBe(true);
    expect(isAlcohol(item("Gin and Tonic bottle"))).toBe(true);
    expect(isAlcohol(item("Stella"))).toBe(true);
    expect(isAlcohol(item("Stella Pizza"))).toBe(false);
  });
});

describe("alcohol is removed everywhere a customer picks a dish", () => {
  const menu = [
    item("Chicken Shawarma", "Sandwiches", { is_popular: true }), item("Red Label", "Drinks", { is_popular: true, sort_order: 1 }), item("Almaza Beer", "Drinks"), item("Pepsi", "Drinks"), item("Black Label", "Soft drinks"), item("Falafel", "Sandwiches"),
  ];
  it("withoutAlcohol", () => expect(withoutAlcohol(menu).map((m) => m.item_id)).toEqual(["Chicken Shawarma", "Pepsi", "Falafel"]));
  it("the popular/numbered list never contains it, even when the beer is flagged popular", () => {
    const l = orderForList(menu).map((m) => m.item_id);
    expect(l).not.toContain("Red Label"); expect(l).not.toContain("Almaza Beer"); expect(l).not.toContain("Black Label");
    expect(l).toContain("Chicken Shawarma");
  });
  it("the drink upsell never offers it", () => {
    const drinks = [item("Red Label", "Drinks", { is_popular: true, price_usd: 1 }), item("Almaza Beer", "Drinks", { price_usd: 1 }), item("Orange Juice", "Drinks", { price_usd: 4 })];
    expect(pickAddon(drinks, ["Chicken Shawarma"])?.item_id).toBe("Orange Juice");
    expect(pickAddon(drinks.slice(0, 2), [])).toBeNull();
  });
  it("categories do not count alcohol", () => {
    const cats = buildCategories(withoutAlcohol([...menu, item("Whisky", "Whisky")]));
    expect(cats.map((c) => c.title)).not.toContain("Whisky");
  });
});

describe("asking for alcohol", () => {
  it("is recognised in three scripts", () => { for (const t of ["beer", "a bottle of arak", "red label please", "بدي بيرة", "bira", "3arak"]) expect(asksForAlcohol(t), t).toBe(true); });
  it("is not triggered by food or safe drinks", () => { for (const t of ["root beer", "shawarma", "ginger beer", "2 falafel", "عصير ليمون"]) expect(asksForAlcohol(t), t).toBe(false); });
  it("the refusal is in both languages and offers a way forward", () => { expect(alcoholRefusal(false)).toMatch(/alcohol/i); expect(alcoholRefusal(true)).toMatch(/كحول/); expect(alcoholRefusal(false)).toMatch(/\?$/); });
});

describe("review follow-ups: cooking words and place names are not alcohol", () => {
  it("dishes cooked with a drink stay visible", () => {
    for (const n of ["Beer battered fish", "Wine sauce steak", "Cognac pepper sauce", "Bourbon BBQ chicken", "Champagne chicken", "Tequila lime chicken", "Rum cake", "Baba au rhum", "Double Black Forest cake", "Double Black Coffee", "Ksara sandwich", "Apple cider vinegar shot"]) expect(isAlcohol(item(n, "Mains")), n).toBe(false);
  });
  it("still catches the real thing", () => { for (const n of ["Chateau Ksara Red", "Ksara Reserve wine", "Massaya", "Double Black Johnnie Walker"]) expect(isAlcohol(item(n)), n).toBe(true); });
  it("a request that is only about a cooking style is not refused", () => { for (const t of ["no wine sauce please", "do you have beer battered onion rings", "burger without cognac", "wine sauce steak with fries please thanks"]) expect(asksForAlcohol(t), t).toBe(false); });
  it("short real requests are still refused", () => { for (const t of ["beer", "red label", "bottle of arak", "بيرة", "Stella"]) expect(asksForAlcohol(t), t).toBe(true); });
});
