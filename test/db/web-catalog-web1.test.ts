// Session WEB1 (website, read side), migrations 0154-0155, on the real migrations. The website reads the catalog as the database role
// web_channel through packages/commerce. Done when: no unapproved picture or fact can render; «لبنة», "labne" and "labneh" find the same
// products; a miss is logged once; the role reads the catalog through its four functions and nothing else.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asSupabase, openTestDb, type TestDb } from "./harness";
import { webCatalog, type RpcSource } from "@ak/commerce/index";

let db: TestDb; let ops: string; let cat: ReturnType<typeof webCatalog>;
const pid: Record<string, string> = {};
let n = 0;

/** The Worker's connection: every call runs as web_channel. */
function asWebChannel(t: TestDb): RpcSource {
  const inner = asSupabase(t);
  return { rpc: async (fn: string, args: Record<string, unknown>) => {
    await t.pg.exec("set role web_channel");
    try { return await inner.rpc(fn, args); } finally { await t.pg.exec("reset role"); }
  } };
}
async function propose(sku: string, kind: "intake_photo" | "open_food_facts" | "web_search" | "brand_site") {
  n++;
  const r = await db.rpc<any>("propose_product_image", { p_product: pid[sku], p_source_kind: kind,
    p_source_url: kind === "intake_photo" ? null : `https://example.test/${n}.jpg`, p_page_url: null,
    p_attribution: kind === "open_food_facts" ? "Open Food Facts contributors, CC BY-SA 3.0" : null,
    p_media_path: `product_images/${sku}/${n}.jpg`, p_sha256: `sha-web1-${n}`, p_width: 1200, p_height: 1200, p_bytes: 100000, p_vision: {} });
  return r.image_id as string;
}
const review = (image: string, decision: "approve" | "reject") => db.rpc("review_product_image", { p_image: image, p_by: ops, p_decision: decision, p_note: null });
/** The Worker copied it to the public bucket (catalog_picture_copied is what its sync calls). */
const copied = (image: string) => db.rpc("catalog_picture_copied", { p_image: image });
const fact = async (sku: string, attribute: string, value: string | null, status: string, source: string, detail: object = {}) => {
  const id = await db.rpc<string>("propose_product_fact", { p_product: pid[sku], p_attribute: attribute, p_value: value, p_status: status, p_source: source,
    p_by: ops, p_evidence: null, p_detail: detail });
  return id;
};
const approveFact = (id: string) => db.rpc("approve_product_fact", { p_fact: id, p_by: ops });

beforeAll(async () => {
  db = await openTestDb();
  cat = webCatalog(asWebChannel(db));
  ops = (await db.one(`insert into parties(role, display_name) values ('ops_lead', 'Ops') returning id`)).id;
  for (const r of await db.all<any>(`select id, sku from products`)) pid[r.sku] = r.id;
  await db.pg.exec(`update stock_levels set on_hand = 10, reserved = 0`);
}, 120_000);
beforeEach(async () => {
  await db.pg.exec(`delete from catalog_public_pictures; delete from product_images; delete from product_facts; update products set is_active = true;
                    delete from demand_signals`);
});

describe("the role", () => {
  it("reads the catalog through its four functions, and the tables behind them stay closed to it", async () => {
    expect((await cat.home()).categories.length).toBeGreaterThan(5);
    for (const sql of [`select 1 from products limit 1`, `select 1 from product_images limit 1`, `select 1 from product_facts limit 1`,
                       `select 1 from catalog_public_pictures limit 1`, `select 1 from demand_signals limit 1`, `select catalog_web_items()`,
                       `select catalog_web_picture(null::uuid)`]) {
      await db.pg.exec("set role web_channel");
      let err = "";
      try { await db.pg.exec(sql); } catch (e) { err = (e as Error).message; } finally { await db.pg.exec("reset role"); }
      expect(err, sql).toMatch(/permission denied/);
    }
  });
});

