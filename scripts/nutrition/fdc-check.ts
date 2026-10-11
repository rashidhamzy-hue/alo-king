// Re-checks the ingredient table (supabase/seed/nutrition/ingredients.csv) against USDA FoodData Central
// (DECISIONS §32.3). Runs on a GitHub runner (nutrition-library.yml), because the build sessions cannot reach
// api.nal.usda.gov. For every `usda_sr_legacy` row it searches SR Legacy with the row's `fdc_query`, takes
// the best match and prints a table of values that differ by more than 10% (and 2 units). It changes nothing:
// a session reviews the report and edits the CSV, and the library test keeps the migration in step.
// Usage: FDC_API_KEY=... node --experimental-strip-types scripts/nutrition/fdc-check.ts
import { loadIngredients, NUTRIENTS, type Nutrient } from "./library.ts";

const KEY = process.env.FDC_API_KEY || "DEMO_KEY";
// FDC nutrient numbers for our columns.
const NUMBERS: Record<Nutrient, string> = {
  kcal: "208",
  protein_g: "203",
  carbs_g: "205",
  fat_g: "204",
  sugar_g: "269",
  fibre_g: "291",
  sat_fat_g: "606",
  sodium_mg: "307",
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const rows: string[] = ["| ingredient | FDC match | field | ours | FDC |", "|---|---|---|---|---|"];
let checked = 0;
let failed = 0;
for (const i of loadIngredients().filter((x) => x.source === "usda_sr_legacy")) {
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(KEY)}&dataType=SR%20Legacy&pageSize=1&query=${encodeURIComponent(i.fdc_query)}`;
  const res = await fetch(url);
  if (!res.ok) {
    failed++;
    rows.push(`| ${i.id} | HTTP ${res.status} | | | |`);
    if (res.status === 429) break;
    continue;
  }
  const food = (await res.json())?.foods?.[0];
  checked++;
  if (!food) {
    rows.push(`| ${i.id} | no match | | | |`);
    continue;
  }
  const value = (n: string) =>
    food.foodNutrients?.find((x: { nutrientNumber?: string }) => x.nutrientNumber === n)?.value;
  for (const f of NUTRIENTS) {
    const theirs = Number(value(NUMBERS[f]));
    if (!Number.isFinite(theirs)) continue;
    const ours = i[f];
    if (Math.abs(theirs - ours) > Math.max(2, 0.1 * Math.max(theirs, ours)))
      rows.push(
        `| ${i.id} | ${food.fdcId} ${String(food.description).slice(0, 50)} | ${f} | ${ours} | ${theirs} |`,
      );
  }
  if (KEY === "DEMO_KEY") await sleep(2500);
}
console.log(
  [
    "## Ingredient table vs USDA FoodData Central",
    "",
    `Checked ${checked} SR Legacy rows${failed ? `, ${failed} requests failed` : ""}. Rows below differ by more than 10%.`,
    "",
    ...rows,
  ].join("\n"),
);
