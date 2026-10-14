// Copies the Shouf seed photos (supabase/seed/shouf/source/02_shouf_photos.json, DECISIONS §38.1) into the
// private Supabase Storage bucket `vendor-photos` as `seed/<vendor id>/<hash>.jpg`, one public.vendor_photos row
// each (`source = seed`, `status = pending`). They are shown only after the merchant confirms them on a
// claimed vendor's page. The Google URL is never stored, only its SHA-256, so a photo the merchant removed is
// never copied again. Objects of removed photos are deleted on every run.
// Rasheed's decision (§38.1, 14 October 12:13): include the photos, Google's terms notwithstanding.
// Env: DB_URL, SUPABASE_URL (https://<ref>.supabase.co), SUPABASE_SERVICE_KEY. Optional: PHOTO_LIMIT (max new
// photos this run), PHOTO_CONCURRENCY (default 6).
// Usage: node scripts/shouf/copy-photos.mjs [photos.json]
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";

const BUCKET = "vendor-photos";
const MAX_BYTES = 5 * 1024 * 1024; // the bucket's file_size_limit

/** The Google image URL resized to at most `px` on the longest side (the size suffix after the last `=`). */
export function sizedUrl(url, px) {
  const i = url.lastIndexOf("=");
  const base = i > url.indexOf("/", 8) ? url.slice(0, i) : url;
  return `${base}=w${px}-h${px}-k-no`;
}

export const originHash = (url) => createHash("sha256").update(url).digest("hex");

export function storagePath(vendorId, hash, contentType) {
  const ext = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
  return `seed/${vendorId}/${hash.slice(0, 32)}.${ext}`;
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

async function main() {
  const { DB_URL, SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!DB_URL || !SUPABASE_URL || !SUPABASE_SERVICE_KEY)
    throw new Error("set DB_URL, SUPABASE_URL and SUPABASE_SERVICE_KEY");
  const file = process.argv[2] ?? "supabase/seed/shouf/source/02_shouf_photos.json";
  const limit = Number(process.env.PHOTO_LIMIT ?? Infinity);
  const concurrency = Number(process.env.PHOTO_CONCURRENCY ?? 6);
  const headers = { authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, apikey: SUPABASE_SERVICE_KEY };

  const url = new URL(DB_URL);
  url.searchParams.delete("sslmode");
  const local = /^(localhost|127\.0\.0\.1)$/.test(url.hostname);
  // The session pooler's certificate is not in Node's trust store (as in tests/e2e/run.ts); staging only.
  const db = new pg.Client({
    connectionString: url.toString(),
    ssl: local ? false : { rejectUnauthorized: false },
  });
  await db.connect();
  try {
    const px = Number(
      (await db.query("select public.config_numeric('seed_photo_max_px') as px")).rows[0].px,
    );
    const vendors = new Map(
      (
        await db.query(
          "select place_id, id from public.vendors where source = 'seed_shouf_2026_10' and place_id is not null",
        )
      ).rows.map((r) => [r.place_id, r.id]),
    );
    const known = new Set(
      (
        await db.query(
          "select vendor_id || ':' || origin_hash as k from public.vendor_photos where origin_hash is not null",
        )
      ).rows.map((r) => r.k),
    );

    // 1. Removed photos: delete their objects (idempotent).
    const removed = (
      await db.query("select storage_path from public.vendor_photos where status = 'removed'")
    ).rows.map((r) => r.storage_path);
    for (let i = 0; i < removed.length; i += 100) {
      const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
        method: "DELETE",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ prefixes: removed.slice(i, i + 100) }),
      });
      if (!res.ok) console.log(`delete removed photos: HTTP ${res.status}`);
    }

    // 2. New photos.
    const todo = [];
    for (const entry of JSON.parse(readFileSync(file, "utf8"))) {
      const vendorId = vendors.get(entry.place_id);
      if (!vendorId) continue;
      (entry.photos ?? []).forEach((u, order) => {
        if (typeof u !== "string" || !/^https:\/\/lh\d\.googleusercontent\.com\//.test(u)) return;
        const hash = originHash(u);
        if (!known.has(`${vendorId}:${hash}`)) todo.push({ vendorId, url: u, hash, order });
      });
    }
    const batch = todo.slice(0, limit);
    let copied = 0;
    let failed = 0;
    let bytes = 0;
    await pool(batch, concurrency, async (p) => {
      try {
        const img = await fetch(sizedUrl(p.url, px), { signal: AbortSignal.timeout(30_000) });
        const type = (img.headers.get("content-type") ?? "").split(";")[0];
        if (!img.ok || !/^image\/(jpeg|png|webp)$/.test(type))
          throw new Error(`HTTP ${img.status} ${type}`);
        const body = Buffer.from(await img.arrayBuffer());
        if (body.length === 0 || body.length > MAX_BYTES) throw new Error(`size ${body.length}`);
        const path = storagePath(p.vendorId, p.hash, type);
        const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
          method: "POST",
          headers: {
            ...headers,
            "content-type": type,
            "x-upsert": "true",
            "cache-control": "max-age=86400",
          },
          body,
        });
        if (!up.ok) throw new Error(`upload HTTP ${up.status}`);
        await db.query(
          `insert into public.vendor_photos (vendor_id, storage_path, source, status, origin_hash, bytes, sort_order)
           values ($1, $2, 'seed', 'pending', $3, $4, $5)
           on conflict (vendor_id, origin_hash) where origin_hash is not null do nothing`,
          [p.vendorId, path, p.hash, body.length, p.order],
        );
        copied++;
        bytes += body.length;
      } catch (e) {
        failed++;
        if (failed <= 10) console.log(`photo for vendor ${p.vendorId.slice(0, 8)}: ${e.message}`);
      }
    });
    const total = (
      await db.query("select count(*)::int as n from public.vendor_photos where source = 'seed'")
    ).rows[0].n;
    console.log(
      `seed photos: ${copied} copied (${Math.round(bytes / 1024 / 1024)} MB), ${failed} failed, ${todo.length - batch.length} left for the next run, ` +
        `${removed.length} removed objects deleted; ${total} seed photos in Storage`,
    );
  } finally {
    await db.end();
  }
}

if (process.argv[1]?.endsWith("copy-photos.mjs")) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
