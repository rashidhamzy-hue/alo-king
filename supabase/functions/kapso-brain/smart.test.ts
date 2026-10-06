import { describe, expect, it } from "vitest";
import { addrKey, addressRows, isUsualRequest, mapsLink, parseAddrTap, parseVoiceTap, pinnedLandmark, pickUsual, voiceCardText, voiceTapId } from "./smart";

describe("isUsualRequest", () => {
  it.each(["the usual", "The usual please", "my usual", "as usual", "same as usual", "المعتاد", "نفس الشي المعتاد", "el 3ade"])("%s", (t) => expect(isUsualRequest(t)).toBe(true));
  it.each(["the usual suspects burger", "I want a usual burger with fries and a coke", "reorder"])("%s is not", (t) => expect(isUsualRequest(t)).toBe(false));
});

describe("pickUsual", () => {
  const o = (id: string, vendor: string, items: [string, number][], at: string) => ({ id, vendor_id: vendor, created_at: at, status: "delivered", items: items.map(([item_id, quantity]) => ({ item_id, quantity })) });
  it("returns the most frequent identical basket", () => {
    const orders = [o("1", "v1", [["a", 2]], "2026-09-01"), o("2", "v2", [["b", 1]], "2026-09-02"), o("3", "v1", [["a", 2]], "2026-09-03"), o("4", "v2", [["b", 1]], "2026-09-04"), o("5", "v1", [["a", 2]], "2026-09-05")];
    expect(pickUsual(orders)?.id).toBe("5"); // most recent instance of the most frequent basket
  });
  it("ties go to the most recent", () => {
    expect(pickUsual([o("1", "v1", [["a", 1]], "2026-09-01"), o("2", "v2", [["b", 1]], "2026-09-09")])?.id).toBe("2");
  });
  it("ignores cancelled/rejected orders and quantity-order differences", () => {
    const c = { ...o("9", "v1", [["a", 1]], "2026-09-10"), status: "cancelled" };
    expect(pickUsual([c])).toBeNull();
    expect(pickUsual([o("1", "v1", [["a", 1], ["b", 2]], "2026-09-01"), o("2", "v1", [["b", 2], ["a", 1]], "2026-09-02")])?.id).toBe("2");
  });
  it("null with no history", () => expect(pickUsual([])).toBeNull());
});

describe("voice confirmation", () => {
  it("round-trips tap ids", () => {
    expect(parseVoiceTap(voiceTapId("ok", "abc"))).toEqual({ answer: "ok", id: "abc" });
    expect(parseVoiceTap("VOICE|no|abc")).toEqual({ answer: "no", id: "abc" });
    expect(parseVoiceTap("VOICE|maybe|abc")).toBeNull();
    expect(parseVoiceTap("VOICE|ok|")).toBeNull();
    expect(parseVoiceTap("CONFIRM|abc")).toBeNull();
  });
  it("quotes the transcript, in both languages, and clamps it", () => {
    expect(voiceCardText("two soft drinks", false)).toContain("“two soft drinks”");
    expect(voiceCardText("بدي مشروب", true)).toContain("سمعت");
    expect(voiceCardText("x".repeat(2000), false).length).toBeLessThan(700);
  });
});

