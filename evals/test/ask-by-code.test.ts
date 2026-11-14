// SP1: the staging 'ask' turns, and the reading the "go ahead" code path depends on. The live run is in evals/live.
import { describe, expect, it } from "vitest";
import cases from "../cases/ask_by_code.json";
import { judgeGoAhead, type GoAheadCase } from "../run";
import { OrderIntent } from "../../packages/agents/src/schemas";

const reading = (x: Record<string, unknown>) => OrderIntent.parse({ language: "ar_lb", lines: [], address: {}, ...x });
const byId = (id: string) => (cases.cases as GoAheadCase[]).find((c) => c.id === id)!;

describe("ask by code (SP1)", () => {
  it("14 Nov, «مشيلي الطلب»: the live reading (an order with no lines) is a go-ahead; a new line or a cancel is not", () => {
    expect(judgeGoAhead(byId("ask-14nov-go-ahead"), reading({ intent: "order" })).ok).toBe(true);
    expect(judgeGoAhead(byId("ask-14nov-go-ahead"), reading({ intent: "order", lines: [{ raw: "خبز", query: "خبز", qty: 1, confidence: 0.9 }] })).ok).toBe(false);
    expect(judgeGoAhead(byId("ask-14nov-go-ahead"), reading({ intent: "cancel" })).ok).toBe(false);
    expect(judgeGoAhead(byId("ask-go-ahead-not-cancel"), reading({ intent: "cancel" })).ok).toBe(true);
    expect(judgeGoAhead(byId("ask-14nov-go-ahead"), null).ok).toBe(false);
  });
  it("live, 14 Nov (SP1 gate run): «لغيلي الطلب» was read as an order with no lines; it must never carry the basket on", () => {
    expect(judgeGoAhead(byId("ask-go-ahead-not-cancel"), reading({ intent: "order" }))).toMatchObject({ ok: true });
  });
  it("live, 14 Nov: with the basket in the recent messages, «مشيلي الطلب» was read as that basket again; planned as an order, also no second call", () => {
    expect(judgeGoAhead(byId("ask-14nov-go-ahead"), reading({ intent: "order", lines: [1, 2, 3].map((i) => ({ raw: `x${i}`, query: `x${i}`, qty: 1, confidence: 0.9 })) })).ok).toBe(true);
    expect(judgeGoAhead(byId("ask-14nov-go-ahead"), reading({ intent: "question" })).ok).toBe(false);
  });
  it("every staging ask run is classified, and the cases are well formed", () => {
    expect(cases.staging_ask_runs).toHaveLength(17);
    for (const r of cases.staging_ask_runs) expect(r.now).toMatch(/^(code|model)/);
    for (const c of cases.cases as GoAheadCase[]) { expect(c.texts.length).toBeGreaterThan(0); expect(typeof c.go_ahead).toBe("boolean"); }
  });
});

describe("the cancel and refusal words that stop a go-ahead (SP1)", () => {
  const order = OrderIntent.parse({ language: "ar_lb", lines: [], address: {}, intent: "order" });
  it.each(["لغيلي الطلب", "الغي الطلب", "إلغاء", "ما بدي ياه", "لا خلص", "cancel it", "ma badde", "no thanks"])("%s: no go-ahead", async (t) => {
    const { isGoAhead } = await import("../../packages/agents/src/pipeline");
    expect(isGoAhead(order, t)).toBe(false);
  });
  it.each(["مشيلي الطلب", "yalla b3atle l talab", "ابعتلي ياه", "go ahead"])("%s: go-ahead", async (t) => {
    const { isGoAhead } = await import("../../packages/agents/src/pipeline");
    expect(isGoAhead(order, t)).toBe(true);
  });
});
