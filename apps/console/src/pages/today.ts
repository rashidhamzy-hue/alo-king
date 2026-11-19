// CON1 (docs/DECISIONS.md, "CON1, a simple console, 19 November 2026"): Today is "needs attention", most urgent first, each item with one tap to act:
// orders past their promised time; customers waiting for a person; food places that have not answered the call ahead within 10 minutes;
// high-priority exceptions; riders over the hard, then the soft cash cap; places found closed today; orders waiting for the customer's own
// Confirm; the other open exceptions; errors in the last 24 hours (Sentry); approvals waiting; low stock. Then today's numbers: orders, sales,
// average delivery time, average restaurant acceptance time. The live board, the riders and the drawer follow, folded. A picker's Today is Pick.
// 3.2 Today (redesigned in D5, drawn again in DS1; docs/strategy/05, section A): KPI tiles with their comparisons; what needs a
// person first, oldest first, each with its one action; orders late or at risk; the live board of open orders by status with a
// timer against each promise; riders with cash against the caps as bars; the drawer; and a short green summary when the day is quiet.
// Reads only; the two buttons on an exception post to the exceptions page's own forms.
// "Late" is measured against the zone's ETA from the database (zones.base_eta_minutes), never a number in code (invariant 13).
// A figure with no source in the database is not shown at all (contribution, reply time, missing-item rate, message cost): they
// are listed for session AN1 in docs/HANDOFF.md, DS1. The delivery fee and tips are the rider's, so "Sales" is goods only (invariant 10).
import { html, redirect, render, type Ctx, type Section } from "../app";
import { approvalCounts } from "./approve";
import { form, lbp, minutesSince, money, usd, when } from "../html";
import { pick, t } from "../i18n";
import { kindCta, kindHref, kindName } from "../kinds";
import { ALL, LEADS } from "../roles";
import { badge, button, icon, kpiTile, kpis, limitBar, tabs, tileLink, timerChip, timerState, type Compare, type IconName, type KpiOpts } from "@ak/ui/components";
import { statusLabel } from "@ak/ui/status";
import type { Raw } from "@ak/ui/h";

export const ACTIVE = ["awaiting_confirmation", "awaiting_payment", "confirmed", "preparing", "ready", "out_for_delivery", "arrived", "failed_delivery", "delivered"] as const;
const IN_PROGRESS = new Set(["confirmed", "preparing", "ready", "out_for_delivery", "arrived"]);
/** UX2a: the words for a status are the label table's (packages/ui/src/status.ts), the same ids as the database: one table for staff and customers. */
export const statusWord = (lang: "en" | "ar", s: string) => statusLabel(s, { lang });

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
    { label: pick(L, "Open exceptions", "استثناءات مفتوحة"), value: int(openExcs), note: pick(L, "oldest first, below", "الأقدم أولاً، في الأسفل") },
  ];
  return kpis(tiles.map(kpiTile));
}

// ---------- CON1: needs attention ----------
/** A food place that has not answered the call ahead after this many minutes is listed (CON1, 3). */
export const CALL_AHEAD_MIN = 10;
type Attention = { rank: number; age: number; tone: "danger" | "warn" | "neutral"; icon: IconName; title: string; detail?: string | Raw; href: string; cta: string; extra?: Raw };

