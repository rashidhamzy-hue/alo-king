// The fetch pipeline against the real migrations (PGlite): argument names, licence pairing, what is proposed and what is left.
// Network, storage and the model are replaced; the SQL is the SQL that ships.
import { beforeAll, describe, expect, it } from "vitest";
import { openTestDb } from "../../../test/db/harness";
import { processItem, evaluate, Fatal, MAX_CANDIDATES, fetchableUrl, conclusiveSkips } from "../fetch-images.mjs";

const GOOD = { same_brand: "yes", same_product: "yes", same_size: "yes", one_pack: "yes", plain_background: "yes", watermark_or_overlay_text: "no", price_tag_or_shop_logo: "no", seen: "x" };
let db; let items; let uploads;

const mk = (over = {}) => {
  let n = 0;
  const calls = { off: 0, brand: 0, open: 0, check: 0 };
  const cand = (kind, tag, extra = {}) => ({ sourceKind: kind, imageUrl: `https://img.test/${tag}-${++n}.jpg`, pageUrl: `https://img.test/page-${tag}`, attribution: kind === "open_food_facts" ? "Open Food Facts contributors, CC BY-SA 3.0, https://world.openfoodfacts.org/product/1" : null, ...extra });
  const d = {
    runId: "run-1", model: "fast-model", searchOn: true, sharp: null,
    download: async (u) => Buffer.from(u),
    measure: async () => ({ width: 1000, height: 1000, format: "jpeg" }),
    shrink: async (buf) => ({ data: buf, width: 1000, height: 1000, bytes: buf.length, sha256: Buffer.from(buf).toString("hex").slice(-40).padStart(64, "0") }),
    check: async () => { calls.check++; return GOOD; },
    off: async () => { calls.off++; return [cand("open_food_facts", "off")]; },
    brand: async () => { calls.brand++; return []; },
    open: async () => { calls.open++; return [cand("web_search", "web")]; },
    store: { async rpc(fn, args) { return db.rpc(fn, args); }, async upload(path) { uploads.push(path); } },
    ...over };
  return { d, calls, cand };
};

beforeAll(async () => {
  db = await openTestDb();
  items = (await db.rpc("product_images_to_fetch")).filter((i) => i.barcode).slice(0, 12);
});

