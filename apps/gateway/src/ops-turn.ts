// The ops line: riders, pickers and the ops lead. Everything here is deterministic: buttons, pins and typed amounts are
// parsed by code and applied by SQL functions. No model reads a staff member's message in this file.
// (Merchant messages and free-text incidents go to the Ops Copilot, build step 7.)
import type { SupabaseClient } from "@supabase/supabase-js";
import { buttons, list, type Outbound } from "@ak/wa/kapso";
import { OutboxUnavailable } from "@ak/wa/gateway";
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
  const role = await rpc<string | null>(db, "party_role", { p_party: conv.party_id });
  if (role === "picker" || role === "ops_lead" || role === "admin") return processStaffTurn(deps, pending, conv.party_id, to);
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
      // The outbox could not say whether a message is ours to send (or Kapso did not take it): nothing more may go out.
      // The whole turn retries, as turn.ts does (invariant 20).
      if (isOutboxFailure(err)) throw err;
      await say("صار في غلط. جرّب مرة تانية أو اتصل بالمركز.");
      await alertOps(deps, `⚠️ خطأ مع سائق: ${String(err).slice(0, 160)}`, `${turnKey}:alert:error`);
    }
  }
  return { outcome: "rider", sent };
}

const isOutboxFailure = (err: unknown) => err instanceof OutboxUnavailable || (err as Error)?.name === "OutboxUnavailable";

const dropButtons = () => [
  { id: riderButtonId({ kind: "shift", action: "drop_hub", id: "" }), title: "بالمركز" },
  { id: riderButtonId({ kind: "shift", action: "drop_omt", id: "" }), title: "OMT" },
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
  qty: number; replaced_total_usd: number; line_total_usd: number; diff_usd: number; answer_min: number }

export type StaffButton =
  | { kind: "pick"; action: "start" | "done" | "missing" | "line" | "remove"; id: string }
  | { kind: "sub"; action: "offer"; id: string; product: string };
export const staffButtonId = (b: StaffButton) => `${b.kind}:${b.action}:${b.id}${b.kind === "sub" ? ":" + b.product : ""}`;
export function parseStaffButton(id: string): StaffButton | null {
  const m = /^(pick):(start|done|missing|line|remove):([0-9a-f-]{36})$/.exec(id);
  if (m) return { kind: "pick", action: m[2], id: m[3] } as StaffButton;
  const s = /^sub:offer:([0-9a-f-]{36}):([0-9a-f-]{36})$/.exec(id);
  return s ? { kind: "sub", action: "offer", id: s[1]!, product: s[2]! } : null;
}
/** The customer's answer to a substitute (2.2): sub:keep:<offer> or sub:remove:<offer>, on the customer line. */
export const substitutionButtonId = (keep: boolean, offerId: string) => `sub:${keep ? "keep" : "remove"}:${offerId}`;
export function parseSubstitutionButton(id: string): { keep: boolean; offerId: string } | null {
  const m = /^sub:(keep|remove):([0-9a-f-]{36})$/.exec(id);
  return m ? { keep: m[1] === "keep", offerId: m[2]! } : null;
}

const PICK_QUEUE = /^(طلبات|تحضير|حضّر|حضر|pick|orders|list)$/i;
const PICK_DONE = /^(خلص|خلصت|خلّصت|جاهز|done|picked)$/i;
const PICK_MISSING = /^(?:ناقص|نقص|missing|n)\s*(\d{1,2})(?:\s+(?:لقيت\s+)?(\d+(?:\.\d+)?))?$/i;

const usd = (n: number) => `$${Number(n).toFixed(2)}`;
const usdLbp = (n: number, fx: number | null) => fx ? `${usd(n)} أو ${(Math.round((n * fx) / 1000) * 1000).toLocaleString("en-US")} ل.ل` : usd(n);

