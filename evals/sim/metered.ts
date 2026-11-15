// SIM1: every model call of the run goes through here. It refuses a call at the hard budget limit, prices the call from its usage,
// counts it against the conversation that made it, and (for the Concierge) keeps what the model wrote with the reply and
// ask_location_pin tools and every amount the tools had returned before, so the checks can tell a quoted price from an invented one.
import type Anthropic from "@anthropic-ai/sdk";
import type { ModelClient } from "../../packages/agents/src/concierge";
import { usageOf, type Budget, type CallRecord, type Role } from "./budget";

export interface ModelText { tool: string; text: string; amounts_in_context: string[] }
export interface Meter {
  calls: CallRecord[];
  /** Concierge only: the text of each reply / ask_location_pin call, with the amounts present in the request's messages. */
  modelTexts: ModelText[];
}
export const newMeter = (): Meter => ({ calls: [], modelTexts: [] });

/** Amounts of money written in a text: $3, 3.50 USD, 250,000 LBP, 250000 ل.ل, 3 dollars, 3 دولار, 5 lira. Numbers only, normalised. */
export function amountsIn(text: string): string[] {
  const out: string[] = [];
  const re = /(?:\$|US\$|USD)\s?(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s?(?:\$|USD|usd|dollars?|dollar|دولار|دولارات|LBP|L\.L\.?|ل\.ل|ليرة|ليرات|lira|liras|livres?|euros?)/gu;
  for (const m of text.matchAll(re)) {
    const raw = (m[1] ?? m[2] ?? "").replace(/,/g, "");
    if (raw) out.push(String(Number(raw)));
  }
  return out;
}
/** Every number in a text (normalised), for "did a tool or the customer say it". */
export function numbersIn(text: string): Set<string> {
  return new Set([...text.replace(/(\d),(\d{3})/g, "$1$2").matchAll(/\d+(?:\.\d+)?/g)].map((m) => String(Number(m[0]))));
}

export function metered(raw: ModelClient, opts: { role: Role; budget: Budget; meter: Meter }): ModelClient {
  return { messages: { create: async (body) => {
    opts.budget.check();
    const started = Date.now();
    let res: Anthropic.Message;
    try { res = await raw.messages.create(body); }
    catch (e) {
      const err = e as { status?: number; message?: string };
      opts.meter.calls.push({ role: opts.role, model: body.model, usd: 0, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, ms: Date.now() - started,
                              error: `${err.status ?? "error"}: ${String(err.message ?? e).slice(0, 160)}` });
      throw e;
    }
    const usage = usageOf(res);
    const usd = opts.budget.price(body.model, usage);
    opts.budget.add(opts.role, usd);
    opts.meter.calls.push({ role: opts.role, model: body.model, usd, usage, ms: Date.now() - started, error: null });
    if (opts.role === "concierge") {
      const context = JSON.stringify(body.messages);
      for (const b of res.content) {
        if (b.type !== "tool_use" || (b.name !== "reply" && b.name !== "ask_location_pin")) continue;
        const text = (b.input as { text?: unknown }).text;
        if (typeof text === "string") opts.meter.modelTexts.push({ tool: b.name, text, amounts_in_context: [...numbersIn(context)] });
      }
    }
    return res;
  } } };
}
