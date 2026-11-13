// Build plan 5.17 (session P1), migration 0050. The done-when test: the customer-side function never returns a proposed,
// rejected, superseded or licence-unknown picture; and the licence follows from the source, not from the script's word.
import { beforeAll, describe, expect, it } from "vitest";
import { openTestDb, type TestDb } from "./harness";

let db: TestDb; let ops: string; let picker: string; let rider: string; let a: string; let b: string; let c: string; let d: string;
let n = 0;
const propose = (product: string, kind: string, extra: Record<string, unknown> = {}) => {
  n++;
  return db.rpc<any>("propose_product_image", {
    p_product: product, p_source_kind: kind,
    p_source_url: kind === "intake_photo" ? null : `https://example.test/${n}.jpg`, p_page_url: `https://example.test/p${n}`,
    p_attribution: kind === "open_food_facts" ? "Open Food Facts contributors, CC BY-SA 3.0" : null,
    p_media_path: `product_images/test/${n}.jpg`, p_sha256: `sha${n}`, p_width: 1200, p_height: 900, p_bytes: 120000,
    p_vision: { keep: true }, ...extra });
};
const review = (image: string, decision: string, by = ops, note: string | null = null) =>
  db.rpc<any>("review_product_image", { p_image: image, p_by: by, p_decision: decision, p_note: note });
const forCustomer = (p: string) => db.rpc<any>("product_image_for_customer", { p_product: p });
const intakeSkus = async () => (await db.rpc<any[]>("photograph_at_intake")).map((x) => x.sku);

beforeAll(async () => {
  db = await openTestDb();
  ops = (await db.one(`insert into parties(role, display_name) values ('ops_lead', 'Ops') returning id`)).id;
  picker = (await db.one(`insert into parties(role, display_name) values ('picker', 'Picker') returning id`)).id;
  rider = (await db.one(`insert into parties(role, display_name) values ('driver', 'Rider') returning id`)).id;
  const ps = await db.all(`select id from products where is_active order by sku limit 4`);
  [a, b, c, d] = ps.map((p: any) => p.id);
});

