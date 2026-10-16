// Finds photo candidates for the staging demo shops' items (DECISIONS §39.12, session 5e) so a build session can pick
// them by eye: one real food photo per dish from a free library that allows commercial use (Openverse: CC0, public
// domain mark and CC BY only; Pexels too when PEXELS_API_KEY is set), and Open Food Facts packshots for shelf items
// (by barcode or by brand and name, with a confidence score). Writes candidates.json and contact sheets (JPEG grids
// with the candidate numbers) to OUT_DIR; the photo-scout workflow pushes them to a data/photo-scout-<run> branch.
// Nothing is stored on staging: the picks go to scripts/demo/photo-picks.json, which demo-photos.ts applies.
// Env: DB_URL (staging, read only), OUT_DIR; optional PEXELS_API_KEY, ONLY_KEYS (comma list), MAX_PER_KEY (default 8).
// Usage: node --experimental-strip-types scripts/demo/photo-scout.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import sharp from "sharp";
import { DISH, dishOf, isShelf, photoChain } from "./dishes.ts";

const UA = "AloKing-demo-photo-scout/1.0 (https://github.com/rashidhamzy-hue/alo-king)";
const OPENVERSE = "https://api.openverse.org/v1/images/";
const OFF_SEARCH = "https://world.openfoodfacts.org/cgi/search.pl";

export type Candidate = {
  n: number;
  provider: string;
  id: string;
  url: string;
  title: string | null;
  creator: string | null;
  license: string;
  license_url: string | null;
  source_url: string | null;
  width: number | null;
  height: number | null;
};

export type Packshot = {
  n: number;
  barcode: string;
  product_name: string;
  brands: string | null;
  quantity: string | null;
  image_url: string;
  score: number;
  // Open Food Facts product images are CC BY-SA 3.0, credited to its contributors.
  license: string;
  license_url: string;
  credit: string;
  source_url: string;
};

/** Openverse answered 429 twice in a row: its anonymous quota is spent for this run. */
let openverseSpent = false;
let openverse429 = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(url: string, headers: Record<string, string> = {}, tries = 4): Promise<any> {
  for (let t = 1; t <= tries; t++) {
    const res = await fetch(url, {
      headers: { "user-agent": UA, ...headers },
      signal: AbortSignal.timeout(30_000),
    }).catch(() => null);
    if (res?.ok) {
      if (url.startsWith(OPENVERSE)) openverse429 = 0;
      return res.json();
    }
    if (res?.status === 429 && url.startsWith(OPENVERSE) && ++openverse429 >= 2) {
      openverseSpent = true;
      console.error("  Openverse quota spent for this run; no more Openverse searches");
      return null;
    }
    const wait = res?.status === 429 ? 30_000 * t : 3_000 * t;
    console.error(
      `  ${res?.status ?? "no answer"} for ${url.slice(0, 120)}; waiting ${wait / 1000}s`,
    );
    await sleep(wait);
  }
  return null;
}

/** Commercial use without conditions beyond attribution: CC0, the public domain mark and CC BY (never BY-SA, NC, ND). */
export const OPEN_LICENSES = new Set(["cc0", "pdm", "by"]);

export function openverseCandidates(body: any): Omit<Candidate, "n">[] {
  return (body?.results ?? [])
    .filter((r: any) => OPEN_LICENSES.has(String(r.license)) && !r.mature)
    .filter((r: any) => (r.width ?? 0) >= 800 && (r.height ?? 0) >= 600)
    .filter((r: any) => /^(jpg|jpeg|png)$/i.test(String(r.filetype ?? "jpg")))
    .map((r: any) => ({
      provider: `openverse:${r.source ?? r.provider}`,
      id: String(r.id),
      url: String(r.url),
      title: r.title ?? null,
      creator: r.creator ?? null,
      license:
        `CC ${String(r.license).toUpperCase()}${r.license_version ? ` ${r.license_version}` : ""}`
          .replace("CC CC0", "CC0")
          .replace("CC PDM", "Public Domain Mark"),
      license_url: r.license_url ?? null,
      source_url: r.foreign_landing_url ?? null,
      width: r.width ?? null,
      height: r.height ?? null,
    }));
}

export function pexelsCandidates(body: any): Omit<Candidate, "n">[] {
  return (body?.photos ?? []).map((p: any) => ({
    provider: "pexels",
    id: String(p.id),
    url: String(p.src?.large2x ?? p.src?.original),
    title: p.alt ?? null,
    creator: p.photographer ?? null,
    license: "Pexels License",
    license_url: "https://www.pexels.com/license/",
    source_url: p.url ?? null,
    width: p.width ?? null,
    height: p.height ?? null,
  }));
}

