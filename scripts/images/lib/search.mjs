// Web image search (5.17 step 2). Provider: Brave Search API, image endpoint (docs/DECISIONS.md, "Product picture search").
// Secret: BRAVE_SEARCH_API_KEY. Without it, the fetch runs Open Food Facts only.
import { fetchRetry } from "./http.mjs";
import { brandDomains, classifyHit } from "./licence.mjs";

export const BRAVE_IMAGES = "https://api.search.brave.com/res/v1/images/search";

export function queryFor(item, domain = null) {
  const brand = item.brand && !/^(local|private)/i.test(item.brand) ? item.brand : "";
  const name = String(item.name_en ?? "");
  const text = [brand && !name.toLowerCase().includes(brand.toLowerCase()) ? brand : "", name].filter(Boolean).join(" ");
  return `${domain ? `site:${domain} ` : ""}${text} product`.trim();
}

export function parseBrave(body) {
  const out = [];
  for (const r of body?.results ?? []) {
    const imageUrl = r?.properties?.url ?? null;
    const pageUrl = r?.url ?? null;
    if (typeof imageUrl !== "string" || !/^https:\/\//.test(imageUrl)) continue;
    out.push({ imageUrl, pageUrl: typeof pageUrl === "string" ? pageUrl : null, hintWidth: Number(r?.properties?.width) || null });
  }
  return out;
}

export async function braveImages(query, apiKey, { fetchImpl = fetch, count = 8, wait = async () => {} } = {}) {
  await wait();
  const url = `${BRAVE_IMAGES}?${new URLSearchParams({ q: query, count: String(count), safesearch: "strict" })}`;
  const res = await fetchRetry(url, { headers: { accept: "application/json", "x-subscription-token": apiKey } }, { fetchImpl });
  if (!res.ok) throw new Error(`search_http_${res.status}`);
  return parseBrave(await res.json());
}

/** Brand stage: only for a brand with a listed own site, restricted to that site. Each hit is classified on its own. */
export async function brandCandidates(item, apiKey, sites, opts = {}) {
  const out = [];
  for (const d of brandDomains(item.brand, sites).slice(0, 2)) {
    for (const h of await braveImages(queryFor(item, d), apiKey, opts)) {
      out.push({ ...h, sourceKind: classifyHit(h, item.brand, sites), attribution: null });
    }
  }
  return out;
}

/** Open search: every hit is classified; only a brand's own host can come out as anything but unknown. */
export async function openCandidates(item, apiKey, sites, opts = {}) {
  return (await braveImages(queryFor(item), apiKey, opts)).map((h) => ({ ...h, sourceKind: classifyHit(h, item.brand, sites), attribution: null }));
}
