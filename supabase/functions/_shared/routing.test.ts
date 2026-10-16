import { describe, expect, it, vi } from "vitest";
import {
  DOORSTEP_M,
  inLebanon,
  metresBetween,
  ORS_MAX_DESTS,
  orsProvider,
  restRouteCache,
  roadKm,
  roadRoutes,
  type LatLon,
  type Route,
  type RouteCache,
} from "./routing.ts";

const baakline: LatLon = { lat: 33.6821, lon: 35.5861 };
const beiteddine: LatLon = { lat: 33.695, lon: 35.58 };
const bakaata: LatLon = { lat: 33.6738, lon: 35.6175 };
const paris: LatLon = { lat: 48.85, lon: 2.35 };

// Shape of an ORS /v2/matrix response (sources [0], metrics distance + duration, units m).
const orsFixture = {
  distances: [[2104.37, 4811.9]],
  durations: [[301.2, 540.66]],
  sources: [{ location: [35.5861, 33.6821] }],
  destinations: [{ location: [35.58, 33.695] }, { location: [35.6175, 33.6738] }],
};

function memoryCache(
  seed: Map<string, Route> = new Map(),
): RouteCache & { store: ReturnType<typeof vi.fn> } {
  const key = (p: LatLon) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
  return {
    lookup: async (o, ds) => ds.map((d) => seed.get(`${key(o)}>${key(d)}`) ?? null),
    store: vi.fn(async (o: LatLon, ds: LatLon[], rs: (Route | null)[]) => {
      ds.forEach((d, i) => rs[i] && seed.set(`${key(o)}>${key(d)}`, rs[i]!));
    }),
  };
}

describe("orsProvider", () => {
  it("sends [lon, lat] locations with one source and parses the first row", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(orsFixture), { status: 200 }));
    const ors = orsProvider({ apiKey: "test-key", fetch: fetchMock as unknown as typeof fetch });
    const routes = await ors.matrix(baakline, [beiteddine, bakaata]);
    expect(routes).toEqual([
      { distanceM: 2104, durationS: 301, provider: "ors" },
      { distanceM: 4812, durationS: 541, provider: "ors" },
    ]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openrouteservice.org/v2/matrix/driving-car");
    expect((init.headers as Record<string, string>).authorization).toBe("test-key");
    const body = JSON.parse(init.body as string);
    expect(body.locations).toEqual([
      [35.5861, 33.6821],
      [35.58, 33.695],
      [35.6175, 33.6738],
    ]);
    expect(body.sources).toEqual([0]);
    expect(body.destinations).toEqual([1, 2]);
    expect(body.units).toBe("m");
  });

  it("maps unroutable cells to null", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ distances: [[null, 10]], durations: [[null, 2]] }), {
          status: 200,
        }),
    );
    const ors = orsProvider({ apiKey: "k", fetch: fetchMock as unknown as typeof fetch });
    expect(await ors.matrix(baakline, [beiteddine, bakaata])).toEqual([
      null,
      { distanceM: 10, durationS: 2, provider: "ors" },
    ]);
  });

  it("splits large requests into chunks of 49 destinations", async () => {
    const dests = Array.from({ length: 60 }, (_, i) => ({ lat: 33.6 + i / 1000, lon: 35.6 }));
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const n = JSON.parse(init.body as string).destinations.length;
      return new Response(
        JSON.stringify({ distances: [Array(n).fill(1000)], durations: [Array(n).fill(100)] }),
        { status: 200 },
      );
    });
    const ors = orsProvider({ apiKey: "k", fetch: fetchMock as unknown as typeof fetch });
    const routes = await ors.matrix(baakline, dests);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).destinations,
    ).toHaveLength(ORS_MAX_DESTS);
    expect(routes).toHaveLength(60);
  });

  it("throws on an HTTP error", async () => {
    const fetchMock = vi.fn(async () => new Response("quota", { status: 429 }));
    const ors = orsProvider({ apiKey: "k", fetch: fetchMock as unknown as typeof fetch });
    await expect(ors.matrix(baakline, [beiteddine])).rejects.toThrow("429");
  });
});

