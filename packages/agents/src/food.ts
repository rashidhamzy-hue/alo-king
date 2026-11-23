// FD2: ordering food from a place on WhatsApp, the same way as groceries (docs/DECISIONS.md, "FD2, 18 November 2026").
//
// Deterministic code, no new agent (invariant 21): the Concierge's reading says what was asked; code finds the place the customer named
// (food_places_named, by its name or the names customers use), matches the dishes on that place's approved menu (food_match), asks every
// required choice (size, bread, sauce) and offers each optional one once (extras), as WhatsApp list or button messages, and then hands the
// basket to the same path groceries take (the minimum, the pin, the card, the customer's own Confirm tap). Prices, the fee, the hours and
// the arrival estimate are the database's (quote_order with the customer, 0249; invariant 7).
//
// One shop per order: a grocery basket in hand is kept apart (parked) while the food basket is built, said to the customer as "a second
// order", and is the basket in hand again once the food card went (issueCard). A place this customer may not order from (testers only, and
// they are not on the list; off) gets the honest "not on Alo King yet", the same words an unapproved restaurant gets.
import { buttons, list, type Outbound } from "@ak/wa/kapso";
import { deliver, type CardTerms, type ConversationState, type QuoteLineInput, type ToolContext } from "./concierge-tools";
import type { Quote, QuoteLine } from "./order-card";
import { messages, productName, usd, type Lang } from "./messages";
import { listTitle, quoted } from "./choice";
import type { OrderIntent } from "./schemas";
import { guessPlace, type PlaceChoice } from "./place-guess";

type Done = { done: true; path: string } | { done: false };
type Basket = { lines: QuoteLineInput[]; villageId: string | null; placeId: string | null; pickup: boolean };
export type Route = (ctx: ToolContext, basket: Basket, terms: CardTerms, quote: Quote, before?: string) => Promise<Done>;

export interface DishCandidate { product_id: string; name_en: string; name_ar: string | null; price_usd: number }
/** What the food path waits on: a choice of one group for one line, or which dish a word meant. */
export type FoodAsk =
  | { kind: "group"; key: string; productId: string; groupId: string; required: boolean }
  | { kind: "dish"; raw: string; qty: number; words: string; candidates: DishCandidate[]; lead?: string };
export interface FoodState {
  sourceId: string; name: string;
  asking?: FoodAsk | null;
  /** Optional groups already offered once, as `<line key>|<group id>`: never offered twice. */
  offered?: string[];
}
/** The other shop's basket, kept while this one is built (one shop per order). */
export interface Parked { lastQuote: NonNullable<ConversationState["lastQuote"]>; pending: CardTerms | null; food: FoodState | null }

interface Group { group_id: string; name_en: string; name_ar: string | null; required: boolean; min: number; max: number;
  options: { id: string; name_en: string; name_ar: string | null; price_delta_usd: number }[] }
type FoodLine = QuoteLine & { key?: string; source_id?: string; needs?: Group[]; open_groups?: Group[]; options?: { id: string; name_en: string; name_ar: string | null }[] };
interface PlaceNamed { source_id: string; name: string; score: number; orderable: boolean }
interface Matched { idx: number; raw: string | null; query: string | null; qty: number; status: "matched" | "ambiguous" | "not_found" | "not_on_sale";
  chosen: DishCandidate | null; candidates: DishCandidate[]; options: string[];
  /** VOICE1 (0276): the menu's dish the words named that is not on sale; `candidates` are then the place's dishes on sale. */
  dish?: { name_ar: string | null; name_en: string | null } | null }
/** VOICE1: a place name we did not know, asked about («قصدك …؟»): the reading kept for the "yes". */
export interface PlaceGuessState { sourceId: string; name: string; intent: OrderIntent }

const T = (ctx: ToolContext) => messages(ctx.state.lang);
const lang = (ctx: ToolContext): Lang => ctx.state.lang ?? "ar";
async function rpc<R>(ctx: ToolContext, fn: string, args: Record<string, unknown>): Promise<R> {
  const { data, error } = await ctx.db.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as R;
}
const say = async (ctx: ToolContext, text: string, path: string): Promise<Done> =>
  (await deliver(ctx, { type: "text", text: { body: text } }, text)).ok ? { done: true, path } : { done: false };

