// PIX4: the checks, the match and the conversion, on small pictures made here (no network, no model).
import { describe, expect, it, beforeAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSharp } from "../lib/image.mjs";
import { analyse, checkAnalysis, findDuplicates, matchFiles, parseReport, skuFromName, toWebp, dhash64, MAX_BYTES } from "../lib/importcheck.mjs";
import { dhash, makeRegistry } from "../lib/dedupe.mjs";
import { discover, plan, sourceNote, summarise, toCsv, toRows, missingMarkdown } from "../import-release.mjs";

let sharp;
beforeAll(async () => { sharp = await loadSharp(); });

/** A picture: a coloured block on a background, `size` px square (or w x h). */
async function pic({ w = 1000, h = 1000, bg = "#ffffff", block = "#c0392b", bx = 200, by = 150, bw = 600, bh = 700, format = "jpeg", noise = false } = {}) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${bg}"/>` +
    `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="${block}"/>${noise ? Array.from({ length: 40 }, (_, i) => `<circle cx="${(i * 97) % w}" cy="${(i * 53) % h}" r="12" fill="#336699"/>`).join("") : ""}</svg>`;
  return sharp(Buffer.from(svg)).toFormat(format, { quality: 90 }).toBuffer();
}

describe("file names and the report", () => {
  it("reads the product code from a file name, any case; nothing else counts", () => {
    expect(skuFromName("AK-0016_Cauliflower.jpg")).toBe("AK-0016");
    expect(skuFromName("ak-0123.png")).toBe("AK-0123");
    expect(skuFromName("cauliflower.jpg")).toBeNull();
    expect(skuFromName("AK-12.jpg")).toBeNull();
  });
  it("reads version 2 of the report, and a later one whose first column is 'product'", () => {
    const v2 = parseReport("SKU,Item,Brand,Barcode,Filename,Status,Image URL,Page URL,Query\nAK-0001,Potato,Local,,AK-0001_Potato.jpg,OK,,,\n");
    expect(v2[0]).toMatchObject({ row: 2, sku: "AK-0001", product: "Potato", filename: "AK-0001_Potato.jpg", status: "OK", imageUrl: "", pageUrl: "" });
    const v3 = parseReport('﻿Product,Query,Image URL,Page URL,Status,Filename\nAK-0002,"tomato, red",https://img.example/t.jpg,https://shop.example/t,OK,t.jpg\nMilk 1L,milk,,,REVIEW,milk.jpg\n');
    expect(v3[0]).toMatchObject({ sku: "AK-0002", query: "tomato, red", imageUrl: "https://img.example/t.jpg", pageUrl: "https://shop.example/t", filename: "t.jpg" });
    expect(v3[1]).toMatchObject({ sku: null, product: "Milk 1L", status: "REVIEW" });
  });
});

describe("matching: by code, else by the report's row, never a guess", () => {
  const skus = new Set(["AK-0001", "AK-0002", "AK-0003"]);
  const rep = parseReport("SKU,Item,Filename,Status\nAK-0003,Rice,rice.jpg,OK\nAK-0002,Tea,AK-0001_wrong.jpg,OK\n,Salt,salt.jpg,OK\n");
  const f = (name, folder = "product_images") => ({ name, folder });
  it("matches by code, by the report's row, and lists the rest with a reason", () => {
    const r = matchFiles([f("AK-0001_Potato.jpg"), f("rice.jpg"), f("salt.jpg"), f("mystery.jpg"), f("AK-0999_Ghost.jpg"), f("AK-0001_wrong.jpg")], rep, skus);
    expect(r.matched.map((m) => [m.sku, m.by])).toEqual([["AK-0001", "code"], ["AK-0003", "report"]]);
    expect(r.unmatched.map((u) => u.file).sort()).toEqual(["AK-0001_wrong.jpg", "AK-0999_Ghost.jpg", "mystery.jpg", "salt.jpg"]);
    expect(r.unmatched.find((u) => u.file === "AK-0001_wrong.jpg").reason).toContain("report says AK-0002");
    expect(r.unmatched.find((u) => u.file === "AK-0999_Ghost.jpg").reason).toContain("not in the catalogue");
  });
  it("two files for one product: neither is chosen", () => {
    const r = matchFiles([f("AK-0002_a.jpg"), f("AK-0002_b.jpg", "product_images_review")], [], skus);
    expect(r.matched).toEqual([]);
    expect(r.unmatched).toHaveLength(2);
    expect(r.unmatched[0].reason).toContain("2 files for AK-0002");
  });
});

