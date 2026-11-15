// The Concierge's hands. Each tool is a thin wrapper over a SQL function or the Compliance Gateway:
// the model chooses what to call, the database decides what is true, the gateway decides what may be sent.
import type { SupabaseClient } from "@supabase/supabase-js";
import { askLocation, buttons as buttonMsg, type Outbound } from "@ak/wa/kapso";
import type { SendResult } from "@ak/wa/gateway";
import type { ConciergeTools } from "./concierge";
import { buttonReplyText, formatOrderCard, formatWindowChoice, KEPT_BUTTON, type CardAddress, type CardInput, type DeliveryWindow, type Quote } from "./order-card";
import { messages, productName, type Lang } from "./messages";
import { checkModelText, GUARD_HINT, type Violation } from "./output-guard";
import { catalogMessages } from "./catalog-messages";
import { handoffToCase, openCase, tellOpened, type SupportNote } from "./support";
import { applyEdits, askMinimum, underMinimumOnly, type BasketEdit } from "./basket";

/** What survives between turns of one conversation. Kept in the Durable Object, not in the model. */
export interface ConversationState {
  /** M1: the language of our fixed messages in this conversation: from the reading, or the words of a turn code answers alone. */
  lang?: Lang;
  villageId?: string | null;
  placeId?: string | null;
  directions?: string | null;          // the customer's own words about where they are
  lastQuote?: { lines: QuoteLineInput[]; villageId: string | null; pickup: boolean; quote: Quote } | null;
  history?: { role: "customer" | "assistant"; text: string }[];
  /**
   * A card is ready to go out from lastQuote once the customer supplies what is missing: a pin, the village when the pin was
   * not clear (a tap), the house and floor for a first delivery to a new place, or a phone number the rider can call.
   */
  awaiting?: "pin" | "village" | "address" | "phone" | "opening" | "window" | "minimum" | null;
  /** B1a: when the basket in hand last changed (ms). A basket nobody touched for BASKET_KEEP_MS is let go (basket.ts). */
  basketAt?: number | null;
  /** What the last pin said (B4): the pin decides the village. Unsure means the customer chooses from `candidates` by tap. */
  pinCheck?: PinCheck | null;
  pending?: CardTerms | null;
  /** When the "same as last time" button was last offered (ms). */
  repeatOfferedAt?: number;
  /** Restrictions the customer stated for the order being built (1.14): they go on its card notes. */
  orderRestrictions?: string[] | null;
  /** Restrictions offered for keeping, waiting for the customer's yes or no. */
  pendingRestrictions?: string[] | null;
  /** W1: the delivery window chosen for the basket in hand (by tap or in words). The card made for that basket carries it. */
  slotId?: string | null;
  /** W1 (2.8 d): the customer tapped "edit" on a confirmed scheduled order; the next basket is its replacement (a new card). */
  replacing?: { orderId: string; shortCode: string; slotId: string | null; since?: number } | null;
  /** HO1: the turn key that was already queued again once after a technical failure (the second failure gets the fixed line). */
  technicalRetry?: string | null;
}
export interface PinCheck {
  status: "located" | "unsure" | "outside"; villageAr: string | null; villageEn?: string | null; served: boolean | null;
  /** The village the conversation had before the pin (usually from the text), when the pin put it somewhere else. */
  saidAr: string | null;
  candidates: { village_id: string; name_ar: string | null; name_en: string }[];
}
/** Everything about a card that is not its lines. */
export interface CardTerms { payment: "cod" | "whish" | "omt"; changeForUsd: number | null; notes: string | null;
  /** Set when the database refused cash on delivery and the card goes out prepaid (1.4 dues, 1.16 first-order cap). */
  prepay?: { reason: "dues" } | { reason: "first_order"; maxCodUsd: number } | null }
export interface QuoteLineInput { product_id: string; qty: number; modifiers?: string[]; note?: string | null; source_id?: string | null }

