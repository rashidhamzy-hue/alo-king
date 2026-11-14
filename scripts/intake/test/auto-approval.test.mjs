// Session I1: automatic approval (0124-0127) against the real migrations (PGlite). SYSTEM_PLAN 4's table, C6 as approved:
// allergens, diet labels, prices and costs can never be approved by a rule, whatever the input; a rule switches on only after
// its first passing spot check; a failed spot check switches it off and undoes the approval.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openTestDb } from "../../../test/db/harness";

const AUTO = "00000000-0000-4000-8000-0000000000a1";
const BARCODE = "3017620422003";
const OFF_URL = "https://images.openfoodfacts.org/images/products/301/762/042/2003/front_en.400.jpg";
const GOOD = { same_brand: "yes", same_product: "yes", same_size: "yes", one_pack: "yes", plain_background: "yes", watermark_or_overlay_text: "no", price_tag_or_shop_logo: "no", seen: "Nutella 350 g" };
const INGREDIENTS = "Sugar, palm oil, HAZELNUTS (13%), skimmed MILK powder (8.7%), fat-reduced cocoa (7.4%), emulsifier: lecithins (SOYA), vanillin.";
const PANEL = { energy_kcal: 539, fat: 30.9, carbohydrates: 57.5, proteins: 6.3, sugars: 56.3 };

let db; let lead; let picker; let pid; let scan; let n = 0;
const rules = (on) => db.pg.query(`update auto_approval_rules set enabled = $1, first_passed_at = case when $1 then now() end, disabled_at = null, disabled_reason = null`, [on]);
const label = (attr) => db.one(`select id from product_facts where product_id = $1 and attribute = $2 and source = 'label' and approved_at is null and superseded_at is null`, [pid, attr]).then((r) => r?.id);
const off = (attr, value, detail) => db.rpc("propose_product_fact", { p_product: pid, p_attribute: attr, p_value: value, p_status: "partial", p_source: "open_food_facts", p_by: null,
  p_detail: { off_code: BARCODE, off: { brands: "Nutella, Ferrero", quantity: "350 g" }, source_text: "x", fingerprint: `fp${++n}`, ...detail } });
// Undo what a rule approved for the item's food facts, so each test starts from the label's proposals.
const resetFacts = async () => {
  await db.pg.query(`update product_facts set superseded_at = null, superseded_by = null where superseded_by in (select id from product_facts where approved_by = $1)`, [AUTO]);
  await db.pg.query(`delete from product_facts where approved_by = $1`, [AUTO]);
  await db.pg.query(`delete from auto_approvals where kind = 'fact'`);
};
const picture = async (over = {}, vision = {}) => (await db.pg.query(`update product_images set status = 'superseded' where product_id = $1 and status = 'proposed'`, [pid]), await db.one(`insert into product_images(product_id, source_kind, licence, source_url, page_url, attribution, media_path, sha256, width_px, height_px, bytes, vision)
  values ($1, $2, $3, $4, $5, $6, $7, $8, 1000, 1000, 5000, $9) returning id`, [pid, over.source_kind ?? "open_food_facts", over.licence ?? "cc_by_sa", over.source_url ?? OFF_URL,
  over.page_url ?? "https://world.openfoodfacts.org/product/3017620422003", "Open Food Facts, CC BY-SA", `product_images/AK-0980/${++n}.jpg`, `sha-${n}`,
  { report: GOOD, original_width: 1200, ...vision }])).id;

beforeAll(async () => {
  db = await openTestDb();
  lead = (await db.one(`insert into parties(role, display_name) values ('ops_lead', 'Lead') returning id`)).id;
  picker = (await db.one(`insert into parties(role, display_name) values ('picker', 'Picker') returning id`)).id;
  const cat = (await db.one(`select category from products where sku = 'AK-0042'`)).category;
  pid = (await db.one(`insert into products(sku, name_en, brand, category, barcode) values ('AK-0980', 'Nutella 350 g', 'Nutella', $1, $2) returning id`, [cat, BARCODE])).id;
  // The intake label photo, read by the label reader (5.15): its barcode is the item's.
  scan = await db.rpc("record_label_scan", { p_product: pid, p_photos: ["label_photos/AK-0980/1.jpg"], p_model: "claude-haiku-5-5", p_by: picker, p_reading: {
    barcode: BARCODE, brand: "nutella", size: "350g", name_en: "Nutella",
    facts: [
      { attribute: "ingredients", text: INGREDIENTS },
      { attribute: "nutrition", values: PANEL },
      { attribute: "milk", value: "contains", quote: "skimmed MILK powder" },
      { attribute: "soy", value: "contains", quote: "lecithins (SOYA)" },
      { attribute: "gluten", value: "free", quote: "gluten free" },
      { attribute: "halal", value: "yes", quote: "Halal" },
      { attribute: "vegetarian", value: "yes", quote: "Suitable for vegetarians" }] } });
  // Open Food Facts, by the same barcode, says the same of every field.
  await off("ingredients", null, { text: INGREDIENTS.toLowerCase(), lang: "en" });
  await off("nutrition", null, { values: { ...PANEL, energy_kcal: 535 }, per: "100g" });
  await off("milk", "contains", { quote: "x" }); await off("soy", "contains", { quote: "x" });
  await off("halal", "yes", { quote: "x" }); await off("vegetarian", "yes", { quote: "x" });
}, 120_000);
beforeEach(() => rules(false));

