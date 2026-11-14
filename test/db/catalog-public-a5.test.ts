// Session A5 (0115): the public `catalog` bucket holds approved pictures and nothing else. The Worker copies after approval and
// removes after withdrawal from the database's own list of work; the feed gives a public address only for a picture that is
// approved and copied. The bucket is an in-memory stand-in (public-store-kit.ts) that can only copy from the private `media`
// bucket, and records everything that was ever made public: "never public" is asserted over that whole record.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openFlowDb } from "./flow-kit";
import type { TestDb } from "./harness";
import { supabaseOver } from "./supabase-shim";
import { fakeStore } from "./public-store-kit";
import { catalogFeed, syncCatalogPictures } from "../../apps/gateway/src/catalog-feed";

let db: TestDb;
let ops: string;
const pid: Record<string, string> = {};
let n = 0;
/** Receipts and voice notes sit in the same private bucket as the pictures. None of them may ever reach the public one. */
const PRIVATE_ONLY = ["payment_proofs/p1/aaa.jpg", "voice_notes/p1/bbb.ogg", "receipts/2026/ccc.jpg", "voice_eval/shouf-51/ddd.ogg"];

async function propose(sku: string, kind: "intake_photo" | "open_food_facts" | "web_search" = "intake_photo") {
  n++;
  const media = `product_images/${sku}/${n}.${n % 2 ? "jpg" : "png"}`;
  const r = await db.rpc<any>("propose_product_image", { p_product: pid[sku], p_source_kind: kind,
    p_source_url: kind === "intake_photo" ? null : `https://example.test/${n}.jpg`, p_page_url: null,
    p_attribution: kind === "open_food_facts" ? "Open Food Facts contributors, CC BY-SA 3.0" : null,
    p_media_path: media, p_sha256: `sha-a5-${n}`, p_width: 1200, p_height: 1200, p_bytes: 100000, p_vision: {} });
  return { image: (r.image_id ?? r.id) as string, media };
}
const review = (image: string, decision: "approve" | "reject") => db.rpc("review_product_image", { p_image: image, p_by: ops, p_decision: decision, p_note: null });
const publicBase = (p: string) => `https://pub.test/storage/v1/object/public/catalog/${p}`;
const feedRows = async () => db.rpc<any[]>("catalog_feed");
const feedCsv = async (s: ReturnType<typeof fakeStore>) => (await catalogFeed(new Request("https://gw/catalog/feed.csv", { headers: { Authorization: `Basic ${btoa("meta:pw")}` } }),
  { db: supabaseOver(db).client, password: "pw", publicUrl: publicBase, store: s.store })).text();

beforeAll(async () => {
  ({ db } = await openFlowDb());
  ops = (await db.one(`insert into parties(role, display_name) values ('ops_lead', 'Ops') returning id`)).id;
  for (const sku of ["AK-0103", "AK-0080", "AK-0133", "AK-0001"]) pid[sku] = (await db.one(`select id from products where sku = $1`, [sku])).id;
  await db.pg.query(`update settings set value = value || '{"product_link": "https://wa.me/96100000000?text={sku}"}' where key = 'catalog'`);
}, 60_000);
beforeEach(async () => {
  // a clean slate: no picture, no book entry
  await db.pg.exec(`delete from catalog_public_pictures; delete from product_images; update products set is_active = true`);
});

