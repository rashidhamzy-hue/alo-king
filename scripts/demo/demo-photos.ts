// Item photos and shop covers for the staging demo shops (DECISIONS §39.12, §39.13): real photos only, never a drawn tile
// and never a Google place photo (§38.1). Per item, in this order:
//   1. merchant_site: the shop's own picture from its online menu or website (scripts/menus/ harvests);
//   2. packshot: the product's Open Food Facts front image, for shelf items (scripts/demo/photo-picks.json "packshots",
//      picked by a build session from photo-scout's candidates: by barcode, or brand and name with a confidence check);
//   3. illustrative: one real photo per dish from a free library that allows commercial use (photo-picks.json "dishes",
//      matched through scripts/demo/dishes.ts, falling back to the broader dish).
// Every image is 800 × 800, cropped square with the same treatment (packshots are fitted on white, so no label is cut);
// each shop gets a 1200 × 800 cover (its own photo of a main dish, else the photo of its signature dish). Stored in the
// private bucket menu-item-photos through public.menu_item_photo_set (with license, credit and source) and
// public.vendor_covers. An unchanged photo is never processed again; objects without a row are deleted.
// Env: DB_URL, SUPABASE_URL (https://<ref>.supabase.co), SUPABASE_SERVICE_KEY. Optional PHOTO_LIMIT (default 2000).
// Usage: node --experimental-strip-types scripts/demo/demo-photos.ts
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import sharp from "sharp";
import { dishOf, isShelf, photoChain } from "./dishes.ts";

const BUCKET = "menu-item-photos";
const MAX_BYTES = 2 * 1024 * 1024; // the bucket's file_size_limit
// Bumped when the processing changes, so every photo is made again.
export const PROCESS_VERSION = "5e-1";
export const PICKS_FILE = "scripts/demo/photo-picks.json";

export type TodoItem = {
  item_id: string;
  vendor_id: string;
  name_en: string | null;
  name_ar: string | null;
  description: string | null;
  section_en: string | null;
  business_type: string | null;
  vendor: string | null;
  image_url: string | null;
  photo: { source: string; origin_hash: string | null; storage_path: string } | null;
};

export type Pick = {
  url: string;
  license: string;
  credit: string;
  source_url: string | null;
};
export type Picks = { dishes: Record<string, Pick>; packshots: Record<string, Pick> };

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** The website image at 800 px: WordPress's CDN resizes on request. */
export function sizedImageUrl(url: string): string {
  const u = new URL(url);
  if (/(^|\.)wp\.com$/.test(u.hostname)) {
    u.searchParams.set("resize", "800,800");
    u.searchParams.set("ssl", "1");
  }
  return u.toString();
}

// A Google-hosted picture is never an item photo (DECISIONS §38.1), whatever a draft carries.
const GOOGLE_HOST =
  /(^|\.)(googleusercontent\.com|ggpht\.com|gstatic\.com|googleapis\.com|google\.[a-z.]+|goo\.gl)$/i;
const ownPicture = (url: string | null) => {
  try {
    return url && !GOOGLE_HOST.test(new URL(url).hostname) ? url : null;
  } catch {
    return null;
  }
};

/** The shelf item's key in photo-picks.json "packshots": its English name, trimmed. */
export const packKey = (item: { name_en?: string | null }) => String(item.name_en ?? "").trim();

export type Planned = {
  kind: "merchant_site" | "packshot" | "illustrative";
  url: string;
  hash: string;
  license: string | null;
  credit: string | null;
  source_url: string | null;
  dish: string;
};

/** What one item gets: its own picture, a packshot or the photo of its dish; null when unchanged or when none fits. */
export function plan(item: TodoItem, picks: Picks): Planned | null | "none" {
  const dish = dishOf(item);
  const own = ownPicture(item.image_url);
  let p: Omit<Planned, "hash"> | null = null;
  if (own)
    p = {
      kind: "merchant_site",
      url: sizedImageUrl(own),
      license: "the shop's own",
      credit: item.vendor,
      source_url: own,
      dish,
    };
  else if (isShelf(item) && picks.packshots[packKey(item)]) {
    const k = picks.packshots[packKey(item)];
    p = {
      kind: "packshot",
      url: k.url,
      license: k.license,
      credit: k.credit,
      source_url: k.source_url,
      dish,
    };
  } else if (dish !== "none") {
    const key = photoChain(dish).find((k) => picks.dishes[k]);
    if (key) {
      const k = picks.dishes[key];
      p = {
        kind: "illustrative",
        url: k.url,
        license: k.license,
        credit: k.credit,
        source_url: k.source_url,
        dish: key,
      };
    }
  }
  if (!p) return "none";
  const hash = sha256(JSON.stringify([PROCESS_VERSION, p.kind, p.url]));
  if (item.photo && item.photo.source === p.kind && item.photo.origin_hash === hash) return null;
  return { ...p, hash };
}

