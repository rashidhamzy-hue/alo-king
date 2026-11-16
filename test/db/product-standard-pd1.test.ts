// PD1 pull request 2 (docs/PRODUCT_DATA_STANDARD.md): (a) templates as data, (b) nutrition numbers, printed claims, certificates, tags
// and the vendor dish standard, (c) two readiness levels, (d) intake and the approval rules. On the real migrations and seed, in PGlite.
import { beforeAll, describe, expect, it } from "vitest";
import { openTestDb, type TestDb } from "./harness";
import { makeFactComplete } from "./fact-kit";

let db: TestDb; let ops: string; let picker: string;
const AUTO = "00000000-0000-4000-8000-0000000000a1";
const id = async (name: string) => (await db.one(`select id from products where name_en = $1`, [name])).id as string;
const firstOf = async (category: string) => (await db.one(`select id from products where category = $1 order by sku limit 1`, [category])).id as string;
const status = (p: string) => db.rpc("product_template_status", { p_product: p });
const party = async (role: string, name: string) => (await db.one(`insert into parties(role, display_name) values ($1, $2) returning id`, [role, name])).id as string;
const evidence = async (p: string | null, kind = "label_photo") =>
  (await db.one(`insert into evidence_documents(kind, product_id, media_path) values ($1, $2, 'media/evidence/test.jpg') returning id`, [kind, p])).id as string;

beforeAll(async () => {
  db = await openTestDb();
  ops = await party("ops_lead", "Ops PD1");
  picker = await party("picker", "Picker PD1");
}, 120_000);

describe("(a) templates as data", () => {
  it("every item active today has a template, and the migration paused none of them", async () => {
    expect(await db.one(`select count(*)::int as n from products where is_active`)).toEqual({ n: 291 });
    expect(await db.all(`select sku from products where is_active and product_template(id) is null`)).toEqual([]);
    const t = await db.all(`select product_template(id) as t, count(*)::int as n from products group by 1 order by 1`);
    expect(t).toEqual(expect.arrayContaining([{ t: "packaged_food", n: 188 }, { t: "fresh_produce", n: 25 }, { t: "cleaning_household", n: 20 },
      { t: "beauty_personal_care", n: 14 }, { t: "baby_child", n: 6 }, { t: "pet", n: 3 }, { t: "water", n: 10 }, { t: "meat_poultry", n: 13 }, { t: "bakery", n: 12 }]));
  });

  it("every template of the document is seeded, food fields only on food templates; gas is there with no items", async () => {
    const t = await db.all(`select code, is_food, future from product_templates order by code`);
    expect(t.map((x) => x.code)).toEqual(["baby_child", "baby_food", "bakery", "beauty_personal_care", "cleaning_household", "core", "fresh_produce",
      "gas", "meat_poultry", "packaged_food", "pet", "vendor_dish", "water"]);
    expect(await db.all(`select distinct t.code from template_fields f join product_templates t on t.code = f.template_code
                          where f.store = 'facts' and not t.is_food`)).toEqual([]);
    expect(await db.one(`select future from product_templates where code = 'gas'`)).toEqual({ future: true });
  });

  it("a category with no template cannot hold an active item; inactive it waits; the template makes it possible", async () => {
    await expect(db.pg.query(`insert into products(sku, name_en, category) values ('PD1-G1', 'Garden hose', 'Garden')`)).rejects.toThrow(/TEMPLATE_MISSING/);
    const g = (await db.one(`insert into products(sku, name_en, category, is_active) values ('PD1-G2', 'Garden hose', 'Garden', false) returning id`)).id;
    await expect(db.pg.query(`update products set is_active = true where id = $1`, [g])).rejects.toThrow(/TEMPLATE_MISSING/);
    await expect(db.pg.query(`update products set category = 'Garden' where sku = 'AK-0001'`)).rejects.toThrow(/TEMPLATE_MISSING/);
    await expect(db.pg.query(`insert into products(sku, name_en, category, sub_type) values ('PD1-G3', 'Gas 10 kg', 'Gas', null)`)).rejects.toThrow(/TEMPLATE_MISSING/);
    await db.pg.query(`insert into category_templates(category, template_code) values ('Gas', 'gas')`);
    await expect(db.pg.query(`insert into products(sku, name_en, category) values ('PD1-G4', 'Gas 10 kg', 'Gas')`)).rejects.toThrow(/TEMPLATE_FUTURE/);
    await db.pg.query(`delete from category_templates where category = 'Gas'`);
  });

  it("the database refuses a food fact on a non-food item", async () => {
    const soap = await firstOf("Beauty & Personal Care");
    await expect(db.rpc("propose_product_fact", { p_product: soap, p_attribute: "milk", p_value: "free", p_status: "declared", p_source: "label", p_by: ops }))
      .rejects.toThrow(/NOT_FOOD/);
    await expect(db.rpc("propose_product_fact", { p_product: soap, p_attribute: "nutrition", p_value: null, p_status: "declared", p_source: "label", p_by: ops,
      p_detail: { values: { energy_kcal: 1 } } })).rejects.toThrow(/NOT_FOOD/);
  });

  it("a field value belongs to the item's own template, and an enum takes only its values", async () => {
    const shampoo = await id("Johnsons Baby Shampoo 750Ml");
    const cat = await id("Miglior Gatto Pate Agnello 400G");
    await expect(db.pg.query(`insert into product_field_values(product_id, field_key, value, source) values ($1, 'species', '"cat"', 'label_photo')`, [shampoo]))
      .rejects.toThrow(/FIELD_NOT_IN_TEMPLATE/);
    await expect(db.pg.query(`insert into product_field_values(product_id, field_key, value, source) values ($1, 'species', '"dragon"', 'label_photo')`, [cat]))
      .rejects.toThrow(/FIELD_VALUE/);
    await db.pg.query(`insert into product_field_values(product_id, field_key, value, source) values ($1, 'species', '"cat"', 'label_photo')`, [cat]);
    await expect(db.pg.query(`insert into product_field_values(product_id, field_key, value, source) values ($1, 'ingredients', '"x"', 'label_photo')`, [cat]))
      .rejects.toThrow(/FIELD_NOT_IN_TEMPLATE|FIELD_STORED_ELSEWHERE/);
  });
});

