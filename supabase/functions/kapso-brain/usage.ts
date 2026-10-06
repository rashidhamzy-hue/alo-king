// Pure helpers for AI cost control: usage pricing, guard decisions, prompt-cache request shapes. No I/O, no message content.

// USD per million tokens (Anthropic first-party list prices, cached 2026-09-25). Cache read = 0.1x input, 5-minute cache write = 1.25x input.
type Price = { input: number; output: number };
const PRICES: Record<string, Price> = {
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-opus-5-5": { input: 4, output: 20 },
};
const DEAREST: Price = { input: 5, output: 25 }; // unknown model: never under-count
const priceFor = (model: string): Price => {
  const id = String(model ?? "");
  const hit = Object.keys(PRICES).find((k) => id === k || id.startsWith(`${k}-2`)); // dated snapshots, e.g. claude-haiku-4-5-20251001
  return hit ? PRICES[hit] : DEAREST;
};

export type Usage = { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : 0; };

/** Estimated USD for one API response. `input_tokens` is the uncached remainder, as the API reports it. */
export function estimateUsd(model: string, u: Usage): number {
  const p = priceFor(model);
  return (n(u.input_tokens) * p.input + n(u.output_tokens) * p.output + n(u.cache_read_input_tokens) * p.input * 0.1 + n(u.cache_creation_input_tokens) * p.input * 1.25) / 1_000_000;
}

export const parseBudget = (v: string | undefined | null): number => { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : 5; };
export const parseCap = (v: string | undefined | null): number => { const x = Math.floor(Number(v)); return Number.isFinite(x) && x > 0 ? x : 60; }; // ~25 chat turns an hour (a turn is 1-3 model calls)

/** "YYYY-MM-DD" in Asia/Beirut: the budget day. */
export const beirutDay = (d = new Date()): string => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Beirut", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

export type Guard = "ok" | "phone_cap" | "budget";
export function decideGuard(o: { phoneCalls: number; cap: number; spentToday: number; budget: number }): Guard {
  if (o.spentToday >= o.budget) return "budget";
  if (o.phoneCalls >= o.cap) return "phone_cap";
  return "ok";
}

export const budgetAlertText = (spent: number, budget: number) =>
  `⚠️ Alo King AI budget reached: $${spent.toFixed(2)} of $${budget.toFixed(2)} today (Asia/Beirut). The customer bot is in button-only mode until tomorrow. Raise DAILY_AI_BUDGET_USD in Supabase secrets to resume now.`;

// ---- prompt caching (render order is tools -> system -> messages; the static prefix goes first, volatile text after the breakpoint) ----
const EPHEMERAL = { type: "ephemeral" } as const;
export const cachedSystem = (staticText: string, dynamicText: string) => [
  { type: "text", text: staticText, cache_control: EPHEMERAL },
  ...(dynamicText ? [{ type: "text", text: dynamicText }] : []),
];
export function cachedTools<T extends object>(tools: T[]): (T | (T & { cache_control: typeof EPHEMERAL }))[] {
  return tools.map((t, i) => (i === tools.length - 1 ? { ...t, cache_control: EPHEMERAL } : t));
}

// ---- staging-only plumbing guards ----
/** True only when the FIRST path segment (after an optional /functions/v1 prefix) is the staging function: a sub-path of the production function such as /kapso-brain/kapso-brain-test never counts. */
export const isStagingPath = (pathname: string): boolean => {
  const seg = String(pathname ?? "").split("/").filter(Boolean);
  if (seg[0] === "functions" && seg[1] === "v1") seg.splice(0, 2);
  return seg[0] === "kapso-brain-test";
};
/** A staging budget override can only tighten the daily budget, never raise it. */
export const tightenBudget = (requested: number, daily: number): number | undefined => (Number.isFinite(requested) && requested > 0 ? Math.min(requested, daily) : undefined);
/** Test phones only: 961700000 + 3 to 6 more digits (12-15 digits, so never a real 11-digit Lebanese number). */
export const isTestPhone = (p: string): boolean => /^961700000\d{3,6}$/.test(String(p ?? ""));
