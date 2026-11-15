// 3.2 Today (redesigned in D5, drawn again in DS1; docs/strategy/05, section A): KPI tiles with their comparisons; what needs a
// person first, oldest first, each with its one action; orders late or at risk; the live board of open orders by status with a
// timer against each promise; riders with cash against the caps as bars; the drawer; and a short green summary when the day is quiet.
// Reads only; the two buttons on an exception post to the exceptions page's own forms.
// "Late" is measured against the zone's ETA from the database (zones.base_eta_minutes), never a number in code (invariant 13).
// A figure with no source in the database is not shown at all (contribution, reply time, missing-item rate, message cost): they
// are listed for session AN1 in docs/HANDOFF.md, DS1. The delivery fee and tips are the rider's, so "Sales" is goods only (invariant 10).
import { html, render, type Ctx, type Section } from "../app";
import { form, lbp, minutesSince, money, usd, when } from "../html";
import { pick, t } from "../i18n";
import { kindCta, kindHref, kindName } from "../kinds";
import { ALL, LEADS } from "../roles";
import { badge, icon, kpiTile, kpis, limitBar, tabs, timerChip, timerState, type Compare, type KpiOpts } from "@ak/ui/components";
import type { Raw } from "@ak/ui/h";

export const ACTIVE = ["awaiting_confirmation", "awaiting_payment", "confirmed", "preparing", "ready", "out_for_delivery", "arrived", "failed_delivery", "delivered"] as const;
const IN_PROGRESS = new Set(["confirmed", "preparing", "ready", "out_for_delivery", "arrived"]);
const WORDS_AR: Record<string, string> = {
  awaiting_confirmation: "أُرسلت البطاقة بانتظار ضغطة الزبون", awaiting_payment: "بانتظار تحويل", confirmed: "مؤكد", preparing: "قيد التجهيز", ready: "جاهز",
  out_for_delivery: "في الطريق", arrived: "المندوب عند الباب", failed_delivery: "فشل التوصيل: البضاعة ستعود", delivered: "سُلّم ولم يُدفع بعد", closed: "مُغلق", cancelled: "مُلغى",
};
export const statusWord = (lang: "en" | "ar", s: string) => (lang === "ar" ? WORDS_AR[s] : WORDS[s]) ?? s;
const WORDS: Record<string, string> = {
  awaiting_confirmation: "card sent, waiting for the customer's tap", awaiting_payment: "waiting for a transfer", confirmed: "confirmed",
  preparing: "being picked", ready: "packed", out_for_delivery: "on the way", arrived: "rider at the door",
  failed_delivery: "failed delivery: goods to come back", delivered: "delivered, not paid yet", closed: "closed", cancelled: "cancelled",
};

/** Midnight in Beirut, as an instant. */
export function beirutMidnight(now: Date): Date {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Beirut", hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(now).filter((p) => p.type !== "literal").map((p) => [p.type, Number(p.value)]));
  return new Date(now.getTime() - (((parts.hour ?? 0) % 24) * 3600 + (parts.minute ?? 0) * 60 + (parts.second ?? 0)) * 1000 - now.getMilliseconds());
}

type Order = { id: string; short_code: string; status: string; village_id: string | null; is_pickup: boolean; total_usd: number | string;
  payment_method: string; created_at: string; confirmed_at: string | null; customer_id: string };