describe("the checks", () => {
  it("a good picture passes: white background, the product fills the square", async () => {
    const a = await analyse(await pic(), sharp);
    expect(a).toMatchObject({ width: 1000, height: 1000, format: "jpeg" });
    expect(checkAnalysis(a)).toEqual([]);
  });
  it("under 600 px on the short side fails", async () => {
    const a = await analyse(await pic({ w: 500, h: 500, bx: 100, by: 80, bw: 300, bh: 350 }), sharp);
    expect(checkAnalysis(a).join()).toContain("small:500x500");
  });
  it("a coloured or grey background fails; near-white passes", async () => {
    expect(checkAnalysis(await analyse(await pic({ bg: "#b0b0b0" }), sharp)).join()).toContain("background:");
    expect(checkAnalysis(await analyse(await pic({ bg: "#2a6" }), sharp)).join()).toContain("background:");
    expect(checkAnalysis(await analyse(await pic({ bg: "#f4f4f2" }), sharp))).toEqual([]);
  });
  it("a product that is a speck in the square fails; a wide picture is padded and judged as stored", async () => {
    expect(checkAnalysis(await analyse(await pic({ bx: 450, by: 450, bw: 100, bh: 100 }), sharp)).join()).toContain("fill:");
    const wide = await analyse(await pic({ w: 1600, h: 800, bx: 100, by: 50, bw: 1400, bh: 700 }), sharp);
    expect(wide.fill).toBeGreaterThan(0.8);
    expect(checkAnalysis(wide)).toEqual([]);
  });
  it("a file that is not a picture, or not an allowed format, does not open", async () => {
    await expect(analyse(Buffer.from("not a picture"), sharp)).rejects.toThrow();
    const gif = await sharp(await pic()).gif().toBuffer();
    await expect(analyse(gif, sharp)).rejects.toThrow(/format_gif/);
  });
});

