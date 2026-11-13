// 3.2 Today: orders by status, late first; riders on shift with their cash and exposure. Reads only.
// "Late" is measured against the zone's ETA from the database (zones.base_eta_minutes), never a number in code (invariant 13).
import { html, render, type Ctx, type Section } from "../app";
import { lbp, minutesSince, usd, when } from "../html";
import { ALL } from "../roles";

export const ACTIVE = ["awaiting_confirmation", "awaiting_payment", "confirmed", "preparing", "ready", "out_for_delivery", "arrived", "failed_delivery", "delivered"] as const;
const IN_PROGRESS = new Set(["confirmed", "preparing", "ready", "out_for_delivery", "arrived"]);
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

async function today(c: Ctx) {
  const d = await todayData(c);
  const statusOrder = [...ACTIVE, "closed", "cancelled"];
  const late = d.orders.filter((o) => (o.lateBy ?? 0) > 0).length;
  return render(c, "Today", html`
<p>${late ? html`<strong class="warn">${late} late</strong> · ` : ""}${statusOrder.filter((s) => d.counts.get(s)).map((s, i) => html`${i ? " · " : ""}${WORDS[s] ?? s}: ${d.counts.get(s)}`)}
<span class="muted"> (closed and cancelled: since midnight, Beirut)</span></p>
<h2>Open orders</h2>
${d.orders.length === 0 ? html`<p class="muted">No open orders.</p>` : html`<table><tr><th>Order</th><th>Status</th><th>Village</th><th>Total</th><th>Pay</th><th>Minutes</th><th>Zone ETA</th></tr>
${d.orders.map((o) => html`<tr class="${(o.lateBy ?? 0) > 0 ? "late" : ""}"><td>${o.short_code}</td>
<td>${WORDS[o.status] ?? o.status}${o.noRider ? html` <strong class="warn">· no rider yet</strong>` : ""}</td><td>${o.villageName}</td>
<td>${usd(o.total_usd)}</td><td>${o.payment_method}</td>
<td>${o.age}${(o.lateBy ?? 0) > 0 ? html` <strong>(${o.lateBy} late)</strong>` : ""}</td><td>${o.eta ?? ""}</td></tr>`)}</table>`}
<h2>Riders on shift</h2>
${d.riders.length === 0 ? html`<p class="muted">No rider on shift.</p>` : html`<table><tr><th>Rider</th><th>Since</th><th>Cash held</th><th>Held, in USD</th><th>Exposure</th></tr>
${d.riders.map((r) => html`<tr class="${d.cap.hard && r.exposure >= d.cap.hard ? "late" : ""}"><td>${r.name}</td><td>${when(r.started_at)}</td>
<td>${usd(r.usd)}${r.lbp ? html` + ${lbp(r.lbp)}` : ""}</td><td>${usd(r.heldUsd)}</td>
<td>${usd(r.exposure)}${d.cap.soft && r.exposure >= d.cap.soft ? html` <strong class="warn">above the soft cap (${usd(d.cap.soft)})</strong>` : ""}</td></tr>`)}</table>
<p class="muted">Exposure is the cash held plus cash still to collect on accepted jobs. The database refuses a job that would pass the hard cap (${usd(d.cap.hard)}).</p>`}`);
}

export const todaySection: Section = {
  nav: { href: "/", label: "Today", roles: ALL },
  routes: [{ method: "GET", path: "/", roles: ALL, handler: today }],
};