describe("(b) nutrition numbers, claims, certificates, tags", () => {
  it("nutrition per 100 g as numbers from the approved panel only; a value not printed is null, never 0", async () => {
    const p = await id("Kinder Chocolate Barrette Maxi 21G");
    const f = await db.rpc("propose_product_fact", { p_product: p, p_attribute: "nutrition", p_value: null, p_status: "declared", p_source: "label", p_by: picker,
      p_detail: { per: "100g", values: { energy_kcal: 550, fat: 33, carbohydrates: 53, sugars: 52.5, proteins: 9 } } });
    expect(await db.rpc("product_nutrition", { p_product: p })).toBeNull();                        // proposed is not approved
    await db.rpc("approve_product_fact", { p_fact: f, p_by: ops });
    const n = await db.rpc("product_nutrition", { p_product: p });
    expect(n).toMatchObject({ per: "100g", energy_kcal: 550, sugars_g: 52.5, protein_g: 9, salt_g: null, added_sugars_g: null, status: "declared" });
  });

  it("a printed claim needs its printed words; a food claim never sits on a non-food item; it is approved only from the pack or the brand's page", async () => {
    const tea = await id("Lipton Ice Tea Tropical Zero Sugar 320Ml");
    const soap = await firstOf("Beauty & Personal Care");
    await expect(db.pg.query(`insert into product_claims(product_id, claim_code, quote, source) values ($1, 'sugar_free', '', 'label_photo')`, [tea])).rejects.toThrow(/check/);
    await expect(db.pg.query(`insert into product_claims(product_id, claim_code, quote, source) values ($1, 'no_added_sugar', 'No added sugar', 'label_photo')`, [soap]))
      .rejects.toThrow(/NOT_FOOD/);
    const off = (await db.one(`insert into product_claims(product_id, claim_code, quote, source) values ($1, 'sugar_free', 'Zero Sugar', 'open_food_facts') returning id`, [tea])).id;
    await expect(db.pg.query(`update product_claims set status = 'approved', approved_by = $2 where id = $1`, [off, ops])).rejects.toThrow(/CLAIM_SOURCE/);
    const label = (await db.one(`insert into product_claims(product_id, claim_code, quote, source, evidence_id) values ($1, 'sugar_free', 'Zero Sugar', 'label_photo', $2) returning id`,
      [tea, await evidence(tea)])).id;
    await db.pg.query(`update product_claims set status = 'approved', approved_by = $2 where id = $1`, [label, ops]);
    expect(await db.one(`select status, expires_at > now() + interval '11 months' as long from product_claims where id = $1`, [label])).toEqual({ status: "approved", long: true });
  });

  it("a claim that sounds medical is never approved by the automatic party; a certificate is approved by a person only", async () => {
    const soap = await firstOf("Beauty & Personal Care");
    const c = (await db.one(`insert into product_claims(product_id, claim_code, quote, source) values ($1, 'hypoallergenic', 'Hypoallergenic', 'label_photo') returning id`, [soap])).id;
    await expect(db.pg.query(`update product_claims set status = 'approved', approved_by = $2 where id = $1`, [c, AUTO])).rejects.toThrow(/NEVER_AUTOMATIC/);
    const meat = await id((await db.one(`select name_en from products where category = 'Meat & Poultry' limit 1`)).name_en);
    const ev = await evidence(null, "certificate");
    await expect(db.pg.query(`insert into product_certificates(product_id, kind, evidence_id, status, approved_by) values ($1, 'halal', $2, 'approved', $3)`, [meat, ev, AUTO]))
      .rejects.toThrow(/NEVER_AUTOMATIC/);
    await expect(db.pg.query(`insert into product_certificates(product_id, kind, evidence_id, status, approved_by) values ($1, 'halal', $2, 'approved', $3)`, [meat, ev, picker]))
      .rejects.toThrow(/NEVER_AUTOMATIC/);
    await db.pg.query(`insert into product_certificates(product_id, kind, evidence_id, status, approved_by) values ($1, 'halal', $2, 'approved', $3)`, [meat, ev, ops]);
  });

  it("audience and occasion tags are shopping tags from a fixed list", async () => {
    const p = await id("Kinder Chocolate Barrette Maxi 21G");
    await db.pg.query(`insert into product_tags(product_id, tag_code, source) values ($1, 'kids', 'model'), ($1, 'lunchbox', 'rules')`, [p]);
    await expect(db.pg.query(`insert into product_tags(product_id, tag_code, source) values ($1, 'healthy', 'model')`, [p])).rejects.toThrow(/foreign key/);
  });
});