/** One look for every product: 800 × 800, cropped on the interesting part (packshots fitted on white instead). */
export async function productImage(bytes: Uint8Array, kind: Planned["kind"]): Promise<Buffer> {
  const img = sharp(bytes, { failOn: "none" }).rotate();
  const out =
    kind === "packshot"
      ? img.resize(720, 720, { fit: "contain", background: "#ffffff" }).extend({
          top: 40,
          bottom: 40,
          left: 40,
          right: 40,
          background: "#ffffff",
        })
      : img.resize(800, 800, { fit: "cover", position: sharp.strategy.attention });
  return out
    .flatten({ background: "#ffffff" })
    .modulate({ saturation: 1.04 })
    .sharpen({ sigma: 0.6 })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
}

/** A shop's cover: 1200 × 800, the same treatment. */
export async function coverImage(bytes: Uint8Array): Promise<Buffer> {
  return sharp(bytes, { failOn: "none" })
    .rotate()
    .resize(1200, 800, { fit: "cover", position: sharp.strategy.attention })
    .flatten({ background: "#ffffff" })
    .modulate({ saturation: 1.04 })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
}

// Dishes that make a shop's cover (a main, not a drink, a dip or a side).
const NOT_COVER =
  /^(none|water|water_gallon|sparkling_water|soda|energy_drink|iced_tea|juice|orange_juice|lemonade|dip|toum|pickles|coleslaw|fries|curly_fries|onion_rings|condiment|pantry|household|diapers|personal_care|grocery)$/;

