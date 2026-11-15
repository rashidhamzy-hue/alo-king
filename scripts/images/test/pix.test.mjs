// Session PIX: duplicates, ranking, the queue report. Real resizing where sharp is installed (scripts/images: npm ci).
import { describe, expect, it } from "vitest";
import { dhash, hamming, makeRegistry, loadRegistry, NEAR } from "../lib/dedupe.mjs";
import { loadSharp, shrink } from "../lib/image.mjs";
import { processItem, evaluate, salesBySku, rankItems } from "../fetch-images.mjs";
import { buildReport, reasonFor, markdown } from "../report.mjs";

const sharp = await loadSharp();
const GOOD = { same_brand: "yes", same_product: "yes", same_size: "yes", one_pack: "yes", plain_background: "yes", watermark_or_overlay_text: "no", price_tag_or_shop_logo: "no", seen: "x" };

// A made-up "pack": a coloured rectangle on white, at any size. Different seeds are different packs.
async function pack(seed, w = 900, h = 900, format = "jpeg", quality = 90) {
  const bw = 200 + (seed * 53) % 300, bh = 250 + (seed * 97) % 350, x = 100 + (seed * 31) % 150, y = 60 + (seed * 71) % 120;
  const rect = await sharp({ create: { width: Math.round(bw * w / 900), height: Math.round(bh * h / 900), channels: 3, background: { r: (seed * 67) % 256, g: (seed * 131) % 256, b: (seed * 29) % 256 } } }).png().toBuffer();
  return sharp({ create: { width: w, height: h, channels: 3, background: "#ffffff" } })
    .composite([{ input: rect, left: Math.round(x * w / 900), top: Math.round(y * h / 900) }])[format]({ quality }).toBuffer();
}

describe.skipIf(!sharp)("the same picture, whatever its size or format, is a duplicate; another pack is not", () => {
  it("a resize, a re-encode and a PNG stay within the near-duplicate distance", async () => {
    const master = await pack(7, 1800, 1800, "png");
    const a = await dhash(master, sharp);
    expect(a).toMatch(/^[0-9a-f]{1536}$/);
    const small = (w, q) => sharp(master).resize(w).jpeg({ quality: q }).toBuffer();
    for (const other of [await small(1200, 85), await small(600, 40), await small(900, 90), await sharp(master).resize(800).png().toBuffer(), (await shrink(master, sharp)).data]) {
      expect(hamming(a, await dhash(other, sharp))).toBeLessThanOrEqual(NEAR);
    }
  });
  it("different packs are far apart", async () => {
    const hashes = await Promise.all([1, 2, 3, 4, 5, 6, 8, 9, 10, 11].map(async (s) => dhash(await pack(s), sharp)));
    for (let i = 0; i < hashes.length; i++) for (let j = i + 1; j < hashes.length; j++) expect(hamming(hashes[i], hashes[j])).toBeGreaterThan(NEAR);
  });
});

describe("the registry", () => {
  const h = (v) => v.toString(16).padStart(2, "0").repeat(768);   // a flat grey thumbnail of value v: the distance between two is their difference
  it("refuses a picture another item holds or has reserved, never the item's own", () => {
    const r = makeRegistry();
    r.add("AK-1", h(0));
    expect(r.reserve("AK-2", h(3))).toMatchObject({ sku: "AK-1", distance: 3 });   // 3 apart: the same picture
    expect(r.reserve("AK-1", h(3))).toBeNull();                                      // its own picture again: fine
    expect(r.reserve("AK-3", h(200))).toBeNull();                                    // far away: fine
    expect(r.reserve("AK-4", h(200))).toMatchObject({ sku: "AK-3" });                // reserved by AK-3 a moment ago
  });
  it("gives back what an item reserved and did not use", () => {
    const r = makeRegistry();
    r.reserve("AK-3", h(200));
    r.release("AK-3", null);
    expect(r.reserve("AK-4", h(200))).toBeNull();
    r.release("AK-4", h(200));                                                       // AK-4 kept it
    expect(r.reserve("AK-5", h(200))).toMatchObject({ sku: "AK-4" });
  });
  it("a hash it cannot compare is never a match", () => { expect(hamming("zz", "zz")).toBe(Infinity); expect(hamming("00", "0000")).toBe(Infinity); });
  it("loads what is proposed or approved, hashing a stored picture that has no hash yet", async () => {
    const calls = [];
    const store = { select: async () => [{ product_id: "p1", status: "proposed", media_path: "a.jpg", phash: h(1), products: { sku: "AK-1" } }, { product_id: "p2", status: "approved", media_path: "b.jpg", phash: null, products: { sku: "AK-2" } },
      { product_id: "p3", status: "proposed", media_path: "c.jpg", phash: null, products: { sku: "AK-3" } }],
      download: async (path) => { calls.push(path); if (path === "c.jpg") throw new Error("download_404"); return Buffer.from("pic"); } };
    const reg = makeRegistry();
    const out = await loadRegistry(reg, store, null, async () => h(50));
    expect(out).toEqual({ loaded: 2, backfilled: 1, failed: 1 });   // p3's picture could not be read: skipped, not fatal
    expect(calls).toEqual(["b.jpg", "c.jpg"]);
    expect(reg.reserve("AK-9", h(50))).toMatchObject({ sku: "AK-2", distance: 0 });
  });
});

