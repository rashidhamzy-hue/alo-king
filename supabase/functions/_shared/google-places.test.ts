import { describe, expect, it, vi } from "vitest";
import { googlePlaceDetails, googlePlacesEnabled } from "./google-places";

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe("google places guard", () => {
  it("never reads the key or calls Google while the flag is off", async () => {
    const getKey = vi.fn(() => "SECRET");
    const fetchFn = vi.fn();
    const r = await googlePlaceDetails(
      { readConfig: async () => false, getKey, fetch: fetchFn as unknown as typeof fetch },
      "ChIJabcdefghij",
    );
    expect(r).toEqual({ status: "disabled" });
    expect(getKey).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it("treats a missing row, a read error and non-true values as off", async () => {
    for (const v of [undefined, null, "true", 1, "false", {}]) {
      expect(await googlePlacesEnabled(async () => v)).toBe(false);
    }
    expect(
      await googlePlacesEnabled(async () => {
        throw new Error("db down");
      }),
    ).toBe(false);
  });
  it("calls Google with the free-mask fields only when the flag is true", async () => {
    const fetchFn = vi.fn(() =>
      json({
        id: "ChIJabcdefghij",
        displayName: { text: "Cafe" },
        location: { latitude: 33.6, longitude: 35.5 },
      }),
    );
    const r = await googlePlaceDetails(
      {
        readConfig: async () => true,
        getKey: () => "SECRET",
        fetch: fetchFn as unknown as typeof fetch,
      },
      "ChIJabcdefghij",
    );
    expect(r).toEqual({
      status: "ok",
      place: { id: "ChIJabcdefghij", name: "Cafe", lat: 33.6, lon: 35.5 },
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
  it("is on but without a key: no call", async () => {
    const fetchFn = vi.fn();
    const r = await googlePlaceDetails(
      {
        readConfig: async () => true,
        getKey: () => undefined,
        fetch: fetchFn as unknown as typeof fetch,
      },
      "ChIJabcdefghij",
    );
    expect(r).toEqual({ status: "no_key" });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
