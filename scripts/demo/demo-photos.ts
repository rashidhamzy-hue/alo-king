// Item photos and shop covers for the staging demo shops (DECISIONS §39.12, §39.13): real photos only, never a drawn tile
// and never a Google place photo (§38.1). Per item, in this order:
//   1. merchant_site: the shop's own picture from its online menu or website (scripts/menus/ harvests);
//   2. packshot: the product's Open Food Facts front image, for shelf items (scripts/demo/photo-picks.json "packshots",
//      picked by a build session from photo-scout's candidates: by barcode, or brand and name with a confidence check);
//   3. illustrative: one real photo per dish from a free library that allows commercial use (photo-picks.json "dishes",
//      matched through photoDish in scripts/demo/dishes.ts, falling back to a broader dish only where its photo shows
//      the same dish). Better nothing than a wrong photo (session 5g): an item no dish photo fits gets none, and a dish
//      photo it had before is removed (never a merchant's own), so its shop's cover is chosen again without it.
// A pick is used only when its license allows commercial use and it is credited, and never from a Google host (pickOk).
// The catalogue validator (DECISIONS §39.15.4, supabase/functions/_shared/catalog-rules.ts) runs before a photo is saved:
// on the source picture (at least 500 px on a side, an https address, not a placeholder) and on the processed file Meta
// fetches (every image rule); a refused shop's own picture falls back to the dish photo, as a failed download does.
// Every image is 800 × 800, cropped square with the same treatment (packshots are fitted on white, so no label is cut);
// each shop gets a 1200 × 800 cover (the first of its own photos of a main dish, signature dish first, then the picked
// photos of its main dishes from the most common down, that makes a cover; coverCandidates). Stored in the
// private bucket menu-item-photos through public.menu_item_photo_set (with license, credit and source) and
// public.vendor_covers. An unchanged photo is never processed again; objects without a row are deleted.
// Env: DB_URL, SUPABASE_URL (https://<ref>.supabase.co), SUPABASE_SERVICE_KEY. Optional PHOTO_LIMIT (default 2000).
// Usage: node --experimental-strip-types scripts/demo/demo-photos.ts
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import sharp from "sharp";
import { isShelf, ownPhotoDish, photoChain, photoDish } from "./dishes.ts";
import {
  imageHeader,
  MIN_IMAGE_SIDE,
  validateCatalogItem,
  type CatalogIssue,
} from "../../supabase/functions/_shared/catalog-rules.ts";

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
  /** Packshots: the brand on the pack; the pick serves only items whose name carries it (the confidence check). */
  brand?: string;
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

// Smallest side of a source picture (DECISIONS §39.13: every product image at least 500 × 500): the validator's.
export const MIN_SIDE = MIN_IMAGE_SIDE;

export type SourcePicture = {
  url: string;
  bytes: Uint8Array;
  /** As a decoder measured it (any format sharp reads); the header is read first when it is JPEG, PNG or WebP. */
  width: number | null;
  height: number | null;
};

const uniq = (issues: CatalogIssue[]) =>
  issues.filter((x, k) => issues.findIndex((y) => y.code === x.code) === k);

/**
 * The catalogue validator on a source picture (§39.15.4): big enough on its own (a picture enlarged to 800 px stays
 * blurred), an https address, not a placeholder. Its shape does not count: every photo is cropped (or fitted on white)
 * to a square.
 */
export function sourceIssues(src: SourcePicture): CatalogIssue[] {
  return validateCatalogItem(
    {},
    { url: src.url, name: src.url, bytes: src.bytes, width: src.width, height: src.height },
  ).filter((i) => i.code !== "image_not_square");
}

/** What would stop a photo from being saved: the source's issues, then the processed file's (what Meta fetches). */
export function photoIssues(src: SourcePicture, body: Uint8Array): CatalogIssue[] {
  return uniq([...sourceIssues(src), ...validateCatalogItem({}, { bytes: body })]);
}

/** The size the sync's validator checks, read from a stored file's header; null when it cannot be read. */
export function measureOf(
  bytes: Uint8Array,
): { width: number; height: number; bytes: number } | null {
  const head = imageHeader(bytes);
  return head ? { width: head.width, height: head.height, bytes: bytes.byteLength } : null;
}

/** Thrown when the validator refuses a photo; its codes go in the run's log. */
// No TypeScript parameter property here: CI runs this file with node --experimental-strip-types, which refuses them
// (session 5g: every run since #222 stopped at load, unnoticed, so no photo changed).
export class RefusedPhoto extends Error {
  readonly issues: CatalogIssue[];
  constructor(issues: CatalogIssue[]) {
    super(`refused by the catalogue rules: ${issues.map((i) => i.code).join(", ")}`);
    this.issues = issues;
  }
}