describe("a duplicate is refused before the paid check", () => {
  const item = { sku: "AK-9", name_en: "x", product_id: "p9" };
  it("evaluate stops at the duplicate and never asks the model", async () => {
    const registry = makeRegistry(); registry.add("AK-1", "00".repeat(768));
    let asked = 0;
    const d = { registry, hash: async () => "00".repeat(767) + "03", download: async () => Buffer.from("x"), measure: async () => ({ width: 1000, height: 1000 }), shrink: async (b) => ({ data: b, width: 1200, height: 1200, bytes: 1, sha256: "a".repeat(64) }), check: async () => { asked++; return GOOD; } };
    const out = await evaluate(item, { sourceKind: "public_page", imageUrl: "https://i.test/a.jpg", pageUrl: "https://i.test/p" }, d);
    expect(out).toMatchObject({ kept: false, reasons: ["duplicate:AK-1"], duplicate_of: "AK-1", distance: 0 });
    expect(asked).toBe(0);
  });
  it("two items running side by side cannot both take one picture; the loser's reservation is released", async () => {
    const registry = makeRegistry();
    const mkD = () => ({ registry, hash: async () => "a0".repeat(768), download: async () => Buffer.from("x"), measure: async () => ({ width: 1000, height: 1000 }), shrink: async (b) => ({ data: b, width: 1200, height: 1200, bytes: 1, sha256: "b".repeat(64) }), check: async () => GOOD });
    const cand = { sourceKind: "public_page", imageUrl: "https://i.test/a.jpg", pageUrl: "https://i.test/p" };
    const [a, b] = await Promise.all([evaluate({ sku: "AK-1" }, cand, mkD()), evaluate({ sku: "AK-2" }, cand, mkD())]);
    expect([a.kept, b.kept].sort()).toEqual([false, true]);
    const loser = a.kept ? b : a;
    expect(loser.reasons[0]).toMatch(/^duplicate:AK-[12]$/);
  });
});

describe("fastest sellers first", () => {
  const csv = 'SKU,Item,Brand,Tawfeer units sold,Note\nAK-0001,Potato,"Local, unbranded",39403,"a, b"\nAK-0002,Tomato,x,21770,\nAK-0003,Pack,x,5,\nAK-0004,New,x,,\n';
  it("reads units by SKU, quotes and empty cells included", () => {
    expect([...salesBySku(csv).entries()]).toEqual([["AK-0001", 39403], ["AK-0002", 21770], ["AK-0003", 5], ["AK-0004", 0]]);
    expect(() => salesBySku("SKU,Item\nA,b")).toThrow(/column missing/);
  });
  it("puts the fastest first, whatever order the database gave, and unknown SKUs last", () => {
    const items = ["AK-0003", "AK-0001", "AK-0099", "AK-0002", "AK-0004"].map((sku) => ({ sku }));
    const out = rankItems(items, salesBySku(csv));
    expect(out.map((i) => i.sku)).toEqual(["AK-0001", "AK-0002", "AK-0003", "AK-0004", "AK-0099"]);
    expect(out.map((i) => i.rank)).toEqual([1, 2, 3, 4, null]);
  });
  it("the real catalog file ranks Potato, Tomato and Cucumber first", async () => {
    const { readFileSync } = await import("node:fs");
    const m = salesBySku(readFileSync(new URL("../../../supabase/seed/catalog.csv", import.meta.url), "utf8"));
    expect(m.size).toBe(291);
    expect(rankItems([...m.keys()].map((sku) => ({ sku })), m).slice(0, 3).map((i) => i.sku)).toEqual(["AK-0001", "AK-0002", "AK-0003"]);
  });
});

