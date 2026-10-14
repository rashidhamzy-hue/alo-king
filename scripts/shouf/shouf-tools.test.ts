import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain ES module without types
import { landmarkKind, overpassQuery, pilotBox, toRows } from "./osm-fetch.mjs";
// @ts-expect-error plain ES module without types
import { originHash, sizedUrl, storagePath } from "./copy-photos.mjs";

describe("OSM fetch (§38.2 items 4–5)", () => {
  const box = pilotBox(
    readFileSync("supabase/seed/shouf/source/01_shouf_merchants_315.csv", "utf8"),
  );

  it("boxes the pilot merchants with a margin, inside the Shouf", () => {
    const [s, w, n, e] = box;
    expect(s).toBeGreaterThan(33.5);
    expect(n).toBeLessThan(33.85);
    expect(w).toBeGreaterThan(35.4);
    expect(e).toBeLessThan(35.8);
    expect(overpassQuery(box)).toContain(`(${box.join(",")})`);
  });

  it("widens the box by the delivery radius for the §39.2 delivery area", () => {
    const csv = readFileSync("supabase/seed/shouf/source/01_shouf_merchants_315.csv", "utf8");
    const [s2, w2, n2, e2] = pilotBox(csv, 2);
    const [s10, w10, n10, e10] = pilotBox(csv, 10);
    // 8 km more on each side: about 0.072° of latitude and 0.086° of longitude at 33.7° N.
    expect(s2 - s10).toBeCloseTo(8 / 111.32, 3);
    expect(n10 - n2).toBeCloseTo(8 / 111.32, 3);
    expect(w2 - w10).toBeGreaterThan(0.08);
    expect(e10 - e2).toBeLessThan(0.09);
  });

  it("maps OSM tags to the §38.2 landmark kinds", () => {
    expect(landmarkKind({ amenity: "place_of_worship", religion: "muslim" })).toBe("mosque");
    expect(landmarkKind({ amenity: "place_of_worship", religion: "christian" })).toBe("church");
    expect(landmarkKind({ amenity: "pharmacy" })).toBe("pharmacy");
    expect(landmarkKind({ junction: "roundabout" })).toBe("roundabout");
    expect(landmarkKind({ place: "square" })).toBe("square");
    expect(landmarkKind({ amenity: "fountain" })).toBe("fountain");
    expect(landmarkKind({ amenity: "hospital" })).toBe("hospital");
    expect(landmarkKind({ amenity: "school" })).toBe("school");
    expect(landmarkKind({ amenity: "townhall" })).toBe("municipality");
    expect(landmarkKind({ amenity: "restaurant" })).toBeNull();
  });

  it("keeps named landmarks and every place name, alt_name, loc_name and old_name", () => {
    const { landmarks, aliases } = toRows([
      {
        type: "node",
        id: 1,
        lat: 33.68,
        lon: 35.56,
        tags: { amenity: "pharmacy", name: "صيدلية النور", alt_name: "Nour Pharmacy" },
      },
      { type: "node", id: 2, lat: 33.68, lon: 35.56, tags: { amenity: "pharmacy" } },
      {
        type: "node",
        id: 3,
        lat: 33.68,
        lon: 35.56,
        tags: {
          place: "village",
          name: "بعقلين",
          "name:en": "Baakline",
          alt_name: "Baakleen;Ba3klin",
          old_name: "Baaqlin",
        },
      },
    ]);
    expect(landmarks).toEqual([
      ["node/1", "pharmacy", "صيدلية النور", "", '{"Nour Pharmacy"}', 33.68, 35.56],
    ]);
    expect(aliases.map((a: unknown[]) => [a[1], a[3]])).toEqual([
      ["Ba3klin", "alt_name"],
      ["Baakleen", "alt_name"],
      ["Baakline", "name"],
      ["Baaqlin", "old_name"],
      ["بعقلين", "name"],
    ]);
  });
});

