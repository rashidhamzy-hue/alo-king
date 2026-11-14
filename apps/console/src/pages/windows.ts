// Windows and calendar (session D4): the delivery windows customers choose from, as rows a person edits (C3's tables, 0040;
// the save functions are 0112). Three things on one page:
//   Window plans   "every Monday to Saturday, 10:00-12:00, 8 orders", with both cut-offs and an optional zone or calendar kind
//                  (save_window_plan). A change regenerates the future slots nobody holds.
//   Calendar       Ramadan, Lent, holidays and closed days by date range (save_calendar_entry, remove_calendar_entry).
//   Schedule       the next days' slots with what is held on each: one slot's capacity, closing and note (edit_delivery_slot), and for
//                  each held order a move to another window (reschedule_order) or a cancellation (cancel_scheduled_order), each with
//                  a reason the database requires. The customer is told only if the person writes a message: it goes out through the
//                  gateway on the customer line, once, and only inside WhatsApp's 24-hour window.
// A window or a date is never written here in code: the page has no default day, time, capacity or holiday.
import { act, html, id, num, render, text, UserError, UUID, type Ctx, type Section } from "../app";
import { form, when } from "../html";
import { LEADS } from "../roles";

type Plan = { id: string; name: string; weekdays: number[]; starts: string; ends: string; capacity: number; order_by_min: number; fresh_order_by_min: number;
  calendar_kind: string | null; zone_id: string | null; active: boolean };
type Cal = { id: string; kind: string; name: string; starts_on: string; ends_on: string; closed: boolean; note: string | null };
type Zone = { id: string; name: string };
type Slot = { slot_id: string; date: string; dow: number; starts: string; ends: string; starts_at: string; order_by: string; fresh_order_by: string; free: number; capacity: number;
  closed: boolean; note: string | null; held: number; orders: string[] };
type Order = { id: string; short_code: string; status: string; customer_id: string };
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const KINDS = ["ramadan", "lent", "holiday", "other"];
const hhmm = (t: string) => String(t).slice(0, 5);
const days = (d: number[]) => [...d].sort().map((n) => DAYS[n - 1]).join(" ");
const slotLabel = (s: Slot) => `${DAYS[s.dow - 1]} ${s.date} ${s.starts}–${s.ends}`;

function planForm(c: Ctx, zones: Zone[], p?: Plan) {
  return form(c.f, "/windows/plan", html`${p ? html`<input type="hidden" name="plan" value="${p.id}">` : ""}
<p><label>Name <input name="name" value="${p?.name ?? ""}" maxlength="60" required></label></p>
<p>Days: ${DAYS.map((d, i) => html`<label><input type="checkbox" name="wd_${i + 1}" value="1"${p?.weekdays.includes(i + 1) ? " checked" : ""}> ${d}</label> `)}</p>
<p><label>From <input type="time" name="starts" value="${p ? hhmm(p.starts) : ""}" required></label> <label>to <input type="time" name="ends" value="${p ? hhmm(p.ends) : ""}" required></label>
<label>Orders it can take <input type="number" name="capacity" min="0" value="${p?.capacity ?? ""}" required></label></p>
<p><label>Order by, minutes before it starts <input type="number" name="order_by_min" min="0" value="${p?.order_by_min ?? 120}"></label>
<label>Fresh goods, minutes before <input type="number" name="fresh_order_by_min" min="0" value="${p?.fresh_order_by_min ?? 720}"></label></p>
<p><label>Only in zone <select name="zone"><option value="">every zone</option>${zones.map((z) => html`<option value="${z.id}"${p?.zone_id === z.id ? " selected" : ""}>${z.name}</option>`)}</select></label>
<label>Only on days of this kind <select name="calendar_kind"><option value="">ordinary days</option>${KINDS.map((k) => html`<option${p?.calendar_kind === k ? " selected" : ""}>${k}</option>`)}</select></label>
<label><input type="checkbox" name="active" value="1"${!p || p.active ? " checked" : ""}> in use</label></p>
<p><button>${p ? "Save the plan" : "Add the plan"}</button></p>`);
}

