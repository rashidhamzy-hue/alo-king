// Parse once, then the database. The model's reading of a turn goes to plan_order(), which does the catalog search,
// the default-choice rule, the address and the price in one round trip and answers card, ask or handoff.
// A card goes out from here with no further model call. Only "ask" reaches the Concierge's tool loop.
import type { SupabaseClient } from "@supabase/supabase-js";
import { askLocation, buttons } from "@ak/wa/kapso";
import type { OrderIntent } from "./schemas";
import { deliver, issueCard, keepUntilOpen, type CardTerms, type QuoteLineInput, type ToolContext } from "./concierge-tools";
import { FIXED, pinVillageButtonId, type Quote } from "./order-card";
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
  // A part that only names the village («عبعقلين», "3a b3aklin") is not an address: the rider still needs the house (B4: the
  // staging probe's reading put «عبعقلين» in verbatim and the address question was skipped).
  const village = villageForms(a.village);
  return [a.verbatim, a.landmark, a.building, floorWords(a.floor), a.recipient_name]
    .filter((x): x is string => !!x && x.trim() !== "")
    .filter((x) => !village.size || !sameVillage(x, village))
    .filter((x, i, all) => !all.slice(0, i).some((y) => y.includes(x)))      // the verbatim text usually already holds the rest
    .join(" | ") || null;
}

/** The floor as the customer said it, with «طابق» added only to a bare number or word (K1: AK-1008's note said «طابق الطابق الأول»). */
function floorWords(floor: string | null | undefined): string | null {
  const f = floor?.trim();
  if (!f) return null;
  return /طابق|طوابق|floor|étage|etage|tabe2|tab2|tabi2/iu.test(f) ? f : `طابق ${f}`;
}

/** A place name folded for comparison, with and without one clitic people write onto it (ع، ب، ل، و، من، ال; 3a, b, el). */
export function villageForms(x: string | null | undefined): Set<string> {
  if (!x) return new Set();
  const k = x.trim().toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/[ً-ْـ]/g, "")
    .replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
  const out = new Set([k, k.replace(/^(3a|3al|b|bi|fi|la|el|al|men|min) /, ""), k.replace(/^(و|ف)?(من|عال|بال|لل|ع|ب|ل)(?=...)/, ""), k.replace(/^ال(?=...)/, "")]);
  out.delete("");
  return out;
}
const sameVillage = (x: string, village: Set<string>) => [...villageForms(x)].some((f) => village.has(f));

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

  // A village written in the message that the reading left out («عبعقلين» on 13 Nov went to needs_clarification): a hint for
  // pricing and for "do we deliver there" before the pin. The pin still decides (B4).
  if (!intent.address.village && said && intent.fulfilment !== "pickup") {
    const v = await rpc<{ name_ar: string | null; name_en: string } | null>(ctx.db, "village_in_text", { p_text: said }).catch(() => null);
    if (v) intent = { ...intent, address: { ...intent.address, village: v.name_ar ?? v.name_en } };
  }
  const plan = await rpc<Plan>(ctx.db, "plan_order", { p_party: ctx.partyId, p_intent: said ? { ...intent, _message: said.slice(0, 2000) } : intent,
                                                      p_village: ctx.state.villageId ?? null, p_choices: {} });
  if (plan.village_id) ctx.state.villageId = plan.village_id;
  if (plan.place_id) ctx.state.placeId = plan.place_id;
  // A new order's words about where are this order's: the last order's directions never describe a new place (B4: the staging
  // probe's second first-order kept the house of the one before, and the address question was skipped).
  const directions = directionsOf(intent);
  ctx.state.directions = directions;

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
  // D1 (3.8): no price while today's rate waits for a person. Said once, by code; the basket is kept for when it is confirmed.
  if (plan.issues.some((i) => i.code === "fx_paused") && plan.lines.every((l) => l.status === "matched")) {
    if (plan.quote) ctx.state.lastQuote = { lines: plan.quote_lines, villageId: plan.pickup ? null : plan.village_id, pickup: plan.pickup, quote: plan.quote };
    const r = await deliver(ctx, { type: "text", text: { body: FIXED.fxPaused } }, FIXED.fxPaused);
    return r.ok ? { done: true, path: "fx_paused" } : { done: false, plan };
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
  // Every line is known and only "where" is missing (no village yet, or a name that is not a village we know, like «راجح»):
  // the basket waits on the pin, which decides the village. On 13 Nov this went to the model, which asked for the pin itself,
  // and nothing kept the three lines (B4).
  const matched = plan.quote_lines.length > 0 && plan.lines.every((l) => l.status === "matched" || l.status === "merchant_not_onboarded");
  const whereOnly = plan.next === "ask" && !plan.pickup && matched && !plan.village_id &&
    plan.issues.length > 0 && plan.issues.every((i) => WHERE_ISSUES.has(i.code));
  if (whereOnly) {
    const quote = plan.quote ?? await rpc<Quote>(ctx.db, "quote_order", { p_lines: plan.quote_lines, p_village: null, p_pickup: false });
    const routed = await sendBasket(ctx, { lines: plan.quote_lines, villageId: null, placeId: null, pickup: false }, terms, quote, unavailable ?? undefined);
    return routed.done ? routed : { done: false, plan };
  }
  // After closing time, with every line known (K1, B4's leftover): the basket is kept and the customer is told by code when we
  // open, with one button. On staging this went to the model, which asked for the pin "to continue later"; the pin then got a
  // greeting, and the basket was gone by morning.
  const closed = plan.issues.find((i) => i.code === "closed");
  if (closed && matched && plan.quote && plan.issues.every((i) => i.code === "closed" || WHERE_ISSUES.has(i.code))) {
    const kept = await keepUntilOpen(ctx, { lines: plan.quote_lines, villageId: plan.pickup ? null : plan.village_id, placeId: plan.place_id,
                                            pickup: plan.pickup, quote: plan.quote }, terms, String(closed.opens ?? ""), { before: unavailable ?? undefined });
    return kept.ok ? { done: true, path: "closed_kept" } : { done: false, plan };
  }
  // A known basket the loop is about to ask about: keep it, so a pin request or an answer later finds it.
  if (matched && plan.quote) ctx.state.lastQuote = { lines: plan.quote_lines, villageId: plan.pickup ? null : plan.village_id, pickup: plan.pickup, quote: plan.quote };
  if (plan.next !== "card" || !plan.quote?.ok) return { done: false, plan };

  const basket = { lines: plan.quote_lines, villageId: plan.pickup ? null : plan.village_id, placeId: plan.place_id, pickup: plan.pickup };
  const routed = await sendBasket(ctx, basket, terms, plan.quote, unavailable ?? undefined);
  return routed.done ? routed : { done: false, plan };
}

