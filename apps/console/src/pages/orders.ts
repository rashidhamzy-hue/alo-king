// Orders (session D5): find an order by its code, the customer's name or any part of their number, and read one order as a story:
// who, what, in which order things happened, what was said around it, what was paid and refunded. Read-only, except two buttons that
// file an eval case through file_order_eval_case() (0159): "wrong product" and "bot at fault". They change nothing on the order.
// The customer's phone is searched but never shown; a voice note is shown as "[audio]", never its words.
import { act, html, id, render, text, UserError, UUID, type Ctx, type Section } from "../app";
import { form, usd, when } from "../html";
import { pick, t } from "../i18n";
import { LEADS } from "../roles";
import { statusWord } from "./today";

type Row = { id: string; short_code: string; status: string; created_at: string; total_usd: number | string; payment_method: string; channel: string; customer_name: string | null; village_name: string | null };
type Order = { id: string; short_code: string; customer_id: string; conversation_id: string | null; status: string; village_id: string | null; is_pickup: boolean; subtotal_usd: number | string;
  delivery_fee_usd: number | string; tip_usd: number | string; total_usd: number | string; payment_method: string; channel: string; customer_notes: string | null; cancel_reason: string | null;
  created_at: string; confirmed_at: string | null; delivered_at: string | null };
type Item = { id: string; name_snapshot: string; qty: number | string; unit_price_usd: number | string; status: string; substitution_of: string | null; note: string | null; modifiers: unknown };
type Ev = { created_at: string; from_status: string | null; to_status: string; actor: string; reason: string | null };
type Pay = { id: string; method: string; status: string; amount_usd: number | string; received_usd: number | string; received_lbp: number | string; external_ref: string | null; confirmed_at: string | null; created_at: string };
type Ref = { id: string; amount_usd: number | string; charged_to: string; reason: string; settle: string; note: string | null; created_at: string };
type Msg = { direction: string; type: string; body: string | null; created_at: string; order_id: string | null };

const when_ = (t_: unknown) => when(t_);

async function search(c: Ctx) {
  const L = c.lang;
  const q = (c.url.searchParams.get("q") ?? "").trim().slice(0, 60);
  const rows = await c.deps.db.rpc<Row[]>("search_orders", { p_q: q, p_limit: 30 });
  return render(c, t(L, "orders_title"), html`
<form method="get" action="/orders"><p><input name="q" value="${q}" placeholder="${t(L, "orders_ph")}" maxlength="60" size="28" enterkeyhint="search"> <button>${t(L, "orders_find")}</button></p></form>
<p class="muted">${q ? t(L, "orders_found", { n: rows.length, q }) : t(L, "orders_recent")}</p>
${rows.length === 0 ? html`<p class="muted">${t(L, "orders_none")}</p>` : html`<ul class="inbox">${rows.map((o) => html`<li>
<a href="/orders/${o.id}"><strong>${o.short_code}</strong></a> · ${statusWord(L, o.status)} · ${usd(o.total_usd)} · ${o.payment_method}
<br><span class="muted">${o.customer_name ?? ""}${o.village_name ? html` · ${o.village_name}` : ""} · ${when_(o.created_at)} · ${o.channel}</span></li>`)}</ul>`}`, { translated: true });
}

