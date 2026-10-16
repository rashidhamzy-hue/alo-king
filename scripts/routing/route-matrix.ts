// Shop → place road distances for alo-king-staging (DECISIONS §39.15.1). Browse screens and the checkout fallback read
// public.shop_place_routes; this fills it with OpenRouteService Matrix, 25 shops × 25 places per request (50 locations, the
// free plan's limit), and only for the pairs shop_place_routes_needed() returns: new shops and places, a shop whose pin
// moved, a place whose centre moved, or a pair with no road found more than a week ago. Every request is counted in
// routing_usage first (routing_matrix_take): the workflow only uses what is left below the checkout reserve.
// When OpenRouteService refuses (its daily quota is spent, 401/403/429), when the budget grants fewer requests than the
// run needs, or without a key, the rest goes to the public OSRM table service (fair use: one request a second, a named
// User-Agent), as area-data does, and is saved with provider 'osrm': the place distances never wait for midnight UTC.
// Env: DB_URL, ORS_API_KEY; optional SCOPE (active | all; default active), MAX_REQUESTS (default 60), ORS_BASE_URL and
// OSRM_BASE_URL (local stand-ins for tests; default the public services).
// Usage: node --experimental-strip-types scripts/routing/route-matrix.ts
import pg from "pg";
import {
  ORS_MANY_SIDE,
  orsProvider,
  type LatLon,
  type Route,
  type RouteProvider,
} from "../../supabase/functions/_shared/routing.ts";

export type Needed = {
  vendor_id: string;
  origin_lat: number;
  origin_lon: number;
  place_id: string;
  dest_lat: number;
  dest_lon: number;
};
export type Block = { shops: { id: string; at: LatLon }[]; places: { id: string; at: LatLon }[] };
export type SavedRow = {
  vendor_id: string;
  place_id: string;
  road_km: number | null;
  minutes: number | null;
  origin_lat: number;
  origin_lon: number;
  dest_lat: number;
  dest_lon: number;
};

/**
 * The requests that cover every needed pair: shops in groups of 25, and for each group the places any of its shops
 * needs, in groups of 25. A shop group's cells that were not asked for are not saved.
 */
export function planBlocks(needed: Needed[], side = ORS_MANY_SIDE): Block[] {
  const shops = new Map<string, LatLon>();
  const places = new Map<string, LatLon>();
  const wants = new Map<string, Set<string>>();
  for (const n of needed) {
    shops.set(n.vendor_id, { lat: n.origin_lat, lon: n.origin_lon });
    places.set(n.place_id, { lat: n.dest_lat, lon: n.dest_lon });
    wants.set(n.vendor_id, (wants.get(n.vendor_id) ?? new Set()).add(n.place_id));
  }
  const shopIds = [...shops.keys()].sort();
  const blocks: Block[] = [];
  for (let i = 0; i < shopIds.length; i += side) {
    const group = shopIds.slice(i, i + side);
    const placeIds = [...new Set(group.flatMap((v) => [...wants.get(v)!]))].sort();
    for (let j = 0; j < placeIds.length; j += side)
      blocks.push({
        shops: group.map((id) => ({ id, at: shops.get(id)! })),
        places: placeIds.slice(j, j + side).map((id) => ({ id, at: places.get(id)! })),
      });
  }
  return blocks;
}

type Fetch = typeof fetch;

/**
 * The public OSRM table service for one block: shops are sources, places destinations, one GET per block (at most 50
 * coordinates). The FOSSGIS demo server is for reasonable, non-commercial use with no uptime guarantee: a fallback for
 * the shop → place distances only, never the edge functions; production gets a second ORS key or ORS's paid plan.
 */
