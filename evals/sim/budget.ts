// SIM1 budget guard. Every model call is priced from its own usage and the model_prices rows (migrations 0092 and 0102, read from
// the run's database), the same way the agent_run_costs view prices a turn. The running total is printed. No new conversation
// starts above the soft limit (USD 27); at the hard limit (USD 33) every further call is refused before it is made.
import type Anthropic from "@anthropic-ai/sdk";

export interface PriceRow {
  model: string; effective_from: string;
  input_usd_per_mtok: number; output_usd_per_mtok: number;
  long_context_above_tokens: number | null; long_input_usd_per_mtok: number | null; long_output_usd_per_mtok: number | null;
  cache_read_usd_per_mtok: number | null; cache_write_usd_per_mtok: number | null;
}
export interface CallUsage { input: number; output: number; cacheRead: number; cacheWrite: number }

const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
export function normalisePrices(rows: Record<string, unknown>[]): PriceRow[] {
  return rows.map((r) => ({
    model: String(r.model), effective_from: String(r.effective_from instanceof Date ? r.effective_from.toISOString().slice(0, 10) : r.effective_from).slice(0, 10),
    input_usd_per_mtok: Number(r.input_usd_per_mtok), output_usd_per_mtok: Number(r.output_usd_per_mtok),
    long_context_above_tokens: n(r.long_context_above_tokens), long_input_usd_per_mtok: n(r.long_input_usd_per_mtok),
    long_output_usd_per_mtok: n(r.long_output_usd_per_mtok), cache_read_usd_per_mtok: n(r.cache_read_usd_per_mtok), cache_write_usd_per_mtok: n(r.cache_write_usd_per_mtok),
  }));
}

/** The price row in force for a model on a day (the latest effective_from not after it). Null: the model has no price. */
export function priceFor(rows: PriceRow[], model: string, day: string): PriceRow | null {
  return rows.filter((r) => r.model === model && r.effective_from <= day).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0] ?? null;
}

/** USD for one call, as agent_run_costs (0102) computes it: the long-context rate when the whole prompt is above the threshold. */
export function costOf(p: PriceRow, u: CallUsage): number {
  const prompt = u.input + u.cacheRead + u.cacheWrite;
  const long = p.long_context_above_tokens !== null && prompt > p.long_context_above_tokens;
  const inRate = long ? p.long_input_usd_per_mtok ?? p.input_usd_per_mtok : p.input_usd_per_mtok;
  const outRate = long ? p.long_output_usd_per_mtok ?? p.output_usd_per_mtok : p.output_usd_per_mtok;
  const readRate = p.cache_read_usd_per_mtok ?? (long ? p.long_input_usd_per_mtok : null) ?? p.input_usd_per_mtok;
  const writeRate = p.cache_write_usd_per_mtok ?? (long ? p.long_input_usd_per_mtok : null) ?? p.input_usd_per_mtok;
  return (u.input * inRate + u.output * outRate + u.cacheRead * readRate + u.cacheWrite * writeRate) / 1e6;
}

export const usageOf = (m: Pick<Anthropic.Message, "usage">): CallUsage => ({
  input: m.usage?.input_tokens ?? 0, output: m.usage?.output_tokens ?? 0,
  cacheRead: m.usage?.cache_read_input_tokens ?? 0, cacheWrite: m.usage?.cache_creation_input_tokens ?? 0,
});

export class BudgetStop extends Error {
  constructor(spent: number, limit: number) { super(`BUDGET_STOP: spent USD ${spent.toFixed(4)}, hard limit USD ${limit}`); this.name = "BudgetStop"; }
}

export type Role = "concierge" | "customer" | "judge";
export interface CallRecord { role: Role; model: string; usd: number; usage: CallUsage; ms: number; error: string | null }

export class Budget {
  spent = 0;
  calls = 0;
  readonly byRole: Record<Role, { usd: number; calls: number }> = { concierge: { usd: 0, calls: 0 }, customer: { usd: 0, calls: 0 }, judge: { usd: 0, calls: 0 } };
  private lastPrinted = 0;
  constructor(readonly soft: number, readonly hard: number, private prices: PriceRow[], private log: (s: string) => void = (s) => console.log(s),
              private day = new Date().toISOString().slice(0, 10)) {}
  /** May a new conversation start? */
  canStart(): boolean { return this.spent < this.soft; }
  /** Throws before a call when the hard limit is reached. */
  check(): void { if (this.spent >= this.hard) throw new BudgetStop(this.spent, this.hard); }
  price(model: string, u: CallUsage): number {
    const p = priceFor(this.prices, model, this.day);
    if (!p) throw new Error(`NO_PRICE: model_prices has no row for ${model} on ${this.day}; the run refuses to spend without a price`);
    return costOf(p, u);
  }
  add(role: Role, usd: number): void {
    this.spent += usd; this.calls++;
    this.byRole[role].usd += usd; this.byRole[role].calls++;
    if (this.spent - this.lastPrinted >= 0.25) { this.lastPrinted = this.spent; this.log(`[budget] USD ${this.spent.toFixed(3)} after ${this.calls} calls`); }
  }
}

/**
 * The run's limits. With a budget (the workflow's budget_usd input): no new conversation from 85% of it, every call refused at it.
 * Without one: the soft and hard limits given (the workflow's defaults, USD 27 and 33).
 */
export function limitsFor(budgetUsd: string | undefined, soft: number, hard: number): { soft: number; hard: number } {
  if (budgetUsd === undefined || budgetUsd.trim() === "") return { soft, hard };
  const b = Number(budgetUsd);
  if (!Number.isFinite(b) || b <= 0) throw new Error(`budget_usd must be a positive number of dollars, got "${budgetUsd}"`);
  return { soft: Math.round(b * 0.85 * 100) / 100, hard: b };
}
