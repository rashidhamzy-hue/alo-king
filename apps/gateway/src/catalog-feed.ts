// The catalog feed Meta reads (1.21 step 2): GET /catalog/feed.csv, behind HTTP basic auth (Meta's scheduled feeds support a
// username and password). Generated from the database on every fetch, so price and availability are the database's at that
// moment. Only products with an approved, customer-usable picture are in it (catalog_feed, 0085). Meta fetches at most hourly;
// the database refuses a sold-out item at once anyway (plan_cart, quote_order, create_order_from_quote).
//
// Pictures (A5, 0115): each row's image_link is the STABLE public address of the picture's copy in the public `catalog` bucket
// (Meta wants a stable address; the week-long signed links into the private bucket were not). The bucket holds a copy of a picture
// only while it is the item's approved, customer-usable picture; syncCatalogPictures() below keeps it so, from the database's list
// of work (catalog_picture_work), every minute from the cron. Receipts, voice notes and proposed pictures are in `media` and
// are never copied. A row whose picture is not copied yet has no address and is left out of the feed until it is.
//
// WEB4b (0252): Meta documents JPEG and PNG, and the founder's pictures are WebP. The feed's image_link is therefore each picture's
// JPEG copy (<sku>-<image id>.feed.jpg in the same public bucket: 1000 x 1000, under 150 KB), made once by the catalog-jpegs workflow
// (scripts/images/feed-jpegs.mjs, sharp: this Worker's 10 ms of CPU cannot decode and encode a picture). A row whose JPEG is not made
// yet is left out, as a row whose copy is not made. A withdrawn picture leaves the feed at once (the database's join), and its JPEG
// leaves the bucket on the next minute here (removing costs no CPU). The website keeps showing the picture as stored (public_path).
import type { SupabaseClient } from "@supabase/supabase-js";

export interface FeedRow {
  sku: string; product_id: string; name_en: string; name_ar: string | null; brand: string; price_usd: number; in_stock: boolean;
  media_path: string; public_path: string | null; attribution: string | null; licence: string;
  /** WEB4b (0252): the JPEG copy for the feed, once made; null until then. */
  feed_jpeg_path?: string | null;
  category_code: string; category_en: string; category_ar: string; subgroup_en: string | null; subgroup_ar: string | null;
}
export interface FeedSettings { product_link: string | null; currency?: string }
export interface FeedDeps {
  db: SupabaseClient;
  /** The feed's password (wrangler secret CATALOG_FEED_PASSWORD). Unset: the route does not exist. */
  password: string | undefined;
  /** The public address of a key in the public `catalog` bucket (the project's storage URL; it never expires). */
  publicUrl: (publicPath: string) => string;
  /** Copies and removes the public pictures before the feed is made, so a withdrawal never waits for the next minute. Best effort. */
  store?: PublicStore;
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
  if (deps.store) await syncCatalogPictures(deps.db, deps.store).catch(() => undefined);   // a failure here is the cron's to report; the feed still serves what is copied
  // Meta's feed asks for a link per product; it is data a person sets (RUNBOOK 1.21). Never guessed here.
  if (!settings.product_link) return new Response("catalog.product_link is not set", { status: 503 });
  const { data, error } = await deps.db.rpc("catalog_feed");
  if (error) return new Response("feed unavailable", { status: 503 });
  const rows = (data ?? []) as FeedRow[];
  const images = new Map<string, string>();
  for (const r of rows) if (r.feed_jpeg_path) images.set(r.sku, deps.publicUrl(r.feed_jpeg_path));   // JPEG only (WEB4b): never the WebP copy
  return new Response(feedCsv(rows, settings, images), { headers: { "content-type": "text/csv; charset=utf-8", "cache-control": "no-store" } });
}

// ---------- the public `catalog` bucket (A5, 0115) ----------
export const CATALOG_BUCKET = "catalog";
/** PERF1: the header of every object in the public bucket (scripts/images/lib/store.mjs uses the same string). */
export const CATALOG_CACHE_CONTROL = "public, max-age=31536000, immutable";
const PRIVATE_BUCKET = "media";
/** A stray younger than this may be a copy whose book entry is about to be written. */
const STRAY_GRACE_MS = 10 * 60_000;

/** The two buckets, behind four verbs, so the rule below can be tested without Storage. */
export interface PublicStore {
  /** Copies a key of the private bucket to a key of the public one. Resolves if the destination already holds it. */
  copy(fromPrivateKey: string, toPublicKey: string): Promise<void>;
  remove(publicKeys: string[]): Promise<void>;
  /** Every object in the public bucket (flat: names are at the root). createdAt is null when Storage did not say. */
  list(): Promise<{ name: string; createdAt: string | null }[]>;
}