// ---------- the buttons ----------
export const FOOD_OPTION = "fopt:";
export const foodOptionId = (optionId: string) => `fopt:${optionId}`;
export const foodNoneId = (groupId: string) => `fopt:none:${groupId}`;
export const foodDishId = (productId: string) => `fdish:${productId}`;
export const placeYesId = (sourceId: string) => `fplace:${sourceId}`;
export const PLACE_NO = "fplace:none";
export type FoodTap = { kind: "option"; optionId: string } | { kind: "none"; groupId: string } | { kind: "dish"; productId: string }
  | { kind: "place"; sourceId: string } | { kind: "noplace" };
export function parseFoodButton(id: string): FoodTap | null {
  if (id === PLACE_NO) return { kind: "noplace" };
  let m = /^fplace:([0-9a-f-]{36})$/.exec(id);
  if (m) return { kind: "place", sourceId: m[1]! };
  m = /^fopt:none:([0-9a-f-]{36})$/.exec(id);
  if (m) return { kind: "none", groupId: m[1]! };
  m = /^fopt:([0-9a-f-]{36})$/.exec(id);
  if (m) return { kind: "option", optionId: m[1]! };
  m = /^fdish:([0-9a-f-]{36})$/.exec(id);
  return m ? { kind: "dish", productId: m[1]! } : null;
}
/** The customer's answers to what staff found on the phone (0250): keep the rest, accept a new price, or cancel. */
export type CallAnswer = { callId: string; answer: "drop" | "accept" | "cancel" };
export const callAnswerId = (answer: CallAnswer["answer"], callId: string) => `fcall:${answer}:${callId}`;
export function parseCallButton(id: string): CallAnswer | null {
  const m = /^fcall:(drop|accept|cancel):([0-9a-f-]{36})$/.exec(id);
  return m ? { answer: m[1] as CallAnswer["answer"], callId: m[2]! } : null;
}

const name = (l: { name_en?: string; name?: string; name_ar?: string | null }, lg: Lang) => productName({ name: l.name_en ?? l.name ?? "", name_ar: l.name_ar ?? null }, lg);
const optName = (o: { name_en: string; name_ar: string | null }, lg: Lang) => (lg === "ar" ? o.name_ar ?? o.name_en : o.name_en ?? o.name_ar ?? "");
const keyOf = (l: QuoteLineInput) => `${l.product_id}:${[...(l.options ?? [])].sort().join(",")}`;

/** The words of the turn that may name a place: the message and the reading's restaurant hints. */
function placeWords(intent: OrderIntent | null, said: string): string {
  const hints = (intent?.lines ?? []).map((l) => (l as { source_hint?: string | null }).source_hint).filter(Boolean);
  return [said, ...hints].join(" \n ");
}

/** True when the basket in hand is this place's food (every line from it). */
const basketIsPlace = (ctx: ToolContext, sourceId: string) =>
  !!ctx.state.lastQuote?.lines.length && (ctx.state.lastQuote.quote?.lines ?? []).length > 0
  && (ctx.state.lastQuote.quote.lines as FoodLine[]).every((l) => l.source_id === sourceId);

/**
 * The food path, before the grocery planner. Done when a place was named (or a food basket is in hand and the words are about it) and the
 * turn was answered here; not done otherwise, and the grocery path goes on as before.
 */
