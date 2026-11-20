// PERF1: the website's 400 and 800 px WebP copies. Real encoding where sharp is installed (scripts/images: npm ci).
import { describe, expect, it } from "vitest";
import { loadSharp } from "../lib/image.mjs";
import { VARIANTS, toVariant, variantPath } from "../feed-jpegs.mjs";

const sharp = await loadSharp();
/** A product photo on white: a soft-edged coloured block with some texture, the kind of picture the catalogue holds. */
const product = async () => {
  const w = 1000, raw = Buffer.alloc(w * w * 3, 255);
  for (let y = 200; y < 800; y++) for (let x = 300; x < 700; x++) { const i = (y * w + x) * 3; raw[i] = 180 + ((x * y) % 50); raw[i + 1] = 40 + (x % 30); raw[i + 2] = 60; }
  return sharp(raw, { raw: { width: w, height: w, channels: 3 } }).webp({ quality: 85 }).toBuffer();
};
const noisy = async () => {
  const w = 1000, raw = Buffer.alloc(w * w * 3); for (let i = 0; i < raw.length; i++) raw[i] = (i * 7919 + (i >> 3) * 31) & 255;
  return sharp(raw, { raw: { width: w, height: w, channels: 3 } }).webp().toBuffer();
};

describe.skipIf(!sharp)("the website's copies", () => {
  it("a product picture becomes a 400 px WebP under 15 KB and an 800 px WebP under 50 KB, with no metadata", async () => {
    const src = await product();
    for (const w of [400, 800]) {
      const v = await toVariant(src, sharp, w);
      const m = await sharp(v.data).metadata();
      expect([m.format, m.width, m.height]).toEqual(["webp", w, w]);
      expect(v.bytes).toBeLessThanOrEqual(VARIANTS[w].target);
      expect(m.exif).toBeUndefined();
    }
  });
  it("a picture that cannot reach its target is kept under its cap, or refused", async () => {
    const v = await toVariant(await noisy(), sharp, 400).catch((e) => e);
    if (v instanceof Error) expect(v.message).toMatch(/cannot_get_400_under_25000/);
    else expect(v.bytes).toBeLessThanOrEqual(VARIANTS[400].cap);
    await expect(toVariant(Buffer.from("not a picture"), sharp, 400)).rejects.toThrow();
    await expect(toVariant(await product(), sharp, 600)).rejects.toThrow(/variant_width_600/);
  });
  it("the name carries the content: same bytes, same name; other bytes, another name", () => {
    const a = variantPath("AK-0001-x", 400, Buffer.from("a")), b = variantPath("AK-0001-x", 400, Buffer.from("b"));
    expect(a).toMatch(/^AK-0001-x-w400-[0-9a-f]{12}\.webp$/);
    expect(variantPath("AK-0001-x", 400, Buffer.from("a"))).toBe(a);
    expect(a).not.toBe(b);
  });
});
