// Images for the Alo King Flow app (DECISIONS §39.15.13). Meta takes Flow images as base64 inside the screen data, list
// images up to 100 KB, so they are made ahead from the photos already in Storage (bucket menu-item-photos: item photos,
// shop covers) and kept in app_private.flow_thumbs; the flow-app endpoint only reads them (flow_app_thumbs).
//   item, cover, category: 144×144 JPEG for list rows (a few KB each)
//   item_large: 600×600 JPEG for the item page, quality lowered until it is under 95 KB
// Only what changed is made again (the source path is kept). Run by the staging deploy after the demo photos.
// Env: DB_URL, SUPABASE_URL (https://<ref>.supabase.co), SUPABASE_SERVICE_KEY. Optional THUMB_LIMIT (default 4000).
import pg from "pg";
import sharp from "sharp";

const BUCKET = "menu-item-photos";
export const LIMIT_BYTES = 95_000;

/** A square JPEG of `size`, quality stepped down until it is under `max` bytes (null when it never is). */
export async function makeThumb(input: Buffer, size: number, max: number): Promise<Buffer | null> {
  for (const quality of [78, 70, 62, 54, 46, 38]) {
    const out = await sharp(input)
      .rotate()
      .resize(size, size, { fit: "cover", position: "attention" })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    if (out.length <= max) return out;
  }
  return null;
}

type Job = { kind: "item" | "item_large" | "cover" | "category"; ref: string; path: string };

/** The images to make: every source whose stored image was made from another path, or not made yet. */
export function plan(sources: any, limit: number): Job[] {
  const made: Record<string, string> = sources?.made ?? {};
  const jobs: Job[] = [];
  const want = (kind: Job["kind"], ref: string, path: string) => {
    if (made[`${kind}:${ref}`] !== path) jobs.push({ kind, ref, path });
  };
  for (const x of sources?.items ?? []) {
    want("item", String(x.ref), String(x.path));
    want("item_large", String(x.ref), String(x.path));
  }
  for (const x of sources?.covers ?? []) want("cover", String(x.ref), String(x.path));
  for (const x of sources?.categories ?? []) want("category", String(x.ref), String(x.path));
  return jobs.slice(0, limit);
}

async function main() {
  const { DB_URL, SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!DB_URL || !SUPABASE_URL || !SUPABASE_SERVICE_KEY)
    throw new Error("set DB_URL, SUPABASE_URL and SUPABASE_SERVICE_KEY");
  if (!/^https:\/\/[a-z]{20}\.supabase\.co$/.test(SUPABASE_URL))
    throw new Error("SUPABASE_URL is not a project URL");
  const url = new URL(DB_URL);
  url.searchParams.delete("sslmode");
  const db = new pg.Client({
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: false },
  });
  await db.connect();
  const headers = { authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, apikey: SUPABASE_SERVICE_KEY };
  try {
    // Images of photos that are gone (deleted on request, §38.1) go first.
    const pruned = (await db.query("select public.flow_thumb_prune() as n")).rows[0]?.n ?? 0;
    const sources = (await db.query("select public.flow_thumb_sources() as s")).rows[0]?.s;
    const jobs = plan(sources, Number(process.env.THUMB_LIMIT ?? 4000));
    const cache = new Map<string, Promise<Buffer | null>>();
    const fetchPhoto = (path: string) => {
      if (!cache.has(path))
        cache.set(
          path,
          fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
            headers,
            signal: AbortSignal.timeout(20_000),
          })
            .then(async (r) => (r.ok ? Buffer.from(await r.arrayBuffer()) : null))
            .catch(() => null),
        );
      return cache.get(path)!;
    };
    let made = 0;
    let failed = 0;
    let bytes = 0;
    const queue = [...jobs];
    await Promise.all(
      Array.from({ length: 6 }, async () => {
        for (let j = queue.shift(); j; j = queue.shift()) {
          const src = await fetchPhoto(j.path);
          const out = src
            ? await makeThumb(src, j.kind === "item_large" ? 600 : 144, LIMIT_BYTES).catch(
                () => null,
              )
            : null;
          if (!out) {
            failed++;
            continue;
          }
          await db.query("select public.flow_thumb_put($1, $2, $3, $4)", [
            j.kind,
            j.ref,
            out.toString("base64"),
            j.path,
          ]);
          made++;
          bytes += out.length;
        }
      }),
    );
    console.log(
      `Flow app images: ${pruned} removed, ${made} made (${Math.round(bytes / Math.max(made, 1) / 100) / 10} KB on average), ${failed} could not be read or made, ${jobs.length} were due`,
    );
  } finally {
    await db.end();
  }
}

if (process.argv[1]?.endsWith("thumbs.ts")) {
  main().catch((e) => {
    console.error(String(e).slice(0, 1000));
    process.exit(1);
  });
}
