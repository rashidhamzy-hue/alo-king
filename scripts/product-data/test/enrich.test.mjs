// PD1 (f, h): the enrichment run against the real migrations and seed (PGlite), with a scripted model and no network.
// The recommendation data's rules: a substitute has the same template and kind; dish quantities are numbers code multiplies; unit prices
// are computed in SQL; nothing crosses a stated restriction; tags only from the list.
import { beforeAll, describe, expect, it } from "vitest";
import { openTestDb } from "../../../test/db/harness";
import { makeFactComplete } from "../../../test/db/fact-kit";
import { run, cleanAnswer, groupCode, reportMarkdown, offPictureRows } from "../enrich.mjs";

let db; let out; let calls = 0;
const store = () => ({ async rpc(fn, a) { return db.rpc(fn, a); } });
const KINDS = { "AK-0122": "iced tea", "AK-0123": "iced tea", "AK-0161": "chips", "AK-0160": "chips", "AK-0180": "lentils" };
const model = async (chunk) => { calls++; return { items: chunk.map((x) => ({ sku: x.sku, kind: KINDS[x.sku] ?? "grocery item",
  tags: x.sku === "AK-0161" ? ["salty", "kids", "healthy"] : [] })) }; };

beforeAll(async () => {
  db = await openTestDb();
  await db.pg.exec(`update stock_levels set on_hand = 50`);
  out = await run({ store: store(), model, pictures: async (items) => items.slice(0, 2).map((x) => `${x.sku},https://images.openfoodfacts.org/x.jpg,https://world.openfoodfacts.org/product/1,2026-11-16T00:00Z`) }, { batch: 100 });
}, 300_000);