export interface ToolContext {
  db: SupabaseClient;
  partyId: string;
  conversationId: string;
  state: ConversationState;
  /** Sends through the Compliance Gateway. The only way a tool can reach the customer. */
  /** authored: set on text the model wrote, so the gateway checks it again (A2's second lock for 1.5 and 1.10). */
  send: (msg: Outbound, opts?: { orderId?: string; authored?: { by: "model"; approvedFacts?: string[] } }) => Promise<SendResult>;
  sent: { count: number; texts: string[] };   // message economy: what this turn has already sent
  /** Food-fact attributes a tool returned an approved record for during this turn (1.10). Empty until the facts tool (1.11). */
  approvedFacts?: Set<string>;
  /** The customer turn this runs in (SP1, G1-21): a retried turn finds the order its first attempt made, instead of a second. */
  turnKey?: string;
  /** HO1: what the turn learned about cases (opened, reminded, a food fact not on record, a stalled loop). */
  support?: SupportNote;
  /** B1a (SIM1 fix 10): search_catalog ran this turn, so a claim about what the catalogue holds has a tool result behind it. */
  searched?: boolean;
  /** B1a: the conversation's open cases (HO1), so "where is my order?" with no order and no basket recalls the open request. */
  openCaseIds?: string[];
}

const MAX_SENDS_PER_TURN = 2;
/** Every fixed message in this conversation's language (M1). */
const T = (ctx: ToolContext) => messages(ctx.state.lang);