const STOP = new Set([
  "the",
  "and",
  "with",
  "of",
  "de",
  "pack",
  "bag",
  "large",
  "small",
  "family",
  "size",
  "x",
  "pcs",
]);
export const words = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[0-9]+(\.[0-9]+)?\s*(ml|l|g|kg|gr|cl|oz|liters?|litres?)\b/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP.has(w));

/** How well an Open Food Facts product matches a shelf item's name: share of the item's words found, brand weighted. */
export function packshotScore(
  itemName: string,
  p: { product_name?: string; brands?: string },
): number {
  const want = words(itemName);
  if (!want.length) return 0;
  const have = new Set(words(`${p.product_name ?? ""} ${p.brands ?? ""}`));
  const brand = words(p.brands ?? "");
  const hit = want.filter((w) => have.has(w)).length / want.length;
  const brandHit = brand.length > 0 && brand.some((b) => want.includes(b)) ? 1 : 0;
  return Math.round((0.7 * hit + 0.3 * brandHit) * 100) / 100;
}

/** The full-size front image instead of the 400 px one Open Food Facts lists. */
export const fullOffImage = (u: string) => u.replace(/\.(100|200|400)\.(jpg|png)$/, ".full.$2");

async function thumb(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok || Number(res.headers.get("content-length") ?? 0) > 25 * 1024 * 1024) return null;
    const b = Buffer.from(await res.arrayBuffer());
    if (b.length > 25 * 1024 * 1024) return null;
    return await sharp(b)
      .rotate()
      .resize(220, 220, { fit: "cover" })
      .jpeg({ quality: 80 })
      .toBuffer();
  } catch {
    return null;
  }
}

const esc = (s: string) => s.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** One contact sheet: a row per key, its candidates numbered left to right. */
async function sheet(
  rows: { label: string; cells: { n: number; img: Buffer | null; note: string }[] }[],
  file: string,
) {
  const W = 220,
    H = 220,
    L = 260,
    cols = Math.max(...rows.map((r) => r.cells.length), 1);
  const width = L + cols * (W + 6),
    height = rows.length * (H + 30);
  const layers: sharp.OverlayOptions[] = [];
  let svg = "";
  rows.forEach((r, y) => {
    const top = y * (H + 30);
    svg += `<text x="8" y="${top + 30}" font-size="20" font-family="sans-serif" font-weight="bold">${esc(r.label)}</text>`;
    r.cells.forEach((c, x) => {
      const left = L + x * (W + 6);
      if (c.img) layers.push({ input: c.img, left, top });
      svg += `<rect x="${left}" y="${top}" width="34" height="26" fill="#000"/><text x="${left + 5}" y="${top + 20}" font-size="18" font-family="sans-serif" fill="#fff">${c.n}</text>`;
      svg += `<text x="${left}" y="${top + H + 18}" font-size="13" font-family="sans-serif">${esc(c.note.slice(0, 30))}</text>`;
    });
  });
  layers.push({
    input: Buffer.from(
      `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${svg}</svg>`,
    ),
    left: 0,
    top: 0,
  });
  await sharp({ create: { width, height, channels: 3, background: "#ffffff" } })
    .composite(layers)
    .jpeg({ quality: 72 })
    .toFile(file);
}