export async function foodTurn(ctx: ToolContext, intent: OrderIntent | null, said: string, route: Route): Promise<Done> {
  if (!intent) return { done: false };
  // VOICE1: "yes" typed to «قصدك …؟» is the button's yes; anything else lets the question go.
  const guess = ctx.state.placeGuess;
  if (guess) {
    ctx.state.placeGuess = null;
    if (YES.test(said.trim())) return orderFrom(ctx, guess.sourceId, guess.name, guess.intent);
  }
  const words = placeWords(intent, said);
  const named = words.trim() ? await rpc<PlaceNamed[]>(ctx, "food_places_named", { p_party: ctx.partyId, p_text: words }).catch(() => [] as PlaceNamed[]) : [];
  const place = named[0];
  if (place && !place.orderable) {
    // Testers only, and this customer is not on the list (or the place is off): exactly the reply an unapproved restaurant gets.
    return say(ctx, T(ctx).fixed.notAvailable([place.name]), "food_not_on_alo_king");
  }
  // A question about a place's dish («does the shawarma have nuts?») is the Concierge's to answer (food_facts): nothing is added to a basket.
  const ordering = new Set(["order", "add_to_order", "change_order"]).has(intent.intent);
  if (place && ordering) return orderFrom(ctx, place.source_id, place.name, intent);
  // VOICE1: a place named that is none we know (a speech model's «عنفطة Chicken Tin» for Safa Chicken): the closest place this customer may
  // order from is asked about, or the places are listed. The name as heard is never repeated as if it were a real place.
  if (!place && ordering) {
    const r = await unknownPlace(ctx, intent, said);
    if (r.done) return r;
  }
  // A food basket in hand: lines that are this place's dishes are edits to it; anything else is not food (the grocery path).
  const food = ctx.state.food;
  if (food && intent.lines.length && (intent.intent === "order" || intent.intent === "add_to_order" || intent.intent === "change_order") && basketIsPlace(ctx, food.sourceId)) {
    const m = await rpc<{ ok: boolean; lines: Matched[] }>(ctx, "food_match", { p_party: ctx.partyId, p_source: food.sourceId, p_lines: linesOf(intent) });
    if (m.ok && m.lines.some((l) => l.status !== "not_found")) return orderFrom(ctx, food.sourceId, food.name, intent, m.lines);
    // Not this place's food: groceries asked with a food basket in hand. The food basket is kept apart as its own order.
    park(ctx);
    ctx.state.food = null;
  }
  return { done: false };
}

/** VOICE1: a typed yes to «قصدك …؟» (turn.ts reads it before any model while the question waits). */
export const placeYes = (text: string) => YES.test(text.trim());
const YES = /^(?:اي|ايه|إيه|أيه|اية|ايوا|ايوه|أكيد|اكيد|نعم|صح|هيدا|هيدا هو|yes|yeah|yep|ya|eh|aywa|ah|ok|okay|oui|ouais|si)[.!؟?\s]*$/iu;
const hintsOf = (intent: OrderIntent) => [...new Set(intent.lines.map((l) => (l as { source_hint?: string | null }).source_hint?.trim() ?? "").filter(Boolean))];

/** VOICE1: a place name we do not know. Not done when it names a real place we know of (the usual "not on Alo King yet" follows). */
async function unknownPlace(ctx: ToolContext, intent: OrderIntent, said: string): Promise<Done> {
  const hints = hintsOf(intent);
  if (!hints.length) return { done: false };
  const hint = hints.join(" ");
  if (await rpc<boolean>(ctx, "place_hint_known", { p_hint: hint }).catch(() => true)) return { done: false };
  // Groceries said with it: they go on as before (the card); the shop part is said without its name (pipeline.ts notAvailableText).
  if (intent.lines.some((l) => !(l as { source_hint?: string | null }).source_hint?.trim())) { ctx.unknownPlaces = hints; return { done: false }; }
  const places = await rpc<PlaceChoice[]>(ctx, "food_place_choices", { p_party: ctx.partyId }).catch(() => [] as PlaceChoice[]);
  const g = guessPlace(hint, places);
  if (g) {
    // The reading is kept for the "yes", without the name as heard: as a line or as the shop, it is the place, not a dish.
    const heard = hints.map((h) => h.toLowerCase());
    const lines = intent.lines.filter((l) => !heard.some((h) => (l.raw ?? "").toLowerCase().trim() === h || (l.query ?? "").toLowerCase().trim() === h))
      .map((l) => ({ ...l, source_hint: null }));
    ctx.state.placeGuess = { sourceId: g.source_id, name: g.name, intent: { ...intent, lines } };
    const text = T(ctx).food.placeGuess(g.name);
    const msg = buttons(text, [{ id: placeYesId(g.source_id), title: T(ctx).food.yesButton }, { id: PLACE_NO, title: T(ctx).food.noButton }]);
    return (await deliver(ctx, msg, text)).ok ? { done: true, path: "food_place_guess" } : { done: false };
  }
  return say(ctx, T(ctx).food.placeUnknown(places.map((p) => p.name)), "food_place_unknown");
}