describe("never automatic: allergens, diet labels, prices, costs", () => {
  it("no input approves an allergen, a diet label, a price or a cost, even with every rule on and every source agreeing", async () => {
    await rules(true);
    const before = await db.all(`select product_id, source_id, price_usd::text, is_available from offers order by 1, 2`);
    const costs = await db.all(`select product_id, source_id, avg_cost_usd::text from stock_levels order by 1, 2`);
    // Every allergen and diet attribute, proposed from the label photo with Open Food Facts agreeing.
    const attrs = (await db.all(`select code, kind from food_attributes where kind in ('allergen', 'diet') order by code`));
    expect(attrs.length).toBe(18);
    const ids = [];
    for (const a of attrs) {
      let id = await label(a.code);
      if (!id) id = await db.rpc("propose_product_fact", { p_product: pid, p_attribute: a.code, p_value: a.kind === "allergen" ? "free" : "yes", p_status: "partial",
        p_source: "label", p_by: picker, p_detail: { read_by: "model", scan_id: scan.scan_id, quote: "printed" } });
      ids.push(id);
    }
    const kinds = ["fact", "picture", "name", "search_words", "price", "cost", "allergen", "allergens", "diet", "diet_labels", "offer", "Fact", "", null, "fact; drop table offers"];
    const proposals = [...ids, "AK-0980", pid, "price", "cost", "", null, "00000000-0000-0000-0000-000000000000", "'; update offers set price_usd = 0; --"];
    for (const id of ids) expect(await db.rpc("try_auto_approve", { p_kind: "fact", p_proposal: id })).toMatchObject({ approved: false, reason: "never_automatic" });
    for (const k of kinds) for (const p of proposals) {
      const r = await db.rpc("try_auto_approve", { p_kind: k, p_proposal: p });
      expect(r.approved, `${k} ${p}`).toBe(false);
    }
    await db.rpc("intake_try_auto", {});
    // Nothing a rule approved is anything but an ingredient list or a nutrition panel; prices and costs did not move.
    expect((await db.one(`select count(*)::int as n from product_facts where approved_by = $1 and attribute not in ('ingredients', 'nutrition')`, [AUTO])).n).toBe(0);
    expect(await db.all(`select product_id, source_id, price_usd::text, is_available from offers order by 1, 2`)).toEqual(before);
    expect(await db.all(`select product_id, source_id, avg_cost_usd::text from stock_levels order by 1, 2`)).toEqual(costs);
    for (const id of ids) expect((await db.one(`select approved_at from product_facts where id = $1`, [id])).approved_at).toBeNull();
    // (The same run approved the ingredient list and the panel, which agree: the positive control, tested on its own below.)
    expect((await db.all(`select attribute from product_facts where approved_by = $1 order by 1`, [AUTO])).map((r) => r.attribute)).toEqual(["ingredients", "nutrition"]);
    await resetFacts();
  });

  it("the database refuses a rule for them, and refuses a rule-approved allergen even by a direct write", async () => {
    for (const f of ["allergens", "diet_labels", "price", "cost", "milk", "halal"]) {
      await expect(db.pg.query(`insert into auto_approval_rules(field, checks) values ($1, 'x')`, [f])).rejects.toThrow(/check constraint/);
      await expect(db.rpc("set_auto_approval_rule", { p_field: f, p_enabled: true, p_by: lead })).rejects.toThrow(/NO_SUCH_RULE/);
    }
    await expect(db.pg.query(`update product_facts set approved_by = $1, approved_at = now() where id = $2`, [AUTO, await label("milk")])).rejects.toThrow(/NEVER_AUTOMATIC/);
    await expect(db.pg.query(`insert into product_facts(product_id, attribute, value, status, source, approved_by, approved_at) values ($1, 'halal', 'yes', 'declared', 'label', $2, now())`, [pid, AUTO])).rejects.toThrow(/NEVER_AUTOMATIC/);
    await expect(db.pg.query(`insert into auto_approvals(field, kind, proposal_id, product_id, applied, checks) values ('picture', 'fact', 'x', $1, true, '{}')`, [pid])).rejects.toThrow(/check constraint/);
    // The rule party can never act, and stays blocked.
    await expect(db.pg.query(`update parties set is_blocked = false where id = $1`, [AUTO])).rejects.toThrow(/AUTO_PARTY_LOCKED/);
    await expect(db.rpc("approve_product_fact", { p_fact: await label("ingredients"), p_by: AUTO })).rejects.toThrow(/NOT_AUTHORISED/);
    await expect(db.rpc("review_product_image", { p_image: await picture(), p_by: AUTO, p_decision: "approve" })).rejects.toThrow(/NOT_AUTHORISED/);
  });
});

