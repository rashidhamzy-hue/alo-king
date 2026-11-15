// SIM1: the per-turn checks and the budget, on known messages (the real order card, fixed messages) and known prices.
import { describe, expect, it } from "vitest";
import { formatOrderCard, type Quote } from "@ak/agents/order-card";
import { messages } from "@ak/agents/messages";
import { cardOf, langOf, renderKapso, ruleProblems, totalMismatch, wrongLanguage } from "../checks";
import { amountsIn } from "../metered";
import { Budget, BudgetStop, costOf, priceFor, type PriceRow } from "../budget";
import { noisyTranscript } from "../customer";
import { classes, quantile, scrub } from "../report";
import { passes, type ConversationResult } from "../run";

const ORDER = "99999999-8888-4777-8666-555555555555";
const QUOTE: Quote = { ok: true, issues: [], lines: [{ product_id: "p1", name: "Test Labneh 500G", name_ar: "لبنة تجربة", qty: 2, unit: "each", line_total_usd: 4.5 }],
  subtotal_usd: 4.5, delivery_fee_usd: 1, total_usd: 5.5, fx_rate_lbp: 89500, total_lbp: 492250, eta_minutes: 30, pickup: false, village: "Baakline", village_ar: "بعقلين", village_id: null };
const card = (lang: "ar" | "en" | "fr") => renderKapso(formatOrderCard({ orderId: ORDER, shortCode: "AK-1", quote: QUOTE, paymentMethod: "cod", lang,
  address: { village_en: "Baakline", village_ar: "بعقلين", building: null, floor: null } }).at(-1));

describe("checks", () => {
  it("reads the real order card: its order, its total, the message rules, its language", () => {
    for (const lang of ["ar", "en", "fr"] as const) {
      const m = card(lang);
      expect(m.kind).toBe("buttons");
      expect(cardOf(m)).toEqual({ orderId: ORDER, total: 5.5, credit: 0 });
      expect(ruleProblems(m)).toEqual([]);
      expect(wrongLanguage(lang, m.text)).toBeNull();
    }
    expect(totalMismatch({ total: 5.5, credit: 0 }, 5.5)).toBeNull();
    expect(totalMismatch({ total: 5.5, credit: 0 }, 6)).toMatch(/card 5.50 vs database 6.00/);
  });

  it("every fixed message passes the rules in its language", () => {
    for (const lang of ["ar", "en", "fr"] as const) {
      const f = messages(lang).fixed as Record<string, unknown>;
      for (const [k, v] of Object.entries(f)) if (typeof v === "string") expect(ruleProblems({ kind: "text", text: v, options: [] }), `${lang}.${k}`).toEqual([]);
    }
  });

  it("tells languages apart, and a reply in another language", () => {
    expect(langOf("أهلا، شو بتحب تطلب اليوم؟")).toBe("ar");
    expect(langOf("Which size would you like for the labneh?")).toBe("en");
    expect(langOf("Quelle taille voulez-vous pour la labneh ?")).toBe("fr");
    expect(langOf("baddi 2 kilo batata w rabtet khebez")).toBe("arabizi");
    expect(langOf("ok")).toBe("unknown");
    expect(wrongLanguage("arabizi", "شو بدك كمان؟")).toBeNull();
    expect(wrongLanguage("ar", "What would you like to order?")).toBe("en");
    expect(wrongLanguage("fr", "What would you like to order?")).toBe("en");
    expect(wrongLanguage("mixed", "What would you like to order?")).toBeNull();
  });

  it("flags the rules test's problems", () => {
    expect(ruleProblems({ kind: "text", text: "Total $5.00 and $6.00", options: [] }).join()).toMatch(/rule 7/);
    expect(ruleProblems({ kind: "text", text: "🎉 done", options: [] }).join()).toMatch(/rule 4/);
    expect(ruleProblems({ kind: "text", text: "٣ علب", options: [] }).join()).toMatch(/Arabic-Indic/);
  });

  it("finds amounts of money in any spelling", () => {
    expect(amountsIn("It is $3.50 or 3.50 USD, 250,000 LBP, 5 دولار, 10 lira")).toEqual(["3.5", "3.5", "250000", "5", "10"]);
    expect(amountsIn("2 kilo and building 4")).toEqual([]);
  });

  it("a voice transcript is noisy, seeded, and the same every time", () => {
    const a = noisyTranscript("بدي كيلو بطاطا، وربطة خبز لو سمحت.", 10001, "ar");
    expect(a).toBe(noisyTranscript("بدي كيلو بطاطا، وربطة خبز لو سمحت.", 10001, "ar"));
    expect(a).not.toMatch(/[،.]/);
  });
});

