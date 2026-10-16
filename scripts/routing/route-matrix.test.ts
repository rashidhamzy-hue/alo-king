import { describe, expect, it, vi } from "vitest";
import {
  fillBlocks,
  orsRefused,
  osrmProvider,
  planBlocks,
  providerFor,
  runBlock,
  type Needed,
} from "./route-matrix";

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

  it("OSRM fallback: one table request per block, shops as sources and places as destinations", async () => {
    const needed = [pair(1, 1), pair(2, 2)];
    const [block] = planBlocks(needed);
    const asked: string[] = [];
    const fetchStub = vi.fn(async (url: string, init?: RequestInit) => {
      asked.push(url);
      expect((init?.headers as Record<string, string>)["user-agent"]).toMatch(/alo-king/);
      return new Response(
        JSON.stringify({
          code: "Ok",
          distances: [
            [4210, 1],
            [1, null],
          ],
          durations: [
            [570, 1],
            [1, null],
          ],
        }),
        { status: 200 },
      );
    });
    const osrm = osrmProvider({
      fetch: fetchStub as unknown as typeof fetch,
      baseUrl: "http://osrm.test",
    });
    const rows = await runBlock(
      osrm,
      block,
      new Set(needed.map((n) => `${n.vendor_id}|${n.place_id}`)),
    );
    expect(asked).toHaveLength(1);
    const url = new URL(asked[0]);
    expect(url.pathname.startsWith("/table/v1/driving/")).toBe(true);
    expect(url.pathname.split(";")).toHaveLength(4);
    expect(url.searchParams.get("sources")).toBe("0;1");
    expect(url.searchParams.get("destinations")).toBe("2;3");
    expect(url.searchParams.get("annotations")).toBe("distance,duration");
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

  it("an OSRM error keeps OSRM's code; a malformed answer is a failed request, never rows of no road", async () => {
    const osrm = osrmProvider({
      fetch: (async () =>
        new Response(JSON.stringify({ code: "TooBig" }), {
          status: 400,
        })) as unknown as typeof fetch,
    });
    await expect(
      osrm.matrixMany!([{ lat: 33.6, lon: 35.5 }], [{ lat: 33.7, lon: 35.6 }]),
    ).rejects.toThrow(/osrm table returned 400 TooBig/);
    const bad = osrmProvider({
      fetch: (async () =>
        new Response(JSON.stringify({ code: "Ok", distances: [[1]] }), {
          status: 200,
        })) as unknown as typeof fetch,
    });
    await expect(
      bad.matrixMany!([{ lat: 33.6, lon: 35.5 }], [{ lat: 33.7, lon: 35.6 }]),
    ).rejects.toThrow(/malformed/);
  });

  it("ORS while it has budget and has not refused; OSRM for the rest (16 October: every request got 403)", () => {
    expect(orsRefused(new Error("ors matrix returned 403"))).toBe(403);
    expect(orsRefused(new Error("ors matrix returned 429"))).toBe(429);
    expect(orsRefused(new Error("ors matrix returned 401"))).toBe(401);
    expect(orsRefused(new Error("ors matrix returned 500"))).toBeNull();
    expect(orsRefused(new Error("The operation was aborted due to timeout"))).toBeNull();
    expect(providerFor(0, 6, true)).toBe("ors");
    expect(providerFor(5, 6, true)).toBe("ors");
    expect(providerFor(6, 6, true)).toBe("osrm"); // past what the budget granted
    expect(providerFor(1, 6, false)).toBe("osrm"); // after a refusal
    expect(providerFor(0, 0, true)).toBe("osrm"); // no key or no budget
  });

  describe("fillBlocks: who is asked, and what is saved under whose name", () => {
    const needed = Array.from({ length: 75 }, (_, v) => pair(v, 1)); // 3 shop groups × 1 place group
    const blocks = planBlocks(needed);
    const wanted = new Set(needed.map((n) => `${n.vendor_id}|${n.place_id}`));
    const cells = (b: (typeof blocks)[number], provider: string) =>
      b.shops.map(() => b.places.map(() => ({ distanceM: 3000, durationS: 300, provider })));
    const setup = (ors: (k: number) => "ok" | number) => {
      const calls: string[] = [];
      const saves: { provider: string; rows: number }[] = [];
      let k = 0;
      const providers = {
        ors: {
          name: "ors",
          matrix: vi.fn(),
          matrixMany: vi.fn(async () => {
            calls.push("ors");
            const r = ors(k++);
            if (r !== "ok") throw new Error(`ors matrix returned ${r}`);
            return cells(blocks[k - 1], "ors");
          }),
        },
        osrm: {
          name: "osrm",
          matrix: vi.fn(),
          matrixMany: vi.fn(async (o: unknown[]) => {
            calls.push("osrm");
            return (o as unknown[]).map(() => [
              { distanceM: 3100, durationS: 310, provider: "osrm" },
            ]);
          }),
        },
      };
      const lines: string[] = [];
      return {
        calls,
        saves,
        lines,
        run: (granted: number) =>
          fillBlocks({
            blocks,
            wanted,
            granted,
            providers,
            save: async (rows, provider) => {
              saves.push({ provider, rows: rows.length });
              return rows.length;
            },
            log: (l) => lines.push(l),
            sleep: async () => {},
          }),
      };
    };

    it("ORS's quota spent on block 1 of 3: that block and the rest from OSRM, saved as osrm, ORS never asked again", async () => {
      expect(blocks).toHaveLength(3);
      const t = setup(() => 403);
      const r = await t.run(3);
      expect(t.calls).toEqual(["ors", "osrm", "osrm", "osrm"]);
      expect(t.saves.map((x) => x.provider)).toEqual(["osrm", "osrm", "osrm"]);
      expect(r).toMatchObject({ failed: 0, orsRefusal: 403, saved: { ors: 0, osrm: 75 } });
      expect(t.lines.join("\n")).toMatch(
        /::warning::.*403.*\n- 2 granted OpenRouteService request/,
      );
    });

    it("the budget grants 1 of 3: ORS for the first, OSRM for the other two", async () => {
      const t = setup(() => "ok");
      const r = await t.run(1);
      expect(t.calls).toEqual(["ors", "osrm", "osrm"]);
      expect(t.saves.map((x) => x.provider)).toEqual(["ors", "osrm", "osrm"]);
      expect(r.orsRefusal).toBeNull();
    });

    it("no key (nothing granted): OSRM only; a refused key is reported for the red run", async () => {
      const t = setup(() => "ok");
      await t.run(0);
      expect(t.calls).toEqual(["osrm", "osrm", "osrm"]);
      const u = setup(() => 401);
      const r = await u.run(3);
      expect(r.orsRefusal).toBe(401);
      expect(u.lines[0]).toMatch(/^::error::OpenRouteService refused the key/);
    });

    it("OSRM refusing stops the run; the rest waits for the next one", async () => {
      const t = setup(() => "ok");
      const providers429 = {
        ors: { name: "ors", matrix: vi.fn(), matrixMany: vi.fn() },
        osrm: {
          name: "osrm",
          matrix: vi.fn(),
          matrixMany: vi.fn(async () => {
            throw new Error("osrm table returned 429 TooManyRequests");
          }),
        },
      };
      const r = await fillBlocks({
        blocks,
        wanted,
        granted: 0,
        providers: providers429,
        save: async () => 0,
        log: (l) => t.lines.push(l),
        sleep: async () => {},
      });
      expect(providers429.osrm.matrixMany).toHaveBeenCalledTimes(1);
      expect(r).toMatchObject({ failed: 1, notSent: 2 });
    });
  });
});
