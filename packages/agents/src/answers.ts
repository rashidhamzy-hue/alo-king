// Answers without the model (build plan 1.3). Each one reads a SQL function and words the result with fixed text.
// Statuses, hours, fees, villages and prices all come from the database; nothing here is a number written by a model.
import type { SupabaseClient } from "@supabase/supabase-js";
import { buttons } from "@ak/wa/kapso";
import { deliver, issueCard, type ToolContext } from "./concierge-tools";
import type { Quote } from "./order-card";

async function rpc<T>(db: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}
const money = (n: number) => `$${Number(n).toFixed(2)}`;

export interface OrderStatus { short_code: string; status: string; total_usd: number; payment_method: string; is_pickup: boolean; eta_remaining_minutes: number | null }
export interface ServiceInfo { open: string; close: string; open_now: boolean; served: { name_en: string; name_ar: string | null; fee_usd: number; eta_minutes: number }[] }
export interface RepeatPlan {
  found: boolean; order_id?: string; short_code?: string; lines?: { product_id: string; source_id: string; qty: number; modifiers?: string[]; note?: string | null }[];
  missing?: { product_id: string; name: string; name_ar: string | null }[]; village_id?: string | null; place_id?: string | null; pickup?: boolean;
  payment_method?: "cod" | "whish" | "omt"; quote?: Quote | null;
}

export const ANSWER = {
  noOpenOrder: "ما عندك طلب مفتوح هلّق. شو بتحب تطلب؟",
  status(s: OrderStatus): string {
    const head = `طلبك ${s.short_code}: `;
    switch (s.status) {
      case "awaiting_confirmation": return head + "ناطر تأكيدك. اكبس «تأكيد الطلب» عالورقة لنبلّش.";
      case "awaiting_payment": return head + `ناطرين وصول الدفع (${money(s.total_usd)}). ابعت صورة الإيصال هون.`;
      case "confirmed": case "preparing":
        return head + "عم نحضّرو." + (s.eta_remaining_minutes ? ` الوقت المتوقع للوصول حوالي ${s.eta_remaining_minutes} دقيقة.` : "");
      case "ready": return head + (s.is_pickup ? "جاهز، فيك تمرق تاخدو." : "جاهز وناطر السائق.");
      case "out_for_delivery": return head + "عالطريق لعندك 🛵" + (s.eta_remaining_minutes ? ` حوالي ${s.eta_remaining_minutes} دقيقة.` : "");
      case "arrived": return head + "السائق واصل عندك 🚪";
      case "delivered": return head + "تسلّم. إذا في شي ناقص اكتبلنا.";
      case "failed_delivery": return head + "ما قدرنا نسلّمو. رح يتواصل معك حدا من الفريق.";
      default: return head + "قيد المتابعة. إذا في شي ضروري اكتبلنا.";
    }
  },
  hours: (i: ServiceInfo) => `منستقبل الطلبات كل يوم من ${i.open} لـ ${i.close}.` + (i.open_now ? " نحنا فاتحين هلّق." : " هلّق مسكّرين."),
  served: (i: ServiceInfo) => i.served.map((v) => v.name_ar ?? v.name_en).join("، "),
  outOfArea: (said: string, i: ServiceInfo) => `لهلّق ما منوصّل على ${said}. منوصّل على: ${ANSWER.served(i)}.`,
  inArea: (name: string, fee: number, eta: number) => `إيه منوصّل على ${name}. التوصيل ${money(fee)} وبياخد عادةً حوالي ${eta} دقيقة.`,
  noPrevious: "ما لقيت طلب سابق مكتمل إلك. شو بتحب تطلب؟",
  allMissing: (names: string[]) => `أغراض طلبك الماضي مش متوفّرة هلّق: ${names.join("، ")}. شو بتحب تطلب بدالها؟`,
  repeatOffer: (items: string[]) => {
    const shown = items.slice(0, 5).join("، ") + (items.length > 5 ? ` و${items.length - 5} غيرن` : "");
    return `أهلا فيك! شو بتحب تطلب اليوم؟ أو اكبس تحت لنجهّزلك نفس طلبك الماضي (${shown}) بأسعار اليوم.`;
  },
  repeatButton: "متل المرة الماضية",
  stale: "الأسعار أو التوفّر تغيّروا من وقت ما بعتنالك الورقة. هيدي ورقة جديدة بأسعار هلّق.",
  someMissing: (names: string[]) => `من طلبك الماضي هول مش متوفّرين هلّق: ${names.join("، ")}. حطّينا الباقي بالورقة.`,
};

export const repeatButtonId = (orderId: string) => `repeat:${orderId}`;
export function parseRepeatButton(id: string): string | null {
  const m = /^repeat:([0-9a-f-]{36})$/.exec(id);
  return m ? m[1]! : null;
}
const OFFER_EVERY_MS = 6 * 3600_000;

type Done = { done: true; path: string } | { done: false };
const say = async (ctx: ToolContext, text: string, path: string): Promise<Done> =>
  (await deliver(ctx, { type: "text", text: { body: text } }, text)).ok ? { done: true, path } : { done: false };

export async function answerStatus(ctx: ToolContext): Promise<Done> {
  const s = await rpc<OrderStatus | null>(ctx.db, "order_status_for", { p_party: ctx.partyId });
  return say(ctx, s ? ANSWER.status(s) : ANSWER.noOpenOrder, "status");
}

