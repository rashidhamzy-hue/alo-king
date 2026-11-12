import { describe, expect, it } from "vitest";
import seed from "../../../supabase/seed/villages.sql?raw";
// @ts-expect-error plain JS module shared with the Node scripts
import { parseCoordsSql, travelTimesSql, villageNamesFromSeed } from "../../../scripts/geo_lib.mjs";

describe("geography scripts", () => {
  it("reads all 42 villages from the seed, hubs first", () => {
    const names: string[] = villageNamesFromSeed(seed);
    expect(names).toHaveLength(42);
    expect(names.slice(0, 2)).toEqual(["Baakline", "Baqaata"]);
    expect(new Set(names).size).toBe(42);
  });
  it("turns reviewed coordinates and an OSRM table into an upsert that spares observed times", () => {
    const v = parseCoordsSql("update villages set lat = 33.68000, lng = 35.56000 where name_en = 'Baakline'; -- x\nupdate villages set lat = 33.67000, lng = 35.60000 where name_en = 'Baqaata';\n-- NOT FOUND: Dmit");
    expect(v).toEqual([{ name: "Baakline", lat: 33.68, lng: 35.56 }, { name: "Baqaata", lat: 33.67, lng: 35.6 }]);
    const sql: string = travelTimesSql(v, [[0, 540], [600, 0]], [[0, 5200], [5400, 0]], 1.1);
    expect(sql).toContain("where name_en = 'Baakline'), (select id from villages where name_en = 'Baqaata'), 9.9, 5.2, 'osrm', 0)");
    expect(sql).toContain("where travel_times.source <> 'observed'");
    expect(sql.match(/'osrm', 0\)/g)).toHaveLength(2);
  });
});