/** The words of a line without the place's names (its own and the names customers use), and without a filler left alone around them. */
const FILLER = /^(?:عم|من|عند|من عند|بدي|بدنا|اطلب|أطلب|from|at|de|chez|i want|order)$/iu;
export function withoutPlace(text: string, names: string[]): string {
  let t = ` ${text} `;
  for (const n of [...names].filter((x) => x && x.trim().length >= 2).sort((a, b) => b.length - a.length)) {
    const esc = n.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    t = t.replace(new RegExp(`(^|[\\s،,.])(?:(?:[وب]?(?:من|عند)|from|at|de|chez)\\s+)?${esc}(?=$|[\\s،,.?؟!])`, "giu"), "$1");
  }
  const words = t.trim().split(/\s+/).filter(Boolean);
  while (words.length && FILLER.test(words[0]!)) words.shift();      // «عم», «من»… left in front of what was the place's name
  return words.join(" ");
}

/** The reading's lines, as food_match takes them (the place's own name is not a dish). */
function linesOf(intent: OrderIntent): { raw: string; query: string; qty: number; modifiers: string[] }[] {
  return intent.lines.map((l) => ({ raw: l.raw ?? l.query, query: l.query ?? l.raw, qty: Number(l.qty ?? 1) || 1, modifiers: l.modifiers ?? [] }));
}

/** Keeps the basket in hand apart, as another order (one shop per order). */
function park(ctx: ToolContext): boolean {
  const q = ctx.state.lastQuote;
  if (!q?.lines.length) return false;
  ctx.state.parked = { lastQuote: q, pending: ctx.state.pending ?? null, food: ctx.state.food ?? null };
  ctx.state.lastQuote = null; ctx.state.pending = null; ctx.state.asking = null; ctx.state.editing = null;
  if (ctx.state.awaiting === "minimum") ctx.state.awaiting = null;
  return true;
}

