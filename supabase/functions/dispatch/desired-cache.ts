// The image route's view of a shop's desired catalogue (DECISIONS §39.12). Meta fetches each product image while it ingests
// a batch, before the sync records the new hashes, so nearly every fetch of a crawl took the slow path and computed the whole
// shop's catalogue again: about 1,400 fetches at 22:25 UTC on 15 October (and 2,250 at 18:45) starved the staging database.
// One answer per shop is now shared by the requests in flight and kept for a minute; a version the cached answer does not
// know reloads it at most once every few seconds. A failed load is never kept.
export function desiredCache<T extends { retailer_id: string }>(
  load: (vendorId: string) => Promise<T[]>,
  hashOf: (p: T) => string,
  o: { ttlMs?: number; refreshMs?: number; now?: () => number; max?: number } = {},
) {
  const ttlMs = o.ttlMs ?? 60_000;
  const refreshMs = o.refreshMs ?? 5_000;
  const now = o.now ?? (() => Date.now());
  const max = o.max ?? 200;
  const entries = new Map<string, { at: number; list: Promise<T[]> }>();
  const get = (vendorId: string, maxAge: number): Promise<T[]> => {
    const e = entries.get(vendorId);
    if (e && now() - e.at < maxAge) return e.list;
    const entry = { at: now(), list: Promise.resolve([] as T[]) };
    entry.list = load(vendorId).catch(() => {
      if (entries.get(vendorId) === entry) entries.delete(vendorId);
      return [] as T[];
    });
    entries.delete(vendorId);
    entries.set(vendorId, entry);
    // The oldest shop goes first (a Map keeps insertion order).
    while (entries.size > max) entries.delete(entries.keys().next().value as string);
    return entry.list;
  };
  const matches = (list: T[], itemId: string, hash: string) => {
    const p = list.find((x) => x.retailer_id === itemId);
    return !!p && hashOf(p) === hash;
  };
  return {
    /** Whether `hash` is the version of item `itemId` the shop's catalogue has now. */
    async has(vendorId: string, itemId: string, hash: string): Promise<boolean> {
      if (matches(await get(vendorId, ttlMs), itemId, hash)) return true;
      return matches(await get(vendorId, refreshMs), itemId, hash);
    },
  };
}
