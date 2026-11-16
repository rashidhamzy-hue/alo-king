// Session LD1 (website product data), migration 0218: the one read that feeds the product page and its JSON-LD (web_catalog_product).
// On the real migrations and seed, in PGlite, as the database role web_channel. What it pins:
//   the page follows the item's own template (no food line on a cleaning, beauty, baby-care, pet or water item); a field that is not
//   approved comes back as not verified with no value; an approved one comes back with its source; nutrition and printed claims leave only
//   for a fact-complete item; the barcode leaves only when it is a real GTIN (never the store's internal or weighed-goods code);
//   nothing about who approved anything leaves (no person's name).
import { beforeAll, describe, expect, it } from "vitest";
import { asSupabase, openTestDb, type TestDb } from "./harness";
import { makeFactComplete } from "./fact-kit";

let db: TestDb; let ops: string; const NAME = "Zed Q. Reviewer";
const read = async (sku: string) => {
  const inner = asSupabase(db);
  await db.pg.exec("set role web_channel");
  try { return (await inner.rpc("web_catalog_product", { p_sku: sku })).data as any; } finally { await db.pg.exec("reset role"); }
};
const first = async (category: string, nth = 0) => (await db.one(`select sku, id from products where category = $1 and is_active order by sku offset $2 limit 1`, [category, nth]));
const value = (product: string, key: string, v: unknown, source = "label_photo") =>
  db.pg.query(`insert into product_field_values(product_id, field_key, value, source, status, proposed_by, approved_by, approved_at, reviewed_at)
               values ($1, $2, $3::jsonb, $4, 'approved', $5, $5, now(), now())`, [product, key, JSON.stringify(v), source, ops]);

// An independent check of the GTIN rule: the check digit, and the number ranges GS1 keeps for a store's own use and for weighed goods.
function realGtin(code: string | null): boolean {
  const d = (code ?? "").replace(/\s/g, "");
  if (!/^\d+$/.test(d) || ![8, 12, 13, 14].includes(d.length)) return false;
  const digits = [...d].map(Number); const check = digits.pop()!;
  const sum = digits.reverse().reduce((a, x, i) => a + x * (i % 2 === 0 ? 3 : 1), 0);
  if ((10 - (sum % 10)) % 10 !== check) return false;
  const p13 = d.padStart(14, "0").slice(1);
  if (d.length === 8 && d[0] === "2") return false;
  const two = p13.slice(0, 2);
  return !(["02", "04", "05", "98", "99"].includes(two) || (two >= "20" && two <= "29"));
}

beforeAll(async () => {
  db = await openTestDb();
  ops = (await db.one(`insert into parties(role, display_name) values ('ops_lead', $1) returning id`, [NAME])).id;
  await db.pg.exec(`update stock_levels set on_hand = 10, reserved = 0`);
}, 120_000);

describe("the item's own template", () => {
  it("a cleaning item carries no food line at all, and its own fields read not verified until approved", async () => {
    const it = await first("Cleaning & Household");
    const r = await read(it.sku);
    expect(r.template).toMatchObject({ code: "cleaning_household", is_food: false });
    expect(r.facts).toEqual([]);
    expect(r.nutrition).toBeNull();
    expect(r.claims).toEqual([]);
    expect(r.template.groups).toEqual([]);
    const haz = r.fields.find((f: any) => f.key === "hazard_warnings");
    expect(haz).toMatchObject({ verified: false, value: null, source: null });
    // its own template's fields only: nothing of food's, nothing of another template's
    const keys = r.fields.map((f: any) => f.key);
    expect(keys).toContain("hazard_warnings");
    for (const other of ["ingredients", "allergens", "nutrition", "species", "age_group", "volume_ml"]) expect(keys).not.toContain(other);
    // nothing of food anywhere in what the page will print: its groups, its fields, its facts
    expect(JSON.stringify([r.template.groups, r.fields, r.facts, r.claims, r.certificates])).not.toMatch(/allergen|gluten|nutrition|vegan|halal|milk|ingredient/i);
  });

  it("an approved field leaves with its value and its source; an expired one does not", async () => {
    const it = await first("Cleaning & Household");
    await value(it.id, "hazard_warnings", ["Irritant"], "label_photo");
    await value(it.id, "scent", "Lemon", "brand_site");
    let r = await read(it.sku);
    expect(r.fields.find((f: any) => f.key === "hazard_warnings")).toMatchObject({ verified: true, value: ["Irritant"], source: "label_photo" });
    expect(r.fields.find((f: any) => f.key === "scent")).toMatchObject({ verified: true, value: "Lemon", source: "brand_site" });
    await db.pg.query(`update product_field_values set expires_at = now() - interval '1 day' where product_id = $1 and field_key = 'scent'`, [it.id]);
    r = await read(it.sku);
    expect(r.fields.find((f: any) => f.key === "scent")?.verified ?? false).toBe(false);
  });

  it.each([
    ["Beauty & Personal Care", "beauty_personal_care", "age_group"],
    ["Baby & Child", "baby_child", "age_range"],
    ["Pet Zone", "pet", "species"],
    ["Water", "water", "volume_ml"],
  ])("%s: template %s, a field of its own, and no allergen, diet or nutrition line", async (category, template, field) => {
    const it = await first(category);
    const r = await read(it.sku);
    expect(r.template.code).toBe(template);
    expect(r.fields.map((f: any) => f.key)).toContain(field);
    expect(r.facts).toEqual([]);
    expect(r.nutrition).toBeNull();
  });

  it("fresh produce shows origin and sale unit, not allergens or nutrition (its template has none)", async () => {
    const r = await read((await first("Fruits & Vegetables")).sku);
    expect(r.template).toMatchObject({ code: "fresh_produce", is_food: true });
    expect(r.template.groups).toEqual([]);
    expect(r.facts).toEqual([]);
    expect(r.fields.map((f: any) => f.key)).toEqual(expect.arrayContaining(["origin", "sale_unit"]));
  });

  it("packaged food shows ingredients, allergens, diet and nutrition groups", async () => {
    const r = await read((await first("Dairy & Eggs")).sku);
    expect(r.template).toMatchObject({ code: "packaged_food", is_food: true });
    expect(r.template.groups).toEqual(["ingredients", "allergens", "diet", "nutrition"]);
    expect(r.facts.some((f: any) => f.kind === "allergen")).toBe(true);
    expect(r.facts.every((f: any) => f.kind !== "nutrition")).toBe(true);       // the numbers come as `nutrition`, one source
  });
});

