// What a rider sees on the ops line. Plain text plus buttons: it has to be readable on a cracked screen at a red light.
import { buttons, type Outbound } from "@ak/wa/kapso";

export interface JobStop {
  seq: number; kind: "pickup" | "dropoff" | "cash_drop"; done: boolean; arrived: boolean;
  source?: string | null; source_id?: string | null; source_village?: string | null;
  order_id?: string | null; short_code?: string | null; order_status?: string | null; customer?: string | null; phone?: string | null;
  village?: string | null; lat?: number | null; lng?: number | null; directions?: string | null; notes?: string | null;
  payment_method?: string | null; total_usd?: number | null; fx_rate_lbp?: number | null; change_for_usd?: number | null; paid?: boolean; items?: number;
}
export interface Job { delivery_id: string; driver_id: string; status: string; collect_usd: number; stops: JobStop[] }

const money = (usd: number, fx?: number | null) =>
  fx ? `$${usd.toFixed(2)} (${(Math.round((usd * fx) / 1000) * 1000).toLocaleString("en-US")} ل.ل)` : `$${usd.toFixed(2)}`;

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
  const lines = [
    `🛵 طلب جديد${drops.length > 1 ? ` (${drops.length} طلبات)` : ""}`,
    `استلام: ${pickups}${minutesToPickup ? ` · ${Math.round(minutesToPickup)} د` : ""}`,
    ...drops.map((s) => `توصيل: ${s.village ?? "?"} · #${s.short_code} · ${s.paid ? "مدفوع" : money(Number(s.total_usd ?? 0))}`),
    job.collect_usd > 0 ? `كاش للتحصيل: $${Number(job.collect_usd).toFixed(2)}` : "ما في كاش",
  ];
  return buttons(lines.join("\n"), [
    { id: riderButtonId({ kind: "job", action: "accept", id: job.delivery_id }), title: "قبول ✅" },
    { id: riderButtonId({ kind: "job", action: "decline", id: job.delivery_id }), title: "ما فيني" },
  ]);
}

export function pickupCard(job: Job): Outbound {
  const lines = job.stops.filter((s) => s.kind === "pickup").map((s) => `${s.done ? "✅" : "⬜"} ${s.source}${s.source_village ? " · " + s.source_village : ""}`);
  const codes = job.stops.filter((s) => s.kind === "dropoff").map((s) => "#" + s.short_code).join(" ");
  return buttons(`الاستلام ${codes}\n${lines.join("\n")}\nكبّس بس تستلم كل شي.`, [
    { id: riderButtonId({ kind: "job", action: "picked", id: job.delivery_id }), title: "استلمت 📦" },
  ]);
}

/** The next door. The pin goes as a separate location message so it opens in the rider's maps app. */
export function dropCard(s: JobStop): Outbound {
  const lines = [
    `📍 #${s.short_code} · ${s.customer ?? ""} · ${s.village ?? ""}`,
    s.directions ? `العنوان: ${s.directions}` : null,
    s.phone ? `تلفون: ${s.phone}` : null,
    s.notes ? `ملاحظة: ${s.notes}` : null,
    s.paid ? "مدفوع مسبقاً. ما تاخد مصاري." : `حصّل: ${money(Number(s.total_usd ?? 0), s.fx_rate_lbp)}${s.change_for_usd ? ` · معو ${s.change_for_usd}$، جهّز الباقي` : ""}`,
  ].filter(Boolean);
  return buttons(lines.join("\n"), [
    { id: riderButtonId({ kind: "stop", action: "arrived", id: s.order_id! }), title: "وصلت" },
    { id: riderButtonId({ kind: "stop", action: "delivered", id: s.order_id! }), title: "سلّمت ✅" },
    { id: riderButtonId({ kind: "stop", action: "noanswer", id: s.order_id! }), title: "ما حدا عم يرد" },
  ]);
}

export function cashAsk(s: { order_id: string; short_code: string; total_usd: number; fx_rate_lbp?: number | null }): Outbound {
  return buttons(`#${s.short_code}: قديش قبضت؟ المطلوب ${money(Number(s.total_usd), s.fx_rate_lbp)}\nاكتب المبلغ (مثلاً: 20$ و 300 الف) أو كبّس إذا المبلغ مظبوط بالدولار.`, [
    { id: riderButtonId({ kind: "stop", action: "exact", id: s.order_id }), title: "مظبوط بالدولار" },
  ]);
}

export const RIDER_TEXT = {
  shiftStarted: "بلّش الدوام. بعتلي موقعك (📎 ← Location) لنعرف وين إنت.",
  shiftAlready: "إنت أصلاً بالدوام.",
  notOnShift: "إنت مش بالدوام. اكتب «حاضر» لتبلّش.",
  offerGone: "هالطلب راح لغيرك أو انتهى وقتو.",
  accepted: "تمام، الطلب إلك.",
  declined: "ماشي، رح نعطيه لغيرك.",
  cashUnclear: "ما فهمت المبلغ. اكتبو هيك: 20$ أو 1,800,000 أو 10$ و 900 الف.",
  noJob: "ما في طلب معك هلق.",
  dropAsk: "وين بدك تسلّم الكاش؟",
  shiftBlocked: "ما فيك تسكّر الدوام وفي طلب معك.",
  softCap: "معك كاش كتير. سلّم بأقرب فرصة (المركز أو OMT).",
  hardCap: "وصلت للحد الأقصى من الكاش. ما رح يوصلك طلبات لتسلّم.",
  unknown: "ما فهمت. استعمل الأزرار، أو اكتب «حاضر» / «خلصت» / «كاش».",
};