export const WHERE_ISSUES = new Set(["no_delivery_village", "village_not_recognised"]);
const ADDRESS_INTENTS = new Set(["order", "add_to_order", "change_order", "question", "delivery_area", "greeting"]);

/** A basket is waiting on the customer for where to deliver (pin, village tap, house and floor). */
export function waitingForPlace(ctx: ToolContext): boolean {
  const a = ctx.state.awaiting;
  return !!ctx.state.lastQuote && !!ctx.state.pending && (a === "pin" || a === "village" || a === "address");
}

/**
 * The customer answered while a basket waited on where to deliver, with no new items: their words are the address (house,
 * floor, neighbourhood, landmark), kept for the rider. A village in the reading never overrides the pin: «بحي راجح» is a
 * neighbourhood, and on 13 Nov it was read as a village and turned into a question (B4).
 */
export async function takeAddress(ctx: ToolContext, intent: OrderIntent, said: string): Promise<Routed> {
  if (!waitingForPlace(ctx) || intent.lines.length > 0 || !ADDRESS_INTENTS.has(intent.intent)) return { done: false, plan: null };
  if (ctx.state.awaiting === "pin" && !ctx.state.placeId) {
    // Still no pin: keep the words for the rider and ask for the pin again, the basket still waiting.
    ctx.state.directions = mergeDirections(ctx.state.directions, directionsOf(intent) ?? said.trim().slice(0, 300));
    const r = await deliver(ctx, askLocation(FIXED.askPin), `[location request] ${FIXED.askPin}`);
    return r.ok ? { done: true, path: "ask_pin_again" } : { done: false, plan: null };
  }
  const words = directionsOf(intent) ?? (said.trim().slice(0, 300) || null);
  if (words) ctx.state.directions = mergeDirections(ctx.state.directions, words);
  if (ctx.state.placeId && (intent.address.building || intent.address.floor || words))
    await rpc<boolean>(ctx.db, "set_place_details", { p_party: ctx.partyId, p_place: ctx.state.placeId, p_building: intent.address.building ?? null,
                                                      p_floor: intent.address.floor ?? null, p_directions: words });
  // A village typed in answer to "which village is the pin in?": the database checks it is near the pin.
  if (ctx.state.awaiting === "village" && ctx.state.placeId) {
    const v = await rpc<{ village_id: string } | null>(ctx.db, "village_in_text", { p_text: [intent.address.village, said].filter(Boolean).join(" ") }).catch(() => null);
    if (v) await choosePinVillage(ctx, v.village_id);
  }
  return (await completePending(ctx)) ? { done: true, path: "card_after_address" } : { done: false, plan: null };
}