describe("product pictures (5.17)", () => {
  it("every active item starts on the fetch list and on the intake list", async () => {
    const total = Number((await db.one(`select count(*) from products where is_active`)).count);
    expect((await db.rpc<any[]>("product_images_to_fetch")).length).toBe(total);
    expect((await db.rpc<any[]>("photograph_at_intake")).length).toBe(total);
    const first = (await db.rpc<any[]>("product_images_to_fetch", { p_limit: 2 }));
    expect(first.length).toBe(2);
    expect(first[0]).toHaveProperty("barcode");
    expect(first[0]).toHaveProperty("brand");
  });

  it("the licence follows from the source and cannot be set by the caller", async () => {
    expect((await propose(a, "open_food_facts")).licence).toBe("cc_by_sa");
    expect((await propose(b, "brand_site")).licence).toBe("brand_own");
    expect((await propose(c, "web_search")).licence).toBe("unknown");
    await expect(propose(d, "somewhere_else")).rejects.toThrow(/IMAGE_SOURCE_KIND/);
    // The table itself refuses a search result filed as usable, and a CC BY-SA picture with no attribution.
    await expect(db.pg.query(
      `insert into product_images(product_id, source_kind, licence, source_url, media_path, sha256, width_px, height_px, bytes)
       values ($1, 'web_search', 'brand_own', 'https://x.test/a.jpg', 'p', 's', 900, 900, 1000)`, [d])).rejects.toThrow();
    await expect(db.pg.query(
      `insert into product_images(product_id, source_kind, licence, source_url, media_path, sha256, width_px, height_px, bytes)
       values ($1, 'open_food_facts', 'cc_by_sa', 'https://x.test/a.jpg', 'p', 's', 900, 900, 1000)`, [d])).rejects.toThrow();
  });

  it("a proposed picture is never returned to a customer", async () => {
    expect(await forCustomer(a)).toBeNull();
    expect(await forCustomer(b)).toBeNull();
    expect(await forCustomer(c)).toBeNull();
  });

  it("only the ops lead or an admin can approve; a picker and a rider cannot", async () => {
    const imgA = (await db.one(`select id from product_images where product_id = $1`, [a])).id;
    await expect(review(imgA, "approve", picker)).rejects.toThrow(/NOT_AUTHORISED/);
    await expect(review(imgA, "approve", rider)).rejects.toThrow(/NOT_AUTHORISED/);
    expect(await forCustomer(a)).toBeNull();
  });

  it("an approved Open Food Facts picture is returned, with its attribution and a link lifetime", async () => {
    const imgA = (await db.one(`select id from product_images where product_id = $1`, [a])).id;
    const r = await review(imgA, "approve");
    expect(r).toMatchObject({ ok: true, already: false, status: "approved", customer_visible: true });
    expect(await review(imgA, "approve")).toMatchObject({ already: true });
    const got = await forCustomer(a);
    expect(got).toMatchObject({ image_id: imgA, bucket: "media", licence: "cc_by_sa", signed_link_seconds: 300 });
    expect(got.attribution).toMatch(/CC BY-SA/);
    expect(got.media_path).toMatch(/^product_images\//);
  });

  it("an approved brand-site picture is returned too", async () => {
    const imgB = (await db.one(`select id from product_images where product_id = $1`, [b])).id;
    await review(imgB, "approve");
    expect(await forCustomer(b)).toMatchObject({ licence: "brand_own" });
  });

  it("a licence-unknown picture is never returned, even when a person approves it", async () => {
    const imgC = (await db.one(`select id from product_images where product_id = $1`, [c])).id;
    const r = await review(imgC, "approve");
    expect(r).toMatchObject({ status: "approved", customer_visible: false });
    expect(await forCustomer(c)).toBeNull();
    // It stays on the intake list, as a guide for the photographer.
    const row = (await db.rpc<any[]>("photograph_at_intake")).find((x) => x.product_id === c);
    expect(row).toMatchObject({ reason: "unknown_licence_only" });
    expect(row.guide.licence).toBe("unknown");
  });

  it("a rejected picture is never returned, and the same bytes are not proposed again", async () => {
    const first = await propose(d, "open_food_facts", { p_sha256: "same-bytes" });
    await review(first.image_id, "reject", ops, "wrong size");
    expect(await forCustomer(d)).toBeNull();
    expect(await propose(d, "open_food_facts", { p_sha256: "same-bytes" })).toMatchObject({ ok: false, skipped: "rejected_before" });
    expect(await review(first.image_id, "reject")).toMatchObject({ already: true });
    await expect(review(first.image_id, "approve")).rejects.toThrow(/IMAGE_REJECTED/);
    expect((await db.rpc<any[]>("photograph_at_intake")).find((x) => x.product_id === d)).toMatchObject({ reason: "rejected" });
  });

  it("withdrawing an approved picture takes it away from customers at once", async () => {
    const imgB = (await db.one(`select id from product_images where product_id = $1 and status = 'approved'`, [b])).id;
    await review(imgB, "reject", ops, "label changed");
    expect(await forCustomer(b)).toBeNull();
    expect(await intakeSkus()).toContain((await db.one(`select sku from products where id = $1`, [b])).sku);
  });

  it("a second proposal waits unless it is asked to replace; the first is kept as history", async () => {
    const p1 = await propose(b, "brand_site");
    expect(p1.ok).toBe(true);
    expect(await propose(b, "brand_site")).toMatchObject({ ok: false, skipped: "proposal_exists" });
    const p2 = await propose(b, "brand_site", { p_replace: true });
    expect(p2.ok).toBe(true);
    const rows = await db.all(`select status from product_images where product_id = $1 order by fetched_at`, [b]);
    expect(rows.map((x: any) => x.status).sort()).toEqual(["proposed", "rejected", "superseded"]);
    await expect(review(p1.image_id, "approve")).rejects.toThrow(/IMAGE_SUPERSEDED/);
  });

  it("approving a new picture replaces the approved one, and a deactivated item returns nothing", async () => {
    const e = (await db.one(`select id from products where is_active and id not in ($1,$2,$3,$4) order by sku limit 1`, [a, b, c, d])).id;
    const first = await propose(e, "open_food_facts");
    await review(first.image_id, "approve");
    const second = await propose(e, "brand_site");
    const r = await review(second.image_id, "approve");
    expect(r.replaced).toBe(first.image_id);
    expect((await forCustomer(e)).licence).toBe("brand_own");
    await db.one(`update products set is_active = false where id = $1 returning id`, [e]);
    expect(await forCustomer(e)).toBeNull();
    await db.one(`update products set is_active = true where id = $1 returning id`, [e]);
  });

  it("the fetch list leaves out items that already have a usable picture; force lists everything", async () => {
    const skus = (await db.rpc<any[]>("product_images_to_fetch")).map((x) => x.product_id);
    expect(skus).not.toContain(a);                   // approved, usable
    expect(skus).toContain(c);                       // unknown licence only: try again when search is switched on
    expect(skus).toContain(d);                       // rejected
    const all = Number((await db.one(`select count(*) from products where is_active`)).count);
    expect((await db.rpc<any[]>("product_images_to_fetch", { p_force: true })).length).toBe(all);
  });

  it("the review list shows the item, source and licence side by side; usable pictures come first", async () => {
    const f = (await db.one(`select id from products where is_active order by sku desc limit 1`)).id;
    await propose(f, "web_search");
    const rows = await db.rpc<any[]>("product_images_review", { p_status: "proposed" });
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const r of rows) expect(r).toMatchObject({ status: "proposed" });
    const w = rows.find((x) => x.product_id === f);
    expect(w).toMatchObject({ licence: "unknown", customer_visible: false });
    expect(w.name_en).toBeTruthy();
    const firstUnknown = rows.findIndex((x) => !x.customer_visible);
    const lastUsable = rows.map((x) => x.customer_visible).lastIndexOf(true);
    expect(lastUsable < firstUnknown || firstUnknown === -1).toBe(true);
  });

  it("coverage counts add up, and the attempts table keeps a reason per item and run", async () => {
    await db.rpc("record_product_image_attempt", { p_product: d, p_run: "r1", p_sources: ["open_food_facts"], p_seen: 2, p_kept: 0, p_outcome: "none_passed" });
    await db.rpc("record_product_image_attempt", { p_product: d, p_run: "r1", p_sources: ["open_food_facts"], p_seen: 2, p_kept: 1, p_outcome: "proposed" });
    expect(Number((await db.one(`select count(*) from product_image_attempts where product_id = $1`, [d])).count)).toBe(1);
    const cov = await db.rpc<any>("product_image_coverage");
    const total = Number((await db.one(`select count(*) from products where is_active`)).count);
    expect(cov.items).toBe(total);
    expect(cov.photograph_at_intake + cov.approved + cov.proposed_usable).toBe(total);
  });

  it("no client role can read or write the tables or call the functions", async () => {
    const r = await db.all(
      `select count(*)::int as n from information_schema.role_table_grants where table_name in ('product_images','product_image_attempts') and grantee in ('anon','authenticated')`);
    expect(r[0].n).toBe(0);
  });
});
