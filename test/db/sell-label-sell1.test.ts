// SELL1 (17 November 2026), migration 0226: nothing packaged sells before its label (docs/DECISIONS.md, "Founder decision, 17 November 2026").
//   1  "packaged" per item: true for the packaged-food, baby-food, water, cleaning, beauty, baby and pet templates, and for a bakery or meat
//      item with a real barcode; false for loose produce, meat and bakery (no real barcode) and a restaurant dish
//   2  the setting sell_requires_label (off): when on, a packaged item that is not fact-complete FROM A LABEL READING cannot be quoted, added
//      to a card, returned by search as orderable, shown on the website or in the WhatsApp catalogue as orderable; loose items are unaffected
//   3  readiness_summary(): per template, packaged items label-ready out of total, and the list of those not ready with what is missing
// On the real migrations and seed, in PGlite. Invented data only. Every behaviour is tested with the setting on AND off.
import { beforeAll, describe, expect, it } from "vitest";
import { asSupabase, openTestDb, type TestDb } from "./harness";
import { makeFactComplete } from "./fact-kit";

let db: TestDb; let ops: string; let village: string;
const AUTO = "00000000-0000-4000-8000-0000000000a1";
const setGate = (on: boolean) => db.pg.query(`update settings set value = $1::jsonb where key = 'sell_requires_label'`, [JSON.stringify({ enabled: on })]);
const first = async (category: string, nth = 0) => db.one(`select id, sku, name_en, category from products where category = $1 and is_active order by sku offset $2 limit 1`, [category, nth]);

/** A valid EAN-13 from twelve digits (the check digit added), so a test never depends on a real product's number. */
const ean = (twelve: string) => { const s = [...twelve].reduce((a, d, i) => a + Number(d) * (i % 2 ? 3 : 1), 0); return twelve + String((10 - (s % 10)) % 10); };

const fieldValue = (product: string, key: string, v: unknown, source = "label_photo", by = ops) =>
  db.pg.query(`insert into product_field_values(product_id, field_key, value, source, status, proposed_by, approved_by, approved_at, reviewed_at)
               values ($1, $2, $3::jsonb, $4, 'approved', $5, $5, now(), now())`, [product, key, JSON.stringify(v), source, by]);
/** Makes a packaged item label-ready the way the label day does it: every record the template needs, read from the label, approved by a person. */
async function labelReady(p: { id: string; category: string }) {
  await db.pg.query(`update products set name_ar = coalesce(name_ar, 'منتج تجربة') where id = $1`, [p.id]);
  const t = (await db.one(`select product_template($1) as t`, [p.id])).t as string;
  if (t === "packaged_food" || t === "baby_food") await makeFactComplete(db, p.id, ops);
  if (t === "baby_food") await fieldValue(p.id, "age_range", { from: 6, to: 12 });
  if (t === "water") { await fieldValue(p.id, "volume_ml", 1500); await fieldValue(p.id, "water_type", "mineral"); }
  if (t === "cleaning_household") await fieldValue(p.id, "hazard_warnings", ["none printed"]);
  if (t === "beauty_personal_care") { await fieldValue(p.id, "inci_ingredients", "Aqua, Glycerin"); await fieldValue(p.id, "age_group", "adult"); }
  if (t === "baby_child") await fieldValue(p.id, "age_range", { from: 0, to: 24 });
  if (t === "pet") { await fieldValue(p.id, "species", "cat"); await fieldValue(p.id, "life_stage", "adult"); }
}
const quote = (lines: { product_id: string; qty: number }[]) => db.rpc("quote_order", { p_lines: lines, p_village: null, p_pickup: true });
const codes = (q: any) => (q.issues as any[]).map((i) => i.code);

beforeAll(async () => {
  db = await openTestDb();
  await db.pg.exec(`insert into fx_rates(lbp_per_usd) values (89500);
    update settings set value = '{"open":"00:00","close":"23:59:59","tz":"Asia/Beirut"}' where key = 'hours';
    update stock_levels set on_hand = 50, reserved = 0;`);
  ops = (await db.one(`insert into parties(role, display_name) values ('ops_lead', 'Ops SELL1') returning id`)).id;
  village = (await db.one(`select id from villages where name_en = 'Baakline'`)).id;
}, 120_000);

