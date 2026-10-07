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
    tracesSampleRate: 0.1,
    beforeSend: scrub,
  });
}

const PHONE = /\+?\d[\d\s-]{7,}\d/g;

/** Masks phone-like digit runs in messages and drops query strings (tracking tokens). */
export function scrub<E extends Sentry.ErrorEvent>(event: E): E {
  if (event.message) event.message = event.message.replace(PHONE, "[phone]");
  for (const ex of event.exception?.values ?? [])
    if (ex.value) ex.value = ex.value.replace(PHONE, "[phone]");
  if (event.request?.url) event.request.url = event.request.url.split("?")[0];
  delete event.request?.query_string;
  return event;
}

export function captureError(error: unknown, context: Record<string, unknown> = {}) {
  if (!started) return;
  Sentry.captureException(error, { extra: context });
}
