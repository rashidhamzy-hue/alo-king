import { describe, expect, it } from "vitest";
import { catalogDescription, catalogTitle, fit, itemName, sizeOnce, titleCase } from "./item-text";

describe("item titles (DECISIONS §39.15.2, spec §2 item 2)", () => {
  it("Title Case, never ALL CAPS, small words lower, acronyms and the merchant's own capitals kept", () => {
    expect(titleCase("HOT DOG")).toBe("Hot Dog");
    expect(titleCase("chicken BURGER with fries")).toBe("Chicken Burger with Fries");
    expect(titleCase("BBQ WINGS")).toBe("BBQ Wings");
    expect(titleCase("McFlurry OREO")).toBe("McFlurry Oreo");
    expect(titleCase("SAJ-BREAD ZAATAR w CHEESE")).toBe("Saj-Bread Zaatar w Cheese");
    expect(titleCase("manoushe kishk")).toBe("Manoushe Kishk");
    expect(titleCase("فلافل")).toBe("فلافل");
  });

  it("real menu names (reviewed on 16 October): units, apostrophes and brackets", () => {
    expect(titleCase("PEPSI 330ML")).toBe("Pepsi 330 ml");
    expect(titleCase("CIABATA WHITE 270G")).toBe("Ciabata White 270 g");
    expect(titleCase("RICE 1KG")).toBe("Rice 1 kg");
    expect(titleCase("JO'S Cheesy Chicken")).toBe("Jo's Cheesy Chicken");
    expect(titleCase("J.O'S HAMBURGER")).toBe("J.O's Hamburger");
    expect(titleCase("MAN'OUSHE ZAATAR")).toBe("Man'oushe Zaatar");
    expect(titleCase("KA'AK")).toBe("Ka'ak");
    expect(titleCase("PAIN D'OR")).toBe("Pain D'Or");
    expect(titleCase("FROZEN YOGURT(with 2 toppings)")).toBe("Frozen Yogurt (with 2 Toppings)");
  });

  it("round 2: a unit after a size in brackets, words starting with a digit, a small last word", () => {
    expect(titleCase("ksara Red Wine (250ml)")).toBe("Ksara Red Wine (250 ml)");
    expect(titleCase("Pepsi 1.25L (1250 ml)")).toBe("Pepsi 1.25 L (1250 ml)");
    expect(titleCase("DIET 7UP")).toBe("Diet 7UP");
    expect(titleCase("PIZZA 23CM")).toBe("Pizza 23CM");
    expect(titleCase("COMBO A")).toBe("Combo A");
  });

  it("a size once, written one way", () => {
    expect(sizeOnce("Pepsi 330ML (330 ml)")).toBe("Pepsi 330 ml");
    expect(titleCase("SOFT DRINK 1.5L")).toBe("Soft Drink 1.5 L");
    expect(sizeOnce("Water 500ml")).toBe("Water 500 ml");
  });

  it("the item part in one language: the shop's Latin name, else English, else Arabic", () => {
    expect(itemName({ name_en: "SUJUK & CHEESE PLATTER", name_ar: "صحن سجق جبنة" })).toBe(
      "Sujuk & Cheese Platter",
    );
    expect(itemName({ name_fr: "Croissant au THYM", name_ar: "كرواسان زعتر" })).toBe(
      "Croissant au Thym",
    );
    expect(itemName({ name_ar: "كبة نية" })).toBe("كبة نية");
  });

  it('"<Item> · <Shop>", within 150 characters, never cutting the shop', () => {
    expect(catalogTitle({ name_en: "CHICKEN POPCORN", shop_en: "Safa Chicken" })).toBe(
      "Chicken Popcorn · Safa Chicken",
    );
    const long = catalogTitle({ name_en: "x".repeat(300), shop_en: "Deli Dough" });
    expect(Array.from(long).length).toBeLessThanOrEqual(150);
    expect(long.endsWith("… · Deli Dough")).toBe(true);
  });
});

