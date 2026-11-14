// An in-memory stand-in for the two Storage buckets, for the public catalog bucket's tests (A5, 0115). `media` is the private
// bucket (it holds proposed pictures AND receipts and voice notes); `catalog` is the public one. The store below can only copy
// from `media` to `catalog`, like the real one, and records every call so a test can say what was ever made public.
import type { PublicStore } from "../../apps/gateway/src/catalog-feed";

export function fakeStore(privateKeys: string[] = []) {
  const media = new Map<string, string>(privateKeys.map((k) => [k, `bytes of ${k}`]));
  const catalog = new Map<string, { bytes: string; createdAt: string }>();
  const everPublic: string[] = [];
  const calls: string[] = [];
  const store: PublicStore = {
    async copy(from, to) {
      calls.push(`copy ${from} -> ${to}`);
      const bytes = media.get(from);
      if (bytes === undefined) throw new Error(`source not found: ${from}`);
      catalog.set(to, { bytes, createdAt: new Date().toISOString() });
      everPublic.push(from);
    },
    async remove(keys) { for (const k of keys) { calls.push(`remove ${k}`); catalog.delete(k); } },
    async list() { return [...catalog].map(([name, v]) => ({ name, createdAt: v.createdAt })); },
  };
  return { store, media, catalog, everPublic, calls };
}
