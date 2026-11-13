// Parse once, then the database. The model's reading of a turn goes to plan_order(), which does the catalog search,
// the default-choice rule, the address and the price in one round trip and answers card, ask or handoff.
// A card goes out from here with no further model call. Only "ask" reaches the Concierge's tool loop.
import type { SupabaseClient } from "@supabase/supabase-js";
import { askLocation } from "@ak/wa/kapso";
import type { OrderIntent } from "./schemas";
import { deliver, issueCard, type CardTerms, type QuoteLineInput, type ToolContext } from "./concierge-tools";
import { FIXED, type Quote } from "./order-card";
import type { QuickIntent } from "./quick-intent";
import { ANSWER, offerRepeat, answerArea, answerHours, answerOutOfArea, answerStatus, repeatLast, type RepeatPlan } from "./answers";
import { answerMemory } from "./memory";

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
export type Routed = { done: true; path: string } | { done: false; plan: (Partial<Plan> & { repeat?: RepeatPlan | null }) | null };

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

/** `said`: the customer's own words of the turn (texts and transcripts). The planner reads them as evidence between tied products (1.22). */
export async function planReading(ctx: ToolContext, intent: OrderIntent | null, said?: string): Promise<Routed> {
  if (!intent) return { done: false, plan: null };
  // Questions the database answers by itself (1.3).
  if (intent.intent === "status") return answerStatus(ctx).then((r) => (r.done ? r : { done: false, plan: null }));
  if (intent.intent === "hours") return answerHours(ctx).then((r) => (r.done ? r : { done: false, plan: null }));
  if (intent.intent === "delivery_area" && intent.address.village)
    return answerArea(ctx, intent.address.village).then((r) => (r.done ? r : { done: false, plan: null }));
  // What we remember is the customer's to see and clear (1.14). Answered by code from the database.
  if (intent.intent === "memory_show") return answerMemory(ctx, "show").then((r) => (r.done ? r : { done: false, plan: null }));
  if (intent.intent === "memory_forget") return answerMemory(ctx, "forget").then((r) => (r.done ? r : { done: false, plan: null }));
  if (intent.intent === "memory_stop") return answerMemory(ctx, "stop").then((r) => (r.done ? r : { done: false, plan: null }));
  if (intent.intent === "memory_start") return answerMemory(ctx, "start").then((r) => (r.done ? r : { done: false, plan: null }));
  // Stay on the job (1.18): Meta bars general-purpose chatbots from the Business Platform. Homework, general questions and
  // long chat get one fixed, friendly line and an offer to help with an order. No second model call, nothing answered.
  if (intent.intent === "off_topic" && intent.lines.length === 0) {
    const r = await deliver(ctx, { type: "text", text: { body: FIXED.offTopic } }, FIXED.offTopic);
    return r.ok ? { done: true, path: "off_topic" } : { done: false, plan: null };
  }
  if (intent.intent === "greeting" && intent.lines.length === 0)
    return offerRepeat(ctx).then((r) => (r.done ? r : { done: false, plan: null }));
  if (intent.intent !== "order") return { done: false, plan: null };
  if (intent.repeat_last && intent.lines.length === 0) {
    const r = await repeatLast(ctx);
    return r.done ? r : { done: false, plan: { repeat: r.repeat ?? null } };
  }
  if (intent.lines.length === 0) return offerRepeat(ctx).then((r) => (r.done ? r : { done: false, plan: null }));   // "I want to order"

  const plan = await rpc<Plan>(ctx.db, "plan_order", { p_party: ctx.partyId, p_intent: said ? { ...intent, _message: said.slice(0, 2000) } : intent,
                                                      p_village: ctx.state.villageId ?? null, p_choices: {} });
  if (plan.village_id) ctx.state.villageId = plan.village_id;
  if (plan.place_id) ctx.state.placeId = plan.place_id;
  const directions = directionsOf(intent);
  if (directions) ctx.state.directions = directions;

  // A village we know and do not serve: the order cannot go anywhere, so say so and list where we do deliver.
  const away = plan.pickup ? undefined : plan.issues.find((i) => i.code === "village_not_served");
  if (away) {
    const r = await answerOutOfArea(ctx, String(away.village_ar ?? away.said ?? intent.address.village ?? ""));
    if (r.done) return r;
  }
  const unavailable = notAvailableText(plan);
  if (plan.next === "not_available") {
    const r = await deliver(ctx, { type: "text", text: { body: unavailable! } }, unavailable!);
    return r.ok ? { done: true, path: "not_available" } : { done: false, plan };
  }
  if (plan.next === "handoff") {
    await handoff(ctx, plan.handoff_reason ?? "plan_handoff");
    return { done: true, path: "handoff" };
  }
  const terms: CardTerms = { payment: plan.payment_method, changeForUsd: plan.change_for_usd ?? null, notes: directions };
  if (intent.repeat_last) {
    // "Same as last time, and add bread": the last basket, re-checked, plus the new lines, priced together.
    // Only when every new line was matched; anything unclear goes to the loop with both in hand.
    if (!plan.lines.every((l) => l.status === "matched" || l.status === "merchant_not_onboarded")) return { done: false, plan };
    const r = await rpc<RepeatPlan>(ctx.db, "repeat_plan", { p_party: ctx.partyId, p_order: null });
    if (!r.found || !r.lines?.length) return { done: false, plan: { ...plan, repeat: r } };
    const pickup = !!plan.pickup;
    const basket = { lines: [...r.lines, ...plan.quote_lines], pickup, placeId: plan.place_id ?? r.place_id ?? null,
                     villageId: pickup ? null : plan.village_id ?? r.village_id ?? null };
    if (basket.villageId) ctx.state.villageId = basket.villageId;
    if (basket.placeId) ctx.state.placeId = basket.placeId;
    const quote = await rpc<Quote>(ctx.db, "quote_order", { p_lines: basket.lines, p_village: basket.villageId, p_pickup: pickup });
    if (!quote.ok) return { done: false, plan: { ...plan, repeat: r } };
    const missing = (r.missing ?? []).map((m) => m.name_ar ?? m.name);
    const before = [unavailable, missing.length ? ANSWER.someMissing(missing) : null].filter(Boolean).join("\n") || undefined;
    const routed = await sendBasket(ctx, basket, terms, quote, before);
    return routed.done ? routed : { done: false, plan: { ...plan, repeat: r } };
  }
  if (plan.next !== "card" || !plan.quote?.ok) return { done: false, plan };

  const basket = { lines: plan.quote_lines, villageId: plan.pickup ? null : plan.village_id, placeId: plan.place_id, pickup: plan.pickup };
  const routed = await sendBasket(ctx, basket, terms, plan.quote, unavailable ?? undefined);
  return routed.done ? routed : { done: false, plan };
}

