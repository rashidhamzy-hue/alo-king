import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dishNutrition, librarySql, loadDishes, loadIngredients, mayContain } from "./library";

// The dish library (DECISIONS §32.3) lives in supabase/seed/nutrition/ and is loaded by the smart-menu
// migration; this keeps the two identical and the data sane.
const MIGRATION = "supabase/migrations/20261011150100_smart_menu_nutrition.sql";

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
});
