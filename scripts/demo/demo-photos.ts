// Item photos for the staging demo shops (DECISIONS §39.12): every demo item gets an image for the Meta catalogue. The
// shop's own picture when its online menu or website had one (source = merchant_site: Fred's Food and the menus
// harvested by scripts/menus/), else one illustrative picture drawn from the item (scripts/demo/illustration.ts). Stored in
// the private bucket menu-item-photos as public.menu_item_photos rows (source = merchant_site or illustrative) through public.menu_item_photo_set; never a Google place photo (§38.1). A photo whose
// origin is unchanged is never uploaded again; objects whose row is gone (a claim, a shop that left demo mode) are deleted.
// Env: DB_URL, SUPABASE_URL (https://<ref>.supabase.co), SUPABASE_SERVICE_KEY. Optional PHOTO_LIMIT (default 2000).
// Usage: node --experimental-strip-types scripts/demo/demo-photos.ts
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import pg from "pg";
import { categoryOf, illustrationSvg } from "./illustration.ts";

const BUCKET = "menu-item-photos";
const MAX_BYTES = 2 * 1024 * 1024; // the bucket's file_size_limit
// Bumped when the drawings change, so every illustration is drawn again.
export const DRAWING_VERSION = "1";

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

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** The website image at 800 px (Meta wants at least 500 × 500): WordPress's CDN resizes on request. */
export function sizedImageUrl(url: string): string {
  const u = new URL(url);
  if (/(^|\.)wp\.com$/.test(u.hostname)) {
    u.searchParams.set("resize", "800,800");
    u.searchParams.set("ssl", "1");
  }
  return u.toString();
}

/** Width and height of a PNG, JPEG or WebP from its header; null when it cannot be read. */
export function imageSize(b: Uint8Array): { w: number; h: number } | null {
  const u16be = (i: number) => (b[i]! << 8) | b[i + 1]!;
  const u32be = (i: number) =>
    ((b[i]! << 24) >>> 0) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!;
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) return { w: u32be(16), h: u32be(20) };
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const m = b[i + 1]!;
      // SOF0-SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the frame size.
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
        return { h: u16be(i + 5), w: u16be(i + 7) };
      i += 2 + u16be(i + 2);
    }
    return null;
  }
  if (b.length > 30 && String.fromCharCode(...b.slice(8, 12)) === "WEBP") {
    const kind = String.fromCharCode(...b.slice(12, 16));
    if (kind === "VP8 ")
      return { w: (b[26]! | (b[27]! << 8)) & 0x3fff, h: (b[28]! | (b[29]! << 8)) & 0x3fff };
    if (kind === "VP8L")
      return {
        w: 1 + (((b[22]! & 0x3f) << 8) | b[21]!),
        h: 1 + (((b[24]! & 0x0f) << 10) | (b[23]! << 2) | ((b[22]! & 0xc0) >> 6)),
      };
    if (kind === "VP8X")
      return {
        w: 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16)),
        h: 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16)),
      };
  }
  return null;
}

// Meta's catalogue wants item images of at least 500 × 500.
export const MIN_SIDE = 500;

/** A small picture centred on an 800 × 800 white tile (the whole picture shows, nothing is cropped). */
export function framedSvg(bytes: Uint8Array, type: string): string {
  const data = `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="800" height="800" viewBox="0 0 800 800"><rect width="800" height="800" fill="#ffffff"/><image x="0" y="0" width="800" height="800" preserveAspectRatio="xMidYMid meet" xlink:href="${data}"/></svg>`;
}

/** What one item needs: nothing (unchanged), its website image, or a drawing; with the origin hash that decides it. */
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