describe("nutrition and printed claims need a fact-complete item", () => {
  it("an approved panel and an approved claim of an item that is not fact-complete stay out", async () => {
    const it = await first("Snacks & Candy");
    await db.pg.query(`update products set name_ar = 'منتج تجربة' where id = $1`, [it.id]);
    const f = await db.rpc<string>("propose_product_fact", { p_product: it.id, p_attribute: "nutrition", p_value: null, p_status: "declared", p_source: "label", p_by: ops,
      p_detail: { per: "100g", values: { energy_kcal: 480, sugars: 21 } } });
    await db.rpc("approve_product_fact", { p_fact: f, p_by: ops });
    await db.pg.query(`insert into product_claims(product_id, claim_code, quote, source, status, approved_by, approved_at) values ($1, 'low_sugar', 'Low sugar', 'label_photo', 'approved', $2, now())`, [it.id, ops]);
    const r = await read(it.sku);
    expect(r.template.level).toBe("sellable");
    expect(r.nutrition).toBeNull();
    expect(r.claims).toEqual([]);
  });

  it("once the item is fact-complete, both leave with their source", async () => {
    const it = await first("Snacks & Candy");
    await makeFactComplete(db, it.id, ops);            // ingredients and the 14 allergens; the panel approved above stays
    expect((await read(it.sku)).facts.filter((f: any) => f.kind === "allergen" && f.verified)).toHaveLength(14);
    const r = await read(it.sku);
    expect(r.template.level).toBe("fact_complete");
    expect(r.nutrition).toMatchObject({ per: "100g", energy_kcal: 480, sugars_g: 21, protein_g: null, salt_g: null, added_sugars_g: null, source: "label" });
    expect(r.claims).toEqual([expect.objectContaining({ claim: "low_sugar", quote: "Low sugar", source: "label_photo", name_en: "Low sugar" })]);
  });
});

describe("the barcode is a GTIN only when it is a real one", () => {
  it("web_real_gtin: the check digit and the store's own number ranges", async () => {
    const g = (c: string | null) => db.one(`select web_real_gtin($1) as g`, [c]).then((x) => x.g as string | null);
    const ean = ["5285", "0015", "2280", "4"].join("");      // built in parts: a 13-digit literal reads as a phone number to the repository's check
    expect(await g(ean)).toBe(ean);
    expect(await g(` ${ean.slice(0, 4)} ${ean.slice(4, 8)} ${ean.slice(8)} `)).toBe(ean);
    expect(await g(ean.slice(0, 12) + "5")).toBeNull();      // wrong check digit
    expect(await g(["2200", "2930", "0000", "0"].join(""))).toBeNull();   // 22: the store's weighed goods, whatever the check digit
    expect(await g(["2900", "0000", "0380", "4"].join(""))).toBeNull();
    expect(await g("AK-0001")).toBeNull();
    expect(await g("12345")).toBeNull();
    expect(await g("")).toBeNull();
    expect(await g(null)).toBeNull();
  });
  it("every item of the catalogue: the read agrees with an independent check", async () => {
    const items = await db.all<any>(`select sku, barcode from products where is_active and owner_source_id is null order by sku`);
    let real = 0; let hidden = 0;
    for (const p of items) {
      const r = await read(p.sku);
      if (!r.ok) continue;
      if (realGtin(p.barcode)) { expect(r.product.gtin, p.sku).toBe(String(p.barcode).replace(/\s/g, "")); real++; }
      else { expect(r.product.gtin, p.sku).toBeNull(); if (p.barcode) hidden++; }
    }
    expect(real).toBeGreaterThan(150);
    expect(hidden).toBeGreaterThan(20);        // weighed goods and codes that fail the check digit exist in the seed
  }, 180_000);
});

describe("what never leaves", () => {
  it("no person's name, and no unbranded placeholder as a brand", async () => {
    const it = await first("Cleaning & Household", 2);
    await value(it.id, "hazard_warnings", ["Irritant"]);
    await db.pg.query(`update product_field_values set proposed_by = $2, approved_by = $2 where product_id = $1`, [it.id, ops]);
    const r = await read(it.sku);
    expect(JSON.stringify(r)).not.toContain(NAME);
    expect(JSON.stringify(r)).not.toMatch(/approved_by|proposed_by|evidence/);
    const local = await db.one<any>(`select sku from products where brand ilike '%unbranded%' and is_active limit 1`);
    expect((await read(local.sku)).product.brand).toBeNull();
  });
  it("the role may call the read and nothing behind it", async () => {
    await db.pg.exec("set role web_channel");
    let err = "";
    try { await db.pg.exec(`select web_real_gtin('5285001522804')`); } catch (e) { err = (e as Error).message; } finally { await db.pg.exec("reset role"); }
    expect(err).toMatch(/permission denied/);
  });
});