/**
 * Items Meta's catalogue would hold for its commerce policy (alcohol, tobacco, medicine), counted in the run's summary:
 * their photo is still saved (the chat and the web menu show it), the sync keeps them out of the catalogue.
 */
export const policyHeld = (item: TodoItem) =>
  validateCatalogItem({
    name_en: item.name_en,
    name_ar: item.name_ar,
    section_en: item.section_en,
    business_type: item.business_type,
  }).filter((i) => i.field === "policy");

const fold = (x: string | null | undefined) =>
  String(x ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

/**
 * Whether a pick may be used: a URL off Google's hosts (§38.1), a credit, and a license the source allows for commercial
 * use (§39.13): dish photos CC0, public domain, CC BY, Pexels or Unsplash; packshots CC BY-SA from Open Food Facts,
 * with a brand that the item's name carries.
 */
export function pickOk(
  kind: "packshot" | "illustrative",
  k: Pick | undefined,
  item?: TodoItem,
): k is Pick {
  if (!k || !ownPicture(k.url) || (k.source_url && !ownPicture(k.source_url))) return false;
  if (!k.credit?.trim()) return false;
  if (kind === "illustrative")
    return /^(CC0\b|Public Domain Mark\b|PDM\b|CC BY \d|Pexels License$|Unsplash License$)/i.test(
      k.license ?? "",
    );
  const host = (() => {
    try {
      return new URL(k.url).hostname;
    } catch {
      return "";
    }
  })();
  if (!/^CC BY-SA \d/i.test(k.license ?? "") || !/(^|\.)openfoodfacts\.org$/.test(host))
    return false;
  const brand = fold(k.brand).trim();
  return !!brand && (fold(item?.name_en).includes(brand) || fold(item?.name_ar).includes(brand));
}

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
  const dish = photoDish(item);
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
  else if (isShelf(item) && pickOk("packshot", picks.packshots[packKey(item)], item)) {
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
    const key = photoChain(dish).find((k) => pickOk("illustrative", picks.dishes[k]));
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

/**
 * The dish photo that replaces a shop's own picture when it cannot be used (gone, or refused by the catalogue rules):
 * null when the item already has it, "none" when no dish photo fits the item.
 */
export function dishFallback(item: TodoItem, picks: Picks): Planned | null | "none" {
  const key = photoChain(photoDish(item)).find((k) => pickOk("illustrative", picks.dishes[k]));
  if (!key) return "none";
  const k = picks.dishes[key];
  const hash = sha256(JSON.stringify([PROCESS_VERSION, "illustrative", k.url]));
  if (item.photo?.source === "illustrative" && item.photo.origin_hash === hash) return null;
  return {
    kind: "illustrative",
    url: k.url,
    license: k.license,
    credit: k.credit,
    source_url: k.source_url,
    dish: key,
    hash,
  };
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

export type CoverCandidate = {
  source: "merchant_site" | "illustrative";
  url: string;
  license: string;
  credit: string;
  source_url: string | null;
};

/**
 * A shop's cover candidates, best first (DECISIONS §39.15.2: a burger place shows a burger): its own photos, those of its
 * main category's dishes first (the category most of its items fall in, `mainDishes` ranked by what is ordered, then by
 * how common), then its signature dish; then the picked photos of its main category's dishes, then of its other main
 * dishes from the most common down. The run takes the first that downloads at 500 px or more.
 */
export function coverCandidates(
  shop: {
    vendor: string;
    dishes: string[];
    own: { url: string; original: string; dish: string }[];
    /** Dishes of the shop's main category, best first; empty when the shop has none. */
    mainDishes?: string[];
  },
  picks: Picks,
): CoverCandidate[] {
  const sig = signatureDish(shop.dishes);
  const main = (shop.mainDishes ?? []).filter((d) => !NOT_COVER.test(d));
  // An own photo whose item the rules name no dish for ("other") comes after every named one.
  const rank = (d: string) =>
    main.includes(d) ? main.indexOf(d) : main.length + (d === sig ? 0 : d === "other" ? 2 : 1);
  const own = shop.own
    .filter((o) => !NOT_COVER.test(o.dish))
    .sort((a, b) => rank(a.dish) - rank(b.dish));
  const out: CoverCandidate[] = own.map((o) => ({
    source: "merchant_site",
    url: o.url,
    license: "the shop's own",
    credit: shop.vendor || "the shop",
    source_url: o.original,
  }));
  const n = new Map<string, number>();
  for (const d of shop.dishes) if (!NOT_COVER.test(d)) n.set(d, (n.get(d) ?? 0) + 1);
  const seen = new Set(out.map((c) => c.url));
  const others = [...n]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([d]) => d)
    .filter((d) => !main.includes(d));
  for (const d of [...main, ...others]) {
    const key = photoChain(d).find((k) => pickOk("illustrative", picks.dishes[k]));
    if (!key || seen.has(picks.dishes[key].url)) continue;
    seen.add(picks.dishes[key].url);
    out.push({ source: "illustrative", ...picks.dishes[key] });
  }
  return out;
}

export const coverHash = (c: { url: string }) =>
  sha256(JSON.stringify([PROCESS_VERSION, "cover", c.url]));

/**
 * The cover candidates a run tries, best first: [] when the current cover stays, null when it goes (no candidate). A
 * merchant's own cover is never touched; a cover from the shop's own photos (merchant_site) is replaced only by
 * another of its own photos while the shop has any, never by a dish photo, and is removed only when it has none left.
 * When no candidate downloads, the current cover stays.
 */
export function coverTries(
  cur: { source: string; origin_hash: string | null } | undefined,
  candidates: CoverCandidate[],
): CoverCandidate[] | null {
  if (cur?.source === "merchant") return [];
  const own = candidates.filter((c) => c.source === "merchant_site");
  const list = cur?.source === "merchant_site" && own.length ? own : candidates;
  if (!list.length) return cur ? null : [];
  const at = cur ? list.findIndex((c) => coverHash(c) === cur.origin_hash) : -1;
  if (at === 0) return [];
  return at > 0 ? list.slice(0, at) : list;
}

/**
 * Whether an item's photo goes when the plan gives it none: a dish photo (illustrative) always, as no dish photo fits it
 * any more or its pick is gone; a packshot or the shop's own picture only when its own source is gone (the packshot pick,
 * or the picture on the shop's menu), never for a dish-fit reason; a merchant's own never.
 */
export function clearsOnNone(item: TodoItem, picks: Picks): boolean {
  const src = item.photo?.source;
  if (src === "illustrative") return true;
  if (src === "packshot")
    return !(isShelf(item) && pickOk("packshot", picks.packshots[packKey(item)], item));
  if (src === "merchant_site") return !ownPicture(item.image_url);
  return false;
}

/**
 * The dishes of a shop's items in its main category (the category's item pattern, a Postgres regex: \m and \M are word
 * boundaries), ranked by units ordered, then by how many items share the dish.
 */
export function mainCategoryDishes(
  items: TodoItem[],
  pattern: string,
  ordered: Map<string, number> = new Map(),
): string[] {
  let re: RegExp;
  try {
    re = new RegExp(pattern.replace(/\\[mM]/g, "\\b"), "i");
  } catch {
    return [];
  }
  const score = new Map<string, [number, number]>();
  for (const it of items) {
    if (!re.test(`${it.name_en ?? ""} ${it.name_ar ?? ""}`)) continue;
    const d = photoDish(it);
    if (NOT_COVER.test(d)) continue;
    const [o, c] = score.get(d) ?? [0, 0];
    score.set(d, [o + (ordered.get(it.item_id) ?? 0), c + 1]);
  }
  return [...score]
    .sort((a, b) => b[1][0] - a[1][0] || b[1][1] - a[1][1] || a[0].localeCompare(b[0]))
    .map(([d]) => d);
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
  // Demo photos and the Storage clean-up are for alo-king-staging (or a local database) only.
  if (
    !/^https:\/\/tzugbbatfbvrfzxuacqx\.supabase\.co\/?$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(
      SUPABASE_URL,
    )
  )
    throw new Error("demo photos run on alo-king-staging only");
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
  // Each source picture is downloaded once per run (a dish photo serves many items), and checked by the catalogue
  // validator (§39.15.4: at least 500 px on a side, https, not a placeholder) before it is used.
  const fetched = new Map<string, Promise<SourcePicture>>();
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
          const src = { url: u, bytes: b, width: m.width ?? null, height: m.height ?? null };
          const issues = sourceIssues(src);
          if (issues.length) throw new RefusedPhoto(issues);
          return src;
        })(),
      );
    return fetched.get(u)!;
  };
  // The processed photo, refused when Meta would refuse what it fetches.
  const make = async (pl: Planned) => {
    const src = await download(pl.url);
    const body = await productImage(src.bytes, pl.kind);
    const issues = photoIssues(src, body);
    if (issues.length) throw new RefusedPhoto(issues);
    return body;
  };

  const done = {
    merchant_site: 0,
    packshot: 0,
    illustrative: 0,
    unchanged: 0,
    none: 0,
    failed: 0,
    refused: 0,
    held: 0,
    measured: 0,
    covers: 0,
    cleared: 0,
    deleted: 0,
  };
  const byShop = new Map<
    string,
    {
      vendor: string;
      dishes: string[];
      own: { url: string; original: string; dish: string }[];
      mainDishes?: string[];
    }
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
      // The dish whose photo may show the item (none for a pack, a branded drink or a dish with no fitting photo): it
      // decides the item's dish photo and the shop's illustrative cover alike, so a dropped photo never stays a cover.
      const dish = photoDish(item);
      shop.dishes.push(dish);
      if (policyHeld(item).length) done.held++;
      // The shop's own photo is the item itself: the dish-fit rules do not apply, only "not a main" (a drink, a side,
      // a topping); an item the rules name no dish for is still a cover candidate, ranked last.
      const own = ownPicture(item.image_url);
      const ownDish = ownPhotoDish(item);
      if (own && !NOT_COVER.test(ownDish))
        shop.own.push({ url: sizedImageUrl(own), original: own, dish: ownDish });
      const p = plan(item, picks);
      if (p === null) return void done.unchanged++;
      // The item's photo goes (never a merchant's own); its object is deleted below.
      const clear = async () => {
        try {
          const r = (await db.query("select public.menu_item_photo_clear($1) as r", [item.item_id]))
            .rows[0].r;
          if (r?.status === "ok") done.cleared++;
        } catch (e) {
          done.failed++;
          console.error(`clearing item ${item.item_id} failed: ${String(e).slice(0, 160)}`);
        }
      };
      if (p === "none") {
        done.none++;
        // A dish photo that no longer fits the item or whose pick is gone (the old drawn tiles were dish photos too);
        // a packshot or the shop's own picture only when its own source is gone (clearsOnNone).
        if (clearsOnNone(item, picks)) await clear();
        return;
      }
      try {
        let body: Buffer;
        try {
          body = await make(p);
        } catch (e) {
          // The shop's own picture is gone, or the catalogue rules refuse it: the photo of its dish instead.
          if (p.kind === "illustrative") throw e;
          const fb = dishFallback(item, picks);
          if (fb === null) return void done.unchanged++;
          if (fb === "none") {
            // No dish photo fits the item (session 5g): an older dish photo standing in for it goes too.
            if (item.photo?.source === "illustrative") await clear();
            throw e;
          }
          Object.assign(p, fb);
          body = await make(p);
        }
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
        // Its size, for the validator in the catalogue sync (the processed file is what Meta fetches).
        const size = measureOf(body);
        if (size)
          await db.query("select public.menu_item_photo_measure($1, $2, $3, $4, $5)", [
            item.item_id,
            path,
            size.width,
            size.height,
            size.bytes,
          ]);
        done[p.kind]++;
      } catch (e) {
        if (e instanceof RefusedPhoto) done.refused++;
        else done.failed++;
        console.error(`photo failed for item ${item.item_id}: ${String(e).slice(0, 160)}`);
      }
    });

    // Photos made before their size was recorded (session 5f part 9) are measured from the stored file, without making
    // or uploading them again, so the sync's size checks apply to every photo.
    const unmeasured = (
      await db.query(
        `select item_id, storage_path from public.menu_item_photos
         where item_id = any ($1::uuid[]) and width is null and source <> 'merchant'`,
        [todo.map((t) => t.item_id)],
      )
    ).rows as { item_id: string; storage_path: string }[];
    await pool(unmeasured, 6, async (ph) => {
      try {
        const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${ph.storage_path}`, {
          headers,
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) throw new Error(`stored photo ${res.status}`);
        const size = measureOf(new Uint8Array(await res.arrayBuffer()));
        if (!size) throw new Error("stored photo unreadable");
        await db.query("select public.menu_item_photo_measure($1, $2, $3, $4, $5)", [
          ph.item_id,
          ph.storage_path,
          size.width,
          size.height,
          size.bytes,
        ]);
        done.measured++;
      } catch (e) {
        done.failed++;
        console.error(
          `measuring the photo of item ${ph.item_id} failed: ${String(e).slice(0, 160)}`,
        );
      }
    });

    // Each shop's main category (the browse category most of its items fall in) and the dishes of its items in it,
    // ranked by what is ordered, then by how common (DECISIONS §39.15.2: the cover shows what the shop is known for).
    const ids = [...byShop.keys()];
    const mains = (
      await db.query(
        `select m.vendor_id, c.item_pattern from (
           select distinct on (vendor_id) vendor_id, category from app_private.vendor_browse_categories
           where vendor_id = any ($1::uuid[]) order by vendor_id, items desc, category) m
         join public.browse_categories c on c.key = m.category where c.item_pattern is not null`,
        [ids],
      )
    ).rows as { vendor_id: string; item_pattern: string }[];
    const ordered = new Map<string, number>(
      (
        await db.query(
          // Delivered real orders only: simulator numbers (+999) and demo orders (is_demo: a demo shop's or a tester's) never
          // count in a shop's figures (§39.15.3).
          `select oi.item_id, sum(oi.quantity)::int as n from public.order_items oi join public.orders o on o.id = oi.order_id
           join public.customers cu on cu.id = o.customer_id
           where o.vendor_id = any ($1::uuid[]) and o.status = 'delivered' and not o.is_demo and cu.phone_e164 !~ '^\\+999'
           group by oi.item_id`,
          [ids],
        )
      ).rows.map((r: { item_id: string; n: number }) => [r.item_id, r.n]),
    );
    for (const m of mains) {
      const shop = byShop.get(m.vendor_id);
      if (!shop) continue;
      shop.mainDishes = mainCategoryDishes(
        todo.filter((t) => t.vendor_id === m.vendor_id),
        m.item_pattern,
        ordered,
      );
    }
    // Covers: the first candidate that makes a cover (its own photo of a main dish, else a picked photo of its dishes).
    for (const [vendorId, shop] of byShop) {
      const candidates = coverCandidates(shop, picks);
      const cur = (
        await db.query(
          "select origin_hash, source from public.vendor_covers where vendor_id = $1",
          [vendorId],
        )
      ).rows[0];
      // The current cover stays unless a better-ranked candidate now makes one (an unchanged run makes no new cover; a
      // fallback is upgraded once the better photo works again); a merchant's own is never touched and a cover from
      // the shop's own photos gives way only to another of them (coverTries).
      const tries = coverTries(cur, candidates);
      if (tries === null) {
        // No cover any more (its pick is gone): the old one goes; its object is deleted below.
        await db.query("select public.vendor_cover_set($1, null, null, null, null, null, null)", [
          vendorId,
        ]);
        continue;
      }
      if (!tries.length) continue;
      // Whether the current cover is still a candidate (then it simply stays when nothing better downloads).
      const stillCandidate = !!cur && candidates.some((c) => coverHash(c) === cur.origin_hash);
      let made = false;
      for (const chosen of tries) {
        let body: Buffer;
        try {
          body = await coverImage((await download(chosen.url)).bytes);
        } catch (e) {
          // Only a picture that cannot be downloaded or made into a cover moves on to the next candidate.
          console.error(`cover candidate failed for shop ${vendorId}: ${String(e).slice(0, 160)}`);
          continue;
        }
        try {
          const path = `cover/${vendorId}.jpg`;
          await upload(path, body);
          const r = (
            await db.query("select public.vendor_cover_set($1, $2, $3, $4, $5, $6, $7) as r", [
              vendorId,
              chosen.source,
              path,
              coverHash(chosen),
              chosen.license,
              String(chosen.credit ?? "").slice(0, 200),
              chosen.source_url,
            ])
          ).rows[0].r;
          if (r?.status !== "ok") throw new Error(`record ${r?.status}`);
          done.covers++;
          made = true;
        } catch (e) {
          // An upload or record failure is not about the picture: stop, so the object and its row never disagree.
          console.error(`cover failed for shop ${vendorId}: ${String(e).slice(0, 160)}`);
        }
        break;
      }
      if (!made && !stillCandidate) console.error(`no cover for shop ${vendorId}`);
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
    `demo item photos: ${done.merchant_site} the shop's own, ${done.packshot} packshots, ${done.illustrative} dish photos, ${done.unchanged} unchanged, ${done.none} without a photo (not food, or no pick), ${done.refused} refused by the catalogue rules, ${done.measured} older photos measured, ${done.failed} failed, ${done.cleared} photos without a pick removed; ${done.held} items the catalogue holds for its commerce policy; ${done.covers} covers; ${done.deleted} old objects deleted`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(String(e).slice(0, 500));
    process.exit(1);
  });
}