describe("1. packaged, per item", () => {
  it.each([
    ["Snacks & Candy", "packaged_food"], ["Water", "water"], ["Cleaning & Household", "cleaning_household"],
    ["Beauty & Personal Care", "beauty_personal_care"], ["Baby & Child", "baby_child"], ["Pet Zone", "pet"],
  ])("%s (%s): packaged", async (category, template) => {
    const p = await first(category);
    expect((await db.one(`select product_template($1) as t`, [p.id])).t).toBe(template);
    expect(await db.rpc("product_is_packaged", { p_product: p.id })).toBe(true);
  });

  it("baby food is packaged too", async () => {
    const p = await first("Baby & Child", 1);
    await db.pg.query(`update products set sub_type = 'baby food' where id = $1`, [p.id]);
    expect((await db.one(`select product_template($1) as t`, [p.id])).t).toBe("baby_food");
    expect(await db.rpc("product_is_packaged", { p_product: p.id })).toBe(true);
    await db.pg.query(`update products set sub_type = null where id = $1`, [p.id]);
  });

  it("loose produce, meat and bakery with no real barcode are not packaged", async () => {
    for (const category of ["Fruits & Vegetables", "Meat & Poultry", "Bakery"]) {
      const p = await first(category);
      await db.pg.query(`update products set barcode = null where id = $1`, [p.id]);
      expect(await db.rpc("product_is_packaged", { p_product: p.id }), category).toBe(false);
    }
  });

  it("a bakery or meat item with a real barcode is packaged; the store's own price-label code is not a real barcode; produce never is", async () => {
    for (const category of ["Meat & Poultry", "Bakery"]) {
      const p = await first(category, 1);
      await db.pg.query(`update products set barcode = $2 where id = $1`, [p.id, ean("629100012345")]);
      expect(await db.rpc("product_is_packaged", { p_product: p.id }), category + " real").toBe(true);
      await db.pg.query(`update products set barcode = $2 where id = $1`, [p.id, ean("210000012345")]);   // 21...: a weighed-goods code
      expect(await db.rpc("product_is_packaged", { p_product: p.id }), category + " store code").toBe(false);
      await db.pg.query(`update products set barcode = $2 where id = $1`, [p.id, "6291000123450"]);       // a wrong check digit
      expect(await db.rpc("product_is_packaged", { p_product: p.id }), category + " bad check digit").toBe(false);
    }
    const veg = await first("Fruits & Vegetables", 1);
    await db.pg.query(`update products set barcode = $2 where id = $1`, [veg.id, ean("629100012346")]);
    expect(await db.rpc("product_is_packaged", { p_product: veg.id })).toBe(false);
    await db.pg.query(`update products set barcode = null where id = $1`, [veg.id]);
  });

  it("an item with no template, or one that does not exist, is not packaged", async () => {
    expect(await db.rpc("product_is_packaged", { p_product: "00000000-0000-4000-8000-00000000dead" })).toBe(false);
  });

  it("product_readiness() carries it per item, with whether the item is label-ready", async () => {
    const p = await first("Water");
    const r = (await db.rpc("product_readiness", { p_product: p.id }))[0];
    expect(r).toMatchObject({ packaged: true, label_ready: false });
    expect(r.missing_label).toEqual(expect.arrayContaining(["volume_ml", "water_type"]));
    const v = await first("Fruits & Vegetables", 2);
    await db.pg.query(`update products set barcode = null where id = $1`, [v.id]);
    expect((await db.rpc("product_readiness", { p_product: v.id }))[0]).toMatchObject({ packaged: false });
  });
});

describe("the setting", () => {
  it("exists, is off, and a missing row counts as off", async () => {
    expect(await db.one(`select value from settings where key = 'sell_requires_label'`)).toEqual({ value: { enabled: false } });
    expect(await db.rpc("sell_requires_label")).toBe(false);
    await db.pg.query(`delete from settings where key = 'sell_requires_label'`);
    expect(await db.rpc("sell_requires_label")).toBe(false);
    await db.pg.query(`insert into settings(key, value) values ('sell_requires_label', '{"enabled": false}')`);
    await setGate(true);
    expect(await db.rpc("sell_requires_label")).toBe(true);
    await setGate(false);
  });
});

