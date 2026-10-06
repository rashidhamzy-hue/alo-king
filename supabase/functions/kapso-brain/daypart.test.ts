import { describe, expect, it } from "vitest";
import { daypartAt, daypartLabel, daypartScore, isExtraItem, itemDayparts } from "./daypart.ts";
import { buildNumberedPage, orderForList } from "./numbered.ts";

const it_ = (name: string, section = "", extra: Record<string, unknown> = {}) => ({ item_id: name, item_name_en: name, section, price_usd: 5, ...extra });
const names = (l: any[]) => l.map((x) => x.item_name_en);
// Asia/Beirut is UTC+3 on 6 Oct 2026
const at = (h: number) => new Date(Date.UTC(2026, 9, 6, h - 3, 30));

describe("daypartAt (Asia/Beirut)", () => {
  it("maps the hour", () => {
    expect([7, 12, 19, 23, 2].map((h) => daypartAt(at(h)))).toEqual(["breakfast", "lunch", "dinner", "late", "late"]);
  });
  it("boundaries", () => { expect(daypartAt(at(10))).toBe("breakfast"); expect(daypartAt(at(11))).toBe("lunch"); expect(daypartAt(at(16))).toBe("dinner"); expect(daypartAt(at(22))).toBe("late"); expect(daypartAt(at(5))).toBe("breakfast"); });
});

describe("dish tagging", () => {
  it("tags from section and name, English and Arabic", () => {
    expect(itemDayparts(it_("Cheese Manoushe", "Manakish"))).toEqual(["breakfast"]);
    expect(itemDayparts({ item_id: "a", item_name_ar: "فول", section: "فطور" })).toEqual(["breakfast"]);
    expect(itemDayparts(it_("Mixed Grill", "Plates"))).toEqual(expect.arrayContaining(["lunch", "dinner"]));
    expect(itemDayparts(it_("Margherita", "Pizza"))).toEqual(expect.arrayContaining(["dinner"]));
    expect(itemDayparts(it_("Chicken Shawarma", "Sandwiches"))).toEqual(expect.arrayContaining(["late"]));
    expect(itemDayparts(it_("Mystery dish", "Specials"))).toBeNull();
  });
  it("score: 2 for now, 1 all day, 0 for another time", () => {
    expect(daypartScore(it_("Eggs", "Breakfast"), "breakfast")).toBe(2);
    expect(daypartScore(it_("Mystery", "Specials"), "dinner")).toBe(1);
    expect(daypartScore(it_("Eggs", "Breakfast"), "dinner")).toBe(0);
  });
  it("extras: drinks, sides, sauces, bread", () => { for (const [n, s] of [["Pepsi", "Drinks"], ["Garlic Sauce", "Sauces"], ["Fries", "Sides"], ["Pita Bread", ""]]) expect(isExtraItem(it_(n, s)), n).toBe(true); expect(isExtraItem(it_("Mixed Grill", "Plates"))).toBe(false); });
});

describe("orderForList ranks by daypart, then vendor order/popularity, then mains before extras", () => {
  const menu = [
    it_("Pepsi", "Drinks", { is_popular: true }), it_("Cheese Manoushe", "Manakish"), it_("Mixed Grill", "Plates"), it_("Margherita", "Pizza", { sort_order: 1 }),
    it_("Eggs and Foul", "Breakfast", { is_popular: true }), it_("Red Label", "Drinks", { is_popular: true }), it_("Add Cheese", "Extras"), it_("Chef Special", "Specials"),
  ];
  it("at breakfast, breakfast dishes lead and dinner dishes sink", () => {
    const l = names(orderForList(menu, "breakfast"));
    expect(l.slice(0, 2).sort()).toEqual(["Cheese Manoushe", "Eggs and Foul"]);
    expect(l.indexOf("Eggs and Foul")).toBeLessThan(l.indexOf("Chef Special")); expect(l.indexOf("Chef Special")).toBeLessThan(l.indexOf("Mixed Grill"));
  });
  it("at dinner, breakfast is last; popular and vendor-ordered dishes lead within the daypart", () => {
    const l = names(orderForList(menu, "dinner"));
    expect(l.slice(-2)).toEqual(expect.arrayContaining(["Cheese Manoushe", "Eggs and Foul"]));
    expect(l.indexOf("Margherita")).toBeLessThan(l.indexOf("Mixed Grill")); // vendor sort_order 1 first among same-score dishes
  });
  it("add-ons and alcohol are never listed", () => { for (const dp of ["breakfast", "lunch", "dinner", "late"] as const) { const l = names(orderForList(menu, dp)); expect(l).not.toContain("Add Cheese"); expect(l).not.toContain("Red Label"); } });
  it("main dishes come before extras when nothing else separates them", () => {
    const l = names(orderForList([it_("Pepsi", "Drinks"), it_("Zaatar Plate", "Specials"), it_("Fries", "Sides"), it_("Kofta", "Specials")], "lunch"));
    expect(l.slice(0, 2).sort()).toEqual(["Kofta", "Zaatar Plate"]);
  });
});

describe("numbered page copy", () => {
  const items = (dp: any) => orderForList([it_("Kofta", "Plates"), it_("Eggs", "Breakfast")], dp);
  const both = (n: number) => `$${n}`;
  it("says the quantity format", () => {
    const en = buildNumberedPage({ vendorName: "V", items: items("lunch"), page: 0, ar: false, daypart: "lunch", both }).body;
    expect(en).toContain("Reply like *1x2, 4x1*");
    expect(buildNumberedPage({ vendorName: "V", items: items("lunch"), page: 0, ar: true, daypart: "lunch", both }).body).toContain("1x2, 4x1");
  });
  it("without popularity data the title names the daypart (not 'Popular right now'); with it, 'Popular right now'", () => {
    const none = buildNumberedPage({ vendorName: "V", items: items("lunch"), page: 0, ar: false, daypart: "lunch", both }).body;
    expect(none).toContain(daypartLabel("lunch", false)); expect(none).not.toContain("Popular right now");
    const pop = buildNumberedPage({ vendorName: "V", items: orderForList([it_("Kofta", "Plates", { is_popular: true })], "lunch"), page: 0, ar: false, daypart: "lunch", both }).body;
    expect(pop).toContain("Popular right now");
  });
  it("still just 'Menu' when no daypart is given", () => expect(buildNumberedPage({ vendorName: "V", items: items("lunch"), page: 0, ar: false, both }).body).toContain("Menu"));
});