async function main() {
  const out = process.env.OUT_DIR ?? "photo-scout";
  mkdirSync(join(out, "sheets"), { recursive: true });
  const maxPer = Math.max(1, Math.min(20, Number(process.env.MAX_PER_KEY) || 8));
  const only = (process.env.ONLY_KEYS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // sslmode in the URL would override `ssl` (pg 8) and verify the pooler's certificate, as every other DB script avoids.
  const dbUrl = new URL(process.env.DB_URL ?? "");
  dbUrl.searchParams.delete("sslmode");
  const db = new pg.Client({
    connectionString: dbUrl.toString(),
    ssl: { rejectUnauthorized: false },
  });
  await db.connect();
  await db.query("set statement_timeout = '20s'");
  await db.query("set default_transaction_read_only = on"); // this script only reads staging
  // Demo items without a photo of their own (single pass over the demo shops' menus).
  const { rows: items } = await db.query(`
    select i.name_en, i.name_ar, i.description, s.name_en as section_en, s.name_ar as section_ar,
           v.business_type::text as business_type
    from public.menu_items i
    join public.vendors v on v.id = i.vendor_id
    left join public.menu_sections s on s.id = i.section_id
    where app_private.vendor_is_demo(v.id)
      and not exists (select 1 from public.menu_item_photos p where p.item_id = i.id and p.source in ('merchant', 'merchant_site'))`);
  await db.end();
  console.log(`${items.length} demo items without a photo of their own`);

  const keys = new Map<string, number>();
  const shelf = new Map<string, number>();
  for (const it of items) {
    const k = dishOf(it);
    for (const c of photoChain(k)) keys.set(c, (keys.get(c) ?? 0) + 1);
    if (isShelf(it) && it.name_en)
      shelf.set(it.name_en.trim(), (shelf.get(it.name_en.trim()) ?? 0) + 1);
  }
  keys.delete("none");

  const dishes: Record<string, { items: number; candidates: Candidate[] }> = {};
  const packshots: Record<string, { items: number; candidates: Packshot[] }> = {};
  function save() {
    writeFileSync(join(out, "candidates.json"), JSON.stringify({ dishes, packshots }, null, 1));
  }
  const list = [...keys]
    .filter(([k]) => !only.length || only.includes(k))
    .sort((a, b) => b[1] - a[1]);
  for (const [key, n] of list) {
    const d = DISH.get(key);
    const found: Omit<Candidate, "n">[] = [];
    for (const q of d?.q ?? []) {
      if (process.env.PEXELS_API_KEY) {
        const p = await getJson(
          `https://api.pexels.com/v1/search?per_page=8&query=${encodeURIComponent(q)}`,
          { authorization: process.env.PEXELS_API_KEY },
        );
        found.push(...pexelsCandidates(p));
      }
      if (!openverseSpent) {
        const body = await getJson(
          `${OPENVERSE}?q=${encodeURIComponent(q)}&license=cc0,pdm,by&category=photograph&mature=false&page_size=20`,
        );
        found.push(...openverseCandidates(body));
        await sleep(4000); // Openverse's anonymous rate limit
      }
      if (found.length >= maxPer * 2) break;
    }
    const seen = new Set<string>();
    const cands = found
      .filter((c) => !seen.has(c.url) && seen.add(c.url))
      .slice(0, maxPer)
      .map((c, i) => ({ ...c, n: i + 1 }));
    dishes[key] = { items: n, candidates: cands };
    console.log(`${key}: ${n} items, ${cands.length} candidates`);
    save(); // a run that stops early still pushes what it found
  }

  for (const [name, n] of shelf) {
    const url = `${OFF_SEARCH}?search_terms=${encodeURIComponent(words(name).join(" "))}&search_simple=1&action=process&json=1&page_size=10&fields=code,product_name,brands,quantity,image_front_url`;
    const body = await getJson(url);
    await sleep(6500); // Open Food Facts allows 10 searches a minute
    const cands = (body?.products ?? [])
      .filter((p: any) => p.code && p.image_front_url && p.product_name)
      .map((p: any) => ({
        barcode: String(p.code),
        product_name: String(p.product_name),
        brands: p.brands ?? null,
        quantity: p.quantity ?? null,
        image_url: fullOffImage(String(p.image_front_url)),
        score: packshotScore(name, p),
        license: "CC BY-SA 3.0",
        license_url: "https://creativecommons.org/licenses/by-sa/3.0/",
        credit: "Open Food Facts contributors",
        source_url: `https://world.openfoodfacts.org/product/${encodeURIComponent(String(p.code))}`,
      }))
      .sort((a: Packshot, b: Packshot) => b.score - a.score)
      .slice(0, 4)
      .map((p: Omit<Packshot, "n">, i: number) => ({ ...p, n: i + 1 }));
    packshots[name] = { items: n, candidates: cands };
    console.log(`packshot ${name}: ${cands.map((c: Packshot) => c.score).join(", ")}`);
    save();
  }
  save();

  // Contact sheets: 6 dish keys per sheet, then 8 shelf items per sheet.
  const dishRows = Object.entries(dishes);
  for (let i = 0; i < dishRows.length; i += 6) {
    const rows = [];
    for (const [key, d] of dishRows.slice(i, i + 6))
      rows.push({
        label: `${key} (${d.items})`,
        cells: await Promise.all(
          d.candidates.map(async (c) => ({
            n: c.n,
            img: await thumb(c.url),
            note: `${c.license} ${c.provider.split(":")[1] ?? c.provider}`,
          })),
        ),
      });
    await sheet(rows, join(out, "sheets", `dish-${String(i / 6 + 1).padStart(2, "0")}.jpg`));
  }
  const packRows = Object.entries(packshots);
  for (let i = 0; i < packRows.length; i += 8) {
    const rows = [];
    for (const [name, p] of packRows.slice(i, i + 8))
      rows.push({
        label: name.slice(0, 28),
        cells: await Promise.all(
          p.candidates.map(async (c) => ({
            n: c.n,
            img: await thumb(c.image_url),
            note: `${c.score} ${c.product_name}`,
          })),
        ),
      });
    await sheet(rows, join(out, "sheets", `pack-${String(i / 8 + 1).padStart(2, "0")}.jpg`));
  }
  console.log(`sheets written to ${join(out, "sheets")}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