export function osrmProvider(
  opts: { fetch?: Fetch; baseUrl?: string; timeoutMs?: number } = {},
): RouteProvider {
  const doFetch = opts.fetch ?? fetch;
  const baseUrl = opts.baseUrl ?? "https://router.project-osrm.org";
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const cell = (d: unknown, t: unknown): Route | null =>
    typeof d === "number" && typeof t === "number" && d >= 0 && t >= 0
      ? { distanceM: Math.round(d), durationS: Math.round(t), provider: "osrm" }
      : null;
  const table = async (origins: LatLon[], dests: LatLon[]) => {
    const coords = [...origins, ...dests]
      .map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`)
      .join(";");
    const sources = origins.map((_, i) => i).join(";");
    const destinations = dests.map((_, i) => origins.length + i).join(";");
    const res = await doFetch(
      `${baseUrl}/table/v1/driving/${coords}?sources=${sources}&destinations=${destinations}&annotations=distance,duration`,
      {
        headers: {
          "user-agent": "alo-king route-matrix (https://github.com/rashidhamzy-hue/alo-king)",
        },
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    // OSRM answers its errors in JSON too ({code: "TooBig" | "NoSegment" | …, message}): keep the code for the log.
    const j = (await res.json().catch(() => null)) as {
      code?: string;
      message?: string;
      distances?: (number | null)[][];
      durations?: (number | null)[][];
    } | null;
    if (!res.ok || j?.code !== "Ok")
      throw new Error(
        `osrm table returned ${res.status} ${j?.code ?? ""} ${String(j?.message ?? "").slice(0, 80)}`.trim(),
      );
    // A malformed answer is a failed request, never rows of "no road" (those are not asked again for a week).
    const shaped = (m: unknown) =>
      Array.isArray(m) &&
      m.length === origins.length &&
      m.every((r) => Array.isArray(r) && r.length === dests.length);
    if (!shaped(j.distances) || !shaped(j.durations))
      throw new Error("osrm table returned a malformed matrix");
    return origins.map((_, a) => dests.map((_, b) => cell(j.distances![a][b], j.durations![a][b])));
  };
  return {
    name: "osrm",
    async matrix(origin, dests) {
      return (await table([origin], dests))[0];
    },
    async matrixMany(origins, dests) {
      return table(origins, dests);
    },
  };
}

/**
 * OpenRouteService said no: 403 (the day's quota is spent), 429 (its per-minute limit) or 401 (the key is refused).
 * Returns the status, so a refused key can still fail the run; null for anything else (a timeout, a 5xx).
 */
export function orsRefused(e: unknown): number | null {
  const m = /ors matrix returned (401|403|429)\b/.exec(String(e));
  return m ? Number(m[1]) : null;
}

/**
 * Which provider asks for block k: ORS while it has budget (the first `granted` blocks) and has not refused, else OSRM.
 */
export function providerFor(k: number, granted: number, orsOk: boolean): "ors" | "osrm" {
  return orsOk && k < granted ? "ors" : "osrm";
}

/** One block through the provider (one ORS request); only the asked-for pairs come back, no road as nulls. */
export async function runBlock(
  provider: RouteProvider,
  block: Block,
  wanted: Set<string>,
): Promise<SavedRow[]> {
  const cells = await provider.matrixMany!(
    block.shops.map((s) => s.at),
    block.places.map((p) => p.at),
  );
  const out: SavedRow[] = [];
  block.shops.forEach((s, a) =>
    block.places.forEach((p, b) => {
      if (!wanted.has(`${s.id}|${p.id}`)) return;
      const r = cells[a]?.[b] ?? null;
      out.push({
        vendor_id: s.id,
        place_id: p.id,
        road_km: r ? Math.round(r.distanceM) / 1000 : null,
        minutes: r ? Math.round(r.durationS / 6) / 10 : null,
        origin_lat: s.at.lat,
        origin_lon: s.at.lon,
        dest_lat: p.at.lat,
        dest_lon: p.at.lon,
      });
    }),
  );
  return out;
}

/** How a run went: rows saved per provider, failures, blocks left unsent, and ORS's refusal status if it refused. */
export type FillResult = {
  saved: { ors: number; osrm: number };
  noRoad: number;
  failed: number;
  notSent: number;
  orsRefusal: number | null;
};

/**
 * Asks for each block in turn: ORS while it has budget and has not refused, the public OSRM server for the rest. A
 * refused block is asked again from OSRM. OSRM refusing (429) or failing three times in a row stops the run: the rest
 * waits for the next one. `sleep` paces the requests (ORS: 40 a minute; OSRM: one a second).
 */
export async function fillBlocks(o: {
  blocks: Block[];
  wanted: Set<string>;
  granted: number;
  providers: Record<"ors" | "osrm", RouteProvider>;
  save: (rows: SavedRow[], provider: "ors" | "osrm") => Promise<number>;
  log: (line: string) => void;
  sleep?: (ms: number) => Promise<void>;
}): Promise<FillResult> {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const res: FillResult = {
    saved: { ors: 0, osrm: 0 },
    noRoad: 0,
    failed: 0,
    notSent: 0,
    orsRefusal: null,
  };
  let orsOk = o.granted > 0;
  let osrmFailsInARow = 0;
  for (const [k, block] of o.blocks.entries()) {
    let name = providerFor(k, o.granted, orsOk);
    try {
      let out: SavedRow[];
      try {
        out = await runBlock(o.providers[name], block, o.wanted);
      } catch (e) {
        const status = orsRefused(e);
        if (name !== "ors" || status === null) throw e;
        res.orsRefusal = status;
        orsOk = false;
        o.log(
          status === 401
            ? "::error::OpenRouteService refused the key (401, owner issue #76): the public OSRM server for the rest"
            : `::warning::OpenRouteService refused request ${k + 1} (${status === 429 ? "429, its per-minute limit" : "403, the day's quota"}): the public OSRM server for the rest`,
        );
        const unused = Math.max(o.granted - k - 1, 0);
        if (unused > 0)
          o.log(`- ${unused} granted OpenRouteService request(s) not used after the refusal`);
        name = "osrm";
        await sleep(1100);
        out = await runBlock(o.providers.osrm, block, o.wanted);
      }
      res.noRoad += out.filter((r) => r.road_km == null).length;
      res.saved[name] += await o.save(out, name);
      if (name === "osrm") osrmFailsInARow = 0;
    } catch (e) {
      res.failed++;
      o.log(`- request ${k + 1} (${name}) failed: ${String(e).slice(0, 160)}`);
      if (name === "osrm") {
        osrmFailsInARow++;
        if (/osrm table returned 429/.test(String(e)) || osrmFailsInARow >= 3) {
          res.notSent = o.blocks.length - k - 1;
          o.log("- the public OSRM server is refusing or down: the rest waits for the next run");
          break;
        }
      }
    }
    if (k + 1 < o.blocks.length) await sleep(name === "ors" ? 1600 : 1100);
  }
  return res;
}

async function main() {
  const { DB_URL, ORS_API_KEY } = process.env;
  const scope = process.env.SCOPE === "all" ? "all" : "active";
  const maxRequests = Number(process.env.MAX_REQUESTS ?? 60);
  if (!DB_URL) throw new Error("DB_URL is not set");
  const url = new URL(DB_URL);
  url.searchParams.delete("sslmode");
  const local = /^(localhost|127\.0\.0\.1)$/.test(url.hostname);
  const db = new pg.Client({
    connectionString: url.toString(),
    ssl: local ? false : { rejectUnauthorized: false },
  });
  await db.connect();
  await db.query("set statement_timeout = '30s'");
  try {
    const { rows: needed } = await db.query<Needed>(
      "select * from public.shop_place_routes_needed($1)",
      [scope],
    );
    const wanted = new Set(needed.map((n) => `${n.vendor_id}|${n.place_id}`));
    const blocks = planBlocks(needed);
    console.log(`### route-matrix (${scope})`);
    console.log("");
    console.log(
      `- pairs needed: ${needed.length} (${new Set(needed.map((n) => n.vendor_id)).size} shops × up to ${new Set(needed.map((n) => n.place_id)).size} places)`,
    );
    console.log(`- requests planned: ${blocks.length}`);
    if (blocks.length === 0) return;
    const ask = Math.min(blocks.length, maxRequests);
    let granted = 0;
    if (ORS_API_KEY) {
      const { rows } = await db.query<{ n: number }>("select public.routing_matrix_take($1) as n", [
        ask,
      ]);
      granted = Number(rows[0]?.n ?? 0);
      console.log(`- OpenRouteService requests granted by the daily budget: ${granted} of ${ask}`);
    } else {
      console.log("- ORS_API_KEY is not set (owner issue #76): the public OSRM server only");
    }
    const providers = {
      ors: orsProvider({
        apiKey: ORS_API_KEY ?? "",
        timeoutMs: 20_000,
        baseUrl: process.env.ORS_BASE_URL || undefined,
      }),
      osrm: osrmProvider({ baseUrl: process.env.OSRM_BASE_URL || undefined }),
    };
    const r = await fillBlocks({
      blocks: blocks.slice(0, ask),
      wanted,
      granted,
      providers,
      save: async (rows, provider) =>
        Number(
          (
            await db.query<{ n: number }>(
              "select public.shop_place_routes_save($1::jsonb, $2) as n",
              [JSON.stringify(rows), provider],
            )
          ).rows[0]?.n ?? 0,
        ),
      log: (line) => console.log(line),
    });
    console.log(
      `- pairs saved: ${r.saved.ors + r.saved.osrm} (OpenRouteService ${r.saved.ors}, OSRM ${r.saved.osrm}; no road found: ${r.noRoad})`,
    );
    const left = blocks.length - ask + r.notSent;
    if (left > 0) console.log(`- left for the next run: ${left} request(s)`);
    if (r.failed > 0) console.log(`- failed requests: ${r.failed}`);
    // A refused key is the one visible signal that checkout's live calls fail too: the run goes red for it.
    if (r.failed > 0 || r.orsRefusal === 401) process.exitCode = 1;
  } finally {
    await db.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(String(e));
    process.exit(1);
  });
}