describe("seed photo copy (§38.1)", () => {
  it("resizes a Google image URL and never keeps the URL, only its hash", () => {
    expect(sizedUrl("https://lh3.googleusercontent.com/gps-cs-s/ABC=w1920-h1080-k-no", 800)).toBe(
      "https://lh3.googleusercontent.com/gps-cs-s/ABC=w800-h800-k-no",
    );
    expect(originHash("x")).toMatch(/^[0-9a-f]{64}$/);
    const path = storagePath("2d5f3d1e-1111-4222-8333-444455556666", originHash("x"), "image/jpeg");
    expect(path).toMatch(/^seed\/[0-9a-f-]{36}\/[0-9a-f]{32}\.jpg$/);
    expect(path).not.toContain("google");
  });
});

describe("delivery area data (§39.2)", async () => {
  // @ts-expect-error plain ES module without types
  const area = await import("./area.mjs");
  const placesCsv = readFileSync("supabase/seed/places/places.csv", "utf8");
  const boundaryCsv = readFileSync("supabase/seed/places/shouf_delivery_boundary.csv", "utf8");

  it("parses quoted CSV cells with commas, quotes and newlines", () => {
    expect(area.parseCsv('a,b\n"x, ""y""","line1\nline2"\n')).toEqual([
      { a: 'x, "y"', b: "line1\nline2" },
    ]);
  });

  it("finds every boundary place in the places list, all in the Chouf", () => {
    const pts = area.boundaryPlaces(placesCsv, boundaryCsv);
    expect(pts).toHaveLength(61);
    for (const p of pts) {
      expect(p.id).toMatch(/^LB-CHF-/);
      expect(p.lat).toBeGreaterThan(33.5);
      expect(p.lon).toBeGreaterThan(35.4);
    }
  });

  it("boxes the boundary for the OSM fetch, short of Damour and the coast", () => {
    const [s, w, n, e] = area.boundaryBox(placesCsv, boundaryCsv, 3);
    const damour = area.parseCsv(placesCsv).find((p: { id: string }) => p.id === "LB-CHF-DAMOUR");
    expect(Number(damour.lon)).toBeLessThan(w);
    expect(s).toBeLessThan(n);
    expect(w).toBeLessThan(e);
    expect(overpassQuery([s, w, n, e])).toContain(`(${[s, w, n, e].join(",")})`);
  });

  it("asks ORS from the nearest merchants to the place and keeps the shortest road", () => {
    const merchants = area.merchantPoints(
      readFileSync("supabase/seed/shouf/source/01_shouf_merchants_315.csv", "utf8"),
    );
    expect(merchants.length).toBeGreaterThan(300);
    const niha = area
      .boundaryPlaces(placesCsv, boundaryCsv)
      .find((p: { id: string }) => p.id === "LB-CHF-NIHA");
    const near = area.nearestMerchants(niha, merchants, 3);
    expect(near).toHaveLength(3);
    expect(near[0].km).toBeLessThanOrEqual(near[2].km);
    const body = area.matrixBody(niha, near);
    expect(body.locations).toHaveLength(4);
    expect(body.locations[3]).toEqual([niha.lon, niha.lat]);
    expect(body.sources).toEqual([0, 1, 2]);
    expect(body.destinations).toEqual([3]);
    expect(area.nearestByRoad(near, [[9400], [null], [8123]])).toEqual({
      nearest: near[2].id,
      roadKm: 8.12,
    });
    expect(area.nearestByRoad(near, [[null], [null], [null]])).toBeNull();
    // The OSRM fallback asks the same question: merchants as sources, the place as the one destination.
    const url = new URL(area.osrmTableUrl(niha, near));
    expect(url.hostname).toBe("router.project-osrm.org");
    expect(url.pathname.split(";")).toHaveLength(4);
    expect(url.pathname.endsWith(`${niha.lon.toFixed(6)},${niha.lat.toFixed(6)}`)).toBe(true);
    expect(url.searchParams.get("sources")).toBe("0;1;2");
    expect(url.searchParams.get("destinations")).toBe("3");
    expect(url.searchParams.get("annotations")).toBe("distance");
  });

  it("keeps the road rows already committed, so a second run only asks for the missing places", () => {
    const kept = area.existingRoads(
      readFileSync("supabase/seed/places/shouf_delivery_road_km.csv", "utf8"),
    );
    expect(kept.size).toBeGreaterThan(40);
    for (const r of kept.values()) {
      expect(Number(r.road_km)).toBeGreaterThan(0);
      expect(["ors", "osrm"]).toContain(r.provider);
    }
  });
});