describe("home and category", () => {
  it("hours and villages come from the database, categories with their counts, and the WhatsApp link from settings", async () => {
    await db.pg.query(`update settings set value = value || '{"product_link": "https://wa.me/96100000000?text={sku}"}' where key = 'catalog'`);
    const h = await cat.home();
    expect(h.service.served.length).toBeGreaterThan(0);
    expect(h.service.served[0]).toMatchObject({ name_en: expect.any(String), fee_usd: expect.anything(), eta_minutes: expect.any(Number) });
    expect(h.service.open).toBeTruthy();
    expect(h.categories.reduce((a, c) => a + c.count, 0)).toBe(291);
    expect(h.whatsapp).toEqual({ home: "https://wa.me/96100000000", product: "https://wa.me/96100000000?text={sku}" });
    await db.pg.query(`update settings set value = value || '{"product_link": null}' where key = 'catalog'`);
    expect((await cat.home()).whatsapp).toEqual({ home: null, product: null });
  });

  it("a category lists its placed, active items in sections; sold out is shown, not hidden; the picture is a placeholder (null) until one is public", async () => {
    const c = await cat.category("water_drinks");
    if (!c.ok) throw new Error("no category");
    expect(c.sections.map((s) => s.title_en)).toEqual(["Water", "Soft Drinks & Juice", "Coffee & Tea"]);
    const all = c.sections.flatMap((s) => s.items);
    expect(all.length).toBeGreaterThan(30);
    expect(all.every((i) => i.picture === null)).toBe(true);
    await db.pg.exec(`update stock_levels set on_hand = 0 where product_id = (select id from products where sku = '${all[0]!.sku}')`);
    const again = await cat.category("water_drinks");
    if (!again.ok) throw new Error("no category");
    expect(again.sections.flatMap((s) => s.items).find((i) => i.sku === all[0]!.sku)).toMatchObject({ in_stock: false });
    expect(again.sections.flatMap((s) => s.items).length).toBe(all.length);
    await db.pg.exec(`update stock_levels set on_hand = 10`);
  });

  it("an unknown category, an inactive item and a merchant's item are not there", async () => {
    expect(await cat.category("nope")).toEqual({ ok: false, error: "unknown_category" });
    const c1 = await cat.category("dairy_eggs");
    if (!c1.ok) throw new Error();
    const sku = c1.sections[0]!.items[0]!.sku;
    await db.pg.query(`update products set is_active = false where sku = $1`, [sku]);
    const c2 = await cat.category("dairy_eggs");
    if (!c2.ok) throw new Error();
    expect(c2.sections.flatMap((s) => s.items).map((i) => i.sku)).not.toContain(sku);
    expect(await cat.product(sku)).toEqual({ ok: false, error: "unknown_product" });
    await db.pg.query(`update products set owner_source_id = (select id from sources limit 1) where sku = $1`, [sku]);
    await db.pg.query(`update products set is_active = true where sku = $1`, [sku]);
    expect(await cat.product(sku)).toEqual({ ok: false, error: "unknown_product" });
    await db.pg.query(`update products set owner_source_id = null where sku = $1`, [sku]);
  });
});