describe("(b) the vendor dish standard, on invented data", () => {
  let vendor: string; let other: string; let source: string; let dish: string; let imp: string;
  beforeAll(async () => {
    vendor = await party("merchant", "Invented Grill owner");
    other = await party("merchant", "Another owner");
    source = (await db.one(`insert into sources(kind, name, owner_party_id, is_open) values ('merchant', 'Invented Grill', $1, false) returning id`, [vendor])).id;
    dish = (await db.one(`insert into products(sku, owner_source_id, name_en, category, sell_unit) values ('M-PD1-1', $1, 'Protein Chicken Wrap', 'Restaurant', 'piece') returning id`, [source])).id;
    imp = (await db.one(`insert into merchant_menu_imports(source_id, extracted) values ($1, '{"items": [{"name_en": "Falafel Plate", "price": 4, "currency": "USD", "section": "Plates", "confidence": 0.9}]}') returning id`, [source])).id;
  });

  it("a dish follows the vendor dish template; food facts are the vendor's declarations with their date", async () => {
    expect(await db.rpc("product_template", { p_product: dish })).toBe("vendor_dish");
    await expect(db.rpc("vendor_declare", { p_dish: dish, p_vendor: other, p_attribute: "sesame", p_value: "free" })).rejects.toThrow(/NOT_AUTHORISED/);
    await expect(db.rpc("vendor_declare", { p_dish: dish, p_vendor: vendor, p_attribute: "sesame", p_value: "yes" })).rejects.toThrow(/DECLARATION_VALUE/);
    await db.rpc("vendor_declare", { p_dish: dish, p_vendor: vendor, p_attribute: "sesame", p_value: "contains" });
    await db.rpc("vendor_declare", { p_dish: dish, p_vendor: vendor, p_attribute: "spicy", p_value: "mild" });
    const f = await db.rpc("dish_food_facts", { p_dish: dish });
    expect(f).toEqual(expect.arrayContaining([expect.objectContaining({ attribute: "sesame", value: "contains", declared_by_vendor: true, status: "declared" })]));
    expect(f[0].declared_at).toBeTruthy();
    const chat = await db.rpc("product_facts_for_chat", { p_product: dish });
    expect(chat).toMatchObject({ template: "vendor_dish", applies: true });
    expect(chat.facts.length).toBe(2);
  });

  it("descriptions never praise; option groups carry required, minimum and maximum", async () => {
    await expect(db.rpc("set_dish_details", { p_dish: dish, p_by: vendor, p_details: { description: "The best wrap in Chouf" } })).rejects.toThrow(/DESCRIPTION_PRAISE/);
    await db.rpc("set_dish_details", { p_dish: dish, p_by: vendor, p_details: { description: "Chicken, lettuce, garlic sauce in bread", serves: 1 } });
    const g = await db.rpc("add_dish_option_group", { p_dish: dish, p_by: vendor, p_group: { name_en: "Bread", required: true, max: 1,
      options: [{ name_en: "White" }, { name_en: "Brown", price_delta_usd: 0.25 }] } });
    expect(await db.one(`select required, min_choices, max_choices from dish_option_groups where id = $1`, [g])).toEqual({ required: true, min_choices: 1, max_choices: 1 });
  });

  it("the menu is confirmed by its vendor, then approved by ops; nothing opens the restaurant", async () => {
    await expect(db.rpc("ops_approve_vendor_menu", { p_import: imp, p_by: ops })).rejects.toThrow(/VENDOR_NOT_CONFIRMED/);
    await expect(db.rpc("vendor_confirm_menu", { p_import: imp, p_vendor: other })).rejects.toThrow(/NOT_AUTHORISED/);
    await db.rpc("vendor_confirm_menu", { p_import: imp, p_vendor: vendor });
    await expect(db.rpc("ops_approve_vendor_menu", { p_import: imp, p_by: picker })).rejects.toThrow(/NOT_AUTHORISED/);
    expect(await db.rpc("ops_approve_vendor_menu", { p_import: imp, p_by: ops })).toMatchObject({ ok: true, new: 1 });
    expect(await db.one(`select is_open from sources where id = $1`, [source])).toEqual({ is_open: false });
  });
});

