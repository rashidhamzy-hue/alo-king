import { describe, expect, it, vi } from "vitest";
import { planBlocks, runBlock, type Needed } from "./route-matrix";

const pair = (v: number, p: number): Needed => ({
  vendor_id: `v${String(v).padStart(3, "0")}`,
  origin_lat: 33.6 + v / 1000,
  origin_lon: 35.5,
  place_id: `p${String(p).padStart(3, "0")}`,
  dest_lat: 33.7,
  dest_lon: 35.6 + p / 1000,
});

describe("route-matrix (DECISIONS §39.15.1)", () => {
  it("31 shops × 61 places is a handful of 25 × 25 requests, never one per shop", () => {
    const needed = Array.from({ length: 31 }, (_, v) =>
      Array.from({ length: 61 }, (_, p) => pair(v, p)),
    ).flat();
    const blocks = planBlocks(needed);
    expect(blocks).toHaveLength(6); // 2 shop groups × 3 place groups
    expect(blocks.every((b) => b.shops.length + b.places.length <= 50)).toBe(true);
    const covered = new Set(
      blocks.flatMap((b) => b.shops.flatMap((s) => b.places.map((p) => `${s.id}|${p.id}`))),
    );
    expect(needed.every((n) => covered.has(`${n.vendor_id}|${n.place_id}`))).toBe(true);
  });

  it("a newly claimed shop costs one request per 25 places", () => {
    expect(planBlocks(Array.from({ length: 61 }, (_, p) => pair(1, p)))).toHaveLength(3);
    expect(planBlocks([])).toEqual([]);
  });

  it("saves only the pairs asked for, and no road as null (never a guess)", async () => {
    const needed = [pair(1, 1), pair(2, 2)];
    const [block] = planBlocks(needed);
    const provider = {
      name: "ors",
      matrix: vi.fn(),
      matrixMany: vi.fn(async () => [
        [
          { distanceM: 4210, durationS: 570, provider: "ors" },
          { distanceM: 1, durationS: 1, provider: "ors" },
        ],
        [{ distanceM: 1, durationS: 1, provider: "ors" }, null],
      ]),
    };
    const rows = await runBlock(
      provider,
      block,
      new Set(needed.map((n) => `${n.vendor_id}|${n.place_id}`)),
    );
    expect(provider.matrixMany).toHaveBeenCalledTimes(1);
    expect(rows).toEqual([
      expect.objectContaining({ vendor_id: "v001", place_id: "p001", road_km: 4.21, minutes: 9.5 }),
      expect.objectContaining({
        vendor_id: "v002",
        place_id: "p002",
        road_km: null,
        minutes: null,
      }),
    ]);
  });
});