/** Builds the basket from the lines said for one place, then asks what is left to ask, or sends it on. */
async function orderFrom(ctx: ToolContext, sourceId: string, placeName: string, intent: OrderIntent, matched?: Matched[]): Promise<Done> {
  const before: string[] = [];
  // One shop per order: another shop's basket in hand waits apart, said once.
  if (ctx.state.lastQuote?.lines.length && !basketIsPlace(ctx, sourceId)) {
    if (park(ctx)) before.push(T(ctx).food.secondOrder(placeName));
  }
  if (!ctx.state.food || ctx.state.food.sourceId !== sourceId) ctx.state.food = { sourceId, name: placeName, asking: null, offered: [] };
  await whereTo(ctx, intent);
  // VOICE1 (voice-check run 45237943821): a line that carries the place's other name («عم صفا تشيكن طنجية») was echoed whole as a dish
  // not on the menu. The place's names are taken out of the words first; a line left with nothing but a filler is the place, not a dish.
  if (!matched && intent.lines.length) {
    const names = (await rpc<PlaceChoice[]>(ctx, "food_place_choices", { p_party: ctx.partyId }).catch(() => [] as PlaceChoice[]))
      .find((p) => p.source_id === sourceId)?.names ?? [placeName];
    intent = { ...intent, lines: intent.lines.map((l) => ({ ...l, raw: withoutPlace(l.raw ?? "", names), query: withoutPlace(l.query ?? "", names) }))
      .filter((l) => (l.raw ?? "").trim() || (l.query ?? "").trim()) };
  }
  const lines = matched ?? (intent.lines.length
    ? (await rpc<{ ok: boolean; lines: Matched[] }>(ctx, "food_match", { p_party: ctx.partyId, p_source: sourceId, p_lines: linesOf(intent) })).lines
    : []);
  // The place's own name said as a line («بدي من صفا») is not a dish: it is dropped when nothing on the menu matches it.
  const placeLine = (l: Matched) => l.status === "not_found" && !!l.raw && (l.raw.toLowerCase().includes(placeName.toLowerCase()));
  const real = lines.filter((l) => !placeLine(l));
  const notFound = real.filter((l) => l.status === "not_found").map((l) => quoted(l.raw ?? l.query ?? ""));
  if (notFound.length) before.push(T(ctx).food.notOnMenu(notFound, placeName));
  // VOICE1: a dish on the menu that is not on sale (rejected, a price to confirm): said honestly, with the place's dishes that are.
  const offSale = real.filter((l) => l.status === "not_on_sale" && l.dish);
  const offName = (l: Matched) => name({ name_en: l.dish?.name_en ?? l.dish?.name_ar ?? "", name_ar: l.dish?.name_ar ?? null }, lang(ctx));
  const held = ctx.state.lastQuote?.lines ?? [];
  let basket = [...held];
  for (const l of real.filter((x) => x.status === "matched" && x.chosen)) basket = upsert(basket, { product_id: l.chosen!.product_id, qty: l.qty, options: l.options, source_id: sourceId });
  const ambiguous = real.find((l) => l.status === "ambiguous" && l.candidates.length);
  if (ambiguous) {
    ctx.state.food!.asking = { kind: "dish", raw: quoted(ambiguous.raw ?? ambiguous.query ?? ""), qty: ambiguous.qty, words: [ambiguous.raw, ambiguous.query].filter(Boolean).join(" "),
                               candidates: ambiguous.candidates.slice(0, 10) };
  }
  const offer = !ambiguous ? offSale.find((l) => l.candidates.length) : undefined;
  for (const l of offSale) if (l !== offer) before.push(T(ctx).food.notOnSale(offName(l), placeName, false));
  if (offer) {
    ctx.state.food!.asking = { kind: "dish", raw: offName(offer), qty: offer.qty, words: "", candidates: offer.candidates.slice(0, 10),
                               lead: T(ctx).food.notOnSale(offName(offer), placeName, true) };
  }
  if (!basket.length && !ambiguous && !offer) {
    // Nothing chosen yet: the menu, as a list (at most ten dishes; the rest by name).
    return showMenu(ctx, sourceId, placeName, before.join("\n") || undefined);
  }
  if (basket.length) await priced(ctx, basket);
  return next(ctx, before.join("\n") || undefined);
}

/** Where the food goes: a village said (resolve_place), else the customer's usual place; the words about where kept for the rider. */
async function whereTo(ctx: ToolContext, intent: OrderIntent): Promise<void> {
  const said = intent.address?.village ?? null;
  if (said) {
    const r = await rpc<{ village: { village_id: string } | null; served: boolean; saved_places: { place_id: string; village_id: string | null }[] }>(
      ctx, "resolve_place", { p_party: ctx.partyId, p_village: said, p_landmark: intent.address?.landmark ?? null }).catch(() => null);
    if (r?.village && r.served) {
      ctx.state.villageId = r.village.village_id;
      const p = await rpc<{ place_id: string } | null>(ctx, "customer_usual_place", { p_party: ctx.partyId, p_village: r.village.village_id }).catch(() => null);
      ctx.state.placeId = p?.place_id ?? null;
    }
  } else if (!ctx.state.placeId || !ctx.state.villageId) {
    const p = await rpc<{ place_id: string; village_id: string } | null>(ctx, "customer_usual_place", { p_party: ctx.partyId }).catch(() => null);
    if (p) { ctx.state.placeId ??= p.place_id; ctx.state.villageId ??= p.village_id; }
  }
  const { directionsOf } = await import("./pipeline");
  const words = directionsOf(intent);
  if (words) ctx.state.directions = words;
}

