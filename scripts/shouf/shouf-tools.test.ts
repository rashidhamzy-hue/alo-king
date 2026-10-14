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