describe("ingredients and nutrition: the label photo and a second source for the barcode", () => {
  it("disagreeing readings, a mismatched label barcode or a shop's page are never enough", async () => {
    await rules(true);
    const ing = await label("ingredients");
    await db.pg.query(`update product_facts set detail = jsonb_set(detail, '{text}', '"sugar, palm oil"') where product_id = $1 and source = 'open_food_facts' and attribute = 'ingredients'`, [pid]);
    let r = await db.rpc("try_auto_approve", { p_kind: "fact", p_proposal: ing });
    expect(r).toMatchObject({ approved: false, failed: ["second_source_for_the_barcode_agrees"] });
    // A web page with the same text counts only on the brand's own site with an exact barcode match.
    const web = (host) => db.pg.query(`insert into product_facts(product_id, attribute, detail, status, source) values ($1, 'ingredients', $2, 'partial', 'web_page')`,
      [pid, { text: INGREDIENTS, page_url: `https://${host}/p`, market: null, source_text: INGREDIENTS, fingerprint: host, matched: { barcode: BARCODE, confidence: "exact" } }]);
    await web("shop.example.com");
    expect((await db.rpc("try_auto_approve", { p_kind: "fact", p_proposal: ing })).failed).toEqual(["second_source_for_the_barcode_agrees"]);
    await db.pg.query(`delete from product_facts where source = 'web_page' and product_id = $1`, [pid]);
    await web("www.nutella.com");
    expect((await db.rpc("try_auto_approve", { p_kind: "fact", p_proposal: ing })).failed).toBeUndefined();
    // (rolled back below by restoring Open Food Facts' text and removing the page; the label barcode next)
    await db.pg.query(`delete from product_facts where source = 'web_page' and product_id = $1`, [pid]);
    await resetFacts();
    await db.pg.query(`update product_facts set detail = jsonb_set(detail, '{text}', to_jsonb($2::text)) where product_id = $1 and source = 'open_food_facts' and attribute = 'ingredients'`, [pid, INGREDIENTS.toLowerCase()]);
    await db.pg.query(`update label_scans set reading = jsonb_set(reading, '{barcode}', '"5000000000000"') where id = $1`, [scan.scan_id]);
    r = await db.rpc("try_auto_approve", { p_kind: "fact", p_proposal: ing });
    expect(r.failed).toEqual(["label_photo_barcode_matches"]);
    await db.pg.query(`update label_scans set reading = jsonb_set(reading, '{barcode}', to_jsonb($2::text)) where id = $1`, [scan.scan_id, BARCODE]);
  });

  it("when they agree and the rule is on, the label's reading is approved by the rule and the proposal is kept as history", async () => {
    await rules(true);
    for (const attr of ["ingredients", "nutrition"]) {
      const id = await label(attr);
      const r = await db.rpc("try_auto_approve", { p_kind: "fact", p_proposal: id });
      expect(r, attr).toMatchObject({ approved: true, field: "ingredients_nutrition" });
      const f = await db.one(`select * from product_facts where id = $1`, [r.result.fact_id]);
      expect(f).toMatchObject({ attribute: attr, source: "label", status: "declared", approved_by: AUTO, reviewed_at: null });
      expect(f.detail).toMatchObject({ confirmed_from: id, automatic: true });
      expect((await db.one(`select superseded_by from product_facts where id = $1`, [id])).superseded_by).toBe(f.id);
      expect(await db.rpc("try_auto_approve", { p_kind: "fact", p_proposal: id })).toMatchObject({ approved: false, reason: "checks_failed" });
    }
  });
});

