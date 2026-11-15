// A small per-address limiter for the search route (docs/WEBSITE.md "Abuse and safety"). It lives in one Worker isolate's memory, so it
// slows a script that hammers one isolate and no more; the real limit is a Cloudflare rate-limiting rule on the zone (founder list),
// and the database caps what a search may write (web_catalog_search). The cart and checkout limits are WEB2's.
export function makeLimiter(max: number, windowMs: number, now: () => number = Date.now) {
  const hits = new Map<string, number[]>();
  return (key: string): boolean => {
    const t = now();
    const recent = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
    if (recent.length >= max) { hits.set(key, recent); return false; }
    recent.push(t); hits.set(key, recent);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((x) => t - x < windowMs)) hits.delete(k);
    return true;
  };
}
