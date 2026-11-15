// Answers without the model (build plan 1.3). Each one reads a SQL function and words the result with fixed text.
// Statuses, hours, fees, villages and prices all come from the database; nothing here is a number written by a model.
import type { SupabaseClient } from "@supabase/supabase-js";
import { buttons } from "@ak/wa/kapso";
import { deliver, issueCard, type ToolContext } from "./concierge-tools";
import { type DeliveryWindow, type Quote } from "./order-card";
import { messages, productName, villageName, windowLabel, type Lang } from "./messages";

async function rpc<T>(db: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

export interface OrderStatus { short_code: string; status: string; total_usd: number; payment_method: string; is_pickup: boolean; eta_remaining_minutes: number | null;
  /** 2.8 (0041): a scheduled order's window. Its answer is the window, never minutes counted from the confirmation (C3's request 6). */
  window?: DeliveryWindow | null }
export interface ServiceInfo { open: string; close: string; open_now: boolean; served: { name_en: string; name_ar: string | null; fee_usd: number; eta_minutes: number }[] }
export interface RepeatPlan {
  found: boolean; order_id?: string; short_code?: string; lines?: { product_id: string; source_id: string; qty: number; modifiers?: string[]; note?: string | null }[];
  missing?: { product_id: string; name: string; name_ar: string | null }[]; village_id?: string | null; place_id?: string | null; pickup?: boolean;
  payment_method?: "cod" | "whish" | "omt"; quote?: Quote | null;
}

/** The fixed answer to "where is my order" in one language: a scheduled order's window, never minutes from the confirmation. */
export function statusText(s: OrderStatus, lang: Lang = "ar"): string {
  const a = messages(lang).answer;
  const code = s.short_code;
  if (s.window && !s.is_pickup) {
    const when = windowLabel(s.window, lang);
    switch (s.status) {
      case "awaiting_confirmation": return a.awaitingConfirmation(code, when);
      case "awaiting_payment": return a.awaitingPayment(code, when, Number(s.total_usd));
      case "confirmed": return a.confirmedFor(code, when);
      case "preparing": case "ready": return a.preparingFor(code, when);
    }
  }
  switch (s.status) {
    case "awaiting_confirmation": return a.awaitingConfirmation(code, null);
    case "awaiting_payment": return a.awaitingPayment(code, null, Number(s.total_usd));
    case "confirmed": case "preparing": return a.preparing(code, s.eta_remaining_minutes);
    case "ready": return a.ready(code, s.is_pickup);
    case "out_for_delivery": return a.onTheWay(code, s.eta_remaining_minutes);
    case "arrived": return a.arrived(code);
    case "delivered": return a.delivered(code);
    case "failed_delivery": return a.failed(code);
    default: return a.other(code);
  }
}
const servedNames = (i: ServiceInfo, lang: Lang) => i.served.map((v) => villageName(lang, v.name_ar, v.name_en));
/** The repeat offer's items: at most five named, then how many more. */
export const repeatOfferText = (items: string[], lang: Lang = "ar") => messages(lang).answer.repeatOffer(items.slice(0, 5), Math.max(0, items.length - 5));

export const repeatButtonId = (orderId: string) => `repeat:${orderId}`;
export function parseRepeatButton(id: string): string | null {
  const m = /^repeat:([0-9a-f-]{36})$/.exec(id);
  return m ? m[1]! : null;
}
const OFFER_EVERY_MS = 6 * 3600_000;

type Done = { done: true; path: string } | { done: false };
const T = (ctx: ToolContext) => messages(ctx.state.lang);
const say = async (ctx: ToolContext, text: string, path: string): Promise<Done> =>
  (await deliver(ctx, { type: "text", text: { body: text } }, text)).ok ? { done: true, path } : { done: false };

export async function answerStatus(ctx: ToolContext): Promise<Done> {
  const s = await rpc<OrderStatus | null>(ctx.db, "order_status_for", { p_party: ctx.partyId });
  return say(ctx, s ? statusText(s, ctx.state.lang) : T(ctx).answer.noOpenOrder, "status");
}

export async function answerHours(ctx: ToolContext): Promise<Done> {
  const i = await rpc<ServiceInfo>(ctx.db, "service_info", {});
  return say(ctx, T(ctx).answer.hours(i.open, i.close, i.open_now), "hours");
}

/** Do you deliver to X. Unrecognised names are left to the model, which can ask; recognised ones are answered from the zones. */
export async function answerArea(ctx: ToolContext, said: string): Promise<Done> {
  const r = await rpc<{ village: { village_id: string; name_ar: string | null; name_en: string; delivery_fee_usd: number | null; base_eta_minutes: number | null } | null; served: boolean }>(
    ctx.db, "resolve_place", { p_party: ctx.partyId, p_village: said, p_landmark: null });
  if (!r.village) return { done: false };
  const name = villageName(ctx.state.lang ?? "ar", r.village.name_ar, r.village.name_en);
  if (r.served && r.village.delivery_fee_usd != null && r.village.base_eta_minutes != null)
    return say(ctx, T(ctx).answer.inArea(name, Number(r.village.delivery_fee_usd), r.village.base_eta_minutes), "delivery_area");
  return answerOutOfArea(ctx, name);
}

/** An order to a village we do not serve: one fixed answer, whatever else the message held. */
export async function answerOutOfArea(ctx: ToolContext, said: string): Promise<Done> {
  const i = await rpc<ServiceInfo>(ctx.db, "service_info", {});
  return say(ctx, T(ctx).answer.outOfArea(said, servedNames(i, ctx.state.lang ?? "ar")), "out_of_area");
}

/**
 * Same as last time: the last closed order's lines, re-priced and re-checked for stock now. Missing items are named before
 * the card. Returns done:false when the question needs words (closed now, under the minimum once items are missing, ...).
 */
export async function repeatLast(ctx: ToolContext, opts: { orderId?: string; noPreviousReply?: boolean } = {}): Promise<Done & { repeat?: RepeatPlan }> {
  const r = await rpc<RepeatPlan>(ctx.db, "repeat_plan", { p_party: ctx.partyId, p_order: opts.orderId ?? null });
  if (!r.found) return opts.noPreviousReply === false ? { done: false, repeat: r } : say(ctx, T(ctx).answer.noPrevious, "repeat_none");
  const missing = (r.missing ?? []).map((m) => productName(m, ctx.state.lang ?? "ar"));
  if (!r.lines?.length) return say(ctx, T(ctx).answer.allMissing(missing), "repeat_all_missing");
  if (!r.quote?.ok) return { done: false, repeat: r };
  if (r.village_id) ctx.state.villageId = r.village_id;
  if (r.place_id) ctx.state.placeId = r.place_id;
  const card = await issueCard(ctx, { lines: r.lines, villageId: r.pickup ? null : r.village_id ?? null, placeId: r.place_id ?? null, pickup: !!r.pickup },
    { payment: r.payment_method ?? "cod", changeForUsd: null, notes: null }, { before: missing.length ? T(ctx).answer.someMissing(missing) : undefined });
  return card.ok ? { done: true, path: "repeat_card" } : { done: false, repeat: r };
}

/**
 * A returning customer says hello: offer their last closed basket as one button (1.20). Shown only to someone with a closed
 * (delivered and paid) order, at most once every six hours. The tap re-prices and re-checks stock; nothing is priced here.
 */
export async function offerRepeat(ctx: ToolContext): Promise<Done> {
  // B1a: never while a basket is being built; "same as last time" there would sound like the basket was lost.
  if (ctx.state.lastQuote?.lines.length) return { done: false };
  if (ctx.state.repeatOfferedAt && Date.now() - ctx.state.repeatOfferedAt < OFFER_EVERY_MS) return { done: false };
  const offer = await rpc<{ order_id: string; short_code: string; items: string[]; names?: { product_id: string; name: string; name_ar: string | null }[] } | null>(
    ctx.db, "repeat_offer", { p_party: ctx.partyId });
  if (!offer || offer.items.length === 0) return { done: false };
  // M1: the items in the conversation's language (0120's 'names'); 'items' is the Arabic-first list from before.
  const lang = ctx.state.lang ?? "ar";
  const body = repeatOfferText(offer.names?.length ? offer.names.map((n) => productName(n, lang)) : offer.items, lang);
  const r = await deliver(ctx, buttons(body, [{ id: repeatButtonId(offer.order_id), title: T(ctx).answer.repeatButton }]), body);
  if (!r.ok) return { done: false };
  ctx.state.repeatOfferedAt = Date.now();
  return { done: true, path: "repeat_offer" };
}

/** A card whose quote went stale before the tap: the same lines, re-priced now, with anything gone named first. */
export async function rebuildStale(ctx: ToolContext, orderId: string): Promise<Done> {
  const b = await rpc<RepeatPlan & { change_for_usd?: number | null; notes?: string | null; slot_id?: string | null }>(ctx.db, "basket_from_order", { p_party: ctx.partyId, p_order: orderId });
  if (!b.found) return { done: false };
  const missing = (b.missing ?? []).map((m) => productName(m, ctx.state.lang ?? "ar"));
  if (!b.lines?.length) return say(ctx, T(ctx).answer.allMissing(missing), "stale_all_missing");
  if (!b.quote?.ok) return { done: false };
  const before = [T(ctx).answer.stale, missing.length ? T(ctx).answer.someMissing(missing) : null].filter(Boolean).join("\n");
  const card = await issueCard(ctx, { lines: b.lines, villageId: b.pickup ? null : b.village_id ?? null, placeId: b.place_id ?? null, pickup: !!b.pickup },
    { payment: b.payment_method ?? "cod", changeForUsd: b.change_for_usd ?? null, notes: b.notes ?? null }, { before, slotId: b.slot_id ?? null });
  return card.ok ? { done: true, path: "stale_card" } : { done: false };
}

/**
 * "How much in lira?" (founder decision 2): one fixed answer. Today's rate is current_fx(); the open order, if any, is shown in lira
 * at its own rate (lira_answer, 0120: the rate fixed at confirmation, else today's), rounded as the card rounds. No model.
 */
export async function answerLira(ctx: ToolContext): Promise<Done> {
  const r = await rpc<{ rate: number | null; order: { short_code: string; total_usd: number; total_lbp: number } | null }>(ctx.db, "lira_answer", { p_party: ctx.partyId });
  const a = T(ctx).answer;
  if (!r.rate) return say(ctx, a.noRate, "lira_no_rate");
  return say(ctx, a.lira(Number(r.rate), r.order ? { code: r.order.short_code, usd: Number(r.order.total_usd), lbp: Number(r.order.total_lbp) } : null), "lira");
}
