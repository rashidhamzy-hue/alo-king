// 3.11 Day-close report: one SQL function (day_close_report, 0047) and this screen. Orders by outcome, sales, gross margin,
// stock picked against items sold, each rider's cash by currency and earnings, transfers, credits, the drawer, and an
// unexplained balance that must be zero. The ops lead counts the drawer (close_day); a difference is posted and stays visible.
// Sent to the founder (every admin) nightly from the ops number, through the gateway (sendDayClose, called by the console's cron).
import type { SendResult } from "@ak/wa/gateway";
import { act, html, num, render, text, UserError, type Ctx, type Deps, type Section } from "../app";
import { form, lbp, usd, when } from "../html";
import { LEADS } from "../roles";

type N = number | string;
export interface DayReport {
  day: string; orders: Record<string, N>; probe_orders: N;
  sales: { goods_usd: N; delivery_fees_usd: N; small_order_fees_usd: N; refunds_charged_to_goodwill_usd: N; expenses_usd: N };
  margin: { revenue_goods_usd: N; cogs_usd: N; gross_margin_usd: N; gross_margin_pct: N | null; stock_loss_usd: N; uncosted_units_sold: N };
  payments: Record<string, { count: N; usd: N }>;
  riders: { rider: string | null; usd: N; lbp: N; earnings_usd: N }[];
  rider_earnings_settled_usd: N;
  credits: { refunded_usd: N; paid_out_usd: N; used_on_orders_usd: N };
  drawer: { usd: N; lbp: N; in_from_riders_usd: N; to_bank_usd: N; petty_cash_usd: N; expenses_from_drawer_usd: N };
  stock: { picked_units: N; sold_units: N; returned_units: N; written_off_units: N; mismatches: { order: string; product: string; picked: N; sold: N }[] };
  count: { counted_usd: N; counted_lbp: N; book_usd: N; book_lbp: N; difference_usd: N; difference_lbp: N; difference_value_usd: N; note: string | null; closed_by: string | null; closed_at: string } | null;
  ledger_imbalance_usd: N; unexplained_usd: N; balanced: boolean;
}

const pct = (v: N | null) => (v === null || v === undefined ? "n/a" : `${Number(v)}%`);
const orderLine = (o: Record<string, N>) => Object.entries(o).map(([k, v]) => `${k.replace(/_/g, " ")} ${Number(v)}`).join(", ") || "none";

/** The founder's nightly message: the same figures as the screen, nothing computed here but sums for display. */
export function dayCloseText(r: DayReport): string {
  const pay = Object.entries(r.payments).map(([m, p]) => `${m} ${usd(p.usd)} (${Number(p.count)})`).join(", ") || "none";
  const riders = r.riders.map((x) => `${x.rider ?? "Rider"} ${usd(x.usd)} + ${lbp(x.lbp)}, earnings owed ${usd(x.earnings_usd)}`).join("; ") || "none";
  const unexplained = Number(r.unexplained_usd);
  return [
    `Alo King day close ${r.day}`,
    `Orders: ${orderLine(r.orders)}`,
    `Sales: goods ${usd(r.sales.goods_usd)}, delivery fees ${usd(r.sales.delivery_fees_usd)} (the riders'), small-order fees ${usd(r.sales.small_order_fees_usd)}`,
    `Gross margin: ${usd(r.margin.gross_margin_usd)} (${pct(r.margin.gross_margin_pct)})${Number(r.margin.uncosted_units_sold) ? `, ${Number(r.margin.uncosted_units_sold)} units sold without a cost` : ""}`,
    `Paid: ${pay}`,
    `Refunds ${usd(r.credits.refunded_usd)}, credit paid out ${usd(r.credits.paid_out_usd)}, credit used ${usd(r.credits.used_on_orders_usd)}`,
    `Riders hold: ${riders}`,
    `Drawer by the books: ${usd(r.drawer.usd)} + ${lbp(r.drawer.lbp)}; to the bank ${usd(r.drawer.to_bank_usd)}, petty cash ${usd(r.drawer.petty_cash_usd)}, expenses ${usd(r.drawer.expenses_from_drawer_usd)}`,
    r.count ? `Drawer counted: difference ${usd(r.count.difference_usd)} and ${lbp(r.count.difference_lbp)}${r.count.note ? ` (${r.count.note})` : ""}` : "Drawer not counted yet",
    `Stock: ${Number(r.stock.picked_units)} picked, ${Number(r.stock.sold_units)} on orders${r.stock.mismatches.length ? `, ${r.stock.mismatches.length} mismatches` : ""}`,
    r.balanced ? "Unexplained: $0.00" : `UNEXPLAINED: ${usd(unexplained)}${r.stock.mismatches.length ? " and stock mismatches" : ""}. Look at the console.`,
  ].join("\n");
}

