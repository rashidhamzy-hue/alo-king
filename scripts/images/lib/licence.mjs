// Licence rules, build plan 5.17 step 4. The source decides the licence, and migration 0050 enforces the same pairing in SQL.
//   Open Food Facts  -> cc_by_sa, attribution kept
//   brand's own site -> brand_own  (page AND picture on the brand's listed host)
//   anything else    -> unknown    (guides the intake photo; never shown to customers)
export const LICENCE_FOR = { open_food_facts: "cc_by_sa", brand_site: "brand_own", web_search: "unknown", intake_photo: "own_photo" };
export const CUSTOMER_LICENCES = new Set(["cc_by_sa", "brand_own", "own_photo"]);
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

/** A search hit is the brand's own only when the page and the picture are both on a listed host of that brand. */
export function classifyHit({ pageUrl, imageUrl }, brand, sites) {
  const ph = hostOf(pageUrl); const ih = hostOf(imageUrl);
  const ok = brandDomains(brand, sites).some((d) => onDomain(ph, d) && onDomain(ih, d));
  return ok ? "brand_site" : "web_search";
}
