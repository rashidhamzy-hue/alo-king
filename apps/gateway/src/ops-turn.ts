// The ops line: riders, pickers and the ops lead. Everything here is deterministic: buttons, pins and typed amounts are
// parsed by code and applied by SQL functions. No model reads a staff member's message in this file.
// (Merchant messages and free-text incidents go to the Ops Copilot, build step 7.)
import type { SupabaseClient } from "@supabase/supabase-js";
import { buttons, list, type Outbound } from "@ak/wa/kapso";
import { OutboxUnavailable } from "@ak/wa/gateway";
import { parseCashMessage } from "@ak/core/cash-parse";
import { cashAsk, dropCard, offerCard, parseRiderButton, pickupCard, RIDER_TEXT as T, riderButtonId, type Job } from "@ak/agents/job-card";
import { OPS_VOICE_TEXT, voiceOnOpsLine, type AudioMessage } from "@ak/agents/voice";
import type { Pending, TurnDeps, TurnResult } from "./turn";
import { messages, productName, STAFF_LANG, usd } from "@ak/agents/messages";
import { sendCodeStarted, type Built, type TemplateEvent } from "@ak/agents/messages/notify";
import type { Messages } from "@ak/agents/messages";

/** M1: every staff message is in messages/ (ops section), in the staff's language. */
const O = messages(STAFF_LANG).ops;

const START = /^(حاضر|جاهز|بلشت|بلّشت|7ader|hader|start|on)$/i;
const END = /^(خلصت|خلّصت|سكرت|سكّرت|khallast|5allast|end|off)$/i;
const CASH = /^(كاش|تسليم|cash|drop)$/i;

