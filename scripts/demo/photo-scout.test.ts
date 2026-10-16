import { describe, expect, it } from "vitest";
import { DISHES, dishOf, isShelf, photoChain } from "./dishes";
import { fullOffImage, openverseCandidates, packshotScore, words } from "./photo-scout";

describe("dish of an item (session 5e)", () => {
  it("reads the name first, specific dishes before general ones", () => {
    expect(dishOf({ name_en: "Crispy Chicken Giant Burger", business_type: "restaurant" })).toBe(
      "chicken_burger",
    );
    expect(dishOf({ name_en: "Beef Shawarma Platter", business_type: "restaurant" })).toBe(
      "shawarma_plate",
    );
    expect(dishOf({ name_en: "ICED SPANISH LATTE", section_en: "ICED LATTE" })).toBe("iced_latte");
    expect(dishOf({ name_ar: "ساندويش شاورما دجاج صغير", section_en: "Shawarma" })).toBe(
      "shawarma",
    );
    expect(dishOf({ name_en: "Kebbeh Nayyeh (Raw Minced Meat)" })).toBe("kibbeh_nayyeh");
    expect(dishOf({ name_en: "MATCHA STRAWBERRY", section_en: "FRAPPE" })).toBe("frappe");
  });

  it("falls back to the section, then the shop's type", () => {
    expect(dishOf({ name_en: "- Salmon Skin", section_en: "Hosomaki (4 Pieces)" })).toBe("sushi");
    expect(dishOf({ name_en: "Honey Mustard", section_en: "Dips" })).toBe("dip");
    expect(
      dishOf({ name_en: "Normal", section_en: "Merry Cream Cornet", business_type: "ice_cream" }),
    ).toBe("ice_cream");
  });

  it("shelf items use shelf dishes only, and nothing for shisha or a service", () => {
    expect(isShelf({ name_en: "Pepsi Can (330ml)", business_type: "grocery_supermarket" })).toBe(
      true,
    );
    expect(dishOf({ name_en: "DIET SALAMI 100% BEEF", section_en: "CHARCUTERIE" })).toBe(
      "cold_cuts",
    );
    expect(
      dishOf({
        name_en: "Brown Wheat Diet Pita Bread",
        section_en: "Bakery & Bread",
        business_type: "grocery_supermarket",
      }),
    ).toBe("bread");
    expect(dishOf({ name_en: "Extra Bowl", section_en: "Argile" })).toBe("none");
  });

  it("every dish but `none` has a search, and every parent exists", () => {
    const keys = new Set(DISHES.map((d) => d.key));
    for (const d of DISHES) {
      if (d.key !== "none") expect(d.q.length, d.key).toBeGreaterThan(0);
      if (d.parent) expect(keys.has(d.parent), `${d.key} -> ${d.parent}`).toBe(true);
    }
    expect(photoChain("pizza_margherita")).toEqual(["pizza_margherita", "pizza"]);
  });
});

describe("candidates", () => {
  it("keeps only CC0, the public domain mark and CC BY photos of 800 px and more", () => {
    const c = openverseCandidates({
      results: [
        {
          id: "a",
          url: "https://x/a.jpg",
          license: "cc0",
          width: 1200,
          height: 900,
          source: "stocksnap",
        },
        { id: "b", url: "https://x/b.jpg", license: "by-sa", width: 1200, height: 900 },
        {
          id: "c",
          url: "https://x/c.jpg",
          license: "by",
          license_version: "2.0",
          width: 640,
          height: 480,
        },
        {
          id: "d",
          url: "https://x/d.jpg",
          license: "by",
          license_version: "2.0",
          width: 2000,
          height: 1500,
        },
      ],
    });
    expect(c.map((x) => [x.id, x.license])).toEqual([
      ["a", "CC0"],
      ["d", "CC BY 2.0"],
    ]);
  });

  it("scores a packshot by the item's words and its brand", () => {
    expect(words("Pepsi Can (330ml)")).toEqual(["pepsi", "can"]);
    expect(
      packshotScore("Lurpak Unsalted Butter (200g)", {
        product_name: "Unsalted butter",
        brands: "Lurpak",
      }),
    ).toBe(1);
    expect(
      packshotScore("Lurpak Unsalted Butter (200g)", {
        product_name: "Salted butter",
        brands: "President",
      }),
    ).toBeLessThan(0.5);
  });

  it("asks Open Food Facts for the full-size front image", () => {
    expect(
      fullOffImage("https://images.openfoodfacts.org/images/products/1/front_en.3.400.jpg"),
    ).toBe("https://images.openfoodfacts.org/images/products/1/front_en.3.full.jpg");
  });
});