export async function todayData(c: Ctx) {
  const { db } = c.deps;
  const now = c.deps.now();
  const since = beirutMidnight(now).toISOString();
  const [active, finished, villages, zones, waiting] = await Promise.all([
    db.rows<Order>("orders", { select: "id,short_code,status,village_id,is_pickup,total_usd,payment_method,created_at,confirmed_at,customer_id", where: { status: { in: ACTIVE } }, order: [{ col: "created_at" }], limit: 500 }),
    db.rows<{ status: string }>("orders", { select: "status", where: { status: { in: ["closed", "cancelled"] }, created_at: { gte: since } }, limit: 5000 }),
    db.rows<{ id: string; name_en: string; zone_id: string | null }>("villages", { select: "id,name_en,zone_id" }),
    db.rows<{ id: string; base_eta_minutes: number }>("zones", { select: "id,base_eta_minutes" }),
    db.rpc<string[] | null>("orders_waiting_for_rider", {}),
  ]);
  const village = new Map(villages.map((v) => [v.id, v]));
  const eta = new Map(zones.map((z) => [z.id, Number(z.base_eta_minutes)]));
  const noRider = new Set(waiting ?? []);
  const orders = active.map((o) => {
    const v = o.village_id ? village.get(o.village_id) : undefined;
    const limit = v?.zone_id ? eta.get(v.zone_id) ?? null : null;
    const age = minutesSince(o.confirmed_at ?? o.created_at, now) ?? 0;
    const lateBy = IN_PROGRESS.has(o.status) && limit !== null && o.confirmed_at ? age - limit : null;
    return { ...o, villageName: v?.name_en ?? (o.is_pickup ? "pickup at the hub" : ""), eta: limit, age, lateBy, noRider: noRider.has(o.id) };
  });
  orders.sort((a, b) => (b.lateBy ?? -1e9) - (a.lateBy ?? -1e9) || b.age - a.age);

  const counts = new Map<string, number>();
  for (const o of [...active, ...finished]) counts.set(o.status, (counts.get(o.status) ?? 0) + 1);

  const shifts = await db.rows<{ driver_id: string; started_at: string; opening_float_usd: number | string }>("driver_shifts", { select: "driver_id,started_at,opening_float_usd", where: { ended_at: null } });
  const ids = shifts.map((s) => s.driver_id);
  const names = ids.length ? await db.rows<{ id: string; display_name: string | null }>("parties", { select: "id,display_name", where: { id: { in: ids } } }) : [];
  const cap = (await db.rpc<{ soft_usd?: number; hard_usd?: number } | null>("setting", { p_key: "cash_cap" })) ?? {};
  const riders = await Promise.all(shifts.map(async (s) => {
    const [native, held, exposure] = await Promise.all([
      db.rpc<{ usd: number | string; lbp: number | string }[]>("driver_cash_native", { p_driver: s.driver_id }),
      db.rpc<number | string>("driver_cash_usd", { p_driver: s.driver_id }),
      db.rpc<number | string>("driver_exposure_usd", { p_driver: s.driver_id }),
    ]);
    const n = Array.isArray(native) ? native[0] : (native as unknown as { usd: number; lbp: number } | null);
    return { ...s, name: names.find((p) => p.id === s.driver_id)?.display_name ?? "Rider", usd: Number(n?.usd ?? 0), lbp: Number(n?.lbp ?? 0),
             heldUsd: Number(held ?? 0), exposure: Number(exposure ?? 0) };
  }));
  return { orders, counts, riders, cap: { soft: Number(cap.soft_usd ?? 0), hard: Number(cap.hard_usd ?? 0) } };
}