function calForm(c: Ctx, e?: Cal) {
  return form(c.f, "/windows/calendar", html`${e ? html`<input type="hidden" name="entry" value="${e.id}">` : ""}
<p><label>Kind <select name="kind">${KINDS.map((k) => html`<option${e?.kind === k ? " selected" : ""}>${k}</option>`)}</select></label>
<label>Name <input name="name" value="${e?.name ?? ""}" maxlength="60" required></label>
<label>First day <input type="date" name="starts_on" value="${e?.starts_on ?? ""}" required></label> <label>last day <input type="date" name="ends_on" value="${e?.ends_on ?? ""}" required></label></p>
<p><label><input type="checkbox" name="closed" value="1"${e?.closed ? " checked" : ""}> closed: no deliveries at all on these days</label>
<label>Note <input name="note" value="${e?.note ?? ""}" maxlength="200"></label> <button>${e ? "Save" : "Add to the calendar"}</button></p>`);
}

async function page(c: Ctx) {
  const { db } = c.deps;
  const [plans, cal, zones, schedule] = await Promise.all([
    db.rows<Plan>("delivery_window_plans", { order: [{ col: "starts" }, { col: "name" }], limit: 200 }),
    db.rows<Cal>("delivery_calendar", { order: [{ col: "starts_on" }], limit: 300 }),
    db.rows<Zone>("zones", { select: "id,name", order: [{ col: "name" }], limit: 100 }),
    db.rpc<Slot[]>("delivery_schedule", {}),
  ]);
  const slots = schedule ?? [];
  const codes = [...new Set(slots.flatMap((s) => s.orders ?? []))];
  const orders = codes.length ? await db.rows<Order>("orders", { select: "id,short_code,status,customer_id", where: { short_code: { in: codes } } }) : [];
  const orderOf = new Map(orders.map((o) => [o.short_code, o]));
  const zoneName = (zid: string | null) => zones.find((z) => z.id === zid)?.name ?? "every zone";
  const targets = slots.filter((s) => !s.closed);

  return render(c, "Windows and calendar", html`
<p class="muted">Customers can choose a delivery window only from the windows below. With none entered, scheduled orders are off. A change here never cancels or moves an order that was already promised a time: the window stops taking new orders, and ops gets an exception to decide.</p>
<h2>Window plans (${plans.length})</h2>
${plans.length === 0 ? html`<p class="note">No windows yet: customers cannot schedule an order until you add one.</p>` : html`<table><tr><th>Plan</th><th>Days</th><th>Time</th><th>Orders</th><th>Order by</th><th>Fresh goods by</th><th>Zone</th><th>Kind</th><th>In use</th><th></th></tr>
${plans.map((p) => html`<tr class="${p.active ? "" : "muted"}"><td>${p.name}</td><td>${days(p.weekdays)}</td><td>${hhmm(p.starts)}–${hhmm(p.ends)}</td><td>${p.capacity}</td>
<td>${p.order_by_min} min before</td><td>${p.fresh_order_by_min} min before</td><td>${zoneName(p.zone_id)}</td><td>${p.calendar_kind ?? "ordinary days"}</td><td>${p.active ? "yes" : "no"}</td>
<td><details><summary>Change</summary>${planForm(c, zones, p)}</details></td></tr>`)}</table>`}
<details${plans.length === 0 ? " open" : ""}><summary><strong>Add a window plan</strong></summary>${planForm(c, zones)}</details>

<h2>Calendar (${cal.length})</h2>
<p class="muted">Ramadan, Lent, holidays or any dates. A day marked closed has no windows. On the days of a kind that has plans of its own, only those plans apply.</p>
${cal.length === 0 ? html`<p class="muted">No dates entered.</p>` : html`<table><tr><th>Kind</th><th>Name</th><th>From</th><th>To</th><th>Closed</th><th>Note</th><th></th></tr>
${cal.map((e) => html`<tr><td>${e.kind}</td><td>${e.name}</td><td>${e.starts_on}</td><td>${e.ends_on}</td><td>${e.closed ? "closed" : ""}</td><td>${e.note ?? ""}</td>
<td><details><summary>Change</summary>${calForm(c, e)}</details> ${form(c.f, `/windows/calendar/${e.id}/remove`, html`<button>Remove</button>`, { cls: "inline" })}</td></tr>`)}</table>`}
<details><summary><strong>Add a date range</strong></summary>${calForm(c)}</details>

<h2>Schedule, the next days (${slots.length} windows)</h2>
${slots.length === 0 ? html`<p class="muted">No windows in the next days.</p>` : html`<table><tr><th>Window</th><th>Order by</th><th>Held</th><th>Capacity</th><th>State</th><th>Orders in it</th></tr>
${slots.map((s) => html`<tr class="${s.closed ? "muted" : ""}"><td>${slotLabel(s)}</td><td>${when(s.order_by)}<br><span class="muted">fresh ${when(s.fresh_order_by)}</span></td><td>${s.held}</td><td>${s.capacity}</td>
<td>${s.closed ? "closed" : s.free > 0 ? `${s.free} free` : "full"}${s.note ? html`<br><span class="muted">${s.note}</span>` : ""}
<details><summary>Edit this window</summary>${form(c.f, `/windows/slot/${s.slot_id}`, html`
<p><label>Capacity <input type="number" name="capacity" min="0" value="${s.capacity}"></label>
<label>State <select name="state"><option value="">as it is</option><option value="open">open</option><option value="closed">closed</option></select></label>
<label>Note <input name="note" maxlength="200" value="${s.note ?? ""}"></label> <button>Save</button></p>
<p class="muted">Closing or shrinking a window never cancels an order already in it.</p>`)}</details></td>
<td>${(s.orders ?? []).map((code) => { const o = orderOf.get(code); return o ? html`<details><summary>${code} <span class="muted">${o.status.replace(/_/g, " ")}</span></summary>
${form(c.f, `/windows/order/${o.id}/reschedule`, html`<p>Move to <select name="slot">${targets.filter((t) => t.slot_id !== s.slot_id).map((t) => html`<option value="${t.slot_id}">${slotLabel(t)} (${t.free} free)</option>`)}</select></p>
<p><input name="reason" maxlength="200" placeholder="reason (required)" required> <button>Move</button></p>
<p><textarea name="tell" rows="2" cols="50" maxlength="1000" placeholder="message to the customer (optional; sent from the customer number)"></textarea></p>`)}
${form(c.f, `/windows/order/${o.id}/cancel`, html`<p><input name="reason" maxlength="200" placeholder="reason for cancelling (required)" required> <button>Cancel this order</button></p>
<p><textarea name="tell" rows="2" cols="50" maxlength="1000" placeholder="message to the customer (optional)"></textarea></p>
<p class="muted">A paid order that is cancelled is owed back to the customer as credit.</p>`)}</details>` : html`<span>${code}</span> `; })}</td></tr>`)}</table>`}`);
}

