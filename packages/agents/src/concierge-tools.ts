// The Concierge's hands. Each tool is a thin wrapper over a SQL function or the Compliance Gateway:
// the model chooses what to call, the database decides what is true, the gateway decides what may be sent.
import type { SupabaseClient } from "@supabase/supabase-js";
import { askLocation, buttons as buttonMsg, type Outbound } from "@ak/wa/kapso";
import type { SendResult } from "@ak/wa/gateway";
import type { ConciergeTools } from "./concierge";
import { FIXED, formatOrderCard, KEPT_BUTTON, type Quote } from "./order-card";
import { checkModelText, GUARD_HINT, type Violation } from "./output-guard";
import { catalogMessages } from "./catalog-messages";

/** What survives between turns of one conversation. Kept in the Durable Object, not in the model. */
export interface ConversationState {
  villageId?: string | null;
  placeId?: string | null;
  directions?: string | null;          // the customer's own words about where they are
  lastQuote?: { lines: QuoteLineInput[]; villageId: string | null; pickup: boolean; quote: Quote } | null;
  history?: { role: "customer" | "assistant"; text: string }[];
  /**
   * A card is ready to go out from lastQuote once the customer supplies what is missing: a pin, the village when the pin was
   * not clear (a tap), the house and floor for a first delivery to a new place, or a phone number the rider can call.
   */
  awaiting?: "pin" | "village" | "address" | "phone" | "opening" | null;
  /** What the last pin said (B4): the pin decides the village. Unsure means the customer chooses from `candidates` by tap. */
  pinCheck?: PinCheck | null;
  pending?: CardTerms | null;
  /** When the "same as last time" button was last offered (ms). */
  repeatOfferedAt?: number;
  /** Restrictions the customer stated for the order being built (1.14): they go on its card notes. */
  orderRestrictions?: string[] | null;
  /** Restrictions offered for keeping, waiting for the customer's yes or no. */
  pendingRestrictions?: string[] | null;
}
export interface PinCheck {
  status: "located" | "unsure" | "outside"; villageAr: string | null; served: boolean | null;
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
}

const MAX_SENDS_PER_TURN = 2;

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

    async quote_order({ lines, pickup }) {
      const villageId = pickup ? null : ctx.state.villageId ?? null;
      const quote = await rpc<Quote>(ctx.db, "quote_order", { p_lines: lines, p_village: villageId, p_pickup: !!pickup });
      ctx.state.lastQuote = { lines, villageId, pickup: !!pickup, quote };
      return quote;
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
      if (!r.ok) return r;
      for (const msg of r.messages) {
        const sent = await deliver(ctx, msg, r.summary);
        if (!sent.ok) return sent;
      }
      return { ok: true, messages: r.messages.length };
    },

    async handoff_human({ reason }) {
      await ctx.db.from("conversations").update({ human_handoff: true }).eq("id", ctx.conversationId);
      await ctx.db.from("handoffs").insert({ conversation_id: ctx.conversationId, reason });
      await deliver(ctx, { type: "text", text: { body: FIXED.handoff } }, FIXED.handoff);
      return { ok: true };
    },
  };
}

/**
 * Runs the output checks on text the model wrote. A refusal is logged (code and the matched fragment, never the whole text)
 * and returned to the model so it can reword. Nothing is sent.
 */
export async function guard(ctx: ToolContext, texts: string[]): Promise<{ ok: false; error: string; hint: string } | null> {
  let v: Violation | null = null;
  for (const t of texts) { v = checkModelText(t, { approvedFacts: ctx.approvedFacts }); if (v) break; }
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

const money = (n: number) => `$${Number(n).toFixed(2)}`;
const MAX_PRICED = 6;
/** One line per product, priced by quote_order (one unit, at the hub): the only way a price appears in a Concierge reply. */
async function priceLines(ctx: ToolContext, productIds: string[]): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const ids = [...new Set(productIds)].slice(0, MAX_PRICED);
  const q = await rpc<{ lines: { name: string; name_ar: string | null; unit_price_usd: number; ok: boolean }[] }>(
    ctx.db, "quote_order", { p_lines: ids.map((product_id) => ({ product_id, qty: 1 })), p_village: null, p_pickup: true });
  if (q.lines.length === 0) return { ok: false, error: "price_of_unknown_products" };
  return { ok: true, text: q.lines.map((l) => `• ${l.name_ar ?? l.name} — ${money(l.unit_price_usd)}${l.ok ? "" : " (مش متوفّر هلّق)"}`).join("\n") };
}

export type CardResult = { ok: true; order_code?: string; waiting_for?: "phone" | "opening" } | { ok: false; error: string; issues?: unknown };

/**
 * Creates the order from priced lines and sends the card. The deterministic path and the Concierge's send_confirmation
 * tool both come through here, so both get the same checks. The card is built from the database's quote, never from model text.
 * `before` is a short fixed text sent first (for example, what could not be included).
 */