describe("the queue report names a reason for every item without a candidate", () => {
  const products = [1, 2, 3, 4, 5, 6].map((n) => ({ id: `p${n}`, sku: `AK-000${n}`, name_en: `Item ${n}` }));
  const sales = new Map(products.map((p, i) => [p.sku, 100 - i]));
  const img = (n, status, extra = {}) => ({ product_id: `p${n}`, status, source_kind: "public_page", licence: "public_page", source_url: "https://cdn.shop.test/a.jpg", page_url: "https://www.shop.test/p", fetched_at: "2026-11-15T10:00:00Z", width_px: 1200, height_px: 1200, ...extra });
  const att = (n, outcome, extra = {}) => ({ product_id: `p${n}`, run_id: "r1", outcome, sources_tried: ["open_food_facts", "web_search"], seen: 3, kept: 0, detail: {}, created_at: "2026-11-15T10:00:00Z", ...extra });
  const rep = buildReport({ products, sales,
    images: [img(1, "proposed"), img(2, "approved"), img(3, "proposed", { licence: "unknown", source_kind: "web_search" }), img(5, "rejected")],
    attempts: [att(3, "none_passed", { detail: { evaluated: [{ reasons: ["size"] }, { reasons: ["size", "background"] }] } }),
      att(4, "none_found"), att(4, "none_passed", { run_id: "r2", created_at: "2026-11-15T12:00:00Z", detail: { evaluated: [{ reasons: ["duplicate:AK-0001"], duplicate_of: "AK-0001" }] } }), att(5, "skipped_rejected")] });
  it("counts the queue and what is approved", () => {
    expect(rep).toMatchObject({ items: 6, candidates_waiting: 1, approved: 1, no_candidate: 4, by_source: { public_page: 2 } });
  });
  it("a licence-unknown picture is not a candidate; the reason says what failed", () => {
    expect(rep.rows[2]).toMatchObject({ sku: "AK-0003", state: "no_candidate", reason_code: "none_passed" });
    expect(rep.rows[2].reason).toMatch(/size x2, background x1/);
  });
  it("the latest attempt decides; a duplicate names the other item", () => {
    expect(rep.rows[3]).toMatchObject({ sku: "AK-0004", reason_code: "duplicate" });
    expect(rep.rows[3].reason).toMatch(/same picture as AK-0001/);
  });
  it("an item only Open Food Facts could be asked about says the search key is missing", () => {
    const r = reasonFor({ outcome: "none_found", sources_tried: ["open_food_facts"], detail: {} });
    expect(r.code).toBe("search_off");
    expect(r.text).toMatch(/BRAVE_SEARCH_API_KEY/);
    expect(reasonFor({ outcome: "none_found", sources_tried: [], detail: {} }).text).toMatch(/no barcode/);
    expect(reasonFor({ outcome: "none_found", sources_tried: ["open_food_facts", "web_search"], detail: {} }).code).toBe("none_found");
  });
  it("an item no run has looked at is reported as unfinished, so the run is not called done", () => {
    expect(rep.rows[5]).toMatchObject({ sku: "AK-0006", reason_code: "not_tried" });
    expect(rep.unexplained).toBe(1);
    expect(reasonFor({ outcome: "error", detail: { error: "boom" } }).text).toMatch(/boom/);
  });
  it("lists the fastest first, with the page host and time of each candidate", () => {
    expect(rep.approve_first.map((r) => r.sku)).toEqual(["AK-0001", "AK-0002", "AK-0003", "AK-0004", "AK-0005", "AK-0006"]);
    expect(rep.rows[0]).toMatchObject({ state: "candidate", page_host: "shop.test", fetched_at: "2026-11-15T10:00:00Z" });
    expect(markdown(rep)).toMatch(/\| 1 \| AK-0001 \| Item 1 \| 100 \| candidate \|/);
  });
});
