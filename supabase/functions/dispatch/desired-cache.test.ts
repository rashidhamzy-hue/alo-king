import { describe, expect, it } from "vitest";
import { desiredCache } from "./desired-cache";

type P = { retailer_id: string; v: string };
const V = "20000000-0000-0000-0000-00000000000a";

function setup(lists: P[][], fail = 0) {
  let t = 0;
  let calls = 0;
  const load = async () => {
    calls++;
    if (calls <= fail) throw new Error("stalled");
    return lists[Math.min(calls - 1 - fail, lists.length - 1)]!;
  };
  const c = desiredCache<P>(load, (p) => p.v, { now: () => t });
  return { c, calls: () => calls, tick: (ms: number) => (t += ms) };
}

describe("the image route's desired catalogue (a crawl of 1,400 images starved staging)", () => {
  it("computes a shop's catalogue once for every request in flight and for a minute after", async () => {
    const s = setup([
      [
        { retailer_id: "a", v: "h1" },
        { retailer_id: "b", v: "h2" },
      ],
    ]);
    const answers = await Promise.all(
      Array.from({ length: 50 }, (_, k) => s.c.has(V, k % 2 ? "a" : "b", k % 2 ? "h1" : "h2")),
    );
    expect(answers.every(Boolean)).toBe(true);
    expect(s.calls()).toBe(1);
    s.tick(59_000);
    expect(await s.c.has(V, "a", "h1")).toBe(true);
    expect(s.calls()).toBe(1);
    s.tick(2_000);
    expect(await s.c.has(V, "a", "h1")).toBe(true);
    expect(s.calls()).toBe(2);
  });

  it("a version it does not know reloads the catalogue at most once every 5 seconds", async () => {
    const s = setup([[{ retailer_id: "a", v: "old" }], [{ retailer_id: "a", v: "new" }]]);
    expect(await s.c.has(V, "a", "old")).toBe(true);
    s.tick(6_000);
    expect(await s.c.has(V, "a", "new")).toBe(true);
    expect(s.calls()).toBe(2);
    for (let k = 0; k < 20; k++) expect(await s.c.has(V, "a", "forged")).toBe(false);
    expect(s.calls()).toBe(2);
    s.tick(6_000);
    expect(await s.c.has(V, "a", "forged")).toBe(false);
    expect(s.calls()).toBe(3);
  });

  it("never keeps a failed load: a stalled database answers not found at once, the next request reloads", async () => {
    const failed: string[] = [];
    let calls = 0;
    const c = desiredCache<P>(
      async () => {
        if (++calls === 1) throw new Error("stalled");
        return [{ retailer_id: "a", v: "h1" }];
      },
      (p) => p.v,
      { now: () => 0, onError: (v) => failed.push(v) },
    );
    expect(await c.has(V, "a", "h1")).toBe(false);
    expect(calls).toBe(1);
    expect(failed).toEqual([V]);
    expect(await c.has(V, "a", "h1")).toBe(true);
    expect(calls).toBe(2);
  });

  it("keeps at most `max` shops", async () => {
    let calls = 0;
    const c = desiredCache<P>(
      async () => (calls++, [{ retailer_id: "a", v: "h" }]),
      (p) => p.v,
      { now: () => 0, max: 2 },
    );
    for (const v of ["s1", "s2", "s3"]) await c.has(v, "a", "h");
    expect(calls).toBe(3);
    await c.has("s3", "a", "h");
    await c.has("s2", "a", "h");
    expect(calls).toBe(3);
    await c.has("s1", "a", "h");
    expect(calls).toBe(4);
  });
});