describe("2. label-ready means fact-complete from a label reading, approved by a person", () => {
  it("fact-complete from a supplier or a web source is not label-ready; from the label, approved by a person, it is", async () => {
    const p = await first("Snacks & Candy", 2);
    await db.pg.query(`update products set name_ar = coalesce(name_ar, 'منتج') where id = $1`, [p.id]);
    // every fact a food item needs, from a supplier's sheet
    const approve = async (attribute: string, value: string | null, detail: Record<string, unknown> = {}) => {
      const f = await db.rpc("propose_product_fact", { p_product: p.id, p_attribute: attribute, p_value: value, p_status: "declared", p_source: "supplier", p_by: ops, p_detail: detail });
      await db.rpc("approve_product_fact", { p_fact: f, p_by: ops });
    };
    await approve("ingredients", null, { text: "Sugar, cocoa" });
    await approve("nutrition", null, { per: "100g", values: { energy_kcal: 500, fat: 20, carbohydrates: 60, proteins: 5, sugars: 40, salt: 0.1 } });
    for (const a of ["gluten", "crustaceans", "eggs", "fish", "peanuts", "soy", "milk", "tree_nuts", "celery", "mustard", "sesame", "sulphites", "lupin", "molluscs"]) await approve(a, "free");
    const s1 = await db.rpc("product_label_status", { p_product: p.id });
    expect(s1).toMatchObject({ packaged: true, fact_complete: true, label_ready: false });
    expect(s1.missing).toEqual(expect.arrayContaining(["ingredients", "allergens", "nutrition"]));
    expect(await db.rpc("product_label_ready", { p_product: p.id })).toBe(false);
    // the label's reading, approved by a person, replaces them
    await makeFactComplete(db, p.id, ops, { allergens: { milk: "contains" } });
    await db.pg.query(`update product_facts set source = 'label' where product_id = $1 and approved_at is not null and superseded_at is null`, [p.id]);
    expect(await db.rpc("product_label_status", { p_product: p.id })).toMatchObject({ fact_complete: true, label_ready: true, missing: [] });
  });

  it("a non-food item: the field must be the label's reading, not a brand page", async () => {
    const p = await first("Cleaning & Household", 2);
    await db.pg.query(`update products set name_ar = coalesce(name_ar, 'منتج') where id = $1`, [p.id]);
    await fieldValue(p.id, "hazard_warnings", ["Irritant"], "brand_site");
    expect(await db.rpc("product_label_status", { p_product: p.id })).toMatchObject({ fact_complete: true, label_ready: false, missing: ["hazard_warnings"] });
    // the label's reading replaces the web value
    await db.pg.query(`update product_field_values set status = 'superseded' where product_id = $1 and field_key = 'hazard_warnings' and source = 'brand_site'`, [p.id]);
    await fieldValue(p.id, "hazard_warnings", ["Irritant"], "label_photo");
    expect(await db.rpc("product_label_status", { p_product: p.id })).toMatchObject({ label_ready: true, missing: [] });
  });

  it("a field a person must approve is not label-ready when the automatic party approved it", async () => {
    // the database already refuses the automatic party for a never-automatic field; the check below holds even if a row slipped through
    const p = await first("Cleaning & Household", 3);
    await db.pg.query(`update products set name_ar = coalesce(name_ar, 'منتج') where id = $1`, [p.id]);
    await db.pg.query(`alter table product_field_values disable trigger user`);
    try { await fieldValue(p.id, "hazard_warnings", ["Irritant"], "label_photo", AUTO); } finally { await db.pg.query(`alter table product_field_values enable trigger user`); }
    expect(await db.rpc("product_label_status", { p_product: p.id })).toMatchObject({ label_ready: false, missing: ["hazard_warnings"] });
  });

  it("an item that is not packaged has no label requirement: it is never reported as not label-ready", async () => {
    const v = await first("Fruits & Vegetables", 3);
    await db.pg.query(`update products set barcode = null where id = $1`, [v.id]);
    expect(await db.rpc("product_label_status", { p_product: v.id })).toMatchObject({ packaged: false, label_ready: false, required: false });
    expect(await db.rpc("product_orderable", { p_product: v.id })).toBe(true);
  });
});

describe("3. setting off: nothing changes", () => {
  it("an unread packaged item is quoted, found, shown and fed as before", async () => {
    await setGate(false);
    const p = await first("Snacks & Candy", 5);
    expect(await db.rpc("product_orderable", { p_product: p.id })).toBe(true);
    const q = await quote([{ product_id: p.id, qty: 20 }]);
    expect(codes(q)).not.toContain("coming_soon");
    expect(q.lines[0]).toMatchObject({ ok: true });
    const f = await db.rpc("find_products", { p_query: p.name_en, p_filters: {}, p_limit: 8 });
    expect(f.matches.find((m: any) => m.sku === p.sku)).toMatchObject({ orderable: true, coming_soon: false });
    const feed = (await db.rpc("catalog_feed")) as any[];
    expect(feed.length).toBeGreaterThanOrEqual(0);
  });
});

