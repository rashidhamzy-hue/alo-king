// Error reporting for the website Worker (OPS1). The Astro entry point is not ours to wrap with the Sentry SDK, so this file posts a Sentry
// envelope straight to the DSN's ingest address: the same format scripts/ci/sentry-ingest-check.sh posts. Nothing about the visitor
// leaves: no request, no cookies, no address, no user; every string is scrubbed. The scrubber is a copy of packages/core/src/scrub.ts on
// purpose: the website imports no staff code (test/ci/web-web1.test.ts), and apps/web/test/sentry-ops1.test.ts fails if the two ever differ.
// A deploy proves it with a cron check-in to its own monitor, never an error, so no issue sits among the real ones (the A4 rule).

const NUMBER = /\+?\(?\d[\d\s().-]{7,}\d/g;                 // phone numbers in any common spelling
const BSUID = /\b[A-Z]{2}\.\d{10,}\b/g;                    // WhatsApp business-scoped user ids
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const KEYISH = /\b(sk-[A-Za-z0-9_-]{10,}|sb_secret_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g;
export const scrubText = (s: string): string => s.replace(BEARER, "$1 [token]").replace(KEYISH, "[key]").replace(BSUID, "[user-id]").replace(NUMBER, "[number]");

export interface SentryEnv { SENTRY_DSN?: string; ENVIRONMENT?: string }
type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export function parseDsn(dsn: string | undefined): { key: string; host: string; project: string } | null {
  const m = /^https:\/\/([^@/\s]+)@([^/\s]+)\/(\d+)$/.exec(dsn ?? "");
  return m ? { key: m[1]!, host: m[2]!, project: m[3]! } : null;
}

const hex = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");
const post = (d: { key: string; host: string; project: string }, lines: object[], f: Fetch) =>
  f(`https://${d.host}/api/${d.project}/envelope/`, { method: "POST", signal: AbortSignal.timeout(3000),
    headers: { "Content-Type": "application/x-sentry-envelope", "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${d.key}, sentry_client=alo-king-web/1` },
    body: lines.map((l) => JSON.stringify(l)).join("\n") });

// At most twenty events a minute per Worker instance: a broken page under load must not become a flood.
let windowStart = 0, sent = 0;
export const resetLimiter = () => { windowStart = 0; sent = 0; };

export async function reportError(env: SentryEnv, err: unknown, where: string, f: Fetch = fetch): Promise<boolean> {
  const d = parseDsn(env.SENTRY_DSN);
  if (!d) return false;
  const now = Date.now();
  if (now - windowStart > 60_000) { windowStart = now; sent = 0; }
  if (sent >= 20) return false;
  sent++;
  try {
    const e = err instanceof Error ? err : new Error(String(err));
    // Only these fields are ever sent: no request, headers, cookies, user or breadcrumbs exist on the event to begin with.
    const event = { event_id: hex(16), timestamp: now / 1000, platform: "javascript", level: "error", environment: env.ENVIRONMENT ?? "unknown",
      server_name: "alo-king-web", tags: { where, service: "web" }, exception: { values: [{ type: scrubText(e.name || "Error"), value: scrubText(e.message) }] } };
    const res = await post(d, [{ sent_at: new Date(now).toISOString() }, { type: "event" }, event], f);
    return res.ok;
  } catch { return false; }
}

export async function reportCheckIn(env: SentryEnv, monitor: string, f: Fetch = fetch): Promise<{ ok: boolean; id: string }> {
  const d = parseDsn(env.SENTRY_DSN);
  const id = hex(16);
  if (!d) return { ok: false, id };
  try {
    const res = await post(d, [{ sent_at: new Date().toISOString() }, { type: "check_in" },
      { check_in_id: id, monitor_slug: monitor, status: "ok", environment: env.ENVIRONMENT ?? "unknown",
        monitor_config: { schedule: { type: "interval", value: 1, unit: "year" }, checkin_margin: 1440, max_runtime: 5, timezone: "UTC" } }], f);
    return { ok: res.ok, id };
  } catch { return { ok: false, id }; }
}

/** Runs the request; if it throws, reports (without waiting for more than the post) and throws the same error again. */
export async function guarded(env: SentryEnv, where: string, run: () => Promise<Response>, f: Fetch = fetch): Promise<Response> {
  try { return await run(); }
  catch (err) { await reportError(env, err, where, f); throw err; }
}
