// The image route's view of a shop's desired catalogue (DECISIONS §39.12). Meta fetches each product image while it ingests
// a batch, before the sync records the new hashes, so nearly every fetch of a crawl took the slow path and computed the whole
// shop's catalogue again: about 1,400 fetches at 22:25 UTC on 15 October (and 2,250 at 18:45) starved the staging database.
// One answer per shop is now shared by the requests in flight and kept for a minute; a version the cached answer does not
// know reloads it at most once every few seconds. A failed load is never kept.
export function desiredCache<T extends { retailer_id: string }>(
  load: (vendorId: string) => Promise<T[]>,
  hashOf: (p: T) => string,
  o: {
    ttlMs?: number;
    refreshMs?: number;
    now?: () => number;
    max?: number;
    onError?: (vendorId: string, e: unknown) => void;
  } = {},
) {
  const ttlMs = o.ttlMs ?? 60_000;
  const refreshMs = o.refreshMs ?? 5_000;
  const now = o.now ?? (() => Date.now());
  const max = o.max ?? 200;
  // Only each item's version is kept (retailer id to hash), not the shop's whole menu; null is a failed load.
  type Hashes = Map<string, string> | null;
  const entries = new Map<string, { at: number; hashes: Promise<Hashes> }>();
  const get = (vendorId: string, maxAge: number): Promise<Hashes> => {
    const e = entries.get(vendorId);
    if (e && now() - e.at < maxAge) return e.hashes;
    const entry = { at: now(), hashes: Promise.resolve(null as Hashes) };
    entry.hashes = load(vendorId).then(
      (list) => new Map(list.map((p) => [p.retailer_id, hashOf(p)])),
      (err) => {
        if (entries.get(vendorId) === entry) entries.delete(vendorId);
        o.onError?.(vendorId, err);
        return null;
      },
    );
    entries.delete(vendorId);
    entries.set(vendorId, entry);
    // The oldest load goes first (a Map keeps insertion order).
    while (entries.size > max) entries.delete(entries.keys().next().value as string);
    return entry.hashes;
  };
  return {
    /** Whether `hash` is the version of item `itemId` the shop's catalogue has now. */
    async has(vendorId: string, itemId: string, hash: string): Promise<boolean> {
      const first = await get(vendorId, ttlMs);
      // A failed load answers not found at once: no second attempt while the database is stalling.
      if (!first) return false;
      if (first.get(itemId) === hash) return true;
      return (await get(vendorId, refreshMs))?.get(itemId) === hash;
    },
  };
}
