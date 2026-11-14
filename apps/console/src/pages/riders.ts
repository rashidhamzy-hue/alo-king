// 3.4 Cash drops and rider payouts. Confirm a declared drop per currency (confirm_cash_drop), show rider_statement(),
// pay the rider's earnings (pay_rider_earnings), end the shift (close_shift, never forced from here), and send the rider an
// end-of-shift message with the same figures, through the gateway on the ops line (invariants 1 and 9).
// The delivery fee and tips are the rider's (invariant 10): the statement and the payout come from the SQL, not from here.
// F1: the hub pays the part of a rider's earnings their cash does not cover only from what the drawer holds (0105); a damaged
// note found in a confirmed hub drop is recorded once per form (record_damaged_note, 0105); and each rider's cash over/short at
// the door today, with what they owe for shortfalls beyond the tolerance, comes from day_close_report (0104).
import { act, html, id, num, render, UserError, type Ctx, type Section } from "../app";
import { DbError } from "../db";
import { form, lbp, usd, when } from "../html";
import { LEADS } from "../roles";

type Drop = { id: string; driver_id: string; method: string; declared_usd: number | string; declared_lbp: number | string; receipt_ref: string | null;
  receipt_media_path: string | null; created_at: string };
type Statement = { cash_held_usd: number | string; earnings_usd: number | string; to_hand_over_usd: number | string };
type DayRider = { rider_id: string; over_short_usd: number | string; short_owed_usd: number | string; cod_flags: number | string };
type Note = { drop_id: string; amount_usd: number | string; absorbed_by: string };

const formKey = (c: Ctx) => { const k = (c.form._key ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60); return k.length >= 8 ? `console:${k}` : null; };

/** Plain words for the refusals only this page meets (the shared ones are in app.ts). */
async function plain<T>(p: Promise<T>, drawer: string): Promise<T> {
  try { return await p; }
  catch (e) {
    if (e instanceof DbError && /^NOT_ENOUGH_CASH hub_cash/.test(e.message)) throw new UserError(drawer);
    if (e instanceof DbError && /^EXCEEDS_DROP/.test(e.message)) throw new UserError("That is more than this drop (with the damaged notes already recorded on it).");
    throw e;
  }
}

async function riderFigures(c: Ctx, driver: string) {
  const [st, native] = await Promise.all([
    c.deps.db.rpc<Statement>("rider_statement", { p_driver: driver }),
    c.deps.db.rpc<{ usd: number | string; lbp: number | string }[]>("driver_cash_native", { p_driver: driver }),
  ]);
  const n = Array.isArray(native) ? native[0] : null;
  return { held: Number(st?.cash_held_usd ?? 0), earnings: Number(st?.earnings_usd ?? 0), handOver: Number(st?.to_hand_over_usd ?? 0),
           usd: Number(n?.usd ?? 0), lbp: Number(n?.lbp ?? 0) };
}

