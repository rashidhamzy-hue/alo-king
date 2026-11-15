// Parse once, then the database. The model's reading of a turn goes to plan_order(), which does the catalog search,
// the default-choice rule, the address and the price in one round trip and answers card, ask or handoff.
// A card goes out from here with no further model call. Only "ask" reaches the Concierge's tool loop.
import type { SupabaseClient } from "@supabase/supabase-js";
import { askLocation, buttons } from "@ak/wa/kapso";
import type { OrderIntent } from "./schemas";
import { deliver, issueCard, keepUntilOpen, type CardTerms, type QuoteLineInput, type ToolContext } from "./concierge-tools";
import { formatWindowChoice, pinVillageButtonId, type DeliveryWindow, type Quote } from "./order-card";
import { messages, productName, villageName } from "./messages";
import { cardInHand, cardWhen, pickWindow, readWhen, resendCard, schedules, windowsFor, type When } from "./windows";
import type { QuickIntent } from "./quick-intent";
import { offerRepeat, answerArea, answerHours, answerLira, answerOutOfArea, answerStatus, repeatLast, type RepeatPlan } from "./answers";
import { answerMemory } from "./memory";
import { handoffToCase, remindCase, supportMessage } from "./support";
import { applyEdits, ASKS_MINIMUM, askMinimum, changeRows, clearBasket, editsFromPlan, heldLines, minimumGap, namesOf, underMinimumOnly } from "./basket";

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
/** Every fixed message in this conversation's language (M1). */
const T = (ctx: ToolContext) => messages(ctx.state.lang);

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
  // Questions the database answers by itself (1.3). B1a: never "no open order" while a basket is in hand (answerStatusOrBasket).
  if (intent.intent === "status") return answerStatusOrBasket(ctx).then((r) => (r.done ? r : { done: false, plan: null }));
  // B1a (SIM1 fix 1): "what is the minimum?" is answered by code with the amount: the basket's gap when there is one.
  if (intent.lines.length === 0 && ASKS_MINIMUM.test(said ?? "")) {
    const r = heldLines(ctx) ? await resumeBasket(ctx) : await answerMinimum(ctx);
    if (r.done) return r;
  }
  // B1a: "cancel" or "I don't want it" with no order yet: the basket is let go, by code. (A card or an order is the card's buttons.)
  if (intent.intent === "cancel" && intent.lines.length === 0 && heldLines(ctx)) {
    return (await clearBasket(ctx)) ? { done: true, path: "basket_cleared" } : { done: false, plan: null };
  }
  // B1a: the basket waits on the minimum and nothing new was said: the minimum, the basket and the gap again, from a fresh quote.
  if (ctx.state.awaiting === "minimum" && intent.lines.length === 0 && MINIMUM_AGAIN.has(intent.intent) && !intent.repeat_last) {
    const r = await resumeBasket(ctx);
    if (r.done) return r;
  }
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
    const r = await deliver(ctx, { type: "text", text: { body: T(ctx).fixed.offTopic } }, T(ctx).fixed.offTopic);
    return r.ok ? { done: true, path: "off_topic" } : { done: false, plan: null };
  }
  // W1: a time said with no new item ("بكرا الصبح", "can you bring it friday afternoon?") is for what is in hand: the card waiting
  // on the tap, the basket waiting on us, or the order being changed.
  const when = whenIn(said);
  if (when && intent.lines.length === 0 && WHEN_INTENTS.has(intent.intent)) {
    const r = await answerWhen(ctx, when);
    if (r.done) return r;
  }
  // W1: a time chosen earlier belongs to the basket it was chosen for; a new basket said without one goes now.
  if (!when && intent.intent === "order" && !ctx.state.replacing && (intent.lines.length > 0 || intent.repeat_last)) ctx.state.slotId = null;
  if (intent.intent === "greeting" && intent.lines.length === 0)
    return offerRepeat(ctx).then((r) => (r.done ? r : { done: false, plan: null }));
  // "Go ahead" with no new items while a basket waits on us (SP1): code carries it on, with no second model call. On 14 Nov
  // «مشيلي الطلب», sent after opening for the basket kept overnight, was read as an order with no lines, went to the loop, and
  // the loop handed it to a person. The pin, village and address waits are answered before this (turn.ts, takeAddress).
  if (isGoAhead(intent, said ?? "")) {
    const r = await goAhead(ctx);
    if (r.done) return r;
  }
  // W1 (2.8 d): while an order is being changed, "add" and "change" with items are the replacement's basket, planned like an order.
  const changing = !!ctx.state.replacing && intent.lines.length > 0 && (intent.intent === "add_to_order" || intent.intent === "change_order");
  // B1a (SIM1 fixes 3 and 4): with a basket in hand, or a card waiting on the tap, the items said are edits to it: added, re-counted
  // or taken off, never a new basket that forgets what came before.
  const held = !changing && !intent.repeat_last && intent.lines.length > 0 && EDIT_INTENTS.has(intent.intent) ? await heldBasket(ctx) : null;
  if (intent.intent !== "order" && !changing && !held) return { done: false, plan: null };
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
  // B1a: a line that takes an item off is planned by its name alone: «بلا خبز» is not an item to the planner, and it would drop it.
  const planned = held ? { ...intent, lines: intent.lines.map((l) => ((l as { change?: string | null }).change === "remove" ? { ...l, raw: l.query } : l)) } : intent;
  const plan = await rpc<Plan>(ctx.db, "plan_order", { p_party: ctx.partyId, p_intent: said ? { ...planned, _message: said.slice(0, 2000) } : planned,
                                                      p_village: ctx.state.villageId ?? null, p_choices: {} });
  if (plan.village_id) ctx.state.villageId = plan.village_id;
  if (plan.place_id) ctx.state.placeId = plan.place_id;
  // A new order's words about where are this order's: the last order's directions never describe a new place (B4: the staging
  // probe's second first-order kept the house of the one before, and the address question was skipped). B1a: an edit to the basket
  // in hand keeps the words already said for it.
  const said_directions = directionsOf(intent);
  const directions = held ? mergeDirections(held.terms?.notes ?? ctx.state.directions, said_directions) : said_directions;
  ctx.state.directions = held ? mergeDirections(ctx.state.directions, said_directions) : said_directions;

  // A village we know and do not serve: the order cannot go anywhere, so say so and list where we do deliver.
  const away = plan.pickup ? undefined : plan.issues.find((i) => i.code === "village_not_served");
  if (away) {
    const r = await answerOutOfArea(ctx, String(away.village_ar ?? away.said ?? intent.address.village ?? ""));
    if (r.done) return r;
  }
  const unavailable = notAvailableText(plan, ctx.state.lang);
  if (plan.next === "not_available") {
    const r = await deliver(ctx, { type: "text", text: { body: unavailable! } }, unavailable!);
    return r.ok ? { done: true, path: "not_available" } : { done: false, plan };
  }
  if (plan.next === "handoff") {
    await handoff(ctx, plan.handoff_reason ?? "plan_handoff");
    return { done: true, path: "handoff" };
  }
  // B1a: the edits to the basket in hand. What is resolved is applied and kept; a line that needs a question goes to the loop with
  // the basket. The rest of this function then routes the whole basket as it would a new one, the changes said before the card.
  let changed: string | undefined;
  let heldTerms: CardTerms | null = null;
  if (held) {
    // A line that names an item already in the basket ("add 2 more", "make it 3", "no bread"): the catalogue search for its words,
    // so «خبز» finds the bread in the basket even when the planner's own choice is another bread.
    const hints = new Map<number, string[]>();
    for (const [idx, l] of intent.lines.entries()) {
      if (!(l as { change?: string | null }).change) continue;
      const r = await rpc<{ matches: { product_id: string }[] }>(ctx.db, "search_catalog", { p_query: l.query, p_source_hint: null, p_limit: 12 }).catch(() => null);
      if (r?.matches?.length) hints.set(idx, r.matches.map((m) => String(m.product_id)));
    }
    const { edits, unresolved } = editsFromPlan(intent, plan, held.lines, held.quote, hints);
    const merged = applyEdits(held.lines, edits);
    const pickup = intent.fulfilment === "unknown" ? held.pickup : plan.pickup;
    const villageId = pickup ? null : plan.village_id ?? held.villageId ?? ctx.state.villageId ?? null;
    const placeId = pickup ? null : held.placeId ?? plan.place_id ?? ctx.state.placeId ?? null;
    if (held.slotId !== undefined && ctx.state.slotId == null) ctx.state.slotId = held.slotId;
    heldTerms = held.terms;
    if (!merged.lines.length) return (await clearBasket(ctx)) ? { done: true, path: "basket_cleared" } : { done: false, plan };
    const quote = await rpc<Quote>(ctx.db, "quote_order", { p_lines: merged.lines, p_village: villageId, p_pickup: pickup });
    ctx.state.lastQuote = { lines: merged.lines, villageId, pickup, quote };
    ctx.state.basketAt = Date.now();
    if (placeId) ctx.state.placeId = placeId;
    if (villageId) ctx.state.villageId = villageId;
    if (held.draft && !ctx.state.pending) ctx.state.pending = held.terms;
    if (unresolved.length) return { done: false, plan: { ...plan, quote, quote_lines: merged.lines } };
    if (merged.changes.length && held.draft) changed = T(ctx).basket.changed(changeRows(merged.changes, namesOf(quote, held.quote), ctx.state.lang ?? "ar"));
    const other = plan.issues.filter((i) => !QUOTE_ISSUES.has(i.code) && !i.code.startsWith("slot_"));
    plan.lines = plan.lines.map((l) => (l.status === "merchant_not_onboarded" ? l : { ...l, status: "matched" as const }));
    Object.assign(plan, { quote_lines: merged.lines, quote, issues: [...quote.issues, ...other], next: quote.ok ? "card" : "ask",
                          village_id: villageId, place_id: placeId, pickup });
  }
  // D1 (3.8): no price while today's rate waits for a person. Said once, by code; the basket is kept for when it is confirmed.
  if (plan.issues.some((i) => i.code === "fx_paused") && plan.lines.every((l) => l.status === "matched")) {
    if (plan.quote) ctx.state.lastQuote = { lines: plan.quote_lines, villageId: plan.pickup ? null : plan.village_id, pickup: plan.pickup, quote: plan.quote };
    const r = await deliver(ctx, { type: "text", text: { body: T(ctx).fixed.fxPaused } }, T(ctx).fixed.fxPaused);
    return r.ok ? { done: true, path: "fx_paused" } : { done: false, plan };
  }
  const terms: CardTerms = heldTerms ? { ...heldTerms, notes: directions, ...(plan.change_for_usd != null ? { changeForUsd: plan.change_for_usd } : {}) }
    : { payment: plan.payment_method, changeForUsd: plan.change_for_usd ?? null, notes: directions };
  const matched = plan.quote_lines.length > 0 && plan.lines.every((l) => l.status === "matched" || l.status === "merchant_not_onboarded");
  // What goes before the card: a shop not on Alo King yet, and what changed in the basket.
  const before = [unavailable, changed].filter(Boolean).join("\n") || undefined;
  // B1a (SIM1 fix 1): a complete basket under the minimum. Said by code with the minimum, the basket and the gap, and one-tap ways
  // to reach it; the basket is kept and the next items are added to it. Before any question about where or when.
  // A question in the same message (a stated restriction, a food fact asked, something unclear) is answered first, by the loop; the
  // minimum follows when the basket goes (issueCard). The B1a run on main put the minimum before a gluten question.
  const asks = intent.restrictions.length > 0 || intent.needs_clarification.length > 0;
  if (matched && plan.quote && underMinimumOnly(plan.quote) && !ctx.state.replacing && !intent.repeat_last && !asks) {
    const basket = { lines: plan.quote_lines, villageId: plan.pickup ? null : plan.village_id, placeId: plan.place_id, pickup: plan.pickup };
    return (await askMinimum(ctx, basket, terms, plan.quote, before)) ? { done: true, path: "minimum" } : { done: false, plan };
  }
  // W1 (2.8 d, C3's request 4): after "edit" on a confirmed scheduled order, the next basket is its replacement: a new card for the
  // same window (or the one said now), linked to the old order. "Add" keeps the old lines; anything else is the whole new basket.
  if (ctx.state.replacing && matched && !plan.pickup) {
    const old = ctx.state.replacing;
    const b = await rpc<{ found: boolean; lines?: QuoteLineInput[]; village_id?: string | null; place_id?: string | null }>(ctx.db, "basket_from_order",
      { p_party: ctx.partyId, p_order: old.orderId });
    const lines = intent.intent === "add_to_order" && b.found ? [...(b.lines ?? []), ...plan.quote_lines] : plan.quote_lines;
    const basket = { lines, villageId: plan.village_id ?? b.village_id ?? null, placeId: plan.place_id ?? b.place_id ?? null, pickup: false };
    const quote = await rpc<Quote>(ctx.db, "quote_order", { p_lines: lines, p_village: basket.villageId, p_pickup: false, p_slot: ctx.state.slotId ?? old.slotId });
    const routed = when ? await basketWhen(ctx, basket, terms, quote, when, { before: before })
                        : await sendBasket(ctx, basket, terms, quote, before);
    return routed.done ? routed : { done: false, plan };
  }
  // W1 (C3's request 1): an order said with its time («بدي خبز بكرا الصبح») goes for that window: after hours too, and with fresh
  // goods that are bought for the order (quote_order with a slot, 0118).
  const basketNow = { lines: plan.quote_lines, villageId: plan.pickup ? null : plan.village_id, placeId: plan.place_id, pickup: plan.pickup };
  if (when && matched && plan.quote && !plan.pickup && plan.issues.every(schedulable)) {
    const routed = await basketWhen(ctx, basketNow, terms, plan.quote, when, { before: before });
    if (routed.done) return routed;
  }
  // W1 ("the plan asks when"): only fresh goods are short now, and they are bought for the order: offer the windows.
  const short = plan.issues.filter((i) => i.code === "out_of_stock" || i.code === "insufficient_stock");
  if (!when && matched && plan.quote && !plan.pickup && short.length > 0 && short.every((i) => i.bought_to_order === true) && plan.issues.every(schedulable)) {
    const names = plan.lines.filter((l) => short.some((i) => i.product_id === l.chosen?.product_id)).map((l) => (l.chosen ? productName(l.chosen, ctx.state.lang ?? "ar") : l.raw));
    const routed = await basketWhen(ctx, basketNow, terms, plan.quote, { any: true },
                                    { before: before, body: T(ctx).windows.freshForWindow(names), orNow: false });
    if (routed.done) return routed;
  }
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
    const missing = (r.missing ?? []).map((m) => productName(m, ctx.state.lang ?? "ar"));
    const before = [unavailable, missing.length ? T(ctx).answer.someMissing(missing) : null].filter(Boolean).join("\n") || undefined;
    const routed = await sendBasket(ctx, basket, terms, quote, before);
    return routed.done ? routed : { done: false, plan: { ...plan, repeat: r } };
  }
  // Every line is known and only "where" is missing (no village yet, or a name that is not a village we know, like «راجح»):
  // the basket waits on the pin, which decides the village. On 13 Nov this went to the model, which asked for the pin itself,
  // and nothing kept the three lines (B4).
  const whereOnly = plan.next === "ask" && !plan.pickup && matched && !plan.village_id &&
    plan.issues.length > 0 && plan.issues.every((i) => WHERE_ISSUES.has(i.code));
  if (whereOnly) {
    const quote = plan.quote ?? await rpc<Quote>(ctx.db, "quote_order", { p_lines: plan.quote_lines, p_village: null, p_pickup: false });
    const routed = await sendBasket(ctx, { lines: plan.quote_lines, villageId: null, placeId: null, pickup: false }, terms, quote, before);
    return routed.done ? routed : { done: false, plan };
  }
  // After closing time, with every line known (K1, B4's leftover): the basket is kept and the customer is told by code when we
  // open, with one button. On staging this went to the model, which asked for the pin "to continue later"; the pin then got a
  // greeting, and the basket was gone by morning.
  const closed = plan.issues.find((i) => i.code === "closed");
  if (closed && matched && plan.quote && plan.issues.every((i) => i.code === "closed" || WHERE_ISSUES.has(i.code))) {
    const kept = await keepUntilOpen(ctx, { lines: plan.quote_lines, villageId: plan.pickup ? null : plan.village_id, placeId: plan.place_id,
                                            pickup: plan.pickup, quote: plan.quote }, terms, String(closed.opens ?? ""), { before: before });
    if (!kept.ok) return { done: false, plan };
    // W1 (C3's request 5): a window is the other answer after hours. Offered when there is one; the tap sends the basket for it.
    if (!plan.pickup) {
      const windows = await windowsFor(ctx, plan.village_id, !!plan.quote.bought_to_order, null);
      if (windows.length) await deliver(ctx, formatWindowChoice(null, windows, { lang: ctx.state.lang, body: T(ctx).windows.orChoose }), `[windows] ${T(ctx).windows.orChoose}`);
    }
    return { done: true, path: "closed_kept" };
  }
  // A known basket the loop is about to ask about: keep it, so a pin request or an answer later finds it. B1a: the lines already
  // matched are kept too when another line needs a question, so the answer adds to them (SIM1: items said early dropped off the card).
  if (plan.quote && plan.quote_lines.length && (matched || !held)) {
    ctx.state.lastQuote = { lines: plan.quote_lines, villageId: plan.pickup ? null : plan.village_id, pickup: plan.pickup, quote: plan.quote };
    ctx.state.basketAt = Date.now();
  }
  if (plan.next !== "card" || !plan.quote?.ok) return { done: false, plan };

  const basket = { lines: plan.quote_lines, villageId: plan.pickup ? null : plan.village_id, placeId: plan.place_id, pickup: plan.pickup };
  const routed = await sendBasket(ctx, basket, terms, plan.quote, before);
  return routed.done ? routed : { done: false, plan };
}

