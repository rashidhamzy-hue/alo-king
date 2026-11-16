// LB1 (16 November): the simulator's judge is given the basket after each turn, so a customer's own additions are not counted as
// wrong products (about a third of every run, HANDOFF B1d). Unit tests only: no model, no network, no simulation run.
import { afterEach, describe, expect, it } from "vitest";
import { basketRows, basketLine } from "../basket";
import { JUDGE_SYSTEM, transcriptOf } from "../judge";
import type { TurnRecord } from "../driver";
import { installFetchGuard, type Guard } from "../guard";
import { KAPSO_ORIGIN, MEDIA_ORIGIN } from "../driver";
import { mockConcierge, mockCustomer, mockJudge } from "../mock";
import { runAll } from "../run";
import scenarios from "../scenarios.json";
import type { Scenario } from "../scenarios";

const STATE = { lastQuote: { lines: [{ product_id: "p1", qty: 2 }, { product_id: "p2", qty: 1 }, { product_id: "p3", qty: 0.5 }],
  quote: { lines: [{ product_id: "p1", name: "Test Labneh 500G", name_ar: "لبنة" }, { product_id: "p2", name: "Test Bread", name_ar: null }] } } };

describe("the basket after a turn", () => {
  it("is the held lines as «count × name», named from the quote; a line the quote does not name says so", () => {
    expect(basketRows(STATE)).toEqual(["2 × Test Labneh 500G", "1 × Test Bread", "0.5 × (unnamed product p3)"]);
  });
  it("is null when nothing is held, and an empty list is nothing held too", () => {
    expect(basketRows({})).toBeNull();
    expect(basketRows({ lastQuote: null })).toBeNull();
    expect(basketRows({ lastQuote: { lines: [], quote: { lines: [] } } })).toBeNull();
    expect(basketRows(undefined)).toBeNull();
  });
  it("is one line for the judge, and says when nothing is held", () => {
    expect(basketLine(["2 × A", "1 × B"])).toBe("BASKET NOW: 2 × A; 1 × B");
    expect(basketLine(null)).toBe("BASKET NOW: nothing held");
  });
});

const turn = (n: number, text: string, basket: string[] | null): TurnRecord => ({
  n, clock: "day", action: { kind: "text", text }, replies: [{ kind: "text", text: `shop answer ${n}`, options: [] }], seconds: 0, modelCalls: 1, usd: 0,
  outcome: null, path: null, handoffs: [], afterHandoff: false, afterOptOut: false, failures: [], guardRefusals: 0, basket } as unknown as TurnRecord);

describe("what the judge reads", () => {
  it("each turn of the transcript carries the basket as it stood after that turn", () => {
    const t = transcriptOf([turn(1, "2 labneh", ["2 × Labneh"]), turn(2, "add 3 bread", ["2 × Labneh", "3 × Bread"]), turn(3, "thanks", null)]);
    expect(t).toMatch(/CUSTOMER 1: 2 labneh[\s\S]*BASKET NOW: 2 × Labneh\n[\s\S]*CUSTOMER 2: add 3 bread/);
    expect(t).toContain("BASKET NOW: 2 × Labneh; 3 × Bread");
    expect(t).toContain("BASKET NOW: nothing held");
    expect(t.match(/BASKET NOW/g)).toHaveLength(3);
  });
  it("a record with no basket (an older run's) is still readable", () => {
    const old = { ...turn(1, "hi", null) } as Record<string, unknown>; delete old.basket;
    expect(() => transcriptOf([old as unknown as TurnRecord])).not.toThrow();
    expect(transcriptOf([old as unknown as TurnRecord])).not.toContain("BASKET NOW");
  });
  it("the judge is told to compare the basket with what the customer said, own additions included", () => {
    expect(JUDGE_SYSTEM).toMatch(/BASKET NOW/);
    expect(JUDGE_SYSTEM).toMatch(/customer.{0,40}own (additions|counts|changes)/i);
    expect(JUDGE_SYSTEM).toMatch(/wrong_or_uninvited_product[^\n]*basket/i);
  });
});

let guard: Guard | null = null;
afterEach(() => { guard?.restore(); guard = null; });

describe("a whole run (stand-in models, repository seeds)", () => {
  it("records the basket on every turn and hands it to the judge", async () => {
    guard = installFetchGuard({ stagingOrigin: null, kapsoOrigin: KAPSO_ORIGIN, mediaOrigin: MEDIA_ORIGIN, allowHosts: [] });
    const seen: string[] = [];
    const judge = mockJudge();
    const spy = { messages: { create: async (body: Parameters<typeof judge.messages.create>[0], ...rest: unknown[]) => {
      const u = body.messages.at(-1)!.content; seen.push(typeof u === "string" ? u : JSON.stringify(u));
      return (judge.messages.create as (...a: unknown[]) => unknown)(body, ...rest) as ReturnType<typeof judge.messages.create>;
    } } } as typeof judge;
    // a typed English order: the stand-in reading can read it, so the basket is held after the first turn
    const chosen = [(scenarios as Scenario[]).find((s) => s.category === "plain_order" && !s.voice && !s.burst && s.lang === "en")!];
    const s = await runAll({ scenarios: chosen, copy: null, guard, outDir: null, log: () => {},
      raw: { concierge: mockConcierge(), customer: mockCustomer(() => "Potato, Tomato - deliver to Baakline"), judge: spy },
      models: { concierge: "claude-haiku-5-5", customer: "claude-sonnet-5-5", judge: "claude-sonnet-5-5" },
      soft: 27, hard: 33, concurrency: 1, calibrate: 1, reruns: 0, maxMinutes: 10 });
    const r = s.results[0]!;
    expect(r.turns.length).toBeGreaterThan(0);
    for (const t of r.turns) expect(t).toHaveProperty("basket");
    expect(r.turns[0]!.basket).toEqual(["1 × Potato", "1 × Tomato"]);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]).toMatch(/BASKET NOW: /);
  }, 120_000);
});
