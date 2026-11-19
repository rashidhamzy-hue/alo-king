// Runs before every page: the visitor's language, the catalog reads as web_channel, a per-address limit on search, the Worker's
// 60-second page cache for the catalog pages (keyed by language, because the page differs by language), and the security headers.
// Price and stock on a cached page can be a minute old; the cart and checkout read them again through quote_order (WEBSITE.md).
import { env as workerEnv } from "cloudflare:workers";
import { catalogFor, joinFor, listingsFor, type WebEnv } from "./lib/db";
import { negotiate } from "./lib/i18n";
import { makeLimiter } from "./lib/rate";
import { guarded, reportCheckIn } from "./lib/sentry";
import { personal } from "./lib/frame";

const searchLimit = makeLimiter(30, 60_000);
// UX3: the two join pages' posts count here too. LV1: the Food pages' two form posts ("I want to order from here", "Remove this listing"). Per address, in one isolate's memory like the search limit; the database also caps what they write.
const foodPostLimit = makeLimiter(20, 60_000);
// WEB2: the basket, sign-in, checkout, history and account form posts, per address (one isolate's memory, like the search limit). The database
// guards what they write (one code per session at a time, one order per request key).
// WEB_POST_LIMIT (a number) changes it; the tests set it high, because they post from one address.
let orderPostLimit: ReturnType<typeof makeLimiter> | null = null;
const CACHEABLE = /^\/(?:$|c\/[^/]+$|p\/[^/]+$)/;

export function securityHeaders(h: Headers, env: WebEnv) {
  const imgs = ["'self'", "data:"];
  try { if (env.SUPABASE_URL) imgs.push(new URL(env.SUPABASE_URL).origin); } catch { /* not a URL: no picture host */ }
  h.set("Content-Security-Policy", [
    "default-src 'self'", `img-src ${imgs.join(" ")}`, "script-src 'self'", "style-src 'self' 'unsafe-inline'",
    "connect-src 'self'", "manifest-src 'self'", "worker-src 'self'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
  ].join("; "));
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "strict-origin-when-cross-origin");
  h.set("Permissions-Policy", "geolocation=(self), camera=(), microphone=()");
}

export async function onRequest(ctx: any, next: () => Promise<Response>): Promise<Response> {
  const env = ctx.locals.env ?? (workerEnv as unknown as WebEnv);
  // OPS1: an error in any page is reported to Sentry (scrubbed, no visitor detail) and still fails as it did.
  return guarded(env, "page", () => handle(ctx, next, env));
}

async function handle(ctx: any, next: () => Promise<Response>, env: WebEnv): Promise<Response> {
  const req: Request = ctx.request;
  const url = new URL(req.url);
  // Staging only: lets the deploy prove the Worker reaches Sentry. A check-in to its own monitor, not an error: it opens no issue.
  if (env.ENVIRONMENT === "staging" && url.pathname === "/__sentry-test" && req.method === "GET") {
    const r = await reportCheckIn(env, "deploy-smoke-web-staging");
    return new Response(`sent ${r.id} flushed=${r.ok}`, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }
  const lang = negotiate(req.headers.get("cookie"), req.headers.get("accept-language"));
  ctx.locals.env = env;
  ctx.locals.lang = lang;
  ctx.locals.catalog = () => catalogFor(env);
  ctx.locals.listings = () => listingsFor(env);
  ctx.locals.join = () => joinFor(env);

  if (url.pathname === "/search" && !searchLimit(req.headers.get("cf-connecting-ip") ?? "unknown")) {
    return new Response("Too many searches. Try again in a minute.", { status: 429, headers: { "Retry-After": "60", "Content-Type": "text/plain; charset=utf-8" } });
  }

  if (req.method === "POST" && /^\/(?:food\/[^/]+\/(?:want|remove)|join\/rider|for-vendors)$/.test(url.pathname) && !foodPostLimit(req.headers.get("cf-connecting-ip") ?? "unknown")) {
    return new Response("Too many requests. Try again in a minute.", { status: 429, headers: { "Retry-After": "60", "Content-Type": "text/plain; charset=utf-8" } });
  }

  // WEB4b: the food basket's and the food checkout's posts count the same.
  if (req.method === "POST" && /^\/(?:cart(?:\/\w+)?|checkout|signin|account|orders|village(?:\/locate)?|food\/basket\/(?:add|line)|food\/checkout)$/.test(url.pathname) && !(orderPostLimit ??= makeLimiter(Number(env.WEB_POST_LIMIT) || 60, 60_000))(req.headers.get("cf-connecting-ip") ?? "unknown")) {
    return new Response("Too many requests. Try again in a minute.", { status: 429, headers: { "Retry-After": "60", "Content-Type": "text/plain; charset=utf-8" } });
  }

  const cache: Cache | null = typeof caches !== "undefined" ? ((caches as unknown as { default?: Cache }).default ?? null) : null;
  // PAGE_CACHE=off is for the tests, which change the database between two requests. (On a workers.dev address the Cache API stores nothing; on the
  // site's own domain it does.)
  // WEB4a: a page that shows the visitor's own village or basket (the frame reads both) is never the cached copy everyone gets.
  const cacheable = req.method === "GET" && CACHEABLE.test(url.pathname) && !url.search && cache !== null && env.PAGE_CACHE !== "off" && !personal(req.headers.get("cookie"));
  const key = new Request(`${url.origin}/__edge/${lang}${url.pathname}`);
  if (cacheable) {
    const hit = await cache!.match(key);
    if (hit) return finish(hit, lang, env, true);
  }
  const res = await next();
  if (cacheable && res.status === 200) {
    const stored = new Response(res.clone().body, res);
    stored.headers.set("Cache-Control", "public, max-age=60");
    const put = cache!.put(key, stored);
    ctx.locals.cfContext?.waitUntil ? ctx.locals.cfContext.waitUntil(put) : await put;
  }
  return finish(res, lang, env, false);
}

/** A response we may edit (a cached one is immutable), with the language and security headers. */
function finish(res: Response, lang: string, env: WebEnv, fromCache: boolean): Response {
  const out = new Response(res.body, res);
  out.headers.set("Content-Language", lang);
  out.headers.append("Vary", "Cookie");
  out.headers.append("Vary", "Accept-Language");
  if ((out.headers.get("content-type") ?? "").startsWith("text/html") && !out.headers.has("Cache-Control")) out.headers.set("Cache-Control", "no-cache");
  if (out.headers.get("Cache-Control")?.startsWith("public")) out.headers.set("Cache-Control", "no-cache");   // browsers revalidate; the Worker's copy is the cache
  if (fromCache) out.headers.set("X-Page-Cache", "hit");
  securityHeaders(out.headers, env);
  return out;
}