describe("(c) two readiness levels", () => {
  it("sellable needs the Arabic name and a price; fact-complete needs the template's facts", async () => {
    const p = await id("Kinder Choco Wafer Tronky 18G");
    expect(await status(p)).toMatchObject({ template: "packaged_food", is_food: true, sellable: false, fact_complete: false, missing_sellable: ["name_ar"] });
    expect((await status(p)).missing_fact_complete).toEqual(expect.arrayContaining(["allergens", "ingredients", "nutrition"]));
    await makeFactComplete(db, p, ops);
    expect(await status(p)).toMatchObject({ sellable: true, fact_complete: true, missing_sellable: [], missing_fact_complete: [] });
    const r = (await db.rpc("product_readiness", { p_product: p }))[0];
    expect(r).toMatchObject({ level: "fact_complete", template: "packaged_food", sellable: true, fact_complete: true });
    expect(r).toHaveProperty("blocks_ordering");                                   // 0111's answer is kept
  });

  it("only a fact-complete item passes a fact filter or has a fact stated; a sellable one reads 'not confirmed yet'", async () => {
    const p = await id("Kinder Chocolate Barrette Maxi 21G");          // nutrition approved above, nothing else
    await db.pg.query(`update products set name_ar = 'كيندر' where id = $1`, [p]);
    const f = await db.rpc("propose_product_fact", { p_product: p, p_attribute: "peanuts", p_value: "free", p_status: "declared", p_source: "label", p_by: ops });
    await db.rpc("approve_product_fact", { p_fact: f, p_by: ops });
    const sellable = await db.rpc("product_meets_restrictions", { p_product: p, p_restrictions: ["peanuts"] });
    expect(sellable).toMatchObject({ meets: false, level: "sellable", checks: [{ restriction: "peanuts", result: "unknown", reason: "not_fact_complete" }] });
    expect((await db.rpc("product_food_facts", { p_product: p })).every((x: { status: string }) => x.status === "not_confirmed_yet")).toBe(true);
    expect(await db.rpc("product_nutrition", { p_product: p })).not.toBeNull();       // the numbers exist; the chat reads them only when complete
    expect((await db.rpc("product_facts_for_chat", { p_product: p })).nutrition).toBeNull();
    await makeFactComplete(db, p, ops);
    expect(await db.rpc("product_meets_restrictions", { p_product: p, p_restrictions: ["peanuts"] })).toMatchObject({ meets: true, level: "fact_complete" });
    // A fact that excludes always counts: "contains" fails at any level.
    const q = await id("Snickers Chocolate Bar Caramel & Peanuts 45G");
    await db.rpc("approve_product_fact", { p_fact: await db.rpc("propose_product_fact", { p_product: q, p_attribute: "peanuts", p_value: "contains", p_status: "declared", p_source: "label", p_by: ops }), p_by: ops });
    expect((await db.rpc("product_meets_restrictions", { p_product: q, p_restrictions: ["peanuts"] })).checks[0]).toMatchObject({ result: "fails" });
  });

  it("a food question about a non-food item: doesn't apply", async () => {
    const soap = await firstOf("Beauty & Personal Care");
    expect(await db.rpc("product_facts_for_chat", { p_product: soap })).toMatchObject({ applies: false, facts: [], note: "Food facts do not apply to this item: say so." });
    expect((await db.rpc("product_meets_restrictions", { p_product: soap, p_restrictions: ["gluten"] })).checks[0]).toMatchObject({ result: "unknown", reason: "does_not_apply" });
  });

  it("a cleaning product is fact-complete with its hazard warnings as printed, approved by a person", async () => {
    const p = (await db.one(`select id from products where category = 'Cleaning & Household' order by sku limit 1`)).id;
    await db.pg.query(`update products set name_ar = 'منظف' where id = $1`, [p]);
    expect(await status(p)).toMatchObject({ sellable: true, fact_complete: false, missing_fact_complete: ["hazard_warnings"] });
    const v = (await db.one(`insert into product_field_values(product_id, field_key, value, source) values ($1, 'hazard_warnings', '["Causes serious eye irritation"]', 'label_photo') returning id`, [p])).id;
    await expect(db.pg.query(`update product_field_values set status = 'approved', approved_by = $2 where id = $1`, [v, AUTO])).rejects.toThrow(/NEVER_AUTOMATIC/);
    await db.pg.query(`update product_field_values set status = 'approved', approved_by = $2 where id = $1`, [v, ops]);
    expect(await status(p)).toMatchObject({ fact_complete: true });
  });

  it("the catalogue does not freeze: an item live before comes back after a pause; a new item goes live only when sellable", async () => {
    const p = await id("Master Chips Salt 65G");                   // no Arabic name: not sellable
    await db.pg.query(`update products set is_active = false where id = $1`, [p]);
    await db.pg.query(`update products set is_active = true where id = $1`, [p]);          // a recall or hold released: as it was
    const n = (await db.one(`insert into products(sku, name_en, category, is_active) values ('PD1-N1', 'New Biscuits 40G', 'Snacks & Candy', false) returning id`)).id;
    await expect(db.pg.query(`update products set is_active = true where id = $1`, [n])).rejects.toThrow(/NOT_SELLABLE/);
    const hub = (await db.one(`select id from sources where kind = 'dark_store'`)).id;
    await db.pg.query(`insert into offers(source_id, product_id, price_usd) values ($1, $2, 0.5)`, [hub, n]);
    await db.pg.query(`update products set is_active = true, name_ar = 'بسكويت' where id = $1`, [n]);
    expect(await db.one(`select how from product_went_live where product_id = $1`, [n])).toEqual({ how: "activated_sellable" });
  });

  it("the active items that are not sellable are listed with what they miss; the summary counts both levels per template", async () => {
    const list = await db.rpc("readiness_not_sellable");
    expect(list.length).toBeGreaterThan(200);
    expect(list[0]).toHaveProperty("missing");
    const s = await db.rpc("readiness_summary");
    expect(s.active).toBe(292);                                          // 291 and the one item made live above
    expect(s.by_template.packaged_food.active).toBeGreaterThan(180);
    expect(s.fact_complete).toBeGreaterThanOrEqual(3);
  });
});

