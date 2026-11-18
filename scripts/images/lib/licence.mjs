// Licence rules, build plan 5.17 step 4. The source decides the licence, and migration 0050 enforces the same pairing in SQL.
//   Open Food Facts  -> cc_by_sa, attribution kept
//   brand's own site -> brand_own  (page AND picture on the brand's listed host)
//   a search result  -> public_page when it comes with the https page it was found on (founder decision of 14 Nov 2026, "any
//                       public page"; session PIX applies it to search hits), else unknown (a guide for the intake photo only)
//   the founder's own upload (PIX4; no address recorded) -> founder_supplied, shown only after a person approves it (migration 0242)
//   a research file's picture, with its page -> public_page (founder decision of 14 Nov 2026; migration 0070; research-pictures.mjs)
export const LICENCE_FOR = { open_food_facts: "cc_by_sa", brand_site: "brand_own", web_search: "unknown", intake_photo: "own_photo", public_page: "public_page", founder_upload: "founder_supplied" };
export const CUSTOMER_LICENCES = new Set(["cc_by_sa", "brand_own", "own_photo", "public_page", "founder_supplied"]);
export const customerUsable = (licence) => CUSTOMER_LICENCES.has(licence);

export const brandKey = (brand) => String(brand ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

export function hostOf(url) {
  try { const u = new URL(url); return u.protocol === "https:" || u.protocol === "http:" ? u.hostname.toLowerCase() : null; } catch { return null; }
}

export const onDomain = (host, domain) => !!host && (host === domain || host.endsWith("." + domain));

/** The brand's listed domains. Keys in brand-sites.json are compared after the same normalisation. */
export function brandDomains(brand, sites) {
  const k = brandKey(brand);
  if (!k || k.startsWith("local") || k === "private") return [];
  for (const [name, domains] of Object.entries(sites)) if (!name.startsWith("_") && brandKey(name) === k) return domains;
  return [];
}

/**
 * A search hit is the brand's own only when the page and the picture are both on a listed host of that brand. Any other hit
 * is a public page picture when it names its page (the page address is stored with it, so it can be withdrawn at once);
 * without a page address it is licence unknown and stays off the customer side.
 */
export function classifyHit({ pageUrl, imageUrl }, brand, sites) {
  const ph = hostOf(pageUrl); const ih = hostOf(imageUrl);
  if (brandDomains(brand, sites).some((d) => onDomain(ph, d) && onDomain(ih, d))) return "brand_site";
  return /^https:\/\//.test(pageUrl ?? "") && /^https:\/\//.test(imageUrl ?? "") ? "public_page" : "web_search";
}
