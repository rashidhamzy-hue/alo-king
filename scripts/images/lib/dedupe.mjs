// Duplicate and near-duplicate pictures (session PIX). A picture is described by a 16 x 16 colour thumbnail (768 numbers, written as
// hex). The distance between two pictures is the average difference of those numbers (0 to 255). The same picture at another
// size, quality or file format lands under 1; a different pack lands far above (a pack is a different shape and colours
// on white). No model is involved.
//
// The rule: one picture is not proposed for two items. A near-duplicate of a picture already proposed or approved for ANOTHER
// item is rejected with the reason `duplicate:<sku>` before the (paid) vision check runs. Whether two catalog lines are really the
// same product is a person's call: the reason names the other item so it can be read in the report.

export const SIDE = 16;
export const NEAR = 4;   // an average difference of 4 in 255 or less: the same picture (re-encodes measure under 1; the closest different packs tried, about 8)

/** 1,536 hex characters. `buf` is any picture sharp can read (rotated by its EXIF turn, flattened onto white first). */
export async function dhash(buf, sharp) {
  const { data } = await sharp(buf, { limitInputPixels: 100_000_000, failOn: "error" })
    .rotate().flatten({ background: "#ffffff" }).removeAlpha().toColourspace("srgb")
    .resize(SIDE, SIDE, { fit: "fill", kernel: "lanczos3" }).raw().toBuffer({ resolveWithObject: true });
  return Buffer.from(data).toString("hex");
}

/** Average absolute difference between two thumbnails; Infinity when they cannot be compared. */
export function hamming(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length || a.length % 2 || !/^[0-9a-f]+$/.test(a + b)) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i += 2) sum += Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16));
  return sum / (a.length / 2);
}

/**
 * The pictures already taken, by item. Checking and reserving happen in one synchronous step, so two items running side by
 * side cannot both take the same picture. `release` gives back what an item reserved but did not use.
 */
export function makeRegistry(threshold = NEAR) {
  const held = new Map();       // sku -> Set of hashes of pictures proposed or approved (loaded, or kept by a finished item)
  const reserved = new Map();   // sku -> Set of hashes an item in this run is looking at right now
  const put = (m, sku, hash) => { if (!m.has(sku)) m.set(sku, new Set()); m.get(sku).add(hash); };
  const near = (hash, sku) => {
    let best = null;
    for (const m of [held, reserved]) {
      for (const [other, set] of m) {
        if (other === sku) continue;
        for (const h of set) { const d = hamming(hash, h); if (d <= threshold && (!best || d < best.distance)) best = { sku: other, distance: Math.round(d * 100) / 100 }; }
      }
    }
    return best;
  };
  return {
    near,
    add(sku, hash) { if (hash) put(held, sku, hash); },
    /** The other item that already has this picture, or null; else the hash is reserved for `sku`. */
    reserve(sku, hash) { const dup = near(hash, sku); if (!dup) put(reserved, sku, hash); return dup; },
    /** An item finished: what it reserved is given back; the picture it used (if any) is now held. */
    release(sku, keepHash = null) { reserved.delete(sku); if (keepHash) { held.set(sku, new Set([keepHash])); } },
    size: () => [...held.values(), ...reserved.values()].reduce((n, s) => n + s.size, 0),
  };
}

/**
 * Fills the registry with the pictures that are proposed or approved now. A stored picture that has no hash yet (proposed
 * before this session) is read from the private bucket and hashed. Returns { loaded, backfilled, failed }.
 */
export async function loadRegistry(registry, store, sharp, hashFn = dhash) {
  const rows = await store.select("product_images", "select=product_id,status,media_path,phash:vision->>phash,products(sku)&status=in.(proposed,approved)");
  let loaded = 0, backfilled = 0, failed = 0;
  for (const r of rows) {
    const sku = r.products?.sku ?? r.product_id;
    let h = r.phash;
    if (!h) {
      try { h = await hashFn(await store.download(r.media_path), sharp); backfilled++; } catch { failed++; continue; }
    }
    registry.add(sku, h); loaded++;
  }
  return { loaded, backfilled, failed };
}