describe("pictures and the spot check", () => {
  it("logs while the rule is off; a passing spot check switches it on; a failed one switches it off and withdraws the picture", async () => {
    const a = await picture();
    expect(await db.rpc("try_auto_approve", { p_kind: "picture", p_proposal: a })).toMatchObject({ approved: false, shadow: true });
    expect((await db.one(`select status from product_images where id = $1`, [a])).status).toBe("proposed");
    await db.pg.query(`update auto_approvals set created_at = now() - interval '1 day' where proposal_id = $1`, [a]);
    expect(await db.rpc("auto_approval_daily_sample", {})).toEqual([expect.objectContaining({ approvals: 1, sampled: 1 })]);
    expect(await db.rpc("auto_approval_daily_sample", {})).toEqual([]);                      // a day is sampled once
    const check = (await db.one(`select c.id from auto_approval_spot_checks c join auto_approvals x on x.id = c.approval_id where x.proposal_id = $1`, [a])).id;
    await expect(db.rpc("set_auto_approval_rule", { p_field: "picture", p_enabled: true, p_by: lead })).rejects.toThrow(/PASSING_SPOT_CHECK_NEEDED/);
    await expect(db.rpc("record_spot_check", { p_check: check, p_by: picker, p_verdict: "correct" })).rejects.toThrow(/NOT_AUTHORISED/);
    expect(await db.rpc("record_spot_check", { p_check: check, p_by: lead, p_verdict: "correct" })).toMatchObject({ status: "correct", rule: "switched_on" });
    expect((await db.one(`select enabled, first_passed_at is not null as passed from auto_approval_rules where field = 'picture'`))).toEqual({ enabled: true, passed: true });

    // On: the next run approves it, as a person would, and A5's single path makes it public.
    expect(await db.rpc("intake_try_auto", { p_product: pid })).toMatchObject({ "picture:approved": 1 });
    expect(await db.one(`select status, reviewed_by from product_images where id = $1`, [a])).toEqual({ status: "approved", reviewed_by: AUTO });
    expect((await db.all(`select image_id from catalog_public_expected() where product_id = $1`, [pid])).map((r) => r.image_id)).toEqual([a]);
    expect((await db.rpc("catalog_picture_work")).copy.map((x) => x.image_id)).toContain(a);

    // A failed spot check: the rule goes off, the picture is withdrawn, and only a later passing sample lets a person switch it on.
    await db.pg.query(`update auto_approvals set created_at = now() - interval '2 days' where proposal_id = $1 and applied`, [a]);
    await db.rpc("auto_approval_daily_sample", {});
    const c2 = (await db.one(`select c.id from auto_approval_spot_checks c join auto_approvals x on x.id = c.approval_id where x.proposal_id = $1 and x.applied`, [a])).id;
    await expect(db.rpc("record_spot_check", { p_check: c2, p_by: lead, p_verdict: "wrong" })).rejects.toThrow(/SPOT_CHECK_NOTE_REQUIRED/);
    expect(await db.rpc("record_spot_check", { p_check: c2, p_by: lead, p_verdict: "wrong", p_note: "a different jar size" }))
      .toMatchObject({ status: "wrong", rule: "off", undo: { undone: true, what: "picture_withdrawn" } });
    expect(await db.one(`select enabled, disabled_reason from auto_approval_rules where field = 'picture'`)).toMatchObject({ enabled: false, disabled_reason: expect.stringContaining("a different jar size") });
    expect((await db.one(`select status from product_images where id = $1`, [a])).status).toBe("rejected");
    expect(await db.all(`select image_id from catalog_public_expected() where product_id = $1`, [pid])).toEqual([]);
    await expect(db.rpc("set_auto_approval_rule", { p_field: "picture", p_enabled: true, p_by: lead })).rejects.toThrow(/PASSING_SPOT_CHECK_NEEDED/);
    const b = await picture();
    expect(await db.rpc("try_auto_approve", { p_kind: "picture", p_proposal: b })).toMatchObject({ approved: false, shadow: true });
  });

  it("a cannot_tell, a narrow picture, a public page, a search result or a barcode that is not the item's is never approved", async () => {
    await rules(true);
    const fail = async (over, vision, want) => {
      const id = await picture(over, vision);
      const r = await db.rpc("try_auto_approve", { p_kind: "picture", p_proposal: id });
      expect(r.approved).toBe(false);
      expect(r.failed).toEqual(expect.arrayContaining(want));
      await db.pg.query(`update product_images set status = 'superseded' where id = $1`, [id]);
    };
    await fail({}, { report: { ...GOOD, same_size: "cannot_tell" } }, ["same_size"]);
    await fail({}, { report: { ...GOOD, watermark_or_overlay_text: "yes" } }, ["no_watermark_or_text"]);
    await fail({}, { original_width: 640 }, ["at_least_800_px"]);
    await fail({}, { report: undefined }, ["same_brand", "plain_background"]);
    await fail({ source_kind: "public_page", licence: "public_page", source_url: "https://shop.example.com/a.jpg", page_url: "https://shop.example.com/a" }, { matched: { barcode: BARCODE } }, ["not_a_shop_page"]);
    await fail({ source_kind: "web_search", licence: "unknown", source_url: "https://x.example.com/a.jpg" }, {}, ["licence_customer_may_see"]);
    await fail({ source_url: "https://images.openfoodfacts.org/images/products/500/000/000/0000/1.jpg" }, {}, ["barcode_exact_match"]);
    await fail({ source_kind: "brand_site", licence: "brand_own", source_url: "https://www.nutella.com/a.jpg" }, {}, ["barcode_exact_match"]);
  });
});