type Exc = { id: string; kind: string; ref: string; detail: Record<string, unknown> | null; status: string; created_at: string };
const detailText = (d: Record<string, unknown> | null) => Object.entries(d ?? {}).filter(([k, v]) => !/(_id|^id$|customer)/.test(k) && v !== null && v !== "").slice(0, 5).map(([k, v]) => `${k.replace(/_/g, " ")}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(" · ").slice(0, 200);

/** The exception inbox's data. Each read is on its own: a database that lags costs that block, never the page. */
async function inboxData(c: Ctx) {
  const { db } = c.deps;
  const [excs, cases, cfg] = await Promise.all([
    db.rows<Exc>("ops_exceptions", { select: "id,kind,ref,detail,status,created_at", where: { status: { in: ["open", "acknowledged"] } }, order: [{ col: "created_at" }], limit: 100 }).catch(() => [] as Exc[]),
    // HO1: customers waiting for a person are the open cases (0135); no chat is locked any more.
    db.rows<{ id: string; late: boolean | null }>("support_cases", { select: "id,late", where: { state: { in: ["open", "claimed"] } }, limit: 100 }).catch(() => [] as { id: string; late: boolean | null }[]),
    db.rpc<{ high_priority_kinds?: string[] } | null>("setting", { p_key: "push_alerts" }).catch(() => null),
  ]);
  return { excs, chats: cases.length, lateCases: cases.filter((x) => x.late).length, high: new Set(cfg?.high_priority_kinds ?? []) };
}

// ---------- the KPI tiles ----------
const DAY = 86_400_000;
type KOrder = { created_at: string; status: string; subtotal_usd: number | string; confirmed_at: string | null; delivered_at: string | null; village_id: string | null;
  delivery_slot_id: string | null; is_pickup: boolean; customer_id: string };
export interface DayFigures { orders: number; sales: number; delivered: number; onTime: number; minutes: number }

/**
 * Today's figures so far, the same hours of yesterday and of the same weekday last week, and the seven whole days before today.
 * Every figure is counted from rows the database already holds: orders (goods only: the fee and tips are the rider's), and for
 * delivery, orders delivered at once (no pickup, no booked window) measured from the customer's confirmation against the zone's
 * ETA. Test orders (probe parties) are left out. Returns null when the read fails: the tiles are then not shown.
 */
export async function kpiData(c: Ctx): Promise<{ today: DayFigures; yesterday: DayFigures; lastWeek: DayFigures; days: DayFigures[]; ai: { today: number | null; yesterday: number | null; days: number[] } } | null> {
  const { db } = c.deps;
  const now = c.deps.now();
  const start = (back: number) => beirutMidnight(new Date(beirutMidnight(now).getTime() - back * DAY + DAY / 2));   // noon is safe across a clock change
  const t0 = start(0), elapsed = now.getTime() - t0.getTime();
  try {
    const [orders, probes, villages, zones] = await Promise.all([
      db.rows<KOrder>("orders", { select: "created_at,status,subtotal_usd,confirmed_at,delivered_at,village_id,delivery_slot_id,is_pickup,customer_id", where: { created_at: { gte: start(8).toISOString() } }, limit: 20000 }),
      db.rows<{ id: string }>("parties", { select: "id", where: { is_probe: true }, limit: 500 }).catch(() => [] as { id: string }[]),
      db.rows<{ id: string; zone_id: string | null }>("villages", { select: "id,zone_id" }),
      db.rows<{ id: string; base_eta_minutes: number }>("zones", { select: "id,base_eta_minutes" }),
    ]);
    const probe = new Set(probes.map((p) => p.id));
    const zoneOf = new Map(villages.map((v) => [v.id, v.zone_id]));
    const eta = new Map(zones.map((z) => [z.id, Number(z.base_eta_minutes)]));
    const real = orders.filter((o) => !probe.has(o.customer_id));
    const figures = (from: Date, to: Date): DayFigures => {
      const f = { orders: 0, sales: 0, delivered: 0, onTime: 0, minutes: 0 };
      for (const o of real) {
        const made = new Date(o.created_at).getTime();
        if (made >= from.getTime() && made < to.getTime() && o.status !== "cancelled" && o.status !== "draft") { f.orders++; f.sales += Number(o.subtotal_usd); }
        if (!o.delivered_at || !o.confirmed_at || o.is_pickup || o.delivery_slot_id || !o.village_id) continue;
        const done = new Date(o.delivered_at).getTime();
        const limit = eta.get(zoneOf.get(o.village_id) ?? "");
        if (done < from.getTime() || done >= to.getTime() || limit === undefined) continue;
        const took = (done - new Date(o.confirmed_at).getTime()) / 60000;
        f.delivered++; f.minutes += took; if (took <= limit) f.onTime++;
      }
      return f;
    };
    const soFar = (back: number) => figures(start(back), new Date(start(back).getTime() + elapsed));
    const days = [7, 6, 5, 4, 3, 2, 1].map((k) => figures(start(k), start(k - 1)));
    let ai = { today: null as number | null, yesterday: null as number | null, days: [] as number[] };
    try {
      const rows = await db.rows<{ day: string; usd_per_order: number | string | null }>("ai_cost_daily", { select: "day,usd_per_order", where: { day: { gte: start(8).toISOString().slice(0, 10) } }, order: [{ col: "day" }], limit: 12 });
      const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Beirut" }).format(d);
      const of = (back: number) => { const r = rows.find((x) => String(x.day).slice(0, 10) === dayKey(new Date(start(back).getTime() + DAY / 2))); return r && r.usd_per_order !== null ? Number(r.usd_per_order) : null; };
      ai = { today: of(0), yesterday: of(1), days: [7, 6, 5, 4, 3, 2, 1].map(of).filter((x): x is number => x !== null) };
    } catch { /* that tile stays off */ }
    return { today: soFar(0), yesterday: soFar(1), lastWeek: soFar(7), days, ai };
  } catch { return null; }
}

function kpiTiles(c: Ctx, k: NonNullable<Awaited<ReturnType<typeof kpiData>>>, openCases: number, lateCases: number, openExcs: number): Raw {
  const L = c.lang;
  const vsY = pick(L, "vs yesterday, same hours", "عن أمس، بالساعات نفسها"), vsW = pick(L, "vs the same day last week", "عن اليوم نفسه الأسبوع الماضي");
  // A difference in words and a sign; the arrow and the colour repeat it, they never carry it alone. `upIsGood` says which way is good news.
  const diff = (now: number | null, then: number | null, label: string, fmt: (n: number) => string, upIsGood: boolean): Compare[] => {
    if (now === null || then === null) return [];
    const d = now - then;
    if (Math.abs(d) < 1e-9) return [{ label, text: pick(L, "same", "لا تغيير"), direction: "flat", good: null }];
    return [{ label, text: `${d > 0 ? "+" : "−"}${fmt(Math.abs(d))}`, direction: d > 0 ? "up" : "down", good: d > 0 === upIsGood }];
  };
  const int = (n: number) => String(Math.round(n));
  const share = (f: DayFigures) => (f.delivered ? (100 * f.onTime) / f.delivered : null);
  const avg = (f: DayFigures) => (f.delivered ? f.minutes / f.delivered : null);
  const trendLabel = pick(L, "The seven days before today", "الأيام السبعة قبل اليوم");
  const none = pick(L, "No delivery yet today", "لا توصيل بعد اليوم");
  const tiles: KpiOpts[] = [
    { label: pick(L, "Orders", "الطلبات"), value: int(k.today.orders), compare: [...diff(k.today.orders, k.yesterday.orders, vsY, int, true), ...diff(k.today.orders, k.lastWeek.orders, vsW, int, true)], trend: k.days.map((d) => d.orders), trendLabel },
    { label: pick(L, "Sales, goods only", "المبيعات، البضاعة فقط"), value: usd(k.today.sales), compare: [...diff(k.today.sales, k.yesterday.sales, vsY, (n) => usd(n), true), ...diff(k.today.sales, k.lastWeek.sales, vsW, (n) => usd(n), true)], trend: k.days.map((d) => d.sales), trendLabel },
    { label: pick(L, "Delivered within the zone time", "سُلّم ضمن وقت المنطقة"), value: share(k.today) === null ? "–" : `${Math.round(share(k.today)!)}%`,
      compare: diff(share(k.today), share(k.yesterday), vsY, (n) => `${Math.round(n)} ${pick(L, "points", "نقطة")}`, true), note: k.today.delivered ? pick(L, `${k.today.onTime} of ${k.today.delivered} deliveries`, `${k.today.onTime} من ${k.today.delivered} توصيل`) : none,
      trend: k.days.map((d) => share(d)).filter((x): x is number => x !== null), trendLabel },
    { label: pick(L, "Average delivery time", "متوسط وقت التوصيل"), value: avg(k.today) === null ? "–" : `${Math.round(avg(k.today)!)} ${t(L, "min")}`,
      compare: diff(avg(k.today), avg(k.yesterday), vsY, (n) => `${Math.round(n)} ${t(L, "min")}`, false), note: k.today.delivered ? pick(L, "from the customer's confirmation to the door", "من تأكيد الزبون إلى الباب") : none,
      trend: k.days.map((d) => avg(d)).filter((x): x is number => x !== null), trendLabel },
    ...(k.ai.today !== null ? [{ label: pick(L, "AI cost per order", "كلفة الذكاء الاصطناعي لكل طلب"), value: `$${k.ai.today.toFixed(3)}`, compare: diff(k.ai.today, k.ai.yesterday, pick(L, "vs yesterday", "عن أمس"), (n) => `$${n.toFixed(3)}`, false), trend: k.ai.days, trendLabel }] : []),
    { label: pick(L, "Customers waiting for a person", "زبائن بانتظار شخص"), value: int(openCases), alert: lateCases > 0, note: lateCases ? pick(L, `${lateCases} late`, `${lateCases} متأخرة`) : pick(L, "none late", "لا تأخير") },
    { label: pick(L, "Open exceptions", "استثناءات مفتوحة"), value: int(openExcs), note: pick(L, "oldest first, below", "الأقدم أولاً، في الأسفل") },
  ];
  return kpis(tiles.map(kpiTile));
}

// ---------- the live board ----------
const COLUMNS: { en: string; ar: string; statuses: string[] }[] = [
  { en: "New", ar: "جديد", statuses: ["awaiting_confirmation", "awaiting_payment", "confirmed"] },
  { en: "Picking", ar: "قيد التجهيز", statuses: ["preparing"] },
  { en: "Ready", ar: "جاهز", statuses: ["ready"] },
  { en: "On the way", ar: "في الطريق", statuses: ["out_for_delivery", "arrived"] },
  { en: "To close", ar: "بانتظار الإغلاق", statuses: ["delivered", "failed_delivery"] },
];

async function today(c: Ctx) {
  const L = c.lang;
  const lead = LEADS.includes(c.staff.role);
  const [d, inbox, k] = await Promise.all([todayData(c), lead ? inboxData(c) : Promise.resolve({ excs: [] as Exc[], chats: 0, lateCases: 0, high: new Set<string>() }), lead ? kpiData(c) : Promise.resolve(null)]);
  const now = c.deps.now();
  const word = (s: string) => statusWord(L, s);
  const statusOrder = [...ACTIVE, "closed", "cancelled"];
  const late = d.orders.filter((o) => (o.lateBy ?? 0) > 0).length;
  const atRisk = d.orders.filter((o) => (o.lateBy ?? 0) > 0 || o.noRider);
  const overCap = d.riders.filter((r) => d.cap.soft && r.exposure >= d.cap.soft);
  const quiet = inbox.excs.length === 0 && inbox.chats === 0 && atRisk.length === 0 && overCap.length === 0;
  const orderLink = (o: { id: string; short_code: string }) => (lead ? html`<a href="/orders/${o.id}">${o.short_code}</a>` : o.short_code);
  const noRider = html`<strong class="warn">${pick(L, "no rider yet", "لا مندوب بعد")}</strong>`;
  const clock = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Beirut", hour: "2-digit", minute: "2-digit" }).format(now);

  let drawer: unknown = "";
  if (lead) {
    try {
      const v = await c.deps.db.rpc<{ drawer: { usd: number | string; lbp: number | string } }>("hub_cash_view", { p_since: beirutMidnight(now).toISOString() });
      drawer = html`<h2>${t(L, "drawer_h")}</h2><p>${t(L, "drawer_line", { amount: `${usd(v.drawer.usd)}${Number(v.drawer.lbp) ? ` + ${lbp(v.drawer.lbp)}` : ""}` })} <a href="/money">${pick(L, "Hub money", "نقد المركز")}</a></p>`;
    } catch { /* the drawer line stays off */ }
  }

  // The timer on a card: minutes since the customer confirmed, against the zone's ETA. Before confirmation there is no promise yet.
  const timer = (o: (typeof d.orders)[number]) => timerChip({ minutes: o.age, promise: o.confirmed_at ? o.eta : null,
    state: o.confirmed_at && o.eta !== null && !["delivered", "failed_delivery"].includes(o.status) ? timerState(o.age, o.eta) : "idle",
    text: `${o.age} ${t(L, "min")}${(o.lateBy ?? 0) > 0 ? ` (${o.lateBy} ${pick(L, "late", "تأخير")})` : ""}` });
  const board = html`<div class="ak-board">${COLUMNS.map((col) => {
    const list = d.orders.filter((o) => col.statuses.includes(o.status));
    return html`<section aria-label="${pick(L, col.en, col.ar)}"><h3><span>${pick(L, col.en, col.ar)}</span>${badge(String(list.length))}</h3>
${list.length === 0 ? html`<p class="none">${pick(L, "None", "لا شيء")}</p>` : html`<ul>${list.map((o) => html`<li class="${(o.lateBy ?? 0) > 0 ? "late" : ""}"><span class="row"><strong>${orderLink(o)}</strong>${timer(o)}</span>
<span class="sub">${col.statuses.length > 1 ? html`${word(o.status)} · ` : ""}${o.villageName} · ${money(o.total_usd)} · ${o.payment_method}${o.eta !== null ? html` · ${pick(L, "zone", "المنطقة")} ${o.eta} ${t(L, "min")}` : ""}</span>${o.noRider ? html`<span class="sub">${noRider}</span>` : ""}</li>`)}</ul>`}</section>`;
  })}</div>`;

  return render(c, t(L, "today_title"), html`
<p class="live" data-live>${t(L, "updated_at", { time: clock })}</p>
${lead && k ? kpiTiles(c, k, inbox.chats, inbox.lateCases, inbox.excs.length) : ""}
${lead ? html`${tabs([{ label: t(L, "tab_needs_you"), href: "/", current: true, count: inbox.excs.length }, { label: t(L, "tab_all_exceptions"), href: "/exceptions" }], t(L, "tab_all_exceptions"))}
<h2>${t(L, "inbox_h")}${inbox.excs.length ? html` (${inbox.excs.length})` : ""}</h2>
${inbox.excs.length === 0 && inbox.chats === 0 ? html`<p class="muted">${t(L, "nothing_needs")}</p>` : ""}
${inbox.excs.length ? html`<ul class="inbox">${inbox.excs.map((e) => html`<li class="${inbox.high.has(e.kind) ? "high" : ""}">
<strong>${kindName(e.kind, L)}</strong>${inbox.high.has(e.kind) ? html` <span class="tag high">${t(L, "high")}</span>` : ""}${e.status === "acknowledged" ? html` <span class="tag">${t(L, "being_handled")}</span>` : ""}
<br><span class="muted">${when(e.created_at)} · ${minutesSince(e.created_at, now)} ${t(L, "min")}${detailText(e.detail) ? html` · ${detailText(e.detail)}` : ""}</span>
<div class="actions"><a class="btn primary" href="${kindHref(e)}">${kindCta(e.kind, L)}</a>
${e.status === "open" ? form(c.f, `/exceptions/${e.id}/acknowledged`, html`<input type="hidden" name="back" value="/"><button class="secondary">${t(L, "im_on_it")}</button>`) : ""}
${form(c.f, `/exceptions/${e.id}/resolved`, html`<input type="hidden" name="back" value="/"><button class="secondary">${t(L, "resolved")}</button>`)}</div></li>`)}</ul>` : ""}
${inbox.chats ? html`<p><a class="btn" href="/inbox">${t(L, "chats_waiting", { n: inbox.chats })}</a></p>` : ""}` : ""}
${quiet ? html`<p class="summary-ok">${icon("check")}<span>${t(L, "quiet_summary")}</span></p>` : ""}
${atRisk.length ? html`<h2>${t(L, "at_risk_h")} (${atRisk.length})</h2><ul class="inbox">${atRisk.map((o) => html`<li class="${(o.lateBy ?? 0) > 0 ? "high" : ""}">
<strong>${orderLink(o)}</strong> · ${word(o.status)}${(o.lateBy ?? 0) > 0 ? html` · <strong class="warn">${o.lateBy} ${pick(L, "min late", "د تأخير")}</strong>` : ""}${o.noRider ? html` · ${noRider}` : ""}
<br><span class="muted">${o.villageName} · ${money(o.total_usd)} · ${o.payment_method}</span></li>`)}</ul>` : ""}
<h2>${t(L, "open_orders_h")}</h2>
<p>${late ? html`<strong class="warn">${late} ${pick(L, "late", "متأخر")}</strong> · ` : ""}${statusOrder.filter((s) => d.counts.get(s)).map((s, i) => html`${i ? " · " : ""}${word(s)}: ${d.counts.get(s)}`)}
<span class="muted"> (${pick(L, "closed and cancelled: since midnight, Beirut", "المُغلقة والمُلغاة: منذ منتصف الليل بتوقيت بيروت")})</span></p>
${d.orders.length === 0 ? html`<p class="muted">${pick(L, "No open orders.", "لا طلبات مفتوحة.")}</p>` : board}
<h2>${t(L, "riders_h")}</h2>
${d.riders.length === 0 ? html`<p class="muted">${pick(L, "No rider on shift.", "لا مندوب في الوردية.")}</p>` : html`<ul class="riders">
${d.riders.map((r) => html`<li class="${d.cap.hard && r.exposure >= d.cap.hard ? "over" : ""}"><span class="row"><strong>${r.name}</strong><span class="muted">${t(L, "since")} ${when(r.started_at)}</span></span>
${d.cap.hard ? limitBar({ value: r.exposure, soft: d.cap.soft || null, hard: d.cap.hard, label: pick(L, `${usd(r.exposure)} of the ${usd(d.cap.hard)} hard cap`, `${usd(r.exposure)} من السقف الصارم ${usd(d.cap.hard)}`) }) : ""}
<span class="row"><span>${pick(L, "Exposure", "التعرض")} <strong>${money(r.exposure)}</strong>${d.cap.soft && r.exposure >= d.cap.soft ? html` <strong class="warn">${pick(L, "above the soft cap", "فوق السقف المرن")} (${usd(d.cap.soft)})</strong>` : ""}</span>
<span class="muted">${pick(L, "Cash held", "النقد المحتفظ به")} ${money(r.usd, r.lbp ? ` + ${lbp(r.lbp)}` : "")}${r.lbp ? html` (${money(r.heldUsd)})` : ""}</span></span></li>`)}</ul>
<p class="muted">${pick(L, "Exposure is the cash held plus cash still to collect on accepted jobs. The dashed mark is the soft cap, the solid one the hard cap. The database refuses a job that would pass the hard cap", "التعرض هو النقد المحتفظ به مضافاً إليه النقد المنتظر تحصيله من المهام المقبولة. العلامة المتقطعة هي السقف المرن والمتصلة هي السقف الصارم. ترفض قاعدة البيانات أي مهمة تتجاوز السقف الصارم")} (${usd(d.cap.hard)}).</p>`}
${drawer}`, { translated: true });
}

export const todaySection: Section = {
  nav: { href: "/", label: "Today", roles: ALL },
  routes: [{ method: "GET", path: "/", roles: ALL, handler: today }],
};
