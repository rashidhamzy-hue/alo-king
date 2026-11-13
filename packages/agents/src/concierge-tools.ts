// The Concierge's hands. Each tool is a thin wrapper over a SQL function or the Compliance Gateway:
// the model chooses what to call, the database decides what is true, the gateway decides what may be sent.
import type { SupabaseClient } from "@supabase/supabase-js";
import { askLocation, buttons as buttonMsg, type Outbound } from "@ak/wa/kapso";
import type { SendResult } from "@ak/wa/gateway";
import type { ConciergeTools } from "./concierge";
import { FIXED, formatOrderCard, type Quote } from "./order-card";

/** What survives between turns of one conversation. Kept in the Durable Object, not in the model. */
export interface ConversationState {
  villageId?: string | null;
  placeId?: string | null;
  directions?: string | null;          // the customer's own words about where they are
  lastQuote?: { lines: QuoteLineInput[]; villageId: string | null; pickup: boolean; quote: Quote } | null;
  history?: { role: "customer" | "assistant"; text: string }[];
  /** A card is ready to go out from lastQuote once the customer supplies what is missing. */
  awaiting?: "pin" | null;
  pending?: CardTerms | null;
  /** When the "same as last time" button was last offered (ms). */
  repeatOfferedAt?: number;
}
/** Everything about a card that is not its lines. */
export interface CardTerms { payment: "cod" | "whish" | "omt"; changeForUsd: number | null; notes: string | null }
export interface QuoteLineInput { product_id: string; qty: number; modifiers?: string[]; note?: string | null; source_id?: string | null }

export interface ToolContext {
  db: SupabaseClient;
  partyId: string;
  conversationId: string;
  state: ConversationState;
  /** Sends through the Compliance Gateway. The only way a tool can reach the customer. */
  send: (msg: Outbound, opts?: { orderId?: string }) => Promise<SendResult>;
  sent: { count: number; texts: string[] };   // message economy: what this turn has already sent
}

const MAX_SENDS_PER_TURN = 2;

async function rpc<T>(db: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

export async function deliver(ctx: ToolContext, msg: Outbound, summary: string, orderId?: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (ctx.sent.count >= MAX_SENDS_PER_TURN) return { ok: false, error: "message_budget_reached_for_this_turn" };
  const r = await ctx.send(msg, { orderId });
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

    async ask_location_pin({ text }) {
      return deliver(ctx, askLocation(text), `[location request] ${text}`);
    },

    async send_confirmation({ payment_method, change_for_usd, notes }) {
      const q = ctx.state.lastQuote;
      if (!q) return { ok: false, error: "call_quote_order_first" };
      if (!q.quote.ok) return { ok: false, error: "quote_has_issues", issues: q.quote.issues };
      return issueCard(ctx, { lines: q.lines, villageId: q.villageId, placeId: ctx.state.placeId ?? null, pickup: q.pickup },
        { payment: payment_method ?? "cod", changeForUsd: change_for_usd ?? null, notes: [notes, ctx.state.directions].filter(Boolean).join(" | ") || null });
    },

    async reply({ text, buttons }) {
      const msg: Outbound = buttons?.length ? buttonMsg(text, buttons) : { type: "text", text: { body: text } };
      return deliver(ctx, msg, text);
    },

    async handoff_human({ reason }) {
      await ctx.db.from("conversations").update({ human_handoff: true }).eq("id", ctx.conversationId);
      await ctx.db.from("handoffs").insert({ conversation_id: ctx.conversationId, reason });
      await deliver(ctx, { type: "text", text: { body: FIXED.handoff } }, FIXED.handoff);
      return { ok: true };
    },
  };
}

export type CardResult = { ok: true; order_code: string } | { ok: false; error: string; issues?: unknown };

/**
 * Creates the order from priced lines and sends the card. The deterministic path and the Concierge's send_confirmation
 * tool both come through here, so both get the same checks. The card is built from the database's quote, never from model text.
 * `before` is a short fixed text sent first (for example, what could not be included).
 */
export async function issueCard(ctx: ToolContext, basket: { lines: QuoteLineInput[]; villageId: string | null; placeId: string | null; pickup: boolean },
                                terms: CardTerms, opts: { before?: string } = {}): Promise<CardResult> {
  const created = await rpc<{ created: boolean; order_id?: string; short_code?: string; quote: Quote }>(ctx.db, "create_order_from_quote", {
    p_customer: ctx.partyId, p_conversation: ctx.conversationId, p_lines: basket.lines, p_village: basket.villageId,
    p_place: basket.placeId, p_pickup: basket.pickup, p_payment: terms.payment, p_change_for: terms.changeForUsd, p_notes: terms.notes,
  });
  if (!created.created) {
    ctx.state.lastQuote = { lines: basket.lines, villageId: basket.villageId, pickup: basket.pickup, quote: created.quote };
    return { ok: false, error: "quote_changed", issues: created.quote.issues };
  }
  if (opts.before) {
    const pre = await deliver(ctx, { type: "text", text: { body: opts.before } }, opts.before, created.order_id);
    if (!pre.ok) return pre;
  }
  const card = formatOrderCard({ orderId: created.order_id!, shortCode: created.short_code!, quote: created.quote,
                                 paymentMethod: terms.payment, changeForUsd: terms.changeForUsd });
  const sent = await deliver(ctx, card, `[order card ${created.short_code}] total $${created.quote.total_usd}`, created.order_id);
  if (!sent.ok) return sent;
  ctx.state.lastQuote = null; ctx.state.awaiting = null; ctx.state.pending = null;
  return { ok: true, order_code: created.short_code! };
}