export async function issueCard(ctx: ToolContext, basket: { lines: QuoteLineInput[]; villageId: string | null; placeId: string | null; pickup: boolean },
                                terms: CardTerms, opts: { before?: string } = {}): Promise<CardResult> {
  // A rider must be able to call. WhatsApp may not have told us the number (1.19): ask for one before the card, and keep the
  // basket so the card goes out as soon as the number arrives.
  if (!basket.pickup && !(await rpc<string | null>(ctx.db, "customer_contact_phone", { p_party: ctx.partyId }))) {
    const quote = await rpc<Quote>(ctx.db, "quote_order", { p_lines: basket.lines, p_village: basket.villageId, p_pickup: false });
    ctx.state.lastQuote = { lines: basket.lines, villageId: basket.villageId, pickup: false, quote };
    if (basket.placeId) ctx.state.placeId = basket.placeId;
    ctx.state.awaiting = "phone"; ctx.state.pending = terms;
    const text = opts.before ? `${opts.before}\n${FIXED.askPhone}` : FIXED.askPhone;
    const asked = await deliver(ctx, { type: "text", text: { body: text } }, text);
    return asked.ok ? { ok: true, waiting_for: "phone" } : asked;
  }
  // Every restriction that applies goes with the order to whoever prepares it: the kept ones, and any stated for this order (1.14).
  const kept = await rpc<string[]>(ctx.db, "customer_restrictions", { p_party: ctx.partyId });
  terms = { ...terms, notes: withRestrictionNote(terms.notes, [...kept, ...(ctx.state.orderRestrictions ?? [])]) };
  const created = await rpc<{ created: boolean; order_id?: string; short_code?: string; quote: Quote }>(ctx.db, "create_order_from_quote", {
    p_customer: ctx.partyId, p_conversation: ctx.conversationId, p_lines: basket.lines, p_village: basket.villageId,
    p_place: basket.placeId, p_pickup: basket.pickup, p_payment: terms.payment, p_change_for: terms.changeForUsd, p_notes: terms.notes,
  });
  if (!created.created && created.quote.issues.some((i) => i.code === "fx_paused")) {
    // D1 (3.8): quoting is paused until a person confirms today's rate. The basket waits; the customer is told once.
    ctx.state.lastQuote = { lines: basket.lines, villageId: basket.villageId, pickup: basket.pickup, quote: created.quote };
    const told = await deliver(ctx, { type: "text", text: { body: FIXED.fxPaused } }, FIXED.fxPaused);
    return told.ok ? { ok: false, error: "fx_paused" } : told;
  }
  const closed = created.created ? undefined : created.quote.issues.find((i) => i.code === "closed");
  if (closed) {
    // K1 (B4's leftover): we closed while the basket waited (on the pin, the house, the number). Kept for when we open.
    const kept = await keepUntilOpen(ctx, { ...basket, quote: created.quote }, terms, String(closed.opens ?? ""));
    return kept.ok ? { ok: true, waiting_for: "opening" } : kept;
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
  if (opts.before) {
    const pre = await deliver(ctx, { type: "text", text: { body: opts.before } }, opts.before, created.order_id);
    if (!pre.ok) return pre;
  }
  const card = formatOrderCard({ orderId: created.order_id!, shortCode: created.short_code!, quote: created.quote,
                                 paymentMethod: terms.payment, changeForUsd: terms.changeForUsd, prepay: terms.prepay ?? null });
  const sent = await deliver(ctx, card, `[order card ${created.short_code}] total $${created.quote.total_usd}`, created.order_id);
  if (!sent.ok) return sent;
  // A card went out: any order kept overnight is taken up or replaced (audit item 4). Never stops the turn.
  await ctx.db.rpc("clear_kept_order", { p_party: ctx.partyId }).then(() => undefined, () => undefined);
  // The directions went onto the order (and the place); they are not carried into the next order.
  ctx.state.lastQuote = null; ctx.state.awaiting = null; ctx.state.pending = null; ctx.state.orderRestrictions = null; ctx.state.directions = null;
  return { ok: true, order_code: created.short_code! };
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
  const said = opts.pin ? FIXED.closedKeptPin(opens) : FIXED.closedKept(opens);
  const text = opts.before ? `${opts.before}\n${said}` : said;
  return deliver(ctx, buttonMsg(text, [{ id: KEPT_BUTTON, title: FIXED.keptButton }]), `[kept until open] ${text}`);
}

const RESTRICTION_MARK = "⚠️ قيود الزبون";
/** The order note for the restrictions that apply to an order. An allergy is passed on as an allergy, not as a topping change. */
export function withRestrictionNote(notes: string | null, restrictions: string[]): string | null {
  const rs = [...new Set(restrictions.map((r) => r.trim()).filter(Boolean))];
  if (rs.length === 0 || (notes ?? "").includes(RESTRICTION_MARK)) return notes;
  return [notes, `${RESTRICTION_MARK} (لازم يتأكّد قبل التحضير): ${rs.join("، ")}`].filter(Boolean).join(" | ");
}