async function page(c: Ctx) {
  const { db, media } = c.deps;
  const drops = await db.rows<Drop>("cash_drops", { select: "id,driver_id,method,declared_usd,declared_lbp,receipt_ref,receipt_media_path,created_at", where: { status: "declared" }, order: [{ col: "created_at" }] });
  const drivers = await db.rows<{ id: string; display_name: string | null }>("parties", { select: "id,display_name", where: { role: "driver", is_blocked: false }, order: [{ col: "display_name" }], limit: 200 });
  const open = new Map((await db.rows<{ id: string; driver_id: string; started_at: string }>("driver_shifts", { select: "id,driver_id,started_at", where: { ended_at: null } })).map((s) => [s.driver_id, s]));
  const name = (d: string) => drivers.find((x) => x.id === d)?.display_name ?? "Rider";
  const figures = await Promise.all(drivers.map((d) => riderFigures(c, d.id)));
  const rows = drivers.map((d, i) => ({ ...d, f: figures[i]!, shift: open.get(d.id) })).filter((x) => x.shift || Math.abs(x.f.held) > 0.004 || Math.abs(x.f.earnings) > 0.004);
  const receipts = await Promise.all(drops.map((d) => (d.receipt_media_path ? media.sign(d.receipt_media_path, 300) : Promise.resolve(null))));
  const today = new Map(((await db.rpc<{ riders?: DayRider[] }>("day_close_report", {}))?.riders ?? []).map((x) => [x.rider_id, x]));
  const confirmed = (await db.rows<Drop & { confirmed_at: string }>("cash_drops", { select: "id,driver_id,method,declared_usd,declared_lbp,confirmed_at",
    where: { status: "confirmed", method: "hub" }, order: [{ col: "confirmed_at", desc: true }], limit: 10 }));
  const notes = confirmed.length ? await db.rows<Note>("damaged_notes", { select: "drop_id,amount_usd,absorbed_by", where: { drop_id: { in: confirmed.map((d) => d.id) } } }) : [];
  const overShort = (d: string) => {
    const t = today.get(d);
    if (!t || (Math.abs(Number(t.over_short_usd)) < 0.005 && Number(t.cod_flags) === 0)) return html`<span class="muted">none</span>`;
    const os = Number(t.over_short_usd), owed = Number(t.short_owed_usd);
    return html`${os < 0 ? "short" : "over"} ${usd(Math.abs(os))}${owed > 0.004 ? html` · <strong>owes ${usd(owed)}</strong>` : ""}`;
  };

  return render(c, "Cash drops and rider payouts", html`
<h2>Cash drops to confirm (${drops.length})</h2>
<p class="muted">Count the cash with the rider, note by note, per currency. Confirm only what you counted.</p>
${drops.length === 0 ? html`<p class="muted">None declared.</p>` : html`<table><tr><th>Rider</th><th>Declared</th><th>How</th><th>Receipt</th><th>When</th><th></th></tr>
${drops.map((d, i) => html`<tr><td>${name(d.driver_id)}</td><td>${usd(d.declared_usd)} + ${lbp(d.declared_lbp)}</td><td>${d.method}</td>
<td>${d.receipt_ref ?? ""}${receipts[i] ? html` <a href="${receipts[i]}" target="_blank" rel="noopener">receipt</a>` : ""}</td><td>${when(d.created_at)}</td>
<td>${form(c.f, `/riders/drop/${d.id}`, html`<button>Counted: confirm</button>`, { cls: "inline" })}</td></tr>`)}</table>`}
<h2>Riders</h2>
${rows.length === 0 ? html`<p class="muted">No rider on shift or holding money.</p>` : html`<table><tr><th>Rider</th><th>Shift</th><th>Cash held</th><th>Earnings owed (fees and tips)</th><th>To hand over</th><th>Cash over/short today</th><th></th></tr>
${rows.map((x) => html`<tr><td>${x.display_name ?? "Rider"}</td><td>${x.shift ? html`since ${when(x.shift.started_at)}` : "ended"}</td>
<td>${usd(x.f.usd)} + ${lbp(x.f.lbp)} <span class="muted">(${usd(x.f.held)})</span></td><td>${usd(x.f.earnings)}</td><td>${usd(x.f.handOver)}</td>
<td>${overShort(x.id)}</td>
<td>${x.f.earnings > 0.004 ? form(c.f, `/riders/${x.id}/pay`, html`<button>Pay earnings</button>`, { cls: "inline" }) : ""}
${form(c.f, `/riders/${x.id}/statement`, html`<button>Send statement on WhatsApp</button>`, { cls: "inline" })}
${x.shift ? form(c.f, `/riders/${x.id}/end-shift`, html`<button>End shift</button>`, { cls: "inline" }) : ""}</td></tr>`)}</table>
<p class="muted">Pay earnings: the rider keeps their fees and tips out of the cash they carry (dollars first, then lira); anything more is paid from the hub till, never more than it holds. The database works it out.</p>
<p class="muted">Over/short: a few cents of lira rounding at the door is the company's; a shortfall beyond it (up to a dollar) is owed by the rider and flagged. More than a dollar is refused at the door.</p>`}
<h2>Damaged notes</h2>
<p class="muted">A note in a confirmed drop that cannot be used. It leaves the drawer once: the first this month is the company's, later ones are the rider's.</p>
${confirmed.length === 0 ? html`<p class="muted">No confirmed drop at the hub yet.</p>` : html`<table><tr><th>Rider</th><th>Drop</th><th>Confirmed</th><th>Damaged so far</th><th></th></tr>
${confirmed.map((d) => {
  const taken = notes.filter((n) => n.drop_id === d.id).reduce((a, n) => a + Number(n.amount_usd), 0);
  return html`<tr><td>${name(d.driver_id)}</td><td>${usd(d.declared_usd)} + ${lbp(d.declared_lbp)}</td><td>${when(d.confirmed_at)}</td><td>${taken > 0 ? usd(taken) : ""}</td>
<td>${form(c.f, `/riders/drop/${d.id}/damaged`, html`<input type="number" name="amount_usd" step="0.01" min="0.01" placeholder="USD" required> <button>Record damaged note</button>`, { cls: "inline" })}</td></tr>`;
})}</table>`}`);
}

async function confirmDrop(c: Ctx) {
  const drop = id(c, "drop");
  return act(c, "cash_drop_confirm", { drop }, async () => {
    const left = await c.deps.db.rpc<number | string>("confirm_cash_drop", { p_drop: drop, p_by: c.staff.partyId });
    return `Drop confirmed. The rider still holds ${usd(left)} in value.`;
  }, "/riders");
}

async function pay(c: Ctx) {
  const driver = id(c, "driver");
  return act(c, "rider_pay_earnings", { driver }, async () => {
    const r = await plain(c.deps.db.rpc<Record<string, number | string>>("pay_rider_earnings", { p_driver: driver, p_by: c.staff.partyId }),
      "Not paid: the rider's cash does not cover their earnings and the drawer does not hold the rest by the books. Confirm a cash drop first, then pay.");
    return `Paid. Kept from cash: ${usd(r.kept_usd)} and ${lbp(r.kept_lbp)}; from the hub till: ${usd(r.paid_from_hub_usd)}. ` +
      `The rider hands over ${usd(r.to_hand_over_usd)} and ${lbp(r.to_hand_over_lbp)}.`;
  }, "/riders");
}

async function damagedNote(c: Ctx) {
  const drop = id(c, "drop");
  const amount = num(c, "amount_usd", { min: 0.01, max: 1000 });
  return act(c, "cash_drop_damaged_note", { drop, amount_usd: amount }, async () => {
    const key = formKey(c);
    if (!key) throw new UserError("Open the page again and resend the form.");
    const r = await plain(c.deps.db.rpc<{ duplicate: boolean; absorbed_by: string; amount_usd: number | string }>("record_damaged_note",
      { p_drop: drop, p_amount_usd: amount, p_by: c.staff.partyId, p_key: key }),
      "The drawer does not hold that much by the books. Confirm the drop first.");
    if (r.duplicate) return "That damaged note was already recorded; nothing changed.";
    return `Damaged note of ${usd(r.amount_usd)} taken out of the drawer, ${r.absorbed_by === "company" ? "absorbed by the company (the first this month)" : "owed by the rider"}.`;
  }, "/riders");
}

async function endShift(c: Ctx) {
  const driver = id(c, "driver");
  return act(c, "rider_end_shift", { driver }, async () => {
    const r = await c.deps.db.rpc<{ closed: boolean; reason?: string }>("close_shift", { p_driver: driver });
    if (r?.closed) return "Shift ended.";
    const why: Record<string, string> = { no_open_shift: "There is no open shift.", active_deliveries: "The rider still has a delivery in hand.",
      cash_outstanding: "The rider still holds cash: confirm the drop first." };
    throw new UserError(`Shift not ended. ${why[r?.reason ?? ""] ?? r?.reason ?? ""}`);
  }, "/riders");
}

/** The figures, in the words riders read on the ops line. Numbers from rider_statement() and driver_cash_native(), nothing else. */
export function statementText(f: { usd: number; lbp: number; earnings: number; handOver: number }) {
  return [
    "كشف آخر الدوام 🧾",
    `معك هلّق: ${usd(f.usd)} و ${lbp(f.lbp)}`,
    `أرباحك (التوصيل والإكراميات): ${usd(f.earnings)}`,
    `بتسلّم للمحل: ${usd(f.handOver)}`,
    "إذا في شي مش مزبوط، احكي مسؤول العمليات.",
  ].join("\n");
}

async function statement(c: Ctx) {
  const driver = id(c, "driver");
  return act(c, "rider_statement_message", { driver }, async () => {
    const f = await riderFigures(c, driver);
    const to = await c.deps.db.rpc<string | null>("party_address", { p_party: driver, p_line: "ops" });
    if (!to) throw new UserError("This rider has no WhatsApp number on the ops line.");
    const shift = (await c.deps.db.rows<{ id: string }>("driver_shifts", { select: "id", where: { driver_id: driver }, order: [{ col: "started_at", desc: true }], limit: 1 }))[0];
    // The same figures for the same shift are one message, however many times the button is pressed.
    const key = `console:statement:${driver}:${shift?.id ?? "none"}:${f.usd.toFixed(2)}:${f.lbp.toFixed(0)}:${f.earnings.toFixed(2)}`;
    const r = await c.deps.send({ line: "ops", partyId: driver, to, category: "utility", dedupeKey: key, msg: { type: "text", text: { body: statementText(f) } } });
    if (!r.ok) throw new UserError(`Not sent: ${r.refused}.`);
    return r.wamid === "already_sent" ? "This statement was already sent; not sent twice." : "Statement sent to the rider.";
  }, "/riders");
}

export const ridersSection: Section = {
  nav: { href: "/riders", label: "Cash and riders", roles: LEADS },
  routes: [
    { method: "GET", path: "/riders", roles: LEADS, handler: page },
    { method: "POST", path: "/riders/drop/:drop", roles: LEADS, handler: confirmDrop },
    { method: "POST", path: "/riders/drop/:drop/damaged", roles: LEADS, handler: damagedNote },
    { method: "POST", path: "/riders/:driver/pay", roles: LEADS, handler: pay },
    { method: "POST", path: "/riders/:driver/end-shift", roles: LEADS, handler: endShift },
    { method: "POST", path: "/riders/:driver/statement", roles: LEADS, handler: statement },
  ],
};
