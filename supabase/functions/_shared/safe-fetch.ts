// Fetching a link a merchant sends (a menu page or PDF, DECISIONS §39.7). The URL comes from a WhatsApp message, so it
// is untrusted: https only, public host names only (no IP literals, no localhost or internal names, no credentials, no
// odd ports), redirects followed by hand and re-checked, a time limit and a size cap. What comes back is data for the
// menu parser, never instructions.

const MAX_REDIRECTS = 3;

/** True when a URL may be fetched: https, a public-looking host name, the default port, no user info. */
export function linkAllowed(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return false;
  const h = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!h.includes(".")) return false; // single-label names are internal
  if (/^\[|^\d+\.\d+\.\d+\.\d+$|^0x|^\d+$/.test(h)) return false; // IP literals in any form
  if (/(^|\.)(localhost|local|internal|intranet|lan|home|corp|svc|cluster\.local)$/.test(h)) return false;
  if (/(^|\.)(supabase\.co|supabase\.in|supabase\.net)$/.test(h)) return false; // never our own project's endpoints
  return true;
}

/** The first https link in a message, or null. */
export function firstLink(text: string | null | undefined): string | null {
  const m = String(text ?? "").match(/https:\/\/[^\s<>"']{4,2000}/i);
  return m ? m[0].replace(/[).,!?]+$/, "") : null;
}

export async function safeFetch(
  url: string,
  opts: { maxBytes?: number; timeoutMs?: number; fetch?: typeof fetch } = {},
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const f = opts.fetch ?? fetch;
  const maxBytes = opts.maxBytes ?? 2_000_000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 8000);
  try {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!linkAllowed(current)) return null;
      const res = await f(current, {
        redirect: "manual",
        signal: ctrl.signal,
        headers: { accept: "text/html,text/plain,application/pdf;q=0.9", "user-agent": "AloKingMenuImport/1.0" },
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        await res.body?.cancel();
        if (!loc) return null;
        current = new URL(loc, current).toString();
        continue;
      }
      if (!res.ok || !res.body) return null;
      const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (!/^(text\/html|text\/plain|application\/pdf|application\/xhtml\+xml)$/.test(mime)) {
        await res.body.cancel();
        return null;
      }
      const declared = Number(res.headers.get("content-length") ?? "0");
      if (declared > maxBytes) {
        await res.body.cancel();
        return null;
      }
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > maxBytes) {
          await reader.cancel();
          return null;
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let at = 0;
      for (const c of chunks) {
        bytes.set(c, at);
        at += c.length;
      }
      return { bytes, mime };
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Visible text of an HTML page, one line per block, for the menu parser (scripts, styles and tags dropped). */
export function htmlText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/section|\/article)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, 50_000);
}
