// LB1 (16 November 2026), the label day. Migration 0210: "directions as printed" and "warnings as printed" are core fields of every
// grocery template, read by the label reader, shown as printed text and never rewritten (invariant 14); warnings are approved by
// a person like hazard warnings. Migration 0211 (later describe blocks): the capture log, the reading queue, label beats web,
// the person's approval of field values, and the approval queue in one sitting's order.
// On the real migrations and seed, in PGlite. Invented data only.
import { beforeAll, describe, expect, it } from "vitest";
import { openTestDb, type TestDb } from "./harness";

let db: TestDb; let ops: string; let picker: string;
const AUTO = "00000000-0000-4000-8000-0000000000a1";
const party = async (role: string, name: string) => (await db.one(`insert into parties(role, display_name) values ($1, $2) returning id`, [role, name])).id as string;
const firstOf = async (category: string, n = 0) => (await db.one(`select id from products where category = $1 and is_active order by sku offset ${n} limit 1`, [category])).id as string;

beforeAll(async () => {
  db = await openTestDb();
  ops = await party("ops_lead", "Ops LB1");
  picker = await party("picker", "Picker LB1");
}, 120_000);

describe("0210: directions and warnings as printed", () => {
  it("are two core fields: stored as values, from the label photo, and every grocery template includes the core", async () => {
    const f = await db.all(`select key, type, store, required_for, approval, allowed_sources from template_fields where template_code = 'core' and key in ('directions_as_printed', 'warnings_as_printed') order by key`);
    expect(f).toEqual([
      { key: "directions_as_printed", type: "text", store: "values", required_for: null, approval: "automatic", allowed_sources: ["label_photo"] },
      { key: "warnings_as_printed", type: "list", store: "values", required_for: null, approval: "person", allowed_sources: ["label_photo"] },
    ]);
    // every template that includes the core has them; a vendor dish has no printed pack and no core
    const t = await db.all(`select code from product_templates where includes_core and not future order by code`);
    expect(t.length).toBe(10);
    expect(await db.one(`select includes_core from product_templates where code = 'vendor_dish'`)).toEqual({ includes_core: false });
  });

  it("not having them changes no readiness: nothing that was sellable or fact-complete stops being so", async () => {
    expect(await db.one(`select count(*)::int as n from template_fields where key in ('directions_as_printed', 'warnings_as_printed') and required_for is not null`)).toEqual({ n: 0 });
    expect(await db.one(`select count(*)::int as n from products where is_active`)).toEqual({ n: 291 });
    expect(await db.all(`select sku from products where is_active and not (product_template_status(id)->>'sellable')::boolean limit 1`)).toBeDefined();
  });

  it("a label reading proposes them for a food, a cleaning and a water item, as printed, and for no other kind of text", async () => {
    for (const category of ["Snacks & Candy", "Cleaning & Household", "Water"]) {
      const p = await firstOf(category);
      const r = await db.rpc("record_label_scan", { p_product: p, p_photos: [`media/labels/${p}/back.jpg`], p_model: "test", p_by: picker, p_reading: {
        barcode: null, fields: { directions_as_printed: "Shake well. Store in a cool dry place.", warnings_as_printed: ["Contains caffeine.", "Not recommended for children."] } } });
      expect(Object.keys(r.fields).sort()).toEqual(["directions_as_printed", "warnings_as_printed"]);
      const rows = await db.all(`select field_key, value, source, status from product_field_values where product_id = $1 order by field_key`, [p]);
      expect(rows).toEqual([
        { field_key: "directions_as_printed", value: "Shake well. Store in a cool dry place.", source: "label_photo", status: "proposed" },
        { field_key: "warnings_as_printed", value: ["Contains caffeine.", "Not recommended for children."], source: "label_photo", status: "proposed" },
      ]);
    }
  });

  it("a vendor dish has no such field: a reading of it drops them, never keeps them", async () => {
    expect(await db.one(`select count(*)::int as n from template_fields where template_code = 'vendor_dish' and key in ('directions_as_printed', 'warnings_as_printed')`)).toEqual({ n: 0 });
  });

  it("a person approves warnings: the automatic party cannot, whatever writes the row; directions can wait for a rule", async () => {
    const p = await firstOf("Snacks & Candy", 1);
    await db.rpc("record_label_scan", { p_product: p, p_photos: ["media/labels/x/back.jpg"], p_model: "test", p_by: picker, p_reading: { fields: {
      directions_as_printed: "Keep refrigerated after opening.", warnings_as_printed: ["May contain traces of nuts."] } } });
    const w = (await db.one(`select id from product_field_values where product_id = $1 and field_key = 'warnings_as_printed'`, [p])).id;
    const d = (await db.one(`select id from product_field_values where product_id = $1 and field_key = 'directions_as_printed'`, [p])).id;
    await expect(db.pg.query(`update product_field_values set status = 'approved', approved_by = $2 where id = $1`, [w, AUTO])).rejects.toThrow(/NEVER_AUTOMATIC/);
    await db.pg.query(`update product_field_values set status = 'approved', approved_by = $2, approved_at = now() where id = $1`, [w, ops]);
    expect(await db.one(`select status, expires_at is not null as dated from product_field_values where id = $1`, [w])).toEqual({ status: "approved", dated: true });
    // the label reading is never picked up by the rule that approves what rules proposed
    expect(await db.rpc("try_auto_approve", { p_kind: "field", p_proposal: d })).toMatchObject({ approved: false, failed: expect.arrayContaining(["proposed_by_a_rule"]) });
  });

  it("product_printed_text shows only approved, current text, exactly as printed, with where it came from; a proposal is not shown", async () => {
    const p = await firstOf("Cleaning & Household", 1);
    await db.rpc("record_label_scan", { p_product: p, p_photos: ["media/labels/y/back.jpg"], p_model: "test", p_by: picker, p_reading: { fields: {
      directions_as_printed: "Dilute 1:10 with water.", warnings_as_printed: ["Do not mix with bleach."], hazard_warnings: ["Causes serious eye irritation"] } } });
    expect(await db.rpc("product_printed_text", { p_product: p })).toEqual({ as_printed: true, directions: null, warnings: null, hazard_warnings: null });
    for (const k of ["directions_as_printed", "warnings_as_printed", "hazard_warnings"]) {
      await db.pg.query(`update product_field_values set status = 'approved', approved_by = $3, approved_at = now() where product_id = $1 and field_key = $2`, [p, k, ops]);
    }
    const t = await db.rpc("product_printed_text", { p_product: p });
    expect(t).toMatchObject({ as_printed: true, directions: { text: "Dilute 1:10 with water.", source: "label_photo" },
      warnings: { lines: ["Do not mix with bleach."], source: "label_photo" }, hazard_warnings: { lines: ["Causes serious eye irritation"], source: "label_photo" } });
    // twelve months on, the text is not shown: it is read again from a photo first
    await db.pg.query(`update product_field_values set expires_at = now() - interval '1 day' where product_id = $1 and field_key = 'directions_as_printed'`, [p]);
    expect((await db.rpc("product_printed_text", { p_product: p })).directions).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// 0211
const path = (p: string, shot: string, n = 1) => `labels/${p}/${shot}-${n}.jpg`;
const capture = (p: string, shot: string, by = picker, n = 1) => db.rpc("record_label_capture", { p_product: p, p_shot: shot, p_media_path: path(p, shot, n), p_by: by });
const bothShots = async (p: string) => { await capture(p, "front"); await capture(p, "back"); };
const scan = (p: string, reading: Record<string, unknown>, by = picker) =>
  db.rpc("record_label_scan", { p_product: p, p_photos: [path(p, "front"), path(p, "back")], p_model: "test", p_by: by, p_reading: reading });
const withBarcode = async (n = 0) => (await db.one(`select id, barcode from products where is_active and intake_barcode_key(barcode) is not null order by sku offset ${n} limit 1`));

describe("0211: the monthly ceiling of the simulated customers is a setting", () => {
  it("sim_monthly_cap_usd is 60 for November 2026 and 20 a month after", async () => {
    expect((await db.one(`select value from settings where key = 'sim_monthly_cap_usd'`)).value).toEqual({ default_usd: 20, months: { "2026-11": 60 } });
  });
});

describe("0211: the capture log (the label day's phone page)", () => {
  it("only a picker, an ops lead or an admin records a photo; the path must be the item's own; the shot is front, back or side", async () => {
    const p = await firstOf("Snacks & Candy", 2);
    const customer = await party("customer", "Customer LB1");
    const blocked = (await db.one(`insert into parties(role, display_name, is_blocked) values ('picker', 'Blocked LB1', true) returning id`)).id as string;
    await expect(capture(p, "front", customer)).rejects.toThrow(/NOT_AUTHORISED/);
    await expect(capture(p, "front", blocked)).rejects.toThrow(/NOT_AUTHORISED/);
    await expect(db.rpc("record_label_capture", { p_product: p, p_shot: "front", p_media_path: "labels/other-item/front-1.jpg", p_by: picker })).rejects.toThrow(/CAPTURE_PATH/);
    await expect(db.rpc("record_label_capture", { p_product: p, p_shot: "top", p_media_path: path(p, "top"), p_by: picker })).rejects.toThrow(/CAPTURE_SHOT/);
    await expect(db.rpc("record_label_capture", { p_product: "00000000-0000-4000-8000-000000000001", p_shot: "front", p_media_path: "labels/00000000-0000-4000-8000-000000000001/x.jpg", p_by: picker })).rejects.toThrow(/PRODUCT_NOT_FOUND/);
    expect(await capture(p, "front")).toMatchObject({ ok: true, shot: "front", done: false });
    expect(await capture(p, "back", ops)).toMatchObject({ ok: true, shot: "back", done: true });
  });

  it("a photo sent again (a retry after a failed upload) is one record; a retake replaces the shot and keeps the old one", async () => {
    const p = await firstOf("Snacks & Candy", 3);
    const a = await capture(p, "front"); const b = await capture(p, "front");
    expect(b).toMatchObject({ ok: true, already: true, capture_id: a.capture_id });
    expect(await db.one(`select count(*)::int as n from label_captures where product_id = $1`, [p])).toEqual({ n: 1 });
    await capture(p, "front", picker, 2);
    expect(await db.all(`select media_path, superseded_at is not null as old from label_captures where product_id = $1 order by captured_at, media_path`, [p]))
      .toEqual([{ media_path: path(p, "front", 1), old: true }, { media_path: path(p, "front", 2), old: false }]);
    // a retry of the first photo after the retake does not bring it back
    expect(await capture(p, "front", picker, 1)).toMatchObject({ already: true });
    expect(await db.one(`select count(*)::int as n from label_captures where product_id = $1 and superseded_at is null`, [p])).toEqual({ n: 1 });
  });

  it("done means front and back; the side photo is optional and does not complete an item", async () => {
    const p = await firstOf("Snacks & Candy", 4);
    await capture(p, "side"); await capture(p, "front");
    expect((await db.rpc("label_capture_find", { p_code: (await db.one(`select sku from products where id = $1`, [p])).sku })).shots).toEqual({ front: true, back: false, side: true, done: false });
    await capture(p, "back");
    expect((await db.rpc("label_capture_find", { p_code: (await db.one(`select sku from products where id = $1`, [p])).sku })).shots).toEqual({ front: true, back: true, side: true, done: true });
  });

  it("counts items done and left, by aisle; the aisles add up to the whole", async () => {
    const before = await db.rpc("label_capture_progress");
    expect(before.total).toBe(291);
    expect(before.done + before.left).toBe(before.total);
    expect(before.by_aisle.reduce((a: number, x: any) => a + x.total, 0)).toBe(before.total);
    expect(before.by_aisle.every((x: any) => x.done + x.left === x.total)).toBe(true);
    const p = await firstOf("Water", 0);
    await bothShots(p);
    const after = await db.rpc("label_capture_progress");
    expect(after.done).toBe(before.done + 1);
    const aisle = (await db.rpc("label_capture_find", { p_code: (await db.one(`select sku from products where id = $1`, [p])).sku })).aisle;
    expect(after.by_aisle.find((x: any) => x.aisle === aisle).done).toBe(before.by_aisle.find((x: any) => x.aisle === aisle).done + 1);
    // a vendor's dish and an inactive item are not counted
    expect(after.total).toBe(291);
  });

  it("finds an item by SKU or by its barcode in any written form; the next item is the next one not done, in shelf order, after the one just done", async () => {
    const it0 = await withBarcode(5);
    const sku = (await db.one(`select sku from products where id = $1`, [it0.id])).sku;
    expect((await db.rpc("label_capture_find", { p_code: sku })).product_id).toBe(it0.id);
    expect((await db.rpc("label_capture_find", { p_code: it0.barcode })).product_id).toBe(it0.id);
    expect((await db.rpc("label_capture_find", { p_code: `0${it0.barcode}` })).product_id).toBe(it0.id);                   // a scanner may add a leading zero
    expect((await db.rpc("label_capture_find", { p_code: it0.barcode.replace(/(\d{3})/, "$1 ") })).product_id).toBe(it0.id);
    expect(await db.rpc("label_capture_find", { p_code: "99999999999999" })).toBeNull();
    expect(await db.rpc("label_capture_find", { p_code: "12" })).toBeNull();
    const n1 = await db.rpc("label_capture_next", { p_after: null });
    expect(n1.shots.done).toBe(false);
    await bothShots(n1.product_id);
    const n2 = await db.rpc("label_capture_next", { p_after: n1.product_id });
    expect(n2.product_id).not.toBe(n1.product_id);
    expect(n2.shots.done).toBe(false);
    // the same shelf order for everyone: asking again gives the same item
    expect((await db.rpc("label_capture_next", { p_after: n1.product_id })).product_id).toBe(n2.product_id);
  });

  it("the next item wraps to the start of the shelf, and says so when every item is done", async () => {
    const left = await db.rpc("label_capture_progress");
    expect(left.left).toBeGreaterThan(0);
    const all = await db.all(`select id from products where is_active and owner_source_id is null`);
    for (const x of all) await bothShots(x.id);
    expect(await db.rpc("label_capture_next", { p_after: null })).toBeNull();
    const done = await db.rpc("label_capture_progress");
    expect(done).toMatchObject({ total: 291, done: 291, left: 0 });
    await db.pg.query(`delete from label_captures`);        // start over for the later tests
  });

  it("the list for the items that cannot be scanned: the 34 with no barcode and the 29 that carry only the store's own code (63)", async () => {
    const none = await db.rpc("label_capture_items", { p_only_missing: true, p_no_barcode: true });
    const expected = (await db.one(`select count(*)::int as n from products where is_active and owner_source_id is null and intake_barcode_key(barcode) is null`)).n;
    expect(none.length).toBe(expected);
    expect(expected).toBe(63);
    expect((await db.one(`select count(*)::int as n from products where is_active and owner_source_id is null and btrim(coalesce(barcode, '')) = ''`)).n).toBe(34);
    expect(none.every((x: any) => x.has_barcode === false)).toBe(true);
    expect(none[0]).toEqual(expect.objectContaining({ product_id: expect.any(String), sku: expect.any(String), name_en: expect.any(String), aisle: expect.any(String), done: false }));
    const p = none[0].product_id;
    await bothShots(p);
    expect((await db.rpc("label_capture_items", { p_only_missing: true, p_no_barcode: true })).length).toBe(expected - 1);
    expect((await db.rpc("label_capture_items", { p_only_missing: false, p_no_barcode: true })).length).toBe(expected);
    await db.pg.query(`delete from label_captures`);
  });
});

describe("0211: the reading queue, label beats web, and what the run settles", () => {
  it("an item is waiting to be read when front and back are in and no reading is newer; its photos come in order front, back, side", async () => {
    await db.pg.query(`delete from label_scans`);
    const p = await firstOf("Dairy & Eggs", 0);
    await capture(p, "back"); await capture(p, "side");
    expect((await db.rpc("label_reading_queue")).map((x: any) => x.product_id)).not.toContain(p);             // no front yet
    await capture(p, "front");
    const q = (await db.rpc("label_reading_queue")).find((x: any) => x.product_id === p);
    expect(q).toMatchObject({ template: "packaged_food", is_food: true, photos: [path(p, "front"), path(p, "back"), path(p, "side")] });
    await scan(p, { fields: { directions_as_printed: "Keep refrigerated." } });
    expect((await db.rpc("label_reading_queue")).map((x: any) => x.product_id)).not.toContain(p);
    await capture(p, "back", picker, 2);                                                                      // a retake: read again
    expect((await db.rpc("label_reading_queue")).find((x: any) => x.product_id === p).photos).toEqual([path(p, "front"), path(p, "back", 2), path(p, "side")]);
  });

  it("a reading that failed (no reading) keeps the item in the queue", async () => {
    const p = await firstOf("Dairy & Eggs", 1);
    await bothShots(p);
    await db.rpc("record_label_scan", { p_product: p, p_photos: [path(p, "front"), path(p, "back")], p_model: null, p_by: picker, p_reading: null });
    expect((await db.rpc("label_reading_queue")).map((x: any) => x.product_id)).toContain(p);
  });

  it("label beats web: a web or Open Food Facts proposal for a field the label read is set aside; where it disagreed the label's proposal says so", async () => {
    const p = (await withBarcode(8)).id as string;
    await bothShots(p);
    await db.rpc("propose_off_facts", { p_product: p, p_run: "run-lb1", p_facts: [
      { attribute: "milk", value: "may_contain", detail: { source_text: "may contain milk", quote: "may contain milk", off_code: "1", fingerprint: "a" } },
      { attribute: "ingredients", value: null, detail: { source_text: "water, sugar", text: "water, sugar", lang: "en", off_code: "1", fingerprint: "b" } },
      { attribute: "sesame", value: "contains", detail: { source_text: "sesame", quote: "sesame", off_code: "1", fingerprint: "c" } } ] });
    await db.pg.query(`insert into product_field_values(product_id, field_key, value, source) values ($1, 'directions_as_printed', '"From the brand page"', 'brand_site')`, [p]);
    await scan(p, { barcode: null, facts: [
      { attribute: "milk", value: "contains", quote: "Contains milk" },
      { attribute: "ingredients", text: "water, sugar, milk powder", lang: "en" }],
      fields: { directions_as_printed: "Serve cold." } });
    const r = await db.rpc("label_reading_settle", { p_product: p });
    expect(r).toMatchObject({ facts_set_aside: 2, fields_set_aside: 1 });
    const left = await db.all(`select attribute, source from product_facts where product_id = $1 and approved_at is null and superseded_at is null order by attribute, source`, [p]);
    expect(left).toEqual([{ attribute: "ingredients", source: "label" }, { attribute: "milk", source: "label" }, { attribute: "sesame", source: "open_food_facts" }]);   // sesame: the label said nothing
    const milk = (await db.one(`select detail from product_facts where product_id = $1 and attribute = 'milk' and source = 'label' and superseded_at is null`, [p])).detail;
    expect(milk.disagrees_with).toEqual([expect.objectContaining({ source: "open_food_facts", value: "may_contain" })]);
    expect((await db.one(`select detail from product_facts where product_id = $1 and attribute = 'ingredients' and source = 'label' and superseded_at is null`, [p])).detail.disagrees_with).toHaveLength(1);
    expect(await db.all(`select source, status from product_field_values where product_id = $1 and field_key = 'directions_as_printed' order by source`, [p]))
      .toEqual([{ source: "brand_site", status: "superseded" }, { source: "label_photo", status: "proposed" }]);
    // settling twice changes nothing
    expect(await db.rpc("label_reading_settle", { p_product: p })).toMatchObject({ facts_set_aside: 0, fields_set_aside: 0 });
  });

  it("the rules still approve what they may: a label and a second source that agree are approved before the web proposal is set aside", async () => {
    const it0 = await withBarcode(9);
    const p = it0.id as string;
    await db.pg.query(`update auto_approval_rules set enabled = true where field = 'ingredients_nutrition'`);
    await bothShots(p);
    await db.rpc("propose_off_facts", { p_product: p, p_run: "run-lb1b", p_facts: [
      { attribute: "ingredients", value: null, detail: { source_text: "flour, water, salt", text: "flour, water, salt", lang: "en", off_code: it0.barcode, fingerprint: "d" } } ] });
    await scan(p, { barcode: it0.barcode, facts: [{ attribute: "ingredients", text: "Flour, water, salt", lang: "en" }] });
    const r = await db.rpc("label_reading_settle", { p_product: p });
    expect(r.auto["fact:approved"]).toBe(1);
    const cur = await db.one(`select approved_by, source from product_facts where product_id = $1 and attribute = 'ingredients' and approved_at is not null and superseded_at is null`, [p]);
    expect(cur).toEqual({ approved_by: AUTO, source: "label" });
    expect(await db.one(`select count(*)::int as n from product_facts where product_id = $1 and approved_at is null and superseded_at is null`, [p])).toEqual({ n: 0 });
  });

  it("allergens, halal and warnings read from the label are never approved by a rule, whatever the settle does", async () => {
    const p = (await withBarcode(10)).id as string;
    await bothShots(p);
    await scan(p, { facts: [{ attribute: "milk", value: "free", quote: "Milk free" }, { attribute: "halal", value: "yes", quote: "Halal" }], fields: { warnings_as_printed: ["Contains caffeine."] } });
    const r = await db.rpc("label_reading_settle", { p_product: p });
    expect(r.auto["fact:approved"] ?? 0).toBe(0);
    expect((await db.one(`select count(*)::int as n from product_facts where product_id = $1 and approved_at is not null and superseded_at is null`, [p])).n).toBe(0);
    expect((await db.one(`select count(*)::int as n from product_field_values where product_id = $1 and status = 'approved'`, [p])).n).toBe(0);
  });
});

describe("0211: the party that records the reading run's proposals", () => {
  it("can propose a reading and nothing else: it cannot confirm, and no one can sign in as it", async () => {
    const reader = await db.rpc("label_reader_party");
    const p = await firstOf("Snacks & Candy", 25);
    await db.rpc("record_label_capture", { p_product: p, p_shot: "front", p_media_path: path(p, "front", 9), p_by: reader });
    await db.rpc("record_label_scan", { p_product: p, p_photos: [path(p, "front", 9)], p_model: "test", p_by: reader, p_reading: { facts: [{ attribute: "milk", value: "contains", quote: "Contains milk" }] } });
    const f = (await db.one(`select id from product_facts where product_id = $1 and attribute = 'milk' and approved_at is null and superseded_at is null`, [p])).id;
    await expect(db.rpc("review_proposed_fact", { p_fact: f, p_by: reader, p_decision: "confirm" })).rejects.toThrow(/NOT_AUTHORISED/);
    expect(await db.one(`select role::text as role, is_blocked from parties where id = $1`, [reader])).toEqual({ role: "picker", is_blocked: false });
  });
});

describe("0211: a person approves field values, claims and certificates", () => {
  const field = async (p: string, key: string, value: unknown, source = "label_photo") =>
    (await db.one(`insert into product_field_values(product_id, field_key, value, source) values ($1, $2, $3::jsonb, $4) returning id`, [p, key, JSON.stringify(value), source])).id as string;

  it("an ops lead or an admin confirms as printed, or corrects, or rejects; nobody else, and not twice", async () => {
    const p = await firstOf("Cleaning & Household", 2);
    const a = await field(p, "hazard_warnings", ["Causes eye irritation"]);
    await expect(db.rpc("review_field_value", { p_value: a, p_by: picker, p_decision: "confirm" })).rejects.toThrow(/NOT_AUTHORISED/);
    await expect(db.rpc("review_field_value", { p_value: a, p_by: AUTO, p_decision: "confirm" })).rejects.toThrow(/NOT_AUTHORISED/);
    await expect(db.rpc("review_field_value", { p_value: a, p_by: ops, p_decision: "maybe" })).rejects.toThrow(/UNKNOWN_DECISION/);
    const r = await db.rpc("review_field_value", { p_value: a, p_by: ops, p_decision: "confirm", p_corrected: { value: ["Causes serious eye irritation"] } });
    expect(r).toMatchObject({ ok: true, decision: "confirm", corrected: true });
    expect(await db.one(`select status, approved_by, value, detail->>'corrected_by_person' as c from product_field_values where id = $1`, [a])).toEqual({ status: "approved", approved_by: ops, value: ["Causes serious eye irritation"], c: "true" });
    await expect(db.rpc("review_field_value", { p_value: a, p_by: ops, p_decision: "confirm" })).rejects.toThrow(/NOT_PENDING/);
    // a newer approval replaces the current one
    const b = await field(p, "hazard_warnings", ["Harmful if swallowed"]);
    await db.rpc("review_field_value", { p_value: b, p_by: ops, p_decision: "confirm" });
    expect(await db.all(`select status from product_field_values where product_id = $1 and field_key = 'hazard_warnings' order by proposed_at, id`, [p])).toEqual(expect.arrayContaining([{ status: "approved" }, { status: "superseded" }]));
    expect(await db.one(`select count(*)::int as n from product_field_values where product_id = $1 and field_key = 'hazard_warnings' and status = 'approved'`, [p])).toEqual({ n: 1 });
    const c = await field(p, "scent", "Lemon");
    await db.rpc("review_field_value", { p_value: c, p_by: ops, p_decision: "reject", p_note: "not on the pack" });
    expect(await db.one(`select status, detail->>'review_note' as n from product_field_values where id = $1`, [c])).toEqual({ status: "rejected", n: "not on the pack" });
  });

  it("confirming a value sets the other open readings of the same field aside; a claim and a certificate have their own review", async () => {
    const p = await firstOf("Beauty & Personal Care", 0);
    const a = await field(p, "age_group", "kids");
    const b = await field(p, "age_group", "adult", "brand_site");
    await db.rpc("review_field_value", { p_value: a, p_by: ops, p_decision: "confirm" });
    expect((await db.one(`select status from product_field_values where id = $1`, [b])).status).toBe("superseded");
    const cl = (await db.one(`insert into product_claims(product_id, claim_code, quote, source) values ($1, 'fragrance_free', 'Fragrance free', 'label_photo') returning id`, [p])).id;
    await expect(db.rpc("review_claim", { p_claim: cl, p_by: picker, p_decision: "confirm" })).rejects.toThrow(/NOT_AUTHORISED/);
    await db.rpc("review_claim", { p_claim: cl, p_by: ops, p_decision: "confirm" });
    expect(await db.one(`select status, approved_by from product_claims where id = $1`, [cl])).toEqual({ status: "approved", approved_by: ops });
    const ev = (await db.one(`insert into evidence_documents(kind, product_id, media_path) values ('certificate', $1, 'media/evidence/cert.jpg') returning id`, [p])).id;
    const ce = (await db.one(`insert into product_certificates(product_id, kind, evidence_id) values ($1, 'organic', $2) returning id`, [p, ev])).id;
    await db.rpc("review_certificate", { p_certificate: ce, p_by: ops, p_decision: "confirm" });
    expect(await db.one(`select status, approved_by from product_certificates where id = $1`, [ce])).toEqual({ status: "approved", approved_by: ops });
  });
});

describe("0211: the approval queue, in the order of one sitting", () => {
  it("allergens, then halal and certificates, then hazard and printed warnings, then disagreements, then the rest; pure web proposals are not in it", async () => {
    await db.pg.query(`update product_facts set superseded_at = now() where approved_at is null and superseded_at is null`);
    await db.pg.query(`delete from product_field_values where status = 'proposed'`);
    await db.pg.query(`delete from product_claims where status = 'proposed'`);
    await db.pg.query(`delete from product_certificates where status = 'proposed'`);
    const A = await firstOf("Snacks & Candy", 10), B = await firstOf("Snacks & Candy", 11), C = await firstOf("Cleaning & Household", 3), D = await firstOf("Snacks & Candy", 12),
          E = await firstOf("Snacks & Candy", 13), F = await firstOf("Snacks & Candy", 14), G = await firstOf("Snacks & Candy", 15);
    for (const x of [A, B, C, D, E, F, G]) await bothShots(x);
    // the rest first, so that the order is the queue's and not the order they were written in
    await scan(E, { facts: [{ attribute: "nutrition", values: { energy_kcal: 100, fat: 1, carbohydrates: 10, proteins: 5 } }], fields: { directions_as_printed: "Serve cold." },
                    claims: [{ code: "high_protein", value: null, quote: "High protein" }] });
    await db.rpc("propose_off_facts", { p_product: D, p_run: "run-q", p_facts: [{ attribute: "ingredients", value: null, detail: { source_text: "water", text: "water", lang: "en", off_code: "1", fingerprint: "q1" } }] });
    await scan(D, { facts: [{ attribute: "ingredients", text: "water, sugar", lang: "en" }] });
    await db.rpc("label_reading_settle", { p_product: D });
    await scan(C, { fields: { hazard_warnings: ["Causes serious eye irritation"] } });
    await scan(G, { fields: { warnings_as_printed: ["Contains caffeine."] } });
    const ev = (await db.one(`insert into evidence_documents(kind, product_id, media_path) values ('certificate', $1, 'media/evidence/halal.jpg') returning id`, [B])).id;
    await db.pg.query(`insert into product_certificates(product_id, kind, evidence_id) values ($1, 'halal', $2)`, [B, ev]);
    await scan(B, { facts: [{ attribute: "halal", value: "yes", quote: "Halal" }] });
    await scan(A, { facts: [{ attribute: "milk", value: "contains", quote: "Contains milk" }, { attribute: "eggs", value: "free", quote: "Egg free" }] });
    await db.rpc("propose_off_facts", { p_product: F, p_run: "run-q2", p_facts: [{ attribute: "peanuts", value: "contains", detail: { source_text: "peanuts", quote: "peanuts", off_code: "1", fingerprint: "q2" } }] });
    const q = await db.rpc("approval_queue");
    const groups = q.map((x: any) => x.group);
    expect(groups).toEqual([...groups].sort((a: number, b: number) => a - b));
    const names = (g: number) => q.filter((x: any) => x.group === g).map((x: any) => `${x.kind}:${x.label}`).sort();
    expect(names(1)).toEqual(["fact:eggs", "fact:milk"]);
    expect(names(2)).toEqual(["certificate:halal", "fact:halal"]);
    expect(names(3)).toEqual(["field:hazard_warnings", "field:warnings_as_printed"]);
    expect(names(4)).toEqual(["fact:ingredients"]);
    expect(names(5)).toEqual(["claim:high_protein", "fact:nutrition", "field:directions_as_printed"]);
    expect(q.find((x: any) => x.label === "peanuts")).toBeUndefined();                                          // the web alone is not a person's work
    expect(q.find((x: any) => x.group === 4).disagrees).toEqual([expect.objectContaining({ source: "open_food_facts" })]);
    expect(q[0]).toEqual(expect.objectContaining({ group_name: expect.any(String), product_id: A, sku: expect.any(String), name_en: expect.any(String), aisle: expect.any(String),
      id: expect.any(String), value_text: expect.any(String), photos: expect.objectContaining({ front: path(A, "front"), back: path(A, "back") }) }));
    expect(q.find((x: any) => x.label === "milk")).toMatchObject({ value_text: "contains", quote: "Contains milk" });
    expect(q.find((x: any) => x.label === "warnings_as_printed").value_text).toBe("Contains caffeine.");
    // deciding takes a row out of the queue
    await db.rpc("review_field_value", { p_value: q.find((x: any) => x.label === "hazard_warnings").id, p_by: ops, p_decision: "confirm" });
    expect((await db.rpc("approval_queue")).length).toBe(q.length - 1);
  });
});

describe("0211: the report of the label day", () => {
  it("counts the items photographed, read and fact-complete per template, and says why each other item is not fact-complete", async () => {
    await db.pg.query(`delete from label_captures`); await db.pg.query(`delete from label_scans`);
    const a = await firstOf("Snacks & Candy", 20), b = await firstOf("Cleaning & Household", 5), c = await firstOf("Water", 1);
    for (const x of [a, b, c]) await bothShots(x);
    await scan(a, { facts: [{ attribute: "milk", value: "free", quote: "Milk free" }], fields: { directions_as_printed: "Serve cold." } });
    await db.rpc("record_label_scan", { p_product: b, p_photos: [path(b, "front"), path(b, "back")], p_model: null, p_by: picker, p_reading: null });
    const rep = await db.rpc("label_day_report");
    expect(rep.items).toBe(291);
    expect(rep.photographed + rep.not_photographed).toBe(291);
    expect(rep.photographed).toBe(3);
    expect(rep.read).toBe(1);
    const why = (sku: string) => rep.not_fact_complete.find((x: any) => x.sku === sku);
    const skuOf = async (x: string) => (await db.one(`select sku from products where id = $1`, [x])).sku;
    expect(why(await skuOf(a))).toMatchObject({ reason_code: "waiting_for_a_person" });
    expect(why(await skuOf(a)).reason).toMatch(/waiting for a person: .*allergens/);
    expect(why(await skuOf(b))).toMatchObject({ reason_code: "reading_failed" });
    expect(why(await skuOf(c))).toMatchObject({ reason_code: "photos_not_read" });
    expect(why((await db.one(`select sku from products where is_active and sku not in ($1, $2, $3) order by sku limit 1`, [await skuOf(a), await skuOf(b), await skuOf(c)])).sku)).toMatchObject({ reason_code: "not_photographed" });
    expect(rep.per_template.find((t: any) => t.template === "packaged_food")).toEqual(expect.objectContaining({ items: 188, photographed: expect.any(Number), read: expect.any(Number),
      fields_filled: expect.any(Number), sellable: expect.any(Number), fact_complete: expect.any(Number) }));
    expect(rep.per_template.reduce((a: number, t: any) => a + t.items, 0)).toBe(291);
    const reasons = new Set(rep.not_fact_complete.map((x: any) => x.reason_code));
    expect([...reasons].every((r) => ["not_photographed", "photos_not_read", "reading_failed", "waiting_for_a_person", "sellable_data_missing", "not_on_the_label_read"].includes(r as string))).toBe(true);
    expect(rep.not_fact_complete.length + rep.fact_complete).toBe(291);
    expect(rep.not_fact_complete[0]).toEqual(expect.objectContaining({ sku: expect.any(String), name_en: expect.any(String), template: expect.any(String), reason: expect.any(String), missing: expect.any(Array) }));
  });
});
