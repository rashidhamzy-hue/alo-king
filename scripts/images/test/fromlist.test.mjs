// Session PIX2: "from list" mode. The listed pictures are the only ones tried; the same checks apply; page and time are stored.
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { openTestDb } from "../../../test/db/harness";
import { processItem } from "../fetch-images.mjs";
import { parseCandidates, kindFor } from "../lib/fromlist.mjs";

const GOOD = { same_brand: "yes", same_product: "yes", same_size: "yes", one_pack: "yes", plain_background: "yes", watermark_or_overlay_text: "no", price_tag_or_shop_logo: "no", seen: "x" };
let db; let items;
beforeAll(async () => { db = await openTestDb(); items = await db.rpc("product_images_to_fetch"); });

const dFor = (listed, over = {}) => ({
  runId: "list-1", model: "fast", searchOn: false, sharp: null, listed,
  download: async (u) => Buffer.from(u),
  measure: async () => ({ width: 1000, height: 1000, format: "jpeg" }),
  shrink: async (buf) => ({ data: buf, width: 1000, height: 1000, bytes: buf.length, sha256: Buffer.from(buf).toString("hex").slice(-40).padStart(64, "0") }),
  check: async () => GOOD,
  off: async () => { throw new Error("must not be called"); }, brand: async () => { throw new Error("must not be called"); }, open: async () => { throw new Error("must not be called"); },
  store: { rpc: (fn, a) => db.rpc(fn, a), async upload() {} }, ...over });

describe("candidates file", () => {
  it("reads sku, image_url, page_url, found_at; drops rows without an https picture and page", () => {
    const { bySku, dropped } = parseCandidates("sku,image_url,page_url,found_at\nAK-1,https://a.test/1.jpg,https://a.test/p,2026-11-15T10:00Z\nAK-2,http://a.test/2.jpg,https://a.test/p,x\nAK-3,https://a.test/3.jpg,,x\n");
    expect([...bySku.keys()]).toEqual(["AK-1"]);
    expect(dropped).toBe(2);
    expect(bySku.get("AK-1")[0]).toMatchObject({ sourceKind: "public_page", foundAt: "2026-11-15T10:00Z" });
  });
  it("Open Food Facts pages keep CC BY-SA and attribution; other pages are public pages", () => {
    expect(kindFor("https://world.openfoodfacts.org/product/1")).toBe("open_food_facts");
    expect(kindFor("https://commons.wikimedia.org/wiki/File:X.jpg")).toBe("public_page");
    expect(kindFor("https://evilopenfoodfacts.org.example.com/x")).toBe("public_page");
  });
  it("the shipped list is well formed: every row has an https picture and page, and every sku exists in the catalog", () => {
    const { bySku, dropped } = parseCandidates(readFileSync("data/pictures/candidates.csv", "utf8"));
    expect(dropped).toBe(0);
    const skus = new Set(readFileSync("supabase/seed/catalog.csv", "utf8").split("\n").map((l) => l.split(",")[0]));
    for (const s of bySku.keys()) expect(skus.has(s), s).toBe(true);
    expect(bySku.size).toBeGreaterThan(50);
  });
});

describe("processItem from a list", () => {
  it("tries only the listed picture, files it with its page and time, and never searches", async () => {
    const { bySku } = parseCandidates(`sku,image_url,page_url,found_at\n${items[0].sku},https://img.test/a.jpg,https://shop.test/p/a,2026-11-15T09:00Z\n`);
    const r = await processItem(items[0], dFor(bySku));
    expect(r).toMatchObject({ outcome: "proposed", source_kind: "public_page" });
    const row = await db.one(`select * from product_images where product_id = $1`, [items[0].product_id]);
    expect(row).toMatchObject({ source_url: "https://img.test/a.jpg", page_url: "https://shop.test/p/a", status: "proposed" });
    expect(row.vision.listed_found_at).toBe("2026-11-15T09:00Z");
    expect(row.vision.retrieved_at).toBeTruthy();
  });
  it("the checks still decide: a wrong pack is not queued, and the reason is kept", async () => {
    const { bySku } = parseCandidates(`sku,image_url,page_url,found_at\n${items[1].sku},https://img.test/b.jpg,https://shop.test/p/b,t\n`);
    const r = await processItem(items[1], dFor(bySku, { check: async () => ({ ...GOOD, same_size: "no" }) }));
    expect(r.outcome).toBe("none_passed");
    expect(await db.rpc("product_image_for_customer", { p_product: items[1].product_id })).toBeNull();
    expect((await db.all(`select * from product_images where product_id = $1`, [items[1].product_id])).length).toBe(0);
  });
  it("an item that is not on the list has nothing to try", async () => {
    const r = await processItem(items[2], dFor(new Map()));
    expect(r.outcome).toBe("none_found");
  });
  it("a duplicate of a picture another item holds is refused before the paid check", async () => {
    let paid = 0;
    const { makeRegistry } = await import("../lib/dedupe.mjs");
    const reg = makeRegistry(); reg.add("AK-OTHER", "ab".repeat(768));
    const { bySku } = parseCandidates(`sku,image_url,page_url,found_at\n${items[3].sku},https://img.test/c.jpg,https://shop.test/p/c,t\n`);
    const r = await processItem(items[3], dFor(bySku, { registry: reg, hash: async () => "ab".repeat(768), check: async () => { paid++; return GOOD; } }));
    expect(r.outcome).toBe("none_passed"); expect(r.reasons).toContain("duplicate:AK-OTHER"); expect(paid).toBe(0);
  });
});
