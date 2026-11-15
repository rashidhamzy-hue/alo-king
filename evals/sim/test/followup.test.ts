// SIM1 follow-up: the budget input, the ten fixes' share of the repeated seeds, reading two runs as one, and the committed selection.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { limitsFor } from "../budget";
import { apportion, FIXES, fixesOf, pickFollowUp } from "../fixes";
import { mergeRuns } from "../merge";
import type { ConversationResult, RunSummary } from "../run";
import scenarios from "../scenarios.json";
import followup from "../followup-2026-11-15.json";

const verdict = { goal_reached: false, wrong_or_uninvited_product: false, invented_fact: false, rating_praise_health: false, dead_end: true,
  repeated_question: false, natural_dialect: true, turns_to_card: null, severity: 3 as const, problems: [], summary: "" };
const result = (id: string, over: Partial<ConversationResult> = {}): ConversationResult => ({ id, seed: 1, attempt: 0, category: "plain_order", variant: "one_item",
  lang: "ar", voice: false, burst: false, clock: "day", status: "judged", error: null, endReason: "", turns: [], facts: null, failures: [], verdict,
  usd: { concierge: 0, customer: 0, judge: 0, total: 0 }, conciergeCalls: 0, conciergeApiErrors: 0, passed: false, ...over });
const summary = (spent: number, over: Partial<RunSummary> = {}): RunSummary => ({ started: "2026-11-15T08:00:00Z", finished: "2026-11-15T09:00:00Z", source: "staging",
  models: { concierge: "h", customer: "s", judge: "s" }, spent, byRole: { concierge: { usd: spent, calls: 1 }, customer: { usd: 0, calls: 0 }, judge: { usd: 0, calls: 0 } },
  calls: 1, calibration: null, adjustments: [], featuresDropped: [], guard: { kapsoRecorded: 2, refused: [], stagingRequests: [{ method: "GET", count: 32 }] }, stoppedBy: null, results: [], ...over });

describe("budget_usd", () => {
  it("empty keeps today's limits; a budget stops new conversations at 85% and every call at the budget", () => {
    expect(limitsFor(undefined, 27, 33)).toEqual({ soft: 27, hard: 33 });
    expect(limitsFor("", 27, 33)).toEqual({ soft: 27, hard: 33 });
    expect(limitsFor("4", 27, 33)).toEqual({ soft: 3.4, hard: 4 });
    expect(() => limitsFor("four", 27, 33)).toThrow(/positive number/);
    expect(() => limitsFor("-1", 27, 33)).toThrow(/positive number/);
  });
});

describe("the ten fixes", () => {
  it("share N by largest remainder, exactly N in all", () => {
    const q = apportion({ a: 249, b: 89, c: 3, d: 0 }, 100);
    expect(Object.values(q).reduce((x, y) => x + y, 0)).toBe(100);
    expect(q.d).toBe(0);
    expect(q.a).toBeGreaterThan(q.b!);
  });
  it("tell a conversation's fixes from what the run recorded", () => {
    const silent = result("s", { failures: [{ code: "silence_after_handoff", detail: "", turn: 2, severity: 3 }] });
    expect(fixesOf(silent)).toContain("handoff_silence");
    const min = result("m", { turns: [{ n: 1, clock: "day", action: { kind: "text", text: "x" }, replies: [{ kind: "text", text: "طلبك تحت الحد الأدنى", options: [] }],
      seconds: 1, modelCalls: 1, usd: 0, outcome: null, path: null, handoffs: [], afterHandoff: false, afterOptOut: false, failures: [], guardRefusals: 0 }] });
    expect(fixesOf(min)).toContain("minimum_order");
    expect(FIXES).toHaveLength(10);
  });
  it("pick only failing first attempts, deterministically, in proportion", () => {
    const rs = [...Array(30)].map((_, i) => result(`sim-${String(i).padStart(3, "0")}`, i % 3 ? { failures: [{ code: "message_rules", detail: "", turn: 1, severity: 1 }] } : { passed: true, verdict: { ...verdict, goal_reached: true, dead_end: false } }));
    const a = pickFollowUp(rs, 10, 7), b = pickFollowUp(rs, 10, 7);
    expect(a).toEqual(b);
    expect(a.picked).toHaveLength(10);
    expect(new Set(a.picked.map((p) => p.id)).size).toBe(10);
    for (const p of a.picked) expect(rs.find((r) => r.id === p.id)!.passed).toBe(false);
  });
});

describe("two runs read as one", () => {
  it("a later result replaces an earlier one; an earlier repeat that never ran is dropped; spend adds up", () => {
    const one = { label: "first", summary: summary(11.27), results: [result("sim-001"), result("sim-002", { status: "error", error: "limit" }), result("sim-003", { attempt: 1, status: "error", error: "limit" })] };
    const two = { label: "follow-up", summary: summary(3.1, { stoppedBy: null }), results: [result("sim-002"), result("sim-001", { attempt: 1, passed: true })] };
    const m = mergeRuns([one, two]);
    expect(m.results.map((r) => `${r.id}#${r.attempt}:${r.status}`)).toEqual(["sim-001#0:judged", "sim-001#1:judged", "sim-002#0:judged"]);
    expect(m.spent).toBeCloseTo(14.37, 6);
    expect(m.guard.stagingRequests).toEqual([{ method: "GET", count: 64 }]);
    expect(m.runs.map((r) => r.label)).toEqual(["first", "follow-up"]);
  });
});

describe("the committed follow-up selection", () => {
  it("names the 37 cut-off first attempts and 100 distinct failing seeds, all real scenarios, none in both lists", () => {
    const ids = new Set((scenarios as { id: string }[]).map((s) => s.id));
    expect(followup.cut_off).toHaveLength(37);
    expect(followup.again).toHaveLength(100);
    const again = followup.again.map((a) => a.id);
    expect(new Set(again).size).toBe(100);
    for (const id of [...followup.cut_off, ...again]) expect(ids.has(id)).toBe(true);
    expect(again.filter((id) => followup.cut_off.includes(id))).toEqual([]);
    expect(Object.values(followup.quota).reduce((a, b) => a + b, 0)).toBe(100);
  });
  it("the workflow passes budget_usd and followup through the environment, never into the script", () => {
    const wf = readFileSync(fileURLToPath(new URL("../../../.github/workflows/sim-test.yml", import.meta.url)), "utf8");
    expect(wf).toContain("SIM_BUDGET_USD: ${{ inputs.budget_usd }}");
    expect(wf).toContain("SIM_FOLLOWUP: ${{ inputs.followup }}");
    const run = wf.slice(wf.indexOf("run: |", wf.indexOf("- name: Simulate")));
    expect(run.slice(0, run.indexOf("- uses:"))).not.toMatch(/\$\{\{\s*inputs\./);
  });
});