/** The reads behind the list. Each is on its own: a read that fails costs its line, never the page. */
async function attentionData(c: Ctx) {
  const { db } = c.deps;
  const now = c.deps.now();
  const quiet = async <T,>(f: () => Promise<T>, none: T) => { try { return await f(); } catch { return none; } };
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Beirut" }).format(now);
  const since = beirutMidnight(now);
  const yesterday = beirutMidnight(new Date(since.getTime() - 12 * 3600_000));
  const [calls, closed, approvals, stock, errors, accepted] = await Promise.all([
    quiet(async () => ((await db.rpc<{ call_id: string; short_code: string; place: string; status: string; created_at: string }[] | null>("food_calls_console", {})) ?? []), []),
    quiet(() => db.rows<{ id: string; name: string }>("sources", { select: "id,name", where: { closed_on: today }, limit: 50 }), []),
    quiet(() => approvalCounts(c), null),
    quiet(async () => {
      const hubs = await db.rows<{ id: string }>("sources", { select: "id", where: { kind: "dark_store" }, limit: 1 });
      if (!hubs[0]) return { low: 0, out: 0 };
      const [levels, products] = await Promise.all([
        db.rows<{ product_id: string; on_hand: number | string; reserved: number | string; reorder_point: number | string }>("stock_levels", { select: "product_id,on_hand,reserved,reorder_point", where: { source_id: hubs[0].id }, limit: 5000 }),
        db.rows<{ id: string }>("products", { select: "id", where: { is_active: true, owner_source_id: null }, limit: 5000 }),
      ]);
      const active = new Set(products.map((p) => p.id));
      let low = 0, out = 0;
      for (const l of levels) { if (!active.has(l.product_id)) continue; const a = Number(l.on_hand) - Number(l.reserved); if (a <= 0) out++; else if (Number(l.reorder_point) > 0 && a <= Number(l.reorder_point)) low++; }
      return { low, out };
    }, null),
    c.deps.errorsLast24h ? c.deps.errorsLast24h().catch(() => null) : Promise.resolve(undefined),
    quiet(() => db.rows<{ created_at: string; accepted_at: string }>("place_calls", { select: "created_at,accepted_at", where: { accepted_at: { gte: yesterday.toISOString() } }, limit: 2000 }), []),
  ]);
  const minutes = (r: { created_at: string; accepted_at: string }) => (new Date(r.accepted_at).getTime() - new Date(r.created_at).getTime()) / 60000;
  const avg = (rows: { created_at: string; accepted_at: string }[]) => (rows.length ? rows.reduce((a, r) => a + minutes(r), 0) / rows.length : null);
  const isToday = (r: { accepted_at: string }) => new Date(r.accepted_at).getTime() >= since.getTime();
  const acceptToday = accepted.filter(isToday);
  // Yesterday up to the same time of day, so the comparison is fair.
  const elapsed = now.getTime() - since.getTime();
  const acceptYesterday = accepted.filter((r) => !isToday(r) && new Date(r.accepted_at).getTime() < yesterday.getTime() + elapsed);
  return { calls, closed, approvals, stock, errors, accept: { today: avg(acceptToday), yesterday: avg(acceptYesterday), n: acceptToday.length } };
}

