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

/** What one item needs: nothing (unchanged), its website image, or a drawing; with the origin hash that decides it. */
export function plan(item: TodoItem): { kind: "merchant_site" | "illustrative"; hash: string } | null {
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
          if (body.byteLength > MAX_BYTES) throw new Error("image too large");
          ext = type === "image/jpeg" ? "jpg" : type === "image/webp" ? "webp" : "png";
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