async function one(c: Ctx) {
  const L = c.lang;
  const ref = (c.params.ref ?? "").trim();
  const { db } = c.deps;
  const o = (await db.rows<Order>("orders", { where: UUID.test(ref) ? { id: ref } : { short_code: ref.toUpperCase() }, limit: 1 }))[0];
  if (!o) return render(c, t(L, "orders_title"), html`<p class="flash err">${t(L, "order_not_found")}</p><p><a class="btn" href="/orders">${t(L, "orders_title")}</a></p>`, { translated: true });
  const [customer, village, items, events, pays, refunds, msgs] = await Promise.all([
    db.rows<{ display_name: string | null }>("parties", { select: "display_name", where: { id: o.customer_id }, limit: 1 }),
    o.village_id ? db.rows<{ name_en: string }>("villages", { select: "name_en", where: { id: o.village_id }, limit: 1 }) : Promise.resolve([]),
    db.rows<Item>("order_items", { select: "id,name_snapshot,qty,unit_price_usd,status,substitution_of,note,modifiers", where: { order_id: o.id }, order: [{ col: "name_snapshot" }] }),
    db.rows<Ev>("order_events", { select: "created_at,from_status,to_status,actor,reason", where: { order_id: o.id }, order: [{ col: "created_at" }], limit: 200 }),
    db.rows<Pay>("payments", { select: "id,method,status,amount_usd,received_usd,received_lbp,external_ref,confirmed_at,created_at", where: { order_id: o.id }, order: [{ col: "created_at" }] }),
    db.rows<Ref>("refunds", { select: "id,amount_usd,charged_to,reason,settle,note,created_at", where: { order_id: o.id }, order: [{ col: "created_at" }] }),
    // Messages around the order: those tied to it, and the customer's chat from just before it was placed to a while after it ended.
    db.rows<Msg>("wa_messages", { select: "direction,type,body,created_at,order_id", where: { party_id: o.customer_id, line: "customer", created_at: { gte: new Date(new Date(o.created_at).getTime() - 2 * 3600_000).toISOString() } }, order: [{ col: "created_at" }], limit: 120 }),
  ]);
  const until = new Date(o.delivered_at ?? c.deps.now().toISOString()).getTime() + 6 * 3600_000;
  const around = msgs.filter((m) => m.order_id === o.id || new Date(m.created_at).getTime() <= until).slice(-40);
  const name = new Map(items.map((i) => [i.id, i.name_snapshot]));

  type T = { at: string; kind: string; text: unknown };
  const line: T[] = [
    { at: o.created_at, kind: pick(L, "placed", "أُنشئ"), text: `${usd(o.total_usd)} · ${o.payment_method}` },
    ...events.map((e) => ({ at: e.created_at, kind: pick(L, "status", "الحالة"), text: e.from_status === e.to_status
      ? `${statusWord(L, e.to_status)} · ${e.reason ?? ""} (${e.actor})`
      : `${e.from_status ? statusWord(L, e.from_status) + " → " : ""}${statusWord(L, e.to_status)} (${e.actor}${e.reason ? `, ${e.reason}` : ""})` })),
    ...pays.map((p) => ({ at: p.confirmed_at ?? p.created_at, kind: pick(L, "payment", "دفعة"), text: `${p.method} · ${p.status} · ${usd(p.amount_usd)}${Number(p.received_usd) ? ` (${pick(L, "received", "المستلم")} ${usd(p.received_usd)})` : ""}` })),
    ...refunds.map((r) => ({ at: r.created_at, kind: pick(L, "refund", "استرداد"), text: `${usd(r.amount_usd)} · ${r.reason} · ${r.settle}` })),
    ...around.map((m) => ({ at: m.created_at, kind: pick(L, "message", "رسالة"), text: `${m.direction === "inbound" ? pick(L, "customer", "الزبون") : pick(L, "us", "نحن")}: ${m.body ?? `[${m.type}]`}` })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  return render(c, o.short_code, html`
<p><a href="/orders">← ${t(L, "orders_title")}</a></p>
<div class="card"><dl class="facts">
<dt>${pick(L, "Status", "الحالة")}</dt><dd><strong>${statusWord(L, o.status)}</strong>${o.cancel_reason ? html` · ${o.cancel_reason}` : ""}</dd>
<dt>${t(L, "customer")}</dt><dd>${customer[0]?.display_name ?? ""}</dd>
<dt>${t(L, "village")}</dt><dd>${o.is_pickup ? pick(L, "pickup at the hub", "استلام من المركز") : village[0]?.name_en ?? ""}</dd>
<dt>${t(L, "channel")}</dt><dd>${o.channel}</dd>
<dt>${t(L, "payment")}</dt><dd>${o.payment_method}</dd>
<dt>${t(L, "total")}</dt><dd>${usd(o.total_usd)} <span class="muted">(${usd(o.subtotal_usd)} + ${pick(L, "delivery", "توصيل")} ${usd(o.delivery_fee_usd)}${Number(o.tip_usd) ? ` + ${pick(L, "tip", "بقشيش")} ${usd(o.tip_usd)}` : ""})</span></dd>
<dt>${t(L, "placed")}</dt><dd>${when_(o.created_at)}</dd>
${o.customer_notes ? html`<dt>${pick(L, "Notes", "ملاحظات")}</dt><dd>${o.customer_notes}</dd>` : ""}</dl></div>
<h2>${t(L, "lines_h")}</h2>
<table><tr><th>${pick(L, "Item", "الصنف")}</th><th>${pick(L, "Qty", "الكمية")}</th><th>${pick(L, "Price", "السعر")}</th><th>${pick(L, "Change", "التغيير")}</th></tr>
${items.map((i) => html`<tr><td>${i.name_snapshot}${i.note ? html`<br><span class="muted">${i.note}</span>` : ""}</td><td>${Number(i.qty)}</td><td>${usd(i.unit_price_usd)}</td>
<td>${i.status === "substituted" ? pick(L, "substituted", "استُبدل") : i.status === "removed" ? pick(L, "removed", "أُزيل") : ""}${i.substitution_of ? html`${pick(L, "replaces", "بديل عن")} ${name.get(i.substitution_of) ?? ""}` : ""}</td></tr>`)}</table>
<h2>${t(L, "timeline_h")}</h2>
<ul class="timeline">${line.map((x) => html`<li><time>${when_(x.at)}</time><span class="k">${x.kind}</span> ${x.text}</li>`)}</ul>
<h2>${t(L, "file_h")}</h2><p class="muted">${t(L, "file_intro")}</p>
${form(c.f, `/orders/${o.id}/eval`, html`<p><input name="note" maxlength="300" placeholder="${t(L, "note_ph")}" size="34"></p>
<p><button name="kind" value="wrong_product">${t(L, "wrong_product")}</button> <button name="kind" value="bot_at_fault" class="secondary">${t(L, "bot_at_fault")}</button></p>`)}`, { translated: true });
}

async function file(c: Ctx) {
  const order = id(c, "id");
  const kind = (["wrong_product", "bot_at_fault"] as const).find((k) => k === c.form.kind);
  if (!kind) throw new UserError("Choose wrong product or bot at fault.");
  const note = text(c, "note", 300) || null;
  return act(c, `order_eval_${kind}`, { order, kind, characters: note?.length ?? 0 }, async () => {
    const r = await c.deps.db.rpc<{ already: boolean }>("file_order_eval_case", { p_order: order, p_by: c.staff.partyId, p_kind: kind, p_note: note });
    return r.already ? "This was already filed for the next evaluation round." : "Filed for the next evaluation round. The order is unchanged.";
  }, `/orders/${order}`);
}

export const ordersSection: Section = {
  nav: { href: "/orders", label: "Orders", roles: LEADS },
  routes: [
    { method: "GET", path: "/orders", roles: LEADS, handler: search },
    { method: "GET", path: "/orders/:ref", roles: LEADS, handler: one },
    { method: "POST", path: "/orders/:id/eval", roles: LEADS, handler: file },
  ],
};
