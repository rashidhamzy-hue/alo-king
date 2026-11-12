import { describe, expect, it } from "vitest";
import { DEFAULT_VOICE_LIMITS, estimateSeconds, VOICE_MAY_AUTHORISE_MONEY, VOICE_TEXT, voiceVerdict } from "@ak/core/voice-policy";

describe("voice-note policy", () => {
  it("processes an ordinary note for every role", () => {
    for (const role of ["customer", "merchant", "driver", "staff"] as const) expect(voiceVerdict(role, 45).action).toBe("process");
  });
  it("uses a different ceiling per role", () => {
    expect(voiceVerdict("customer", 181)).toMatchObject({ action: "too_long", limit: 180 });
    expect(voiceVerdict("merchant", 240).action).toBe("process");
    expect(voiceVerdict("merchant", 301).action).toBe("too_long");
    expect(voiceVerdict("driver", 121).action).toBe("too_long");
  });
  it("caps how much audio one sender can have transcribed in an hour", () => {
    expect(voiceVerdict("customer", 120, 800).action).toBe("over_budget");
    expect(voiceVerdict("customer", 60, 800).action).toBe("process");
  });
  it("treats an empty or unreadable file as empty, never as an order", () => {
    expect(voiceVerdict("customer", estimateSeconds(0)).action).toBe("empty");
  });
  it("prefers the provider's duration over the size estimate", () => {
    expect(estimateSeconds(999_999, 12)).toBe(12);
    expect(estimateSeconds(210_000)).toBe(100);
  });
  it("always has something to say, so no message disappears silently", () => {
    expect(VOICE_TEXT.tooLong(DEFAULT_VOICE_LIMITS.customer)).toContain("3");
    expect(VOICE_TEXT.overBudget.length).toBeGreaterThan(10);
  });
  it("voice never authorises money", () => { expect(VOICE_MAY_AUTHORISE_MONEY).toBe(false); });
});