describe("the enrichment run (PD1 h)", () => {
  it("runs the rules, the model in batches, the groups, the approvals, the search documents, the pictures and the report", () => {
    expect(out.rules.proposed).toBeGreaterThan(300);
    expect(calls).toBe(3);                                                    // 291 items in batches of 100
    expect(out.model).toMatchObject({ batches: 3, items: 291 });
    expect(out.model.dropped).toBe(0);                                        // "healthy" never reaches SQL: cleanAnswer drops it
    expect(out.search).toBe(291);
    expect(out.pictures).toHaveLength(2);
    expect(out.report.summary.active).toBe(291);
    expect(Object.keys(out.report.routes)).toEqual(expect.arrayContaining(["names_page", "shelf_label_photo_before_stock", "supplier_sheet"]));
  });

  it("kinds from the model are approved by the rule; substitute groups hold one template and one kind", async () => {
    expect(await db.rpc("product_kind", { p_product: (await db.one(`select id from products where sku = 'AK-0122'`)).id })).toBe("iced tea");
    const g = await db.all(`select g.code, g.template_code, g.kind, count(*)::int as n from substitute_groups g join product_substitutes s on s.group_code = g.code group by 1, 2, 3 order by 1`);
    expect(g).toEqual(expect.arrayContaining([{ code: groupCode("packaged_food", "iced tea"), template_code: "packaged_food", kind: "iced tea", n: 2 }]));
    const soap = (await db.one(`select id from products where category = 'Beauty & Personal Care' limit 1`)).id;
    await expect(db.pg.query(`insert into product_substitutes(product_id, group_code, source) values ($1, $2, 'person')`, [soap, groupCode("packaged_food", "iced tea")]))
      .rejects.toThrow(/SUBSTITUTE_MISMATCH/);
  });

  it("tags only from the list; the model's health word is dropped before SQL, and SQL refuses it anyway", async () => {
    const chips = (await db.one(`select id from products where sku = 'AK-0161'`)).id;
    expect((await db.all(`select tag_code from product_tags where product_id = $1 order by 1`, [chips])).map((r) => r.tag_code)).toEqual(expect.arrayContaining(["kids", "salty"]));
    expect(await db.rpc("apply_item_proposal", { p_product: chips, p_proposal: { tags: ["healthy"] }, p_source: "model" })).toMatchObject({ tags: 0, dropped: [{ tag: "healthy" }] });
    expect(cleanAnswer({ items: [{ sku: "AK-0161", kind: "Chips!!", tags: ["salty", "healthy"] }, { sku: "X", kind: "y", tags: [] }] }, ["AK-0161"]))
      .toEqual([{ sku: "AK-0161", kind: "chips", tags: ["salty"] }]);
  });

  it("the report: per item what is missing and its route; the shelf list by aisle; Markdown with a printable list", async () => {
    const it0 = out.report.items.find((x) => x.sku === "AK-0122");
    expect(it0).toMatchObject({ template: "packaged_food", level: "not_sellable" });
    expect(it0.routes.name_ar).toBe("names_page");
    expect(it0.routes.allergens).toBe("shelf_label_photo_before_stock");
    const potato = out.report.items.find((x) => x.sku === "AK-0001");
    expect(potato.routes.origin).toBe("supplier_sheet");
    expect(out.report.shelf_list.every((x) => x.barcode)).toBe(true);
    const md = reportMarkdown(out.report, 1.2345);
    expect(md).toContain("Model spend: USD 1.2345");
    expect(md).toMatch(/### .+\n\n\| SKU \| Item \| Barcode \| Done \|/);
  });

  it("an Open Food Facts picture row is written only for an https picture on images.openfoodfacts.org", async () => {
    const fake = async (url) => new Response(JSON.stringify({ product: { image_front_url: url.includes("5283024603784") ? "https://images.openfoodfacts.org/images/products/528/front_en.5.400.jpg" : "http://evil.example/x.jpg" } }), { status: 200 });
    const rows = await offPictureRows([{ sku: "AK-0122", barcode: "5283024603784" }, { sku: "AK-0123", barcode: "5283024603364" }, { sku: "AK-0001", barcode: null }],
      { fetchImpl: fake, now: new Date("2026-11-16T05:00:00Z") });
    expect(rows).toEqual(["AK-0122,https://images.openfoodfacts.org/images/products/528/front_en.5.400.jpg,https://world.openfoodfacts.org/product/5283024603784,2026-11-16T05:00Z"]);
  });
});

describe("recommendation data (PD1 f)", () => {
  it("unit price per kg, litre or piece, computed in SQL from the hub's price and the size printed", async () => {
    const u = async (sku) => db.rpc("product_unit_price", { p_product: (await db.one(`select id from products where sku = $1`, [sku])).id });
    expect(await u("AK-0228")).toMatchObject({ per: "kg", price_usd: 0.71 });          // Deroni Sugar 5 kg at 3.54
    expect(await u("AK-0223")).toMatchObject({ per: "kg", price_usd: 0.77 });          // 900 g at 0.69
    expect(await u("AK-0122")).toMatchObject({ per: "litre", price_usd: 2.16 });       // 320 ml at 0.69
  });

  it("a dish for N people: quantities multiplied by code, items of each kind, never one that fails a stated restriction", async () => {
    const b = await db.rpc("dish_basket", { p_dish: "mjadra", p_people: 6 });
    const lentils = b.kinds.find((k) => k.kind === "lentils");
    expect(lentils).toMatchObject({ qty: 360, unit: "g" });
    expect(lentils.items.map((i) => i.name_en)).toEqual(expect.arrayContaining([expect.stringContaining("Lentil")]));
    const restricted = await db.rpc("dish_basket", { p_dish: "mjadra", p_people: 6, p_restrictions: ["gluten"] });
    expect(restricted.kinds.find((k) => k.kind === "lentils").items).toEqual([]);   // no lentils are fact-complete: unknown never passes
    expect(await db.rpc("dish_basket", { p_dish: "mjadra", p_people: 0 })).toBeNull();
    await expect(db.pg.query(`insert into dish_kinds(dish_code, kind, qty_per_person, unit) values ('mjadra', 'salt', 0, 'g')`)).rejects.toThrow(/check/);
  });

  it("substitutes: same group, cheapest per unit first; with restrictions only fact-complete items that meet them", async () => {
    const a = (await db.one(`select id from products where sku = 'AK-0122'`)).id;
    const b = (await db.one(`select id from products where sku = 'AK-0123'`)).id;
    expect((await db.rpc("substitutes_for", { p_product: a })).map((x) => x.product_id)).toEqual([b]);
    expect(await db.rpc("substitutes_for", { p_product: a, p_restrictions: ["milk"] })).toEqual([]);
    const ops = (await db.one(`insert into parties(role, display_name) values ('ops_lead', 'Ops') returning id`)).id;
    await makeFactComplete(db, b, ops, { allergens: { milk: "free" } });
    expect((await db.rpc("substitutes_for", { p_product: a, p_restrictions: ["milk"] })).map((x) => x.product_id)).toEqual([b]);
  });

  it("one search document per item from approved data only, refreshed when it changes", async () => {
    const p = (await db.one(`select id from products where sku = 'AK-0122'`)).id;
    const doc = (await db.one(`select document from product_search_documents where product_id = $1`, [p])).document;
    expect(doc).toContain("Lipton Ice Tea Tropical Zero Sugar 320Ml");
    expect(doc).toContain("iced tea");
    await db.pg.query(`insert into product_claims(product_id, claim_code, quote, source) values ($1, 'sugar_free', 'Zero Sugar', 'label_photo')`, [p]);
    expect(await db.rpc("refresh_search_documents", { p_product: p })).toBe(0);        // a waiting claim changes nothing
  });
});
