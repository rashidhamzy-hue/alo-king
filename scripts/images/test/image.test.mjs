// Real resizing (5.17 step 5). Runs only where sharp is installed (scripts/images: npm ci); the images workflow installs it.
import { describe, expect, it } from "vitest";
import { loadSharp, measure, shrink, MAX_BYTES } from "../lib/image.mjs";

const sharp = await loadSharp();
const noisy = async (w, h, format = "png") => {
  const raw = Buffer.alloc(w * h * 3); for (let i = 0; i < raw.length; i++) raw[i] = (i * 7919 + (i >> 3) * 31) & 255;
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } })[format]().toBuffer();
};

describe.skipIf(!sharp)("image processing", () => {
  it("measures the width, and refuses a format that is not a picture we accept", async () => {
    expect((await measure(await noisy(900, 600), sharp)).width).toBe(900);
    await expect(measure(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900"/>'), sharp)).rejects.toThrow();
    await expect(measure(Buffer.from("not a picture"), sharp)).rejects.toThrow();
  });
  it("a big picture ends with its longest side at 1200 px and under 300 KB", async () => {
    const out = await shrink(await noisy(3000, 2000), sharp);
    expect(Math.max(out.width, out.height)).toBe(1200);
    expect(out.bytes).toBeLessThan(MAX_BYTES);
    expect(out.data.length).toBe(out.bytes);
    expect(out.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await sharp(out.data).metadata()).format).toBe("jpeg");
  });
  it("a picture under 1200 px is not enlarged", async () => {
    const out = await shrink(await noisy(900, 1000), sharp);
    expect([out.width, out.height]).toEqual([900, 1000]);
    expect(out.bytes).toBeLessThan(MAX_BYTES);
  });
  it("transparency goes onto white", async () => {
    const png = await sharp({ create: { width: 900, height: 900, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const out = await shrink(png, sharp);
    const { data } = await sharp(out.data).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(240);
  });
});