describe("fetch pipeline (5.17 steps 2-5)", () => {
  it("Open Food Facts first: a passing picture is proposed as CC BY-SA with its attribution, and search is never asked", async () => {
    uploads = [];
    const { d, calls } = mk();
    const r = await processItem(items[0], d);
    expect(r).toMatchObject({ outcome: "proposed", source_kind: "open_food_facts", licence: "cc_by_sa" });
    expect(calls).toMatchObject({ off: 1, brand: 0, open: 0, check: 1 });
    const row = await db.one(`select * from product_images where product_id = $1`, [items[0].product_id]);
    expect(row).toMatchObject({ status: "proposed", licence: "cc_by_sa", source_kind: "open_food_facts", width_px: 1000 });
    expect(row.attribution).toMatch(/CC BY-SA/);
    expect(row.media_path).toBe(uploads[0]);
    expect(row.media_path).toMatch(new RegExp(`^product_images/${items[0].sku}/[0-9a-f-]+\\.jpg$`));
    expect(row.vision.report.same_brand).toBe("yes");
    const att = await db.one(`select * from product_image_attempts where product_id = $1`, [items[0].product_id]);
    expect(att).toMatchObject({ outcome: "proposed", seen: 1, kept: 1 });
    expect(await db.rpc("product_image_for_customer", { p_product: items[0].product_id })).toBeNull();   // proposed: not visible
  });

  it("when Open Food Facts has nothing that passes, search runs; its picture is licence unknown and stays off the customer side", async () => {
    uploads = [];
    const calls = { n: 0 };
    const { d } = mk({ check: async (_i, jpeg) => (jpeg.toString().includes("off") ? { ...GOOD, same_size: "no" } : GOOD) });
    const r = await processItem(items[1], d);
    expect(r).toMatchObject({ outcome: "proposed", source_kind: "web_search", licence: "unknown" });
    const row = await db.one(`select * from product_images where product_id = $1`, [items[1].product_id]);
    expect(row).toMatchObject({ licence: "unknown", source_kind: "web_search" });
    const rows = await db.rpc("product_images_review");
    expect(rows.find((x) => x.product_id === items[1].product_id)).toMatchObject({ customer_visible: false });
    expect((await db.rpc("photograph_at_intake")).find((x) => x.product_id === items[1].product_id)).toMatchObject({ reason: "unknown_licence_only" });
    void calls;
  });

  it("a usable picture beats a bigger unknown one", async () => {
    const { d } = mk({
      searchOn: true,
      off: async () => [{ sourceKind: "open_food_facts", imageUrl: "https://img.test/off-a.jpg", pageUrl: "p", attribution: "a CC BY-SA" }],
      brand: async () => [{ sourceKind: "brand_site", imageUrl: "https://brand.test/b.jpg", pageUrl: "https://brand.test/p", attribution: null }],
      check: async (_i, jpeg) => (jpeg.toString().includes("off-a") ? { ...GOOD, one_pack: "no" } : GOOD),
      measure: async () => ({ width: 1500, height: 1500, format: "jpeg" }) });
    const r = await processItem(items[2], d);
    expect(r).toMatchObject({ outcome: "proposed", source_kind: "brand_site", licence: "brand_own" });
  });

  it("no candidate at all is none_found; every candidate failing is none_passed with the reasons", async () => {
    const a = await processItem(items[3], mk({ off: async () => [], open: async () => [] }).d);
    expect(a.outcome).toBe("none_found");
    const { d } = mk({ check: async () => ({ ...GOOD, watermark_or_overlay_text: "yes", price_tag_or_shop_logo: "yes" }) });
    const b = await processItem(items[4], d);
    expect(b).toMatchObject({ outcome: "none_passed" });
    expect(b.reasons).toContain("watermark_or_text");
    expect(await db.one(`select count(*)::int n from product_images where product_id = $1`, [items[4].product_id])).toMatchObject({ n: 0 });
    expect(await db.one(`select outcome from product_image_attempts where product_id = $1`, [items[4].product_id])).toMatchObject({ outcome: "none_passed" });
  });

  it("a narrow picture is dropped before the model is asked", async () => {
    const { d, calls } = mk({ measure: async () => ({ width: 799, height: 900, format: "jpeg" }), searchOn: false });
    const r = await processItem(items[5], d);
    expect(r.outcome).toBe("none_passed");
    expect(calls.check).toBe(0);
  });

  it("at most five candidates are looked at per item, across all sources", async () => {
    const { d, calls } = mk({
      off: async () => Array.from({ length: 4 }, (_, i) => ({ sourceKind: "open_food_facts", imageUrl: `https://img.test/o${i}.jpg`, pageUrl: "p", attribution: "CC BY-SA" })),
      open: async () => Array.from({ length: 4 }, (_, i) => ({ sourceKind: "web_search", imageUrl: `https://img.test/w${i}.jpg`, pageUrl: "p", attribution: null })),
      check: async () => { calls.check++; return { ...GOOD, same_product: "no" }; } });
    await processItem(items[6], d);
    expect(calls.check).toBe(MAX_CANDIDATES);
  });

  it("an item with no barcode skips Open Food Facts; without a search key only Open Food Facts runs", async () => {
    const { d, calls } = mk({ searchOn: false });
    await processItem({ ...items[7], barcode: null }, d);
    expect(calls).toMatchObject({ off: 0, brand: 0, open: 0 });
    const m = mk({ searchOn: false });
    await processItem(items[7], m.d);
    expect(m.calls).toMatchObject({ off: 1, brand: 0, open: 0 });
  });

  it("a picture a person rejected is not proposed again", async () => {
    const ops = (await db.one(`insert into parties(role, display_name) values ('ops_lead', 'Ops') returning id`)).id;
    const id = (await db.one(`select id from product_images where product_id = $1`, [items[0].product_id])).id;
    await db.rpc("review_product_image", { p_image: id, p_by: ops, p_decision: "reject", p_note: "no" });
    const sha = (await db.one(`select sha256 from product_images where id = $1`, [id])).sha256;
    const { d } = mk({ shrink: async (buf) => ({ data: buf, width: 1000, height: 1000, bytes: 5, sha256: sha }) });
    const r = await processItem(items[0], d);
    expect(r).toMatchObject({ outcome: "skipped_rejected" });
  });

  it("a rejected key on the model is fatal for the run; a bad picture or a slow host is not", async () => {
    await expect(processItem(items[8], mk({ check: async () => { throw new Error("vision_http_401"); } }).d)).rejects.toBeInstanceOf(Fatal);
    const r = await processItem(items[9], mk({ download: async () => { throw new Error("download_404"); }, searchOn: false }).d);
    expect(r.outcome).toBe("none_passed");
    expect(r.reasons[0]).toMatch(/^error:download_404/);
    const e = await processItem(items[10], mk({ store: { rpc: async (fn) => { if (fn === "propose_product_image") throw new Error("boom"); return {}; }, upload: async () => {} } }).d);
    expect(e.outcome).toBe("error");
  });

  it("a failed Open Food Facts lookup is an error with its message, never 'none found'", async () => {
    const { d } = mk({ off: async () => { throw new Error("off_http_429"); }, searchOn: false });
    const r = await processItem(items[11], d);
    expect(r).toMatchObject({ outcome: "error", error: "off_http_429" });
    const att = await db.one(`select outcome, detail from product_image_attempts where product_id = $1`, [items[11].product_id]);
    expect(att.outcome).toBe("error");
    expect(att.detail.errors[0]).toMatchObject({ stage: "open_food_facts", error: "off_http_429" });
  });

  it("only https pictures on public host names are fetched", () => {
    expect(fetchableUrl("https://img.test/a.jpg")).toBe(true);
    for (const u of ["http://img.test/a.jpg", "https://127.0.0.1/a.jpg", "https://169.254.169.254/x", "https://[::1]/a", "https://localhost/a", "file:///etc/passwd"]) expect(fetchableUrl(u)).toBe(false);
  });

  it("evaluate never throws for a broken picture", async () => {
    const out = await evaluate(items[0], { sourceKind: "web_search", imageUrl: "https://img.test/x.jpg" }, { download: async () => Buffer.from("x"), measure: async () => { throw new Error("not_an_image"); } });
    expect(out).toMatchObject({ kept: false, reasons: ["error:not_an_image"] });
  });
});

