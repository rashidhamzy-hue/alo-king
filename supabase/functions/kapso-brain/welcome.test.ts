import { describe, expect, it } from "vitest";
import { moodPhrase, moodRows, parseWelcomeTap, welcomeCard } from "./welcome.ts";
import { moodTerms } from "./searchfirst.ts";
import { BASKET_TTL_MS, basketCutoffIso, basketIsStale } from "./cartstate.ts";

describe("welcomeCard", () => {
  it("a returning customer: Reorder, Browse, Surprise me (3 buttons, titles within 20)", () => {
    for (const ar of [false, true]) {
      const c = welcomeCard({ ar, name: "Rashid Hamzy", lastOrderId: "11111111-1111-1111-1111-111111111111" });
      expect(c.buttons.map((b) => b.id)).toEqual(["REORDER|11111111-1111-1111-1111-111111111111", "WELCOME|browse", "WELCOME|surprise"]);
      expect(c.buttons.every((b) => b.title.length <= 20)).toBe(true); expect(c.body.length).toBeLessThan(120);
    }
    expect(welcomeCard({ ar: false, name: "Rashid Hamzy" }).body).toContain("Hi Rashid");
  });
  it("a new customer gets no Reorder button", () => expect(welcomeCard({ ar: false }).buttons.map((b) => b.id)).toEqual(["WELCOME|browse", "WELCOME|surprise"]));
  it("is short: one line, no order details", () => expect(welcomeCard({ ar: false, lastOrderId: "x" }).body.split("\n")).toHaveLength(1));
});

describe("browse moods", () => {
  it("rows fit a WhatsApp list (<=10 rows, titles <=24) in both languages", () => { for (const ar of [false, true]) { const r = moodRows(ar); expect(r.length).toBeLessThanOrEqual(10); expect(r.every((x) => x.title.length <= 24)).toBe(true); } });
  it("every mood phrase is understood by the free search (a mood, not a dish word)", () => { for (const r of moodRows(false)) expect(moodTerms(moodPhrase(r.id.split("|")[1])!), r.id).not.toBeNull(); });
  it("tap parsing", () => { expect(parseWelcomeTap("WELCOME|browse")).toBe("browse"); expect(parseWelcomeTap("WELCOME|surprise")).toBe("surprise"); expect(parseWelcomeTap("MOOD|light")).toEqual({ mood: "light" }); expect(parseWelcomeTap("MOOD|nope")).toBeNull(); expect(parseWelcomeTap("BASKET")).toBeNull(); });
});

describe("basket expiry (3 hours)", () => {
  const now = Date.parse("2026-10-06T18:00:00Z");
  it("is three hours", () => expect(BASKET_TTL_MS).toBe(3 * 3600_000));
  it("cutoff is now minus 3 h", () => expect(basketCutoffIso(now)).toBe("2026-10-06T15:00:00.000Z"));
  it("fresh vs stale", () => { expect(basketIsStale("2026-10-06T15:00:01Z", now)).toBe(false); expect(basketIsStale("2026-10-06T15:00:00Z", now)).toBe(true); expect(basketIsStale("2026-10-06T09:00:00Z", now)).toBe(true); expect(basketIsStale(null, now)).toBe(true); });
});