/** The real thing, over the Storage API with the service key. */
export function supabasePublicStore(db: SupabaseClient): PublicStore {
  return {
    // PERF1: read and written again rather than Storage's copy, which keeps the private file's "no-cache"; the bytes pass through
    // untouched (no decoding, so no CPU to speak of). A name in `catalog` is never given other bytes, so it is cached for a year.
    async copy(from, to) {
      const { data, error } = await db.storage.from(PRIVATE_BUCKET).download(from);
      if (error || !data) throw new Error(`catalog copy: ${error?.message ?? "no data"}`);
      const up = await db.storage.from(CATALOG_BUCKET).upload(to, await data.arrayBuffer(),
        { upsert: true, contentType: data.type || "image/webp", headers: { "cache-control": CATALOG_CACHE_CONTROL } });
      if (up.error) throw new Error(`catalog copy: ${up.error.message}`);
    },
    async remove(keys) {
      if (!keys.length) return;
      const { error } = await db.storage.from(CATALOG_BUCKET).remove(keys);
      if (error) throw new Error(`catalog remove: ${error.message}`);
    },
    async list() {
      const out: { name: string; createdAt: string | null }[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await db.storage.from(CATALOG_BUCKET).list("", { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
        if (error) throw new Error(`catalog list: ${error.message}`);
        const files = (data ?? []).filter((f) => f.id !== null);               // folders have no id; the bucket is flat
        out.push(...files.map((f) => ({ name: f.name, createdAt: f.created_at ?? null })));
        if ((data ?? []).length < 1000) return out;
      }
    },
  };
}

export interface PictureSyncResult { copied: number; removed: number; strays: number; forgotten: number; failed: number;
  /** WEB4b: feed JPEGs of withdrawn pictures removed from the bucket (they are made by the catalog-jpegs workflow, never here). */
  jpegsRemoved: number;
  /** PERF1: the website's 400 and 800 px copies of withdrawn pictures removed (made by the same workflow, never here). */
  variantsRemoved: number }

/**
 * Makes the public bucket match the database's books: removes first (privacy before convenience), then copies. The list of work
 * comes from catalog_picture_work(), which reads the picture table, never the bucket: so only an approved, customer-usable picture
 * of an active item is ever copied, and only the object a book entry names is removed. With `reconcile` it also lists the bucket,
 * removes any object no book entry names (older than ten minutes), and forgets a book entry whose object is gone.
 * Each job is done on its own: one failure does not stop the others. Throws at the end if any failed, so the caller reports it.
 */
export async function syncCatalogPictures(db: SupabaseClient, store: PublicStore, opts: { reconcile?: boolean; now?: number } = {}): Promise<PictureSyncResult> {
  const r: PictureSyncResult = { copied: 0, removed: 0, strays: 0, forgotten: 0, failed: 0, jpegsRemoved: 0, variantsRemoved: 0 };
  const errors: string[] = [];
  const fail = (what: string, e: unknown) => { r.failed++; errors.push(`${what}: ${String((e as Error)?.message ?? e).slice(0, 120)}`); };
  const call = async <T>(fn: string, args?: Record<string, unknown>): Promise<T> => {
    const { data, error } = await db.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data as T;
  };

  const work = await call<{ copy: { image_id: string; media_path: string; public_path: string }[]; remove: { image_id: string; public_path: string }[] }>("catalog_picture_work");
  for (const j of work.remove ?? []) {
    try { await store.remove([j.public_path]); await call("catalog_picture_removed", { p_image: j.image_id }); r.removed++; } catch (e) { fail(`remove ${j.public_path}`, e); }
  }
  // WEB4b: a withdrawn picture's feed JPEG goes too, first (privacy before convenience). Making one is the workflow's job.
  try {
    const jw = await call<{ remove: { image_id: string; public_path: string }[] }>("catalog_feed_jpeg_work");
    for (const j of jw.remove ?? []) {
      try { await store.remove([j.public_path]); await call("catalog_feed_jpeg_removed", { p_image: j.image_id }); r.jpegsRemoved++; } catch (e) { fail(`remove ${j.public_path}`, e); }
    }
  } catch (e) { fail("feed jpeg work", e); }
  // PERF1: and its website copies (the pages stopped naming them the moment it was withdrawn: catalog_web_picture).
  try {
    const vw = await call<{ remove: { public_path: string }[] }>("catalog_variant_work");
    for (const j of vw.remove ?? []) {
      try { await store.remove([j.public_path]); await call("catalog_variant_removed", { p_path: j.public_path }); r.variantsRemoved++; } catch (e) { fail(`remove ${j.public_path}`, e); }
    }
  } catch (e) { fail("variant work", e); }
  for (const j of work.copy ?? []) {
    try { await store.copy(j.media_path, j.public_path); await call("catalog_picture_copied", { p_image: j.image_id }); r.copied++; } catch (e) { fail(`copy ${j.public_path}`, e); }
  }

  if (opts.reconcile) {
    try {
      const listed = await store.list();
      const names = listed.map((x) => x.name);
      const strays = await call<string[]>("catalog_picture_strays", { p_listed: names });
      const now = opts.now ?? Date.now();
      const old = new Set(strays.filter((name) => {
        const at = listed.find((x) => x.name === name)?.createdAt;
        return !at || now - Date.parse(at) > STRAY_GRACE_MS;               // an object with no date is not given the benefit of the doubt
      }));
      if (old.size) { await store.remove([...old]); r.strays = old.size; }
      r.forgotten = Number(await call<number>("catalog_picture_forget", { p_listed: names }));
    } catch (e) { fail("reconcile", e); }
  }
  if (r.failed) throw new Error(`catalog pictures: ${r.failed} failed (${errors.join("; ")})`);
  return r;
}
