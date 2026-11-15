// What a rider sees on the ops line. Plain text plus buttons: it has to be readable on a cracked screen at a red light.
import { buttons, type Outbound } from "@ak/wa/kapso";
import { messages, STAFF_LANG } from "./messages";

export interface JobStop {
  seq: number; kind: "pickup" | "dropoff" | "cash_drop"; done: boolean; arrived: boolean;
  source?: string | null; source_id?: string | null; source_village?: string | null;
  order_id?: string | null; short_code?: string | null; order_status?: string | null; customer?: string | null; phone?: string | null;
  village?: string | null; lat?: number | null; lng?: number | null; directions?: string | null; notes?: string | null;
  payment_method?: string | null; total_usd?: number | null; fx_rate_lbp?: number | null; change_for_usd?: number | null; paid?: boolean; items?: number;
  /** CX1 (0146): the customer keeps the change as credit; the order waits for the customer's handover code. */
  keep_change?: boolean; code_required?: boolean;
}
export interface Job { delivery_id: string; driver_id: string; status: string; collect_usd: number; stops: JobStop[] }

// M1: the words are in messages/ (ops section), in the staff's language. Each amount on its own line.
const O = messages(STAFF_LANG).ops;
/** The lira equivalent of a dollar amount at the order's rate, rounded to 1,000 as the card rounds; null without a rate. */
const lbpOf = (usd: number, fx?: number | null) => (fx ? Math.round((usd * fx) / 1000) * 1000 : null);

export type RiderButton =
  | { kind: "job"; action: "accept" | "decline" | "picked"; id: string }
  | { kind: "stop"; action: "arrived" | "delivered" | "noanswer" | "exact"; id: string }
  | { kind: "shift"; action: "start" | "end" | "drop_hub" | "drop_omt"; id: "" };

export const riderButtonId = (b: RiderButton) => `${b.kind}:${b.action}${b.id ? ":" + b.id : ""}`;
export function parseRiderButton(id: string): RiderButton | null {
  const m = id.match(/^(job|stop|shift):([a-z_]+)(?::([0-9a-f-]{36}))?$/);
  if (!m) return null;
  return { kind: m[1], action: m[2], id: m[3] ?? "" } as RiderButton;
}

export function offerCard(job: Job, minutesToPickup?: number): Outbound {
  const pickups = job.stops.filter((s) => s.kind === "pickup").map((s) => s.source).join(" + ");
  const drops = job.stops.filter((s) => s.kind === "dropoff");
  const body = O.offer(drops.length, pickups, minutesToPickup ?? null,
    drops.map((s) => ({ village: s.village ?? null, code: s.short_code ?? "", paid: !!s.paid, total: Number(s.total_usd ?? 0), lbp: null })), Number(job.collect_usd));
  return buttons(body, [
    { id: riderButtonId({ kind: "job", action: "accept", id: job.delivery_id }), title: O.accept },
    { id: riderButtonId({ kind: "job", action: "decline", id: job.delivery_id }), title: O.decline },
  ]);
}

export function pickupCard(job: Job): Outbound {
  const stops = job.stops.filter((s) => s.kind === "pickup").map((s) => ({ done: s.done, source: s.source ?? "", village: s.source_village ?? null }));
  const codes = job.stops.filter((s) => s.kind === "dropoff").map((s) => s.short_code ?? "");
  return buttons(O.pickup(codes, stops), [
    { id: riderButtonId({ kind: "job", action: "picked", id: job.delivery_id }), title: O.picked },
  ]);
}

/** The next door. The pin goes as a separate location message so it opens in the rider's maps app. */
export function dropCard(s: JobStop): Outbound {
  const total = Number(s.total_usd ?? 0);
  const keep = s.keep_change && s.change_for_usd && !s.paid;
  // CX1: what the rider must know at the door: no change to give (the customer keeps it as credit), or a code to ask for.
  const extra = [keep ? O.keepChange(Number(s.change_for_usd)) : null, s.code_required ? O.askCode(s.short_code ?? "") : null].filter(Boolean);
  const body = O.drop({ code: s.short_code ?? "", customer: s.customer ?? "", village: s.village ?? "", directions: s.directions ?? null, phone: s.phone ?? null,
                        notes: s.notes ?? null, paid: !!s.paid, total, lbp: lbpOf(total, s.fx_rate_lbp), changeFor: keep ? null : s.change_for_usd ?? null });
  return buttons([body, ...extra].join("\n"), [
    { id: riderButtonId({ kind: "stop", action: "arrived", id: s.order_id! }), title: O.arrived },
    { id: riderButtonId({ kind: "stop", action: "delivered", id: s.order_id! }), title: O.delivered },
    { id: riderButtonId({ kind: "stop", action: "noanswer", id: s.order_id! }), title: O.noAnswer },
  ]);
}

export function cashAsk(s: { order_id: string; short_code: string; total_usd: number; fx_rate_lbp?: number | null }): Outbound {
  return buttons(O.cashAsk(s.short_code, Number(s.total_usd), lbpOf(Number(s.total_usd), s.fx_rate_lbp)), [
    { id: riderButtonId({ kind: "stop", action: "exact", id: s.order_id }), title: O.exactButton },
  ]);
}

export const RIDER_TEXT = {
  shiftStarted: O.shiftStarted, shiftAlready: O.shiftAlready, notOnShift: O.notOnShift, offerGone: O.offerGone, accepted: O.accepted,
  declined: O.declined, cashUnclear: O.cashUnclear, noJob: O.noJob, dropAsk: O.dropAsk, shiftBlocked: O.shiftBlocked, softCap: O.softCap,
  hardCap: O.hardCap, unknown: O.riderUnknown,
};