function mergeDirections(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null;
  if (!b || a.includes(b)) return a;
  return b.includes(a) ? b : `${a} | ${b}`;
}

/** Which village is this pin in? Buttons with the nearest villages; the tap decides. False when there is nothing to ask. */
export async function askPinVillage(ctx: ToolContext): Promise<boolean> {
  const pin = ctx.state.pinCheck;
  if (!pin || pin.status !== "unsure" || !pin.candidates.length) return false;
  const r = await deliver(ctx, buttons(FIXED.askVillage, pin.candidates.map((c) => ({ id: pinVillageButtonId(c.village_id), title: c.name_ar ?? c.name_en }))),
                          `[village question] ${pin.candidates.map((c) => c.name_ar ?? c.name_en).join(" / ")}`);
  return r.ok;
}

/** The customer tapped (or typed) the village their pin is in. False when the database refused it (too far from the pin). */
export async function choosePinVillage(ctx: ToolContext, villageId: string): Promise<boolean> {
  if (!ctx.state.placeId) return false;
  const r = await rpc<{ ok: boolean; village_id?: string; village_ar?: string | null; served?: boolean }>(ctx.db, "set_pin_village",
    { p_party: ctx.partyId, p_place: ctx.state.placeId, p_village: villageId });
  if (!r.ok) return false;
  ctx.state.villageId = r.village_id!;
  ctx.state.pinCheck = { status: "located", villageAr: r.village_ar ?? null, served: r.served ?? null, saidAr: null, candidates: [] };
  return true;
}

/** A priced basket goes out as a card, or, for a first delivery to that village, as a pin request with the card waiting on it. */
export async function sendBasket(ctx: ToolContext, basket: { lines: QuoteLineInput[]; villageId: string | null; placeId: string | null; pickup: boolean },
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
  if (kind === "small_talk") {
    // 1.18: chat about the assistant, nothing about an order. The one fixed line, no model (K1: read as a greeting live).
    const r = await deliver(ctx, { type: "text", text: { body: FIXED.offTopic } }, FIXED.offTopic);
    return r.ok ? { done: true, path: "off_topic" } : { done: false };
  }
  return repeatLast(ctx);
}

/** "X is not available yet", in the customer's own words for the shop. Neutral: no reason, no opinion, no promise. */
export function notAvailableText(plan: Pick<Plan, "unavailable">): string | null {
  const said = [...new Set((plan.unavailable ?? []).map((u) => (u.source_hint ?? "").trim()).filter(Boolean))];
  if (!(plan.unavailable ?? []).length) return null;
  return FIXED.notAvailable(said);
}

/**
 * A pin, a village tap, the address or a phone number arrived for a card that was waiting on it: take the next step with no
 * model call. The pin decides the village (B4): a clear pin prices the card for where it is; an unclear one asks the customer
 * to tap the village; a first delivery to a new place asks once for the house and floor. True when something was sent.
 */