async function rpc<T>(db: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

export async function deliver(ctx: ToolContext, msg: Outbound, summary: string, orderId?: string, byModel = false): Promise<{ ok: true } | { ok: false; error: string }> {
  if (ctx.sent.count >= MAX_SENDS_PER_TURN) return { ok: false, error: "message_budget_reached_for_this_turn" };
  const r = await ctx.send(msg, { orderId, ...(byModel ? { authored: { by: "model" as const, approvedFacts: [...(ctx.approvedFacts ?? [])] } } : {}) });
  if (!r.ok) return { ok: false, error: `not_sent:${r.refused}` };
  ctx.sent.count++; ctx.sent.texts.push(summary);
  return { ok: true };
}

export function makeConciergeTools(ctx: ToolContext): ConciergeTools {
  return {
    async search_catalog({ query, source_hint }) {
      const r = await rpc<{ matches: Record<string, unknown>[]; reason: string | null }>(ctx.db, "search_catalog",
        { p_query: query, p_source_hint: source_hint ?? null, p_limit: 6 });
      ctx.searched = true;
      // Trim to what the model needs to choose; ids must be passed back untouched.
      return {
        reason: r.reason,
        matches: r.matches.map((m) => ({
          product_id: m.product_id, source_id: m.source_id, name: m.name_en, name_ar: m.name_ar, brand: m.brand,
          unit: m.sell_unit, price_usd: m.price_usd, in_stock: Number(m.available) > 0, source: m.source_name, score: m.score,
        })),
      };
    },

    async resolve_place({ village, landmark, verbatim }) {
      const r = await rpc<{ village: { village_id: string; confidence: number } | null; landmark: { landmark_id: string } | null;
                            served: boolean; needs_pin: boolean; reason: string | null; saved_places: { place_id: string; village_id: string | null }[] }>(
        ctx.db, "resolve_place", { p_party: ctx.partyId, p_village: village ?? null, p_landmark: landmark ?? null });
      if (verbatim) ctx.state.directions = verbatim;
      if (r.village && r.served) ctx.state.villageId = r.village.village_id;
      else if (!village && r.saved_places.length === 1 && r.saved_places[0]!.village_id) {
        ctx.state.villageId = r.saved_places[0]!.village_id; ctx.state.placeId = r.saved_places[0]!.place_id;
      }
      return r;
    },

    async quote_order({ lines, remove, pickup }) {
      // B1a (SIM1 fixes 3 and 4): the model changes the basket by explicit edits, never by replacing it. Each line sets that
      // product's quantity (added when new); `remove` takes products off; a line not named stays. A substitute the last quote
      // listed for a line that ran out takes that line's place. The whole basket is priced and kept.
      const held = ctx.state.lastQuote;
      const substituteOf = new Map<string, string>();
      for (const i of held?.quote.issues ?? []) {
        if ((i.code === "out_of_stock" || i.code === "insufficient_stock") && Array.isArray(i.substitutes))
          for (const x of i.substitutes as { product_id?: string }[]) if (x.product_id && i.product_id) substituteOf.set(x.product_id, String(i.product_id));
      }
      const edits: BasketEdit[] = [
        ...(lines ?? []).map((l) => ({ op: "set" as const, product_id: l.product_id, qty: l.qty, source_id: l.source_id ?? null, modifiers: l.modifiers,
                                       note: l.note ?? null, replaces: substituteOf.get(l.product_id) ?? null })),
        ...(remove ?? []).map((p) => ({ op: "remove" as const, product_id: p })),
      ];
      const basket = applyEdits(held?.lines ?? [], edits).lines;
      const villageId = pickup ? null : ctx.state.villageId ?? null;
      const quote = await rpc<Quote>(ctx.db, "quote_order", { p_lines: basket, p_village: villageId, p_pickup: !!pickup });
      ctx.state.lastQuote = { lines: basket, villageId, pickup: !!pickup, quote };
      ctx.state.basketAt = Date.now();
      return { ...quote, basket_note: "These lines are the customer's whole basket now. send_confirmation sends exactly this basket." };
    },

    async food_facts({ product_ids, restrictions }) {
      // Facts come only from approved records (1.11, migration 0021). An approved, current fact with a usable status unlocks
      // that attribute for the output guard for the rest of this turn (1.10); nothing else does.
      const ids = [...new Set(product_ids ?? [])].slice(0, 6);
      const codes = (restrictions ?? []).map((r) => r.trim().toLowerCase()).filter(Boolean);
      const out = [];
      for (const id of ids) {
        const facts = await rpc<FoodFact[]>(ctx.db, "product_food_facts", { p_product: id });
        for (const f of facts) if (!f.expired && USABLE.has(f.status)) (ctx.approvedFacts ??= new Set()).add(guardAttribute(f.attribute, f.kind));
        const check = codes.length ? await rpc<unknown>(ctx.db, "product_meets_restrictions", { p_product: id, p_restrictions: codes }) : null;
        out.push({ product_id: id, facts: facts.filter((f) => !f.expired), no_approved_facts: facts.every((f) => f.expired), restrictions: check });
      }
      return { products: out, rule: "State only these facts, each with its status. Anything not listed is not verified: say so and offer to ask." };
    },

    async ask_location_pin({ text }) {
      const bad = await guard(ctx, [text]);
      if (bad) return bad;
      const r = await deliver(ctx, askLocation(text), `[location request] ${text}`, undefined, true);
      // A priced basket waits on the pin, whoever asked for it (B4: the basket was lost when the model asked).
      const q = ctx.state.lastQuote;
      if (r.ok && q && q.lines.length && !q.pickup) {
        ctx.state.awaiting = "pin";
        ctx.state.pending ??= { payment: "cod", changeForUsd: null, notes: ctx.state.directions ?? null };
      }
      return r;
    },

    async send_confirmation({ payment_method, change_for_usd, notes }) {
      const q = ctx.state.lastQuote;
      if (!q) return { ok: false, error: "call_quote_order_first" };
      if (!q.quote.ok) return { ok: false, error: "quote_has_issues", issues: q.quote.issues };
      return issueCard(ctx, { lines: q.lines, villageId: q.villageId, placeId: ctx.state.placeId ?? null, pickup: q.pickup },
        { payment: payment_method ?? "cod", changeForUsd: change_for_usd ?? null, notes: [notes, ctx.state.directions].filter(Boolean).join(" | ") || null });
    },

    async reply({ text, buttons, price_of }) {
      // The model's own words are checked first (1.5). Prices it asked for are added after, by code, from quote_order.
      const bad = await guard(ctx, [text, ...(buttons ?? []).map((b) => b.title)]);
      if (bad) return bad;
      const prices = price_of?.length ? await priceLines(ctx, price_of) : null;
      if (prices && !prices.ok) return prices;
      const body = prices ? `${text}\n${prices.text}` : text;
      const msg: Outbound = buttons?.length ? buttonMsg(body, buttons) : { type: "text", text: { body } };
      // The gateway re-checks the model's words. Not when code appended prices: its check reads the whole body, and the prices
      // would be refused as money in model text. Those words were checked above, before the prices were added.
      return deliver(ctx, msg, body, undefined, !prices);
    },

    async show_catalog({ category, product_id }) {
      // 1.21: what to show comes from the database (catalog_list); the words and the message are code's. At most the turn's two sends.
      const r = await catalogMessages(ctx.db, { category: category ?? null, product_id: product_id ?? null });
      // B1a (SIM1 fix 10): the WhatsApp catalog cannot be shown (not connected, or nothing with a picture): one fixed line by code
      // that asks for the items in words. The model never words the failure ("the catalogue is not ready"). An unknown category
      // goes back to the model with the list of categories, to try again.
      if (!r.ok && r.error !== "unknown_category") {
        const s = T(ctx).support.browseInWords;
        const told = await deliver(ctx, { type: "text", text: { body: s } }, s);
        return told.ok ? { ok: true, note: "The catalog with pictures is not available; the customer was asked to type what they need." } : told;
      }
      if (!r.ok) return r;
      for (const msg of r.messages) {
        const sent = await deliver(ctx, msg, r.summary);
        if (!sent.ok) return sent;
      }
      return { ok: true, messages: r.messages.length };
    },

    // HO1: a person is added; the bot is never removed. A case opens (or the open one is recalled) and the customer is told
    // once; a food fact the records do not hold gets the fixed "not confirmed" line and no case (support.ts).
    async handoff_human({ reason }) {
      return handoffToCase(ctx, String(reason ?? "model_handoff"), "model", ctx.support ??= {});
    },
  };
}

/**
 * Runs the output checks on text the model wrote. A refusal is logged (code and the matched fragment, never the whole text)
 * and returned to the model so it can reword. Nothing is sent.
 */
export async function guard(ctx: ToolContext, texts: string[]): Promise<{ ok: false; error: string; hint: string } | null> {
  let v: Violation | null = null;
  for (const t of texts) { v = checkModelText(t, { approvedFacts: ctx.approvedFacts, catalogueSearched: !!ctx.searched }); if (v) break; }
  if (!v) return null;
  await ctx.db.from("agent_runs").insert({ agent: "output_guard", conversation_id: ctx.conversationId, outcome: "refused",
                                           trace: { code: v.code, match: v.match.slice(0, 60) } });
  return { ok: false, error: `refused:${v.code}`, hint: GUARD_HINT[v.code] };
}

interface FoodFact { attribute: string; kind: string; value: string; status: string; source: string | null; expired: boolean }
const USABLE = new Set(["certified", "declared", "calculated"]);
/** The output guard's attribute for a food-fact code of 0021: gluten and the four diets by name, other allergens together. */
export function guardAttribute(code: string, kind: string): string {
  if (["gluten", "halal", "vegetarian", "vegan", "fasting"].includes(code)) return code;
  if (kind === "allergen") return "allergens";
  return "nutrition";                                  // ingredients and nutrition panels
}

const MAX_PRICED = 6;
/** One line per product, priced by quote_order (one unit, at the hub): the only way a price appears in a Concierge reply. */
async function priceLines(ctx: ToolContext, productIds: string[]): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const ids = [...new Set(productIds)].slice(0, MAX_PRICED);
  const q = await rpc<{ lines: { product_id?: string; name: string; name_ar: string | null; unit_price_usd: number; ok: boolean }[] }>(
    ctx.db, "quote_order", { p_lines: ids.map((product_id) => ({ product_id, qty: 1 })), p_village: null, p_pickup: true });
  if (q.lines.length === 0) return { ok: false, error: "price_of_unknown_products" };
  const lang = ctx.state.lang ?? "ar";
  return { ok: true, text: q.lines.map((l) => T(ctx).fixed.priced(productName(l, lang), Number(l.unit_price_usd), l.ok)).join("\n") };
}