function attentionList(c: Ctx, d: Awaited<ReturnType<typeof todayData>>, inbox: Awaited<ReturnType<typeof inboxData>>, a: Awaited<ReturnType<typeof attentionData>>): Attention[] {
  const L = c.lang;
  const now = c.deps.now();
  const items: Attention[] = [];
  const m = (n: number) => `${n} ${t(L, "min")}`;
  // 1. orders past their promised time (the zone's time, from the database)
  for (const o of d.orders.filter((x) => (x.lateBy ?? 0) > 0)) items.push({ rank: 1, age: o.lateBy!, tone: "danger", icon: "clock",
    title: pick(L, `${o.short_code} is ${o.lateBy} min past its promised time`, `${o.short_code} تجاوز وقته الموعود بـ ${o.lateBy} د`),
    detail: html`${statusWord(L, o.status)} · ${o.villageName}${o.noRider ? html` · <strong>${pick(L, "no rider yet", "لا مندوب بعد")}</strong>` : ""}`, href: `/orders/${o.id}`, cta: pick(L, "Open the order", "افتح الطلب") });
  // 2. customers waiting for a person, late first
  if (inbox.lateCases) items.push({ rank: 2, age: 0, tone: "danger", icon: "inbox", title: pick(L, `${inbox.lateCases} customer(s) waiting too long for a person`, `${inbox.lateCases} زبون ينتظر شخصاً منذ وقت طويل`), href: "/inbox", cta: pick(L, "Answer", "أجب") });
  // 3. food places that have not answered the call ahead within 10 minutes
  for (const k of a.calls.filter((x) => x.status === "to_call" && (minutesSince(x.created_at, now) ?? 0) >= CALL_AHEAD_MIN)) items.push({ rank: 3, age: minutesSince(k.created_at, now) ?? 0, tone: "danger", icon: "phone",
    title: pick(L, `${k.place} has not answered the call ahead for ${k.short_code}`, `${k.place} لم يُجب على الاتصال المسبق للطلب ${k.short_code}`),
    detail: pick(L, `waiting ${m(minutesSince(k.created_at, now) ?? 0)}`, `بالانتظار منذ ${m(minutesSince(k.created_at, now) ?? 0)}`), href: "/food", cta: pick(L, "Call the place", "اتصل بالمكان") });
  // 4. high-priority exceptions; the rest come later (8)
  for (const e of inbox.excs) items.push({ rank: inbox.high.has(e.kind) ? 4 : 8, age: minutesSince(e.created_at, now) ?? 0, tone: inbox.high.has(e.kind) ? "danger" : "warn", icon: "alert",
    title: kindName(e.kind, L), detail: html`${inbox.high.has(e.kind) ? html`<span class="tag high">${t(L, "high")}</span> ` : ""}${when(e.created_at)} · ${m(minutesSince(e.created_at, now) ?? 0)}${detailText(e.detail) ? html` · ${detailText(e.detail)}` : ""}${e.status === "acknowledged" ? html` · ${t(L, "being_handled")}` : ""}`,
    href: kindHref(e), cta: kindCta(e.kind, L), extra: html`${e.status === "open" ? form(c.f, `/exceptions/${e.id}/acknowledged`, html`<input type="hidden" name="back" value="/"><button class="secondary">${t(L, "im_on_it")}</button>`) : ""}
${form(c.f, `/exceptions/${e.id}/resolved`, html`<input type="hidden" name="back" value="/"><button class="secondary">${t(L, "resolved")}</button>`)}` });
  // 5. riders over the cash cap (the hard cap first; the database refuses a job past it)
  for (const r of d.riders.filter((x) => d.cap.soft && x.exposure >= d.cap.soft)) {
    const hard = d.cap.hard && r.exposure >= d.cap.hard;
    items.push({ rank: hard ? 5 : 9, age: r.exposure, tone: hard ? "danger" : "warn", icon: "wallet",
      title: pick(L, `${r.name} holds ${usd(r.exposure)}: over the ${hard ? "hard" : "soft"} cash cap`, `${r.name} يحمل ${usd(r.exposure)}: فوق سقف النقد ${hard ? "الصارم" : "المرن"}`),
      detail: pick(L, `soft ${usd(d.cap.soft)}, hard ${usd(d.cap.hard)}`, `المرن ${usd(d.cap.soft)}، الصارم ${usd(d.cap.hard)}`), href: "/rider-jobs", cta: pick(L, "Take a cash drop", "استلم النقد") });
  }
  // 6. places found closed today (the call ahead said so)
  for (const p of a.closed) items.push({ rank: 6, age: 0, tone: "warn", icon: "store", title: pick(L, `${p.name} was found closed today`, `${p.name} وُجد مغلقاً اليوم`),
    detail: pick(L, "not orderable for the rest of the day", "لا يمكن الطلب منه بقية اليوم"), href: `/places/${p.id}`, cta: pick(L, "Open the place", "افتح المكان") });
  // 7. orders waiting for the customer's own Confirm (the agent can never confirm)
  for (const o of d.orders.filter((x) => x.status === "awaiting_confirmation")) items.push({ rank: 7, age: o.age, tone: "neutral", icon: "hourglass",
    title: pick(L, `${o.short_code} waits for the customer's Confirm`, `${o.short_code} ينتظر تأكيد الزبون`), detail: pick(L, `for ${m(o.age)} · ${usd(o.total_usd)}`, `منذ ${m(o.age)} · ${usd(o.total_usd)}`),
    href: `/orders/${o.id}`, cta: pick(L, "Open the order", "افتح الطلب") });
  // 10. customers waiting for a person (not late)
  const onTime = inbox.chats - inbox.lateCases;
  if (onTime > 0) items.push({ rank: 10, age: 0, tone: "neutral", icon: "inbox", title: t(L, "chats_waiting", { n: onTime }), href: "/inbox", cta: pick(L, "Answer", "أجب") });
  // 11. errors in the last 24 hours (Sentry)
  if (a.errors && a.errors.count > 0) items.push({ rank: 11, age: a.errors.count, tone: "warn", icon: "warn", title: pick(L, `${a.errors.count} errors in the last 24 hours`, `${a.errors.count} خطأ في آخر 24 ساعة`),
    detail: pick(L, "counted by Sentry", "بحسب Sentry"), href: a.errors.link, cta: pick(L, "Open Sentry", "افتح Sentry") });
  // 12. approvals waiting, with the count of each kind
  const ap = a.approvals; const waiting = ap ? Object.values(ap).reduce((x, y) => x + y, 0) : 0;
  if (ap && waiting) {
    const KIND: Record<string, [string, string]> = { names: ["names", "أسماء"], photos: ["photos", "صور"], labels: ["label readings", "قراءات ملصقات"], dishes: ["dishes", "أطباق"], places: ["places", "أماكن"],
      second: ["second approvals", "موافقات ثانية"], refunds: ["refunds", "استردادات"], auto: ["spot checks", "فحوص عيّنات"] };
    const first = Object.entries(ap).find(([, v]) => v > 0)![0];
    items.push({ rank: 12, age: waiting, tone: "neutral", icon: "approve", title: pick(L, `${waiting} approvals waiting`, `${waiting} موافقة بالانتظار`),
      detail: Object.entries(ap).filter(([, v]) => v > 0).map(([k, v]) => `${v} ${pick(L, KIND[k]![0], KIND[k]![1])}`).join(" · "), href: `/approve?tab=${first}`, cta: pick(L, "Approve", "وافق") });
  }
  // 13. low stock
  if (a.stock && (a.stock.low || a.stock.out)) items.push({ rank: 13, age: a.stock.out + a.stock.low, tone: "neutral", icon: "stock",
    title: pick(L, `${a.stock.low} items running low, ${a.stock.out} out`, `${a.stock.low} صنفاً ينفد قريباً، ${a.stock.out} نافداً`), href: "/stock", cta: pick(L, "See stock", "اعرض المخزون") });
  return items.sort((x, y) => x.rank - y.rank || y.age - x.age);
}

