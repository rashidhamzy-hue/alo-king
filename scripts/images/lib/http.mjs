// Small fetch helpers: a timeout, a size cap, retries on 429 and 5xx, and a rate gate for polite hosts.
export const UA = "AloKing-catalog-images/1.0 (product picture check)";

export function gate(minMs) {
  let next = 0;
  return async () => {
    const now = Date.now();
    const at = Math.max(now, next);
    next = at + minMs;
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  };
}

export async function fetchRetry(url, opts = {}, { fetchImpl = fetch, retries = 2, timeoutMs = 20000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let last;
  for (let i = 0; i <= retries; i++) {
    let wait = 800 * 2 ** i;
    try {
      const res = await fetchImpl(url, { ...opts, headers: { "user-agent": UA, ...(opts.headers ?? {}) }, signal: AbortSignal.timeout(timeoutMs) });
      if (res.status === 429 || res.status >= 500) {
        last = new Error(`HTTP ${res.status}`);
        const ra = Number(res.headers?.get?.("retry-after"));
        if (ra > 0) wait = Math.min(ra, 20) * 1000;          // the host says how long to wait: do
        await res.body?.cancel?.();
      } else return res;
    } catch (e) { last = e; }
    if (i < retries) await sleep(wait);
  }
  throw last ?? new Error("fetch failed");
}

/** Reads a response body up to maxBytes, or throws. */
export async function readCapped(res, maxBytes) {
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len && len > maxBytes) throw new Error("too_large");
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new Error("too_large");
  return buf;
}

export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}