describe("4. setting on: a packaged item that is not label-ready cannot be sold", () => {
  let snack: any; let snackReady: any; let loose: any; let water: any; let clean: any;
  beforeAll(async () => {
    snack = await first("Snacks & Candy", 6);
    snackReady = await first("Snacks & Candy", 7);
    clean = await first("Cleaning & Household", 4);
    water = await first("Water", 1);
    loose = await first("Fruits & Vegetables", 4);
    await db.pg.query(`update products set barcode = null where id = $1`, [loose.id]);
    await labelReady(snackReady);
    await labelReady(water);
    await setGate(true);
  });

  it("is not orderable; a label-ready one and a loose one are", async () => {
    expect(await db.rpc("product_orderable", { p_product: snack.id })).toBe(false);
    expect(await db.rpc("product_orderable", { p_product: clean.id })).toBe(false);
    expect(await db.rpc("product_orderable", { p_product: snackReady.id })).toBe(true);
    expect(await db.rpc("product_orderable", { p_product: water.id })).toBe(true);
    expect(await db.rpc("product_orderable", { p_product: loose.id })).toBe(true);
  });

  it("quote_order: a coming_soon issue, the line not ok, nothing added to the subtotal; the others are priced", async () => {
    const q = await quote([{ product_id: snack.id, qty: 20 }, { product_id: snackReady.id, qty: 20 }, { product_id: loose.id, qty: 20 }]);
    expect(codes(q)).toContain("coming_soon");
    expect(q.issues.find((i: any) => i.code === "coming_soon")).toMatchObject({ product_id: snack.id, name: snack.name_en });
    expect(q.lines.find((l: any) => l.product_id === snack.id)).toMatchObject({ ok: false, coming_soon: true });
    expect(q.lines.find((l: any) => l.product_id === snackReady.id)).toMatchObject({ ok: true });
    expect(q.lines.find((l: any) => l.product_id === loose.id)).toMatchObject({ ok: true });
    const price = async (id: string) => Number((await db.one(`select o.price_usd from offers o join sources s on s.id = o.source_id and s.kind = 'dark_store' where o.product_id = $1`, [id])).price_usd);
    expect(Number(q.subtotal_usd)).toBeCloseTo(20 * (await price(snackReady.id)) + 20 * (await price(loose.id)), 2);
    expect(q.ok).toBe(false);
  });

  it("a basket of only what is orderable is ok: nothing about the gate leaks into it", async () => {
    const q = await quote([{ product_id: snackReady.id, qty: 20 }, { product_id: loose.id, qty: 20 }]);
    expect(codes(q)).not.toContain("coming_soon");
  });

  it("no card is made for it (create_order_from_quote), and none is made for a basket that holds it", async () => {
    const t = await db.rpc("touch_conversation", { p_line: "customer", p_wa_user_id: "bsuid-sell1-1", p_phone: "+96170009001", p_name: "Customer SELL1" });
    const base = { p_customer: t.party_id, p_conversation: t.conversation_id, p_village: village, p_place: null, p_pickup: true, p_payment: "cod", p_change_for: null, p_notes: null };
    const no = await db.rpc("create_order_from_quote", { ...base, p_lines: [{ product_id: snack.id, qty: 20 }, { product_id: loose.id, qty: 5 }] });
    expect(no.created).toBe(false);
    expect(codes(no.quote)).toContain("coming_soon");
    expect(await db.one(`select count(*)::int as n from orders where customer_id = $1`, [t.party_id])).toEqual({ n: 0 });
    const yes = await db.rpc("create_order_from_quote", { ...base, p_lines: [{ product_id: snackReady.id, qty: 20 }] });
    expect(yes.created).toBe(true);
  });

  it("a card made before the setting was switched on is refused at the tap: it goes back to draft (stale_quote), never confirmed", async () => {
    await setGate(false);
    try {
      const t = await db.rpc("touch_conversation", { p_line: "customer", p_wa_user_id: "bsuid-sell1-2", p_phone: "+96170009002", p_name: "Customer SELL1b" });
      const made = await db.rpc("create_order_from_quote", { p_customer: t.party_id, p_conversation: t.conversation_id, p_village: village, p_place: null, p_pickup: true,
        p_payment: "cod", p_change_for: null, p_notes: null, p_lines: [{ product_id: snack.id, qty: 45 }] });
      expect(made.created, JSON.stringify(made.quote?.issues)).toBe(true);
      await setGate(true);
      const r = await db.rpc("confirm_order_checked", { p_order: made.order_id, p_party: t.party_id, p_wamid: "w-sell1-2" });
      expect(r.status).toBe("stale_quote");
      expect(r.issues).toEqual([expect.objectContaining({ issue: "coming_soon" })]);
      expect((await db.one(`select status from orders where id = $1`, [made.order_id])).status).toBe("draft");
    } finally { await setGate(true); }
  });

  it("a substitute offered for an out-of-stock line is never one that is coming soon", async () => {
    const hub = (await db.one(`select id from sources where kind = 'dark_store'`)).id;
    // a line with two peers of the same category and sub-type at the hub: one label-ready, one not
    const g = await db.one(`select category, sub_type from products where is_active and owner_source_id is null and category = 'Snacks & Candy'
                              group by category, sub_type having count(*) >= 4 order by count(*) desc limit 1`);
    const members = await db.all(`select id from products where is_active and category = $1 and sub_type is not distinct from $2 and not exists (
                                    select 1 from product_facts f where f.product_id = products.id and f.approved_at is not null) order by sku limit 3`, [g.category, g.sub_type]);
    const [line, peerReady, peerSoon] = members as { id: string }[];
    await labelReady({ id: line!.id, category: g.category }); await labelReady({ id: peerReady!.id, category: g.category });
    await db.pg.query(`update stock_levels set on_hand = 0 where product_id = $1 and source_id = $2`, [line!.id, hub]);
    try {
      const q = await quote([{ product_id: line!.id, qty: 20 }]);
      const subs = ((q.issues.find((i: any) => i.code === "out_of_stock")?.substitutes ?? []) as any[]).map((x) => x.product_id);
      expect(subs).toContain(peerReady!.id);
      expect(subs).not.toContain(peerSoon!.id);
      for (const id of subs) expect(await db.rpc("product_orderable", { p_product: id })).toBe(true);
    } finally { await db.pg.query(`update stock_levels set on_hand = 50 where product_id = $1 and source_id = $2`, [line!.id, hub]); }
  });

  it("find_products returns it flagged coming soon, not orderable; the ready one orderable", async () => {
    const f = await db.rpc("find_products", { p_query: snack.name_en, p_filters: {}, p_limit: 8 });
    expect(f.matches.find((m: any) => m.sku === snack.sku)).toMatchObject({ orderable: false, coming_soon: true });
    const g = await db.rpc("find_products", { p_query: snackReady.name_en, p_filters: {}, p_limit: 8 });
    expect(g.matches.find((m: any) => m.sku === snackReady.sku)).toMatchObject({ orderable: true, coming_soon: false });
  });

  it("search_catalog (the chat's matcher) flags it too", async () => {
    const r = await db.rpc("search_catalog", { p_query: snack.name_en, p_source_hint: null, p_limit: 6 });
    expect(r.matches.find((m: any) => m.sku === snack.sku)).toMatchObject({ orderable: false, coming_soon: true });
    const g = await db.rpc("search_catalog", { p_query: snackReady.name_en, p_source_hint: null, p_limit: 6 });
    expect(g.matches.find((m: any) => m.sku === snackReady.sku)).toMatchObject({ orderable: true });
  });

  it("a basket built by code never takes it (build_basket), and a code-built substitute list leaves it out (substitutes_for)", async () => {
    const cands = (await db.all(`select product_id from basket_candidates('{}'::jsonb)`)).map((r: any) => r.product_id);
    expect(cands).not.toContain(snack.id);
    expect(cands).toContain(snackReady.id);
  });

  it("the website shows it as coming soon, never as orderable; a ready item and a loose item are unchanged", async () => {
    const inner = asSupabase(db);
    const code = (await db.one(`select category_code as c from catalog_placements where sku = $1`, [snack.sku])).c;
    await db.pg.exec("set role web_channel");
    try {
      const a = (await inner.rpc("web_catalog_product", { p_sku: snack.sku })).data as any;
      expect(a.product).toMatchObject({ in_stock: false, coming_soon: true, orderable: false });
      const b = (await inner.rpc("web_catalog_product", { p_sku: snackReady.sku })).data as any;
      expect(b.product).toMatchObject({ in_stock: true, coming_soon: false, orderable: true });
      const c = (await inner.rpc("web_catalog_product", { p_sku: loose.sku })).data as any;
      expect(c.product).toMatchObject({ in_stock: true, coming_soon: false });
      // a category list uses the same card
      const cat = (await inner.rpc("web_catalog_category", { p_code: code })).data as any;
      const items = cat.sections.flatMap((s: any) => s.items);
      expect(items.find((i: any) => i.sku === snack.sku)).toMatchObject({ in_stock: false, coming_soon: true });
    } finally { await db.pg.exec("reset role"); }
  });

  it("the website's search also returns it flagged", async () => {
    const inner = asSupabase(db);
    await db.pg.exec("set role web_channel");
    try {
      const r = (await inner.rpc("web_catalog_search", { p_text: snack.name_en, p_limit: 12, p_filters: {} })).data as any;
      const m = r.matches.find((i: any) => i.sku === snack.sku);
      if (m) expect(m).toMatchObject({ in_stock: false, coming_soon: true });
    } finally { await db.pg.exec("reset role"); }
  });

  it("the WhatsApp catalogue lists it as out of stock", async () => {
    const feed = (await db.rpc("catalog_feed")) as any[];
    const row = feed.find((i) => i.sku === snack.sku);
    if (row) expect(row.in_stock).toBe(false);
    const ready = feed.find((i) => i.sku === snackReady.sku);
    if (ready) expect(ready.in_stock).toBe(true);
  });

  it("turning the setting off again restores everything at once", async () => {
    await setGate(false);
    const q = await quote([{ product_id: snack.id, qty: 20 }]);
    expect(codes(q)).not.toContain("coming_soon");
    expect(await db.rpc("product_orderable", { p_product: snack.id })).toBe(true);
    await setGate(true);
    expect(await db.rpc("product_orderable", { p_product: snack.id })).toBe(false);
  });
});

