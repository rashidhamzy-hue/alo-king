// PIX4, migration 0242: the founder's pictures in the approval queue. Nothing is approved by the import; a customer sees a picture only
// after a person approves it; "needs review" and "Later" are only marks; the list of items without a picture is by aisle.
import { beforeAll, describe, expect, it } from "vitest";
import { openTestDb, type TestDb } from "./harness";

let db: TestDb; let ops: string; let picker: string; let a: string; let b: string; let c: string;
let n = 0;
const importOne = (product: string, extra: Record<string, unknown> = {}) => {
  n++;
  return db.rpc<any>("propose_picture_import", {
    p_product: product, p_media_path: `product_images/test/${n}.webp`, p_sha256: `pix4-${n}`, p_width: 1000, p_height: 1000, p_bytes: 40000,
    p_source_note: `pictures-1: AK-test-${n}.jpg (report row ${n}; no picture address recorded)`, ...extra });
};

beforeAll(async () => {
  db = await openTestDb();
  ops = (await db.one(`insert into parties(role, display_name) values ('ops_lead', 'Ops') returning id`)).id;
  picker = (await db.one(`insert into parties(role, display_name) values ('picker', 'Picker') returning id`)).id;
  [a, b, c] = (await db.all(`select id from products where is_active order by sku limit 3`)).map((p: any) => p.id);
});

describe("PIX4 picture queue (0242)", () => {
  it("proposes a founder upload with its note, no address, and nothing is approved or visible", async () => {
    const r = await importOne(a, { p_needs_review: true, p_check_notes: ["duplicate:AK-0002"], p_vision: { phash: "00" } });
    expect(r.ok).toBe(true);
    const row = await db.one(`select status, source_kind, licence, source_url, page_url, needs_review, check_notes, source_note from product_images where id = $1`, [r.image_id]);
    expect(row).toMatchObject({ status: "proposed", source_kind: "founder_upload", licence: "founder_supplied", source_url: null, page_url: null, needs_review: true });
    expect(row.check_notes).toEqual(["duplicate:AK-0002"]);
    expect(row.source_note).toContain("pictures-1");
    expect(await db.rpc("product_image_for_customer", { p_product: a })).toBeNull();
    const list = await db.rpc<any[]>("product_images_review", { p_status: "proposed", p_limit: 50 });
    expect(list.find((x) => x.image_id === r.image_id)).toMatchObject({ needs_review: true, check_notes: ["duplicate:AK-0002"], deferred_at: null });
  });

  it("needs a note of where it came from, and https addresses only", async () => {
    await expect(importOne(b, { p_source_note: "  " })).rejects.toThrow(/NEEDS_A_SOURCE_NOTE/);
    await expect(importOne(b, { p_source_url: "http://shop.example/x.jpg" })).rejects.toThrow(/NOT_HTTPS/);
    await expect(importOne(b, { p_page_url: "javascript:alert(1)" })).rejects.toThrow(/NOT_HTTPS/);
    const ok = await importOne(b, { p_source_url: "https://shop.example/x.jpg", p_page_url: "https://shop.example/p" });
    expect((await db.one(`select source_url, page_url from product_images where id = $1`, [ok.image_id]))).toEqual({ source_url: "https://shop.example/x.jpg", page_url: "https://shop.example/p" });
  });

  it("a person approves it, then a customer sees it; a second import never replaces an approved picture", async () => {
    const id = (await db.one(`select id from product_images where product_id = $1 and status = 'proposed'`, [a])).id;
    await expect(db.rpc("review_product_image", { p_image: id, p_by: picker, p_decision: "approve" })).rejects.toThrow(/NOT_AUTHORISED/);
    const r = await db.rpc<any>("review_product_image", { p_image: id, p_by: ops, p_decision: "approve" });
    expect(r.customer_visible).toBe(true);
    expect((await db.rpc<any>("product_image_for_customer", { p_product: a })).image_id).toBe(id);
    expect(await importOne(a)).toMatchObject({ ok: false, skipped: "already_approved" });
  });

  it("running again replaces the earlier import's proposal (history kept), skips the same bytes and a rejected picture", async () => {
    const first = (await db.one(`select id, sha256 from product_images where product_id = $1 and status = 'proposed'`, [b]));
    expect(await importOne(b, { p_sha256: first.sha256 })).toMatchObject({ ok: false, skipped: "same_picture" });
    const again = await importOne(b);
    expect(again.ok).toBe(true);
    expect((await db.one(`select status from product_images where id = $1`, [first.id])).status).toBe("superseded");
    await db.rpc("review_product_image", { p_image: again.image_id, p_by: ops, p_decision: "reject", p_note: "wrong pack" });
    const sha = (await db.one(`select sha256 from product_images where id = $1`, [again.image_id])).sha256;
    expect(await importOne(b, { p_sha256: sha })).toMatchObject({ ok: false, skipped: "rejected_before" });
  });

  it("does not touch another source's proposal", async () => {
    await db.rpc("propose_product_image", { p_product: c, p_source_kind: "open_food_facts", p_source_url: "https://example.test/c.jpg", p_page_url: "https://example.test/c",
      p_attribution: "Open Food Facts contributors, CC BY-SA 3.0", p_media_path: "product_images/test/c.jpg", p_sha256: "c1", p_width: 1200, p_height: 900, p_bytes: 1000 });
    expect(await importOne(c)).toMatchObject({ ok: false, skipped: "proposal_exists" });
  });

  it("Later puts a proposed picture aside and back; only a lead may; an approved one is left alone", async () => {
    const id = (await db.one(`select id from product_images where product_id = $1 and status = 'proposed'`, [c])).id;
    await expect(db.rpc("defer_product_image", { p_image: id, p_by: picker })).rejects.toThrow(/NOT_AUTHORISED/);
    expect(await db.rpc("defer_product_image", { p_image: id, p_by: ops })).toMatchObject({ ok: true, deferred: true });
    expect((await db.rpc<any[]>("product_images_review", { p_status: "proposed", p_limit: 50 })).find((x) => x.image_id === id).deferred_at).not.toBeNull();
    expect(await db.rpc("defer_product_image", { p_image: id, p_by: ops, p_undo: true })).toMatchObject({ ok: true, deferred: false });
    const approved = (await db.one(`select id from product_images where product_id = $1 and status = 'approved'`, [a])).id;
    expect(await db.rpc("defer_product_image", { p_image: approved, p_by: ops })).toMatchObject({ already: true, status: "approved" });
  });

  it("lists the items with no approved or proposed picture, by aisle, and drops the ones that have one", async () => {
    const miss = await db.rpc<any[]>("pictures_missing");
    const total = Number((await db.one(`select count(*) from products where is_active`)).count);
    expect(miss.length).toBe(total - 2);                              // a is approved, c is proposed; b was rejected and has none
    expect(miss.find((x) => x.product_id === b)).toMatchObject({ rejected_before: true });
    expect(miss.map((x) => x.product_id)).not.toContain(a);
    expect(miss.every((x) => typeof x.aisle_en === "string" && x.aisle_en.length > 0)).toBe(true);
    const aisles = miss.map((x) => x.aisle_code);
    expect(aisles.indexOf("")).toBeGreaterThanOrEqual(-1);
  });

  it("the coverage report counts the uploads, and the bucket size is null without a storage schema", async () => {
    const cov = await db.rpc<any>("product_image_coverage");
    expect(cov.founder_upload).toBeGreaterThanOrEqual(1);
    expect(cov).toHaveProperty("needs_review");
    expect(await db.rpc("storage_bucket_bytes", { p_bucket: "media" })).toBeNull();
  });
});