describe("the stored picture", () => {
  it("is 1000 x 1000 WebP under 80 KB, quality 80 when it fits, and carries no metadata", async () => {
    const src = await sharp(await pic({ w: 1400, h: 1400, bx: 250, by: 200, bw: 900, bh: 1000 })).withMetadata({ exif: { IFD0: { Copyright: "someone", Artist: "a person" } } }).jpeg().toBuffer();
    expect((await sharp(src).metadata()).exif).toBeTruthy();
    const w = await toWebp(src, sharp);
    const m = await sharp(w.data).metadata();
    expect(m).toMatchObject({ format: "webp", width: 1000, height: 1000 });
    expect(m.exif).toBeUndefined(); expect(m.icc).toBeUndefined(); expect(m.xmp).toBeUndefined();
    expect(w.bytes).toBeLessThan(MAX_BYTES); expect(w.quality).toBe(80); expect(w.heavy).toBe(false);
    expect(w.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it("steps the quality down to get under the limit, and says so when it cannot", async () => {
    const busy = await sharp(Buffer.from(Array.from({ length: 1000 * 1000 * 3 }, (_, i) => (i * 7919 + (i >> 3) * 13) & 255)), { raw: { width: 1000, height: 1000, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
    const w = await toWebp(busy, sharp);
    expect(w.quality).toBeLessThan(80);
    expect(w.heavy).toBe(w.bytes > MAX_BYTES);
  });
  it("pads a non-square picture on white and enlarges a small one to 1000", async () => {
    const w = await toWebp(await pic({ w: 700, h: 600, bx: 100, by: 80, bw: 500, bh: 440 }), sharp);
    expect(w).toMatchObject({ width: 1000, height: 1000 });
  });
});

describe("near-duplicates", () => {
  it("names both pictures of a pair, across products, and the picture already held for another item", async () => {
    const a = await pic({ block: "#c0392b" });
    const a2 = await sharp(a).resize(800, 800).jpeg({ quality: 60 }).toBuffer();            // the same picture, smaller and worse
    const other = await pic({ block: "#2980b9", bx: 100, by: 100, bw: 300, bh: 300 });
    const mk = async (sku, buf) => ({ sku, hash: await dhash(buf, sharp), bits: await dhash64(buf, sharp) });
    const items = [await mk("AK-0001", a), await mk("AK-0002", a2), await mk("AK-0003", other)];
    const d = findDuplicates(items);
    expect([...d.keys()].sort()).toEqual(["AK-0001", "AK-0002"]);
    expect(d.get("AK-0001")[0]).toContain("duplicate:AK-0002");
    const held = makeRegistry(); held.add("AK-0099", items[2].hash);
    expect(findDuplicates(items, held).get("AK-0003")[0]).toContain("duplicate:AK-0099 (already in the queue");
  });
});

describe("the plan over a folder", () => {
  it("proposes the clean ones, sends the failures and the review folder to review with their reasons, skips the approved, lists the unmatched", async () => {
    const root = mkdtempSync(join(tmpdir(), "pix4-"));
    const good = join(root, "product_images"), review = join(root, "product_images_review"); mkdirSync(good); mkdirSync(review);
    writeFileSync(join(good, "AK-0001_Potato.jpg"), await pic({ block: "#8d6e63", bx: 150, by: 250, bw: 700, bh: 500 }));
    writeFileSync(join(good, "AK-0002_Tomato.jpg"), await pic({ block: "#d32f2f", bx: 250, by: 150, bw: 500, bh: 700 }));
    writeFileSync(join(good, "AK-0003_Dark.jpg"), await pic({ bg: "#555555", block: "#eeeeee", bx: 250, by: 150, bw: 500, bh: 700 }));
    writeFileSync(join(good, "AK-0016_Cauliflower.jpg"), await pic({ block: "#f5f5dc", bx: 200, by: 200, bw: 600, bh: 600 }));
    writeFileSync(join(good, "AK-0004_Copy.jpg"), await pic({ block: "#d32f2f", bx: 250, by: 150, bw: 500, bh: 700 }));   // the same picture as AK-0002
    writeFileSync(join(review, "AK-0005_Rice.jpg"), await pic({ block: "#4caf50", bx: 100, by: 300, bw: 800, bh: 400 }));
    writeFileSync(join(good, "unknown.jpg"), await pic());
    writeFileSync(join(good, "notes.txt"), "not a picture");
    const found = discover(root);
    expect(Object.keys(found.folders).sort()).toEqual(["product_images", "product_images_review"]);
    const products = ["AK-0001", "AK-0002", "AK-0003", "AK-0004", "AK-0005", "AK-0016"].map((sku) => ({ id: sku, sku, name_en: sku, is_active: true }));
    const p = await plan({ folders: found.folders, report: [], reportName: "r.csv", products, existing: new Map(), held: makeRegistry(), sharp,
      read: (m) => readFileSyncFor(found, m) });
    const out = Object.fromEntries(p.items.map((i) => [i.sku, i]));
    expect(out["AK-0001"].outcome).toBe("proposed");
    expect(out["AK-0003"].outcome).toBe("needs_review"); expect(out["AK-0003"].reasons.join()).toContain("background:");
    expect(out["AK-0016"].outcome).toBe("skipped_already_approved");
    expect(out["AK-0002"].outcome).toBe("needs_review"); expect(out["AK-0002"].reasons.join()).toContain("duplicate:AK-0004");
    expect(out["AK-0004"].reasons.join()).toContain("duplicate:AK-0002");
    expect(out["AK-0005"].outcome).toBe("needs_review"); expect(out["AK-0005"].reasons.join()).toContain("review folder");
    expect(p.unmatched.map((u) => u.file)).toEqual(["unknown.jpg"]);
    expect(p.files).toBe(7);                                  // notes.txt is not a picture
    const s = summarise(p);
    expect(s).toMatchObject({ files: 7, matched: 6, unmatched: 1, outcomes: { proposed: 1, needs_review: 4, skipped_already_approved: 1 } });
    expect(toCsv(toRows(p)).split("\n")[0]).toBe("sku,file,outcome,reasons,bytes,quality,stored");
  });
  it("skips a product that already has an approved picture or another source's proposal", async () => {
    const root = mkdtempSync(join(tmpdir(), "pix4-")); const good = join(root, "product_images"); mkdirSync(good);
    writeFileSync(join(good, "AK-0001_a.jpg"), await pic()); writeFileSync(join(good, "AK-0002_b.jpg"), await pic({ block: "#123456" }));
    const existing = new Map([["AK-0001", { approved: true }], ["AK-0002", { otherProposal: true }]]);
    const p = await plan({ folders: { product_images: good }, report: [], reportName: "r", products: [{ sku: "AK-0001" }, { sku: "AK-0002" }], existing, held: makeRegistry(), sharp, read: (m) => readFileSyncFor({ folders: { product_images: good } }, m) });
    expect(p.items.map((i) => i.outcome).sort()).toEqual(["skipped_already_approved", "skipped_other_proposal"]);
  });
});

describe("the source record and the lists", () => {
  it("keeps the picture address and the page address when the report has them; says so when it has none", () => {
    const m = { folder: "product_images", file: "AK-0001_x.jpg", by: "code", row: { row: 7, imageUrl: "https://img.example/x.jpg", pageUrl: "https://shop.example/x", query: "potato" } };
    const n = sourceNote(m, "pictures-1", "image_fetch_report_v3.csv");
    expect(n).toContain("picture address https://img.example/x.jpg"); expect(n).toContain("page address https://shop.example/x"); expect(n).toContain("row 7");
    expect(sourceNote({ ...m, row: { row: 2, imageUrl: "", pageUrl: "" } }, "pictures-1", "image_fetch_report_v2.csv")).toContain("no picture address and no page address");
  });
  it("lists what is still without a picture, by aisle", () => {
    const md = missingMarkdown([{ aisle_en: "Dairy", sku: "AK-0041", name_en: "Ayran" }, { aisle_en: "Dairy", sku: "AK-0042", name_en: "Labneh", rejected_before: true }, { aisle_en: "Meat", sku: "AK-0090", name_en: "Beef" }]);
    expect(md).toContain("**Dairy** (2)"); expect(md).toContain("- AK-0042 Labneh (a picture was rejected before)"); expect(md).toContain("**Meat** (1)");
    expect(missingMarkdown([])).toContain("No item is without a picture");
  });
});

import { readFileSync } from "node:fs";
function readFileSyncFor(found, m) { return readFileSync(join(found.folders[m.folder], m.file)); }