describe("what is public", () => {
  it("a proposed picture is never copied, never in the feed, never public", async () => {
    const a = await propose("AK-0103");
    const s = fakeStore([a.media, ...PRIVATE_ONLY]);
    expect(await db.rpc("catalog_picture_work")).toEqual({ copy: [], remove: [] });
    const r = await syncCatalogPictures(supabaseOver(db).client, s.store, { reconcile: true });
    expect(r).toMatchObject({ copied: 0, removed: 0 });
    expect(s.catalog.size).toBe(0);
    expect(s.everPublic).toEqual([]);
    expect((await feedRows()).length).toBe(0);
  });

  it("an approved picture is copied once, and only then does the feed carry its stable public address", async () => {
    const a = await propose("AK-0103");
    await review(a.image, "approve");
    const s = fakeStore([a.media, ...PRIVATE_ONLY]);
    const csvBefore = await catalogFeed(new Request("https://gw/catalog/feed.csv", { headers: { Authorization: `Basic ${btoa("meta:pw")}` } }),
      { db: supabaseOver(db).client, password: "pw", publicUrl: publicBase });            // no store: nothing has been copied yet
    expect((await csvBefore.text()).trim().split("\n")).toHaveLength(1);                   // header only: an approved picture without a copy has no address
    const work = await db.rpc<any>("catalog_picture_work");
    expect(work.copy).toHaveLength(1);
    expect(work.copy[0].public_path).toBe(`AK-0103-${a.image}.${a.media.endsWith("png") ? "png" : "jpg"}`);
    const r = await syncCatalogPictures(supabaseOver(db).client, s.store);
    expect(r.copied).toBe(1);
    expect([...s.catalog.keys()]).toEqual([work.copy[0].public_path]);
    expect(s.everPublic).toEqual([a.media]);
    const csv = await feedCsv(s);
    expect(csv).toContain(publicBase(work.copy[0].public_path));
    // a second pass changes nothing, and the address is the same one
    expect(await syncCatalogPictures(supabaseOver(db).client, s.store)).toMatchObject({ copied: 0, removed: 0 });
    expect(await feedCsv(s)).toContain(publicBase(work.copy[0].public_path));
  });

  it("a picture whose licence a customer may not see is never public, even approved (search results, unknown licence)", async () => {
    const a = await propose("AK-0103", "web_search");
    await review(a.image, "approve");
    const s = fakeStore([a.media]);
    await syncCatalogPictures(supabaseOver(db).client, s.store, { reconcile: true });
    expect(s.everPublic).toEqual([]);
    expect(s.catalog.size).toBe(0);
  });

  it("a withdrawn picture leaves the feed at once and the bucket on the next pass, and is gone from the books", async () => {
    const a = await propose("AK-0103");
    await review(a.image, "approve");
    const s = fakeStore([a.media]);
    await syncCatalogPictures(supabaseOver(db).client, s.store);
    expect(s.catalog.size).toBe(1);
    const key = [...s.catalog.keys()][0]!;
    await review(a.image, "reject");                                                       // withdrawn
    // before the Worker has run: the database has already left it out of the feed (no approved picture, no row)
    expect((await feedRows()).length).toBe(0);
    expect((await db.rpc<any>("catalog_picture_work")).remove).toEqual([{ image_id: a.image, public_path: key }]);
    expect(await db.rpc<any>("catalog_public_report")).toMatchObject({ recorded: 1, expected: 0, to_remove: 1 });
    const r = await syncCatalogPictures(supabaseOver(db).client, s.store);
    expect(r.removed).toBe(1);
    expect(s.catalog.size).toBe(0);
    expect(await db.one(`select count(*)::int n from catalog_public_pictures`)).toEqual({ n: 0 });
    // and it can never come back by itself: a rejected picture is not approvable again
    await expect(review(a.image, "approve")).rejects.toThrow(/IMAGE_REJECTED/);
  });

  it("a newer approval replaces the old public copy: the old address is removed, a new one made", async () => {
    const a = await propose("AK-0103");
    await review(a.image, "approve");
    const s = fakeStore([a.media]);
    await syncCatalogPictures(supabaseOver(db).client, s.store);
    const oldKey = [...s.catalog.keys()][0]!;
    const b = await propose("AK-0103");
    s.media.set(b.media, "new bytes");
    await review(b.image, "approve");                                                      // supersedes a
    await syncCatalogPictures(supabaseOver(db).client, s.store);
    expect([...s.catalog.keys()]).toHaveLength(1);
    expect(s.catalog.has(oldKey)).toBe(false);
    expect([...s.catalog.keys()][0]).toContain(b.image);
  });

  it("an item that stops being active loses its public picture, and gets it back when it is active again", async () => {
    const a = await propose("AK-0103");
    await review(a.image, "approve");
    const s = fakeStore([a.media]);
    await syncCatalogPictures(supabaseOver(db).client, s.store);
    await db.pg.query(`update products set is_active = false where id = $1`, [pid["AK-0103"]]);
    await syncCatalogPictures(supabaseOver(db).client, s.store);
    expect(s.catalog.size).toBe(0);
    await db.pg.query(`update products set is_active = true where id = $1`, [pid["AK-0103"]]);
    await syncCatalogPictures(supabaseOver(db).client, s.store);
    expect(s.catalog.size).toBe(1);
  });

  it("a picture withdrawn while it is being copied is recorded, then removed by the next pass", async () => {
    const a = await propose("AK-0103");
    await review(a.image, "approve");
    const s = fakeStore([a.media]);
    const slow = { ...s.store, copy: async (f: string, t: string) => { await s.store.copy(f, t); await review(a.image, "reject"); } };
    await syncCatalogPictures(supabaseOver(db).client, slow);
    expect(s.catalog.size).toBe(1);                                                        // briefly in the bucket, but no feed row and no address given out
    expect((await feedRows()).length).toBe(0);
    await syncCatalogPictures(supabaseOver(db).client, s.store);
    expect(s.catalog.size).toBe(0);
  });
});

