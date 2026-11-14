// The catalog feed Meta reads (1.21 step 2): GET /catalog/feed.csv, behind HTTP basic auth (Meta's scheduled feeds support a
// username and password). Generated from the database on every fetch, so price and availability are the database's at that
// moment. Only products with an approved, customer-usable picture are in it (catalog_feed, 0085). Meta fetches at most hourly;
// the database refuses a sold-out item at once anyway (plan_cart, quote_order, create_order_from_quote).
import type { SupabaseClient } from "@supabase/supabase-js";

export interface FeedRow {
  sku: string; product_id: string; name_en: string; name_ar: string | null; brand: string; price_usd: number; in_stock: boolean;
  media_path: string; attribution: string | null; licence: string;
  category_code: string; category_en: string; category_ar: string; subgroup_en: string | null; subgroup_ar: string | null;
}
export interface FeedSettings { product_link: string | null; image_link_seconds?: number; currency?: string }
export interface FeedDeps {
  db: SupabaseClient;
  /** The feed's password (wrangler secret CATALOG_FEED_PASSWORD). Unset: the route does not exist. */
  password: string | undefined;
  /** Signs a key of the private `media` bucket for `seconds` (the Storage API with the service key; P1's sign.mjs does the same). */
  sign: (mediaPath: string, seconds: number) => Promise<string | null>;
}

export const FEED_USER = "meta";
export const FEED_COLUMNS = ["id", "title", "description", "availability", "condition", "price", "link", "image_link", "brand",
                             "product_type", "custom_label_0"] as const;

const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Constant-time comparison of two strings. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** The CSV Meta reads. Neutral facts only: the names, the brand, the price and the shelf. A CC BY-SA picture carries its credit. */
export function feedCsv(rows: FeedRow[], settings: FeedSettings, images: Map<string, string>): string {
  const currency = settings.currency ?? "USD";
  const lines = [FEED_COLUMNS.join(",")];
  for (const r of rows) {
    const image = images.get(r.sku);
    if (!image) continue;                                   // no picture link, no row: a row without a picture is refused by Meta anyway
    const description = [r.name_ar, r.name_en].filter(Boolean).join(" · ") + (r.attribution ? ` · Photo: ${r.attribution}` : "");
    const cells = [
      r.sku, (r.name_ar ?? r.name_en).slice(0, 200), description.slice(0, 9999), r.in_stock ? "in stock" : "out of stock", "new",
      `${Number(r.price_usd).toFixed(2)} ${currency}`, settings.product_link!.replaceAll("{sku}", encodeURIComponent(r.sku)), image,
      r.brand, [r.category_en, r.subgroup_en].filter(Boolean).join(" > "), r.category_code,
    ];
    lines.push(cells.map((c) => csvCell(String(c))).join(","));
  }
  return lines.join("\n") + "\n";
}

export async function catalogFeed(req: Request, deps: FeedDeps): Promise<Response> {
  if (!deps.password) return new Response("not found", { status: 404 });
  const auth = req.headers.get("Authorization") ?? "";
  const given = auth.startsWith("Basic ") ? (() => { try { return atob(auth.slice(6)); } catch { return ""; } })() : "";
  if (!same(given, `${FEED_USER}:${deps.password}`)) {
    return new Response("unauthorised", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="catalog"' } });
  }
  const settings = ((await deps.db.rpc("setting", { p_key: "catalog" })).data ?? {}) as FeedSettings;
  // Meta's feed asks for a link per product; it is data a person sets (RUNBOOK 1.21). Never guessed here.
  if (!settings.product_link) return new Response("catalog.product_link is not set", { status: 503 });
  const { data, error } = await deps.db.rpc("catalog_feed");
  if (error) return new Response("feed unavailable", { status: 503 });
  const rows = (data ?? []) as FeedRow[];
  const seconds = settings.image_link_seconds ?? 604800;
  const images = new Map<string, string>();
  for (const r of rows) {
    const url = await deps.sign(r.media_path, seconds).catch(() => null);
    if (url) images.set(r.sku, url);
  }
  return new Response(feedCsv(rows, settings, images), { headers: { "content-type": "text/csv; charset=utf-8", "cache-control": "no-store" } });
}
