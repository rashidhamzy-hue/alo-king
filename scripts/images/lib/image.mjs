// Measure, then resize for storage (5.17 steps 3 and 5): at least 800 px wide to qualify; stored with the longest side
// 1200 px (a picture of 800 to 1199 px is brought up to 1200: one canonical size), under 300 KB. Pictures are untrusted input: capped pixel count, decoded by sharp, re-encoded to JPEG.
import { createHash } from "node:crypto";

export const MIN_WIDTH = 800;
export const MAX_SIDE = 1200;
export const MAX_BYTES = 300 * 1000;   // decimal, so "under 300 KB" holds in either unit

let sharpPromise;
export async function loadSharp() {
  sharpPromise ??= import("sharp").then((m) => m.default).catch(() => null);
  return sharpPromise;
}

export async function measure(buf, sharp) {
  const m = await sharp(buf, { limitInputPixels: 100_000_000, failOn: "error" }).metadata();
  if (!m.width || !m.height) throw new Error("not_an_image");
  if (!["jpeg", "png", "webp", "gif", "avif"].includes(m.format)) throw new Error(`format_${m.format}`);   // no SVG, PDF or the like
  // Respect the EXIF turn so "width" is what a person sees.
  const turned = (m.orientation ?? 1) >= 5;
  return { width: turned ? m.height : m.width, height: turned ? m.width : m.height, format: m.format };
}

/** JPEG, longest side exactly 1200 (a smaller one is enlarged, a larger one reduced), white behind transparency; quality steps down until it is under 300 KB. */
export async function shrink(buf, sharp) {
  let size = MAX_SIDE;
  for (let attempt = 0; attempt < 6; attempt++) {
    for (const quality of [85, 78, 70, 62, 54, 46]) {
      const out = await sharp(buf, { limitInputPixels: 100_000_000, failOn: "error" })
        .rotate().resize({ width: size, height: size, fit: "inside", withoutEnlargement: false, kernel: "lanczos3" })
        .flatten({ background: "#ffffff" }).jpeg({ quality, mozjpeg: true }).toBuffer({ resolveWithObject: true });
      if (out.data.length <= MAX_BYTES) {
        return { data: out.data, width: out.info.width, height: out.info.height, bytes: out.data.length,
                 sha256: createHash("sha256").update(out.data).digest("hex") };
      }
    }
    size = Math.round(size * 0.85);
  }
  throw new Error("cannot_get_under_300kb");
}
