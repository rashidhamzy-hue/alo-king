// The Lebanese dish library (DECISIONS §32.3): ~200 standard recipes over a USDA FoodData Central
// ingredient table, kept in the repo (supabase/seed/nutrition/). This module reads both files, checks them,
// computes per-portion nutrition the same way the database does (for tests), and renders the SQL block the
// migration carries. Usage: node --experimental-strip-types scripts/nutrition/library.ts > /tmp/library.sql
import { readFileSync } from "node:fs";

export const NUTRIENTS = [
  "kcal",
  "protein_g",
  "carbs_g",
  "fat_g",
  "sugar_g",
  "fibre_g",
  "sat_fat_g",
  "sodium_mg",
] as const;
export type Nutrient = (typeof NUTRIENTS)[number];
export type Ingredient = {
  id: string;
  name_en: string;
  fdc_query: string;
  source: "usda_sr_legacy" | "typical_label";
} & Record<Nutrient, number>;
export type Dish = {
  id: string;
  ar: string;
  en: string;
  fr: string;
  aka: string[];
  cat: string;
  unit?: "piece";
  g: { S: number; M: number; L: number };
  r: Record<string, number>;
  salt?: number;
};

// "May contain" suggestions only (§32.3: allergens are merchant-declared; these never set one).
export const INGREDIENT_ALLERGENS: Record<string, string[]> = {
  pita_bread: ["gluten"],
  bun: ["gluten"],
  baguette: ["gluten"],
  flour_white: ["gluten"],
  semolina: ["gluten"],
  phyllo: ["gluten"],
  pasta_dry: ["gluten"],
  pasta_cooked: ["gluten"],
  moghrabieh_cooked: ["gluten"],
  bulgur_dry: ["gluten"],
  bulgur_cooked: ["gluten"],
  freekeh_cooked: ["gluten"],
  croissant_plain: ["gluten", "dairy", "eggs"],
  kishk_powder: ["gluten", "dairy"],
  cheese_mozzarella: ["dairy"],
  cheese_feta: ["dairy"],
  cheese_cheddar: ["dairy"],
  cheese_halloumi: ["dairy"],
  labneh: ["dairy"],
  yogurt_whole: ["dairy"],
  milk_whole: ["dairy"],
  cream_heavy: ["dairy"],
  ashta: ["dairy"],
  butter: ["dairy"],
  ghee: ["dairy"],
  ice_cream: ["dairy", "eggs"],
  egg_cooked: ["eggs"],
  mayonnaise: ["eggs", "mustard"],
  tahini: ["sesame"],
  sesame_seeds: ["sesame"],
  zaatar_mix: ["sesame"],
  pine_nuts: ["nuts"],
  walnuts: ["nuts"],
  pistachios: ["nuts"],
  almonds: ["nuts"],
  chocolate_spread: ["nuts", "dairy", "soy"],
  fish_white_cooked: ["fish"],
  tuna_oil_drained: ["fish"],
  shrimp_cooked: ["shellfish"],
  pickles: ["sulphites"],
  pickled_turnip: ["sulphites"],
  sausage_beef_cooked: ["sulphites"],
};

// Paths are relative to the repository root (CI, vitest and the CLI all run there).
const dir = "supabase/seed/nutrition/";

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.trim().split("\n")) {
    const cells: string[] = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ",") {
        cells.push(cur);
        cur = "";
      } else cur += c;
    }
    cells.push(cur);
    rows.push(cells);
  }
  return rows;
}

export function loadIngredients(): Ingredient[] {
  const [head, ...rows] = parseCsv(readFileSync(`${dir}ingredients.csv`, "utf8"));
  return rows.map((r) => {
    const o: Record<string, string | number> = {};
    head.forEach(
      (h, i) => (o[h] = (NUTRIENTS as readonly string[]).includes(h) ? Number(r[i]) : r[i]),
    );
    return o as unknown as Ingredient;
  });
}

export function loadDishes(): Dish[] {
  return readFileSync(`${dir}dishes.jsonl`, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as Dish);
}

/** Per-portion nutrition of a dish at size S/M/L: recipe grams are for M and scale linearly. */
export function dishNutrition(
  d: Dish,
  ing: Map<string, Ingredient>,
  size: "S" | "M" | "L" = "M",
): Record<Nutrient, number> {
  const k = d.g[size] / d.g.M;
  const out = Object.fromEntries(NUTRIENTS.map((n) => [n, 0])) as Record<Nutrient, number>;
  for (const [id, grams] of Object.entries(d.r)) {
    const i = ing.get(id);
    if (!i) throw new Error(`${d.id}: unknown ingredient ${id}`);
    for (const n of NUTRIENTS) out[n] += (grams * k * i[n]) / 100;
  }
  out.sodium_mg += (d.salt ?? 0) * k * 387.58; // table salt is 38.758% sodium
  for (const n of NUTRIENTS) out[n] = Math.round(out[n] * 10) / 10;
  return out;
}

export function mayContain(d: Dish): string[] {
  return [...new Set(Object.keys(d.r).flatMap((id) => INGREDIENT_ALLERGENS[id] ?? []))].sort();
}

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const arr = (a: string[]) => `array[${a.map(lit).join(", ")}]::text[]`;

/** The SQL block between the BEGIN/END LIBRARY markers of the nutrition migration. */
export function librarySql(): string {
  const ingredients = loadIngredients();
  const dishes = loadDishes();
  const lines: string[] = [];
  lines.push(
    "insert into public.nutrition_ingredients (id, name_en, fdc_query, source, allergens, kcal, protein_g, carbs_g, fat_g, sugar_g, fibre_g, sat_fat_g, sodium_mg) values",
  );
  lines.push(
    ingredients
      .map(
        (i) =>
          `  (${lit(i.id)}, ${lit(i.name_en)}, ${lit(i.fdc_query)}, ${lit(i.source)}, ${arr(INGREDIENT_ALLERGENS[i.id] ?? [])}::public.allergen[], ${NUTRIENTS.map((n) => i[n]).join(", ")})`,
      )
      .join(",\n") + ";",
  );
  lines.push(
    "insert into public.dish_library (id, name_ar, name_en, name_fr, aliases, category, unit, portion_g, recipe, salt_g) values",
  );
  lines.push(
    dishes
      .map(
        (d) =>
          `  (${lit(d.id)}, ${lit(d.ar)}, ${lit(d.en)}, ${lit(d.fr)}, ${arr(d.aka)}, ${lit(d.cat)}, ${lit(d.unit ?? "portion")}, ${lit(JSON.stringify(d.g))}, ${lit(JSON.stringify(d.r))}, ${d.salt ?? 0})`,
      )
      .join(",\n") + ";",
  );
  return lines.join("\n");
}

if (process.argv[1]?.endsWith("library.ts")) console.log(librarySql());
