// Road routing (DECISIONS §3, §28.6): road distance and duration from OpenRouteService, pin to pin,
// cached in Postgres for 1-24 h (route_cache_lookup / route_cache_store). Fee bands and the delivery
// limit use these road kilometres through the delivery_quote RPC; there is never a straight-line
// fallback. A destination with no route (provider down, no key, unroutable) comes back as null, and the
// caller treats it as "cannot quote". The one exception is the doorstep: a pin within DOORSTEP_M of the
// origin (a customer at the shop's own door) is that short distance, because OpenRouteService gives no
// route between two points that snap to the same spot.

export type LatLon = { lat: number; lon: number };
export type Route = { distanceM: number; durationS: number; provider: string };

export interface RouteProvider {
  readonly name: string;
  /** One origin to many destinations, in order; null where the provider found no route. */
  matrix(origin: LatLon, dests: LatLon[]): Promise<(Route | null)[]>;
}

export interface RouteCache {
  lookup(origin: LatLon, dests: LatLon[]): Promise<(Route | null)[]>;
  store(origin: LatLon, dests: LatLon[], routes: (Route | null)[]): Promise<void>;
}

type Fetch = typeof fetch;
type Log = (msg: string, fields?: Record<string, unknown>) => void;

// Lebanon with a margin. Points outside are refused before any paid or rate-limited call.
const BOUNDS = { minLat: 32.9, maxLat: 34.8, minLon: 34.9, maxLon: 36.8 };

export function inLebanon(p: LatLon): boolean {
  return (
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lon) &&
    p.lat >= BOUNDS.minLat &&
    p.lat <= BOUNDS.maxLat &&
    p.lon >= BOUNDS.minLon &&
    p.lon <= BOUNDS.maxLon
  );
}

// A pin this close to the origin is at its door: no road trip to ask anyone about.
export const DOORSTEP_M = 50;

