// Parse once, then the database. The model's reading of a turn goes to plan_order(), which does the catalog search,
// the default-choice rule, the address and the price in one round trip and answers card, ask or handoff.
// A card goes out from here with no further model call. Only "ask" reaches the Concierge's tool loop.
import type { SupabaseClient } from "@supabase/supabase-js";
import { askLocation } from "@ak/wa/kapso";
import type { OrderIntent } from "./schemas";
import { deliver, issueCard, type CardTerms, type QuoteLineInput, type ToolContext } from "./concierge-tools";
import { FIXED, type Quote } from "./order-card";

export interface PlanLine {
  idx: number; raw: string; query: string; qty: number; assumed: boolean;
  status: "matched" | "ambiguous" | "not_found" | "merchant_not_onboarded";
  chosen: { product_id: string; name: string; name_ar: string | null; brand: string | null; price_usd: number; in_stock: boolean } | null;
  candidates: { product_id: string; name: string; name_ar: string | null; price_usd: number; in_stock: boolean }[] | null;
}
export interface Plan {
  next: "card" | "ask" | "handoff" | "not_available"; handoff_reason: string | null;
  /** Lines for a restaurant that has not been approved (build plan 1.2). Never phoned in, never handed off as an order. */
  unavailable?: { idx: number; raw: string; source_hint: string | null }[];
  lines: PlanLine[]; quote_lines: QuoteLineInput[]; quote: Quote | null; issues: { code: string; [k: string]: unknown }[];
  village_id: string | null; place_id: string | null; pickup: boolean; needs_pin: boolean;
  payment_method: "cod" | "whish" | "omt"; prepay_required: boolean; dues_usd: number; change_for_usd: number | null;
}
/** done: the turn is answered. Otherwise the loop runs, with the plan when there is one. */
export type Routed = { done: true; path: string } | { done: false; plan: Plan | null };

async function rpc<T>(db: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

/** The customer's own words about where they are, kept verbatim for the rider. */
export function directionsOf(intent: OrderIntent): string | null {
  const a = intent.address;
  return [a.verbatim, a.landmark, a.building, a.floor ? `طابق ${a.floor}` : null, a.recipient_name]
    .filter((x): x is string => !!x && x.trim() !== "")
    .filter((x, i, all) => !all.slice(0, i).some((y) => y.includes(x)))      // the verbatim text usually already holds the rest
    .join(" | ") || null;
}

export async function planReading(ctx: ToolContext, intent: OrderIntent | null): Promise<Routed> {
  if (!intent || intent.intent !== "order" || intent.lines.length === 0) return { done: false, plan: null };

  const plan = await rpc<Plan>(ctx.db, "plan_order", { p_party: ctx.partyId, p_intent: intent, p_village: ctx.state.villageId ?? null, p_choices: {} });
  if (plan.village_id) ctx.state.villageId = plan.village_id;
  if (plan.place_id) ctx.state.placeId = plan.place_id;
  const directions = directionsOf(intent);
  if (directions) ctx.state.directions = directions;

  const unavailable = notAvailableText(plan);
  if (plan.next === "not_available") {
    const r = await deliver(ctx, { type: "text", text: { body: unavailable! } }, unavailable!);
    return r.ok ? { done: true, path: "not_available" } : { done: false, plan };
  }
  if (plan.next === "handoff") {
    await handoff(ctx, plan.handoff_reason ?? "plan_handoff");
    return { done: true, path: "handoff" };
  }
  if (plan.next !== "card" || !plan.quote?.ok) return { done: false, plan };

  const basket = { lines: plan.quote_lines, villageId: plan.pickup ? null : plan.village_id, placeId: plan.place_id, pickup: plan.pickup };
  const terms: CardTerms = { payment: plan.payment_method, changeForUsd: plan.change_for_usd ?? null, notes: directions };
  if (!plan.pickup && (plan.needs_pin || !plan.place_id)) {
    // First delivery to this village: the rider needs a pin. The card waits for it; nothing is asked of the model.
    ctx.state.lastQuote = { lines: basket.lines, villageId: basket.villageId, pickup: false, quote: plan.quote };
    ctx.state.awaiting = "pin"; ctx.state.pending = terms;
    const text = unavailable ? `${unavailable}\n${FIXED.askPin}` : FIXED.askPin;
    const r = await deliver(ctx, askLocation(text), `[location request] ${text}`);
    return r.ok ? { done: true, path: "ask_pin" } : { done: false, plan };
  }
  const card = await issueCard(ctx, basket, terms, { before: unavailable ?? undefined });
  return card.ok ? { done: true, path: "card" } : { done: false, plan };
}

/** "X is not available yet", in the customer's own words for the shop. Neutral: no reason, no opinion, no promise. */
export function notAvailableText(plan: Pick<Plan, "unavailable">): string | null {
  const said = [...new Set((plan.unavailable ?? []).map((u) => (u.source_hint ?? "").trim()).filter(Boolean))];
  if (!(plan.unavailable ?? []).length) return null;
  return FIXED.notAvailable(said);
}

/** A pin arrived for a card that was waiting on it: send the card, re-priced by the database, with no model call. */
export async function completeAfterPin(ctx: ToolContext): Promise<boolean> {
  const q = ctx.state.lastQuote, terms = ctx.state.pending;
  if (ctx.state.awaiting !== "pin" || !q || !terms || !ctx.state.placeId) return false;
  const card = await issueCard(ctx, { lines: q.lines, villageId: q.villageId, placeId: ctx.state.placeId, pickup: q.pickup }, terms);
  if (!card.ok) ctx.state.awaiting = null;
  return card.ok;
}

async function handoff(ctx: ToolContext, reason: string) {
  await ctx.db.from("conversations").update({ human_handoff: true }).eq("id", ctx.conversationId);
  await ctx.db.from("handoffs").insert({ conversation_id: ctx.conversationId, reason });
  await deliver(ctx, { type: "text", text: { body: FIXED.handoff } }, FIXED.handoff);
}
