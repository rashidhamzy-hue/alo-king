import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { LIMIT_BYTES, makeThumb, plan } from "./thumbs";

// DECISIONS §39.15.13: the Flow app's images are square JPEGs under Meta's 100 KB, made again only when the photo changed.
describe("Flow app images", () => {
  it("a large noisy photo becomes a 600 px JPEG under 95 KB, and a 144 px row image of a few KB", async () => {
    const noise = Buffer.from(
      Array.from({ length: 1200 * 900 * 3 }, () => Math.floor(Math.random() * 256)),
    );
    const photo = await sharp(noise, { raw: { width: 1200, height: 900, channels: 3 } })
      .jpeg({ quality: 95 })
      .toBuffer();
    const large = (await makeThumb(photo, 600, LIMIT_BYTES))!;
    expect(large.length).toBeLessThanOrEqual(LIMIT_BYTES);
    expect(await sharp(large).metadata()).toMatchObject({
      width: 600,
      height: 600,
      format: "jpeg",
    });
    const small = (await makeThumb(photo, 144, LIMIT_BYTES))!;
    expect(small.length).toBeLessThan(20_000);
  });
  it("plans only what is missing or changed", () => {
    const jobs = plan(
      {
        items: [
          { ref: "i1", path: "merchant/a/i1.jpg" },
          { ref: "i2", path: "merchant/a/i2.jpg" },
        ],
        covers: [{ ref: "v1", path: "cover/v1.jpg" }],
        categories: [],
        made: {
          "item:i1": "merchant/a/i1.jpg",
          "item_large:i1": "merchant/a/i1.jpg",
          "item:i2": "merchant/a/old.jpg",
          "cover:v1": "cover/v1.jpg",
        },
      },
      100,
    );
    expect(jobs.map((j) => `${j.kind}:${j.ref}`)).toEqual(["item:i2", "item_large:i2"]);
  });
});
