import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  dishNutrition,
  FOOD_GROUPS,
  INGREDIENT_ALLERGENS,
  librarySql,
  loadDishes,
  loadIngredients,
  loadTaxonomy,
  mayContain,
} from "./library";

// The dish library (DECISIONS §32.3, §38.2 item 6) lives in supabase/seed/nutrition/ and is carried by the latest
// migration with a BEGIN LIBRARY block (an upsert); this keeps the two identical and the data sane.
const MIGRATION = `supabase/migrations/${readdirSync("supabase/migrations")
  .filter(
    (f) =>
      f.endsWith(".sql") &&
      readFileSync(`supabase/migrations/${f}`, "utf8").includes("-- BEGIN LIBRARY"),
  )
  .sort()
  .at(-1)}`;

describe("Lebanese dish library", () => {
  const ingredients = loadIngredients();
  const dishes = loadDishes();
  const ing = new Map(ingredients.map((i) => [i.id, i]));

  it("has about 200 dishes with names in three languages and unique ids", () => {
    expect(dishes.length).toBeGreaterThanOrEqual(200);
    expect(new Set(dishes.map((d) => d.id)).size).toBe(dishes.length);
    for (const d of dishes) {
      expect(d.ar && d.en && d.fr, d.id).toBeTruthy();
      expect(/[؀-ۿ]/.test(d.ar), d.id).toBe(true);
    }
  });
  it("every recipe uses known ingredients and adds up to its medium portion (±15%)", () => {
    for (const d of dishes) {
      for (const k of Object.keys(d.r)) expect(ing.has(k), `${d.id}: ${k}`).toBe(true);
      const total = Object.values(d.r).reduce((a, b) => a + b, 0);
      expect(Math.abs(total - d.g.M) / d.g.M, d.id).toBeLessThanOrEqual(0.15);
      expect(d.g.S < d.g.M && d.g.M < d.g.L, d.id).toBe(true);
    }
  });
  it("ingredient values are physically possible per 100 g", () => {
    for (const i of ingredients) {
      const macroGrams = i.protein_g + i.carbs_g + i.fat_g;
      expect(macroGrams, i.id).toBeLessThanOrEqual(101);
      // Atwater check: kcal close to 4P + 4C + 9F (fibre and rounding allowed for).
      const atwater = 4 * i.protein_g + 4 * i.carbs_g + 9 * i.fat_g;
      expect(Math.abs(atwater - i.kcal), i.id).toBeLessThanOrEqual(Math.max(25, 0.15 * i.kcal));
      expect(i.sugar_g <= i.carbs_g + 0.5 && i.sat_fat_g <= i.fat_g + 0.5, i.id).toBe(true);
    }
  });
  it("computes plausible portions", () => {
    const by = (id: string) =>
      dishNutrition(
        dishes.find((d) => d.id === id)!,
        ing,
      );
    expect(by("chicken_shawarma_sandwich").kcal).toBeGreaterThan(450);
    expect(by("chicken_shawarma_sandwich").kcal).toBeLessThan(800);
    expect(by("tabbouleh").protein_g).toBeLessThan(12);
    expect(by("tawouk_plate").protein_g).toBeGreaterThanOrEqual(25);
    expect(by("espresso").kcal).toBeLessThan(10);
  });
  it("may-contain suggestions come from ingredients (hummus → sesame; tabbouleh → gluten)", () => {
    expect(mayContain(dishes.find((d) => d.id === "hummus")!)).toContain("sesame");
    expect(mayContain(dishes.find((d) => d.id === "tabbouleh")!)).toContain("gluten");
  });
  it("the migration carries exactly the generated library", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    const a = sql.indexOf("-- BEGIN LIBRARY");
    const b = sql.indexOf("-- END LIBRARY");
    const block = sql.slice(sql.indexOf("\n", a) + 1, b).trim();
    expect(block).toBe(librarySql().trim());
  });

  it("every ingredient has a Levantine taxonomy row: group, and animal and cut for meat, fish and seafood", () => {
    const tax = loadTaxonomy();
    const ids = new Set(ingredients.map((i) => i.id));
    expect([...tax.keys()].sort()).toEqual([...ids].sort());
    for (const t of tax.values()) {
      expect(FOOD_GROUPS, t.id).toContain(t.food_group);
      if (
        ["red_meat", "poultry", "offal", "processed_meat", "fish", "seafood"].includes(t.food_group)
      ) {
        expect(t.animal, t.id).not.toBeNull();
        expect(t.cut, t.id).not.toBeNull();
        expect(t.animal_product, t.id).toBe(true);
      }
      if (t.cut) expect(t.animal, t.id).not.toBeNull();
      if (["dairy", "egg"].includes(t.food_group)) expect(t.animal_product, t.id).toBe(true);
    }
    expect(
      [...tax.values()]
        .filter((t) => t.animal === "lamb")
        .map((t) => t.cut)
        .sort(),
    ).toEqual(["lean_raw", "leg", "liver", "mixed_cuts", "shoulder"]);
    expect([...tax.values()].some((t) => t.pork || t.alcohol)).toBe(false);
  });

  it("covers the EU-14 allergens through its ingredients", () => {
    const covered = new Set(Object.values(INGREDIENT_ALLERGENS).flat());
    for (const a of [
      "gluten",
      "shellfish",
      "eggs",
      "fish",
      "peanuts",
      "soy",
      "dairy",
      "nuts",
      "celery",
      "mustard",
      "sesame",
      "sulphites",
      "lupin",
      "molluscs",
    ])
      expect(covered.has(a), a).toBe(true);
    const termos = loadDishes().find((d) => d.id === "termos")!;
    const calamari = loadDishes().find((d) => d.id === "fried_calamari")!;
    expect(mayContain(termos)).toContain("lupin");
    expect(mayContain(calamari)).toContain("molluscs");
    expect(mayContain(calamari)).toContain("gluten"); // flour-dusted, as the USDA entry
  });

  it("the library migration adds the two EU-14 allergens and the label table", () => {
    const enums = readFileSync(
      "supabase/migrations/20261014090200_allergens_eu14_enums.sql",
      "utf8",
    );
    expect(enums).toMatch(/add value if not exists 'lupin'/);
    expect(enums).toMatch(/add value if not exists 'molluscs'/);
    expect(
      (
        readFileSync(MIGRATION, "utf8").match(
          /^ {2}\('[a-z]+', '[^']+', '[^']+', '[^']+', \d+\)/gm,
        ) ?? []
      ).length,
    ).toBe(14);
  });
});