/** A line set or added: the same dish with the same options is one line (its count set); with other options, another line. */
function upsert(lines: QuoteLineInput[], l: QuoteLineInput): QuoteLineInput[] {
  const out = lines.map((x) => ({ ...x }));
  const i = out.findIndex((x) => keyOf(x) === keyOf(l));
  if (i >= 0) out[i] = { ...out[i]!, qty: l.qty }; else out.push(l);
  return out;
}

/** The basket priced by the database for this customer, and kept as the basket in hand. */
async function priced(ctx: ToolContext, lines: QuoteLineInput[]): Promise<Quote> {
  const villageId = ctx.state.villageId ?? null;
  const quote = await rpc<Quote>(ctx, "quote_order", { p_lines: lines, p_village: villageId, p_pickup: false, p_party: ctx.partyId });
  ctx.state.lastQuote = { lines, villageId, pickup: false, quote };
  ctx.state.basketAt = Date.now();
  ctx.state.pending ??= { payment: "cod", changeForUsd: null, notes: ctx.state.directions ?? null };
  ctx.basketChanged = true;
  return quote;
}

/** The place's menu as one list (at most ten dishes, each with its price), after `before`. */
async function showMenu(ctx: ToolContext, sourceId: string, placeName: string, before?: string): Promise<Done> {
  const lg = lang(ctx);
  const menu = await rpc<{ ok: boolean; dishes: DishCandidate[] }>(ctx, "place_menu", { p_party: ctx.partyId, p_source: sourceId });
  if (!menu.ok || !menu.dishes.length) return say(ctx, [before, T(ctx).fixed.notAvailable([placeName])].filter(Boolean).join("\n"), "food_no_menu");
  const rows = menu.dishes.slice(0, 10).map((d) => dishRow(d, lg));
  const text = [before, T(ctx).food.menu(placeName, menu.dishes.length > 10)].filter(Boolean).join("\n");
  return (await deliver(ctx, list(text, T(ctx).food.dishesButton, rows), `[food menu] ${text} ${rows.map((r) => r.description).join(" | ")}`)).ok
    ? { done: true, path: "food_menu" } : { done: false };
}
function dishRow(d: DishCandidate, lg: Lang) {
  const n = name(d, lg); const tail = ` · ${usd(Number(d.price_usd))}`;
  const desc = `${n}${tail}`;
  return { id: foodDishId(d.product_id), title: listTitle(n), description: desc.length <= 72 ? desc : `${n.slice(0, 71 - tail.length).trimEnd()}…${tail}` };
}

/**
 * What comes next for the food basket in hand: which dish a word meant; then each required choice; then each optional one, offered once;
 * then the place's hours; then the grocery path's own steps (the minimum, the pin, the card), through `route`.
 */
export async function next(ctx: ToolContext, before?: string, route?: Route): Promise<Done> {
  const food = ctx.state.food;
  const held = ctx.state.lastQuote;
  if (!food) return { done: false };
  const lg = lang(ctx);
  if (food.asking?.kind === "dish") {
    const a = food.asking;
    const rows = a.candidates.map((d) => dishRow(d, lg));
    const text = [before, a.lead ?? T(ctx).food.whichDish(a.raw, food.name)].filter(Boolean).join("\n");
    return (await deliver(ctx, list(text, T(ctx).food.dishesButton, rows), `[food which] ${text}`)).ok ? { done: true, path: "food_which" } : { done: false };
  }
  if (!held?.lines.length) return { done: false };
  const lines = held.quote.lines as FoodLine[];
  // a required choice first, then an optional one not yet offered
  for (const l of lines) {
    const g = (l.needs ?? [])[0];
    if (g) return askGroup(ctx, l, g, true, before);
  }
  for (const l of lines) {
    const g = (l.open_groups ?? []).find((x) => !(food.offered ?? []).includes(`${l.key}|${x.group_id}`));
    if (g) return askGroup(ctx, l, g, false, before);
  }
  food.asking = null;
  const closed = held.quote.issues.find((i) => i.code === "place_closed");
  if (closed) return say(ctx, [before, T(ctx).food.closed(food.name, closed.reason === "hours" ? (closed.opens as string | null) ?? null : null)].filter(Boolean).join("\n"), "food_place_closed");
  const go = route ?? (await import("./pipeline")).routeBasket;
  const terms = ctx.state.pending ?? { payment: "cod" as const, changeForUsd: null, notes: ctx.state.directions ?? null };
  return go(ctx, { lines: held.lines, villageId: held.villageId, placeId: ctx.state.placeId ?? null, pickup: false }, terms, held.quote, before);
}

