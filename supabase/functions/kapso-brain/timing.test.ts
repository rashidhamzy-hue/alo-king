import { describe, expect, it } from "vitest";
import { TurnTimer, percentile, summarize, turnKind, receiveLagMs, LATENCY_TARGETS } from "./timing.ts";

describe("TurnTimer", () => {
  it("accumulates per-stage time and call counts", async () => {
    let t = 1000; const clock = () => t;
    const tm = new TurnTimer(clock);
    await tm.time("db", async () => { t += 30; });
    await tm.time("db", async () => { t += 20; });
    await tm.time("model", async () => { t += 900; });
    await tm.time("send", async () => { t += 150; });
    const s = tm.snapshot();
    expect(s.db).toEqual({ ms: 50, n: 2 });
    expect(s.model).toEqual({ ms: 900, n: 1 });
    expect(s.send).toEqual({ ms: 150, n: 1 });
    expect(s.total_ms).toBe(1100);
  });
  it("still records time when the wrapped call throws", async () => {
    let t = 0; const tm = new TurnTimer(() => t);
    await expect(tm.time("model", async () => { t += 40; throw new Error("boom"); })).rejects.toThrow("boom");
    expect(tm.snapshot().model).toEqual({ ms: 40, n: 1 });
  });
  it("records time to first send once", () => {
    let t = 0; const tm = new TurnTimer(() => t);
    t = 250; tm.markFirstSend(); t = 900; tm.markFirstSend();
    expect(tm.snapshot().first_send_ms).toBe(250);
  });
  it("first_send_ms is null when nothing was sent", () => { expect(new TurnTimer(() => 0).snapshot().first_send_ms).toBeNull(); });
});

describe("background work", () => {
  it("drain waits for background promises and swallows their errors", async () => {
    const tm = new TurnTimer(() => 0); let done = false;
    tm.background(new Promise((r) => setTimeout(() => { done = true; r(1); }, 5)));
    tm.background(Promise.reject(new Error("meta down")));
    await tm.drain();
    expect(done).toBe(true);
  });
});

describe("percentile", () => {
  it("nearest-rank p50/p95", () => {
    const v = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(v, 50)).toBe(50);
    expect(percentile(v, 95)).toBe(100);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([], 50)).toBeNull();
  });
});

describe("turnKind", () => {
  it("classifies taps, text, voice, location", () => {
    expect(turnKind({ reply: { id: "X", title: "y" } })).toBe("tap");
    expect(turnKind({ text: "hi" })).toBe("text");
    expect(turnKind({ type: "audio" })).toBe("voice");
    expect(turnKind({ loc: { latitude: 1 } })).toBe("location");
    expect(turnKind({})).toBe("other");
  });
});

describe("receiveLagMs", () => {
  it("is the delay between the WhatsApp timestamp and now, never negative", () => {
    expect(receiveLagMs("1791215256", 1791215262500)).toBe(6500);
    expect(receiveLagMs("1791215256", 1791215250000)).toBe(0);
    expect(receiveLagMs(undefined, 5)).toBeNull();
    expect(receiveLagMs("abc", 5)).toBeNull();
  });
});

describe("summarize (no content, no phone)", () => {
  it("emits only numbers and the kind", () => {
    const tm = new TurnTimer(() => 0);
    const s = summarize(tm, { kind: "tap", receive_lag_ms: 6000, model_calls: 0 });
    expect(Object.keys(s).sort()).toEqual(["db", "first_send_ms", "kind", "model", "model_calls", "receive_lag_ms", "send", "total_ms", "transcribe"].sort());
  });
});

describe("latency targets (flow spec)", () => {
  it("taps under 1.5 s with no model call; free text one model call", () => {
    expect(LATENCY_TARGETS.tapMs).toBe(1500);
    expect(LATENCY_TARGETS.freeTextModelCalls).toBe(1);
  });
});