export function plan(
  item: TodoItem,
): { kind: "merchant_site" | "illustrative"; hash: string } | null {
  item = { ...item, image_url: ownPicture(item.image_url) };
  const kind = item.image_url ? "merchant_site" : "illustrative";
  const hash =
    kind === "merchant_site"
      ? sha256(String(item.image_url))
      : sha256(
          JSON.stringify([
            DRAWING_VERSION,
            item.name_en,
            item.name_ar,
            item.vendor,
            categoryOf(item),
          ]),
        );
  if (item.photo && item.photo.source === kind && item.photo.origin_hash === hash) return null;
  return { kind, hash };
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
  const headers = { authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, apikey: SUPABASE_SERVICE_KEY };
  const url = new URL(DB_URL);
  url.searchParams.delete("sslmode");
  const local = /^(localhost|127\.0\.0\.1)$/.test(url.hostname);
  const db = new pg.Client({
    connectionString: url.toString(),
    ssl: local ? false : { rejectUnauthorized: false },
  });
  await db.connect();

  // resvg (WebAssembly) and the bundled Noto fonts, as dispatch draws its cards.
  const require = createRequire(import.meta.url);
  const resvg = await import("@resvg/resvg-wasm");
  await resvg.initWasm(readFileSync(require.resolve("@resvg/resvg-wasm/index_bg.wasm")));
  const fontDir = new URL("../../supabase/functions/_shared/fonts/", import.meta.url);
  const fontBuffers = [
    "NotoSans-Regular.ttf",
    "NotoSans-Bold.ttf",
    "NotoNaskhArabic-Regular.ttf",
    "NotoNaskhArabic-Bold.ttf",
  ].map((f) => new Uint8Array(readFileSync(new URL(f, fontDir))));

  const upload = async (path: string, body: Uint8Array, type: string) => {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
      method: "POST",
      headers: { ...headers, "content-type": type, "x-upsert": "true", "cache-control": "86400" },
      body,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`upload ${res.status}`);
  };

  const done = { merchant_site: 0, illustrative: 0, unchanged: 0, failed: 0, deleted: 0 };
  try {
    const todo: TodoItem[] =
      (
        await db.query("select public.demo_photos_todo($1) as t", [
          Number(process.env.PHOTO_LIMIT ?? 2000),
        ])
      ).rows[0].t ?? [];
    await pool(todo, 6, async (item) => {
      const p = plan(item);
      if (!p) {
        done.unchanged++;
        return;
      }
      try {
        let body: Uint8Array;
        let ext = "png";
        let type = "image/png";
        if (p.kind === "merchant_site") {
          const res = await fetch(sizedImageUrl(String(item.image_url)), {
            redirect: "follow",
            signal: AbortSignal.timeout(20_000),
          });
          type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
          if (!res.ok || !["image/jpeg", "image/png", "image/webp"].includes(type))
            throw new Error(`image ${res.status} ${type}`);
          body = new Uint8Array(await res.arrayBuffer());
          if (body.byteLength > 8 * MAX_BYTES) throw new Error("image too large");
          ext = type === "image/jpeg" ? "jpg" : type === "image/webp" ? "webp" : "png";
          const size = imageSize(body);
          // Too small for Meta (or unreadable): framed on an 800 × 800 tile, the whole picture kept.
          if (!size || Math.min(size.w, size.h) < MIN_SIDE || body.byteLength > MAX_BYTES) {
            // resvg draws embedded PNG and JPEG only: a small WebP stays without a photo (the catalogue draws a tile).
            if (type === "image/webp")
              throw new Error(`webp too small to frame ${JSON.stringify(size)}`);
            body = new resvg.Resvg(framedSvg(body, type), { fitTo: { mode: "width", value: 800 } })
              .render()
              .asPng();
            ext = "png";
            type = "image/png";
            if (body.byteLength > MAX_BYTES) throw new Error("framed image too large");
          }
        } else {
          const svg = illustrationSvg({ ...item, category: categoryOf(item) });
          body = new resvg.Resvg(svg, {
            font: { fontBuffers, loadSystemFonts: false, defaultFontFamily: "Noto Sans" },
          })
            .render()
            .asPng();
        }
        const path = `${p.kind}/${item.vendor_id}/${item.item_id}.${ext}`;
        await upload(path, body, type);
        const r = (
          await db.query("select public.menu_item_photo_set($1, $2, $3, $4) as r", [
            item.item_id,
            p.kind,
            path,
            p.hash,
          ])
        ).rows[0].r;
        if (r?.status !== "ok") throw new Error(`record ${r?.status}`);
        done[p.kind]++;
      } catch (e) {
        done.failed++;
        console.error(`photo failed for item ${item.item_id}: ${String(e).slice(0, 160)}`);
      }
    });

    // Objects whose row is gone (claimed, no longer a demo shop, or replaced with another extension).
    const kept = new Set(
      (await db.query("select storage_path from public.menu_item_photos")).rows.map(
        (r) => r.storage_path,
      ),
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
    // website/: the folder of the old name of merchant_site (20261016000000_merchant_site_photos.sql).
    for (const source of ["merchant_site", "illustrative", "website"]) {
      for (const folder of await list(`${source}/`)) {
        if (folder.id) continue; // a file at the top level: not ours
        const files = (await list(`${source}/${folder.name}/`)).filter((f) => f.id);
        const gone = files
          .map((f) => `${source}/${folder.name}/${f.name}`)
          .filter((pth) => !kept.has(pth));
        if (!gone.length) continue;
        const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
          method: "DELETE",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ prefixes: gone }),
          signal: AbortSignal.timeout(20_000),
        });
        if (res.ok) done.deleted += gone.length;
      }
    }
  } finally {
    await db.end();
  }
  console.log(
    `demo item photos: ${done.merchant_site} from the shop's own menu or website, ${done.illustrative} drawn, ${done.unchanged} unchanged, ${done.failed} failed, ${done.deleted} old objects deleted`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(String(e).slice(0, 500));
    process.exit(1);
  });
}
