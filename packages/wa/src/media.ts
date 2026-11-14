// Where inbound media may be fetched from (G1-17). The address in a webhook is data from outside; the webhook is signed, but a leaked
// secret must not be able to point the Worker at any host. So the allowlist is Kapso's own domain, nothing else (it replaces a
// denylist of Meta's hosts, which let every other https host through).
//
// Kapso's `media_url` is an app.kapso.ai redirect link (docs/HANDOFF.md, B2's media request). A redirect FROM a Kapso host is
// followed, because Kapso decides where its own media lives and that is the trust the webhook already rests on; a redirect from
// any other host is refused, and so is a redirect to anything but https. At most three hops.
// Only the two files that read customers' pictures and voice notes call this (packages/agents/src/payment-proof.ts, stt.ts).

/** The domain Kapso serves media from, and every subdomain of it. */
export const KAPSO_MEDIA_DOMAIN = "kapso.ai";
const MAX_HOPS = 3;

export function isKapsoMediaHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  return h === KAPSO_MEDIA_DOMAIN || h.endsWith("." + KAPSO_MEDIA_DOMAIN);
}

/** The address when it may be fetched as Kapso media: https, no credentials, the default port, a Kapso host. Otherwise null. */
export function allowedMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return null;
    return isKapsoMediaHost(u.hostname) ? url : null;
  } catch { return null; }
}

/** The first of the candidate addresses that may be fetched. A webhook offers `media_url` and `media_data.url`; each is checked. */
export function kapsoMediaUrlOf(...candidates: (string | null | undefined)[]): string | null {
  for (const c of candidates) { const ok = allowedMediaUrl(c); if (ok) return ok; }
  return null;
}

/** Fetches Kapso media with the rules above. Throws on a refused host or redirect (the turn retries or gives up loudly; it never fetches elsewhere). */
export async function fetchKapsoMedia(url: string, fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<Response> {
  let current = allowedMediaUrl(url);
  if (!current) throw new Error("MEDIA_HOST_REFUSED");
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const res = await fetchImpl(current, { redirect: "manual" });
    if (res.status < 300 || res.status >= 400) return res;
    const location = res.headers.get("location");
    if (!location || !isKapsoMediaHost(new URL(current).hostname)) throw new Error("MEDIA_REDIRECT_REFUSED");
    const next = new URL(location, current);
    if (next.protocol !== "https:" || next.username || next.password || (next.port && next.port !== "443")) throw new Error("MEDIA_REDIRECT_REFUSED");
    current = next.toString();
  }
  throw new Error("MEDIA_TOO_MANY_REDIRECTS");
}