describe("5. the readiness summary", () => {
  it("shows, per template, packaged items label-ready out of total, and the packaged items not ready with what each misses", async () => {
    await setGate(true);
    const s = await db.rpc("readiness_summary");
    expect(s).toMatchObject({ sell_requires_label: true });
    const total = (await db.all(`select id from products where is_active and owner_source_id is null`)).filter(() => true).length;
    expect(s.active).toBe(total);
    const tpl = s.by_template;
    // the template numbers add up to the packaged total, and label-ready never exceeds packaged
    let packaged = 0; let ready = 0;
    for (const t of Object.values(tpl) as any[]) { expect(t.label_ready).toBeLessThanOrEqual(t.packaged); expect(t.packaged).toBeLessThanOrEqual(t.active); packaged += t.packaged; ready += t.label_ready; }
    expect(s.packaged).toBe(packaged);
    expect(s.label_ready).toBe(ready);
    expect(tpl.fresh_produce.packaged).toBe(0);
    expect(tpl.packaged_food.packaged).toBe(tpl.packaged_food.active);
    expect(tpl.packaged_food.label_ready).toBeGreaterThanOrEqual(1);   // the item made ready above
    // the list is the packaged items that are not label-ready, each with what it misses
    expect(s.packaged_not_ready.length).toBe(packaged - ready);
    const row = s.packaged_not_ready.find((r: any) => r.template === "water" || r.template === "cleaning_household");
    expect(row.missing.length).toBeGreaterThan(0);
    expect(row).toMatchObject({ sku: expect.any(String), name_en: expect.any(String), template: expect.any(String) });
    // an item that is label-ready is not on it
    const readyOne = await db.one(`select p.sku from products p where p.is_active and (product_label_status(p.id)->>'label_ready')::boolean limit 1`);
    expect(s.packaged_not_ready.map((r: any) => r.sku)).not.toContain(readyOne.sku);
  });

  it("is the same with the setting off (the numbers are facts about the items, not about the switch)", async () => {
    await setGate(true);
    const on = await db.rpc("readiness_summary");
    await setGate(false);
    const off = await db.rpc("readiness_summary");
    expect(off.sell_requires_label).toBe(false);
    expect({ ...off, sell_requires_label: true }).toEqual(on);
  });

  it("keeps the old shape: active, sellable, fact_complete and the three numbers per template", async () => {
    const s = await db.rpc("readiness_summary");
    expect(s).toMatchObject({ active: expect.any(Number), sellable: expect.any(Number), fact_complete: expect.any(Number) });
    expect(Object.values(s.by_template as any)[0]).toMatchObject({ active: expect.any(Number), sellable: expect.any(Number), fact_complete: expect.any(Number) });
  });
});