export const STAFF_TEXT = {
  noOrders: "ما في طلبات ناطرة تحضير هلق.",
  taken: "هالطلب عم يحضّرو حدا تاني.",
  busy: (code: string) => `خلّص تحضير #${code} أوّل.`,
  notPickable: (code: string, status: string) => `الطلب #${code} مش للتحضير هلق (${status}).`,
  noOpenPick: "ما في طلب عم تحضّرو. اكتب «طلبات» لتشوف شو ناطر.",
  noSuchLine: (n: number) => `ما في غرض رقم ${n} بالطلب.`,
  removed: (name: string, total: number) => `شلنا «${name}» من الطلب. المجموع هلق ${usd(total)}.`,
  removedLine: (total: number) => `شلنا الغرض من الطلب. المجموع هلق ${usd(total)}.`,
  ready: (code: string) => `✅ #${code} جاهز للتسليم.`,
  waiting: (code: string, names: string[]) => `#${code} ما خلص: في أغراض ناطرة قرار (${names.join("، ")}).`,
  chooseSub: (name: string) => `«${name}» ناقص. في بديل من نفس النوع؟ اختار وحدة لنسأل الزبون، أو شيلو من الطلب.`,
  subAsked: (min: number) => `سألنا الزبون. كمّل باقي الأغراض. إذا ما ردّ خلال ${min} دقايق منشيلو من الطلب.`,
  subKept: (code: string, name: string) => `#${code}: الزبون قبل «${name}». حطّو بالطلب.`,
  subRemoved: (code: string, name: string) => `#${code}: الزبون ما بدّو «${name}». رجّعو عالرف.`,
  subNotSent: "ما قدرنا نبعت السؤال للزبون. إذا ما ردّ منشيلو من الطلب بعد الوقت.",
  empty: (code: string) => `ما بقي شي بالطلب #${code}. خبّرنا الإدارة لتتصل بالزبون.`,
  emptyOps: (code: string) => `🧺 الطلب #${code} طلع كلّو ناقص بالتحضير. اتصلوا بالزبون وقرّروا (إلغاء ورد المبلغ إذا مدفوع).`,
  unknown: "ما فهمت. اكتب «طلبات» لتشوف الطلبات، أو استعمل الأزرار.",
  error: "صار في غلط. جرّب مرة تانية أو اتصل بالإدارة.",
};

/** The pick list as the picker reads it: numbered lines in shelf order, then the two buttons. */
export function pickCard(l: PickList): Outbound[] {
  const lines = l.lines.map((x) => `${x.n}. ${x.qty} × ${x.name}${x.note ? ` (${x.note})` : ""}`);
  const gone = l.missing.map((x) => `✖ ${x.qty} × ${x.name}${x.status === "missing" ? " (ناطر قرار)" : ""}`);
  const body = [`🧺 #${l.short_code} · ${l.lines.length} أغراض`, ...lines, ...(gone.length ? ["", ...gone] : []),
                ...(l.notes ? ["", `ملاحظة: ${l.notes}`] : [])].join("\n");
  return [
    { type: "text", text: { body: body.slice(0, 4000) } },
    buttons(`#${l.short_code}: ناقص شي؟ كبّس «غرض ناقص» أو اكتب «ناقص 2» («ناقص 2 1» إذا لقيت وحدة بس).`, [
      { id: staffButtonId({ kind: "pick", action: "done", id: l.order_id }), title: "خلص ✅" },
      { id: staffButtonId({ kind: "pick", action: "missing", id: l.order_id }), title: "غرض ناقص" },
    ]),
  ];
}

/** What the customer hears when the shelf changed their order: what was taken off, the new total, any money owed back. */
export function pickChangeText(c: PickChanges): string | null {
  const subs = c.substituted ?? [];
  if (!c.removed.length && !subs.length) return null;
  const lines = [`طلبك #${c.short_code} جاهز.`];
  if (c.removed.length) lines.push(`ما لقينا ${c.removed.map((r) => `${r.qty} × ${r.name}`).join("، ")}، فشلناه من الطلب.`);
  for (const x of subs) lines.push(`بدل ${x.name}: ${x.qty} × ${x.by} (${usd(x.line_total_usd)})، متل ما وافقت.`);
  lines.push(`المجموع الجديد: ${usdLbp(c.total_usd, c.payment_method === "cod" ? c.fx_rate_lbp : null)}.`);
  if (Number(c.credit_usd) > 0) lines.push(`المبلغ يلي دفعتو زيادة (${usd(c.credit_usd)}) إلك: منرجّعلك ياه أو بينحسم من طلبك الجاي، متل ما بتحب.`);
  return lines.join("\n");
}

