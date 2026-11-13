// Small fetch helpers: a timeout, retries on 429 and 5xx that honour Retry-After, a rate gate for polite hosts, a worker pool.
// Open Food Facts asks every client to identify itself. The agent string names the tool, never a person.
export const UA = "AloKing-product-data/1.0 (grocery catalog source check; proposals only)";

/** Spaces the start of calls at least minMs apart, across every worker that shares the gate. */
export function gate(minMs) {
  let next = 0;
  return async () => {
    const now = Date.now();
    const at = Math.max(now, next);
    next = at + minMs;
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  };
}

export async function fetchRetry(url, opts = {}, { fetchImpl = fetch, retries = 2, timeoutMs = 30000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), wait = null } = {}) {
  let last;
  for (let i = 0; i <= retries; i++) {
    let backoff = 800 * 2 ** i;
    try {
      if (wait && i > 0) await wait();                     // a retry is a request too: it goes through the same gate
      const res = await fetchImpl(url, { ...opts, headers: { "user-agent": UA, ...(opts.headers ?? {}) }, signal: AbortSignal.timeout(timeoutMs) });
      if (res.status === 429 || res.status >= 500) {
        last = new Error(`HTTP ${res.status}`);
        const ra = Number(res.headers?.get?.("retry-after"));
        if (ra > 0) backoff = Math.min(ra, 30) * 1000;      // the host says how long to wait: do
        await res.body?.cancel?.();
      } else return res;
    } catch (e) { last = e; }
    if (i < retries) await sleep(backoff);
  }
  throw last ?? new Error("fetch failed");
}

export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}
