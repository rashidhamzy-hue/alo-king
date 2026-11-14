// Runs before every page: the visitor's language, the catalog reads as web_channel, a per-address limit on search, the Worker's
// 60-second page cache for the catalog pages (keyed by language, because the page differs by language), and the security headers.
// Price and stock on a cached page can be a minute old; the cart and checkout read them again through quote_order (WEBSITE.md).
import { env as workerEnv } from "cloudflare:workers";
import { catalogFor, type WebEnv } from "./lib/db";
import { negotiate } from "./lib/i18n";
import { makeLimiter } from "./lib/rate";

const searchLimit = makeLimiter(30, 60_000);
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
  const req: Request = ctx.request;
  const url = new URL(req.url);
  const lang = negotiate(req.headers.get("cookie"), req.headers.get("accept-language"));
  ctx.locals.env = env;
  ctx.locals.lang = lang;
  ctx.locals.catalog = () => catalogFor(env);

  if (url.pathname === "/search" && !searchLimit(req.headers.get("cf-connecting-ip") ?? "unknown")) {
    return new Response("Too many searches. Try again in a minute.", { status: 429, headers: { "Retry-After": "60", "Content-Type": "text/plain; charset=utf-8" } });
  }

  const cache: Cache | null = typeof caches !== "undefined" ? ((caches as unknown as { default?: Cache }).default ?? null) : null;
  // PAGE_CACHE=off is for the tests, which change the database between two requests. (On a workers.dev address the Cache API stores nothing; on the
  // site's own domain it does.)
  const cacheable = req.method === "GET" && CACHEABLE.test(url.pathname) && !url.search && cache !== null && env.PAGE_CACHE !== "off";
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
