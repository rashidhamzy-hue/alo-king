import * as Sentry from "@sentry/react";

// Sentry project javascript-tanstackstart-react (DSNs are public by design). VITE_SENTRY_DSN overrides it;
// set it to "off" to disable reporting (for example in local development).
const DEFAULT_DSN =
  "https://7d8e7343d380b99afd90b5bf7414f4ec@o4512003528720384.ingest.de.sentry.io/4512209415438416";

const env = import.meta.env as Record<string, string | undefined>;
let started = false;

/** Starts browser error reporting once. No-op on the server, in tests and when disabled. */
export function initSentry() {
  if (started || typeof window === "undefined" || env["MODE"] === "test") return;
  const dsn = env["VITE_SENTRY_DSN"] ?? DEFAULT_DSN;
  if (!dsn || dsn === "off") return;
  started = true;
  Sentry.init({
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
}

// 7+ digits with optional spaces or dashes: Lebanese local (03 123 456) and international numbers.
const PHONE = /\+?\d[\d\s-]{5,}\d/g;
// Path segments that act as bearer tokens (signed tracking links, claim and handoff links).
const TOKEN_PATH = /\/(track|t|claim|h)\/[^/?#]+/g;

export const scrubText = (s: string) => s.replace(PHONE, "[phone]");
export const scrubUrl = (u: string) =>
  (u.split(/[?#]/)[0] ?? "").replace(TOKEN_PATH, "/$1/[token]");

/** Masks phones, path tokens and query strings in everything an error event carries. */
export function scrub<E extends Sentry.ErrorEvent>(event: E): E {
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

export function captureError(error: unknown, context: Record<string, unknown> = {}) {
  if (!started) return;
  Sentry.captureException(error, { extra: context });
}
