// Product readiness (session D4): product_readiness() (0111) per active hub item, and the page that lists it with its two filters.
// A product with no approved picture "blocks the catalog", not "blocks ordering"; each missing part links to the page that fixes it.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { rig, type Rig } from "./kit";

let r: Rig;
afterEach(() => vi.unstubAllGlobals());
beforeAll(async () => { r = await rig(); }, 120_000);

const ready = async (sku: string) => ((await r.db.rpc("product_readiness", { p_product: (await r.db.one(`select id from products where sku = $1`, [sku])).id })) as any[])[0];
const ALLERGENS = ["gluten", "crustaceans", "eggs", "fish", "peanuts", "soy", "milk", "tree_nuts", "celery", "mustard", "sesame", "sulphites", "lupin", "molluscs"];

describe("Product readiness", () => {
  it("answers once per active hub item, with what blocks the catalog apart from what blocks ordering", async () => {
    const all = (await r.db.rpc("product_readiness", {})) as any[];
    const hub = Number((await r.db.one(`select count(*) as n from products where is_active and owner_source_id is null`)).n);
    expect(all).toHaveLength(hub);
    expect(hub).toBeGreaterThan(250);
    // A fresh catalog has no approved picture anywhere: every item blocks the catalog, none of them for that reason blocks ordering.
    const x = await ready("AK-0042");
    expect(x.picture).toBe("none");
    expect(x.blocks_catalog).toContain("no approved picture a customer may see");
    expect(x.blocks_ordering).toEqual([]);
    expect(x.price).toBe(true);
    expect(x.ready).toBe(false);
    expect(x.missing).toEqual(expect.arrayContaining(["food facts from the pack", "cost"]));
  });

  it("an item with a price but no picture is not orderable-blocked; one with no price blocks both; an unavailable one blocks ordering", async () => {
    const [a, b2] = await r.db.all(`select p.id, p.sku from products p where p.is_active and p.owner_source_id is null and p.sku in ('AK-0043', 'AK-0044') order by p.sku`);
    await r.db.pg.query(`update offers set is_available = false where product_id = $1`, [a.id]);
    const un = await ready("AK-0043");
    expect(un.blocks_ordering).toEqual(["marked unavailable at the hub"]);
    expect(un.price).toBe(false);
    await r.db.pg.query(`delete from offers where product_id = $1`, [b2.id]);
    const none = await ready("AK-0044");
    expect(none.blocks_ordering).toEqual(["no price at the hub"]);
    expect(none.blocks_catalog).toEqual(expect.arrayContaining(["no price at the hub", "no approved picture a customer may see"]));
  });

  it("an item with everything is ready; take any one part away and it says which", async () => {
    const lead = await r.staff("ops_lead", "Maya");
    const p = (await r.db.one(`select id from products where sku = 'AK-0042'`)).id as string;
    // picture: approved, licence a customer may see
    await r.db.pg.query(`insert into product_images(product_id, status, source_kind, licence, source_url, media_path, sha256, width_px, height_px, bytes, attribution, reviewed_by, reviewed_at)
      values ($1, 'approved', 'open_food_facts', 'cc_by_sa', 'https://images.example.test/1.jpg', 'product_images/t/1.jpg', 'sha-r1', 800, 800, 1000, 'OFF', $2, now())`, [p, lead.partyId]);
    // facts: the ingredient list and all fourteen allergens from the pack
    for (const attr of ["ingredients", ...ALLERGENS]) {
      await r.db.pg.query(`insert into product_facts(product_id, attribute, value, detail, status, source, proposed_by, approved_by, approved_at)
        values ($1, $2, $3, $4, 'declared', 'label', $5, $5, now())`, [p, attr, attr === "ingredients" ? null : "free", attr === "ingredients" ? { text: "milk, salt" } : {}, lead.partyId]);
    }
    // cost known; search words built; placed in a category (the seed places every item)
    await r.db.pg.query(`update stock_levels set avg_cost_usd = 2.5 where product_id = $1`, [p]);
    expect(Number((await r.db.one(`select count(*) as n from language_pack where sku = 'AK-0042' and level <> 'brand'`)).n)).toBeGreaterThan(0);   // B3's pack
    await r.db.rpc("review_product_name", { p_proposal: (await r.db.one(`select id from product_name_proposals where sku = 'AK-0042'`)).id, p_by: lead.partyId, p_decision: "approve" });
    await r.db.pg.exec(`update search_word_jobs set status = 'done'`);
    await r.db.pg.exec(`insert into language_pack(sku, term, level, lang, version, tokens, forms) select 'AK-0042', 'zzlabneh', 'exact', 'en', 'test', array['zzlabneh'], array['zzlabneh'] where not exists (select 1 from language_pack where sku = 'AK-0042' and level <> 'brand')`);
    let x = await ready("AK-0042");
    expect(x.name).toBe("approved");
    expect(x).toMatchObject({ picture: "approved", cost: true, placement: true, price: true, search_words: "built", ready: true, blocks_catalog: [], blocks_ordering: [], missing: [] });
    expect(x.facts).toMatchObject({ ok: true, ingredients: true, allergens: 14, allergens_of: 14 });

    // take away the picture: it blocks the catalog and nothing else
    await r.db.pg.query(`update product_images set status = 'rejected' where product_id = $1`, [p]);
    x = await ready("AK-0042");
    expect(x).toMatchObject({ picture: "none", ready: false, blocks_catalog: ["no approved picture a customer may see"], blocks_ordering: [], missing: [] });
    // approved but licence unknown: a guide only, the catalog still leaves it out
    await r.db.pg.query(`insert into product_images(product_id, status, source_kind, licence, source_url, media_path, sha256, width_px, height_px, bytes, reviewed_by, reviewed_at)
      values ($1, 'approved', 'web_search', 'unknown', 'https://images.example.test/2.jpg', 'product_images/t/2.jpg', 'sha-r2', 800, 800, 1000, $2, now())`, [p, lead.partyId]);
    x = await ready("AK-0042");
    expect(x.picture).toBe("guide_only");
    expect(x.blocks_catalog).toEqual(["no approved picture a customer may see"]);
    await r.db.pg.query(`update product_images set status = 'superseded' where product_id = $1 and sha256 = 'sha-r2'`, [p]);
    // one allergen not answered from the pack: facts missing, nothing blocked
    await r.db.pg.query(`update product_facts set status = 'unknown' where product_id = $1 and attribute = 'peanuts'`, [p]);
    await r.db.pg.query(`update product_images set status = 'approved' where product_id = $1 and sha256 = 'sha-r1'`, [p]);
    x = await ready("AK-0042");
    expect(x.facts).toMatchObject({ ok: false, allergens: 13 });
    expect(x.missing).toEqual(["food facts from the pack"]);
    expect(x.blocks_catalog).toEqual([]);
    expect(x.ready).toBe(false);
    // a name waiting for a person is listed as missing, and blocks nothing
    expect(await r.db.one(`update product_name_proposals set status = 'proposed', decided_by = null, decided_at = null, applied_name_en = null where sku = 'AK-0042' returning status`)).toBeTruthy();
    x = await ready("AK-0042");
    expect(x.name).toBe("waiting");
    expect(x.missing).toEqual(["name waiting for a person", "food facts from the pack"]);
    expect(x.blocks_catalog).toEqual([]);
    expect(x.blocks_ordering).toEqual([]);
  });

  it("the page lists every item with filters, counts and links to the page that fixes each part", async () => {
    const lead = await r.staff("ops_lead", "Maya");
    const b = r.browser();
    await b.signIn(lead);
    const all = (await b.get("/readiness")).text;
    expect(all).toContain("Product readiness");
    expect(all).toMatch(/all items \(\d+\)/);
    expect(all).toContain("blocks the catalog (");
    expect(all).toContain("blocks ordering (");
    expect((await b.get("/")).text).toContain('href="/readiness"');

    // AK-0044 has no price: it is under "blocks ordering" and says so
    const ordering = (await b.get("/readiness?show=ordering")).text;
    expect(ordering).toContain("AK-0044");
    expect(ordering).toContain("AK-0043");
    expect(ordering).toContain("no price at the hub");
    expect(ordering).toContain("marked unavailable at the hub");
    // AK-0042 has a picture again (blocks nothing); it is not under either filter
    expect((await b.get("/readiness?show=catalog&q=AK-0042")).text).toContain("Nothing here.");
    expect((await b.get("/readiness?show=ordering&q=AK-0042")).text).toContain("Nothing here.");
    // a picture-less item blocks the catalog and is not listed under ordering
    const noPicture = (await b.get("/readiness?show=catalog&q=AK-0045")).text;
    expect(noPicture).toContain("AK-0045");
    expect(noPicture).toContain("no approved picture a customer may see");
    expect((await b.get("/readiness?show=ordering&q=AK-0045")).text).toContain("Nothing here.");

    // links to the fixing pages
    const id = (await r.db.one(`select id from products where sku = 'AK-0045'`)).id;
    await r.db.pg.exec(`delete from language_pack where sku = 'AK-0045'`);
    await r.db.pg.query(`insert into product_facts(product_id, attribute, value, detail, status, source, proposed_by) values ($1, 'milk', 'contains', '{"read_by":"model"}', 'partial', 'label', $2)`, [id, lead.partyId]);
    const item = (await b.get("/readiness?q=AK-0045")).text;
    expect(item).toContain(`href="/names?q=AK-0045"`);                      // the name waits for a person
    expect(item).toContain(`href="/intake/${id}"`);                         // a proposed fact waits to be checked against the pack
    expect(item).toContain(`href="/receiving"`);                            // no cost yet
    expect(item).toContain(`href="/search-words"`);
    expect(item).toContain(`href="/intake"`);                               // no picture: photograph it at intake
    const ready = (await b.get("/readiness?show=ready")).text;
    expect(ready).not.toContain("AK-0045");
  });

  it("pickers cannot open it", async () => {
    const picker = await r.staff("picker");
    const b = r.browser();
    await b.signIn(picker);
    expect((await b.get("/readiness")).status).toBe(403);
    expect((await b.get("/")).text).not.toContain('href="/readiness"');
  });
});
