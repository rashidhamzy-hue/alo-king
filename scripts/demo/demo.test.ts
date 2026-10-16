import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { harvestedDrafts, HARVEST_MENUS } from "../vendors/shouf-menus.ts";
import { demoRows, DEMO_SHOPS } from "./build-demo-menus.ts";
import sharp from "sharp";
import {
  coverImage,
  PROCESS_VERSION,
  plan,
  pickOk,
  coverCandidates,
  mainCategoryDishes,
  MIN_SIDE,
  productImage,
  signatureDish,
  sizedImageUrl,
  type Picks,
  type TodoItem,
} from "./demo-photos.ts";
import { dishOf } from "./dishes.ts";

// DECISIONS §39.12, demo mode on staging.
describe("demo shops' full harvested menus", () => {
  it("are Deli Dough, J.O'S and the 8 menus Rasheed found", () => {
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
      ["Un basilico", "harvest", 135],
      ["Verona Resto", "harvest", 14],
      ["West Diner", "harvest", 48],
      ["Sushi Bell", "harvest", 196],
    ]);
  });
  it("fail loudly when a listed shop has no harvested menu", () => {
    expect(() => demoRows([{ place_id: "nope", name: "Nowhere" }], [])).toThrow(
      /no harvested menu/,
    );
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
  const pick = (u: string) => ({
    url: u,
    license: "CC0 1.0",
    credit: "someone",
    source_url: `${u}#page`,
  });
  const picks: Picks = {
    dishes: {
      curly_fries: pick("https://x/curly.jpg"),
      fries: pick("https://x/fries.jpg"),
      cold_cuts: pick("https://x/cuts.jpg"),
    },
    packshots: {
      "Pepsi Can (330ml)": {
        ...pick("https://images.openfoodfacts.org/p.full.jpg"),
        license: "CC BY-SA 3.0",
        brand: "Pepsi",
      },
    },
  };
  it("gives an item without its own picture the real photo of its dish, once", () => {
    const p = plan(item, picks) as any;
    expect([p.kind, p.url, p.license, p.dish]).toEqual([
      "illustrative",
      "https://x/curly.jpg",
      "CC0 1.0",
      "curly_fries",
    ]);
    expect(
      plan(
        { ...item, photo: { source: "illustrative", origin_hash: p.hash, storage_path: "x" } },
        picks,
      ),
    ).toBeNull();
    expect(PROCESS_VERSION).toBe("5e-1");
  });
  it("falls back to the broader dish, and gives nothing to shisha or when no photo was picked", () => {
    expect(
      (plan(item, { ...picks, dishes: { fries: pick("https://x/fries.jpg") } }) as any).url,
    ).toBe("https://x/fries.jpg");
    expect(plan({ ...item, name_en: "Extra Bowl", section_en: "Argile" }, picks)).toBe("none");
    expect(plan(item, { dishes: {}, packshots: {} })).toBe("none");
  });
  it("gives a shelf item its packshot when one was picked, else its shelf dish", () => {
    const shelf = {
      ...item,
      name_en: "Pepsi Can (330ml)",
      section_en: "Water & Beverages",
      business_type: "grocery_supermarket",
    };
    expect((plan(shelf, picks) as any).kind).toBe("packshot");
    expect(
      (plan({ ...shelf, name_en: "Volys Turkey", section_en: "CHARCUTERIE" }, picks) as any).url,
    ).toBe("https://x/cuts.jpg");
  });
  it("uses a pick only when licensed for commercial use, credited and off Google; a packshot only for its brand", () => {
    expect(pickOk("illustrative", pick("https://x/a.jpg"))).toBe(true);
    for (const license of ["CC BY 4.0", "Public Domain Mark 1.0", "Pexels License"])
      expect(pickOk("illustrative", { ...pick("https://x/a.jpg"), license })).toBe(true);
    for (const license of ["CC BY-NC 4.0", "CC BY-ND 2.0", "All rights reserved", ""])
      expect(pickOk("illustrative", { ...pick("https://x/a.jpg"), license })).toBe(false);
    expect(pickOk("illustrative", { ...pick("https://x/a.jpg"), credit: " " })).toBe(false);
    expect(pickOk("illustrative", pick("https://lh3.googleusercontent.com/p/x"))).toBe(false);
    expect(
      pickOk("illustrative", {
        ...pick("https://x/a.jpg"),
        source_url: "https://maps.google.com/x",
      }),
    ).toBe(false);
    const pack = picks.packshots["Pepsi Can (330ml)"];
    expect(pickOk("packshot", pack, { ...item, name_en: "Pepsi Can (330ml)" })).toBe(true);
    expect(pickOk("packshot", pack, { ...item, name_en: "Cola Can (330ml)" })).toBe(false);
    expect(pickOk("packshot", { ...pack, brand: undefined }, { ...item, name_en: "Pepsi" })).toBe(
      false,
    );
    expect(pickOk("packshot", { ...pack, license: "CC0 1.0" }, { ...item, name_en: "Pepsi" })).toBe(
      false,
    );
    expect(
      pickOk("packshot", { ...pack, url: "https://x/p.jpg" }, { ...item, name_en: "Pepsi" }),
    ).toBe(false);
    expect(MIN_SIDE).toBe(500);
  });
  it("prefers the shop's own website image (Fred's Food), at 800 px; never a Google photo", () => {
    const url =
      "https://i0.wp.com/freds-food.com/wp-content/uploads/2022/06/Fries.jpg?resize=300%2C300&ssl=1";
    expect((plan({ ...item, image_url: url }, picks) as any).kind).toBe("merchant_site");
    expect(sizedImageUrl(url)).toContain("resize=800%2C800");
    expect(
      (plan({ ...item, image_url: "https://lh3.googleusercontent.com/p/x=s800" }, picks) as any)
        .kind,
    ).toBe("illustrative");
  });
  it("makes every product 800 × 800 and every cover 1200 × 800, JPEG", async () => {
    const wide = await sharp({
      create: { width: 1600, height: 900, channels: 3, background: "#c33" },
    })
      .png()
      .toBuffer();
    for (const kind of ["illustrative", "packshot"] as const) {
      const m = await sharp(await productImage(wide, kind)).metadata();
      expect([m.width, m.height, m.format]).toEqual([800, 800, "jpeg"]);
    }
    const c = await sharp(await coverImage(wide)).metadata();
    expect([c.width, c.height]).toEqual([1200, 800]);
  });
  it("lists a shop's cover candidates: its own photos (signature dish first), then picked photos of its dishes", () => {
    const shop = {
      vendor: "Shop",
      dishes: ["burger", "burger", "fries", "soda", "manousheh"],
      own: [
        { url: "https://x/own-fries.jpg", original: "https://x/own-fries.jpg", dish: "fries" },
        { url: "https://x/own-pizza.jpg", original: "https://x/own-pizza.jpg", dish: "pizza" },
        { url: "https://x/own-burger.jpg", original: "https://x/own-burger.jpg", dish: "burger" },
      ],
    };
    const p: Picks = {
      dishes: {
        burger: pick("https://x/burger.jpg"),
        fries: pick("https://x/fries.jpg"),
        pizza: pick("https://x/pizza.jpg"),
      },
      packshots: {},
    };
    expect(coverCandidates(shop, p).map((c) => c.url)).toEqual([
      "https://x/own-burger.jpg",
      "https://x/own-pizza.jpg",
      "https://x/burger.jpg",
    ]);
    // No pick for its most common dish: the next dish that has one; a side (fries) never makes a cover.
    const m = { vendor: "M", dishes: ["manousheh", "manousheh", "fries", "pizza"], own: [] };
    expect(coverCandidates(m, p).map((c) => c.url)).toEqual(["https://x/pizza.jpg"]);
  });
  it("a burger place shows a burger: its main category's dishes come first, even when another dish is more common (§39.15.2)", () => {
    const p: Picks = {
      dishes: {
        burger: pick("https://x/burger.jpg"),
        broasted_chicken: pick("https://x/chicken.jpg"),
      },
      packshots: {},
    };
    const shop = {
      vendor: "BUN BROS",
      dishes: ["broasted_chicken", "broasted_chicken", "broasted_chicken", "burger", "burger"],
      own: [],
      mainDishes: ["burger"],
    };
    expect(coverCandidates(shop, p).map((c) => c.url)).toEqual([
      "https://x/burger.jpg",
      "https://x/chicken.jpg",
    ]);
    // Its own photos too: the main category's dish first.
    const own = {
      ...shop,
      own: [
        {
          url: "https://x/own-chicken.jpg",
          original: "https://x/own-chicken.jpg",
          dish: "broasted_chicken",
        },
        { url: "https://x/own-burger.jpg", original: "https://x/own-burger.jpg", dish: "burger" },
      ],
    };
    expect(coverCandidates(own, p)[0].url).toBe("https://x/own-burger.jpg");
  });
  it("finds the main category's dishes by the category's pattern, ranked by what is ordered", () => {
    const item = (id: string, name_en: string) =>
      ({
        item_id: id,
        vendor_id: "v",
        name_en,
        name_ar: null,
        description: null,
        section_en: null,
        business_type: null,
        vendor: "v",
        image_url: null,
        photo: null,
      }) as any;
    const items = [
      item("1", "Classic Burger"),
      item("2", "Chicken Burger"),
      item("3", "Crispy Strips"),
      item("4", "Smash burger"),
    ];
    const ranked = mainCategoryDishes(items, "burger|\\mbrgr\\M", new Map([["2", 9]]));
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked).not.toContain(dishOf(items[2]));
    expect(ranked[0]).toBe(dishOf(items[1]));
  });
  it("covers a shop with its signature dish, never a drink or a dip", () => {
    expect(signatureDish(["soda", "soda", "soda", "burger", "burger", "fries", "dip"])).toBe(
      "burger",
    );
    expect(signatureDish(["soda", "water"])).toBeNull();
  });
});
