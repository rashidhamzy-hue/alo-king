import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { harvestedDrafts, HARVEST_MENUS } from "../vendors/shouf-menus.ts";
import { demoRows, DEMO_SHOPS } from "./build-demo-menus.ts";
import sharp from "sharp";
import {
  coverImage,
  clearsOnNone,
  coverHash,
  coverTries,
  dishFallback,
  PROCESS_VERSION,
  plan,
  pickOk,
  coverCandidates,
  mainCategoryDishes,
  MIN_SIDE,
  measureOf,
  photoIssues,
  policyHeld,
  productImage,
  RefusedPhoto,
  sourceIssues,
  signatureDish,
  sizedImageUrl,
  type Picks,
  type TodoItem,
} from "./demo-photos.ts";
import { execFileSync } from "node:child_process";
import { DISHES, dishOf, ownPhotoDish, photoChain, photoDish, type ItemText } from "./dishes.ts";

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
  it("falls back to the broader dish where it shows the same dish, and gives nothing to shisha or when no photo was picked", () => {
    expect(
      (
        plan(
          { ...item, name_en: "Chicken Nuggets" },
          { ...picks, dishes: { fried_chicken: pick("https://x/chicken.jpg") } },
        ) as any
      ).url,
    ).toBe("https://x/chicken.jpg");
    // Curly fries are not the plain fries of the fries photo (session 5g).
    expect(plan(item, { ...picks, dishes: { fries: pick("https://x/fries.jpg") } })).toBe("none");
    expect(plan({ ...item, name_en: "Extra Bowl", section_en: "Argile" }, picks)).toBe("none");
    expect(plan(item, { dishes: {}, packshots: {} })).toBe("none");
  });
  it("gives a shelf item its packshot when one was picked, else nothing (a generic photo is not the product)", () => {
    const shelf = {
      ...item,
      name_en: "Pepsi Can (330ml)",
      section_en: "Water & Beverages",
      business_type: "grocery_supermarket",
    };
    expect((plan(shelf, picks) as any).kind).toBe("packshot");
    expect(plan({ ...shelf, name_en: "Volys Turkey", section_en: "CHARCUTERIE" }, picks)).toBe(
      "none",
    );
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

// DECISIONS §39.15.4: the catalogue validator runs before a demo photo is saved.
describe("catalogue rules before a demo photo is saved", () => {
  const img = (w: number, h: number, flat = false) =>
    sharp({
      create: {
        width: w,
        height: h,
        channels: 3,
        background: flat ? "#ffffff" : "#884422",
        ...(flat ? {} : { noise: { type: "gaussian" as const, mean: 128, sigma: 30 } }),
      },
    })
      .jpeg({ quality: 85 })
      .toBuffer()
      .then((b) => new Uint8Array(b));
  const src = async (w: number, h: number, url = "https://x.test/dish.jpg", flat = false) => ({
    url,
    bytes: await img(w, h, flat),
    width: w,
    height: h,
  });
  const codes = (x: { code: string }[]) => x.map((i) => i.code);
  it("a source below 500 px, off https, or a placeholder is refused; its shape is not (it is cropped square)", async () => {
    expect(codes(sourceIssues(await src(480, 640)))).toEqual(["image_too_small"]);
    expect(codes(sourceIssues(await src(900, 900, "http://x.test/dish.jpg")))).toEqual([
      "image_not_https",
    ]);
    expect(
      codes(sourceIssues(await src(900, 900, "https://shop.test/wp/woocommerce-placeholder.jpg"))),
    ).toEqual(["image_placeholder"]);
    expect(codes(sourceIssues(await src(3000, 1000)))).toEqual([]);
    expect(MIN_SIDE).toBe(500);
  });
  it("the processed file Meta fetches is checked too: a flat picture is a placeholder even at 800 × 800", async () => {
    const good = await src(1600, 900);
    expect(photoIssues(good, await productImage(good.bytes, "illustrative"))).toEqual([]);
    const flat = await src(1600, 900, "https://x.test/white.jpg", true);
    expect(codes(photoIssues(flat, await productImage(flat.bytes, "illustrative")))).toEqual([
      "image_placeholder",
    ]);
    // A small source stays refused although the processed file is 800 × 800.
    const small = await src(300, 300);
    expect(codes(photoIssues(small, await productImage(small.bytes, "illustrative")))).toEqual([
      "image_too_small",
    ]);
    expect(
      new RefusedPhoto(photoIssues(small, await productImage(small.bytes, "illustrative"))).message,
    ).toBe("refused by the catalogue rules: image_too_small");
  });
  it("measures a stored photo from its file (older photos get their size without being made again)", async () => {
    const stored = await productImage((await src(1600, 900)).bytes, "illustrative");
    expect(measureOf(stored)).toEqual({ width: 800, height: 800, bytes: stored.byteLength });
    expect(measureOf(new Uint8Array(100))).toBeNull();
  });
  it("counts the items the catalogue holds for its commerce policy (their photo is still saved)", () => {
    const base = {
      item_id: "11111111-1111-1111-1111-111111111111",
      vendor_id: "22222222-2222-2222-2222-222222222222",
      description: null,
      section_en: null,
      business_type: "minimarket",
      vendor: "Shop",
      image_url: null,
      photo: null,
    };
    expect(codes(policyHeld({ ...base, name_en: "Almaza Beer 330ml", name_ar: null }))).toEqual([
      "policy_alcohol",
    ]);
    expect(codes(policyHeld({ ...base, name_en: "Marlboro Gold", name_ar: null }))).toEqual([
      "policy_tobacco",
    ]);
    expect(codes(policyHeld({ ...base, name_en: "Curly Fries", name_ar: "بطاطا" }))).toEqual([]);
  });
});

// Session 5g (Rasheed, 17 October): "Markouk Saj Bread" showed a loaf. Better nothing than a wrong photo; an item without
// one stays reachable as a list after its section's product message (§39.15.2). The names are the staging demo menus'.
describe("a dish photo only where it shows the item (session 5g)", () => {
  const shelf = (name_en: string, section_en: string): ItemText => ({
    name_en,
    section_en,
    business_type: "grocery_supermarket",
  });
  const dish = (name_en: string, section_en = "Menu", name_ar: string | null = null): ItemText => ({
    name_en,
    name_ar,
    section_en,
    business_type: "restaurant",
  });
  const todo = (it: ItemText, photo: TodoItem["photo"] = null): TodoItem => ({
    item_id: "11111111-1111-1111-1111-111111111111",
    vendor_id: "22222222-2222-2222-2222-222222222222",
    name_en: it.name_en ?? null,
    name_ar: it.name_ar ?? null,
    description: it.description ?? null,
    section_en: it.section_en ?? null,
    business_type: it.business_type ?? null,
    vendor: "Shop",
    image_url: null,
    photo,
  });
  // Every dish key has a photo here, so only the rules can leave an item without one.
  const all: Picks = {
    dishes: Object.fromEntries(
      DISHES.filter((d) => d.key !== "none").map((d) => [
        d.key,
        { url: `https://x/${d.key}.jpg`, license: "CC0 1.0", credit: "c", source_url: null },
      ]),
    ),
    packshots: {},
  };
  const photo = (it: ItemText) => {
    const p = plan(todo(it), all);
    return p === "none" || p === null ? "none" : p.dish;
  };

  it("a specific bread maps only to its own bread, never to the loaf", () => {
    expect(dishOf(shelf("Fresh Shouf Markouk Saj Bread (Large Pack)", "Bakery & Bread"))).toBe(
      "saj_bread",
    );
    expect(dishOf(dish("Markouk Saj Bread", "Bakery"))).toBe("saj_bread");
    expect(photo(dish("Markouk Saj Bread", "Bakery"))).toBe("saj_bread");
    // With only the loaf picked (as on staging), markouk, pita, buns, kaak, a piston or a ciabatta get nothing.
    const loaf: Picks = { dishes: { bread: all.dishes.bread }, packshots: {} };
    for (const name of [
      "Markouk Saj Bread",
      "Lebanese White Pita Bread",
      "Burger Buns with Sesame",
      "Bun",
      "Kaak Sesame",
      "Ka3ke",
      "PISTON WHITE 23CM",
      "CIABATA OLIVE",
      "CIA WHITE",
      "Toast Bread",
      "Garlic Bread",
    ])
      expect(plan(todo(dish(name, "BAGUETTES")), loaf), name).toBe("none");
    for (const name of ["PLAIN SOUR DOUGH", "PAIN RUGBY BLANC", "Bread"])
      expect((plan(todo(dish(name, "BAGUETTES")), loaf) as any).dish, name).toBe("bread");
    // "Breaded" is not bread.
    expect(dishOf(dish("Breaded Shrimps", "Appetizers"))).toBe("shrimp");
  });

  it("a generic photo never stands in for a named specific dish", () => {
    expect(photo(dish("Chicken Caesar Wrap", "Wraps"))).toBe("wrap");
    expect(photo(dish("Chicken Ceasar Wrap", "Wraps"))).toBe("wrap");
    expect(photo(dish("Zinger wrap"))).toBe("wrap");
    expect(photo(dish("Tawouk wrap", "Wraps"))).toBe("wrap");
    // A sandwich is not its filling's skewer or plate; the shawarma photo is the sandwich itself.
    expect(dishOf(dish("Shish Taouk Sandwich"))).toBe("sandwich");
    expect(dishOf(dish("Kebab Sandwich", "Sandwiches", "ساندويش كباب"))).toBe("sandwich");
    expect(dishOf(dish("Falafel Sandwich"))).toBe("sandwich");
    expect(dishOf(dish("GRILLED STEAK", "DELI SANDWICHES"))).toBe("sandwich");
    expect(dishOf(dish("Grilled Chicken Sandwich", "Sandwiches & Wraps"))).toBe("sandwich");
    expect(dishOf(dish("Shawarma Sub", "Subs"))).toBe("sub");
    expect(dishOf(dish("Chicken Shawarma Sandwich"))).toBe("shawarma");
    // Named dishes with their own key and no photo of theirs: nothing, not the broader dish's photo.
    const staging = JSON.parse(readFileSync("scripts/demo/photo-picks.json", "utf8")) as Picks;
    for (const [name, section] of [
      ["Makanek (Lebanese Spiced Sausages)", "Menu"],
      ["Sujuk & Cheese Platter", "Grill Platters"],
      ["Chicken Liver", "Lebanese Mezza"],
      ["Lamb Chops Platter", "Grill Platters"],
      ["Kebbeh Nayyeh (Raw Minced Meat)", "Menu"],
      ["Shish Barak (40)", "Hot Appetizers"],
      ["Custard", "Desserts"],
      ["Mochi (4 pcs)", "Desserts"],
      ["Kashta 1 kg", "Special Cups"],
      ["Spicy Potatoes", "Hot Appetizers"],
      ["Lamb Testicles Plate", "Hot Appetizers"],
      ["Gnocchi Truffle", "Pasta"],
      ["Calzone", "Pizza"],
      ["Cheddar Jalapeno triangles", "Appetizers"],
      ["Makdous", "Lebanese Mezza"],
    ])
      expect(plan(todo(dish(name, section)), staging), name).toBe("none");
    // Toppings and add-ons are not burgers; a side served as an add-on keeps its own photo.
    expect(dishOf(dish("Fresh Tomatoes", "Burger Bun"))).toBe("none");
    expect(dishOf(dish("Beef Patty", "Add-ons"))).toBe("none");
    expect(dishOf(dish("Cheddar Slice", "Add-Ons"))).toBe("none");
    expect(dishOf(dish("Fries add-on", "Burger Bun"))).toBe("fries");
    expect(dishOf(dish("Crispy Tender Piece", "Extras"))).toBe("fried_chicken");
  });

  it("a plate or platter is not the hand-held dish; a single dish's photo serves its platter", () => {
    expect(dishOf(dish("Beef Shawarma Platter"))).toBe("shawarma_plate");
    expect(dishOf(dish("Shawarma Arabic Box"))).toBe("shawarma_plate");
    expect(dishOf(dish("", "Shawarma", "صحن رز مع شاورما دجاج"))).toBe("smoked_rice");
    expect(dishOf(dish("", "PLATES / صحون", "صحن برغر لحم"))).toBe("burger_plate");
    expect(photo(dish("Tawook Platter", "Grill Platters", "صحن طاووق"))).toBe("shish_taouk");
    expect(photo(dish("Falafel Plate (10 Pcs)"))).toBe("falafel");
    expect(photo(dish("Chicken Wings Platter", "Grill Platters", "صحن جوانح مشوية"))).toBe("wings");
  });

  it("a sized or branded pack never gets a generic glass or plate; shelves show only their packshot", () => {
    for (const name of [
      "Pepsi 1.25 L",
      "Pepsi Can (330ml)",
      "Coca Cola 6-pack",
      "Sparkling Water Can 330ML",
      "Iced Tea Peach 335ML",
      "Mr. Juicy Apple 180ML",
      "Perrier",
      "Lipton ice tea peach",
      "Bottle Orange Juice",
    ])
      expect(photo(dish(name, "Soft Drinks")), name).toBe("none");
    for (const [name, section] of [
      ["Sohat Natural Spring Water (1.5L x 6 Pack)", "Water & Beverages"],
      ["Picon Cheese Triangles (8 Portions)", "Dairy & Eggs"],
      ["Barilla Italian Penne Rigate (500g)", "Pantry & Staples"],
      ["Café Najjar Turkish Coffee with Cardamom (200g)", "Coffee & Tea"],
      ["Afia Pure Corn Oil (1.5 Liters)", "Pantry & Staples"],
    ])
      expect(photo(shelf(name, section)), name).toBe("none");
    // A served drink keeps its photo; eggs are shown as they are sold.
    expect(photo(dish("Water", "Beverages"))).toBe("water");
    expect(photo(dish("Ice Tea", "Beverages"))).toBe("iced_tea");
    expect(photo(dish("Fresh Orange Juice / Lemonade", "Drinks"))).toBe("orange_juice");
    expect(photo(shelf("Fresh Farm Table Eggs (Carton of 30)", "Dairy & Eggs"))).toBe("eggs");
  });

  it("the description never decides and the shop's type is no guess", () => {
    expect(
      dishOf({
        ...dish("SALMON CREAM CHEESE SAND.", "DELI SANDWICHES"),
        description: "lemon juice",
      }),
    ).toBe("sandwich");
    expect(
      dishOf({ ...dish("Honey Smoked", "Burgers"), description: "served on toasted bun" }),
    ).toBe("burger");
    expect(dishOf(dish("Chicken B.B.Q", "Burgers"))).toBe("chicken_burger");
    expect(dishOf(dish("Golden BB Burger", "Chicken Burgers"))).toBe("chicken_burger");
    expect(dishOf({ name_en: "Mix", section_en: "Menu", business_type: "fast_food" })).not.toBe(
      "burger",
    );
    expect(photo(dish("Combo large.", "Antipasti"))).toBe("none");
  });

  it("a section that names a family decides inside it", () => {
    expect(dishOf(dish("- Crispy Salmon", "Uramaki Crispy (4 Pieces)"))).toBe("sushi");
    expect(dishOf(dish("- Red Belt", "Uramaki Special Wraps (4 Pieces)"))).toBe("sushi");
    expect(dishOf(dish("- Salmon", "Sachimi (3 Pieces)"))).toBe("sashimi");
    expect(dishOf(dish("- Shrimp", "Nigiri (2 Pieces)"))).toBe("nigiri");
    expect(dishOf(dish("- Orange Tobiko", "Gunkan (1 Piece)"))).toBe("nigiri");
    expect(dishOf(dish("Crispy Crazy Salmon Roll (8 Pcs)"))).toBe("sushi");
    expect(dishOf(dish("KAFTA", "FORON"))).toBe("manousheh");
    expect(dishOf(dish("Fresh Juice", "Saj & Breakfast"))).toBe("juice");
    expect(dishOf(dish("Rocca formaggi", "Pizza"))).toBe("pizza");
    expect(dishOf(dish("Chicken Fettuccine Alfredo", "Pizza & Pasta"))).toBe("pasta_alfredo");
    expect(dishOf(dish("Truffle", "Dips"))).toBe("dip");
    expect(dishOf(dish("Crispy Duo", "Crispy Burgers"))).toBe("chicken_burger");
  });

  it("a broader dish's photo stands in only where it shows the same dish", () => {
    const fallbacks = DISHES.filter((d) => d.parent)
      .map((d) => `${d.key}>${d.parent}`)
      .sort();
    expect(fallbacks).toEqual([
      "brownie>dessert",
      "cheeseburger>burger",
      "frappe>iced_latte",
      "kafta>grill",
      "lemonade>juice",
      "mixed_grill>grill",
      "nigiri>sushi",
      "nuggets>fried_chicken",
      "orange_juice>juice",
      "pasta_alfredo>pasta",
      "pizza_margherita>pizza",
      "pizza_pepperoni>pizza",
    ]);
    expect(photoChain("makanek")).toEqual(["makanek"]);
    expect(photoChain("shawarma_plate")).toEqual(["shawarma_plate"]);
  });

  it("a shop's own picture that cannot be used falls back only to a dish photo that fits, and an older one goes", () => {
    const staging = JSON.parse(readFileSync("scripts/demo/photo-picks.json", "utf8")) as Picks;
    const old = { source: "illustrative", origin_hash: "old", storage_path: "x" };
    expect(dishFallback(todo(dish("- Grilled Salmon", "Main Course"), old), staging)).toBe("none");
    const fb = dishFallback(todo(dish("- Salmon", "Sachimi (3 Pieces)"), old), staging) as any;
    expect(fb.dish).toBe("sashimi");
    expect(
      dishFallback(
        todo(dish("- Salmon", "Sachimi (3 Pieces)"), { ...old, origin_hash: fb.hash }),
        staging,
      ),
    ).toBeNull();
  });

  it("a dropped photo never stays as a shop's cover", () => {
    const items = [
      shelf("Fresh Shouf Markouk Saj Bread (Large Pack)", "Bakery & Bread"),
      shelf("Lebanese White Pita Bread (Large Bag)", "Bakery & Bread"),
      shelf("Chtaura Dairy Halloumi Cheese (250g)", "Dairy & Eggs"),
    ];
    const staging = JSON.parse(readFileSync("scripts/demo/photo-picks.json", "utf8")) as Picks;
    expect(
      coverCandidates({ vendor: "Coop", dishes: items.map(photoDish), own: [] }, staging),
    ).toEqual([]);
  });

  it("a shop's own photo stays a cover candidate whatever the dish rules say; its own-photo cover is kept", () => {
    const staging = JSON.parse(readFileSync("scripts/demo/photo-picks.json", "utf8")) as Picks;
    const special: ItemText = {
      name_en: "Fred's Special",
      section_en: "Mains",
      business_type: "restaurant",
    };
    expect(photoDish(special)).toBe("none");
    expect(ownPhotoDish(special)).toBe("other");
    // Only what is no food or no dish of its own is left out.
    expect(ownPhotoDish({ name_en: "Shisha Grape", section_en: "Argile" })).toBe("none");
    expect(ownPhotoDish(dish("Fresh Tomatoes", "Burger Bun"))).toBe("none");
    expect(ownPhotoDish(dish("Markouk Saj Bread", "Bakery"))).toBe("saj_bread");
    const own = { url: "https://x/own.jpg", original: "https://x/own.jpg", dish: "other" };
    const shop = { vendor: "Fred's", dishes: ["none", "burger"], own: [own] };
    const c = coverCandidates(shop, staging);
    expect(c[0]).toMatchObject({ source: "merchant_site", url: "https://x/own.jpg" });
    // A named own photo ranks before the unnamed one.
    const named = { url: "https://x/burger.jpg", original: "https://x/burger.jpg", dish: "burger" };
    expect(coverCandidates({ ...shop, own: [own, named] }, staging)[0].url).toBe(
      "https://x/burger.jpg",
    );
    // The current own-photo cover stays, gives way only to another own photo, never to a dish photo.
    expect(coverTries({ source: "merchant_site", origin_hash: coverHash(own) }, c)).toEqual([]);
    const gone = { source: "merchant_site", origin_hash: "an own photo no longer on the menu" };
    expect(coverTries(gone, c)?.map((x) => x.source)).toEqual(["merchant_site"]);
    expect(coverTries({ source: "merchant", origin_hash: null }, c)).toEqual([]);
    // A dish-photo cover is upgraded to the shop's own photo, and goes when nothing is left.
    const dishCover = { source: "illustrative", origin_hash: coverHash(c[c.length - 1]) };
    expect(coverTries(dishCover, c)?.[0].source).toBe("merchant_site");
    expect(coverTries(dishCover, [])).toBeNull();
    expect(coverTries(undefined, [])).toEqual([]);
  });

  it("exact item names are matched on the name only, never on a section", () => {
    expect(dishOf(dish("The Boss", "Signature"))).toBe("none");
    expect(dishOf(dish("The Boss", "Mix"))).toBe("none");
    expect(dishOf(dish("The Boss", "BBQ"))).toBe("none");
    expect(dishOf(dish("Mix", "Menu"))).toBe("dip");
    expect(dishOf(dish("Signature", "Dips"))).toBe("dip");
    expect(dishOf(dish("- Cucumber", "Hosomaki (4 Pieces)"))).toBe("sushi");
    expect(dishOf(dish("MANGO", "ICED YOGURT"))).toBe("frozen_yogurt");
    expect(dishOf(dish("Jalapeños", "Side Cups"))).toBe("pickles");
  });

  it("a photo goes for a dish-fit reason only when it is a dish photo", () => {
    const none: Picks = { dishes: {}, packshots: {} };
    const ph = (source: string) => ({ source, origin_hash: "h", storage_path: "x" });
    expect(clearsOnNone(todo(dish("Lamb Chops Platter"), ph("illustrative")), none)).toBe(true);
    expect(clearsOnNone(todo(dish("Lamb Chops Platter"), ph("merchant")), none)).toBe(false);
    // The shop's own picture stays while its menu still has it, and goes once the menu no longer does.
    const withOwn = {
      ...todo(dish("Lamb Chops Platter"), ph("merchant_site")),
      image_url: "https://x/own.jpg",
    };
    expect(clearsOnNone(withOwn, none)).toBe(false);
    expect(clearsOnNone({ ...withOwn, image_url: null }, none)).toBe(true);
    // A packshot stays while its pick serves the item, and goes once the pick is removed.
    const pack = todo(shelf("Pepsi Can (330ml)", "Water & Beverages"), ph("packshot"));
    const pepsi: Picks = {
      dishes: {},
      packshots: {
        "Pepsi Can (330ml)": {
          url: "https://images.openfoodfacts.org/p.jpg",
          license: "CC BY-SA 3.0",
          credit: "OFF",
          source_url: null,
          brand: "Pepsi",
        },
      },
    };
    expect(clearsOnNone(pack, pepsi)).toBe(false);
    expect(clearsOnNone(pack, none)).toBe(true);
  });

  it("the pipeline loads under node's type stripping, as CI runs it (no parameter properties)", () => {
    const out = execFileSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--no-warnings",
        "--input-type=module",
        "-e",
        "const m = await import('./scripts/demo/demo-photos.ts'); console.log(typeof m.plan);",
      ],
      { encoding: "utf8" },
    );
    expect(out.trim()).toBe("function");
  });
});
