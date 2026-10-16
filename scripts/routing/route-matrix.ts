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
 * The public OSRM table service for one block: shops are sources, places destinations, one GET per block (50
 * coordinates; the public server takes up to 100). Never used by the edge functions: scripts only, as area-data.
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
    const j = res.ok
      ? ((await res.json()) as {
          code?: string;
          distances?: (number | null)[][];
          durations?: (number | null)[][];
        })
      : null;
    if (!res.ok) await res.body?.cancel();
    if (j?.code !== "Ok")
      throw new Error(`osrm table returned ${res.status} ${j?.code ?? ""}`.trim());
    return origins.map((_, a) =>
      dests.map((_, b) => cell(j.distances?.[a]?.[b], j.durations?.[a]?.[b])),
    );
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

/** OpenRouteService said no for the day (quota spent, key refused, rate limited): stop asking it in this run. */
export function orsRefused(e: unknown): boolean {
  return /ors matrix returned (401|403|429)\b/.test(String(e));
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
    let orsOk = granted > 0;
    const saved = { ors: 0, osrm: 0 };
    let noRoad = 0;
    let failed = 0;
    for (const [k, block] of blocks.slice(0, ask).entries()) {
      let name = providerFor(k, granted, orsOk);
      try {
        let out: SavedRow[];
        try {
          out = await runBlock(providers[name], block, wanted);
        } catch (e) {
          if (name !== "ors" || !orsRefused(e)) throw e;
          // The quota is spent for the day: every later block, and this one, from OSRM.
          console.log(
            `- OpenRouteService refused request ${k + 1} (${String(e).slice(0, 80)}): the public OSRM server for the rest`,
          );
          orsOk = false;
          name = "osrm";
          await new Promise((r) => setTimeout(r, 1100));
          out = await runBlock(providers.osrm, block, wanted);
        }
        noRoad += out.filter((r) => r.road_km == null).length;
        const res = await db.query<{ n: number }>(
          "select public.shop_place_routes_save($1::jsonb, $2) as n",
          [JSON.stringify(out), name],
        );
        saved[name] += Number(res.rows[0]?.n ?? 0);
      } catch (e) {
        failed++;
        console.log(`- request ${k + 1} (${name}) failed: ${String(e).slice(0, 160)}`);
      }
      // ORS free plan: 40 matrix requests a minute; the public OSRM server: one request a second.
      if (k + 1 < ask) await new Promise((r) => setTimeout(r, name === "ors" ? 1600 : 1100));
    }
    console.log(
      `- pairs saved: ${saved.ors + saved.osrm} (OpenRouteService ${saved.ors}, OSRM ${saved.osrm}; no road found: ${noRoad})`,
    );
    if (ask < blocks.length)
      console.log(`- left for the next run: ${blocks.length - ask} request(s)`);
    if (failed > 0) {
      console.log(`- failed requests: ${failed}`);
      process.exitCode = 1;
    }
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