export type CardResult = { ok: true; order_code?: string; waiting_for?: "phone" | "opening" | "window" | "minimum" } | { ok: false; error: string; issues?: unknown };

/**
 * Creates the order from priced lines and sends the card. The deterministic path and the Concierge's send_confirmation
 * tool both come through here, so both get the same checks. The card is built from the database's quote, never from model text.
 * `before` is a short fixed text sent first (for example, what could not be included).
 */
export async function issueCard(ctx: ToolContext, basket: { lines: QuoteLineInput[]; villageId: string | null; placeId: string | null; pickup: boolean },
                                terms: CardTerms, opts: { before?: string; slotId?: string | null } = {}): Promise<CardResult> {
  // W1: the window this card is for. Given, or chosen for the basket in hand, or the window of the order this card replaces.
  // A pickup has none (2.8: windows are for deliveries to the door).
  const slotId = basket.pickup ? null : opts.slotId !== undefined ? opts.slotId : ctx.state.slotId ?? ctx.state.replacing?.slotId ?? null;
  // A rider must be able to call. WhatsApp may not have told us the number (1.19): ask for one before the card, and keep the
  // basket so the card goes out as soon as the number arrives.
  if (!basket.pickup && !(await rpc<string | null>(ctx.db, "customer_contact_phone", { p_party: ctx.partyId }))) {
    const quote = await rpc<Quote>(ctx.db, "quote_order", { p_lines: basket.lines, p_village: basket.villageId, p_pickup: false, p_slot: slotId });
    ctx.state.slotId = slotId;
    ctx.state.lastQuote = { lines: basket.lines, villageId: basket.villageId, pickup: false, quote };
    if (basket.placeId) ctx.state.placeId = basket.placeId;
    ctx.state.awaiting = "phone"; ctx.state.pending = terms;
    const text = opts.before ? `${opts.before}\n${T(ctx).fixed.askPhone}` : T(ctx).fixed.askPhone;
    const asked = await deliver(ctx, { type: "text", text: { body: text } }, text);
    return asked.ok ? { ok: true, waiting_for: "phone" } : asked;
  }
  // Every restriction that applies goes with the order to whoever prepares it: the kept ones, and any stated for this order (1.14).
  const kept = await rpc<string[]>(ctx.db, "customer_restrictions", { p_party: ctx.partyId });
  terms = { ...terms, notes: withRestrictionNote(terms.notes, [...kept, ...(ctx.state.orderRestrictions ?? [])]) };
  const created = await rpc<{ created: boolean; order_id?: string; short_code?: string; quote: Quote }>(ctx.db, "create_order_for_turn", {
    p_turn_key: ctx.turnKey ?? null, p_customer: ctx.partyId, p_conversation: ctx.conversationId, p_lines: basket.lines, p_village: basket.villageId,
    p_place: basket.placeId, p_pickup: basket.pickup, p_payment: terms.payment, p_change_for: terms.changeForUsd, p_notes: terms.notes,
    p_slot: slotId,
  });
  if (!created.created && created.quote.issues.some((i) => i.code === "fx_paused")) {
    // D1 (3.8): quoting is paused until a person confirms today's rate. The basket waits; the customer is told once.
    ctx.state.lastQuote = { lines: basket.lines, villageId: basket.villageId, pickup: basket.pickup, quote: created.quote };
    const told = await deliver(ctx, { type: "text", text: { body: T(ctx).fixed.fxPaused } }, T(ctx).fixed.fxPaused);
    return told.ok ? { ok: false, error: "fx_paused" } : told;
  }
  // B1a (SIM1 fix 1): under the minimum, said by code with the amounts, before anything else; the basket waits for more.
  if (!created.created && underMinimumOnly(created.quote) && !ctx.state.replacing) {
    const told = await askMinimum(ctx, basket, terms, created.quote, opts.before);
    return told ? { ok: true, waiting_for: "minimum" } : { ok: false, error: "not_sent" };
  }
  const closed = created.created ? undefined : created.quote.issues.find((i) => i.code === "closed");
  if (closed) {
    // K1 (B4's leftover): we closed while the basket waited (on the pin, the house, the number). Kept for when we open.
    const kept = await keepUntilOpen(ctx, { ...basket, quote: created.quote }, terms, String(closed.opens ?? ""));
    return kept.ok ? { ok: true, waiting_for: "opening" } : kept;
  }
  // W1: the window went full, closed or past its cut-off while the basket waited (or never fitted it). The basket is kept and
  // the open windows are offered instead; it is never delivered "now" in its place.
  const slotIssue = created.created ? undefined : created.quote.issues.find((i) => i.code.startsWith("slot_"));
  if (slotIssue && slotId) {
    ctx.state.lastQuote = { lines: basket.lines, villageId: basket.villageId, pickup: basket.pickup, quote: created.quote };
    if (basket.placeId) ctx.state.placeId = basket.placeId;
    ctx.state.pending = terms; ctx.state.slotId = null; ctx.state.awaiting = "window";
    const windows = await rpc<DeliveryWindow[]>(ctx.db, "open_delivery_windows", { p_village: basket.villageId, p_fresh: !!created.quote.bought_to_order });
    const body = [opts.before, T(ctx).windows.gone].filter(Boolean).join("\n");
    const offered = await deliver(ctx, formatWindowChoice(null, windows, { lang: ctx.state.lang, body }), `[windows] ${body}`);
    return offered.ok ? { ok: true, waiting_for: "window" } : offered;
  }
  if (!created.created) {
    // The customer owes from a delivery nobody answered: the database refuses cash on delivery (0004 policy). The card goes
    // out as a prepaid order instead, and says why (1.4). Whish is the default transfer; the customer can still edit.
    // Same for a first order above the first-order cash cap (1.16).
    const refusal = terms.payment === "cod" ? created.quote.issues.find((i) => i.code === "prepay_required" || i.code === "first_order_cod_cap") : undefined;
    if (refusal) return issueCard(ctx, basket, { ...terms, payment: "whish", changeForUsd: null,
      prepay: refusal.code === "first_order_cod_cap" ? { reason: "first_order", maxCodUsd: Number(refusal.max_cod_usd) } : { reason: "dues" } }, opts);
    ctx.state.lastQuote = { lines: basket.lines, villageId: basket.villageId, pickup: basket.pickup, quote: created.quote };
    return { ok: false, error: "quote_changed", issues: created.quote.issues };
  }
  // What we owe the customer comes off this order at once, on its own card line (C2's request). The database caps it at the
  // order's total, records it once per order, gives it back if the order is cancelled, and uses it up when the order is paid.
  const credit = await rpc<{ applied_usd: number; total_usd: number }>(ctx.db, "apply_customer_credit", { p_order: created.order_id, p_by: null });
  if (Number(credit.applied_usd) > 0) {
    const total = Math.round((Number(created.quote.total_usd) - Number(credit.applied_usd)) * 100) / 100;
    const fx = created.quote.fx_rate_lbp;
    created.quote = { ...created.quote, credit_usd: Number(credit.applied_usd), total_usd: total, total_lbp: fx ? Math.round(total * fx / 1000) * 1000 : null };
  }
  // W1 (2.8 d): this card changes a confirmed scheduled order. Nothing moves until the customer confirms it (confirm_order_checked
  // cancels the old order in the same transaction). Too late, or already paid: the new card is withdrawn and never sent.
  let replaces: string | null = null;
  let window: DeliveryWindow | null = created.quote.window ?? null;
  const old = ctx.state.replacing;
  if (old) {
    ctx.state.replacing = null;
    // A scheduled delivery changed into a pickup has no window to keep (2.8: windows are for the door): a person handles it.
    const link = basket.pickup ? { ok: false, reason: "paid", short_code: old.shortCode } as { ok: boolean; reason?: string; replaces?: string; short_code?: string; window?: DeliveryWindow | null }
      : await rpc<{ ok: boolean; reason?: string; replaces?: string; short_code?: string; window?: DeliveryWindow | null }>(ctx.db,
          "link_replacement_order", { p_new: created.order_id, p_old: old.orderId, p_party: ctx.partyId });
    if (!link.ok) {
      await rpc(ctx.db, "transition_order", { p_order: created.order_id, p_to: "cancelled", p_actor: "system", p_actor_id: null, p_reason: `replacement_refused:${link.reason ?? ""}` });
      ctx.state.lastQuote = null; ctx.state.awaiting = null; ctx.state.pending = null; ctx.state.slotId = null;
      if (link.reason === "paid") {
        // A change to an order already paid by transfer goes to a person (C3's decision); so does a change to pickup.
        // HO1: a case of kind order_problem on the old order; the bot stays in the chat.
        const c = await openCase(ctx, "order_problem", `${basket.pickup ? "change_to_pickup" : "change_paid_order"}: ${link.short_code ?? old.shortCode}`,
                                 { orderId: old.orderId, source: "code" });
        if (c.opened) (ctx.support ??= {}).opened = c;
        const told = c.opened ? await tellOpened(ctx, c, old.orderId) : true;
        return told ? { ok: false, error: "change_paid" } : { ok: false, error: "not_sent" };
      }
      const text = buttonReplyText({ status: "too_late", short_code: link.short_code ?? old.shortCode, changed: false, window: link.window ?? null }, {}, ctx.state.lang);
      const told = await deliver(ctx, { type: "text", text: { body: text } }, text, old.orderId);
      return told.ok ? { ok: false, error: link.reason ?? "change_refused" } : told;
    }
    replaces = link.replaces ?? old.shortCode;
    window = link.window ?? window;
  }
  const sent = await sendCard(ctx, { orderId: created.order_id!, shortCode: created.short_code!, quote: created.quote,
                                      paymentMethod: terms.payment, changeForUsd: terms.changeForUsd, prepay: terms.prepay ?? null, window, replaces }, opts.before);
  if (!sent.ok) return sent;
  // A card went out: any order kept overnight is taken up or replaced (audit item 4). Never stops the turn.
  await ctx.db.rpc("clear_kept_order", { p_party: ctx.partyId }).then(() => undefined, () => undefined);
  // The directions went onto the order (and the place); they are not carried into the next order.
  ctx.state.lastQuote = null; ctx.state.awaiting = null; ctx.state.pending = null; ctx.state.orderRestrictions = null; ctx.state.directions = null;
  ctx.state.slotId = null;
  return { ok: true, order_code: created.short_code! };
}