/**
 * Sends the day's report to every admin on the ops line through the gateway (preflight, can_send, outbox claim).
 * One key per day and person: the cron firing twice, or the button pressed after the cron, sends once.
 * Outside the admin's 24-hour window the gateway refuses (there is no template for this); the report stays on the screen.
 */
export async function sendDayClose(deps: Deps, day?: string): Promise<{ party: string; result: SendResult | { ok: false; refused: string } }[]> {
  const report = await deps.db.rpc<DayReport>("day_close_report", day ? { p_day: day } : {});
  const admins = await deps.db.rows<{ id: string }>("parties", { select: "id", where: { role: "admin", is_blocked: false }, limit: 20 });
  const out: { party: string; result: SendResult | { ok: false; refused: string } }[] = [];
  for (const a of admins) {
    const to = await deps.db.rpc<string | null>("party_address", { p_party: a.id, p_line: "ops" });
    if (!to) { out.push({ party: a.id, result: { ok: false, refused: "no_ops_address" } }); continue; }
    const result = await deps.send({ line: "ops", partyId: a.id, to, category: "utility", dedupeKey: `dayclose:${report.day}:${a.id}`,
      msg: { type: "text", text: { body: dayCloseText(report) } } });
    out.push({ party: a.id, result });
  }
  return out;
}

async function page(c: Ctx) {
  const today = await c.deps.db.rpc<string>("hub_today", {});
  const asked = (c.url.searchParams.get("day") ?? "").trim();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : today;
  const r = await c.deps.db.rpc<DayReport>("day_close_report", { p_day: day });
  const unexplained = Number(r.unexplained_usd);
  return render(c, `Day close ${r.day}`, html`
<form method="get" action="/day-close"><label>Day <input type="date" name="day" value="${day}"></label> <button>Show</button></form>
<p class="${r.balanced ? "flash ok" : "flash err"}">${r.balanced ? "Unexplained balance: $0.00." : html`Unexplained balance: <strong>${usd(unexplained)}</strong>${r.stock.mismatches.length ? " and stock that does not match the orders" : ""}. It must be zero.`}</p>
<h2>Orders</h2><p>${orderLine(r.orders)}${Number(r.probe_orders) ? html` <span class="muted">(and ${Number(r.probe_orders)} test orders, not counted)</span>` : ""}</p>
<h2>Sales and margin</h2>
<table><tr><th>Goods</th><th>Delivery fees (the riders')</th><th>Small-order fees</th><th>Cost of goods</th><th>Gross margin</th><th>Stock written off</th><th>Goodwill refunds</th><th>Expenses</th></tr>
<tr><td>${usd(r.sales.goods_usd)}</td><td>${usd(r.sales.delivery_fees_usd)}</td><td>${usd(r.sales.small_order_fees_usd)}</td><td>${usd(r.margin.cogs_usd)}</td>
<td>${usd(r.margin.gross_margin_usd)} (${pct(r.margin.gross_margin_pct)})</td><td>${usd(r.margin.stock_loss_usd)}</td><td>${usd(r.sales.refunds_charged_to_goodwill_usd)}</td><td>${usd(r.sales.expenses_usd)}</td></tr></table>
${Number(r.margin.uncosted_units_sold) ? html`<p class="warn">${Number(r.margin.uncosted_units_sold)} units left the shelf with no cost recorded: the margin is overstated until they are valued.</p>` : ""}
<h2>Payments</h2>
${Object.keys(r.payments).length ? html`<table><tr><th>How</th><th>Count</th><th>Amount</th></tr>${Object.entries(r.payments).map(([m, p]) => html`<tr><td>${m}</td><td>${Number(p.count)}</td><td>${usd(p.usd)}</td></tr>`)}</table>` : html`<p class="muted">None.</p>`}
<p>Refunds ${usd(r.credits.refunded_usd)} · credit paid out ${usd(r.credits.paid_out_usd)} · credit used on orders ${usd(r.credits.used_on_orders_usd)} · rider earnings settled ${usd(r.rider_earnings_settled_usd)}</p>
<h2>Riders</h2>
${r.riders.length ? html`<table><tr><th>Rider</th><th>Cash held</th><th>Earnings owed</th></tr>${r.riders.map((x) => html`<tr><td>${x.rider ?? "Rider"}</td><td>${usd(x.usd)} + ${lbp(x.lbp)}</td><td>${usd(x.earnings_usd)}</td></tr>`)}</table>` : html`<p class="muted">None.</p>`}
<h2>Stock</h2>
<p>${Number(r.stock.picked_units)} units picked, ${Number(r.stock.sold_units)} on those orders' lines · ${Number(r.stock.returned_units)} back from failed deliveries · ${Number(r.stock.written_off_units)} written off or adjusted down</p>
${r.stock.mismatches.length ? html`<table><tr><th>Order</th><th>Item</th><th>Picked</th><th>On the order</th></tr>${r.stock.mismatches.map((m) => html`<tr class="late"><td>${m.order}</td><td>${m.product}</td><td>${Number(m.picked)}</td><td>${Number(m.sold)}</td></tr>`)}</table>` : ""}
<h2>Drawer</h2>
<p>By the books at the end of the day: <strong>${usd(r.drawer.usd)} + ${lbp(r.drawer.lbp)}</strong> · in from riders ${usd(r.drawer.in_from_riders_usd)} · to the bank ${usd(r.drawer.to_bank_usd)} · petty cash ${usd(r.drawer.petty_cash_usd)} · expenses ${usd(r.drawer.expenses_from_drawer_usd)}</p>
${r.count ? html`<p>Counted by ${r.count.closed_by ?? ""} at ${when(r.count.closed_at)}: ${usd(r.count.counted_usd)} + ${lbp(r.count.counted_lbp)} against ${usd(r.count.book_usd)} + ${lbp(r.count.book_lbp)} on the books.
${Number(r.count.difference_value_usd) ? html`<strong class="warn">Difference ${usd(r.count.difference_usd)} and ${lbp(r.count.difference_lbp)}</strong>: ${r.count.note ?? ""}` : "No difference."}</p>`
  : day === today ? form(c.f, "/day-close", html`<input type="hidden" name="day" value="${day}">
<p><label>Counted dollars <input type="number" name="counted_usd" step="0.01" min="0" required></label>
<label>Counted lira <input type="number" name="counted_lbp" step="1000" min="0" required></label>
<label>Note (required if it differs) <input name="note" maxlength="300"></label> <button>Close the day</button></p>`) : html`<p class="muted">Not counted.</p>`}
${form(c.f, "/day-close/send", html`<input type="hidden" name="day" value="${day}"><button>Send this report to the founder now</button>`)}`);
}