export async function completePending(ctx: ToolContext): Promise<boolean> {
  const q = ctx.state.lastQuote, terms = ctx.state.pending;
  if (!ctx.state.awaiting || !q || !terms) return false;
  if (ctx.state.awaiting === "opening") return sendKept(ctx, { pin: true });          // a pin for a basket kept overnight
  if (!q.pickup && ctx.state.awaiting !== "phone") {
    if (!ctx.state.placeId) return false;                                   // still waiting for the pin
    const pin = ctx.state.pinCheck;
    if (!ctx.state.villageId) {
      // The pin is between villages, or near none we know. Ask; never guess, never take the text's village.
      if (pin?.status === "unsure" && pin.candidates.length) { ctx.state.awaiting = "village"; return askPinVillage(ctx); }
      ctx.state.awaiting = "pin";
      const r = await deliver(ctx, askLocation(FIXED.pinOutside), `[location request] ${FIXED.pinOutside}`);
      return r.ok;
    }
    if (pin?.served === false) {
      ctx.state.awaiting = null;
      return (await answerOutOfArea(ctx, pin.villageAr ?? "")).done;
    }
    const note = pin?.saidAr && pin.villageAr ? FIXED.pinVillage(pin.villageAr, pin.saidAr) : undefined;
    if (ctx.state.directions)
      await rpc<boolean>(ctx.db, "set_place_details", { p_party: ctx.partyId, p_place: ctx.state.placeId, p_building: null, p_floor: null, p_directions: ctx.state.directions });
    if (!(await rpc<boolean>(ctx.db, "place_has_details", { p_place: ctx.state.placeId }))) {
      // The rider has a pin and nothing else: one question for the house and the floor. The card waits for the answer.
      ctx.state.awaiting = "address";
      if (pin) pin.saidAr = null;                                           // said once, in this question
      const text = [note ?? FIXED.pinReceived, FIXED.askAddress(pin?.villageAr ?? "")].join("\n");
      const r = await deliver(ctx, { type: "text", text: { body: text } }, text);
      return r.ok;
    }
    ctx.state.pinCheck = null;
    const card = await issueCard(ctx, { lines: q.lines, villageId: ctx.state.villageId, placeId: ctx.state.placeId, pickup: false },
                                 { ...terms, notes: mergeDirections(terms.notes, ctx.state.directions) }, { before: note });
    if (!card.ok) ctx.state.awaiting = null;
    return card.ok;
  }
  if (ctx.state.awaiting === "pin" && !ctx.state.placeId) return false;
  const card = await issueCard(ctx, { lines: q.lines, villageId: q.pickup ? null : ctx.state.villageId ?? q.villageId, placeId: ctx.state.placeId ?? null, pickup: q.pickup },
                               { ...terms, notes: mergeDirections(terms.notes, ctx.state.directions) });
  if (!card.ok) ctx.state.awaiting = null;
  return card.ok;
}

/**
 * The basket kept after closing time (K1) carries on: the customer tapped «ابعت طلبي», or sent a pin. Still closed: said again,
 * by code. Open: the next step of the normal path (pin, village, house and floor, phone, card), re-priced and re-checked by the
 * database. False when nothing is kept or the basket can no longer go as it was (the caller hands it to the Concierge).
 */
export async function sendKept(ctx: ToolContext, opts: { pin?: boolean } = {}): Promise<boolean> {
  const q = ctx.state.lastQuote, terms = ctx.state.pending;
  if (ctx.state.awaiting !== "opening" || !q || !terms) return false;
  const villageId = q.pickup ? null : ctx.state.villageId ?? q.villageId;
  const quote = await rpc<Quote>(ctx.db, "quote_order", { p_lines: q.lines, p_village: villageId, p_pickup: q.pickup });
  const closed = quote.issues.find((i) => i.code === "closed");
  if (closed) return (await keepUntilOpen(ctx, { lines: q.lines, villageId, placeId: ctx.state.placeId ?? null, pickup: q.pickup, quote }, terms,
                                          String(closed.opens ?? ""), { pin: opts.pin })).ok;
  ctx.state.lastQuote = { ...q, villageId, quote };
  if (q.pickup) { ctx.state.awaiting = null; return (await issueCard(ctx, { lines: q.lines, villageId: null, placeId: null, pickup: true }, terms)).ok; }
  ctx.state.awaiting = "pin";
  if (ctx.state.placeId && (await rpc<boolean>(ctx.db, "place_is_locatable", { p_place: ctx.state.placeId }))) return completePending(ctx);
  const r = await deliver(ctx, askLocation(FIXED.askPin), `[location request] ${FIXED.askPin}`);
  return r.ok;
}

async function handoff(ctx: ToolContext, reason: string) {
  await ctx.db.from("conversations").update({ human_handoff: true }).eq("id", ctx.conversationId);
  await ctx.db.from("handoffs").insert({ conversation_id: ctx.conversationId, reason });
  await deliver(ctx, { type: "text", text: { body: FIXED.handoff } }, FIXED.handoff);
}
