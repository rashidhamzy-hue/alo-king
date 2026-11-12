// The ops line, rider side. Everything here is deterministic: buttons, pins and typed amounts are parsed by code
// and applied by SQL functions. No model reads a rider's message in this file.
// (Merchant messages and free-text incidents go to the Ops Copilot, build step 7.)
import type { SupabaseClient } from "@supabase/supabase-js";
import { buttons, type Outbound } from "@ak/wa/kapso";
import { parseCashMessage } from "@ak/core/cash-parse";
import { cashAsk, dropCard, offerCard, parseRiderButton, pickupCard, RIDER_TEXT as T, riderButtonId, type Job } from "@ak/agents/job-card";
import type { Pending, TurnDeps, TurnResult } from "./turn";

const START = /^(حاضر|جاهز|بلشت|بلّشت|7ader|hader|start|on)$/i;
const END = /^(خلصت|خلّصت|سكرت|سكّرت|khallast|5allast|end|off)$/i;
const CASH = /^(كاش|تسليم|cash|drop)$/i;

async function rpc<T>(db: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

/** Offers a delivery to its rider and tells nobody else. Used after a customer confirms and after an offer expires. */
export async function dispatchAndOffer(deps: TurnDeps, orderId: string): Promise<{ status: string }> {
  const d = await rpc<{ status: string; delivery_id?: string; driver_id?: string; minutes_to_pickup?: number; short_code?: string }>(deps.db, "dispatch_order", { p_order: orderId });
  if (d.status === "offered" && d.delivery_id && d.driver_id) {
    const job = await rpc<Job>(deps.db, "rider_job", { p_delivery: d.delivery_id });
    await sendToParty(deps, d.driver_id, offerCard(job, d.minutes_to_pickup), `offer:${d.delivery_id}`);
  } else if (d.status === "no_rider") {
    await alertOps(deps, `⚠️ ما في سائق متاح للطلب #${d.short_code ?? orderId.slice(0, 8)}`, `norider:${orderId}:${Math.floor(Date.now() / 300_000)}`);
  }
  return d;
}

const addressOf = (db: SupabaseClient, partyId: string) => rpc<string | null>(db, "party_address", { p_party: partyId, p_line: "ops" });

/** Every reply is keyed on its turn. A turn without a key is a programming error, never a reason to send unkeyed. */
export function requireTurnKey(deps: TurnDeps): string {
  if (!deps.turnKey) throw new Error("NO_TURN_KEY: processTurn and processOpsTurn must be called through runTurn");
  return deps.turnKey;
}

export async function sendToParty(deps: TurnDeps, partyId: string, msg: Outbound, dedupeKey: string): Promise<void> {
  const to = await addressOf(deps.db, partyId);
  if (to) await deps.send({ line: "ops", partyId, to, msg, category: "utility", dedupeKey });
}

export async function alertOps(deps: TurnDeps, text: string, dedupeKey: string): Promise<void> {
  for (const id of await rpc<string[]>(deps.db, "ops_recipients", {})) {
    await sendToParty(deps, id, { type: "text", text: { body: text } }, `${dedupeKey}:${id}`);
  }
}

export async function processOpsTurn(deps: TurnDeps, pending: Pending[]): Promise<TurnResult> {
  const { db } = deps;
  const first = pending[0]!;
  const to = first.who.phone ?? first.who.waUserId!;
  const conv = await rpc<{ known: boolean; party_id: string; role?: string; conversation_id: string }>(db, "touch_conversation", {
    p_line: "ops", p_wa_user_id: first.who.waUserId ?? null, p_phone: first.who.phone ?? null, p_name: first.event.conversation.contact_name ?? null });
  if (!conv.known) return { outcome: "ignored", sent: [] };            // the ops line talks only to people we registered
  if ((await rpc<string | null>(db, "party_role", { p_party: conv.party_id })) !== "driver") return { outcome: "ignored", sent: [] };   // merchants and staff: step 7

  const driver = conv.party_id;
  const sent: string[] = [];
  let n = 0;
  const turnKey = requireTurnKey(deps);
  const out = async (msg: Outbound) => { const r = await deps.send({ line: "ops", partyId: driver, to, msg, category: "service", dedupeKey: `${turnKey}:${n++}` }); if (r.ok) sent.push(msg.type); };
  const say = (text: string) => out({ type: "text", text: { body: text } });

  const showNext = async (deliveryId: string) => {
    const job = await rpc<Job | null>(db, "rider_job", { p_delivery: deliveryId });
    if (!job) return;
    if (job.stops.some((s) => s.kind === "pickup" && !s.done)) return out(pickupCard(job));
    const next = job.stops.find((s) => s.kind === "dropoff" && !s.done);
    if (!next) return;
    if (next.lat != null && next.lng != null) await out({ type: "location", location: { latitude: next.lat, longitude: next.lng, name: `#${next.short_code}` } } as Outbound);
    await out(dropCard(next));
  };
  const afterCash = async (r: { gate: string; delivery_done: boolean }, deliveryId: string | null) => {
    if (r.gate === "hard_cap") await out(buttons(T.hardCap, dropButtons())); else if (r.gate === "soft_cap") await say(T.softCap);
    if (!r.delivery_done && deliveryId) await showNext(deliveryId);
  };

  for (const p of pending) {
    const m = p.event.message;
    try {
      if (m.type === "location" && m.location) {
        await rpc(db, "record_driver_position", { p_driver: driver, p_lat: m.location.latitude, p_lng: m.location.longitude });
        continue;
      }
      const tapped = m.type === "interactive" ? m.interactive?.button_reply?.id : undefined;
      const b = tapped ? parseRiderButton(tapped) : null;
      const text = (m.text?.body ?? "").trim();

      if (b?.kind === "shift" && b.action === "start" || START.test(text)) {
        const r = await rpc<{ started?: boolean }>(db, "start_shift", { p_driver: driver });
        await say(r.started === false ? T.shiftAlready : T.shiftStarted);
      } else if (b?.kind === "shift" && b.action === "end" || END.test(text)) {
        if (await rpc<string | null>(db, "driver_active_delivery", { p_driver: driver })) { await say(T.shiftBlocked); continue; }
        const r = await rpc<{ closed: boolean; reason?: string; value_usd?: number }>(db, "close_shift", { p_driver: driver });
        if (r.closed) await say("سكّرنا الدوام. يعطيك العافية 🙏");
        else await out(buttons(`قبل ما تسكّر: معك $${Number(r.value_usd ?? 0).toFixed(2)} كاش. وين بدك تسلّمهم؟`, dropButtons()));
      } else if (b?.kind === "shift" && (b.action === "drop_hub" || b.action === "drop_omt")) {
        const cash = await rpc<{ usd: number; lbp: number }[] | { usd: number; lbp: number }>(db, "driver_cash_native", { p_driver: driver });
        const c = Array.isArray(cash) ? cash[0]! : cash;
        await rpc(db, "declare_cash_drop", { p_driver: driver, p_method: b.action === "drop_hub" ? "hub" : "omt", p_usd: c.usd, p_lbp: c.lbp, p_receipt_ref: null });
        await say(`سجّلنا تسليم $${Number(c.usd).toFixed(2)} و ${Number(c.lbp).toLocaleString("en-US")} ل.ل. بيتأكد بس يعدّوها${b.action === "drop_omt" ? " (ابعت صورة الوصل)" : ""}.`);
        await alertOps(deps, `💵 سائق صرّح عن تسليم كاش (${b.action === "drop_hub" ? "المركز" : "OMT"}). بحاجة لتأكيد.`, `${turnKey}:alert:cashdrop`);
      } else if (CASH.test(text)) {
        await out(buttons(T.dropAsk, dropButtons()));
      } else if (b?.kind === "job" && (b.action === "accept" || b.action === "decline")) {
        const r = await rpc<{ ok: boolean; status: string; changed: boolean; orders: string[] }>(db, "rider_respond", { p_delivery: b.id, p_driver: driver, p_accept: b.action === "accept" });
        if (!r.changed) { await say(r.ok ? T.accepted : T.offerGone); if (r.ok) await showNext(b.id); continue; }
        if (b.action === "accept") { await say(T.accepted); await showNext(b.id); }
        else { await say(T.declined); for (const o of r.orders) await dispatchAndOffer(deps, o); }
      } else if (b?.kind === "job" && b.action === "picked") {
        await rpc(db, "rider_picked_up", { p_delivery: b.id, p_driver: driver });
        await showNext(b.id);
        await deps.notifyCustomer?.(b.id, "on_the_way");
      } else if (b?.kind === "stop" && b.action === "arrived") {
        await rpc(db, "rider_arrived", { p_order: b.id, p_driver: driver });
      } else if (b?.kind === "stop" && b.action === "delivered") {
        const r = await rpc<{ needs_cash: boolean; total_usd: number; fx_rate_lbp: number; short_code: string; delivery_done: boolean }>(db, "rider_delivered", { p_order: b.id, p_driver: driver });
        if (r.needs_cash) await out(cashAsk({ order_id: b.id, short_code: r.short_code, total_usd: r.total_usd, fx_rate_lbp: r.fx_rate_lbp }));
        else if (!r.delivery_done) { const d = await rpc<string | null>(db, "driver_active_delivery", { p_driver: driver }); if (d) await showNext(d); }
      } else if (b?.kind === "stop" && b.action === "exact") {
        const owed = (await rpc<{ order_id: string; total_usd: number }[]>(db, "rider_unpaid_orders", { p_driver: driver })).find((x) => x.order_id === b.id);
        if (!owed) { await say(T.noJob); continue; }
        const r = await rpc<{ gate: string; delivery_done: boolean; cash_usd: number }>(db, "rider_collect", { p_order: b.id, p_driver: driver, p_usd: Number(owed.total_usd), p_lbp: 0 });
        await say(`تم ✅ معك هلق $${Number(r.cash_usd).toFixed(2)}`);
        await afterCash(r, await rpc<string | null>(db, "driver_active_delivery", { p_driver: driver }));
      } else if (b?.kind === "stop" && b.action === "noanswer") {
        const r = await rpc<{ ok: boolean; wait_more_min?: number; return_to_hub?: boolean; delivery_done?: boolean }>(db, "rider_no_answer", { p_order: b.id, p_driver: driver });
        if (!r.ok && r.wait_more_min) { await say(`جرّب تتصل فيه. استنى ${r.wait_more_min} دقايق كمان وكبّس مرة تانية.`); await deps.notifyCustomer?.(b.id, "rider_waiting"); }
        else if (r.ok) { await say(r.return_to_hub ? "سجّلناها. رجّع الأغراض عالمركز." : "سجّلناها."); await alertOps(deps, `🚪 توصيل فاشل (ما حدا رد) للطلب ${b.id.slice(0, 8)}`, `${turnKey}:alert:noanswer`); }
      } else if (text) {
        // A typed amount belongs to the delivered-but-unpaid order this rider is holding, if there is exactly one.
        const cash = parseCashMessage(text);
        const open = await rpc<{ order_id: string; total_usd: number; fx_rate_lbp: number }[]>(db, "rider_unpaid_orders", { p_driver: driver });
        if (!cash || open.length !== 1) { await say(cash ? T.noJob : open.length ? T.cashUnclear : T.unknown); continue; }
        const o = open[0]!;
        try {
          const r = await rpc<{ gate: string; delivery_done: boolean; cash_usd: number }>(db, "rider_collect", { p_order: o.order_id, p_driver: driver,
            p_usd: cash.exact ? o.total_usd : cash.usd, p_lbp: cash.exact ? 0 : cash.lbp, p_change_usd: cash.changeUsd, p_change_lbp: cash.changeLbp });
          await say(`تم ✅ معك هلق $${Number(r.cash_usd).toFixed(2)}`);
          await afterCash(r, await rpc<string | null>(db, "driver_active_delivery", { p_driver: driver }));
        } catch (err) {
          if (!String(err).includes("AMOUNT_MISMATCH")) throw err;
          await say(`المبلغ ما بيطابق المطلوب ($${Number(o.total_usd).toFixed(2)}). اكتب قديش قبضت وقديش رجّعت، أو اتصل بالمركز.`);
        }
      }
    } catch (err) {
      await say("صار في غلط. جرّب مرة تانية أو اتصل بالمركز.");
      await alertOps(deps, `⚠️ خطأ مع سائق: ${String(err).slice(0, 160)}`, `${turnKey}:alert:error`);
    }
  }
  return { outcome: "rider", sent };
}

const dropButtons = () => [
  { id: riderButtonId({ kind: "shift", action: "drop_hub", id: "" }), title: "بالمركز" },
  { id: riderButtonId({ kind: "shift", action: "drop_omt", id: "" }), title: "OMT" },
];
