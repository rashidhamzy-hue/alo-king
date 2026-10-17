import { describe, expect, it } from "vitest";
import { ZONE } from "@/design/chouf-map.generated";
import { AREA_HUBS, zoneAreas } from "./zone-areas";

describe("zoneAreas (DECISIONS §39.15.5: every boundary place, grouped by area)", () => {
  const areas = zoneAreas(ZONE);

  it("lists all 61 boundary places exactly once", () => {
    const slugs = areas.flatMap((a) => a.places.map((p) => p.slug));
    expect(ZONE.length).toBe(61);
    expect(slugs.length).toBe(ZONE.length);
    expect(new Set(slugs).size).toBe(ZONE.length);
  });

  it("names every area after a hub that is in the zone, in the decided order, each in its own area", () => {
    expect(areas.map((a) => a.hub.slug)).toEqual([...AREA_HUBS]);
    for (const a of areas) expect(a.places.map((p) => p.slug)).toContain(a.hub.slug);
  });

  it("keeps known neighbours together", () => {
    const areaOf = (slug: string) =>
      areas.find((a) => a.places.some((p) => p.slug === slug))?.hub.slug;
    expect(areaOf("chf-beiteddine")).toBe("chf-deir-al-qamar");
    expect(areaOf("chf-fraidis")).toBe("chf-barouk");
    expect(areaOf("chf-bater")).toBe("chf-niha");
  });

  it("does not depend on any place being live", () => {
    expect(zoneAreas([])).toEqual([]);
  });
});