/** The customer's question (2.2): what is missing, what we have instead, the price difference, and the deadline. Facts only. */
export function substitutionQuestion(o: Offer): Outbound {
  const diff = Number(o.diff_usd);
  const price = diff === 0 ? "نفس السعر" : diff > 0 ? `أغلى بـ ${usd(diff)}` : `أرخص بـ ${usd(-diff)}`;
  return buttons([`طلبك #${o.short_code}: ما لقينا ${o.qty} × ${o.missing_name} (${usd(o.replaced_total_usd)}).`,
    `عنا بدالو ${o.qty} × ${o.substitute_name} بـ ${usd(o.line_total_usd)} (${price}).`,
    `بتحب ناخدو؟ إذا ما جاوبت خلال ${o.answer_min} دقايق منشيلو من الطلب.`].join("\n"), [
    { id: substitutionButtonId(true, o.offer_id), title: "خلّيه ✅" },
    { id: substitutionButtonId(false, o.offer_id), title: "شيلو" },
  ]);
}

export const SUB_TEXT = {
  kept: (code: string, total: number) => `تمام، حطّينا البديل بطلبك #${code}. المجموع هلق ${usd(total)}.`,
  removed: (code: string, total: number) => `تمام، شلناه من طلبك #${code}. المجموع هلق ${usd(total)}.`,
  late: (code: string, total: number) => `خلص وقت السؤال وشلنا الغرض من طلبك #${code}. المجموع هلق ${usd(total)}.`,
};

/**
 * The customer's keep or remove tap (2.2). Lane B calls this from turn.ts for any customer button it does not own, before the
 * model sees it: it returns false for anything that is not a substitution button. The database decides; this only reports.
 */
