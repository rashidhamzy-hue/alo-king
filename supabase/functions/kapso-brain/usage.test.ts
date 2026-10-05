import { describe, expect, it } from "vitest";
import { isStagingPath, isTestPhone, tightenBudget, beirutDay, budgetAlertText, cachedSystem, cachedTools, decideGuard, estimateUsd, parseBudget, parseCap } from "./usage";

describe("estimateUsd (per-MTok prices, cache read 0.1x, cache write 1.25x)", () => {
  it("prices Sonnet 5.5 input/output", () => {
    expect(estimateUsd("claude-sonnet-5-5", { input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBeCloseTo(2 + 10, 6);
  });
  it("prices cache reads and writes separately", () => {
    const u = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000 };
    expect(estimateUsd("claude-sonnet-5-5", u)).toBeCloseTo(0.2 + 2.5, 6);
  });
  it("prices Haiku 4.5", () => {
    expect(estimateUsd("claude-haiku-4-5-20251001", { input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBeCloseTo(1 + 5, 6);
    expect(estimateUsd("claude-haiku-4-5", { input_tokens: 1_000_000, output_tokens: 0 })).toBeCloseTo(1, 6);
  });
  it("never under-counts an unknown model (uses the dearest known price) and tolerates missing fields", () => {
    const unknown = estimateUsd("some-future-model", { input_tokens: 1_000_000, output_tokens: 0 });
    expect(unknown).toBeGreaterThanOrEqual(2);
    expect(estimateUsd("claude-sonnet-5-5", {} as any)).toBe(0);
    expect(estimateUsd("claude-sonnet-5-5", { input_tokens: -5, output_tokens: NaN } as any)).toBe(0);
  });
});

describe("env parsing", () => {
  it("budget: positive number else default 5", () => {
    expect(parseBudget("12.5")).toBe(12.5);
    expect(parseBudget(undefined)).toBe(5);
    expect(parseBudget("")).toBe(5);
    expect(parseBudget("abc")).toBe(5);
    expect(parseBudget("-3")).toBe(5);
    expect(parseBudget("0")).toBe(5);
  });
  it("per-phone cap: positive integer else default 20", () => {
    expect(parseCap("25")).toBe(25);
    expect(parseCap(undefined)).toBe(20);
    expect(parseCap("0")).toBe(20);
    expect(parseCap("2.5")).toBe(2);
  });
});

describe("beirutDay", () => {
  it("uses Asia/Beirut, not UTC", () => {
    expect(beirutDay(new Date("2026-10-05T21:30:00Z"))).toBe("2026-10-06"); // 00:30 next day in Beirut (UTC+3)
    expect(beirutDay(new Date("2026-10-05T10:00:00Z"))).toBe("2026-10-05");
  });
});

describe("decideGuard", () => {
  it("ok under both limits", () => expect(decideGuard({ phoneCalls: 3, cap: 40, spentToday: 1, budget: 5 })).toBe("ok"));
  it("budget wins over the phone cap", () => expect(decideGuard({ phoneCalls: 99, cap: 40, spentToday: 5, budget: 5 })).toBe("budget"));
  it("phone cap at the limit", () => expect(decideGuard({ phoneCalls: 40, cap: 40, spentToday: 0, budget: 5 })).toBe("phone_cap"));
  it("just under is ok", () => expect(decideGuard({ phoneCalls: 39, cap: 40, spentToday: 4.99, budget: 5 })).toBe("ok"));
});

describe("budgetAlertText", () => {
  it("states spend and budget, no secrets or customer data", () => {
    const t = budgetAlertText(5.123, 5);
    expect(t).toContain("$5.12");
    expect(t).toContain("$5.00");
    expect(t).toMatch(/button-only/i);
  });
});

describe("prompt caching shape", () => {
  it("system: static block is cached, dynamic block is not", () => {
    expect(cachedSystem("STATIC", "dyn")).toEqual([{ type: "text", text: "STATIC", cache_control: { type: "ephemeral" } }, { type: "text", text: "dyn" }]);
    expect(cachedSystem("STATIC", "")).toEqual([{ type: "text", text: "STATIC", cache_control: { type: "ephemeral" } }]);
  });
  it("tools: only the last tool carries the breakpoint and the input is not mutated", () => {
    const tools = [{ name: "a" }, { name: "b" }, { name: "c" }];
    const out = cachedTools(tools);
    expect(out[2]).toEqual({ name: "c", cache_control: { type: "ephemeral" } });
    expect(out[0]).toEqual({ name: "a" });
    expect(tools[2]).toEqual({ name: "c" });
    expect(cachedTools([])).toEqual([]);
  });
});

describe("staging-only guards", () => {
  it("staging path is the staging function itself, never a sub-path of the production one", () => {
    for (const ok of ["/kapso-brain-test", "/kapso-brain-test/", "/functions/v1/kapso-brain-test", "/functions/v1/kapso-brain-test/x"]) expect(isStagingPath(ok), ok).toBe(true);
    for (const bad of ["/kapso-brain", "/functions/v1/kapso-brain", "/kapso-brain/kapso-brain-test", "/functions/v1/kapso-brain/kapso-brain-test", "/x/kapso-brain-test", "/functions/v1/x/kapso-brain-test", ""]) expect(isStagingPath(bad), bad).toBe(false);
  });
  it("a budget override can only tighten", () => {
    expect(tightenBudget(0.01, 5)).toBe(0.01);
    expect(tightenBudget(9999, 5)).toBe(5);
    expect(tightenBudget(0, 5)).toBeUndefined();
    expect(tightenBudget(NaN, 5)).toBeUndefined();
    expect(tightenBudget(-1, 5)).toBeUndefined();
  });
  it("test phones are 12-15 digits starting 961700000; real 11-digit numbers never match", () => {
    expect(isTestPhone("96170000068301")).toBe(true);
    expect(isTestPhone("961700000999")).toBe(true);
    expect(isTestPhone("96170000099")).toBe(false); // 11 digits: a real mobile number
    expect(isTestPhone("96170123456")).toBe(false);
    expect(isTestPhone("961700000999999999")).toBe(false);
    expect(isTestPhone("961700000abc")).toBe(false);
  });
});