/** Metres between two points on the sphere (haversine). */
export function metresBetween(a: LatLon, b: LatLon): number {
  const r = 6_371_000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ORS matrix: at most 50 locations per request on the standard plan, so 49 destinations per call.
export const ORS_MAX_DESTS = 49;

export function orsProvider(opts: {
  apiKey: string;
  fetch?: Fetch;
  baseUrl?: string;
  timeoutMs?: number;
  profile?: string;
}): RouteProvider {
  const doFetch = opts.fetch ?? fetch;
  const baseUrl = opts.baseUrl ?? "https://api.openrouteservice.org";
  const profile = opts.profile ?? "driving-car";
  const timeoutMs = opts.timeoutMs ?? 4000;
  return {
    name: "ors",
    async matrix(origin, dests) {
      const out: (Route | null)[] = [];
      for (let i = 0; i < dests.length; i += ORS_MAX_DESTS) {
        const chunk = dests.slice(i, i + ORS_MAX_DESTS);
        const res = await doFetch(`${baseUrl}/v2/matrix/${profile}`, {
          method: "POST",
          headers: {
            authorization: opts.apiKey,
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({
            // ORS takes [longitude, latitude].
            locations: [origin, ...chunk].map((p) => [p.lon, p.lat]),
            sources: [0],
            destinations: chunk.map((_, j) => j + 1),
            metrics: ["distance", "duration"],
            units: "m",
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) {
          await res.body?.cancel();
          throw new Error(`ors matrix returned ${res.status}`);
        }
        const body = (await res.json()) as {
          distances?: (number | null)[][];
          durations?: (number | null)[][];
        };
        const distances = body.distances?.[0] ?? [];
        const durations = body.durations?.[0] ?? [];
        chunk.forEach((_, j) => {
          const d = distances[j];
          const t = durations[j];
          out.push(
            typeof d === "number" && typeof t === "number" && d >= 0 && t >= 0
              ? { distanceM: Math.round(d), durationS: Math.round(t), provider: "ors" }
              : null,
          );
        });
      }
      return out;
    },
  };
}

// The Postgres cache through PostgREST RPCs (service role only).
export function restRouteCache(opts: {
  supabaseUrl: string;
  serviceKey: string;
  fetch?: Fetch;
  profile?: string;
}): RouteCache {
  const doFetch = opts.fetch ?? fetch;
  const profile = opts.profile ?? "driving-car";
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const res = await doFetch(`${opts.supabaseUrl}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        apikey: opts.serviceKey,
        authorization: `Bearer ${opts.serviceKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(args),
    });
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(`${name} returned ${res.status}`);
    }
    return res.json();
  };
  return {
    async lookup(origin, dests) {
      const rows = (await rpc("route_cache_lookup", {
        p_origin_lat: origin.lat,
        p_origin_lon: origin.lon,
        p_dest_lats: dests.map((d) => d.lat),
        p_dest_lons: dests.map((d) => d.lon),
        p_profile: profile,
      })) as {
        idx: number;
        distance_m: number | null;
        duration_s: number | null;
        provider: string | null;
      }[];
      const out: (Route | null)[] = dests.map(() => null);
      for (const r of rows) {
        if (r.distance_m != null && r.duration_s != null && r.idx >= 1 && r.idx <= dests.length) {
          out[r.idx - 1] = {
            distanceM: r.distance_m,
            durationS: r.duration_s,
            provider: r.provider ?? "cache",
          };
        }
      }
      return out;
    },
    async store(origin, dests, routes) {
      const keep = dests.map((d, i) => ({ d, r: routes[i] })).filter((x) => x.r != null);
      if (keep.length === 0) return;
      await rpc("route_cache_store", {
        p_origin_lat: origin.lat,
        p_origin_lon: origin.lon,
        p_dest_lats: keep.map((x) => x.d.lat),
        p_dest_lons: keep.map((x) => x.d.lon),
        p_distances_m: keep.map((x) => x.r!.distanceM),
        p_durations_s: keep.map((x) => x.r!.durationS),
        p_provider: keep[0].r!.provider,
        p_profile: profile,
      });
    },
  };
}

/**
 * Road routes from one origin to many destinations: cache first, the provider for the misses, then the
 * new routes back into the cache. A cache failure is logged and routing continues; a provider failure
 * or a missing provider leaves the misses null (never a straight-line guess).
 */
export async function roadRoutes(
  origin: LatLon,
  dests: LatLon[],
  deps: { cache: RouteCache; provider?: RouteProvider | null; log?: Log },
): Promise<(Route | null)[]> {
  const log = deps.log ?? (() => {});
  if (dests.length === 0) return [];
  if (!inLebanon(origin)) {
    log("routing_origin_outside_lebanon");
    return dests.map(() => null);
  }
  const valid = dests.map(inLebanon);

  let cached: (Route | null)[] = dests.map(() => null);
  try {
    cached = await deps.cache.lookup(origin, dests);
  } catch (e) {
    log("routing_cache_lookup_failed", { error: String(e) });
  }

  const result = dests.map((_, i) => (valid[i] ? cached[i] : null));
  // Doorstep pins are answered here and cached like any route.
  const door = dests
    .map((_, i) => i)
    .filter((i) => valid[i] && result[i] == null && metresBetween(origin, dests[i]) <= DOORSTEP_M);
  if (door.length) {
    for (const i of door)
      result[i] = {
        distanceM: Math.round(metresBetween(origin, dests[i])),
        durationS: 60,
        provider: "doorstep",
      };
    try {
      await deps.cache.store(
        origin,
        door.map((i) => dests[i]),
        door.map((i) => result[i]),
      );
    } catch (e) {
      log("routing_cache_store_failed", { error: String(e) });
    }
  }
  const missIdx = dests.map((_, i) => i).filter((i) => valid[i] && result[i] == null);
  if (missIdx.length === 0) return result;

  if (!deps.provider) {
    log("routing_unavailable", { reason: "no_provider", misses: missIdx.length });
    return result;
  }

  let fresh: (Route | null)[];
  try {
    fresh = await deps.provider.matrix(
      origin,
      missIdx.map((i) => dests[i]),
    );
  } catch (e) {
    log("routing_unavailable", {
      reason: "provider_error",
      error: String(e),
      misses: missIdx.length,
    });
    return result;
  }
  missIdx.forEach((i, j) => {
    result[i] = fresh[j] ?? null;
  });

  try {
    await deps.cache.store(
      origin,
      missIdx.map((i) => dests[i]),
      fresh,
    );
  } catch (e) {
    log("routing_cache_store_failed", { error: String(e) });
  }
  return result;
}

/** Road kilometres for the delivery_quote RPC (3 decimals), or null when there is no route. */
export function roadKm(route: Route | null): number | null {
  return route ? Math.round(route.distanceM) / 1000 : null;
}
