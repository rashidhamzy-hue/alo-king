import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { harvestedDrafts, HARVEST_MENUS } from "../vendors/shouf-menus.ts";
import { demoRows, DEMO_SHOPS, withoutRestricted } from "./build-demo-menus.ts";
import { DRAWING_VERSION, plan, sizedImageUrl, type TodoItem } from "./demo-photos.ts";
import { categoryOf, illustrationSvg, lines } from "./illustration.ts";

// DECISIONS §39.12, demo mode on staging.
describe("demo shops' full harvested menus", () => {
  it("are Deli Dough, J.O'S and the 8 menus Rasheed found (alcohol and tobacco left out)", () => {
    const overrides = JSON.parse(readFileSync(DEMO_SHOPS, "utf8")).full_harvested_menu;
    const harvested = harvestedDrafts(
      JSON.parse(readFileSync(HARVEST_MENUS, "utf8")),
      HARVEST_MENUS,
    );
    const rows = demoRows(overrides, harvested);
    const count = (r: string[]) =>
      (JSON.parse(r[3]) as { items: unknown[] }[]).reduce((n, s) => n + s.items.length, 0);
    expect(rows.map((r) => [r[1], r[2], count(r)])).toEqual([
      ["Deli Dough", "harvest", 350],
      ["J.O'S House of Subs", "harvest", 52],
      ["Safa Chicken", "harvest", 140],
      ["Tarabish", "harvest", 77],
      ["ROUTE 66", "harvest", 72],
      ["BUN BROS", "harvest", 42],
      ["Un basilico", "harvest", 87],
      ["Verona Resto", "harvest", 14],
      ["West Diner", "harvest", 48],
      ["Sushi Bell", "harvest", 177],
    ]);
  });
  it("fail loudly when a listed shop has no harvested menu", () => {
    expect(() => demoRows([{ place_id: "nope", name: "Nowhere" }], [])).toThrow(
      /no harvested menu/,
    );
  });
});

describe("illustrative item photos", () => {
  it("pick the picture from the item's name, then its section, then the shop's type", () => {
    expect(categoryOf({ name_en: "Chicken Burger" })).toBe("burger");
    expect(categoryOf({ name_en: "Chocolate Cake" })).toBe("dessert");
    expect(categoryOf({ name_en: "Pepsi Can (330ml)" })).toBe("soda");
    expect(categoryOf({ name_ar: "شاورما دجاج" })).toBe("wrap");
    expect(categoryOf({ name_en: "ZAATAR" })).toBe("manousheh");
    expect(categoryOf({ name_en: "House Special", section_en: "Pizzas" })).toBe("pizza");
    expect(categoryOf({ name_en: "HELLO MI", business_type: "bakery_manakish" })).toBe("manousheh");
    expect(categoryOf({ name_en: "Mystery", business_type: "restaurant" })).toBe("dish");
  });
  it("are labelled as an illustration and show the item's name, escaped", () => {
    const svg = illustrationSvg({ name_en: "Fish & <Chips>", vendor: "Fred's", category: "fries" });
    expect(svg).toContain("Illustration");
    expect(svg).toContain("صورة توضيحية");
    expect(svg).toContain("Fish &amp; &lt;Chips&gt;");
    expect(svg).not.toContain("<Chips>");
  });
  it("wrap a long name on two lines at most", () => {
    expect(lines("Tannourine Natural Mineral Water (1.5L x 6 Pack)", 22)).toHaveLength(2);
    expect(lines("Water", 22)).toEqual(["Water"]);
  });
});

describe("the photo plan per item", () => {
  const item: TodoItem = {
    item_id: "11111111-1111-1111-1111-111111111111",
    vendor_id: "22222222-2222-2222-2222-222222222222",
    name_en: "Curly Fries",
    name_ar: null,
    description: null,
    section_en: null,
    business_type: "fast_food",
    vendor: "Fred's Food Baakline",
    image_url: null,
    photo: null,
  };
  it("draws an item without a website image, once", () => {
    const p = plan(item)!;
    expect(p.kind).toBe("illustrative");
    expect(
      plan({ ...item, photo: { source: "illustrative", origin_hash: p.hash, storage_path: "x" } }),
    ).toBeNull();
    expect(DRAWING_VERSION).toBe("1");
  });
  it("prefers the shop's own website image (Fred's Food), at 800 px", () => {
    const url =
      "https://i0.wp.com/freds-food.com/wp-content/uploads/2022/06/Fries.jpg?resize=300%2C300&ssl=1";
    expect(plan({ ...item, image_url: url })!.kind).toBe("merchant_site");
    expect(sizedImageUrl(url)).toContain("resize=800%2C800");
  });
});

describe("demo menus and the Meta catalogue", () => {
  it("leave out alcohol and tobacco (Meta commerce policy), keeping cocktail sauce and soft drinks", () => {
    const item = (name_en: string) => ({
      name_en,
      price: 5,
      currency: "USD" as const,
      confidence: 0.5,
    });
    const out = withoutRestricted([
      { name_ar: null, name_en: "Wine", name_fr: null, items: [item("les coteaux BTL")] },
      { name_ar: null, name_en: "Shisha", name_fr: null, items: [item("Lemon mint")] },
      {
        name_ar: null,
        name_en: "Beverage",
        name_fr: null,
        items: [item("black label glass"), item("Pepsi"), item("Hookahs"), item("Cocktail sauce")],
      },
    ]);
    expect(out.map((s) => [s.name_en, s.items.map((i) => i.name_en)])).toEqual([
      ["Beverage", ["Pepsi", "Cocktail sauce"]],
    ]);
  });
});
