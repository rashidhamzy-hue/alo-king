import type { ErrorEvent } from "@sentry/react";
import { isPrivatePath } from "./site";

// The Sentry SDK is about 50 KB gzipped: it is loaded after the page is idle, never in the first bundle (DECISIONS §37.5).
let sdk: typeof import("@sentry/react") | null = null;

// Sentry project javascript-tanstackstart-react (DSNs are public by design). VITE_SENTRY_DSN overrides it;
// set it to "off" to disable reporting (for example in local development).
const DEFAULT_DSN =
  "https://7d8e7343d380b99afd90b5bf7414f4ec@o4512003528720384.ingest.de.sentry.io/4512209415438416";

const env = import.meta.env as Record<string, string | undefined>;
let started = false;

/** Starts browser error reporting once, after the page is idle. No-op on the server, in tests and when disabled. */
export function initSentry() {
  if (started || typeof window === "undefined" || env["MODE"] === "test") return;
  const dsn = env["VITE_SENTRY_DSN"] ?? DEFAULT_DSN;
  if (!dsn || dsn === "off") return;
  started = true;
  // The public pages (/ar, /en, /fr) stay under the JavaScript budget (DECISIONS §37.5): they report errors through a
  // 1 KB reporter, not the SDK. Private pages (merchant, driver, admin, claim) load the full SDK after the page is idle.
  if (!isPrivatePath(window.location.pathname)) return startLite(dsn);
  const start = () =>
    import("@sentry/react").then((S) => {
      sdk = S;
      S.init({
        dsn,
        environment: env["VITE_VERCEL_ENV"] || env["MODE"] || "development",
        release: env["VITE_VERCEL_GIT_COMMIT_SHA"] || undefined,
        // No user info, cookies, headers, bodies or query strings: phones, addresses and tracking tokens stay out.
        dataCollection: {
          userInfo: false,
          cookies: false,
          httpHeaders: false,
          httpBodies: [],
          urlQueryParams: false,
        },
        // No performance tracing until the Phase 4 site: transactions and spans would carry unscrubbed URLs.
        tracesSampleRate: 0,
        beforeSend: scrub,
        beforeBreadcrumb: (b) => {
          if (b.message) b.message = scrubText(b.message);
          for (const k of ["url", "from", "to"] as const)
            if (typeof b.data?.[k] === "string") b.data[k] = scrubUrl(b.data[k]);
          return b;
        },
      });
    });
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
  };
  if (w.requestIdleCallback) w.requestIdleCallback(() => void start(), { timeout: 5000 });
  else setTimeout(() => void start(), 3000);
}

// 7+ digits with optional spaces or dashes: Lebanese local (03 123 456) and international numbers.
const PHONE = /\+?\d[\d\s-]{5,}\d/g;
// Path segments that act as bearer tokens (signed tracking links, claim and handoff links).
const TOKEN_PATH = /\/(track|t|claim|h)\/[^/?#]+/g;

// In free text a token ends at the first character a token cannot contain (a space, a bracket, a quote).
const TOKEN_IN_TEXT = /\/(track|t|claim|h)\/[\w.~%-]+/g;
export const scrubText = (s: string) =>
  s.replace(TOKEN_IN_TEXT, "/$1/[token]").replace(PHONE, "[phone]");
export const scrubUrl = (u: string) =>
  (u.split(/[?#]/)[0] ?? "").replace(TOKEN_PATH, "/$1/[token]");

/** Masks phones, path tokens and query strings in everything an error event carries. */
export function scrub<E extends ErrorEvent>(event: E): E {
  if (event.message) event.message = scrubText(event.message);
  for (const ex of event.exception?.values ?? []) if (ex.value) ex.value = scrubText(ex.value);
  if (event.request) {
    if (event.request.url) event.request.url = scrubUrl(event.request.url);
    delete event.request.query_string;
    delete event.request.headers;
    delete event.request.cookies;
  }
  for (const b of event.breadcrumbs ?? []) {
    if (b.message) b.message = scrubText(b.message);
    for (const k of ["url", "from", "to"] as const)
      if (typeof b.data?.[k] === "string") b.data[k] = scrubUrl(b.data[k]);
  }
  if (event.extra) event.extra = JSON.parse(scrubText(JSON.stringify(event.extra)));
  return event;
}

// ---- Lite reporter for public pages ------------------------------------------------------------------------------
let lite: { send: (e: unknown) => void } | null = null;

/** Parses a Sentry DSN into its envelope endpoint. */
export function envelopeUrl(dsn: string): string | null {
  const m = /^https:\/\/([a-f0-9]+)@([^/]+)\/(\d+)$/.exec(dsn);
  return m ? `https://${m[2]}/api/${m[3]}/envelope/?sentry_key=${m[1]}&sentry_version=7` : null;
}

function startLite(dsn: string) {
  const url = envelopeUrl(dsn);
  if (!url) return;
  let sent = 0;
  const send = (e: unknown) => {
    if (sent >= 5) return; // a broken page must not flood the project
    sent++;
    const err = e instanceof Error ? e : new Error(String(e));
    const event = scrub({
      event_id: crypto.randomUUID().replace(/-/g, ""),
      timestamp: Date.now() / 1000,
      platform: "javascript",
      level: "error",
      environment: env["VITE_VERCEL_ENV"] || env["MODE"] || "development",
      release: env["VITE_VERCEL_GIT_COMMIT_SHA"] || undefined,
      tags: { site: "public" },
      exception: { values: [{ type: err.name, value: err.message.slice(0, 300) }] },
      request: { url: window.location.href },
    } as unknown as ErrorEvent);
    const body = `${JSON.stringify({ event_id: (event as { event_id: string }).event_id, sent_at: new Date().toISOString() })}\n${JSON.stringify({ type: "event" })}\n${JSON.stringify(event)}`;
    void fetch(url, { method: "POST", body, keepalive: true, mode: "no-cors" }).catch(
      () => undefined,
    );
  };
  lite = { send };
  window.addEventListener("error", (ev) => send(ev.error ?? ev.message));
  window.addEventListener("unhandledrejection", (ev) => send(ev.reason));
}

export function captureError(error: unknown, context: Record<string, unknown> = {}) {
  if (!started) return;
  if (lite) return lite.send(error);
  if (sdk) sdk.captureException(error, { extra: context });
  else void import("@sentry/react").then((S) => S.captureException(error, { extra: context }));
}
