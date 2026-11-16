// PD1 (0206): makes a food item fact-complete for a test: an Arabic name if it has none, and approved, current records for the
// ingredients, all 14 allergens and the nutrition panel. Allergens not given are "free"; an allergen already approved keeps its value.
import type { TestDb } from "./harness";

const ALLERGENS = ["gluten", "crustaceans", "eggs", "fish", "peanuts", "soy", "milk", "tree_nuts", "celery", "mustard", "sesame", "sulphites", "lupin", "molluscs"];

export async function makeFactComplete(db: TestDb, product: string, by: string, opts: { allergens?: Record<string, string>; nutrition?: Record<string, number>; ingredients?: string } = {}) {
  await db.pg.query(`update products set name_ar = coalesce(name_ar, 'منتج تجربة') where id = $1`, [product]);
  const has = async (attr: string) => !!(await db.one(`select 1 as x from product_facts where product_id = $1 and attribute = $2 and approved_at is not null and superseded_at is null`, [product, attr]));
  const approve = async (attribute: string, value: string | null, detail: Record<string, unknown> = {}) => {
    const f = await db.rpc("propose_product_fact", { p_product: product, p_attribute: attribute, p_value: value, p_status: "declared", p_source: "label", p_by: by, p_detail: detail });
    await db.rpc("approve_product_fact", { p_fact: f, p_by: by });
  };
  if (!(await has("ingredients"))) await approve("ingredients", null, { text: opts.ingredients ?? "Test ingredients as printed" });
  if (!(await has("nutrition"))) await approve("nutrition", null, { per: "100g", values: opts.nutrition ?? { energy_kcal: 100, fat: 1, carbohydrates: 10, proteins: 5, sugars: 2, salt: 0.1 } });
  for (const a of ALLERGENS) if (opts.allergens?.[a] || !(await has(a))) await approve(a, opts.allergens?.[a] ?? "free");
}
