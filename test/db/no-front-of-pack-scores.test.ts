// Brief, food data rule 3 (S1 audit point 3, session F1): never store or show Nutri-Score, NOVA, eco-score or Open Food Facts'
// "high in" nutrient levels. They are judgements about food, and invariant 14 keeps every reply neutral and factual.
// This test fails if any script, package, app, template or migration names one of those fields, if the Open Food Facts request
// asks for one, or if the database has a column, constraint or function that holds one.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { openTestDb, type TestDb } from "./harness";

const root = fileURLToPath(new URL("../../", import.meta.url));
const BANNED: [string, RegExp][] = [
  ["Nutri-Score", /nutri[-_ ]?score|nutrition[-_]grades?/i],
  ["NOVA group", /\bnova(?:[-_ ]?groups?)?\b/i],
  ["eco-score", /eco[-_ ]?score|environmental[-_ ]?score|green[-_ ]?score/i],
  ["nutrient levels", /nutrient[-_ ]?levels?/i],
  ['"high in" levels', /\bhigh[-_ ]in\b|in[-_ ]high[-_ ]quantit/i],
];
const SCAN = ["scripts", "packages", "apps", "supabase", "templates", "evals", "prompts"];
const EXT = /\.(ts|tsx|mjs|cjs|js|sql|json|md|py|sh|ya?ml|html|txt)$/;

function* files(dir: string): Generator<string> {
  let names: string[];
  try { names = readdirSync(dir); } catch { return; }
  for (const n of names) {
    if (n === "node_modules" || n === ".wrangler" || n.startsWith(".")) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (EXT.test(n)) yield p;
  }
}

export function findBanned(text: string): string[] {
  return BANNED.filter(([, re]) => re.test(text)).map(([name]) => name);
}

describe("no Nutri-Score, NOVA, eco-score or 'high in' levels", () => {
  it("the patterns catch the Open Food Facts field names and leave ordinary words alone", () => {
    for (const f of ["nutriscore_grade", "nutrition_grades", "Nutri-Score", "nova_group", "NOVA", "ecoscore_grade", "environmental_score_data",
                     "nutrient_levels", "en:fat-in-high-quantity", "high in sugar"]) {
      expect(findBanned(f), f).not.toEqual([]);
    }
    for (const ok of ["innovation", "renovate", "nutriments", "nutrition_data_per", "allergens_tags", "ingredients_analysis_tags", "highlight"]) {
      expect(findBanned(ok), ok).toEqual([]);
    }
  });

  it("no script, package, app, template or migration names one", () => {
    const hits: string[] = [];
    for (const dir of SCAN) for (const f of files(join(root, dir))) {
      const text = readFileSync(f, "utf8");
      const found = findBanned(text);
      if (found.length) hits.push(`${f.slice(root.length)}: ${found.join(", ")}`);
    }
    expect(hits).toEqual([]);
  });

  it("the Open Food Facts request asks for none of them", async () => {
    const { OFF_FIELDS } = await import("../../scripts/product-data/lib/off.mjs");
    expect(OFF_FIELDS.split(",").filter((f: string) => findBanned(f).length || /grade/i.test(f))).toEqual([]);
  });
});

describe("nor does the database hold one", () => {
  let db: TestDb;
  beforeAll(async () => { db = await openTestDb({ seeds: false }); }, 120_000);

  it("no column, check constraint or function in public", async () => {
    const cols = await db.all<{ t: string }>(`select c.relname || '.' || a.attname as t from pg_attribute a join pg_class c on c.oid = a.attrelid
      where c.relnamespace = 'public'::regnamespace and a.attnum > 0 and not a.attisdropped`);
    const cons = await db.all<{ t: string }>(`select conname || ': ' || pg_get_constraintdef(oid) as t from pg_constraint where connamespace = 'public'::regnamespace`);
    const fns = await db.all<{ t: string }>(`select proname || ': ' || prosrc as t from pg_proc where pronamespace = 'public'::regnamespace`);
    const hits = [...cols, ...cons, ...fns].filter((r) => findBanned(r.t).length).map((r) => r.t.slice(0, 120));
    expect(hits).toEqual([]);
  });
});