describe("pictures: only approved ones the bucket holds", () => {
  const picOf = async (sku: string) => { const p = await cat.product(sku); if (!p.ok) throw new Error("no product"); return p.picture; };

  it("a proposed, rejected, licence-unknown, superseded or not-yet-copied picture never reaches a page", async () => {
    const proposed = await propose("AK-0103", "intake_photo");
    const rejected = await propose("AK-0080", "intake_photo"); await review(rejected, "reject");
    const unknown = await propose("AK-0133", "web_search");
    expect(() => review(unknown, "approve")).not.toThrow();
    const approvedNotCopied = await propose("AK-0001", "intake_photo"); await review(approvedNotCopied, "approve");
    for (const sku of ["AK-0103", "AK-0080", "AK-0133", "AK-0001"]) expect(await picOf(sku), sku).toBeNull();
    // even if a book entry existed for a picture that is not approved, the page does not show it
    await db.pg.query(`insert into catalog_public_pictures(image_id, product_id, public_path) values ($1, $2, 'AK-0103-x.jpg')`, [proposed, pid["AK-0103"]]);
    await db.pg.query(`insert into catalog_public_pictures(image_id, product_id, public_path) values ($1, $2, 'AK-0133-x.jpg')`, [unknown, pid["AK-0133"]]);
    expect(await picOf("AK-0103")).toBeNull();
    expect(await picOf("AK-0133")).toBeNull();
    const cardsPics = async (code: string) => { const c = await cat.category(code); if (!c.ok) throw new Error(); return c.sections.flatMap((s) => s.items).filter((i) => i.picture); };
    for (const code of ["water_drinks", "fruits_vegetables", "dairy_eggs", "bakery"]) expect(await cardsPics(code)).toEqual([]);
  });

  it("an approved picture shows once copied, with its credit; withdrawing it removes it from the page at once", async () => {
    const img = await propose("AK-0103", "open_food_facts");
    await review(img, "approve");
    expect(await picOf("AK-0103")).toBeNull();                       // approved, not copied yet
    const path = await copied(img);
    const p = await cat.product("AK-0103");
    if (!p.ok) throw new Error();
    expect(p.picture).toMatchObject({ path, licence: "cc_by_sa", attribution: "Open Food Facts contributors, CC BY-SA 3.0" });
    expect(p.credit_open_food_facts).toBe(true);
    const c = await cat.category("water_drinks");
    if (!c.ok) throw new Error();
    expect(c.sections.flatMap((s) => s.items).find((i) => i.sku === "AK-0103")?.picture?.path).toBe(path);
    await review(img, "reject");                                       // withdrawn: the Worker's next pass removes the object
    expect(await picOf("AK-0103")).toBeNull();
    expect(((await cat.product("AK-0103")) as any).credit_open_food_facts).toBe(false);
  });

  it("a replaced picture shows the new one, not the old", async () => {
    const a = await propose("AK-0080", "intake_photo"); await review(a, "approve"); await copied(a);
    const b = await propose("AK-0080", "brand_site"); await review(b, "approve");
    expect(await picOf("AK-0080")).toBeNull();                         // the new one is not copied yet; the old one is superseded
    const path = await copied(b);
    expect((await picOf("AK-0080"))?.path).toBe(path);
  });
});

describe("food facts: approved, checked and with their status; everything else is 'not verified'", () => {
  const factsOf = async (sku: string) => { const p = await cat.product(sku); if (!p.ok) throw new Error(); return Object.fromEntries(p.facts.map((f) => [f.attribute, f])); };

  it("a product with no records shows every attribute as not verified, with no value", async () => {
    const f = await factsOf("AK-0042");
    expect(Object.keys(f)).toEqual(expect.arrayContaining(["milk", "gluten", "halal", "vegan", "ingredients", "nutrition"]));
    for (const x of Object.values(f)) expect(x).toMatchObject({ verified: false, value: null, detail: null, status: "not_verified", source: null });
  });

  it("a proposed fact never renders; an approved declared fact does, with status and source; a partial or expired one does not", async () => {
    const milk = await fact("AK-0042", "milk", "contains", "declared", "label");
    expect((await factsOf("AK-0042")).milk).toMatchObject({ verified: false, value: null });      // proposed only
    await approveFact(milk);
    expect((await factsOf("AK-0042")).milk).toMatchObject({ verified: true, value: "contains", status: "declared", source: "label" });

    const gluten = await fact("AK-0042", "gluten", "free", "partial", "label");
    await approveFact(gluten);
    expect((await factsOf("AK-0042")).gluten).toMatchObject({ verified: false, value: null, status: "not_verified" });   // unknown is never safe

    const sesame = await fact("AK-0042", "sesame", "free", "declared", "label"); await approveFact(sesame);
    expect((await factsOf("AK-0042")).sesame.verified).toBe(true);
    await db.pg.query(`update product_facts set expires_at = now() - interval '1 day' where id = $1`, [sesame]);
    expect((await factsOf("AK-0042")).sesame).toMatchObject({ verified: false, value: null });

    const ing = await fact("AK-0042", "ingredients", null, "declared", "label", { text: "Strained yoghurt, salt", lang: "en", secret_note: "internal" });
    await approveFact(ing);
    const f = (await factsOf("AK-0042")).ingredients!;
    expect(f).toMatchObject({ verified: true, detail: { text: "Strained yoghurt, salt", lang: "en" } });
    expect(f.detail).not.toHaveProperty("secret_note");                                          // only the printed text or panel leaves
  });

  it("a web-page reading is never shown, whatever its row says", async () => {
    await db.pg.query(`insert into product_facts(product_id, attribute, value, status, source, detail, proposed_at)
                       values ($1, 'vegan', 'yes', 'partial', 'web_page', '{"url": "https://x.test"}', now())`, [pid["AK-0043"]]);
    expect((await factsOf("AK-0043")).vegan).toMatchObject({ verified: false, value: null });
  });

  it("a superseded fact is gone and the current one shows; an Open Food Facts reading cannot be approved, so it is never shown", async () => {
    const a = await fact("AK-0044", "halal", "yes", "declared", "label"); await approveFact(a);
    const b = await fact("AK-0044", "halal", "no", "declared", "label"); await approveFact(b);
    expect((await factsOf("AK-0044")).halal).toMatchObject({ verified: true, value: "no" });
    expect(((await cat.product("AK-0044")) as any).credit_open_food_facts).toBe(false);
    const c = await fact("AK-0044", "vegetarian", "yes", "declared", "open_food_facts");
    await expect(approveFact(c)).rejects.toThrow(/SECOND_OPINION_ONLY/);          // a person confirms it against the pack and records it as label (0021)
    expect((await factsOf("AK-0044")).vegetarian).toMatchObject({ verified: false, value: null });
  });

  it("nothing in a product page's data is a rating, a score or a health claim", async () => {
    const p = await cat.product("AK-0042");
    expect(JSON.stringify(p)).not.toMatch(/rating|score|stars|healthy|health|best|top.rated|recommended/i);
  });
});

