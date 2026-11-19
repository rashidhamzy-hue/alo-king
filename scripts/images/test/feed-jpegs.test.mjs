// WEB4b (0252): the feed's JPEG copy. Real encoding where sharp is installed (scripts/images: npm ci; the catalog-jpegs workflow installs it).
import { describe, expect, it } from "vitest";
import { loadSharp } from "../lib/image.mjs";
import { MAX_BYTES, SIDE, toFeedJpeg } from "../feed-jpegs.mjs";

const sharp = await loadSharp();
const noisy = async (w, h, format) => {
  const raw = Buffer.alloc(w * h * 3); for (let i = 0; i < raw.length; i++) raw[i] = (i * 7919 + (i >> 3) * 31) & 255;
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } })[format]().toBuffer();
};

describe.skipIf(!sharp)("the feed's JPEG copy", () => {
  it("a 1000 px WebP (the founder's pictures) becomes a 1000 x 1000 JPEG under 150 KB", async () => {
    const out = await toFeedJpeg(await noisy(1000, 1000, "webp"), sharp);
    const m = await sharp(out.data).metadata();
    expect([m.format, m.width, m.height]).toEqual(["jpeg", SIDE, SIDE]);
    expect(out.bytes).toBeLessThanOrEqual(MAX_BYTES);
    expect(out.data.length).toBe(out.bytes);
  });
  it("a tall PNG is shown whole on white, never cropped; a 1200 px JPEG is brought to 1000", async () => {
    const tall = await toFeedJpeg(await sharp({ create: { width: 400, height: 1200, channels: 3, background: "#c00000" } }).png().toBuffer(), sharp);
    const { data, info } = await sharp(tall.data).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([1000, 1000]);
    const px = (x, y) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
    expect(px(10, 500).every((v) => v > 240)).toBe(true);                 // the side is white padding
    expect(px(500, 500)[0]).toBeGreaterThan(150);                         // the middle is the picture (red)
    const big = await toFeedJpeg(await noisy(1200, 1200, "jpeg"), sharp);
    expect((await sharp(big.data).metadata()).width).toBe(1000);
  });
  it("carries no metadata (no EXIF or position) and refuses what is not a picture", async () => {
    const out = await toFeedJpeg(await noisy(800, 800, "webp"), sharp);
    const m = await sharp(out.data).metadata();
    expect(m.exif).toBeUndefined();
    await expect(toFeedJpeg(Buffer.from("not a picture"), sharp)).rejects.toThrow();
  });
});