function attentionView(c: Ctx, items: Attention[], errors: { count: number; link: string } | null | undefined) {
  const L = c.lang;
  const sentry = errors === undefined ? pick(L, "Errors in the last 24 hours: Sentry is not connected to the console yet.", "الأخطاء في آخر 24 ساعة: Sentry غير موصول باللوحة بعد.")
    : errors === null ? pick(L, "Errors in the last 24 hours: Sentry did not answer.", "الأخطاء في آخر 24 ساعة: لم يُجب Sentry.")
    : errors.count === 0 ? pick(L, "No error in the last 24 hours (Sentry).", "لا خطأ في آخر 24 ساعة (Sentry).") : "";
  return html`<section class="ak-attention" aria-labelledby="needs-h"><h2 id="needs-h">${pick(L, "Needs attention", "يحتاج انتباهك")}${items.length ? html` <span class="badge">${items.length}</span>` : ""}</h2>
${items.length === 0 ? html`<p class="summary-ok">${icon("check")}<span>${t(L, "quiet_summary")}</span></p>` : html`<ol>${items.map((x) => html`<li class="ak-attn ak-attn--${x.tone}"><span class="ak-attn-ic">${icon(x.icon)}</span>
<div class="ak-attn-body"><strong>${x.title}</strong>${x.detail ? html`<br><span class="muted">${x.detail}</span>` : ""}</div>
<div class="ak-attn-act">${button({ label: x.cta, href: x.href, variant: x.tone === "danger" ? "primary" : "soft", icon: "chevron" })}${x.extra ?? ""}</div></li>`)}</ol>`}
${sentry ? html`<p class="muted">${sentry}</p>` : ""}</section>`;
}