export const WHERE_ISSUES = new Set(["no_delivery_village", "village_not_recognised"]);
/** Issues quote_order itself raises: after an edit they are the new quote's, never the planner's for the lines it was given. */
const QUOTE_ISSUES = new Set(["unknown_product", "out_of_stock", "insufficient_stock", "empty_order", "no_delivery_village", "village_not_served",
  "below_minimum", "closed", "no_exchange_rate", "fx_paused"]);
/** Readings whose items edit the basket in hand. */
const EDIT_INTENTS = new Set(["order", "add_to_order", "change_order", "cancel"]);
/** With the basket waiting on the minimum, these readings with no item get the minimum again (a greeting or a thank-you does not). */
const MINIMUM_AGAIN = new Set(["order", "add_to_order", "change_order", "question"]);
/** What a window can answer: where (the pin follows), closed now, or fresh goods bought for the order. */
const schedulable = (i: { code: string; bought_to_order?: unknown }) =>
  WHERE_ISSUES.has(i.code) || i.code === "closed" || ((i.code === "out_of_stock" || i.code === "insufficient_stock") && i.bought_to_order === true);
const WHEN_INTENTS = new Set(["order", "add_to_order", "change_order", "question", "greeting"]);
/** The time in the customer's words, when it names one worth scheduling ("today" alone is now). */
export function whenIn(said: string | undefined): When | null {
  const w = readWhen(said ?? "");
  return schedules(w) ? w : null;
}
const GO_AHEAD_INTENTS = new Set(["order", "add_to_order", "change_order"]);