/** One group of one dish as a question: buttons for two or three short options, a list otherwise; an optional group has "no, thanks" first. */
async function askGroup(ctx: ToolContext, l: FoodLine, g: Group, required: boolean, before?: string): Promise<Done> {
  const lg = lang(ctx);
  const food = ctx.state.food!;
  food.asking = { kind: "group", key: String(l.key), productId: String(l.product_id), groupId: g.group_id, required };
  if (!required) food.offered = [...(food.offered ?? []), `${l.key}|${g.group_id}`];
  const dish = productName(l, lg);
  const group = optName(g, lg);
  const text = [before, T(ctx).food.choose(dish, group, required)].filter(Boolean).join("\n");
  const priceOf = (d: number) => (Number(d) > 0 ? ` +${usd(Number(d))}` : "");
  const opts = g.options.map((o) => ({ id: foodOptionId(o.id), title: optName(o, lg), delta: Number(o.price_delta_usd) }));
  const all = required ? opts : [{ id: foodNoneId(g.group_id), title: T(ctx).food.noThanks, delta: 0 }, ...opts];
  const short = all.length <= 3 && all.every((o) => (o.title + priceOf(o.delta)).length <= 20);
  const msg: Outbound = short
    ? buttons(text, all.map((o) => ({ id: o.id, title: `${o.title}${priceOf(o.delta)}` })))
    : list(text, T(ctx).food.chooseButton, all.slice(0, 10).map((o) => ({ id: o.id, title: listTitle(o.title), description: `${o.title}${priceOf(o.delta)}`.slice(0, 72) })));
  return (await deliver(ctx, msg, `[food choice] ${text} ${all.map((o) => o.title).join(" | ")}`)).ok ? { done: true, path: "food_choice" } : { done: false };
}

/** A tap on a food question: an option, "no, thanks", or a dish. Not done when it is not for the question waiting (an old button). */
export async function takeFoodTap(ctx: ToolContext, tap: FoodTap, route: Route): Promise<Done> {
  // VOICE1: the answer to «قصدك …؟». Yes: the order goes on from that place with the words already said. No: the places, by name.
  if (tap.kind === "place" || tap.kind === "noplace") {
    const g = ctx.state.placeGuess;
    ctx.state.placeGuess = null;
    if (tap.kind === "place" && g && g.sourceId === tap.sourceId) return orderFrom(ctx, g.sourceId, g.name, g.intent);
    const places = await rpc<PlaceChoice[]>(ctx, "food_place_choices", { p_party: ctx.partyId }).catch(() => [] as PlaceChoice[]);
    return say(ctx, T(ctx).food.placeUnknown(places.map((p) => p.name)), "food_place_unknown");
  }
  const food = ctx.state.food;
  if (!food) return { done: false };
  if (tap.kind === "dish") {
    const a = food.asking?.kind === "dish" ? food.asking : null;
    const qty = a?.qty ?? 1;
    const options = a ? await rpc<string[]>(ctx, "dish_options_in_text", { p_product: tap.productId, p_text: a.words }).catch(() => [] as string[]) : [];
    food.asking = null;
    await priced(ctx, upsert(ctx.state.lastQuote?.lines ?? [], { product_id: tap.productId, qty, options, source_id: food.sourceId }));
    return next(ctx, undefined, route);
  }
  const a = food.asking;
  if (!a || a.kind !== "group") return { done: false };
  if (tap.kind === "none") {
    if (tap.groupId !== a.groupId) return { done: false };
    food.asking = null;
    return next(ctx, undefined, route);
  }
  return choose(ctx, a, [tap.optionId], route);
}