describe("addresses", () => {
  it("normalises keys", () => {
    expect(addrKey("Baakleen", "  Near the Church ")).toBe(addrKey("baakleen", "near the church"));
    expect(addrKey("A", "b", 33.6912, 35.5701)).toBe(addrKey("a", "b", 33.69121, 35.57009)); // pins ~1m apart collapse
    expect(addrKey("A", "b", 33.69, 35.57)).not.toBe(addrKey("A", "b", 33.70, 35.57));
  });
  it("builds a maps link and a driver-friendly pinned landmark within 200 chars", () => {
    expect(mapsLink(33.6912, 35.5701)).toBe("https://maps.google.com/?q=33.6912,35.5701");
    const l = pinnedLandmark({ latitude: 33.6912, longitude: 35.5701, address: "Main road, near the church" }, "Baakleen");
    expect(l).toContain("maps.google.com");
    expect(l.length).toBeLessThanOrEqual(200);
    expect(pinnedLandmark({ latitude: 1, longitude: 2, address: "y".repeat(500) }, "V").length).toBeLessThanOrEqual(200);
  });
  it("lists saved addresses as ≤10 rows with a 'new address' row", () => {
    const saved = Array.from({ length: 12 }, (_, i) => ({ id: `id${i}`, label: null, village: "Baakleen", landmark: `Building number ${i} near the very long landmark name`, last_used_at: `2026-09-${10 + i}` }));
    const rows = addressRows(saved, false);
    expect(rows.length).toBe(10);
    expect(rows.at(-1)?.id).toBe("ADDR|new");
    expect(rows.every((r) => r.title.length <= 24 && (r.description ?? "").length <= 72)).toBe(true);
    expect(rows[0].id).toBe("ADDR|id11"); // most recently used first
    const withBasket = addressRows(saved, false, "bk1");
    expect(withBasket[0].id).toBe("ADDR|id11|bk1");
    expect(withBasket.at(-1)?.id).toBe("ADDR|new|bk1");
  });
  it("parses address taps", () => {
    expect(parseAddrTap("ADDR|abc")).toEqual({ id: "abc", basketId: null });
    expect(parseAddrTap("ADDR|new")).toEqual({ id: "new", basketId: null });
    expect(parseAddrTap("ADDR|abc|bk1")).toEqual({ id: "abc", basketId: "bk1" });
    expect(parseAddrTap("ADDR|")).toBeNull();
    expect(parseAddrTap("ADDR|a|")).toBeNull();
    expect(parseAddrTap("ADDR|a|b|c")).toBeNull();
  });
});

import { isOptOutTitle } from "./broadcast";
describe("voice STOP", () => {
  it("transcripts of a spoken stop are recognised as opt-outs", () => {
    for (const t of ["stop", "Stop.", "STOP", "stop offers"]) expect(isOptOutTitle(t)).toBe(true);
    expect(isOptOutTitle("two soft drinks please")).toBe(false);
  });
});

describe("pinnedLandmark keeps the landmark the customer already gave (friction fix)", () => {
  const pin = { latitude: 33.6454, longitude: 35.6434 };
  it("sharing a pin in the same village adds the map link to the saved landmark instead of replacing it", () => {
    const l = pinnedLandmark(pin, "Khraibeh", { village: "Khraibeh", address: "Villa Rashid Abou Hamzy, near Abou Adham Supermarket" });
    expect(l).toContain("Villa Rashid Abou Hamzy"); expect(l).toContain(mapsLink(33.6454, 35.6434));
  });
  it("a previous landmark that already carries an old map link is refreshed, not stacked", () => {
    const l = pinnedLandmark(pin, "Khraibeh", { village: "Khraibeh", address: `Villa Rashid (${mapsLink(1, 2)})` });
    expect(l).toContain("Villa Rashid"); expect(l).toContain(mapsLink(33.6454, 35.6434)); expect(l).not.toContain(mapsLink(1, 2));
  });
  it("a pin-only previous address (just the village), another village, or nothing gives the plain pin as before", () => {
    expect(pinnedLandmark(pin, "Khraibeh", { village: "Khraibeh", address: `Khraibeh (${mapsLink(1, 2)})` })).toBe(`Khraibeh (${mapsLink(33.6454, 35.6434)})`);
    expect(pinnedLandmark(pin, "Khraibeh", { village: "Baakleen", address: "Near the church" })).toBe(`Khraibeh (${mapsLink(33.6454, 35.6434)})`);
    expect(pinnedLandmark(pin, "Khraibeh", null)).toBe(`Khraibeh (${mapsLink(33.6454, 35.6434)})`);
  });
  it("stays within 200 characters", () => {
    expect(pinnedLandmark(pin, "V", { village: "V", address: "z".repeat(500) }).length).toBeLessThanOrEqual(200);
  });
});