/**
 * Words that cancel or refuse. The SP1 gate run (14 Nov) read «لغيلي الطلب» ("cancel my order") as an order with no lines: a
 * reading alone must never carry a basket on when the customer's own words say no. Then the Concierge answers, as before.
 */
const CANCEL_WORDS = /لغ[يىاء]|بط[ّ]?لت|ما\s*بد[يى]|مش\s*بد[يى]|\bcancel|\bannul|\bbatalt|\b(ma|mish|mesh)\s*badd?(e|i)\b|\bla2\b|\bno\b|^\s*لا(\s|$)/iu;

/**
 * A reading that says "go ahead": about ordering, no line, not "same as last time", and no cancel or refusal in the customer's
 * own words. The eval (evals/cases/ask_by_code.json) judges this function.
 */
export function isGoAhead(intent: OrderIntent | null, said = ""): boolean {
  return !!intent && GO_AHEAD_INTENTS.has(intent.intent) && intent.lines.length === 0 && !intent.repeat_last && !CANCEL_WORDS.test(said);
}

/** Carries on the basket that waits on us: kept overnight (sendKept), or a card that waited on a phone number. */
async function goAhead(ctx: ToolContext): Promise<{ done: true; path: string } | { done: false }> {
  if (ctx.state.awaiting === "opening") return (await sendKept(ctx)) ? { done: true, path: "kept_go_ahead" } : { done: false };
  if (ctx.state.awaiting === "phone" && ctx.state.lastQuote && ctx.state.pending)
    return (await completePending(ctx)) ? { done: true, path: "pending_go_ahead" } : { done: false };
  return { done: false };
}
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
  // B1a: a "line" whose words are part of the address just given is the address («البناية البيضا» read as eggs, «بيض»), never an
  // item: the B1a run on main added eggs to baskets that waited on the house and floor.
  const addressText = [intent.address.building, intent.address.landmark, intent.address.verbatim, intent.address.floor].filter(Boolean).join(" ");
  const inAddress = (l: OrderIntent["lines"][number]) => !!addressText && [l.raw, l.query].some((w) => !!w && addressText.includes(w.trim()));
  if (waitingForPlace(ctx) && intent.lines.length > 0 && addressText && intent.lines.every(inAddress)) intent = { ...intent, lines: [] };
  if (!waitingForPlace(ctx) || intent.lines.length > 0 || !ADDRESS_INTENTS.has(intent.intent)) return { done: false, plan: null };
  if (ctx.state.awaiting === "pin" && !ctx.state.placeId) {
    // Still no pin: keep the words for the rider and ask for the pin again, the basket still waiting.
    ctx.state.directions = mergeDirections(ctx.state.directions, directionsOf(intent) ?? said.trim().slice(0, 300));
    const r = await deliver(ctx, askLocation(T(ctx).fixed.askPin), `[location request] ${T(ctx).fixed.askPin}`);
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
  const r = await deliver(ctx, buttons(T(ctx).fixed.askVillage, pin.candidates.map((c) => ({ id: pinVillageButtonId(c.village_id), title: villageName(ctx.state.lang ?? "ar", c.name_ar, c.name_en) }))),
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
  // B1a: under the minimum, the minimum first (by code); the pin and the card wait until the basket reaches it.
  if (underMinimumOnly(quote) && !ctx.state.replacing) return (await askMinimum(ctx, basket, terms, quote, before)) ? { done: true, path: "minimum" } : { done: false };
  const pinned = basket.placeId && (await rpc<boolean>(ctx.db, "place_is_locatable", { p_place: basket.placeId }));
  if (!basket.pickup && !pinned) {
    // The rider needs a pin. The card waits for it; nothing is asked of the model.
    ctx.state.lastQuote = { lines: basket.lines, villageId: basket.villageId, pickup: false, quote };
    ctx.state.awaiting = "pin"; ctx.state.pending = terms;
    const text = before ? `${before}\n${T(ctx).fixed.askPin}` : T(ctx).fixed.askPin;
    const r = await deliver(ctx, askLocation(text), `[location request] ${text}`);
    return r.ok ? { done: true, path: "ask_pin" } : { done: false };
  }
  const card = await issueCard(ctx, basket, terms, { before });
  return card.ok ? { done: true, path: card.waiting_for ? "ask_phone" : "card" } : { done: false };
}

/** The three questions recognised without a model (quick-intent.ts). */
export async function answerQuick(ctx: ToolContext, kind: QuickIntent): Promise<{ done: true; path: string } | { done: false }> {
  if (kind === "status") return answerStatusOrBasket(ctx);
  if (kind === "hours") return answerHours(ctx);
  if (kind === "greeting") return offerRepeat(ctx);
  if (kind === "lira") return answerLira(ctx);
  if (kind === "small_talk") {
    // 1.18: chat about the assistant, nothing about an order. The one fixed line, no model (K1: read as a greeting live).
    const r = await deliver(ctx, { type: "text", text: { body: T(ctx).fixed.offTopic } }, T(ctx).fixed.offTopic);
    return r.ok ? { done: true, path: "off_topic" } : { done: false };
  }
  return repeatLast(ctx);
}

/** "X is not available yet", in the customer's own words for the shop. Neutral: no reason, no opinion, no promise. */
export function notAvailableText(plan: Pick<Plan, "unavailable">, lang?: string | null): string | null {
  const said = [...new Set((plan.unavailable ?? []).map((u) => (u.source_hint ?? "").trim()).filter(Boolean))];
  if (!(plan.unavailable ?? []).length) return null;
  return messages(lang).fixed.notAvailable(said);
}

/**
 * A pin, a village tap, the address or a phone number arrived for a card that was waiting on it: take the next step with no
 * model call. The pin decides the village (B4): a clear pin prices the card for where it is; an unclear one asks the customer
 * to tap the village; a first delivery to a new place asks once for the house and floor. True when something was sent.
 */
export async function completePending(ctx: ToolContext): Promise<boolean> {
  const q = ctx.state.lastQuote, terms = ctx.state.pending;
  if (!ctx.state.awaiting || !q || !terms) return false;
  if (ctx.state.awaiting === "window") return false;                    // W1: the basket waits on a window tap
  if (ctx.state.awaiting === "opening") return sendKept(ctx, { pin: true });          // a pin for a basket kept overnight
  if (!q.pickup && ctx.state.awaiting !== "phone") {
    if (!ctx.state.placeId) return false;                                   // still waiting for the pin
    const pin = ctx.state.pinCheck;
    if (!ctx.state.villageId) {
      // The pin is between villages, or near none we know. Ask; never guess, never take the text's village.
      if (pin?.status === "unsure" && pin.candidates.length) { ctx.state.awaiting = "village"; return askPinVillage(ctx); }
      ctx.state.awaiting = "pin";
      const r = await deliver(ctx, askLocation(T(ctx).fixed.pinOutside), `[location request] ${T(ctx).fixed.pinOutside}`);
      return r.ok;
    }
    if (pin?.served === false) {
      ctx.state.awaiting = null;
      return (await answerOutOfArea(ctx, villageName(ctx.state.lang ?? "ar", pin.villageAr, pin.villageEn))).done;
    }
    const lang = ctx.state.lang ?? "ar";
    const here = villageName(lang, pin?.villageAr, pin?.villageEn);
    const note = pin?.saidAr && here ? T(ctx).fixed.pinVillage(here, pin.saidAr) : undefined;
    if (ctx.state.directions)
      await rpc<boolean>(ctx.db, "set_place_details", { p_party: ctx.partyId, p_place: ctx.state.placeId, p_building: null, p_floor: null, p_directions: ctx.state.directions });
    if (!(await rpc<boolean>(ctx.db, "place_has_details", { p_place: ctx.state.placeId }))) {
      // The rider has a pin and nothing else: one question for the house and the floor. The card waits for the answer.
      ctx.state.awaiting = "address";
      if (pin) pin.saidAr = null;                                           // said once, in this question
      const text = [note ?? T(ctx).fixed.pinReceived(here), "", T(ctx).fixed.askAddress].join("\n");
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
  await ctx.db.rpc("clear_kept_order", { p_party: ctx.partyId }).then(() => undefined, () => undefined);   // taken up: never offered again
  if (q.pickup) { ctx.state.awaiting = null; return (await issueCard(ctx, { lines: q.lines, villageId: null, placeId: null, pickup: true }, terms)).ok; }
  ctx.state.awaiting = "pin";
  if (ctx.state.placeId && (await rpc<boolean>(ctx.db, "place_is_locatable", { p_place: ctx.state.placeId }))) return completePending(ctx);
  const r = await deliver(ctx, askLocation(T(ctx).fixed.askPin), `[location request] ${T(ctx).fixed.askPin}`);
  return r.ok;
}

// HO1: the planner's hand-off opens a case with its topic; the bot stays in the chat (support.ts).
async function handoff(ctx: ToolContext, reason: string) {
  await handoffToCase(ctx, reason, "planner", ctx.support ??= {});
}

// ---------- W1: windows for the basket in hand ----------
type Basket = { lines: QuoteLineInput[]; villageId: string | null; placeId: string | null; pickup: boolean };
type Done = { done: true; path: string } | { done: false };

/** Keeps the basket and offers windows for it. Each row carries the basket on (no order yet: windowButtonId with null). */
async function offerBasketWindows(ctx: ToolContext, basket: Basket, terms: CardTerms, quote: Quote, windows: DeliveryWindow[], body: string): Promise<Done> {
  ctx.state.lastQuote = { lines: basket.lines, villageId: basket.villageId, pickup: basket.pickup, quote };
  if (basket.placeId) ctx.state.placeId = basket.placeId;
  if (basket.villageId) ctx.state.villageId = basket.villageId;
  ctx.state.pending = terms; ctx.state.slotId = null;
  if (ctx.state.awaiting !== "opening") ctx.state.awaiting = "window";     // a basket kept overnight stays kept until a tap
  const r = await deliver(ctx, formatWindowChoice(null, windows, { lang: ctx.state.lang, body }), `[windows] ${body}`);
  return r.ok ? { done: true, path: "windows" } : { done: false };
}

/**
 * A time said with (or for) a basket. One open window matches: the basket goes for it, by the usual steps (pin, house, number,
 * card). Several, or none that match: the list. No window open at all: said once, and the basket goes now (kept after hours),
 * unless `orNow` is false (the caller has another answer).
 */
export async function basketWhen(ctx: ToolContext, basket: Basket, terms: CardTerms, quote: Quote, when: When,
                                 opts: { before?: string; body?: string; orNow?: boolean } = {}): Promise<Done> {
  if (basket.pickup) return { done: false };
  const p = await pickWindow(ctx, basket.villageId, !!quote.bought_to_order, when);
  if (p.kind === "one") {
    ctx.state.slotId = p.window.slot_id;
    ctx.state.awaiting = null;
    return sendBasket(ctx, basket, terms, quote, opts.before);
  }
  if (p.kind === "list") return offerBasketWindows(ctx, basket, terms, quote, p.windows, [opts.before, opts.body ?? p.body].filter(Boolean).join("\n"));
  if (opts.orNow === false) return { done: false };
  ctx.state.slotId = null;
  const before = [opts.before, T(ctx).windows.noneAtAll].filter(Boolean).join("\n");
  const closed = quote.issues.find((i) => i.code === "closed");
  if (closed) return (await keepUntilOpen(ctx, { ...basket, quote }, terms, String(closed.opens ?? ""), { before })).ok ? { done: true, path: "closed_kept" } : { done: false };
  return sendBasket(ctx, basket, terms, quote, before);
}

/** A row of a window list offered for the basket in hand was tapped: the basket goes for that window (null: now). */
export async function basketWindowTap(ctx: ToolContext, slotId: string | null): Promise<Done> {
  const q = ctx.state.lastQuote, terms = ctx.state.pending;
  if (!q || !terms) {
    const r = await deliver(ctx, { type: "text", text: { body: T(ctx).fixed.keptGone } }, T(ctx).fixed.keptGone);
    return r.ok ? { done: true, path: "window_no_basket" } : { done: false };
  }
  const wasKept = ctx.state.awaiting === "opening";
  if (slotId === null && wasKept) return (await sendKept(ctx)) ? { done: true, path: "kept_now" } : { done: false };
  ctx.state.slotId = slotId;
  ctx.state.awaiting = null;
  if (wasKept) await ctx.db.rpc("clear_kept_order", { p_party: ctx.partyId }).then(() => undefined, () => undefined);
  const basket = { lines: q.lines, villageId: q.pickup ? null : ctx.state.villageId ?? q.villageId, placeId: ctx.state.placeId ?? null, pickup: q.pickup };
  return sendBasket(ctx, basket, terms, q.quote);
}

/**
 * A time said with nothing else to order: for the order being changed (a new card for the new time), the card waiting on the tap
 * (the window goes on it), or the basket waiting on us (it goes for that window). Nothing in hand: not answered here.
 */
export async function answerWhen(ctx: ToolContext, when: When): Promise<Done> {
  const old = ctx.state.replacing;
  if (old) {
    const b = await rpc<{ found: boolean; lines?: QuoteLineInput[]; village_id?: string | null; place_id?: string | null; pickup?: boolean;
                          payment_method?: "cod" | "whish" | "omt"; change_for_usd?: number | null; notes?: string | null; quote?: Quote | null }>(
      ctx.db, "basket_from_order", { p_party: ctx.partyId, p_order: old.orderId });
    if (b.found && b.lines?.length && b.quote)
      return basketWhen(ctx, { lines: b.lines, villageId: b.village_id ?? null, placeId: b.place_id ?? null, pickup: !!b.pickup },
                        { payment: b.payment_method ?? "cod", changeForUsd: b.change_for_usd ?? null, notes: b.notes ?? null }, b.quote, when);
  }
  const card = await cardInHand(ctx);
  if (card) return (await cardWhen(ctx, card, when)) ? { done: true, path: "card_window" } : { done: false };
  const q = ctx.state.lastQuote, terms = ctx.state.pending;
  if (q && terms && ctx.state.awaiting)
    return basketWhen(ctx, { lines: q.lines, villageId: q.pickup ? null : ctx.state.villageId ?? q.villageId, placeId: ctx.state.placeId ?? null, pickup: q.pickup },
                      terms, q.quote, when);
  return { done: false };
}

// ---------- B1a: the basket in hand ----------

interface Held {
  lines: QuoteLineInput[]; quote: Quote | null; villageId: string | null; placeId: string | null; pickup: boolean;
  terms: CardTerms | null; draft: { orderId: string; shortCode: string } | null; slotId?: string | null;
}

/** The basket in hand: the one being built (state.lastQuote), else the lines of the card waiting on the customer's tap. */
export async function heldBasket(ctx: ToolContext): Promise<Held | null> {
  const q = ctx.state.lastQuote;
  if (q && q.lines.length) return { lines: q.lines, quote: q.quote, villageId: q.villageId, placeId: ctx.state.placeId ?? null, pickup: q.pickup,
                                    terms: ctx.state.pending ?? null, draft: ctx.state.editing ?? null };
  const card = await cardInHand(ctx).catch(() => null);
  if (!card) return null;
  // A retried turn (G1-21) finds the card its own first attempt made: that card is this turn's answer, not a basket to edit.
  if (ctx.turnKey) {
    const own = await ctx.db.from("orders").select("turn_key").eq("id", card.order_id).single();
    if ((own.data as { turn_key?: string | null } | null)?.turn_key === ctx.turnKey) return null;
  }
  const b = await rpc<{ found: boolean; lines?: QuoteLineInput[]; quote?: Quote | null; village_id?: string | null; place_id?: string | null; pickup?: boolean;
                        payment_method?: "cod" | "whish" | "omt"; change_for_usd?: number | null; notes?: string | null; slot_id?: string | null }>(
    ctx.db, "basket_from_order", { p_party: ctx.partyId, p_order: card.order_id });
  if (!b.found || !b.lines?.length) return null;
  return { lines: b.lines, quote: b.quote ?? null, villageId: b.village_id ?? null, placeId: b.place_id ?? null, pickup: !!b.pickup,
           terms: { payment: b.payment_method ?? "cod", changeForUsd: b.change_for_usd ?? null, notes: b.notes ?? null },
           draft: { orderId: card.order_id, shortCode: card.short_code }, slotId: b.slot_id ?? null };
}

/**
 * "Where is my order?" (B1a, SIM1 fix 3): with a basket in hand and no order placed since, the basket so far and its next step,
 * never "you have no open order". An order in progress is answered as before.
 */
export async function answerStatusOrBasket(ctx: ToolContext): Promise<Done> {
  const s = await rpc<{ status: string } | null>(ctx.db, "order_status_for", { p_party: ctx.partyId });
  if (heldLines(ctx) && (!s || s.status === "delivered")) {
    const r = await resumeBasket(ctx, soFar(ctx));
    if (r.done) return r;
  }
  // B1a (the second run on main, sim-079 and sim-146: «I don't see the card, send it again»): a card waiting for the tap is sent
  // again, the card itself being the answer.
  if (s?.status === "awaiting_confirmation") {
    const card = await cardInHand(ctx).catch(() => null);
    if (card && (await resendCard(ctx, card.order_id).catch(() => false))) return { done: true, path: "card_again" };
  }
  // B1a: no order and no basket, and a request with a person is open: "when will they answer?" read as "where is my order" is
  // about that request (the B1a run on main: 5 of its 6 «no open order» replies). The reminder, at most as often as HO1 allows.
  if (ctx.openCaseIds?.length) {
    if (!s) {
      if (await remindCase(ctx, ctx.openCaseIds[0]!)) return { done: true, path: "case_reminder" };
      const r = T(ctx).support.reminder;
      return (await deliver(ctx, { type: "text", text: { body: r } }, r)).ok ? { done: true, path: "case_reminder" } : { done: false };
    }
  }
  return answerStatus(ctx);
}

/**
 * "Edit" on a card waiting for the tap (B1a): the card is a draft again, and its lines are the basket in hand, so what the customer
 * says next changes it and the next card replaces it. Nothing is sent here: the tap's own answer asks what to change.
 */
export async function holdDraft(ctx: ToolContext, orderId: string): Promise<void> {
  const b = await rpc<{ found: boolean; short_code?: string; lines?: QuoteLineInput[]; quote?: Quote | null; village_id?: string | null; place_id?: string | null;
                        pickup?: boolean; payment_method?: "cod" | "whish" | "omt"; change_for_usd?: number | null; notes?: string | null; slot_id?: string | null }>(
    ctx.db, "basket_from_order", { p_party: ctx.partyId, p_order: orderId });
  if (!b.found || !b.lines?.length || !b.quote) return;
  const pickup = !!b.pickup;
  ctx.state.lastQuote = { lines: b.lines, villageId: pickup ? null : b.village_id ?? null, pickup, quote: b.quote };
  ctx.state.basketAt = Date.now();
  if (b.village_id) ctx.state.villageId = b.village_id;
  if (b.place_id) ctx.state.placeId = b.place_id;
  ctx.state.pending = { payment: b.payment_method ?? "cod", changeForUsd: b.change_for_usd ?? null, notes: b.notes ?? null };
  ctx.state.awaiting = null;
  if (b.slot_id) ctx.state.slotId = b.slot_id;
  const code = b.short_code ?? (await ctx.db.from("orders").select("short_code").eq("id", orderId).single()).data?.short_code;
  ctx.state.editing = { orderId, shortCode: String(code ?? "") };
}

/** The basket so far, as one fixed message: "2 × name" per line, in the conversation's language. */
function soFar(ctx: ToolContext): string {
  const q = ctx.state.lastQuote!;
  const lang = ctx.state.lang ?? "ar";
  const names = namesOf(q.quote);
  const items = q.lines.map((l) => { const n = names.get(l.product_id); return `${Number(l.qty)} × ${n ? productName({ ...n, product_id: l.product_id }, lang) : "?"}`; });
  return T(ctx).basket.soFar(items);
}

/** "What is the minimum?" with no basket: the minimum from settings, by code. */
async function answerMinimum(ctx: ToolContext): Promise<Done> {
  const v = (await ctx.db.rpc("setting", { p_key: "min_order_usd" })).data as unknown;
  const min = Number(v);
  if (!Number.isFinite(min) || min <= 0) return { done: false };
  const text = T(ctx).basket.minimumIs(min);
  return (await deliver(ctx, { type: "text", text: { body: text } }, text)).ok ? { done: true, path: "minimum_is" } : { done: false };
}

/**
 * The basket in hand takes its next step, from a fresh quote: the step it waits on (the pin, the village, the house, the number, a
 * window, the opening), or the minimum, or the card. `before` is said first (the basket so far, or what changed).
 */
export async function resumeBasket(ctx: ToolContext, before?: string): Promise<Done> {
  const q = ctx.state.lastQuote;
  if (!q?.lines.length) return { done: false };
  const terms = ctx.state.pending ?? { payment: "cod" as const, changeForUsd: null, notes: ctx.state.directions ?? null };
  const say = async (text: string): Promise<Done> => (await deliver(ctx, { type: "text", text: { body: text } }, text)).ok ? { done: true, path: "basket" } : { done: false };
  const a = ctx.state.awaiting;
  if (a === "opening") {
    if (before && !(await say(before)).done) return { done: false };
    return (await sendKept(ctx)) ? { done: true, path: "basket_kept" } : { done: false };
  }
  if (a === "pin" && !ctx.state.placeId) {
    const text = [before, T(ctx).fixed.askPin].filter(Boolean).join("\n");
    return (await deliver(ctx, askLocation(text), `[location request] ${text}`)).ok ? { done: true, path: "basket_pin" } : { done: false };
  }
  if (a === "village" && ctx.state.pinCheck?.candidates.length) {
    if (before && !(await say(before)).done) return { done: false };
    return (await askPinVillage(ctx)) ? { done: true, path: "basket_village" } : { done: false };
  }
  if (a === "address") return say([before, T(ctx).fixed.askAddress].filter(Boolean).join("\n"));
  if (a === "phone") return say([before, T(ctx).fixed.askPhone].filter(Boolean).join("\n"));
  if (a === "window") {
    const windows = await windowsFor(ctx, q.pickup ? null : ctx.state.villageId ?? q.villageId, !!q.quote.bought_to_order, null);
    if (windows.length) {
      const body = [before, T(ctx).windows.choose].filter(Boolean).join("\n");
      return (await deliver(ctx, formatWindowChoice(null, windows, { lang: ctx.state.lang, body }), `[windows] ${body}`)).ok ? { done: true, path: "basket_windows" } : { done: false };
    }
  }
  const villageId = q.pickup ? null : ctx.state.villageId ?? q.villageId;
  const quote = await rpc<Quote>(ctx.db, "quote_order", { p_lines: q.lines, p_village: villageId, p_pickup: q.pickup, ...(ctx.state.slotId ? { p_slot: ctx.state.slotId } : {}) });
  ctx.state.lastQuote = { ...q, villageId, quote };
  if (a === "minimum" || a === "window") ctx.state.awaiting = null;
  return routeBasket(ctx, { lines: q.lines, villageId, placeId: ctx.state.placeId ?? null, pickup: q.pickup }, terms, quote, before);
}

/** A whole basket and its quote: the minimum, an item that ran out, or on to the pin and the card. Never silence. */
export async function routeBasket(ctx: ToolContext, basket: Basket, terms: CardTerms, quote: Quote, before?: string): Promise<Done> {
  if (underMinimumOnly(quote)) return (await askMinimum(ctx, basket, terms, quote, before)) ? { done: true, path: "minimum" } : { done: false };
  const gone = goneNames(ctx, quote);
  if (gone.length) return explainGone(ctx, basket, terms, quote, gone, before);
  const r = await sendBasket(ctx, basket, terms, quote, before);
  if (r.done || ctx.sent.count > 0) return r.done ? r : { done: true, path: "basket_partial" };
  return explainNotSent(ctx);
}

function goneNames(ctx: ToolContext, quote: Quote): string[] {
  const lang = ctx.state.lang ?? "ar";
  const ids = new Set(quote.issues.filter((i) => i.code === "out_of_stock" || i.code === "insufficient_stock").map((i) => String(i.product_id)));
  return quote.lines.filter((l) => l.product_id && ids.has(l.product_id)).map((l) => productName(l, lang));
}
async function explainGone(ctx: ToolContext, basket: Basket, terms: CardTerms, quote: Quote, names: string[], before?: string): Promise<Done> {
  ctx.state.lastQuote = { lines: basket.lines, villageId: basket.villageId, pickup: basket.pickup, quote };
  ctx.state.pending = terms; ctx.state.basketAt = Date.now();
  if (ctx.state.awaiting === "minimum" || ctx.state.awaiting === "window") ctx.state.awaiting = null;
  const text = [before, T(ctx).basket.unavailable(names)].filter(Boolean).join("\n");
  return (await deliver(ctx, { type: "text", text: { body: text } }, text)).ok ? { done: true, path: "basket_gone" } : { done: false };
}

/**
 * The last word when a basket could not go and nothing was said (SIM1's two no-reply turns: a window tapped for a basket kept
 * overnight that was under the minimum). Priced again: the minimum, or what ran out; else the fixed question with buttons.
 */
export async function explainNotSent(ctx: ToolContext): Promise<Done> {
  const q = ctx.state.lastQuote;
  if (q?.lines.length) {
    const villageId = q.pickup ? null : ctx.state.villageId ?? q.villageId;
    const quote = await rpc<Quote>(ctx.db, "quote_order", { p_lines: q.lines, p_village: villageId, p_pickup: q.pickup });
    const terms = ctx.state.pending ?? { payment: "cod" as const, changeForUsd: null, notes: ctx.state.directions ?? null };
    const basket = { lines: q.lines, villageId, placeId: ctx.state.placeId ?? null, pickup: q.pickup };
    if (minimumGap(quote)) return (await askMinimum(ctx, basket, terms, quote)) ? { done: true, path: "minimum" } : { done: false };
    const gone = goneNames(ctx, quote);
    if (gone.length) return explainGone(ctx, basket, terms, quote, gone);
  }
  const m = supportMessage(ctx.state.lang, "stalled");
  return (await deliver(ctx, m, T(ctx).support.stalled)).ok ? { done: true, path: "basket_stalled" } : { done: false };
}