describe("reruns", () => {
  const A = (product_id, outcome, sources_tried) => ({ product_id, outcome, sources_tried });
  it("skip items an earlier run finished with nothing, never items that errored", () => {
    const attempts = [A("a", "none_found", ["open_food_facts"]), A("b", "none_passed", ["open_food_facts"]), A("c", "error", []), A("d", "proposed", ["open_food_facts"])];
    expect([...conclusiveSkips(attempts, false)].sort()).toEqual(["a", "b"]);
  });
  it("when search is switched on, an Open-Food-Facts-only result is not conclusive", () => {
    const attempts = [A("a", "none_found", ["open_food_facts"]), A("b", "none_passed", ["open_food_facts", "brand_site", "web_search"])];
    expect([...conclusiveSkips(attempts, true)]).toEqual(["b"]);
  });
  it("reads attempts through the real table with the service role shape (the select helper builds the address)", async () => {
    const { makeStore } = await import("../lib/store.mjs");
    let seen;
    const st = makeStore({ url: "https://p.supabase.co", key: "k", fetchImpl: async (u, o) => { seen = { u, h: o.headers }; return new Response("[]", { status: 200 }); } });
    expect(await st.select("product_image_attempts", "select=product_id")).toEqual([]);
    expect(seen.u).toBe("https://p.supabase.co/rest/v1/product_image_attempts?select=product_id");
    expect(seen.h.apikey).toBe("k");
  });
});