describe("item descriptions (spec §2 item 3)", () => {
  const base = {
    name_en: "Classic Burger",
    name_ar: "برغر كلاسيك",
    shop_en: "SEVEN Burgers & Beyond",
    village_en: "Boqaata",
  };

  it("shop · village, the Arabic name, what it is, estimated nutrition, declared allergens, extras — in that order", () => {
    expect(
      catalogDescription({
        ...base,
        menu_text: "Beef patty, cheddar, pickles. Call 70 123 456 or see https://x.example",
        kcal: 523,
        protein_g: 31.6,
        allergens_declared: ["gluten", "dairy"],
        has_options: true,
      }),
    ).toBe(
      [
        "SEVEN Burgers & Beyond · Boqaata",
        "برغر كلاسيك",
        "Beef patty, cheddar, pickles. Call or see",
        "≈ 520 kcal · 32 g protein (estimated)",
        "Contains gluten, milk (declared by the shop)",
        "Extras chosen after you add it",
      ].join("\n"),
    );
  });

  it('no menu text: "Usually made with …" from the dish library; no allergens unless declared; never a credit', () => {
    const d = catalogDescription({
      ...base,
      usually: ["beef", "bun", "tomato", "lettuce", "pickles", "ketchup"],
    });
    expect(d).toContain("Usually made with beef, bun, tomato, lettuce and pickles.");
    expect(d).not.toMatch(/Contains|safe|📷|CC BY|Openverse/);
  });

  it("an illustrative photo is labelled, a weighed item says so, and the whole fits 500 characters", () => {
    const d = catalogDescription({
      ...base,
      menu_text: "y".repeat(900),
      illustrative: true,
      weight_kg: 0.5,
    });
    expect(d.length).toBeLessThanOrEqual(500);
    expect(d).toMatch(/≈ 0.5 kg, final price by weight\nPhoto for illustration$/);
  });
});

describe("lengths are counted as Meta counts them (UTF-16), never cutting a line or an emoji", () => {
  it("a 600-character menu text full of emoji keeps the allergen, extras and illustration lines whole", () => {
    const d = catalogDescription({
      name_en: "Mixed Grill",
      shop_en: "Nayeh w Meshwiyeh",
      village_en: "Baakline",
      menu_text: "🔥🥩 grilled ".repeat(60),
      allergens_declared: ["gluten", "dairy", "sesame", "eggs"],
      has_options: true,
      illustrative: true,
    });
    expect(d.length).toBeLessThanOrEqual(500);
    expect(d).toContain("Contains gluten, milk, sesame, eggs (declared by the shop)");
    expect(d).toContain("Extras chosen after you add it");
    expect(d.endsWith("Photo for illustration")).toBe(true);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(d)).toBe(false);
  });

  it("titles fit 150 units even with emoji, and fit never splits a character", () => {
    const t = catalogTitle({ name_en: "🍔".repeat(100), shop_en: "Bun Bros" });
    expect(t.length).toBeLessThanOrEqual(150);
    expect(t.endsWith("… · Bun Bros")).toBe(true);
    expect(fit("a🍔b", 2)).toBe("a");
    expect(fit("short", 10)).toBe("short");
  });

  it("an Arabic-only item takes the shop's Arabic name: one script per title", () => {
    expect(catalogTitle({ name_ar: "كبة نية", shop_en: "Deli Dough", shop_ar: "ديلي دو" })).toBe(
      "كبة نية · ديلي دو",
    );
    expect(catalogTitle({ name_ar: "كبة نية", shop_en: "Deli Dough" })).toBe(
      "كبة نية · Deli Dough",
    );
  });

  it("while an item has no page, a CC BY photo's credit stays in the description; with a page it goes", () => {
    const t = {
      name_en: "Fattoush",
      shop_en: "Tarabish",
      photo_credit: "insatiablemunch · CC BY 2.0",
    };
    expect(catalogDescription(t)).toContain("📷 insatiablemunch · CC BY 2.0");
    expect(catalogDescription({ ...t, link: "https://alo-king.vercel.app/en/i/x" })).not.toContain(
      "📷",
    );
  });

  it("round 2: graphemes stay whole; an Arabic shop takes the Arabic village; too many fixed lines drop the optional ones", () => {
    expect(fit("ab👨‍👩‍👧cd", 5)).toBe("ab");
    expect(fit("🇱🇧🇱🇧", 5)).toBe("🇱🇧"); // a flag is two code points and never split
    expect(
      catalogDescription({
        name_ar: "كبة",
        shop_ar: "مطعم الضيعة",
        village_en: "Baakline",
        village_ar: "بعقلين",
      }).split("\n")[0],
    ).toBe("مطعم الضيعة · بعقلين");
    const d = catalogDescription({
      name_en: "Platter",
      name_ar: "ص".repeat(150),
      shop_en: "S".repeat(140),
      village_en: "Baakline",
      kcal: 900,
      protein_g: 40,
      has_options: true,
      allergens_declared: [
        "gluten",
        "nuts",
        "dairy",
        "eggs",
        "sesame",
        "fish",
        "shellfish",
        "soy",
        "peanuts",
        "mustard",
        "celery",
        "sulphites",
        "lupin",
        "molluscs",
      ],
      illustrative: true,
      photo_credit: "Jane Doe via Openverse · CC BY 2.0",
    });
    expect(d.length).toBeLessThanOrEqual(500);
    expect(d).toContain("(declared by the shop)");
    expect(d).toContain("Photo for illustration");
    expect(d.endsWith("📷 Jane Doe via Openverse · CC BY 2.0")).toBe(true);
    expect(d).not.toContain("kcal");
  });
});