describe("the hourly pass", () => {
  it("removes an object the books do not know (older than ten minutes), keeps a fresh one, never touches a known one", async () => {
    const a = await propose("AK-0103");
    await review(a.image, "approve");
    const s = fakeStore([a.media, ...PRIVATE_ONLY]);
    await syncCatalogPictures(supabaseOver(db).client, s.store);
    const known = [...s.catalog.keys()][0]!;
    const old = new Date(Date.now() - 3600_000).toISOString();
    s.catalog.set("payment_proofs-p1-aaa.jpg", { bytes: "a receipt put there by mistake", createdAt: old });
    s.catalog.set("AK-0103-fresh.jpg", { bytes: "just copied, not yet recorded", createdAt: new Date().toISOString() });
    const r = await syncCatalogPictures(supabaseOver(db).client, s.store, { reconcile: true });
    expect(r.strays).toBe(1);
    expect([...s.catalog.keys()].sort()).toEqual([known, "AK-0103-fresh.jpg"].sort());
  });

  it("forgets a book entry whose object has vanished, so it is copied again and the feed does not point at a 404", async () => {
    const a = await propose("AK-0103");
    await review(a.image, "approve");
    const s = fakeStore([a.media]);
    await syncCatalogPictures(supabaseOver(db).client, s.store);
    s.catalog.clear();                                                                     // lost
    await db.pg.query(`update catalog_public_pictures set copied_at = now() - interval '1 hour'`);
    expect(await syncCatalogPictures(supabaseOver(db).client, s.store, { reconcile: true })).toMatchObject({ forgotten: 1 });
    expect(await syncCatalogPictures(supabaseOver(db).client, s.store)).toMatchObject({ copied: 1 });
    expect(s.catalog.size).toBe(1);
  });
});

describe("failures", () => {
  it("one picture that cannot be copied does not stop the others, is reported, and has no address in the feed", async () => {
    const a = await propose("AK-0103"); const b = await propose("AK-0080");
    await review(a.image, "approve"); await review(b.image, "approve");
    const s = fakeStore([b.media]);                                                        // a's private object is missing
    await expect(syncCatalogPictures(supabaseOver(db).client, s.store)).rejects.toThrow(/1 failed/);
    expect(s.catalog.size).toBe(1);
    const csv = (await feedCsv(s)).trim().split("\n");
    expect(csv.some((r) => r.startsWith("AK-0080,"))).toBe(true);
    expect(csv.some((r) => r.startsWith("AK-0103,"))).toBe(false);
  });

  it("the public bucket is only ever filled from a book entry's own picture: whatever else sits in media is never copied", async () => {
    const a = await propose("AK-0103"); const b = await propose("AK-0080");
    await review(a.image, "approve");                                                      // b stays proposed
    const s = fakeStore([a.media, b.media, ...PRIVATE_ONLY]);
    await syncCatalogPictures(supabaseOver(db).client, s.store, { reconcile: true });
    expect(s.everPublic).toEqual([a.media]);
    for (const k of [...PRIVATE_ONLY, b.media]) expect(s.everPublic).not.toContain(k);
  });
});

describe("the database functions", () => {
  it("catalog_public_path: a flat, stable key from sku, image id and the private key's extension", async () => {
    const id = "11111111-2222-3333-4444-555555555555";
    expect((await db.one(`select catalog_public_path('AK-1', $1::uuid, 'product_images/AK-1/9.PNG') p`, [id])).p).toBe(`AK-1-${id}.png`);
    expect((await db.one(`select catalog_public_path('AK-1', $1::uuid, 'product_images/AK-1/noext') p`, [id])).p).toBe(`AK-1-${id}.jpg`);
    expect((await db.one(`select catalog_public_path('AK-1', $1::uuid, 'x/y.svg') p`, [id])).p).toBe(`AK-1-${id}.jpg`);
  });
  it("is closed to the client roles: the book is written only through the functions", async () => {
    const r = await db.one(`select (select relrowsecurity from pg_class where relname = 'catalog_public_pictures') rls,
      (select count(*)::int from pg_proc where proname like 'catalog_picture_%' and not exists (select 1 from unnest(proconfig) c where c like 'search_path=%')) unpinned`);
    expect(r).toEqual({ rls: true, unpinned: 0 });
  });
});
