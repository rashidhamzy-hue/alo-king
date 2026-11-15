// Web image search (5.17 step 2). Provider: Brave Search API, image endpoint (docs/DECISIONS.md, "Product picture search").
// Secret: BRAVE_SEARCH_API_KEY. Without it, the fetch runs Open Food Facts only.
import { fetchRetry } from "./http.mjs";
import { brandDomains, classifyHit } from "./licence.mjs";

export const BRAVE_IMAGES = "https://api.search.brave.com/res/v1/images/search";

export function queryFor(item, domain = null) {
  const brand = item.brand && !/^(local|private)/i.test(item.brand) ? item.brand : "";
  const name = String(item.name_en ?? "");
  const text = [brand && !name.toLowerCase().includes(brand.toLowerCase()) ? brand : "", name].filter(Boolean).join(" ");
  // A packed item is searched as a pack shot; a loose one (sold by weight or piece, no brand) as the item on white.
  const tail = brand ? "pack shot" : "white background";
  return `${domain ? `site:${domain} ` : ""}${text} ${domain ? "product" : tail}`.trim();
}

// Stock-photo and picture-sharing hosts: their pictures carry a watermark or a lifestyle scene, or are lifted from elsewhere.
// Not asked about their pictures at all (a person may extend this list). The vision check still looks at everything else.
export const SKIP_HOSTS = ["shutterstock.com", "alamy.com", "dreamstime.com", "istockphoto.com", "gettyimages.com", "depositphotos.com", "123rf.com",
  "adobestock.com", "stock.adobe.com", "pinterest.com", "pinimg.com", "facebook.com", "fbcdn.net", "instagram.com", "tiktok.com", "vecteezy.com", "freepik.com",
  "pngtree.com", "pngegg.com", "cleanpng.com", "kissclipart.com", "vectorstock.com", "bigstockphoto.com", "canstockphoto.com", "ebay.com", "alicdn.com", "aliexpress.com"];
export const skipHost = (url) => { try { const h = new URL(url).hostname.toLowerCase(); return SKIP_HOSTS.some((d) => h === d || h.endsWith("." + d)); } catch { return true; } };

export function parseBrave(body) {
  const out = [];
  for (const r of body?.results ?? []) {
    const imageUrl = r?.properties?.url ?? null;
    const pageUrl = r?.url ?? null;
    if (typeof imageUrl !== "string" || !/^https:\/\//.test(imageUrl)) continue;
    const hintWidth = Number(r?.properties?.width) || null;
    if (hintWidth && hintWidth < 800) continue;                                   // too narrow to qualify: not downloaded, not paid for
    if (skipHost(imageUrl) || (typeof pageUrl === "string" && skipHost(pageUrl))) continue;
    out.push({ imageUrl, pageUrl: typeof pageUrl === "string" ? pageUrl : null, hintWidth });
  }
  return out;
}

export async function braveImages(query, apiKey, { fetchImpl = fetch, count = 12, wait = async () => {}, onRequest = () => {} } = {}) {
  await wait();
  onRequest();
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