/** The option(s) chosen for the group asked: added to that line, the basket priced again, and on. */
async function choose(ctx: ToolContext, a: Extract<FoodAsk, { kind: "group" }>, optionIds: string[], route: Route): Promise<Done> {
  const held = ctx.state.lastQuote;
  if (!held) return { done: false };
  const lines = held.quote.lines as FoodLine[];
  const target = lines.find((l) => l.key === a.key);
  const group = [...(target?.needs ?? []), ...(target?.open_groups ?? [])].find((g) => g.group_id === a.groupId);
  const ids = optionIds.filter((id) => group?.options.some((o) => o.id === id)).slice(0, Math.max(1, group?.max ?? 1));
  if (!target || !group || !ids.length) return { done: false };
  const i = held.lines.findIndex((l) => keyOf(l) === normKey(a.key));
  if (i < 0) return { done: false };
  const updated = held.lines.map((l, j) => (j === i ? { ...l, options: [...new Set([...(l.options ?? []), ...ids])] } : l));
  ctx.state.food!.asking = null;
  await priced(ctx, merge(updated));
  return next(ctx, undefined, route);
}
const normKey = (k: string) => { const [p, o = ""] = k.split(":"); return `${p}:${o.split(",").filter(Boolean).sort().join(",")}`; };
/** Two lines that became the same dish with the same options are one line, their counts added. */
function merge(lines: QuoteLineInput[]): QuoteLineInput[] {
  const out: QuoteLineInput[] = [];
  for (const l of lines) {
    const j = out.findIndex((x) => keyOf(x) === keyOf(l));
    if (j >= 0) out[j] = { ...out[j]!, qty: Number(out[j]!.qty) + Number(l.qty) }; else out.push({ ...l });
  }
  return out;
}

/** A typed answer to the option question waiting («كبير», "saj please", «بلا»). Not done when the words name none of its options. */
export async function typedAnswer(ctx: ToolContext, said: string, route: Route): Promise<Done> {
  const a = ctx.state.food?.asking;
  if (!a || a.kind !== "group") return { done: false };
  const ids = await rpc<string[]>(ctx, "dish_options_in_text", { p_product: a.productId, p_text: said }).catch(() => [] as string[]);
  if (ids.length) {
    const r = await choose(ctx, a, ids, route);
    if (r.done) return r;
  }
  if (!a.required && NO_THANKS.test(said.trim())) { ctx.state.food!.asking = null; return next(ctx, undefined, route); }
  return { done: false };
}
const NO_THANKS = /^(?:لا|لأ|لا شكرا|لا شكراً|بلا|بدون|ما بدي|no|no thanks|nope|non|non merci|la2|la|bala|mesh lazem|msh lazem)[.!]?$/iu;

/** issueCard: once a card went, the other shop's basket kept apart is the basket in hand again. */
export function afterCard(ctx: ToolContext): void {
  const p = ctx.state.parked;
  ctx.state.food = null;
  if (!p) return;
  ctx.state.parked = null;
  ctx.state.lastQuote = p.lastQuote; ctx.state.pending = p.pending; ctx.state.food = p.food;
}

// ---------- the customer's answers to what staff found (0250) ----------
export async function takeCallAnswer(ctx: ToolContext, a: CallAnswer): Promise<Done> {
  const r = await rpc<{ ok: boolean; reason?: string; answer?: string; short_code?: string; total_usd?: number; status?: string }>(ctx, "food_call_answer",
    { p_call: a.callId, p_party: ctx.partyId, p_answer: a.answer });
  const F = T(ctx).food;
  if (!r.ok) return say(ctx, r.short_code ? F.notWaiting(r.short_code) : F.notWaiting(""), "food_call_stale");
  if (r.answer === "cancelled") return say(ctx, F.answerCancelled(r.short_code ?? ""), "food_call_cancelled");
  return say(ctx, r.answer === "drop" ? F.dropped(r.short_code ?? "", Number(r.total_usd)) : F.priceAccepted(r.short_code ?? "", Number(r.total_usd)), "food_call_answered");
}