describe("names and search words", () => {
  it("a name needs two sources for the barcode that agree on brand and size, and model-written Arabic waits for the reader's sample", async () => {
    await rules(true);
    const id = (await db.one(`insert into product_name_proposals(sku, current_name_en, current_brand, name_en, name_ar, size_en, size_ar, ar_source)
      values ('AK-0980', 'Nutella 350 g', 'Nutella', 'Nutella Hazelnut Spread', 'نوتيلا', '350 g', '٣٥٠ غ', 'model_written') returning id`)).id;
    let r = await db.rpc("try_auto_approve", { p_kind: "name", p_proposal: id });
    expect(r.failed).toEqual(["arabic_from_catalog_or_reader_passed"]);
    expect(await db.rpc("record_arabic_reader_sample", { p_by: lead, p_checked: 49, p_errors: 0 })).toMatchObject({ passed: false });
    expect(await db.rpc("record_arabic_reader_sample", { p_by: lead, p_checked: 60, p_errors: 1 })).toMatchObject({ passed: false });
    expect(await db.rpc("record_arabic_reader_sample", { p_by: lead, p_checked: 50, p_errors: 0 })).toMatchObject({ passed: true });
    // One source only (Open Food Facts gone): not enough.
    await db.pg.query(`update product_facts set detail = detail - 'off' where product_id = $1 and source = 'open_food_facts'`, [pid]);
    expect((await db.rpc("try_auto_approve", { p_kind: "name", p_proposal: id })).failed).toEqual(["two_independent_sources_agree"]);
    await db.pg.query(`update product_facts set detail = detail || '{"off": {"brands": "Nutella, Ferrero", "quantity": "350 g"}}' where product_id = $1 and source = 'open_food_facts'`, [pid]);
    r = await db.rpc("try_auto_approve", { p_kind: "name", p_proposal: id });
    expect(r).toMatchObject({ approved: true, result: { name_en: "Nutella Hazelnut Spread 350 g", previous_name_en: "Nutella 350 g" } });
    expect(await db.one(`select name_en, name_ar from products where id = $1`, [pid])).toEqual({ name_en: "Nutella Hazelnut Spread 350 g", name_ar: "نوتيلا ٣٥٠ غ" });
    expect(await db.one(`select status, decided_by from product_name_proposals where id = $1`, [id])).toEqual({ status: "approved", decided_by: AUTO });
    expect((await db.one(`select status from search_word_jobs where sku = 'AK-0980'`)).status).toBe("pending");   // 0076 queues the words again
  });

  it("search words pass only when built for the current name with nothing on the review list", async () => {
    expect(await db.rpc("try_auto_approve", { p_kind: "search_words", p_proposal: "AK-0042" })).toMatchObject({ approved: false, shadow: true });
    await db.pg.query(`insert into search_word_reviews(sku, phrasing) values ('AK-0042', 'zz no match')`);
    expect((await db.rpc("try_auto_approve", { p_kind: "search_words", p_proposal: "AK-0042" })).failed).toEqual(["nothing_on_the_review_list"]);
    expect((await db.rpc("try_auto_approve", { p_kind: "search_words", p_proposal: "AK-0980" })).failed).toEqual(expect.arrayContaining(["words_built"]));
  });

  it("the console overview lists the rules, the never-automatic fields and the waiting spot checks", async () => {
    const o = await db.rpc("auto_approvals_overview", {});
    expect(o.rules.map((r) => r.field)).toEqual(["picture", "name_size_category", "search_words", "ingredients_nutrition"]);
    expect(o.never_automatic).toEqual(["allergens", "diet labels", "price", "cost"]);
    expect(o.intake).toMatchObject({ items: 292 });
  });
});