/** The dish that best stands for a shop: the most common main dish among its items. */
export function signatureDish(dishes: string[]): string | null {
  const n = new Map<string, number>();
  for (const d of dishes) if (!NOT_COVER.test(d)) n.set(d, (n.get(d) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
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
  const picks: Picks = JSON.parse(readFileSync(PICKS_FILE, "utf8"));
  const headers = { authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, apikey: SUPABASE_SERVICE_KEY };
  const url = new URL(DB_URL);
  url.searchParams.delete("sslmode");
  const local = /^(localhost|127\.0\.0\.1)$/.test(url.hostname);
  const db = new pg.Client({
    connectionString: url.toString(),
    ssl: local ? false : { rejectUnauthorized: false },
  });
  await db.connect();
  await db.query("set statement_timeout = '20s'");

  const upload = async (path: string, body: Uint8Array) => {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
      method: "POST",
      headers: {
        ...headers,
        "content-type": "image/jpeg",
        "x-upsert": "true",
        "cache-control": "86400",
      },
      body,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`upload ${res.status}`);
  };
  // Each source picture is downloaded once per run (a dish photo serves many items).
  const fetched = new Map<string, Promise<Uint8Array>>();
  const download = (u: string) => {
    if (!fetched.has(u))
      fetched.set(
        u,
        (async () => {
          const res = await fetch(u, {
            redirect: "follow",
            headers: {
              "user-agent": "AloKing-demo-photos/1.0 (https://github.com/rashidhamzy-hue/alo-king)",
            },
            signal: AbortSignal.timeout(30_000),
          });
          if (!res.ok) throw new Error(`image ${res.status}`);
          const b = new Uint8Array(await res.arrayBuffer());
          if (b.byteLength > 25 * 1024 * 1024) throw new Error("image too large");
          const m = await sharp(b, { failOn: "none" }).metadata();
          if (Math.min(m.width ?? 0, m.height ?? 0) < 300)
            throw new Error(`image too small ${m.width}x${m.height}`);
          return b;
        })(),
      );
    return fetched.get(u)!;
  };

  const done = {
    merchant_site: 0,
    packshot: 0,
    illustrative: 0,
    unchanged: 0,
    none: 0,
    failed: 0,
    covers: 0,
    deleted: 0,
  };
  const byShop = new Map<
    string,
    { vendor: string; dishes: string[]; own: { url: string; dish: string }[] }
  >();
  try {
    const todo: TodoItem[] =
      (
        await db.query("select public.demo_photos_todo($1) as t", [
          Number(process.env.PHOTO_LIMIT ?? 2000),
        ])
      ).rows[0].t ?? [];
    await pool(todo, 6, async (item) => {
      const shop = byShop.get(item.vendor_id) ?? { vendor: item.vendor ?? "", dishes: [], own: [] };
      byShop.set(item.vendor_id, shop);
      const dish = dishOf(item);
      shop.dishes.push(dish);
      const own = ownPicture(item.image_url);
      if (own && !NOT_COVER.test(dish)) shop.own.push({ url: sizedImageUrl(own), dish });
      const p = plan(item, picks);
      if (p === null) return void done.unchanged++;
      if (p === "none") return void done.none++;
      try {
        let bytes: Uint8Array;
        try {
          bytes = await download(p.url);
        } catch (e) {
          // The shop's own picture is gone or too small: the photo of its dish instead.
          if (p.kind === "illustrative") throw e;
          const key = photoChain(dish).find((k) => picks.dishes[k]);
          if (!key) throw e;
          const k = picks.dishes[key];
          Object.assign(p, {
            kind: "illustrative",
            url: k.url,
            license: k.license,
            credit: k.credit,
            source_url: k.source_url,
          });
          p.hash = sha256(JSON.stringify([PROCESS_VERSION, p.kind, p.url]));
          bytes = await download(p.url);
        }
        const body = await productImage(bytes, p.kind);
        if (body.byteLength > MAX_BYTES) throw new Error("image too large after processing");
        const path = `${p.kind}/${item.vendor_id}/${item.item_id}.jpg`;
        await upload(path, body);
        const r = (
          await db.query("select public.menu_item_photo_set($1, $2, $3, $4, $5, $6, $7) as r", [
            item.item_id,
            p.kind,
            path,
            p.hash,
            p.license,
            p.credit,
            p.source_url,
          ])
        ).rows[0].r;
        if (r?.status !== "ok") throw new Error(`record ${r?.status}`);
        done[p.kind]++;
      } catch (e) {
        done.failed++;
        console.error(`photo failed for item ${item.item_id}: ${String(e).slice(0, 160)}`);
      }
    });

    // Covers: the shop's own photo of a main dish, else the photo of its signature dish.
    for (const [vendorId, shop] of byShop) {
      const sig = signatureDish(shop.dishes);
      const own = shop.own.find((o) => o.dish === sig) ?? shop.own[0];
      const dishKey = sig ? photoChain(sig).find((k) => picks.dishes[k]) : null;
      const chosen = own
        ? {
            source: "merchant_site",
            url: own.url,
            license: "the shop's own",
            credit: shop.vendor,
            source_url: own.url,
          }
        : dishKey
          ? { source: "illustrative", ...picks.dishes[dishKey] }
          : null;
      if (!chosen) continue;
      const hash = sha256(JSON.stringify([PROCESS_VERSION, "cover", chosen.url]));
      const cur = (
        await db.query("select origin_hash from public.vendor_covers where vendor_id = $1", [
          vendorId,
        ])
      ).rows[0];
      if (cur?.origin_hash === hash) continue;
      try {
        const body = await coverImage(await download(chosen.url));
        const path = `cover/${vendorId}.jpg`;
        await upload(path, body);
        await db.query(
          `insert into public.vendor_covers (vendor_id, storage_path, source, license, credit, source_url, origin_hash)
           values ($1, $2, $3, $4, $5, $6, $7)
           on conflict (vendor_id) do update set storage_path = excluded.storage_path, source = excluded.source,
             license = excluded.license, credit = excluded.credit, source_url = excluded.source_url,
             origin_hash = excluded.origin_hash, updated_at = now()
           where public.vendor_covers.source <> 'merchant'`,
          [
            vendorId,
            path,
            chosen.source,
            chosen.license,
            String(chosen.credit ?? "").slice(0, 200),
            chosen.source_url,
            hash,
          ],
        );
        done.covers++;
      } catch (e) {
        console.error(`cover failed for shop ${vendorId}: ${String(e).slice(0, 160)}`);
      }
    }

    // Objects whose row is gone (claimed, no longer a demo shop, or the older drawn tiles and PNGs).
    const kept = new Set(
      (
        await db.query(
          "select storage_path from public.menu_item_photos union all select storage_path from public.vendor_covers",
        )
      ).rows.map((r) => r.storage_path),
    );
    const list = async (prefix: string) => {
      const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ prefix, limit: 1000, offset: 0 }),
        signal: AbortSignal.timeout(20_000),
      });
      return res.ok ? ((await res.json()) as { name: string; id: string | null }[]) : [];
    };
    const remove = async (gone: string[]) => {
      if (!gone.length) return;
      const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
        method: "DELETE",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ prefixes: gone }),
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) done.deleted += gone.length;
    };
    // website/: the folder of the old name of merchant_site.
    for (const source of ["merchant_site", "packshot", "illustrative", "website"]) {
      for (const folder of await list(`${source}/`)) {
        if (folder.id) continue; // a file at the top level: not ours
        const files = (await list(`${source}/${folder.name}/`)).filter((f) => f.id);
        await remove(
          files.map((f) => `${source}/${folder.name}/${f.name}`).filter((pth) => !kept.has(pth)),
        );
      }
    }
    await remove(
      (await list("cover/"))
        .filter((f) => f.id)
        .map((f) => `cover/${f.name}`)
        .filter((pth) => !kept.has(pth)),
    );
  } finally {
    await db.end();
  }
  console.log(
    `demo item photos: ${done.merchant_site} the shop's own, ${done.packshot} packshots, ${done.illustrative} dish photos, ${done.unchanged} unchanged, ${done.none} without a photo (not food, or no pick), ${done.failed} failed; ${done.covers} covers; ${done.deleted} old objects deleted`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(String(e).slice(0, 500));
    process.exit(1);
  });
}
