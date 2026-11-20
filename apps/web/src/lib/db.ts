// The website's connection to the database: PostgREST over fetch, as the role web_channel (migration 0132), never the service key.
// The Worker holds the project's anon key (the gateway of the API wants an `apikey`; it is a public key) and a token whose role claim
// is web_channel. Those two and the project address are Worker secrets (docs/HANDOFF.md, WEB1). What the role may call is the nine
// session functions and the four catalog functions; the database refuses everything else.
import { webCatalog, webJoin, webListings, type RpcSource } from "@ak/commerce/index";

export interface WebEnv { ENVIRONMENT?: string; SENTRY_DSN?: string; SUPABASE_URL?: string; SUPABASE_ANON_KEY?: string; WEB_CHANNEL_JWT?: string; PICTURE_TRANSFORMS?: string; PAGE_CACHE?: string; WEB_POST_LIMIT?: string }

export class NotConfigured extends Error { constructor() { super("web: SUPABASE_URL, SUPABASE_ANON_KEY and WEB_CHANNEL_JWT are not all set"); this.name = "NotConfigured"; } }

/** An RpcSource over PostgREST. `timeoutMs` keeps a slow database from holding a page for ever (the page then says "try again"). */
export function postgrestSource(env: WebEnv, fetchImpl: typeof fetch = fetch, timeoutMs = 6000): RpcSource {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.WEB_CHANNEL_JWT) throw new NotConfigured();
  const base = env.SUPABASE_URL.replace(/\/+$/, "");
  return {
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      try {
        const res = await fetchImpl(`${base}/rest/v1/rpc/${encodeURIComponent(fn)}`, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json", apikey: env.SUPABASE_ANON_KEY!, authorization: `Bearer ${env.WEB_CHANNEL_JWT}` },
          body: JSON.stringify(args ?? {}),
          signal: AbortSignal.timeout(timeoutMs),
        });
        const text = await res.text();
        let body: any = null;
        try { body = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
        if (!res.ok) return { data: null, error: { message: String(body?.message ?? `HTTP ${res.status}`), code: body?.code ?? String(res.status) } };
        return { data: body, error: null };
      } catch (e) {
        return { data: null, error: { message: (e as Error).name === "TimeoutError" ? "timeout" : "network" } };
      }
    },
  };
}

export const catalogFor = (env: WebEnv, fetchImpl?: typeof fetch) => webCatalog(postgrestSource(env, fetchImpl));
/** The Food pages' reads and its two writes (LV1), as the same role. */
export const listingsFor = (env: WebEnv, fetchImpl?: typeof fetch) => webListings(postgrestSource(env, fetchImpl));

/** The address of a picture in the public `catalog` bucket. With PICTURE_TRANSFORMS=on the storage service resizes it (a paid-plan feature). */
export function pictureUrl(env: Pick<WebEnv, "SUPABASE_URL" | "PICTURE_TRANSFORMS">, path: string, width?: number): string {
  const base = (env.SUPABASE_URL ?? "").replace(/\/+$/, "");
  const key = path.split("/").map(encodeURIComponent).join("/");
  return env.PICTURE_TRANSFORMS === "on" && width
    ? `${base}/storage/v1/render/image/public/catalog/${key}?width=${width}&resize=contain`
    : `${base}/storage/v1/object/public/catalog/${key}`;
}
/** PERF1: a picture as the cards draw it: the 400 px copy, a 400/800 srcset, its size. Before the copies are made, the original (as before). */
export interface PictureSet { src: string; srcSet: string | null; width: number; height: number }
export function pictureSet(env: Pick<WebEnv, "SUPABASE_URL" | "PICTURE_TRANSFORMS">, pic: { path: string; w400?: string | null; w800?: string | null; width_px?: number | null; height_px?: number | null }, want: 400 | 800): PictureSet {
  if (pic.w400 && pic.w800) {
    const a = pictureUrl(env, pic.w400), b = pictureUrl(env, pic.w800);
    return want === 400 ? { src: a, srcSet: `${a} 400w, ${b} 800w`, width: 400, height: 400 } : { src: b, srcSet: `${a} 400w, ${b} 800w`, width: 800, height: 800 };
  }
  const one = want === 400 ? pic.w400 : pic.w800;
  if (one) return { src: pictureUrl(env, one), srcSet: null, width: want, height: want };
  return { src: pictureUrl(env, pic.path, want), srcSet: null, width: pic.width_px ?? want, height: pic.height_px ?? want };
}
/** The join pages (UX3): /join/rider and /for-vendors, as the same role. */
export const joinFor = (env: WebEnv, fetchImpl?: typeof fetch) => webJoin(postgrestSource(env, fetchImpl));