describe("search: the chat's matcher, on the website", () => {
  const skus = (s: any) => s.matches.map((m: any) => m.sku);

  it("«لبنة», \"labne\" and \"labneh\" find the same products, in the same order", async () => {
    const [a, b, c] = [await cat.search("labne"), await cat.search("لبنة"), await cat.search("labneh")];
    expect(skus(a)).toEqual(["AK-0042", "AK-0046", "AK-0051"]);
    expect(skus(b)).toEqual(skus(a));
    expect(skus(c)).toEqual(skus(a));
    expect(a.matches[0]).toMatchObject({ name_en: expect.any(String), price_usd: expect.anything(), in_stock: true });
  });

  it("laban is not labneh", async () => {
    expect(skus(await cat.search("laban"))).not.toContain("AK-0042");
  });

  it("a result is only an item the site shows", async () => {
    await db.pg.query(`update products set is_active = false where sku = 'AK-0042'`);
    expect(skus(await cat.search("labneh"))).not.toContain("AK-0042");
  });

  it("a search that finds nothing is logged as demand once, even when repeated; a hit and a one-letter search log nothing", async () => {
    await cat.search("labneh"); await cat.search("x");
    expect(Number((await db.one(`select count(*) as n from demand_signals`)).n)).toBe(0);
    const miss = await cat.search("zzqqxx nothing");
    expect(miss).toMatchObject({ ok: true, matches: [], reason: "no_match" });
    await cat.search("zzqqxx nothing"); await cat.search("  ZZQQXX nothing ");
    const rows = await db.all(`select kind, origin, query, party_id from demand_signals`);
    expect(rows).toEqual([{ kind: "unknown_product", origin: "web_search", query: "zzqqxx nothing", party_id: null }]);
  });

  it("a script cannot fill the table: past the hourly cap a miss is answered and not written", async () => {
    await db.pg.query(`update settings set value = value || '{"miss_log_per_hour": 3}' where key = 'web'`);
    for (let i = 0; i < 6; i++) await cat.search(`qqzzxx${i}${i}`);
    expect(Number((await db.one(`select count(*) as n from demand_signals where origin = 'web_search'`)).n)).toBe(3);
    await db.pg.query(`update settings set value = value - 'miss_log_per_hour' where key = 'web'`);
  });
});