describe("roadRoutes", () => {
  it("serves cache hits without calling the provider", async () => {
    const cache = memoryCache(
      new Map([
        ["33.6821,35.5861>33.6950,35.5800", { distanceM: 2100, durationS: 300, provider: "ors" }],
      ]),
    );
    const provider = { name: "ors", matrix: vi.fn() };
    expect(await roadRoutes(baakline, [beiteddine], { cache, provider })).toEqual([
      { distanceM: 2100, durationS: 300, provider: "ors" },
    ]);
    expect(provider.matrix).not.toHaveBeenCalled();
  });

  it("asks the provider only for misses and stores what it returns", async () => {
    const cache = memoryCache(
      new Map([
        ["33.6821,35.5861>33.6950,35.5800", { distanceM: 2100, durationS: 300, provider: "ors" }],
      ]),
    );
    const provider = {
      name: "ors",
      matrix: vi.fn(async () => [{ distanceM: 4800, durationS: 540, provider: "ors" }]),
    };
    const routes = await roadRoutes(baakline, [beiteddine, bakaata], { cache, provider });
    expect(provider.matrix).toHaveBeenCalledWith(baakline, [bakaata]);
    expect(routes.map(roadKm)).toEqual([2.1, 4.8]);
    expect(cache.store).toHaveBeenCalledWith(
      baakline,
      [bakaata],
      [{ distanceM: 4800, durationS: 540, provider: "ors" }],
    );
  });

  it("never guesses a straight line when the provider is missing or failing", async () => {
    const log = vi.fn();
    expect(
      await roadRoutes(baakline, [beiteddine], { cache: memoryCache(), provider: null, log }),
    ).toEqual([null]);
    expect(log).toHaveBeenCalledWith(
      "routing_unavailable",
      expect.objectContaining({ reason: "no_provider" }),
    );
    const failing = { name: "ors", matrix: vi.fn(async () => Promise.reject(new Error("down"))) };
    expect(
      await roadRoutes(baakline, [beiteddine], { cache: memoryCache(), provider: failing, log }),
    ).toEqual([null]);
  });

  it("answers a pin at the origin's door itself (ORS gives no route between the same spot) and caches it", async () => {
    const origin = { lat: 33.6840346, lon: 35.5752423 };
    const near = { lat: 33.6841, lon: 35.5753 }; // about 9 m away
    const far = { lat: 33.69, lon: 35.58 };
    const stored: any[] = [];
    const matrix = vi.fn(async (_o: any, ds: any[]) =>
      ds.map(() => ({ distanceM: 1500, durationS: 240, provider: "ors" })),
    );
    const out = await roadRoutes(origin, [origin, near, far], {
      cache: {
        lookup: async (_o, ds) => ds.map(() => null),
        store: async (_o, ds, rs) => void stored.push([ds, rs]),
      },
      provider: { name: "ors", matrix },
    });
    expect(out[0]).toEqual({ distanceM: 0, durationS: 60, provider: "doorstep" });
    expect(out[1]?.provider).toBe("doorstep");
    expect(out[1]!.distanceM).toBeLessThanOrEqual(DOORSTEP_M);
    expect(out[2]?.provider).toBe("ors");
    // Only the far pin goes to the provider.
    expect(matrix).toHaveBeenCalledTimes(1);
    expect(matrix.mock.calls[0][1]).toEqual([far]);
    expect(stored[0][1].map((r: any) => r.provider)).toEqual(["doorstep", "doorstep"]);
    expect(metresBetween(origin, { lat: 33.6849346, lon: 35.5752423 })).toBeCloseTo(100, -1);
  });

  it("refuses points outside Lebanon without calling anyone", async () => {
    const provider = {
      name: "ors",
      matrix: vi.fn(async () => [{ distanceM: 1, durationS: 1, provider: "ors" }]),
    };
    expect(await roadRoutes(paris, [beiteddine], { cache: memoryCache(), provider })).toEqual([
      null,
    ]);
    expect(
      await roadRoutes(baakline, [paris, bakaata], { cache: memoryCache(), provider }),
    ).toEqual([null, { distanceM: 1, durationS: 1, provider: "ors" }]);
    expect(provider.matrix).toHaveBeenCalledTimes(1);
    expect(provider.matrix).toHaveBeenCalledWith(baakline, [bakaata]);
  });

  it("keeps routing when the cache is down", async () => {
    const cache: RouteCache = {
      lookup: async () => Promise.reject(new Error("db down")),
      store: async () => Promise.reject(new Error("db down")),
    };
    const provider = {
      name: "ors",
      matrix: vi.fn(async () => [{ distanceM: 2100, durationS: 300, provider: "ors" }]),
    };
    const log = vi.fn();
    expect(await roadRoutes(baakline, [beiteddine], { cache, provider, log })).toHaveLength(1);
    expect(log).toHaveBeenCalledWith("routing_cache_lookup_failed", expect.anything());
    expect(log).toHaveBeenCalledWith("routing_cache_store_failed", expect.anything());
  });
});

describe("restRouteCache", () => {
  it("calls the lookup RPC with lat/lon arrays and maps 1-based rows", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify([
            { idx: 1, distance_m: null, duration_s: null, provider: null },
            { idx: 2, distance_m: 4800, duration_s: 540, provider: "ors" },
          ]),
          { status: 200 },
        ),
    );
    const cache = restRouteCache({
      supabaseUrl: "https://example.supabase.co",
      serviceKey: "service",
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(await cache.lookup(baakline, [beiteddine, bakaata])).toEqual([
      null,
      { distanceM: 4800, durationS: 540, provider: "ors" },
    ]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://example.supabase.co/rest/v1/rpc/route_cache_lookup");
    expect(JSON.parse(init.body as string)).toEqual({
      p_origin_lat: 33.6821,
      p_origin_lon: 35.5861,
      p_dest_lats: [33.695, 33.6738],
      p_dest_lons: [35.58, 35.6175],
      p_profile: "driving-car",
    });
  });

  it("stores only found routes", async () => {
    const fetchMock = vi.fn(async () => new Response("1", { status: 200 }));
    const cache = restRouteCache({
      supabaseUrl: "https://x",
      serviceKey: "s",
      fetch: fetchMock as unknown as typeof fetch,
    });
    await cache.store(
      baakline,
      [beiteddine, bakaata],
      [null, { distanceM: 4800, durationS: 540, provider: "ors" }],
    );
    const body = JSON.parse(
      (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    );
    expect(body.p_dest_lats).toEqual([33.6738]);
    expect(body.p_distances_m).toEqual([4800]);
    await cache.store(baakline, [beiteddine], [null]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("inLebanon", () => {
  it("accepts Lebanese pins and rejects others", () => {
    expect(inLebanon(baakline)).toBe(true);
    expect(inLebanon({ lat: 34.4367, lon: 35.8497 })).toBe(true); // Tripoli
    expect(inLebanon(paris)).toBe(false);
    expect(inLebanon({ lat: Number.NaN, lon: 35.5 })).toBe(false);
  });
});