async function rpc<T>(db: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

/**
 * Offers a delivery to its rider. Used after a customer confirms, after an offer expires, by the cron for every order still
 * without a rider, and (2.4) when a picker starts the order. A hub order that waits for its picker is announced to the
 * pickers once, and to ops when it has waited longer than settings.picking.pick_alert_min.
 */
export async function dispatchAndOffer(deps: TurnDeps, orderId: string): Promise<{ status: string }> {
  const d = await rpc<{ status: string; delivery_id?: string; driver_id?: string; minutes_to_pickup?: number; short_code?: string; minutes_waiting?: number }>(deps.db, "dispatch_order", { p_order: orderId });
  if (d.status === "waiting_for_pick") {
    const start = buttons(O.newPick(d.short_code ?? ""), [{ id: staffButtonId({ kind: "pick", action: "start", id: orderId }), title: O.startButton(d.short_code ?? "") }]);
    for (const picker of await rpc<string[]>(deps.db, "pick_recipients", {})) await sendToParty(deps, picker, start, `picknew:${orderId}:${picker}`);
    const alertMin = Number((await rpc<{ pick_alert_min?: number } | null>(deps.db, "setting", { p_key: "picking" }))?.pick_alert_min ?? 10);
    if (Number(d.minutes_waiting ?? 0) >= alertMin) {
      await alertOps(deps, O.pickWait(d.short_code ?? "", Number(d.minutes_waiting)), `pickwait:${orderId}:${Math.floor(Date.now() / 600_000)}`);
    }
    return d;
  }
  if (d.status === "offered" && d.delivery_id && d.driver_id) {
    const job = await rpc<Job>(deps.db, "rider_job", { p_delivery: d.delivery_id });
    await sendToParty(deps, d.driver_id, offerCard(job, d.minutes_to_pickup), `offer:${d.delivery_id}`);
  } else if (d.status === "no_rider") {
    await alertOps(deps, O.noRider(d.short_code ?? orderId.slice(0, 8)), `norider:${orderId}:${Math.floor(Date.now() / 300_000)}`);
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

/**
 * A voice note on the ops line (B3's request, invariant 18: nothing is dropped in silence). No model reads it: within the
 * sender's limits (1.17) the sender is told a person will listen and that amounts are buttons or typed figures, and ops is
 * alerted to listen; over a limit, the polite reply. It never moves money or changes an order.
 */
async function voiceNote(deps: TurnDeps, m: Pending["event"]["message"], who: { partyId: string; role: "driver" | "staff" },
                         say: (text: string) => Promise<void>, earlier: { seconds: number }, turnIds: string[], turnKey: string): Promise<void> {
  const v = await voiceOnOpsLine({ db: deps.db, partyId: who.partyId, line: "ops", role: who.role }, m as unknown as AudioMessage, earlier.seconds, turnIds);
  await say(v.reply);
  if (!v.forwardToOps) return;
  earlier.seconds += v.seconds;
  const name = (await rpc<string | null>(deps.db, "party_display_name", { p_party: who.partyId })) ?? (who.role === "driver" ? O.aRider : O.theTeam);
  await alertOps(deps, OPS_VOICE_TEXT.opsAlert(name, v.seconds), `${turnKey}:alert:voice:${m.id}`);
}

export async function processOpsTurn(deps: TurnDeps, pending: Pending[]): Promise<TurnResult> {
  const { db } = deps;
  const first = pending[0]!;
  const to = first.who.phone ?? first.who.waUserId!;
  const conv = await rpc<{ known: boolean; party_id: string; role?: string; conversation_id: string }>(db, "touch_conversation", {
    p_line: "ops", p_wa_user_id: first.who.waUserId ?? null, p_phone: first.who.phone ?? null, p_name: first.event.conversation.contact_name ?? null });
  if (!conv.known) return { outcome: "ignored", sent: [] };            // the ops line talks only to people we registered
  const role = await rpc<string | null>(db, "party_role", { p_party: conv.party_id });
  if (role === "picker" || role === "ops_lead" || role === "admin") return processStaffTurn(deps, pending, conv.party_id, to, role);
  if (role !== "driver") return { outcome: "ignored", sent: [] };     // merchants: step 7

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

  const voiced = { seconds: 0 };
  const turnIds = pending.map((x) => x.event.message.id);
  for (const p of pending) {
    const m = p.event.message;
    try {
      if (m.type === "audio") { await voiceNote(deps, m, { partyId: driver, role: "driver" }, say, voiced, turnIds, turnKey); continue; }
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
        if (r.closed) await say(O.shiftClosed);
        else await out(buttons(O.closeWithCash(Number(r.value_usd ?? 0)), dropButtons()));
      } else if (b?.kind === "shift" && (b.action === "drop_hub" || b.action === "drop_omt")) {
        const cash = await rpc<{ usd: number; lbp: number }[] | { usd: number; lbp: number }>(db, "driver_cash_native", { p_driver: driver });
        const c = Array.isArray(cash) ? cash[0]! : cash;
        await rpc(db, "declare_cash_drop", { p_driver: driver, p_method: b.action === "drop_hub" ? "hub" : "omt", p_usd: c.usd, p_lbp: c.lbp, p_receipt_ref: null });
        await say(O.dropDeclared(Number(c.usd), Number(c.lbp), b.action === "drop_omt"));
        await alertOps(deps, O.dropAlert(b.action === "drop_omt"), `${turnKey}:alert:cashdrop`);
      } else if (CASH.test(text)) {
        await out(buttons(T.dropAsk, dropButtons()));
      } else if (b?.kind === "job" && (b.action === "accept" || b.action === "decline")) {
        const r = await rpc<{ ok: boolean; status: string; changed: boolean; orders: string[] }>(db, "rider_respond", { p_delivery: b.id, p_driver: driver, p_accept: b.action === "accept" });
        if (!r.changed) { await say(r.ok ? T.accepted : T.offerGone); if (r.ok) await showNext(b.id); continue; }
        if (b.action === "accept") { await say(T.accepted); await showNext(b.id); }
        else { await say(T.declined); for (const o of r.orders) await dispatchAndOffer(deps, o); }
      } else if (b?.kind === "job" && b.action === "picked") {
        const r = await rpc<{ ok: boolean; status?: string; waiting?: string[] }>(db, "rider_picked_up", { p_delivery: b.id, p_driver: driver });
        // 2.4: offered when picking starts, the rider may be at the hub before the goods are ready.
        if (!r.ok && r.status === "not_ready") { await say(O.stillPicking(r.waiting ?? [])); continue; }
        await showNext(b.id);
        await deps.notifyCustomer?.(b.id, "on_the_way");
      } else if (b?.kind === "stop" && b.action === "arrived") {
        await rpc(db, "rider_arrived", { p_order: b.id, p_driver: driver });
      } else if (b?.kind === "stop" && b.action === "delivered") {
        let r: { needs_cash: boolean; total_usd: number; fx_rate_lbp: number; short_code: string; delivery_done: boolean };
        try { r = await rpc(db, "rider_delivered", { p_order: b.id, p_driver: driver }); }
        catch (err) {
          // CX1 (0146): a prepaid order is handed over only with the customer's four-digit code. The rider types it next.
          const code = /HANDOVER_CODE_REQUIRED (\S+)/.exec(String(err));
          if (!code) throw err;
          await say(O.askCode(code[1]!)); continue;
        }
        if (r.needs_cash) await out(cashAsk({ order_id: b.id, short_code: r.short_code, total_usd: r.total_usd, fx_rate_lbp: r.fx_rate_lbp }));
        else if (!r.delivery_done) { const d = await rpc<string | null>(db, "driver_active_delivery", { p_driver: driver }); if (d) await showNext(d); }
      } else if (/^\s*\d{4}\s*$/.test(text) && await rpc<string | null>(db, "rider_code_pending", { p_driver: driver })) {
        // CX1: the customer's handover code, typed at the door. Right: handed over; wrong: the tries left; locked: ops is told.
        const order = (await rpc<string | null>(db, "rider_code_pending", { p_driver: driver }))!;
        const r = await rpc<{ ok: boolean; result: string; short_code?: string; tries_left?: number; delivery_done?: boolean }>(db, "rider_handover", { p_order: order, p_driver: driver, p_code: text });
        if (r.result === "wrong") { await say(O.wrongCode(Number(r.tries_left ?? 0))); continue; }
        if (r.result === "locked") {
          await say(O.codeLocked(r.short_code ?? ""));
          await alertOps(deps, O.codeLockedAlert(r.short_code ?? ""), `${turnKey}:alert:code`);
          continue;
        }
        await say(O.codeOk(r.short_code ?? ""));
        if (!r.delivery_done) { const d = await rpc<string | null>(db, "driver_active_delivery", { p_driver: driver }); if (d) await showNext(d); }
      } else if (b?.kind === "stop" && b.action === "exact") {
        const owed = (await rpc<{ order_id: string; total_usd: number }[]>(db, "rider_unpaid_orders", { p_driver: driver })).find((x) => x.order_id === b.id);
        if (!owed) { await say(T.noJob); continue; }
        const r = await rpc<{ gate: string; delivery_done: boolean; cash_usd: number }>(db, "rider_collect", { p_order: b.id, p_driver: driver, p_usd: Number(owed.total_usd), p_lbp: 0 });
        await say(O.collected(Number(r.cash_usd)));
        await afterCash(r, await rpc<string | null>(db, "driver_active_delivery", { p_driver: driver }));
      } else if (b?.kind === "stop" && b.action === "noanswer") {
        const r = await rpc<{ ok: boolean; wait_more_min?: number; return_to_hub?: boolean; delivery_done?: boolean }>(db, "rider_no_answer", { p_order: b.id, p_driver: driver });
        if (!r.ok && r.wait_more_min) { await say(O.waitMore(r.wait_more_min)); await deps.notifyCustomer?.(b.id, "rider_waiting"); }
        else if (r.ok) {
          await say(O.noAnswerLogged(!!r.return_to_hub));
          await alertOps(deps, O.noAnswerAlert(b.id.slice(0, 8)), `${turnKey}:alert:noanswer`);
          if (r.return_to_hub) await announceReturn(deps, b.id);
        }
      } else if (text) {
        // A typed amount belongs to the delivered-but-unpaid order this rider is holding, if there is exactly one.
        const cash = parseCashMessage(text);
        const open = await rpc<{ order_id: string; total_usd: number; fx_rate_lbp: number }[]>(db, "rider_unpaid_orders", { p_driver: driver });
        if (!cash || open.length !== 1) { await say(cash ? T.noJob : open.length ? T.cashUnclear : T.unknown); continue; }
        const o = open[0]!;
        try {
          const r = await rpc<{ gate: string; delivery_done: boolean; cash_usd: number }>(db, "rider_collect", { p_order: o.order_id, p_driver: driver,
            p_usd: cash.exact ? o.total_usd : cash.usd, p_lbp: cash.exact ? 0 : cash.lbp, p_change_usd: cash.changeUsd, p_change_lbp: cash.changeLbp });
          await say(O.collected(Number(r.cash_usd)));
          await afterCash(r, await rpc<string | null>(db, "driver_active_delivery", { p_driver: driver }));
        } catch (err) {
          if (!String(err).includes("AMOUNT_MISMATCH")) throw err;
          await say(O.mismatch(Number(o.total_usd)));
        }
      }
    } catch (err) {
      // The outbox could not say whether a message is ours to send (or Kapso did not take it): nothing more may go out.
      // The whole turn retries, as turn.ts does (invariant 20).
      if (isOutboxFailure(err)) throw err;
      await say(O.riderError);
      await alertOps(deps, O.riderErrorAlert(String(err).slice(0, 160)), `${turnKey}:alert:error`);
    }
  }
  return { outcome: "rider", sent };
}

/** 2.5: the goods of a failed delivery are coming back. The pickers and the ops lead get the button that opens the count. */
export async function announceReturn(deps: TurnDeps, orderId: string): Promise<void> {
  const card = await rpc<ReturnCard>(deps.db, "return_card", { p_order: orderId });
  const msg = buttons(O.returnBack(card.short_code), [{ id: staffButtonId({ kind: "ret", action: "open", id: orderId }), title: O.countReturn }]);
  const to = [...await rpc<string[]>(deps.db, "pick_recipients", {}), ...await rpc<string[]>(deps.db, "ops_recipients", {})];
  for (const id of new Set(to)) await sendToParty(deps, id, msg, `retnotice:${orderId}:${id}`);
}

// ---------- a rider who cannot continue (2.10) ----------

// M1 (G1-23): the customer hears these in their language; past 24 hours, through the approved utility template of the event.
const notifyCustomer = (deps: TurnDeps, partyId: string, event: TemplateEvent, build: (m: Messages) => Built, key: string, orderId?: string) =>
  sendCodeStarted({ db: deps.db, send: deps.send }, partyId, event, build, key, orderId);

interface RiderOnShift { driver_id: string; name: string | null; cash_usd: number; active_delivery: string | null }

async function riderIncident(deps: TurnDeps, staff: string, b: { action: "ask" | "yes" | "back" | "cash"; id: string } | null,
                             out: (m: Outbound) => Promise<unknown>, say: (t: string) => Promise<unknown>): Promise<void> {
  const { db } = deps;
  if (!b) {
    const riders = await rpc<RiderOnShift[]>(db, "riders_on_shift", {});
    if (!riders.length) { await say(STAFF_TEXT.noRiders); return; }
    for (const r of riders.slice(0, 5)) {
      await out(buttons(STAFF_TEXT.riderRow(r.name ?? "", Number(r.cash_usd), !!r.active_delivery),
        [{ id: staffButtonId({ kind: "roff", action: "ask", id: r.driver_id }), title: O.riderCannot }]));
    }
    return;
  }
  if (b.action === "ask") {
    const name = (await rpc<RiderOnShift[]>(db, "riders_on_shift", {})).find((r) => r.driver_id === b.id)?.name ?? O.theRider;
    await out(buttons(O.riderConfirm(name), [{ id: staffButtonId({ kind: "roff", action: "yes", id: b.id }), title: O.riderConfirmButton }]));
    return;
  }
  if (b.action === "yes") {
    const r = await rpc<{ already?: boolean; rider: string | null; requeued: { order_id: string }[]; stranded: { order_id: string; short_code: string; customer_id: string }[]; cash_usd: number; cash_lbp: number }>(
      db, "mark_rider_off", { p_driver: b.id, p_by: staff, p_reason: "cannot_continue" });
    if (r.already) { await say(O.riderAlreadyOff(r.rider ?? O.theRider)); return; }
    const btns = [
      ...r.stranded.slice(0, 2).map((x) => ({ id: staffButtonId({ kind: "roff", action: "back", id: x.order_id }), title: O.sendBack(x.short_code) })),
      ...(Number(r.cash_usd) || Number(r.cash_lbp) ? [{ id: staffButtonId({ kind: "roff", action: "cash", id: b.id }), title: O.cashReceivedButton }] : []),
    ];
    const text = O.riderOff(r.rider ?? O.theRider, r.requeued.length, r.stranded.map((x) => x.short_code), Number(r.cash_usd), Number(r.cash_lbp));
    await out(btns.length ? buttons(text, btns) : { type: "text", text: { body: text } });
    await sendToParty(deps, b.id, { type: "text", text: { body: STAFF_TEXT.riderOffToRider } }, `riderinc:${b.id}:${requireTurnKey(deps)}`);
    for (const x of r.stranded) await notifyCustomer(deps, x.customer_id, "order_delayed",
      (m) => ({ msg: { type: "text", text: { body: m.notice.delayed(x.short_code) } }, params: [x.short_code] }), `riderinc:${x.order_id}`, x.order_id);
    // Re-offer now; the cron repeats every minute for any order still without a rider.
    for (const id of [...r.requeued.map((x) => x.order_id), ...r.stranded.map((x) => x.order_id)]) {
      await dispatchAndOffer(deps, id).catch((err) => { if (isOutboxFailure(err)) throw err; });
    }
    return;
  }
  if (b.action === "back") {
    const r = await rpc<{ ok: boolean; status: string; short_code: string; customer_id?: string; credit_usd?: number }>(db, "call_off_stranded", { p_order: b.id, p_by: staff });
    if (!r.ok) { await say(STAFF_TEXT.notCalledOff(r.short_code, r.status)); return; }
    await say(STAFF_TEXT.calledOff(r.short_code));
    if (r.customer_id) await notifyCustomer(deps, r.customer_id, "delivery_called_off",
      (m) => ({ msg: { type: "text", text: { body: m.notice.calledOff(r.short_code, Number(r.credit_usd ?? 0)) } }, params: [r.short_code] }), `calloff:${b.id}`, b.id);
    await announceReturn(deps, b.id);
    return;
  }
  const c = await rpc<{ usd: number; lbp: number }>(db, "receive_rider_cash", { p_driver: b.id, p_by: staff });
  await say(STAFF_TEXT.cashIn(Number(c.usd), Number(c.lbp)));
}

const isOutboxFailure = (err: unknown) => err instanceof OutboxUnavailable || (err as Error)?.name === "OutboxUnavailable";

const dropButtons = () => [
  { id: riderButtonId({ kind: "shift", action: "drop_hub", id: "" }), title: O.dropHub },
  { id: riderButtonId({ kind: "shift", action: "drop_omt", id: "" }), title: O.dropOmt },
];

// ---------- the hub: pickers and the ops lead (2.1) ----------

interface PickLine { n: number; item_id: string; name: string; qty: number; unit: string; on_hold: boolean; note: string | null }
interface PickList { order_id: string; short_code: string; status: string; notes: string | null; total_usd: number; lines: PickLine[];
  missing: { item_id: string; name: string; qty: number; status: string }[] }
interface PickChanges { short_code: string; total_usd: number; fx_rate_lbp: number | null; payment_method: string;
  removed: { name: string; qty: number; line_total_usd: number }[]; substituted?: { name: string; by: string; qty: number; line_total_usd: number }[];
  credit_usd: number }
interface Candidate { product_id: string; name: string; unit_price_usd: number; line_total_usd: number; diff_usd: number }
interface Offer { offer_id: string; order_id: string; short_code: string; customer_id: string; missing_name: string; substitute_name: string;
  missing_name_ar?: string | null; substitute_name_ar?: string | null;
  qty: number; replaced_total_usd: number; line_total_usd: number; diff_usd: number; answer_min: number }

export type StaffButton =
  | { kind: "pick"; action: "start" | "done" | "missing" | "line" | "remove"; id: string }
  | { kind: "ret"; action: "open" | "default" | "all_fit" | "all_waste"; id: string }
  | { kind: "roff"; action: "ask" | "yes" | "back" | "cash"; id: string }
  | { kind: "sub"; action: "offer"; id: string; product: string };
export const staffButtonId = (b: StaffButton) => `${b.kind}:${b.action}:${b.id}${b.kind === "sub" ? ":" + b.product : ""}`;
export function parseStaffButton(id: string): StaffButton | null {
  const m = /^(pick):(start|done|missing|line|remove):([0-9a-f-]{36})$/.exec(id) ?? /^(ret):(open|default|all_fit|all_waste):([0-9a-f-]{36})$/.exec(id)
    ?? /^(roff):(ask|yes|back|cash):([0-9a-f-]{36})$/.exec(id);
  if (m) return { kind: m[1], action: m[2], id: m[3] } as StaffButton;
  const s = /^sub:offer:([0-9a-f-]{36}):([0-9a-f-]{36})$/.exec(id);
  return s ? { kind: "sub", action: "offer", id: s[1]!, product: s[2]! } : null;
}
/** The customer's answer to a substitute (2.2): sub:keep:<offer> or sub:remove:<offer>, on the customer line. */
export const substitutionButtonId = (keep: boolean, offerId: string) => `sub:${keep ? "keep" : "remove"}:${offerId}`;
export function parseSubstitutionButton(id: string): { keep: boolean; offerId: string } | null {
  const m = /^sub:(keep|remove):([0-9a-f-]{36})$/.exec(id);
  return m ? { keep: m[1] === "keep", offerId: m[2]! } : null;
}

const RIDERS = /^(سائقين|سواقين|الشوفيرية|riders|drivers)$/i;
const RETURNS = /^(مرتجع|مرتجعات|رجعة|returns?|retours?)$/i;
const PICK_QUEUE = /^(طلبات|تحضير|حضّر|حضر|pick|orders|list|commandes)$/i;
const PICK_DONE = /^(خلص|خلصت|خلّصت|جاهز|done|picked)$/i;
const PICK_MISSING = /^(?:ناقص|نقص|missing|manque|n)\s*(\d{1,2})(?:\s+(?:لقيت\s+)?(\d+(?:\.\d+)?))?$/i;

/** The staff texts, by their old names (tests and callers read them here). The words are in messages/ (ops section). */
export const STAFF_TEXT = {
  noOrders: O.noOrders, taken: O.taken, busy: O.busy, notPickable: O.notPickable, noOpenPick: O.noOpenPick, noSuchLine: O.noSuchLine,
  removed: O.removed, removedLine: O.removedLine, ready: O.ready, waiting: O.waiting, chooseSub: O.chooseSub, subAsked: O.subAsked,
  subKept: O.subKept, subRemoved: O.subRemoved, subNotSent: O.subNotSent, empty: O.empty, emptyOps: O.emptyOps, unknown: O.unknown,
  noReturns: O.noReturns, returnBack: O.returnBack, returnDone: O.returnDone, returnAlready: O.returnAlready, opsOnly: O.opsOnly,
  noRiders: O.noRiders, riderRow: O.riderRow, riderConfirm: O.riderConfirm, riderOff: O.riderOff, riderAlreadyOff: O.riderAlreadyOff,
  riderOffToRider: O.riderOffToRider, calledOff: O.calledOff, notCalledOff: O.notCalledOff, cashIn: O.cashIn, error: O.error,
};

/** The pick list as the picker reads it: numbered lines in shelf order, then the two buttons. */
export function pickCard(l: PickList): Outbound[] {
  const body = O.pickCard(l.short_code, l.lines.map((x) => ({ n: x.n, qty: x.qty, name: x.name, note: x.note })),
                          l.missing.map((x) => ({ qty: x.qty, name: x.name, pending: x.status === "missing" })), l.notes);
  return [
    { type: "text", text: { body: body.slice(0, 4000) } },
    buttons(O.pickAsk(l.short_code), [
      { id: staffButtonId({ kind: "pick", action: "done", id: l.order_id }), title: O.pickDone },
      { id: staffButtonId({ kind: "pick", action: "missing", id: l.order_id }), title: O.pickMissing },
    ]),
  ];
}

interface ReturnCard { order_id: string; short_code: string; status: string; lines: { name: string; qty: number; default: "restock" | "write_off" }[] }

/** The return as the person receiving it reads it (2.5): each line with its default, then three buttons. */
export function returnCard(c: ReturnCard): Outbound {
  return buttons(O.returnCard(c.short_code, c.lines.map((l) => ({ qty: l.qty, name: l.name, restock: l.default === "restock" }))).slice(0, 1000), [
    { id: staffButtonId({ kind: "ret", action: "default", id: c.order_id }), title: O.returnDefault },
    { id: staffButtonId({ kind: "ret", action: "all_fit", id: c.order_id }), title: O.returnAllFit },
    { id: staffButtonId({ kind: "ret", action: "all_waste", id: c.order_id }), title: O.returnAllWaste },
  ]);
}

/**
 * What the customer hears when the shelf changed their order: what was taken off, what was swapped, the new total, any money owed
 * back. In the customer's language (M1); the template's three values are the code, the same facts in one line, and the total.
 */
export function pickChangeText(c: PickChanges, lang?: string | null): Built | null {
  const m = messages(lang);
  const subs = c.substituted ?? [];
  if (!c.removed.length && !subs.length) return null;
  const removed = c.removed.map((r) => `${r.qty} × ${r.name}`);
  const lines = [m.shelf.ready(c.short_code)];
  if (removed.length) lines.push(m.shelf.notFound(removed));
  for (const x of subs) lines.push(m.shelf.swapped(x.name, String(x.qty), x.by, x.line_total_usd));
  const lbp = c.payment_method === "cod" && c.fx_rate_lbp ? Math.round((c.total_usd * c.fx_rate_lbp) / 1000) * 1000 : null;
  lines.push("", m.shelf.newTotal(c.total_usd, lbp));
  if (Number(c.credit_usd) > 0) lines.push("", m.shelf.credit(Number(c.credit_usd)));
  return { msg: { type: "text", text: { body: lines.join("\n") } },
           params: [c.short_code, m.shelf.summary(removed, subs.map((x) => ({ name: x.name, by: x.by }))), usd(c.total_usd)] };
}

/** The customer's question (2.2): what is missing, what we have instead, the price difference, and the deadline. Facts only. */
export function substitutionQuestion(o: Offer, lang?: string | null): Built {
  const m = messages(lang);
  const missing = productName({ name: o.missing_name, name_ar: o.missing_name_ar ?? null }, m.lang);
  const substitute = productName({ name: o.substitute_name, name_ar: o.substitute_name_ar ?? null }, m.lang);
  const body = m.sub.question(o.short_code, String(o.qty), missing, Number(o.replaced_total_usd), substitute, Number(o.line_total_usd), Number(o.diff_usd), o.answer_min);
  const ids = [substitutionButtonId(true, o.offer_id), substitutionButtonId(false, o.offer_id)];
  return { msg: buttons(body, [{ id: ids[0]!, title: m.sub.keep }, { id: ids[1]!, title: m.sub.remove }]),
           params: [o.short_code, `${o.qty} × ${missing}`, `${o.qty} × ${substitute}`, usd(o.line_total_usd), String(o.answer_min)], payloads: ids };
}

/** The answers to the substitute question's two buttons, in the customer's language (M1). */
export const subText = (lang?: string | null) => messages(lang).sub;

/**
 * The customer's keep or remove tap (2.2). Lane B calls this from turn.ts for any customer button it does not own, before the
 * model sees it: it returns false for anything that is not a substitution button. The database decides; this only reports.
 */
export async function handleSubstitutionButton(deps: TurnDeps, partyId: string, tapped: string, wamid: string, lang?: string | null): Promise<boolean> {
  const b = parseSubstitutionButton(tapped);
  if (!b) return false;
  const turnKey = requireTurnKey(deps);
  const r = await rpc<{ changed: boolean; status: string; short_code: string; order_id: string; offered_by: string; total_usd: number; substitute_name: string }>(
    deps.db, "answer_substitution", { p_offer: b.offerId, p_party: partyId, p_keep: b.keep, p_wamid: wamid });
  const t = subText(lang);
  const text = !r.changed && r.status === "expired" ? t.late(r.short_code, r.total_usd)
    : r.status === "kept" ? t.kept(r.short_code, r.total_usd) : t.removed(r.short_code, r.total_usd);
  await sendToCustomer(deps, partyId, { type: "text", text: { body: text } }, `${turnKey}:sub:${b.offerId}`, r.order_id);
  if (r.changed) {
    const name = r.substitute_name;
    await sendToParty(deps, r.offered_by, { type: "text", text: { body: r.status === "kept" ? STAFF_TEXT.subKept(r.short_code, name) : STAFF_TEXT.subRemoved(r.short_code, name) } },
      `subans:${b.offerId}`);
  }
  return true;
}

/** A message to a customer about their order. On the customer line, never the ops line (invariant 9). */
export async function sendToCustomer(deps: TurnDeps, partyId: string, msg: Outbound, dedupeKey: string, orderId?: string) {
  const to = await rpc<string | null>(deps.db, "party_address", { p_party: partyId, p_line: "customer" });
  if (!to) return { ok: false as const, refused: "no_address" };
  return deps.send({ line: "customer", partyId, to, msg, category: "service", orderId, dedupeKey });
}

async function processStaffTurn(deps: TurnDeps, pending: Pending[], staff: string, to: string, role: string): Promise<TurnResult> {
  const { db } = deps;
  const sent: string[] = [];
  let n = 0;
  const turnKey = requireTurnKey(deps);
  const out = async (msg: Outbound) => { const r = await deps.send({ line: "ops", partyId: staff, to, msg, category: "service", dedupeKey: `${turnKey}:${n++}` }); if (r.ok) sent.push(msg.type); };
  const say = (text: string) => out({ type: "text", text: { body: text } });
  const showPick = async (l: PickList) => { for (const m of pickCard(l)) await out(m); };

  const finished = async (orderId: string) => {
    const r = await rpc<{ status: string; short_code: string; customer_id?: string; changed?: boolean; changes?: PickChanges; lines?: { name: string; offer_open?: boolean; seconds_left?: number }[] }>(
      db, "finish_pick", { p_order: orderId, p_by: staff });
    if (r.status === "ready") {
      await say(STAFF_TEXT.ready(r.short_code));
      const rider = await rpc<string | null>(db, "order_rider", { p_order: orderId });
      if (rider) await sendToParty(deps, rider, { type: "text", text: { body: O.readyForRider(r.short_code) } }, `ready:${orderId}`);
      const changes = r.changes;
      if (changes && r.customer_id && pickChangeText(changes))
        await notifyCustomer(deps, r.customer_id, "shelf_changes", (m) => pickChangeText(changes, m.lang)!, `pickdone:${orderId}`, orderId);
    } else if (r.status === "waiting") await say(O.waiting(r.short_code, (r.lines ?? []).map((x) =>
      x.offer_open ? O.waitingOffer(x.name, Math.max(1, Math.ceil(Number(x.seconds_left ?? 0) / 60))) : O.waitingDecide(x.name))));
    else if (r.status === "empty") { await say(STAFF_TEXT.empty(r.short_code)); await alertOps(deps, STAFF_TEXT.emptyOps(r.short_code), `pickempty:${orderId}`); }
    else if (r.status === "already") await say(STAFF_TEXT.ready(r.short_code));
    else await say(STAFF_TEXT.noOpenPick);
  };
  const missing = async (itemId: string, found: number) => {
    const r = await rpc<{ order_id: string; missing_item: string; total_usd: number; decision: string; candidates?: Candidate[] }>(
      db, "pick_item_missing", { p_item: itemId, p_by: staff, p_found: found });
    const l = await rpc<PickList>(db, "pick_list", { p_order: r.order_id });
    const gone = l.missing.find((x) => x.item_id === r.missing_item);
    // CX1: the customer chose "closest match" on the card: the database kept the closest substitute for them, so no question goes.
    if (r.decision === "substituted") { await say(O.subKept(l.short_code, (r as { substitute_name?: string }).substitute_name ?? "")); await showPick(l); return; }
    if (r.decision === "pending" && r.candidates?.length) {
      // 2.2: the picker may offer one substitute from the list the database allows; the customer decides.
      await out(list(O.chooseSub(gone?.name ?? ""), O.chooseSubButton, [
        ...r.candidates.map((c) => ({ id: staffButtonId({ kind: "sub", action: "offer", id: r.missing_item, product: c.product_id }), title: c.name,
          description: O.subRow(Number(c.diff_usd)) })),
        { id: staffButtonId({ kind: "pick", action: "remove", id: r.missing_item }), title: O.removeRow },
      ]));
      return;
    }
    await say(STAFF_TEXT.removed(gone?.name ?? "", r.total_usd));
    await showPick(l);
  };
  const offerSub = async (missingItem: string, product: string) => {
    const o = await rpc<Offer>(db, "pick_offer_substitute", { p_missing: missingItem, p_product: product, p_by: staff });
    const r = await notifyCustomer(deps, o.customer_id, "substitute_question", (m) => substitutionQuestion(o, m.lang), `subask:${o.offer_id}`, o.order_id);
    await say(r.ok ? STAFF_TEXT.subAsked(o.answer_min) : STAFF_TEXT.subNotSent);
    await showPick(await rpc<PickList>(db, "pick_list", { p_order: o.order_id }));
  };

  const voiced = { seconds: 0 };
  const turnIds = pending.map((x) => x.event.message.id);
  for (const p of pending) {
    const m = p.event.message;
    try {
      if (m.type === "audio") { await voiceNote(deps, m, { partyId: staff, role: "staff" }, say, voiced, turnIds, turnKey); continue; }
      const tapped = m.type === "interactive" ? (m.interactive?.button_reply?.id ?? m.interactive?.list_reply?.id) : undefined;
      const b = tapped ? parseStaffButton(tapped) : null;
      const text = (m.text?.body ?? "").trim();
      const typedMissing = PICK_MISSING.exec(text);

      if (b?.action === "start") {
        const r = await rpc<{ status: string; list?: PickList; open_order?: string; open_code?: string; short_code?: string; order_status?: string; held?: string[] }>(
          db, "start_pick", { p_order: b.id, p_by: staff });
        if (r.status === "started" || r.status === "already") {
          await showPick(r.list!);
          // 2.4: the rider is offered now, while the order is picked. A failure here never stops the pick; the cron retries.
          if (r.status === "started") await dispatchAndOffer(deps, b.id).catch((err) => { if (isOutboxFailure(err)) throw err; });
        }
        else if (r.status === "taken") await say(STAFF_TEXT.taken);
        else if (r.status === "busy") { await say(STAFF_TEXT.busy(r.open_code!)); await showPick(await rpc<PickList>(db, "pick_list", { p_order: r.open_order })); }
        else await say(STAFF_TEXT.notPickable(r.short_code ?? "", r.order_status ?? ""));
      } else if (b?.action === "done" || PICK_DONE.test(text)) {
        const orderId = b?.id ?? await rpc<string | null>(db, "pick_open_for", { p_picker: staff });
        if (!orderId) { await say(STAFF_TEXT.noOpenPick); continue; }
        await finished(orderId);
      } else if (b?.action === "missing") {
        const l = await rpc<PickList>(db, "pick_list", { p_order: b.id });
        if (!l.lines.length) { await say(STAFF_TEXT.noSuchLine(1)); continue; }
        await out(list(O.whichMissing(l.short_code), O.whichMissingButton,
          l.lines.slice(0, 10).map((x) => ({ id: staffButtonId({ kind: "pick", action: "line", id: x.item_id }), title: `${x.n}. ${x.name}`, description: `${x.qty} × ${x.unit}` }))));
      } else if (b?.kind === "pick" && b.action === "line") {
        await missing(b.id, 0);
      } else if (b?.kind === "pick" && b.action === "remove") {
        const r = await rpc<{ order_id: string; total_usd: number }>(db, "pick_remove_missing", { p_missing: b.id, p_by: staff });
        await say(STAFF_TEXT.removedLine(r.total_usd));
        await showPick(await rpc<PickList>(db, "pick_list", { p_order: r.order_id }));
      } else if (b?.kind === "ret" && b.action === "open") {
        await out(returnCard(await rpc<ReturnCard>(db, "return_card", { p_order: b.id })));
      } else if (b?.kind === "ret") {
        const r = await rpc<{ already?: boolean; restocked_units?: number; wasted_units?: number; short_code: string }>(
          db, "receive_return_by_button", { p_order: b.id, p_by: staff, p_choice: b.action });
        await say(r.already ? STAFF_TEXT.returnAlready(r.short_code) : STAFF_TEXT.returnDone(r.short_code, Number(r.restocked_units ?? 0), Number(r.wasted_units ?? 0)));
      } else if (RETURNS.test(text)) {
        const back = await rpc<{ order_id: string; short_code: string }[]>(db, "returns_pending", {});
        if (!back.length) { await say(STAFF_TEXT.noReturns); continue; }
        await out(buttons(O.returnsWaiting(back.map((x) => x.short_code)),
          back.slice(0, 3).map((x) => ({ id: staffButtonId({ kind: "ret", action: "open", id: x.order_id }), title: `#${x.short_code}` }))));
      } else if (b?.kind === "roff" || RIDERS.test(text)) {
        if (role === "picker") { await say(STAFF_TEXT.opsOnly); continue; }
        await riderIncident(deps, staff, b?.kind === "roff" ? b : null, out, say);
      } else if (b?.kind === "sub") {
        await offerSub(b.id, b.product);
      } else if (typedMissing) {
        const orderId = await rpc<string | null>(db, "pick_open_for", { p_picker: staff });
        if (!orderId) { await say(STAFF_TEXT.noOpenPick); continue; }
        const l = await rpc<PickList>(db, "pick_list", { p_order: orderId });
        const line = l.lines.find((x) => x.n === Number(typedMissing[1]));
        if (!line) { await say(STAFF_TEXT.noSuchLine(Number(typedMissing[1]))); continue; }
        const found = typedMissing[2] ? Number(typedMissing[2]) : 0;
        if (found >= line.qty) { await say(O.foundAll(found, line.qty)); continue; }
        await missing(line.item_id, found);
      } else if (PICK_QUEUE.test(text)) {
        const open = await rpc<string | null>(db, "pick_open_for", { p_picker: staff });
        if (open) { await showPick(await rpc<PickList>(db, "pick_list", { p_order: open })); continue; }
        const q = (await rpc<{ order_id: string; short_code: string; status: string; village: string | null; items: number }[]>(db, "pick_queue", { p_limit: 5 }))
          .filter((x) => x.status === "confirmed");
        if (!q.length) { await say(STAFF_TEXT.noOrders); continue; }
        await out(buttons(O.queue(q.map((x) => ({ code: x.short_code, items: x.items, village: x.village }))),
          q.slice(0, 3).map((x) => ({ id: staffButtonId({ kind: "pick", action: "start", id: x.order_id }), title: O.startButton(x.short_code) }))));
      } else if (text || tapped) {
        await say(STAFF_TEXT.unknown);
      }
    } catch (err) {
      if (isOutboxFailure(err)) throw err;
      await say(STAFF_TEXT.error);
      await alertOps(deps, O.pickError(String(err).slice(0, 160)), `${turnKey}:alert:error`);
    }
  }
  return { outcome: "buttons", sent };
}