describe("budget", () => {
  const rows: PriceRow[] = [
    { model: "claude-sonnet-5-5", effective_from: "2026-11-01", input_usd_per_mtok: 2, output_usd_per_mtok: 10, long_context_above_tokens: null, long_input_usd_per_mtok: null, long_output_usd_per_mtok: null, cache_read_usd_per_mtok: 0.1, cache_write_usd_per_mtok: null },
    { model: "claude-sonnet-5-5", effective_from: "2026-11-14", input_usd_per_mtok: 2, output_usd_per_mtok: 10, long_context_above_tokens: null, long_input_usd_per_mtok: null, long_output_usd_per_mtok: null, cache_read_usd_per_mtok: 0.1, cache_write_usd_per_mtok: 2.5 },
    { model: "claude-haiku-5-5", effective_from: "2026-11-14", input_usd_per_mtok: 0.1, output_usd_per_mtok: 0.5, long_context_above_tokens: 100000, long_input_usd_per_mtok: 0.5, long_output_usd_per_mtok: 2.5, cache_read_usd_per_mtok: 0.01, cache_write_usd_per_mtok: 0.125 },
  ];
  it("prices a call as agent_run_costs does: the row in force, cache reads and writes, the long-context rate", () => {
    expect(priceFor(rows, "claude-sonnet-5-5", "2026-11-15")!.effective_from).toBe("2026-11-14");
    expect(costOf(priceFor(rows, "claude-sonnet-5-5", "2026-11-15")!, { input: 1_000_000, output: 100_000, cacheRead: 1_000_000, cacheWrite: 1_000_000 })).toBeCloseTo(2 + 1 + 0.1 + 2.5, 6);
    expect(costOf(rows[2]!, { input: 50_000, output: 1000, cacheRead: 60_000, cacheWrite: 0 })).toBeCloseTo((50_000 * 0.5 + 1000 * 2.5 + 60_000 * 0.01) / 1e6, 9);
  });
  it("starts nothing above the soft limit and refuses every call at the hard limit", () => {
    const b = new Budget(27, 33, rows, () => {}, "2026-11-15");
    b.add("concierge", 26.99); expect(b.canStart()).toBe(true);
    b.add("judge", 0.02); expect(b.canStart()).toBe(false); expect(() => b.check()).not.toThrow();
    b.add("customer", 6); expect(() => b.check()).toThrow(BudgetStop);
    expect(() => b.price("claude-unknown", { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 })).toThrow(/NO_PRICE/);
  });
});

describe("report", () => {
  const base = (over: Partial<ConversationResult>): ConversationResult => ({ id: "sim-1", seed: 1, attempt: 0, category: "plain_order", variant: "one_item", lang: "ar", voice: false, burst: false,
    clock: "day", status: "judged", error: null, endReason: "", turns: [], facts: null, failures: [], usd: { concierge: 0, customer: 0, judge: 0, total: 0 }, conciergeCalls: 0, conciergeApiErrors: 0, passed: false,
    verdict: { goal_reached: true, wrong_or_uninvited_product: false, invented_fact: false, rating_praise_health: false, dead_end: false, repeated_question: false, natural_dialect: true, turns_to_card: 1, severity: 1, problems: [], summary: "" }, ...over });
  it("a conversation passes only with no hard failure and the goal reached without harm", () => {
    expect(passes(base({}))).toBe(true);
    expect(passes(base({ failures: [{ code: "no_reply", detail: "", turn: 1, severity: 3 }] }))).toBe(false);
    expect(passes(base({ failures: [{ code: "harness_note", detail: "", turn: 1, severity: 1 }] }))).toBe(true);
    expect(passes(base({ verdict: { ...base({}).verdict!, dead_end: true } }))).toBe(false);
  });
  it("ranks classes by count times severity", () => {
    const rs = [base({ id: "a", failures: [{ code: "message_rules", detail: "", turn: 1, severity: 1 }] }), base({ id: "b", failures: [{ code: "message_rules", detail: "", turn: 1, severity: 1 }] }),
                base({ id: "c", failures: [{ code: "no_reply", detail: "", turn: 1, severity: 3 }] })];
    expect(classes(rs).map((c) => [c.cls, c.score])).toEqual([["no_reply", 3], ["message_rules", 2]]);
    expect(quantile([1, 2, 3, 4, 100], 0.5)).toBe(3);
    expect(scrub("call +961 70 123 456 or 3 kilo")).toBe("call [number] or 3 kilo");
  });
});