/**
 * M1: the card in the conversation's language, with the order's address (order_address, 0120), sent as one message or two (a long
 * basket's lines first). A product shown without an approved Arabic name is recorded in name_gaps (record_name_gaps, 0120); that
 * record never stops the card.
 */
export async function sendCard(ctx: ToolContext, input: Omit<CardInput, "lang" | "address">, before?: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const lang = ctx.state.lang ?? "ar";
  const address = input.quote.pickup ? null : await rpc<CardAddress | null>(ctx.db, "order_address", { p_order: input.orderId }).catch(() => null);
  const gaps = new Set<string>();
  const parts = formatOrderCard({ ...input, lang, address }, { before, gaps });
  for (let i = 0; i < parts.length; i++) {
    const last = i === parts.length - 1;
    const summary = last ? `[order card ${input.shortCode}] total $${input.quote.total_usd}` : (parts[i] as { text: { body: string } }).text.body;
    const r = await deliver(ctx, parts[i]!, summary, input.orderId);
    if (!r.ok) return r;
  }
  if (gaps.size) await ctx.db.rpc("record_name_gaps", { p_products: [...gaps], p_lang: lang, p_where: "order_card" }).then(() => undefined, () => undefined);
  return { ok: true };
}

/**
 * After closing time (K1, B4's leftover): the basket, the terms and the place are kept in the conversation, and the customer is
 * told by code when we open, with one button to carry on. Nothing is promised or sent later on our own: the customer's tap, or a
 * pin, picks it up. `pin`: a pin just arrived, so say it was received.
 */