/** Today's numbers (CON1, 3): orders, sales (goods only), average delivery time, average restaurant acceptance time, with yesterday's same hours. */
function todayNumbers(c: Ctx, k: Awaited<ReturnType<typeof kpiData>>, accept: { today: number | null; yesterday: number | null; n: number }) {
  const L = c.lang;
  const vsY = pick(L, "vs yesterday, same hours", "عن أمس، بالساعات نفسها");
  const diff = (now: number | null, then: number | null, fmt: (n: number) => string, upIsGood: boolean): Compare[] => {
    if (now === null || then === null) return [];
    const x = now - then;
    if (Math.abs(x) < 1e-9) return [{ label: vsY, text: pick(L, "same", "لا تغيير"), direction: "flat", good: null }];
    return [{ label: vsY, text: `${x > 0 ? "+" : "−"}${fmt(Math.abs(x))}`, direction: x > 0 ? "up" : "down", good: x > 0 === upIsGood }];
  };
  const mins = (n: number) => `${Math.round(n)} ${t(L, "min")}`;
  const avg = (f: DayFigures) => (f.delivered ? f.minutes / f.delivered : null);
  const tiles: KpiOpts[] = [
    { label: pick(L, "Orders", "الطلبات"), value: k ? String(k.today.orders) : "–", compare: k ? diff(k.today.orders, k.yesterday.orders, (n) => String(Math.round(n)), true) : [] },
    { label: pick(L, "Sales, goods only", "المبيعات، البضاعة فقط"), value: k ? usd(k.today.sales) : "–", compare: k ? diff(k.today.sales, k.yesterday.sales, (n) => usd(n), true) : [] },
    { label: pick(L, "Average delivery time", "متوسط وقت التوصيل"), value: k && avg(k.today) !== null ? mins(avg(k.today)!) : "–", compare: k ? diff(avg(k.today), avg(k.yesterday), mins, false) : [],
      note: pick(L, "from the customer's confirmation to the door", "من تأكيد الزبون إلى الباب") },
    { label: pick(L, "Average restaurant acceptance time", "متوسط وقت قبول المطعم"), value: accept.today === null ? "–" : mins(accept.today), compare: diff(accept.today, accept.yesterday, mins, false),
      note: accept.n ? pick(L, `${accept.n} food orders, from the call ahead to "accepted"`, `${accept.n} طلب أكل، من الاتصال المسبق إلى «قُبل»`) : pick(L, "no food order accepted yet today", "لم يُقبل طلب أكل بعد اليوم") },
  ];
  return html`<h2>${pick(L, "Today's numbers", "أرقام اليوم")}</h2>${kpis(tiles.map(kpiTile))}`;
}

// ---------- the live board ----------
const COLUMNS: { en: string; ar: string; statuses: string[] }[] = [
  { en: "Waiting on customer", ar: "بانتظار الزبون", statuses: ["awaiting_confirmation", "awaiting_payment"] },
  { en: "To pick", ar: "للتجهيز", statuses: ["confirmed"] },
  { en: "Picking", ar: "قيد التجهيز", statuses: ["preparing"] },
  { en: "Packed", ar: "جُهّز", statuses: ["ready"] },
  { en: "On the way", ar: "في الطريق", statuses: ["out_for_delivery", "arrived"] },
  { en: "To close", ar: "بانتظار الإغلاق", statuses: ["delivered", "failed_delivery"] },
];