// ---------- plans and calendar ----------
const timeOf = (c: Ctx, field: string) => {
  const v = (c.form[field] ?? "").trim();
  if (!/^\d{2}:\d{2}$/.test(v)) throw new UserError(`Fill in ${field.replace(/_/g, " ")} as a time.`);
  return v;
};
const dateOf = (c: Ctx, field: string) => {
  const v = (c.form[field] ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new UserError(`Fill in ${field.replace(/_/g, " ")} as a date.`);
  return v;
};
const optionalId = (c: Ctx, field: string) => {
  const v = (c.form[field] ?? "").trim();
  if (!v) return null;
  if (!UUID.test(v)) throw new UserError("That record is not valid.");
  return v;
};

async function savePlan(c: Ctx) {
  const plan = optionalId(c, "plan");
  const weekdays = [1, 2, 3, 4, 5, 6, 7].filter((d) => c.form[`wd_${d}`]).map(String);
  if (weekdays.length === 0) throw new UserError("Tick at least one day.");
  const name = text(c, "name", 60);
  if (name.length < 2) throw new UserError("Write the plan's name.");
  const args = {
    p_name: name, p_weekdays: weekdays, p_starts: timeOf(c, "starts"), p_ends: timeOf(c, "ends"), p_capacity: num(c, "capacity", { min: 0, max: 500 }),
    p_order_by_min: num(c, "order_by_min", { min: 0, max: 10080 }), p_fresh_order_by_min: num(c, "fresh_order_by_min", { min: 0, max: 10080 }),
    p_calendar_kind: KINDS.includes(c.form.calendar_kind ?? "") ? c.form.calendar_kind : null, p_zone: optionalId(c, "zone"), p_active: !!c.form.active,
  };
  return act(c, plan ? "window_plan_change" : "window_plan_add", { plan, ...args }, async () => {
    const r = await c.deps.db.rpc<{ created: boolean; slots_ahead: number }>("save_window_plan", { p_by: c.staff.partyId, p_id: plan, ...args });
    return `${r.created ? "Added" : "Saved"} “${name}”. ${r.slots_ahead} window${r.slots_ahead === 1 ? "" : "s"} ahead from it.`;
  }, "/windows");
}

async function saveCalendar(c: Ctx) {
  const entry = optionalId(c, "entry");
  const name = text(c, "name", 60);
  if (name.length < 2) throw new UserError("Write a name for these dates.");
  const args = { p_kind: KINDS.includes(c.form.kind ?? "") ? c.form.kind : null, p_name: name, p_starts_on: dateOf(c, "starts_on"), p_ends_on: dateOf(c, "ends_on"),
    p_closed: !!c.form.closed, p_note: text(c, "note", 200) || null };
  if (!args.p_kind) throw new UserError("Pick the kind.");
  return act(c, entry ? "calendar_change" : "calendar_add", { entry, ...args }, async () => {
    const r = await c.deps.db.rpc<{ created: boolean }>("save_calendar_entry", { p_by: c.staff.partyId, p_id: entry, ...args });
    return `${r.created ? "Added" : "Saved"} “${name}”.`;
  }, "/windows");
}

async function removeCalendar(c: Ctx) {
  const entry = id(c, "id");
  return act(c, "calendar_remove", { entry }, async () => {
    const r = await c.deps.db.rpc<{ removed: boolean }>("remove_calendar_entry", { p_by: c.staff.partyId, p_id: entry });
    return r.removed ? "Removed from the calendar." : "It was already removed.";
  }, "/windows");
}

// ---------- one slot ----------
async function editSlot(c: Ctx) {
  const slot = id(c, "slot");
  const capacity = num(c, "capacity", { min: 0, max: 500, optional: true });
  const closed = c.form.state === "closed" ? true : c.form.state === "open" ? false : null;
  const note = text(c, "note", 200) || null;
  return act(c, "slot_edit", { slot, capacity, closed, note }, async () => {
    const r = await c.deps.db.rpc<{ capacity: number; closed: boolean; held: number }>("edit_delivery_slot", { p_slot: slot, p_by: c.staff.partyId, p_capacity: capacity, p_closed: closed, p_note: note });
    return `Saved: capacity ${r.capacity}, ${r.closed ? "closed" : "open"}, ${r.held} held.${r.held > r.capacity ? " More are held than the capacity: they keep their window." : ""}`;
  }, "/windows");
}

// ---------- an order in a slot ----------
const WHY: Record<string, string> = {
  full: "That window is full: raise its capacity first, on purpose.", closed: "That window is closed.", unknown: "That window does not exist.",
  zone: "That window is for another zone than the order's village.", in_progress: "The order is already being picked or delivered: it cannot be moved.",
  cutoff: "That window's cut-off has passed.", fresh_cutoff: "That window's cut-off for fresh goods has passed.",
};

/** Tells the customer what the person wrote, through the gateway, once. Returns a sentence to add to the flash. */
async function tell(c: Ctx, order: string, customer: string | null | undefined, body: string): Promise<string> {
  if (!body) return " The customer was not told: write to them from Exceptions and chats if they should know.";
  if (!customer) return " The customer was not told: no customer is recorded on the order.";
  const key = (c.form._key ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
  const to = await c.deps.db.rpc<string | null>("party_address", { p_party: customer, p_line: "customer" });
  if (!to) return " The customer was not told: no address on the customer line.";
  // Fail closed (invariant 20): if the gateway cannot say the message went out or was refused, it is not sent and the person is told.
  // The order has already been changed by now, so this must not read as "nothing was changed".
  let res: Awaited<ReturnType<Ctx["deps"]["send"]>>;
  try { res = await c.deps.send({ line: "customer", partyId: customer, to, category: "service", orderId: order, dedupeKey: `console:window:${order}:${key}`, msg: { type: "text", text: { body } } }); }
  catch { return " The customer was not told: the message could not be sent just now. The order itself was changed; tell them another way."; }
  if (!res.ok) return res.refused === "window_closed" || /window/.test(res.refused) ? " The customer was not told: the 24-hour window is closed, tell them another way." : ` The customer was not told (${res.refused}).`;
  return res.wamid === "already_sent" ? " The message had already gone." : " The customer was told.";
}

async function reschedule(c: Ctx) {
  const order = id(c, "order");
  const slot = id(c, "slot");
  const reason = text(c, "reason", 200);
  const body = text(c, "tell", 1000);
  if (reason.length < 3) throw new UserError("Write the reason for the move.");
  return act(c, "order_reschedule", { order, slot, reason, told: body.length }, async () => {
    const r = await c.deps.db.rpc<{ ok: boolean; reason?: string; changed?: boolean; short_code: string; customer_id?: string; window?: { starts: string; ends: string; date: string; dow: number } }>(
      "reschedule_order", { p_order: order, p_slot: slot, p_actor: "ops", p_by: c.staff.partyId, p_reason: reason });
    if (!r.ok) throw new UserError(WHY[r.reason ?? ""] ?? `Not moved (${r.reason}).`);
    if (!r.changed) return `${r.short_code} is already in that window.`;
    const w = r.window;
    return `${r.short_code} moved to ${w ? `${DAYS[w.dow - 1]} ${w.date} ${w.starts}–${w.ends}` : "the new window"}.${await tell(c, order, r.customer_id, body)}`;
  }, "/windows");
}

async function cancel(c: Ctx) {
  const order = id(c, "order");
  const reason = text(c, "reason", 200);
  const body = text(c, "tell", 1000);
  if (reason.length < 3) throw new UserError("Write the reason for cancelling.");
  return act(c, "order_cancel_scheduled", { order, reason, told: body.length }, async () => {
    const r = await c.deps.db.rpc<{ ok: boolean; changed: boolean; short_code: string; status: string; customer_id?: string; credit_usd?: number }>(
      "cancel_scheduled_order", { p_order: order, p_actor: "ops", p_by: c.staff.partyId, p_reason: reason });
    if (!r.changed) return `${r.short_code} was already ${r.status}.`;
    const credit = Number(r.credit_usd ?? 0);
    return `${r.short_code} cancelled.${credit > 0 ? ` $${credit.toFixed(2)} is owed back to the customer as credit.` : ""}${await tell(c, order, r.customer_id, body)}`;
  }, "/windows");
}

export const windowsSection: Section = {
  nav: { href: "/windows", label: "Windows", roles: LEADS },
  routes: [
    { method: "GET", path: "/windows", roles: LEADS, handler: page },
    { method: "POST", path: "/windows/plan", roles: LEADS, handler: savePlan },
    { method: "POST", path: "/windows/calendar", roles: LEADS, handler: saveCalendar },
    { method: "POST", path: "/windows/calendar/:id/remove", roles: LEADS, handler: removeCalendar },
    { method: "POST", path: "/windows/slot/:slot", roles: LEADS, handler: editSlot },
    { method: "POST", path: "/windows/order/:order/reschedule", roles: LEADS, handler: reschedule },
    { method: "POST", path: "/windows/order/:order/cancel", roles: LEADS, handler: cancel },
  ],
};
