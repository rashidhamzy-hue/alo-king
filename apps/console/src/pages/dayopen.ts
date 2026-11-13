// 3.17 Day-open checklist: one screen, one SQL function (day_open_checklist, 0048). Nothing is computed here.
import { html, render, type Ctx, type Section } from "../app";
import { lbp, minutesSince, usd, when } from "../html";
import { ALL } from "../roles";

type N = number | string;
export interface DayOpen {
  day: string;
  orders_waiting: { order: string; status: string; since: string }[];
  not_closed_from_before_today: { order: string; status: string; created_at: string }[];
  expiring_in_3_days: { product: string; expiry_date: string; lot: string | null; on_hand: N }[];
  drops_not_counted: { rider: string | null; usd: N; lbp: N; at: string }[];
  payment_proofs_waiting: N;
  riders: { rider: string | null; usd: N; lbp: N; earnings_usd: N }[];
  open_cases: { id: string; order: string; kind: string; opened_at: string }[];
  open_exceptions: N; products_on_hold: N; last_cron_at: string | null; yesterday_closed: boolean;
}

const tick = (ok: boolean) => (ok ? html`<span>✓</span>` : html`<strong class="warn">!</strong>`);

async function page(c: Ctx) {
  const d = await c.deps.db.rpc<DayOpen>("day_open_checklist", {});
  const now = c.deps.now();
  const cronMin = minutesSince(d.last_cron_at, now);
  const cronOk = cronMin !== null && cronMin <= 5;
  return render(c, `Day open ${d.day}`, html`
<table>
<tr><td>${tick(cronOk)}</td><td>Last cron heartbeat</td><td>${d.last_cron_at ? html`${when(d.last_cron_at)} (${cronMin} min ago)` : html`<strong class="warn">never</strong>`}</td></tr>
<tr><td>${tick(d.yesterday_closed)}</td><td>Yesterday's day close</td><td>${d.yesterday_closed ? "counted" : html`<a href="/day-close">not counted</a>`}</td></tr>
<tr><td>${tick(d.not_closed_from_before_today.length === 0)}</td><td>Orders from before today not closed</td><td>${d.not_closed_from_before_today.map((o) => html`${o.order} (${o.status}) `)}</td></tr>
<tr><td>${tick(d.orders_waiting.length === 0)}</td><td>Orders waiting</td><td>${d.orders_waiting.map((o) => html`${o.order} ${o.status} ${minutesSince(o.since, now)} min · `)}</td></tr>
<tr><td>${tick(d.drops_not_counted.length === 0)}</td><td>Rider drops not counted</td><td>${d.drops_not_counted.map((x) => html`${x.rider ?? "Rider"} ${usd(x.usd)} + ${lbp(x.lbp)} · `)}</td></tr>
<tr><td>${tick(Number(d.payment_proofs_waiting) === 0)}</td><td>Payment screenshots to review</td><td>${Number(d.payment_proofs_waiting)}</td></tr>
<tr><td>${tick(d.riders.length === 0)}</td><td>Rider cash and earnings outstanding</td><td>${d.riders.map((x) => html`${x.rider ?? "Rider"}: holds ${usd(x.usd)} + ${lbp(x.lbp)}, owed ${usd(x.earnings_usd)} · `)}</td></tr>
<tr><td>${tick(d.expiring_in_3_days.length === 0)}</td><td>Stock expiring within 3 days</td><td>${d.expiring_in_3_days.map((x) => html`${x.product} ${x.expiry_date}${x.lot ? ` (lot ${x.lot})` : ""}, ${Number(x.on_hand)} on hand · `)}</td></tr>
<tr><td>${tick(d.open_cases.length === 0)}</td><td>Open complaint cases</td><td>${d.open_cases.map((k) => html`${k.kind} ${k.order} · `)}</td></tr>
<tr><td>${tick(Number(d.open_exceptions) === 0)}</td><td>Open exceptions</td><td>${Number(d.open_exceptions)}</td></tr>
<tr><td>${tick(Number(d.products_on_hold) === 0)}</td><td>Items on hold</td><td>${Number(d.products_on_hold)}</td></tr>
</table>`);
}

export const dayOpenSection: Section = {
  nav: { href: "/day-open", label: "Day open", roles: ALL },
  routes: [{ method: "GET", path: "/day-open", roles: ALL, handler: page }],
};