async function today(c: Ctx) {
  const L = c.lang;
  const lead = LEADS.includes(c.staff.role);
  // CON1: a picker sees Pick and Stock only; their Today is the pick queue.
  if (!lead) return redirect("/pick");
  const [d, inbox, k, a] = await Promise.all([todayData(c), inboxData(c), kpiData(c), attentionData(c)]);
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

  // UX2a: the reference's four tiles, each one link to where the work is. A state is said in words and an icon beside the number.
  const toPick = d.orders.filter((o) => o.status === "confirmed").length;
  const packedNoRider = d.orders.filter((o) => o.status === "ready" && o.noRider).length;
  const held = d.riders.reduce((a, r) => a + r.heldUsd, 0);
  const attention = kpis([
    tileLink({ label: pick(L, "Orders waiting", "طلبات بانتظارنا"), value: String(toPick), href: "/pick", icon: "pick",
      note: packedNoRider ? pick(L, `${packedNoRider} packed, no rider yet`, `${packedNoRider} جاهز بلا مندوب`) : pick(L, "to pick", "للتجهيز"),
      state: packedNoRider ? "warn" : "ok", stateWord: pick(L, `${packedNoRider} waiting for a rider`, `${packedNoRider} بانتظار مندوب`) }),
    tileLink({ label: pick(L, "Late", "متأخرة"), value: String(late), href: "#at-risk", icon: "clock",
      note: late ? pick(L, "past the zone time", "تجاوزت وقت المنطقة") : pick(L, "none past the zone time", "لا طلب تجاوز وقت المنطقة"),
      state: late ? "late" : "ok", stateWord: pick(L, `${late} late`, `${late} متأخرة`) }),
    ...(lead ? [
      tileLink({ label: pick(L, "Cash held", "النقد مع المناديب"), value: usd(held), href: "/rider-jobs", icon: "wallet",
        note: pick(L, `${d.riders.length} on shift`, `${d.riders.length} في الوردية`), state: overCap.length ? "warn" : "ok", stateWord: pick(L, `${overCap.length} over the soft cap`, `${overCap.length} فوق السقف المرن`) }),
      tileLink({ label: pick(L, "Cases open", "حالات مفتوحة"), value: String(inbox.chats), href: "/inbox", icon: "inbox",
        note: pick(L, "customers waiting for a person", "زبائن بانتظار شخص"), state: inbox.lateCases ? "late" : "ok", stateWord: pick(L, `${inbox.lateCases} late`, `${inbox.lateCases} متأخرة`) }),
    ] : []),
  ]);

  let drawer: unknown = "";
  if (lead) {
    try {
      const v = await c.deps.db.rpc<{ drawer: { usd: number | string; lbp: number | string } }>("hub_cash_view", { p_since: beirutMidnight(now).toISOString() });
      drawer = html`<h2>${t(L, "drawer_h")}</h2><p>${t(L, "drawer_line", { amount: `${usd(v.drawer.usd)}${Number(v.drawer.lbp) ? ` + ${lbp(v.drawer.lbp)}` : ""}` })} <a href="/money">${pick(L, "Hub money", "نقد المستودع")}</a></p>`;
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

  const needs = attentionList(c, d, inbox, a);
  return render(c, t(L, "today_title"), html`
<p class="live" data-live>${t(L, "updated_at", { time: clock })}</p>
${attentionView(c, needs, a.errors)}
${todayNumbers(c, k, a.accept)}
<details class="ak-today-more"><summary>${pick(L, "More of today: the live board, the riders, the drawer", "المزيد عن اليوم: اللوحة الحيّة والمناديب والصندوق")}</summary>
${attention}
${k ? kpiTiles(c, k, inbox.chats, inbox.lateCases, inbox.excs.length) : ""}
<p><a href="/exceptions">${t(L, "tab_all_exceptions")}</a>${inbox.chats ? html` · <a href="/inbox">${t(L, "chats_waiting", { n: inbox.chats })}</a>` : ""}</p>
${atRisk.length ? html`<h2 id="at-risk">${t(L, "at_risk_h")} (${atRisk.length})</h2><ul class="inbox">${atRisk.map((o) => html`<li class="${(o.lateBy ?? 0) > 0 ? "high" : ""}">
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
${drawer}</details>`, { translated: true });
}

export const todaySection: Section = {
  nav: { href: "/", label: "Today", roles: ALL },
  routes: [{ method: "GET", path: "/", roles: ALL, handler: today }],
};