/** A priced basket goes out as a card, or, for a first delivery to that village, as a pin request with the card waiting on it. */
async function sendBasket(ctx: ToolContext, basket: { lines: QuoteLineInput[]; villageId: string | null; placeId: string | null; pickup: boolean },
                          terms: CardTerms, quote: Quote, before?: string): Promise<{ done: true; path: string } | { done: false }> {
  const pinned = basket.placeId && (await rpc<boolean>(ctx.db, "place_is_locatable", { p_place: basket.placeId }));
  if (!basket.pickup && !pinned) {
    // The rider needs a pin. The card waits for it; nothing is asked of the model.
    ctx.state.lastQuote = { lines: basket.lines, villageId: basket.villageId, pickup: false, quote };
    ctx.state.awaiting = "pin"; ctx.state.pending = terms;
    const text = before ? `${before}\n${FIXED.askPin}` : FIXED.askPin;
    const r = await deliver(ctx, askLocation(text), `[location request] ${text}`);
    return r.ok ? { done: true, path: "ask_pin" } : { done: false };
  }
  const card = await issueCard(ctx, basket, terms, { before });
  return card.ok ? { done: true, path: card.waiting_for ? "ask_phone" : "card" } : { done: false };
}

/** The three questions recognised without a model (quick-intent.ts). */
export async function answerQuick(ctx: ToolContext, kind: QuickIntent): Promise<{ done: true; path: string } | { done: false }> {
  if (kind === "status") return answerStatus(ctx);
  if (kind === "hours") return answerHours(ctx);
  if (kind === "greeting") return offerRepeat(ctx);
  return repeatLast(ctx);
}

/** "X is not available yet", in the customer's own words for the shop. Neutral: no reason, no opinion, no promise. */
export function notAvailableText(plan: Pick<Plan, "unavailable">): string | null {
  const said = [...new Set((plan.unavailable ?? []).map((u) => (u.source_hint ?? "").trim()).filter(Boolean))];
  if (!(plan.unavailable ?? []).length) return null;
  return FIXED.notAvailable(said);
}

/** A pin or a phone number arrived for a card that was waiting on it: send the card, re-priced by the database, with no model call. */
export async function completePending(ctx: ToolContext): Promise<boolean> {
  const q = ctx.state.lastQuote, terms = ctx.state.pending;
  if (!ctx.state.awaiting || !q || !terms) return false;
  if (ctx.state.awaiting === "pin" && !ctx.state.placeId) return false;
  // The pin decides the village: if it landed somewhere else, the card is priced for where it landed.
  const card = await issueCard(ctx, { lines: q.lines, villageId: q.pickup ? null : ctx.state.villageId ?? q.villageId, placeId: ctx.state.placeId ?? null, pickup: q.pickup }, terms);
  if (!card.ok) ctx.state.awaiting = null;
  return card.ok;
}

async function handoff(ctx: ToolContext, reason: string) {
  await ctx.db.from("conversations").update({ human_handoff: true }).eq("id", ctx.conversationId);
  await ctx.db.from("handoffs").insert({ conversation_id: ctx.conversationId, reason });
  await deliver(ctx, { type: "text", text: { body: FIXED.handoff } }, FIXED.handoff);
}
