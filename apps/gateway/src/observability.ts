// Error tracking scrubbing (build plan 0.8). Message text and phone numbers must never reach Sentry: they are personal data.
// Pure functions, tested in apps/gateway/test/observability.test.ts. Used by worker.ts.

const NUMBER = /\+?\(?\d[\d\s().-]{7,}\d/g;                 // phone numbers in any common spelling
const BSUID = /\b[A-Z]{2}\.\d{10,}\b/g;                    // WhatsApp business-scoped user ids
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const KEYISH = /\b(sk-[A-Za-z0-9_-]{10,}|sb_secret_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g;

export function scrubString(s: string): string {
  return s.replace(BEARER, "$1 [token]").replace(KEYISH, "[key]").replace(BSUID, "[user-id]").replace(NUMBER, "[number]");
}

function scrubDeep(v: unknown, depth = 0): unknown {
  if (depth > 6) return "[deep]";
  if (typeof v === "string") return scrubString(v);
  if (Array.isArray(v)) return v.map((x) => scrubDeep(x, depth + 1));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrubDeep(x, depth + 1)]));
  return v;
}

type SentryLike = {
  request?: { url?: string; headers?: unknown; data?: unknown; cookies?: unknown; query_string?: unknown; [k: string]: unknown };
  user?: unknown; message?: string;
  exception?: { values?: { value?: string; type?: string; [k: string]: unknown }[] };
  breadcrumbs?: unknown[]; extra?: unknown; contexts?: unknown; tags?: unknown;
  [k: string]: unknown;
};

/** Drops the request body, headers, cookies and user; scrubs every remaining string. Keeps the route and the stack. */
export function scrubEvent<T extends object>(event: T): T {
  const e: SentryLike = { ...(event as SentryLike) };
  if (e.request) {
    const { url, method } = e.request as { url?: string; method?: string };
    e.request = { url: url ? scrubString(url.split("?")[0] ?? "") : undefined, method };
  }
  delete e.user;
  if (e.message) e.message = scrubString(e.message);
  if (e.exception?.values) e.exception = { ...e.exception, values: e.exception.values.map((x) => ({ ...x, value: x.value ? scrubString(x.value) : x.value })) };
  if (e.breadcrumbs) e.breadcrumbs = e.breadcrumbs.map((b) => scrubDeep(b));
  if (e.extra) e.extra = scrubDeep(e.extra);
  return e as T;
}
