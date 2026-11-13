// The voice-note cases are well formed, and the mechanical transcript checks agree with their labels.
import { describe, expect, it } from "vitest";
import { loadVoiceCases } from "../voice-cases";
import { scoreLines } from "../run";
import { judge } from "@ak/agents/stt";

const cases = loadVoiceCases();

describe("voice-note eval cases", () => {
  it("there are at least ten, with unique ids", () => {
    expect(cases.length).toBeGreaterThanOrEqual(10);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
  });
  it.each(cases.map((c) => [c.id, c] as const))("%s: usable label matches the transcript checks", (_id, c) => {
    expect(judge({ text: c.transcript, provider: "kapso" }, undefined, c.duration_sec).usable).toBe(c.usable);
  });
  it.each(cases.map((c) => [c.id, c] as const))("%s: truth scores perfectly against itself", (_id, c) => {
    const s = scoreLines(c.truth.lines, c.truth.lines.map((l) => ({ query: l.item, qty: l.qty })));
    expect(s).toEqual({ recall: 1, precision: 1, invented: 0, qtyAccuracy: 1 });
    for (const l of c.truth.lines) expect(l.qty).toBeGreaterThan(0);
  });
  it("an invented item is counted as a hard failure", () => {
    const c = cases.find((x) => x.id === "vn-01")!;
    const s = scoreLines(c.truth.lines, [...c.truth.lines.map((l) => ({ query: l.item, qty: l.qty })), { query: "شوكولا", qty: 1 }]);
    expect(s.invented).toBe(1);
  });
});
