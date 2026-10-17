import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
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
  chooseLiveProvider,
  fixtureProvider,
  guardedProvider,
  restFixtureLookup,
  ORS_MANY_SIDE,
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

  it("matrixMany: shops × places in blocks of 25 × 25 locations, reading every cell", async () => {
    const calls: { sources: number[]; destinations: number[] }[] = [];
    const fetchMock = vi.fn(async (_u: string, init: RequestInit) => {
      const b = JSON.parse(init.body as string);
      calls.push({ sources: b.sources, destinations: b.destinations });
      const dist = b.sources.map((s: number) =>
        b.destinations.map((d: number) => (s + 1) * 1000 + d),
      );
      return new Response(JSON.stringify({ distances: dist, durations: dist }), { status: 200 });
    });
    const ors = orsProvider({ apiKey: "k", fetch: fetchMock as unknown as typeof fetch });
    const shops = Array.from({ length: 30 }, (_, i) => ({ lat: 33.6 + i / 1000, lon: 35.5 }));
    const places = Array.from({ length: 3 }, (_, i) => ({ lat: 33.7, lon: 35.6 + i / 1000 }));
    const out = await ors.matrixMany!(shops, places);
    // 30 shops in two blocks (25 + 5), 3 places in one: two requests, every location count ≤ 50.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(calls.every((c) => c.sources.length + c.destinations.length <= 2 * ORS_MANY_SIDE)).toBe(
      true,
    );
    expect(out).toHaveLength(30);
    expect(out[0]).toHaveLength(3);
    // Block 2's first shop is source 0 of its request; its first place is destination 5 there.
    expect(out[25][0]?.distanceM).toBe(1005);
    expect(out[24][2]?.distanceM).toBe(25 * 1000 + 27);
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

describe("guardedProvider (the daily ORS budget, DECISIONS §39.15.1)", () => {
  it("asks the server before each request and never calls ORS when refused", async () => {
    const inner = {
      name: "ors",
      matrix: vi.fn(async () => [{ distanceM: 1, durationS: 1, provider: "ors" }]),
    };
    const refused = guardedProvider(inner, async () => false);
    await expect(refused.matrix(baakline, [beiteddine])).rejects.toThrow("refused");
    expect(inner.matrix).not.toHaveBeenCalled();
    const take = vi.fn(async () => true);
    const allowed = guardedProvider(inner, take);
    expect(await allowed.matrix(baakline, [beiteddine])).toHaveLength(1);
    expect(take).toHaveBeenCalledWith(baakline, beiteddine);
  });

  it("a refusal leaves the route unknown in roadRoutes: never a guess, the quote keeps the place distance", async () => {
    const log = vi.fn();
    const inner = { name: "ors", matrix: vi.fn() };
    const out = await roadRoutes(baakline, [bakaata], {
      cache: memoryCache(),
      provider: guardedProvider(inner, async () => false),
      log,
    });
    expect(out).toEqual([null]);
    expect(inner.matrix).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      "routing_unavailable",
      expect.objectContaining({ reason: "provider_error" }),
    );
  });
});

describe("chooseLiveProvider (DECISIONS §39.15.1: tests never call ORS)", () => {
  const ors = {
    name: "ors",
    matrix: vi.fn(async () => [{ distanceM: 9, durationS: 9, provider: "ors" }]),
  };
  const fixtures = { name: "fixture", matrix: vi.fn(async () => [null]) };
  it("a simulator number reads the recorded routes: never ORS, never the budget", async () => {
    const take = vi.fn(async () => true);
    const p = chooseLiveProvider({ isSim: true, simMode: "fixture", ors, fixtures, take });
    expect(p).toBe(fixtures);
    await p!.matrix(baakline, [beiteddine]);
    expect(take).not.toHaveBeenCalled();
    expect(ors.matrix).not.toHaveBeenCalled();
  });
  it("a real phone reaches ORS only through the budget guard", async () => {
    const take = vi.fn(async () => false);
    const p = chooseLiveProvider({ isSim: false, simMode: "fixture", ors, fixtures, take });
    await expect(p!.matrix(baakline, [beiteddine])).rejects.toThrow("refused");
    expect(take).toHaveBeenCalledTimes(1);
    expect(ors.matrix).not.toHaveBeenCalled();
  });
  it("without an ORS key there is no live call at all (the place distance stands)", () => {
    expect(
      chooseLiveProvider({
        isSim: false,
        simMode: "fixture",
        ors: null,
        fixtures,
        take: async () => true,
      }),
    ).toBeNull();
  });
  it("with the simulator mode switched off, a simulator number is treated like any phone", () => {
    const p = chooseLiveProvider({
      isSim: true,
      simMode: "ors",
      ors,
      fixtures,
      take: async () => true,
    });
    expect(p).not.toBe(fixtures);
  });
});

describe("fixtureProvider (simulator numbers never reach ORS)", () => {
  it("reads routing_fixture_lookup and maps 1-based rows; a pair never recorded is unknown", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify([
            { idx: 1, distance_m: 2100, duration_s: 300 },
            { idx: 2, distance_m: null, duration_s: null },
          ]),
          { status: 200 },
        ),
    );
    const p = fixtureProvider(
      restFixtureLookup({
        supabaseUrl: "https://x.supabase.co",
        serviceKey: "s",
        fetch: fetchMock as unknown as typeof fetch,
      }),
    );
    expect(await p.matrix(baakline, [beiteddine, bakaata])).toEqual([
      { distanceM: 2100, durationS: 300, provider: "fixture" },
      null,
    ]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://x.supabase.co/rest/v1/rpc/routing_fixture_lookup");
    expect(JSON.parse(init.body as string)).toEqual({
      p_origin_lat: baakline.lat,
      p_origin_lon: baakline.lon,
      p_dest_lats: [beiteddine.lat, bakaata.lat],
      p_dest_lons: [beiteddine.lon, bakaata.lon],
    });
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

describe("the doorstep in SQL", () => {
  it("browse's resolver (app_private.shop_road_km) uses the same distance as DOORSTEP_M", () => {
    const dir = resolve(__dirname, "../../migrations");
    const newest = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .filter((f) =>
        /function app_private\.shop_road_km\b/i.test(readFileSync(join(dir, f), "utf8")),
      )
      .pop();
    expect(newest).toBeDefined();
    expect(readFileSync(join(dir, newest!), "utf8")).toContain(
      `st_dwithin(v_loc, v_pin, ${DOORSTEP_M})`,
    );
  });
});