describe("(d) intake and the approval rules", () => {
  it("an item starts from a barcode, a supplier line or an unmet-demand row: inactive, with its template and its jobs", async () => {
    const a = await db.rpc("intake_start", { p_origin: "barcode", p_payload: { barcode: "5281234567897", name_en: "Dates 500 g", category: "Dry Foods & Pantry" }, p_by: ops });
    expect(a).toMatchObject({ ok: true, template: "packaged_food" });
    expect(await db.one(`select is_active from products where id = $1`, [a.product_id])).toEqual({ is_active: false });
    expect((await db.one(`select count(*)::int as n from product_intake_jobs where product_id = $1`, [a.product_id])).n).toBe(8);
    await expect(db.rpc("intake_start", { p_origin: "barcode", p_payload: { barcode: "5281234567897", name_en: "Dates", category: "Dry Foods & Pantry" }, p_by: ops })).rejects.toThrow(/INTAKE_DUPLICATE/);
    await expect(db.rpc("intake_start", { p_origin: "supplier_line", p_payload: { supplier_text: "Garden hose 20 m", category: "Garden" }, p_by: ops })).rejects.toThrow(/TEMPLATE_MISSING/);
    await expect(db.rpc("intake_start", { p_origin: "supplier_line", p_payload: { supplier_text: "Dog food", category: "Pet Zone" }, p_by: picker })).rejects.toThrow(/NOT_AUTHORISED/);
    await db.rpc("log_demand", { p_kind: "unknown_product", p_origin: "honest_answer", p_query: "protein bars" });
    const d = (await db.one(`select id from demand_signals where query = 'protein bars'`)).id;
    const b = await db.rpc("intake_start", { p_origin: "demand", p_payload: { demand_id: d, category: "Healthy" }, p_by: ops });
    expect(await db.one(`select name_en from products where id = $1`, [b.product_id])).toEqual({ name_en: "protein bars" });
    expect(await db.one(`select result->>'started_from' as s from product_intake_jobs where product_id = $1 and step = 'new_item'`, [b.product_id])).toEqual({ s: "demand" });
  });

  it("the label is read into the template's own fields: a cleaning product's hazards, no food facts; claims as proposals", async () => {
    const p = (await db.one(`select id from products where category = 'Cleaning & Household' order by sku desc limit 1`)).id;
    const r = await db.rpc("record_label_scan", { p_product: p, p_photos: ["media/label/a.jpg"], p_model: "test", p_by: picker, p_reading: {
      barcode: null, facts: [{ attribute: "ingredients", text: "water, soap" }],
      fields: { hazard_warnings: ["Keep out of reach of children"], active_ingredient: "Sodium hypochlorite 4.5%", scent: "Lemon", species: "cat" },
      claims: [{ code: "fragrance_free", quote: "Fragrance free" }, { code: "no_added_sugar", quote: "No added sugar" }] } });
    expect(Object.keys(r.fields).sort()).toEqual(["active_ingredient", "hazard_warnings", "scent"]);
    expect(r.proposed).toEqual({});
    expect(r.claims.length).toBe(1);
    expect(r.dropped).toEqual(expect.arrayContaining([expect.objectContaining({ field: "species" }), expect.objectContaining({ claim: "no_added_sugar" })]));
    expect(await db.all(`select 1 from product_facts where product_id = $1`, [p])).toEqual([]);
  });

  it("allergens, halal, hazard warnings and disagreeing sources are never approved by the automatic party, whatever writes them", async () => {
    const p = await id("Nescafe Classic Instant Coffee 50G").catch(async () => (await db.one(`select id from products where category = 'Hot Beverages' limit 1`)).id);
    await expect(db.pg.query(`insert into product_facts(product_id, attribute, value, status, source, approved_by, approved_at) values ($1, 'milk', 'free', 'declared', 'label', $2, now())`, [p, AUTO]))
      .rejects.toThrow(/NEVER_AUTOMATIC/);
    await expect(db.pg.query(`insert into product_facts(product_id, attribute, value, status, source, approved_by, approved_at) values ($1, 'halal', 'yes', 'declared', 'label', $2, now())`, [p, AUTO]))
      .rejects.toThrow(/NEVER_AUTOMATIC/);
    // Two readings of the origin that disagree: the automatic party cannot pick one.
    await db.pg.query(`insert into product_field_values(product_id, field_key, value, source) values ($1, 'kind', '"instant coffee"', 'model')`, [p]);
    const v = (await db.one(`insert into product_field_values(product_id, field_key, value, source) values ($1, 'kind', '"coffee"', 'rules') returning id`, [p])).id;
    expect(await db.rpc("try_auto_approve", { p_kind: "field", p_proposal: v })).toMatchObject({ approved: false, failed: ["no_other_source_disagrees"] });
    await expect(db.pg.query(`update product_field_values set status = 'approved', approved_by = $2 where id = $1`, [v, AUTO])).rejects.toThrow(/SOURCES_DISAGREE/);
  });

  it("kind, tags and storage proposed by rules are approved by the rule (on); a disagreement waits for a person", async () => {
    const p = (await db.one(`select id from products where category = 'Water' order by sku limit 1`)).id;
    const v = (await db.one(`insert into product_field_values(product_id, field_key, value, source) values ($1, 'kind', '"mineral water"', 'rules') returning id`, [p])).id;
    expect(await db.rpc("try_auto_approve", { p_kind: "field", p_proposal: v })).toMatchObject({ approved: true, field: "rule_fields" });
    const w = (await db.one(`insert into product_field_values(product_id, field_key, value, source) values ($1, 'supplier', '"A supplier"', 'rules') returning id`, [p])).id;
    expect(await db.rpc("try_auto_approve", { p_kind: "field", p_proposal: w })).toMatchObject({ approved: false, failed: ["field_is_automatic_in_its_template"] });
  });

  describe("two independent published sources for the same market (the coordinator's rule, on)", () => {
    let p: string; const BARCODE = "6222035227786";
    const web = (host: string, values: Record<string, number>, market: string | null = "lb") => db.one(
      `insert into product_facts(product_id, attribute, detail, status, source) values ($1, 'nutrition', $2, 'partial', 'web_page') returning id`,
      [p, { per: "100g", values, page_url: `https://${host}/p/1`, market, matched: { barcode: BARCODE, confidence: "exact" } }]).then((r) => r.id as string);
    const off = (values: Record<string, number>, market: string | null = "lb") => db.one(
      `insert into product_facts(product_id, attribute, detail, status, source) values ($1, 'nutrition', $2, 'partial', 'open_food_facts') returning id`,
      [p, { per: "100g", values, off_code: BARCODE, market }]).then((r) => r.id as string);
    const V = { energy_kcal: 480, fat: 20, carbohydrates: 55, proteins: 15, sugars: 4 };
    beforeAll(async () => { p = await id("Balance Protein Crackers Sour Cream & Onion 70G"); });
    const clear = () => db.pg.query(`delete from product_facts where product_id = $1`, [p]);

    it("two sources on different hosts, tied to the barcode, same market, exactly the same numbers: approved, as a record of its own", async () => {
      await clear();
      const a = await off(V); await web("retailer.example.com", V);
      const r = await db.rpc("try_auto_approve", { p_kind: "fact_web", p_proposal: a });
      expect(r).toMatchObject({ approved: true, field: "two_published_sources" });
      expect(await db.one(`select source, status, approved_by from product_facts where product_id = $1 and approved_at is not null and superseded_at is null`, [p]))
        .toEqual({ source: "published_sources", status: "declared", approved_by: AUTO });
    });

    it("not when the numbers differ, the market differs or is unknown, the host is the same, or a label reading disagrees", async () => {
      await clear();
      let a = await off(V); await web("retailer.example.com", { ...V, proteins: 15.5 });
      expect((await db.rpc("try_auto_approve", { p_kind: "fact_web", p_proposal: a })).failed).toEqual(["second_independent_source_same_market_agrees_exactly"]);
      await clear(); a = await off(V, "fr"); await web("retailer.example.com", V, "lb");
      expect((await db.rpc("try_auto_approve", { p_kind: "fact_web", p_proposal: a })).approved).toBe(false);
      await clear(); a = await web("retailer.example.com", V);                       // one page counts once (0071 keeps one per page)
      await expect(web("retailer.example.com", V)).rejects.toThrow(/product_facts_web_proposal_current/);
      expect((await db.rpc("try_auto_approve", { p_kind: "fact_web", p_proposal: a })).approved).toBe(false);
      await clear(); a = await off(V); await web("retailer.example.com", V);
      await db.pg.query(`insert into product_facts(product_id, attribute, detail, status, source) values ($1, 'nutrition', $2, 'partial', 'label')`,
        [p, { per: "100g", values: { ...V, energy_kcal: 300 }, read_by: "model" }]);
      expect((await db.rpc("try_auto_approve", { p_kind: "fact_web", p_proposal: a })).failed).toEqual(["no_label_reading_disagrees"]);
    });

    it("one row the founder can switch off: then it only logs", async () => {
      await clear();
      await db.pg.query(`update auto_approval_rules set enabled = false where field = 'two_published_sources'`);
      const a = await off(V); await web("retailer.example.com", V);
      expect(await db.rpc("try_auto_approve", { p_kind: "fact_web", p_proposal: a })).toMatchObject({ approved: false, shadow: true });
      await db.pg.query(`update auto_approval_rules set enabled = true where field = 'two_published_sources'`);
      await clear();
    });
  });

  it("printed claims: off until its spot check passes; it logs a claim read from the label photo whose barcode matches", async () => {
    const p = await id("Lipton Ice Tea Red Fruits Zero Sugar 320Ml");
    const r = await db.rpc("record_label_scan", { p_product: p, p_photos: ["media/label/l.jpg"], p_model: "test", p_by: picker, p_reading: {
      barcode: "5283024603364", claims: [{ code: "sugar_free", quote: "Zero Sugar" }] } });
    const c = r.claims[0];
    expect(await db.rpc("try_auto_approve", { p_kind: "claim", p_proposal: c })).toMatchObject({ approved: false, shadow: true, field: "printed_claims" });
    await db.pg.query(`update auto_approval_rules set enabled = true where field = 'printed_claims'`);
    expect(await db.rpc("try_auto_approve", { p_kind: "claim", p_proposal: c })).toMatchObject({ approved: true });
    await db.pg.query(`update auto_approval_rules set enabled = false where field = 'printed_claims'`);
  });

  it("facts expire after 12 months without a re-check, and are listed before they do", async () => {
    const p = await id("Kinder Choco Wafer Tronky 18G");                 // fact-complete above
    await db.pg.query(`update product_facts set reviewed_at = now() - interval '12 months' + interval '10 days', approved_at = now() - interval '12 months' + interval '10 days'
                        where product_id = $1 and attribute = 'ingredients' and superseded_at is null`, [p]);
    expect((await db.rpc("facts_due_for_recheck", { p_days: 30 })).some((x: { product_id: string; field: string }) => x.product_id === p && x.field === "ingredients")).toBe(true);
    await db.pg.query(`update product_facts set reviewed_at = now() - interval '13 months' where product_id = $1 and attribute = 'ingredients' and superseded_at is null`, [p]);
    expect(await status(p)).toMatchObject({ fact_complete: false, missing_fact_complete: ["ingredients"] });
  });
});