export async function keepUntilOpen(ctx: ToolContext, basket: { lines: QuoteLineInput[]; villageId: string | null; placeId: string | null; pickup: boolean; quote: Quote },
                                    terms: CardTerms, opens: string, opts: { pin?: boolean; before?: string } = {}): Promise<{ ok: true } | { ok: false; error: string }> {
  ctx.state.lastQuote = { lines: basket.lines, villageId: basket.villageId, pickup: basket.pickup, quote: basket.quote };
  if (basket.placeId) ctx.state.placeId = basket.placeId;
  if (basket.villageId) ctx.state.villageId = basket.villageId;
  ctx.state.pending = terms; ctx.state.awaiting = "opening";
  // Audit item 4: who has a kept order, so the cron can offer it once when we open. A failure here never stops the reply.
  await ctx.db.rpc("keep_order", { p_party: ctx.partyId, p_conversation: ctx.conversationId, p_opens: opens }).then(() => undefined, () => undefined);
  const said = opts.pin ? T(ctx).fixed.closedKeptPin(opens) : T(ctx).fixed.closedKept(opens);
  const text = opts.before ? `${opts.before}\n${said}` : said;
  return deliver(ctx, buttonMsg(text, [{ id: KEPT_BUTTON, title: T(ctx).fixed.keptButton }]), `[kept until open] ${text}`);
}

const RESTRICTION_MARK = "⚠️ قيود الزبون";
/** The order note for the restrictions that apply to an order. An allergy is passed on as an allergy, not as a topping change. */
export function withRestrictionNote(notes: string | null, restrictions: string[]): string | null {
  const rs = [...new Set(restrictions.map((r) => r.trim()).filter(Boolean))];
  if (rs.length === 0 || (notes ?? "").includes(RESTRICTION_MARK)) return notes;
  return [notes, `${RESTRICTION_MARK} (لازم يتأكّد قبل التحضير): ${rs.join("، ")}`].filter(Boolean).join(" | ");
}