export async function handleSubstitutionButton(deps: TurnDeps, partyId: string, tapped: string, wamid: string): Promise<boolean> {
  const b = parseSubstitutionButton(tapped);
  if (!b) return false;
  const turnKey = requireTurnKey(deps);
  const r = await rpc<{ changed: boolean; status: string; short_code: string; order_id: string; offered_by: string; total_usd: number; substitute_name: string }>(
    deps.db, "answer_substitution", { p_offer: b.offerId, p_party: partyId, p_keep: b.keep, p_wamid: wamid });
  const text = !r.changed && r.status === "expired" ? SUB_TEXT.late(r.short_code, r.total_usd)
    : r.status === "kept" ? SUB_TEXT.kept(r.short_code, r.total_usd) : SUB_TEXT.removed(r.short_code, r.total_usd);
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

async function processStaffTurn(deps: TurnDeps, pending: Pending[], staff: string, to: string): Promise<TurnResult> {
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
      const text = r.changes ? pickChangeText(r.changes) : null;
      if (text && r.customer_id) await sendToCustomer(deps, r.customer_id, { type: "text", text: { body: text } }, `pickdone:${orderId}`, orderId);
    } else if (r.status === "waiting") await say(STAFF_TEXT.waiting(r.short_code, (r.lines ?? []).map((x) =>
      x.offer_open ? `${x.name}: ناطرين الزبون ${Math.max(1, Math.ceil(Number(x.seconds_left ?? 0) / 60))} د` : `${x.name}: بديل أو شيل؟`)));
    else if (r.status === "empty") { await say(STAFF_TEXT.empty(r.short_code)); await alertOps(deps, STAFF_TEXT.emptyOps(r.short_code), `pickempty:${orderId}`); }
    else if (r.status === "already") await say(STAFF_TEXT.ready(r.short_code));
    else await say(STAFF_TEXT.noOpenPick);
  };
  const missing = async (itemId: string, found: number) => {
    const r = await rpc<{ order_id: string; missing_item: string; total_usd: number; decision: string; candidates?: Candidate[] }>(
      db, "pick_item_missing", { p_item: itemId, p_by: staff, p_found: found });
    const l = await rpc<PickList>(db, "pick_list", { p_order: r.order_id });
    const gone = l.missing.find((x) => x.item_id === r.missing_item);
    if (r.decision === "pending" && r.candidates?.length) {
      // 2.2: the picker may offer one substitute from the list the database allows; the customer decides.
      await out(list(STAFF_TEXT.chooseSub(gone?.name ?? ""), "بديل أو شيل", [
        ...r.candidates.map((c) => ({ id: staffButtonId({ kind: "sub", action: "offer", id: r.missing_item, product: c.product_id }), title: c.name,
          description: `${usd(c.line_total_usd)} (${c.diff_usd > 0 ? "+" : ""}${Number(c.diff_usd).toFixed(2)}$)` })),
        { id: staffButtonId({ kind: "pick", action: "remove", id: r.missing_item }), title: "شيلو من الطلب" },
      ]));
      return;
    }
    await say(STAFF_TEXT.removed(gone?.name ?? "", r.total_usd));
    await showPick(l);
  };
  const offerSub = async (missingItem: string, product: string) => {
    const o = await rpc<Offer>(db, "pick_offer_substitute", { p_missing: missingItem, p_product: product, p_by: staff });
    const r = await sendToCustomer(deps, o.customer_id, substitutionQuestion(o), `subask:${o.offer_id}`, o.order_id);
    await say(r.ok ? STAFF_TEXT.subAsked(o.answer_min) : STAFF_TEXT.subNotSent);
    await showPick(await rpc<PickList>(db, "pick_list", { p_order: o.order_id }));
  };

  for (const p of pending) {
    const m = p.event.message;
    try {
      const tapped = m.type === "interactive" ? (m.interactive?.button_reply?.id ?? m.interactive?.list_reply?.id) : undefined;
      const b = tapped ? parseStaffButton(tapped) : null;
      const text = (m.text?.body ?? "").trim();
      const typedMissing = PICK_MISSING.exec(text);

      if (b?.action === "start") {
        const r = await rpc<{ status: string; list?: PickList; open_order?: string; open_code?: string; short_code?: string; order_status?: string; held?: string[] }>(
          db, "start_pick", { p_order: b.id, p_by: staff });
        if (r.status === "started" || r.status === "already") await showPick(r.list!);
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
        await out(list(`#${l.short_code}: شو الناقص؟ إذا لقيت شوي منو اكتب «ناقص الرقم العدد» (مثلاً ناقص 2 1).`, "اختار الغرض",
          l.lines.slice(0, 10).map((x) => ({ id: staffButtonId({ kind: "pick", action: "line", id: x.item_id }), title: `${x.n}. ${x.name}`, description: `${x.qty} × ${x.unit}` }))));
      } else if (b?.kind === "pick" && b.action === "line") {
        await missing(b.id, 0);
      } else if (b?.kind === "pick" && b.action === "remove") {
        const r = await rpc<{ order_id: string; total_usd: number }>(db, "pick_remove_missing", { p_missing: b.id, p_by: staff });
        await say(STAFF_TEXT.removedLine(r.total_usd));
        await showPick(await rpc<PickList>(db, "pick_list", { p_order: r.order_id }));
      } else if (b?.kind === "sub") {
        await offerSub(b.id, b.product);
      } else if (typedMissing) {
        const orderId = await rpc<string | null>(db, "pick_open_for", { p_picker: staff });
        if (!orderId) { await say(STAFF_TEXT.noOpenPick); continue; }
        const l = await rpc<PickList>(db, "pick_list", { p_order: orderId });
        const line = l.lines.find((x) => x.n === Number(typedMissing[1]));
        if (!line) { await say(STAFF_TEXT.noSuchLine(Number(typedMissing[1]))); continue; }
        const found = typedMissing[2] ? Number(typedMissing[2]) : 0;
        if (found >= line.qty) { await say(`لقيت ${found} من ${line.qty}: يعني الغرض كامل، ما في ناقص.`); continue; }
        await missing(line.item_id, found);
      } else if (PICK_QUEUE.test(text)) {
        const open = await rpc<string | null>(db, "pick_open_for", { p_picker: staff });
        if (open) { await showPick(await rpc<PickList>(db, "pick_list", { p_order: open })); continue; }
        const q = (await rpc<{ order_id: string; short_code: string; status: string; village: string | null; items: number }[]>(db, "pick_queue", { p_limit: 5 }))
          .filter((x) => x.status === "confirmed");
        if (!q.length) { await say(STAFF_TEXT.noOrders); continue; }
        await out(buttons(["🧺 ناطرين تحضير:", ...q.map((x) => `#${x.short_code} · ${x.items} أغراض${x.village ? ` · ${x.village}` : ""}`)].join("\n"),
          q.slice(0, 3).map((x) => ({ id: staffButtonId({ kind: "pick", action: "start", id: x.order_id }), title: `بلّش #${x.short_code}` }))));
      } else if (text || tapped) {
        await say(STAFF_TEXT.unknown);
      }
    } catch (err) {
      if (isOutboxFailure(err)) throw err;
      await say(STAFF_TEXT.error);
      await alertOps(deps, `⚠️ خطأ بالتحضير: ${String(err).slice(0, 160)}`, `${turnKey}:alert:error`);
    }
  }
  return { outcome: "buttons", sent };
}