export async function answerHours(ctx: ToolContext): Promise<Done> {
  return say(ctx, ANSWER.hours(await rpc<ServiceInfo>(ctx.db, "service_info", {})), "hours");
}

/** Do you deliver to X. Unrecognised names are left to the model, which can ask; recognised ones are answered from the zones. */
export async function answerArea(ctx: ToolContext, said: string): Promise<Done> {
  const r = await rpc<{ village: { village_id: string; name_ar: string | null; name_en: string; delivery_fee_usd: number | null; base_eta_minutes: number | null } | null; served: boolean }>(
    ctx.db, "resolve_place", { p_party: ctx.partyId, p_village: said, p_landmark: null });
  if (!r.village) return { done: false };
  const name = r.village.name_ar ?? r.village.name_en;
  if (r.served && r.village.delivery_fee_usd != null && r.village.base_eta_minutes != null)
    return say(ctx, ANSWER.inArea(name, Number(r.village.delivery_fee_usd), r.village.base_eta_minutes), "delivery_area");
  return say(ctx, ANSWER.outOfArea(name, await rpc<ServiceInfo>(ctx.db, "service_info", {})), "out_of_area");
}

/** An order to a village we do not serve: one fixed answer, whatever else the message held. */
export async function answerOutOfArea(ctx: ToolContext, said: string): Promise<Done> {
  return say(ctx, ANSWER.outOfArea(said, await rpc<ServiceInfo>(ctx.db, "service_info", {})), "out_of_area");
}

/**
 * Same as last time: the last closed order's lines, re-priced and re-checked for stock now. Missing items are named before
 * the card. Returns done:false when the question needs words (closed now, under the minimum once items are missing, ...).
 */
export async function repeatLast(ctx: ToolContext, opts: { orderId?: string; noPreviousReply?: boolean } = {}): Promise<Done & { repeat?: RepeatPlan }> {
  const r = await rpc<RepeatPlan>(ctx.db, "repeat_plan", { p_party: ctx.partyId, p_order: opts.orderId ?? null });
  if (!r.found) return opts.noPreviousReply === false ? { done: false, repeat: r } : say(ctx, ANSWER.noPrevious, "repeat_none");
  const missing = (r.missing ?? []).map((m) => m.name_ar ?? m.name);
  if (!r.lines?.length) return say(ctx, ANSWER.allMissing(missing), "repeat_all_missing");
  if (!r.quote?.ok) return { done: false, repeat: r };
  if (r.village_id) ctx.state.villageId = r.village_id;
  if (r.place_id) ctx.state.placeId = r.place_id;
  const card = await issueCard(ctx, { lines: r.lines, villageId: r.pickup ? null : r.village_id ?? null, placeId: r.place_id ?? null, pickup: !!r.pickup },
    { payment: r.payment_method ?? "cod", changeForUsd: null, notes: null }, { before: missing.length ? ANSWER.someMissing(missing) : undefined });
  return card.ok ? { done: true, path: "repeat_card" } : { done: false, repeat: r };
}

/**
 * A returning customer says hello: offer their last closed basket as one button (1.20). Shown only to someone with a closed
 * (delivered and paid) order, at most once every six hours. The tap re-prices and re-checks stock; nothing is priced here.
 */
export async function offerRepeat(ctx: ToolContext): Promise<Done> {
  if (ctx.state.repeatOfferedAt && Date.now() - ctx.state.repeatOfferedAt < OFFER_EVERY_MS) return { done: false };
  const offer = await rpc<{ order_id: string; short_code: string; items: string[] } | null>(ctx.db, "repeat_offer", { p_party: ctx.partyId });
  if (!offer || offer.items.length === 0) return { done: false };
  const body = ANSWER.repeatOffer(offer.items);
  const r = await deliver(ctx, buttons(body, [{ id: repeatButtonId(offer.order_id), title: ANSWER.repeatButton }]), body);
  if (!r.ok) return { done: false };
  ctx.state.repeatOfferedAt = Date.now();
  return { done: true, path: "repeat_offer" };
}

/** A card whose quote went stale before the tap: the same lines, re-priced now, with anything gone named first. */
export async function rebuildStale(ctx: ToolContext, orderId: string): Promise<Done> {
  const b = await rpc<RepeatPlan & { change_for_usd?: number | null; notes?: string | null }>(ctx.db, "basket_from_order", { p_party: ctx.partyId, p_order: orderId });
  if (!b.found) return { done: false };
  const missing = (b.missing ?? []).map((m) => m.name_ar ?? m.name);
  if (!b.lines?.length) return say(ctx, ANSWER.allMissing(missing), "stale_all_missing");
  if (!b.quote?.ok) return { done: false };
  const before = [ANSWER.stale, missing.length ? ANSWER.someMissing(missing) : null].filter(Boolean).join("\n");
  const card = await issueCard(ctx, { lines: b.lines, villageId: b.pickup ? null : b.village_id ?? null, placeId: b.place_id ?? null, pickup: !!b.pickup },
    { payment: b.payment_method ?? "cod", changeForUsd: b.change_for_usd ?? null, notes: b.notes ?? null }, { before });
  return card.ok ? { done: true, path: "stale_card" } : { done: false };
}