const dayOf = (c: Ctx) => { const d = (c.form.day ?? "").trim(); if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new UserError("Pick the day."); return d; };

async function close(c: Ctx) {
  const day = dayOf(c);
  const counted_usd = num(c, "counted_usd", { min: 0, max: 10_000_000 })!;
  const counted_lbp = num(c, "counted_lbp", { min: 0, max: 1_000_000_000_000 })!;
  const note = text(c, "note", 300) || null;
  return act(c, "day_close", { day, counted_usd, counted_lbp }, async () => {
    const r = await c.deps.db.rpc<{ already: boolean; difference_usd: N; difference_lbp: N }>("close_day", {
      p_day: day, p_counted_usd: counted_usd, p_counted_lbp: counted_lbp, p_by: c.staff.partyId, p_note: note,
    });
    if (r.already) return "This day was already closed; the first count stands.";
    const d = Number(r.difference_usd), l = Number(r.difference_lbp);
    return d === 0 && l === 0 ? "Day closed. The drawer matches the books." : `Day closed with a difference of ${usd(d)} and ${lbp(l)}, recorded with your note.`;
  }, `/day-close?day=${day}`);
}

async function send(c: Ctx) {
  const day = dayOf(c);
  return act(c, "day_close_send", { day }, async () => {
    const out = await sendDayClose(c.deps, day);
    if (!out.length) throw new UserError("There is no admin to send it to.");
    const sent = out.filter((o) => o.result.ok).length;
    const refused = out.filter((o) => !o.result.ok).map((o) => (o.result as { refused: string }).refused);
    return `Sent to ${sent} of ${out.length}.${refused.length ? ` Not sent: ${refused.join(", ")}.` : ""}`;
  }, `/day-close?day=${day}`);
}

export const dayCloseSection: Section = {
  nav: { href: "/day-close", label: "Day close", roles: LEADS },
  routes: [
    { method: "GET", path: "/day-close", roles: LEADS, handler: page },
    { method: "POST", path: "/day-close", roles: LEADS, handler: close },
    { method: "POST", path: "/day-close/send", roles: LEADS, handler: send },
  ],
};
