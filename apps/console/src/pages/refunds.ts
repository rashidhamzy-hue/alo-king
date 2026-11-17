// Refunds and customer credit (task 2.3's console side, C2's request; part of 3.6). Writes only through C2's functions (0030):
//   refund_order()          a complaint after delivery: what is given back and whose money it was (goods, the delivery fee while it
//                           is still ours, the small-order fee, or goodwill as a company cost), kept as credit or paid out at once
//   pay_out_credit()        credit the customer wants now: cash from the hub till, or Whish / OMT with the transfer reference
//                           (called as pay_out_credit_checked(), 0081: cash only while the drawer holds it; so do cash refunds)
//   apply_customer_credit() free credit taken off an unpaid order
// The caps come from the ledger, in SQL. The delivery fee is the rider's once the order closes (invariant 10): the database refuses
// to take it back and says to charge goodwill instead. Every form's one-time key is the function's request key (a double tap is one refund).
import { act, html, num, render, text, UserError, UUID, type Ctx, type Section } from "../app";
import { form, usd, when } from "../html";
import { pick } from "../i18n";
import { LEADS } from "../roles";
import { moneyTabs } from "./moneyframe";
import { button, empty, input, select } from "@ak/ui/components";

export const CHARGES = ["goods", "delivery_fee", "small_order_fee", "goodwill"] as const;
export const REASONS = ["missing_item", "damaged", "wrong_item", "late", "order_cancelled", "other"] as const;
const SETTLE = ["credit", "cash", "whish", "omt"] as const;
const CHARGE_WORDS: Record<string, string> = { goods: "goods (reverses the sale)", delivery_fee: "delivery fee (only before the order closes)",
  small_order_fee: "small-order fee", goodwill: "goodwill (a company cost)" };

const CHARGE_AR: Record<string, string> = { goods: "البضاعة (يعكس البيع)", delivery_fee: "رسم التوصيل (قبل إغلاق الطلب فقط)", small_order_fee: "رسم الطلب الصغير", goodwill: "حسن نية (تكلفة على الشركة)" };

type Order = { id: string; short_code: string; status: string; customer_id: string; total_usd: string | number; subtotal_usd: string | number;
  delivery_fee_usd: string | number; small_order_fee_usd: string | number; payment_method: string; created_at: string };
type Item = { id: string; name_snapshot: string; qty: string | number; unit_price_usd: string | number; status: string };
type CreditView = { balance_usd: number | string; available_usd: number | string;
  refunds: { id: string; order: string; amount_usd: number | string; reason: string; charged_to: string; settle: string; at: string }[] };

const key = (c: Ctx, suffix = "") => { const k = (c.form._key ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60); return k.length >= 8 ? `console:${k}${suffix}` : null; };
const oneOf = <T extends string>(v: string | undefined, list: readonly T[], what: string): T => {
  if (!v || !(list as readonly string[]).includes(v)) throw new UserError(`Pick ${what} from the list.`);
  return v as T;
};

async function customersOwed(c: Ctx) {
  const accts = await c.deps.db.rows<{ party_id: string }>("ledger_accounts", { select: "party_id", where: { kind: "customer_credit" }, limit: 500 });
  const ids = [...new Set(accts.map((a) => a.party_id).filter(Boolean))];
  const views = await Promise.all(ids.map((p) => c.deps.db.rpc<CreditView>("customer_credit_view", { p_party: p })));
  const names = ids.length ? await c.deps.db.rows<{ id: string; display_name: string | null }>("parties", { select: "id,display_name", where: { id: { in: ids } } }) : [];
  return ids.map((id, i) => ({ id, name: names.find((n) => n.id === id)?.display_name ?? "Customer", view: views[i]! }))
    .filter((x) => Number(x.view.balance_usd) > 0.004);
}

async function page(c: Ctx) {
  const { db } = c.deps;
  const L = c.lang;
  const code = (c.url.searchParams.get("order") ?? "").trim().toUpperCase().slice(0, 20);
  let order: Order | null = null;
  let body: unknown = "";
  if (code) {
    order = (await db.rows<Order>("orders", { select: "id,short_code,status,customer_id,total_usd,subtotal_usd,delivery_fee_usd,small_order_fee_usd,payment_method,created_at",
      where: { short_code: code }, limit: 1 }))[0] ?? null;
    if (!order) body = html`<p class="flash err">${pick(L, `No order ${code}.`, `لا يوجد طلب ${code}.`)}</p>`;
  }
  if (order) {
    const [items, paid, view] = await Promise.all([
      db.rows<Item>("order_items", { select: "id,name_snapshot,qty,unit_price_usd,status", where: { order_id: order.id }, order: [{ col: "name_snapshot" }] }),
      db.rows<{ amount_usd: string | number; method: string }>("payments", { select: "amount_usd,method", where: { order_id: order.id, status: "confirmed" } }),
      db.rpc<CreditView>("customer_credit_view", { p_party: order.customer_id }),
    ]);
    const paidUsd = paid.reduce((s, p) => s + Number(p.amount_usd), 0);
    const mine = view.refunds.filter((r) => r.order === order!.short_code);
    const open = !["closed", "cancelled", "returned", "failed_delivery"].includes(order.status) && paidUsd === 0;
    body = html`<section class="ak-card">
<h2>${order.short_code} · ${order.status}</h2>
<p>${pick(L, "Total", "المجموع")} ${usd(order.total_usd)} (${pick(L, "goods", "البضاعة")} ${usd(order.subtotal_usd)}, ${pick(L, "delivery fee", "رسم التوصيل")} ${usd(order.delivery_fee_usd)}${Number(order.small_order_fee_usd) ? html`, ${pick(L, "small-order fee", "رسم الطلب الصغير")} ${usd(order.small_order_fee_usd)}` : ""}) ·
${pick(L, "paid", "المدفوع")} ${paidUsd > 0 ? usd(paidUsd) : html`<strong class="warn">${pick(L, "nothing yet", "لا شيء بعد")}</strong>`} (${order.payment_method}) · ${pick(L, "placed", "وقت الطلب")} ${when(order.created_at)}</p>
<div class="ak-table-wrap"><table class="ak-table"><caption class="ak-sr">${pick(L, "Items", "البنود")}</caption><thead><tr><th scope="col">${pick(L, "Item", "الصنف")}</th><th scope="col" class="num">${pick(L, "Qty", "الكمية")}</th><th scope="col" class="num">${pick(L, "Price", "السعر")}</th><th scope="col" class="num">${pick(L, "Line", "السطر")}</th></tr></thead><tbody>
${items.map((i) => html`<tr><td>${i.name_snapshot}${i.status === "ok" ? "" : html` <span class="muted">(${i.status})</span>`}</td><td class="num">${Number(i.qty)}</td><td class="num">${usd(i.unit_price_usd)}</td><td class="num">${i.status === "ok" ? usd(Number(i.qty) * Number(i.unit_price_usd)) : ""}</td></tr>`)}</tbody></table></div>
<p>${pick(L, "Refunded on this order:", "المُسترد على هذا الطلب:")} ${mine.length ? mine.map((r) => html`${usd(r.amount_usd)} ${r.charged_to} (${r.reason}, ${r.settle}) `) : pick(L, "nothing", "لا شيء")} ·
${pick(L, "the customer's credit:", "رصيد الزبون:")} ${usd(view.balance_usd)} ${pick(L, "owed", "مستحق")}, ${usd(view.available_usd)} ${pick(L, "free to use", "حرّ للاستعمال")}.</p></section>
${paidUsd > 0 ? html`<section class="ak-card"><h3>${pick(L, "Refund", "استرداد")}</h3>
<p class="muted">${pick(L, "Only money that was paid can be refunded. An unpaid order is corrected, not refunded.", "يُستردّ المال المدفوع فقط. الطلب غير المدفوع يُصحَّح ولا يُسترد.")} ${pick(L, "A refund above the limit waits for a second person.", "الاسترداد فوق الحد ينتظر شخصاً ثانياً.")}</p>
${form(c.f, `/refunds/${order.id}`, html`
<div class="ak-money-fields">${input({ name: "amount_usd", label: pick(L, "Amount USD", "المبلغ بالدولار"), type: "number", required: true, attrs: { step: "0.01", min: "0.01", inputmode: "decimal" } })}
${select({ name: "charged_to", label: pick(L, "Charged to", "يُحمَّل على"), options: CHARGES.map((x) => ({ value: x, label: (L === "ar" ? CHARGE_AR[x] : CHARGE_WORDS[x])! })) })}
${select({ name: "reason", label: pick(L, "Reason", "السبب"), options: REASONS.map((x) => ({ value: x, label: x })) })}
${select({ name: "item", label: pick(L, "Item", "الصنف"), options: [{ value: "", label: pick(L, "(whole order)", "(الطلب كله)") }, ...items.filter((i) => i.status === "ok").map((i) => ({ value: i.id, label: i.name_snapshot }))] })}
${select({ name: "settle", label: pick(L, "Give it back as", "يُعاد عبر"), options: SETTLE.map((x) => ({ value: x, label: x })) })}
${input({ name: "ref", label: pick(L, "Transfer reference (Whish, OMT)", "مرجع التحويل (Whish، OMT)"), maxlength: 60 })}${input({ name: "note", label: pick(L, "Note", "ملاحظة"), maxlength: 300 })}</div>
<div class="actions-row">${button({ label: pick(L, "Refund", "استرد"), variant: "gold", icon: "check" })}</div>`)}</section>` : ""}
${open && Number(view.available_usd) > 0.004 ? html`<section class="ak-card"><h3>${pick(L, "Use credit on this order", "استعمل الرصيد على هذا الطلب")}</h3>
${form(c.f, `/refunds/${order.id}/apply`, html`<div class="actions-row">${button({ label: pick(L, `Take ${usd(Math.min(Number(view.available_usd), Number(order.total_usd)))} off this order`, `اخصم ${usd(Math.min(Number(view.available_usd), Number(order.total_usd)))} من هذا الطلب`), icon: "check" })}</div>`)}</section>` : ""}`;
  }
  const owed = await customersOwed(c);
  return render(c, pick(L, "Refunds and credit", "المبالغ المستردة والرصيد"), html`${await moneyTabs(c, "refunds")}
<form method="get" action="/refunds" class="ak-filters"><label class="ak-field ak-field--grow"><span>${pick(L, "Order", "الطلب")}</span><input class="ak-input" name="order" value="${code}" placeholder="AK-1234" maxlength="20"></label> ${button({ label: pick(L, "Open", "افتح"), icon: "search" })}</form>
${body}
<h2>${pick(L, `Customers we owe (${owed.length})`, `زبائن لهم عندنا (${owed.length})`)}</h2>
${owed.length === 0 ? empty({ title: pick(L, "Nobody.", "لا أحد."), ok: true, icon: "check" }) : html`<div class="ak-table-wrap"><table class="ak-table"><tr><th>${pick(L, "Customer", "الزبون")}</th><th>${pick(L, "Owed", "المستحق")}</th><th>${pick(L, "Free to use", "الحرّ للاستعمال")}</th><th>${pick(L, "Last refunds", "آخر المبالغ المستردة")}</th><th>${pick(L, "Pay out", "ادفع")}</th></tr>
${owed.map((x) => html`<tr><td>${x.name}</td><td>${usd(x.view.balance_usd)}</td><td>${usd(x.view.available_usd)}</td>
<td>${x.view.refunds.slice(0, 3).map((r) => html`${r.order} ${usd(r.amount_usd)} (${r.reason})<br>`)}</td>
<td class="wrap">${Number(x.view.available_usd) > 0.004 ? form(c.f, `/credit/${x.id}/pay`, html`<input class="ak-input" type="number" name="amount_usd" step="0.01" min="0.01" max="${Number(x.view.available_usd).toFixed(2)}" value="${Number(x.view.available_usd).toFixed(2)}" required aria-label="${pick(L, "Amount USD", "المبلغ بالدولار")}">
<select class="ak-select" name="method" aria-label="${pick(L, "How", "كيف")}"><option>cash</option><option>whish</option><option>omt</option></select> <input class="ak-input" name="ref" placeholder="${pick(L, "reference", "المرجع")}" aria-label="${pick(L, "reference", "المرجع")}" maxlength="60"> ${button({ label: pick(L, "Pay out", "ادفع"), icon: "check" })}`)
  : html`<span class="muted">${pick(L, "taken off an open order", "خُصم من طلب مفتوح")}</span>`}</td></tr>`)}</table></div>`}`, { translated: true });
}

async function refund(c: Ctx) {
  const order = c.params.order ?? "";
  if (!UUID.test(order)) throw new UserError("That record is not valid.");
  const amount = num(c, "amount_usd", { min: 0.01, max: 10000 })!;
  const charged = oneOf(c.form.charged_to, CHARGES, "what it is charged to");
  const reason = oneOf(c.form.reason, REASONS, "a reason");
  const settle = oneOf(c.form.settle, SETTLE, "how it is given back");
  const item = (c.form.item ?? "").trim();
  if (item && !UUID.test(item)) throw new UserError("That item is not valid.");
  const ref = text(c, "ref", 60) || null;
  const note = text(c, "note", 300) || null;
  const code = (await c.deps.db.rows<{ short_code: string }>("orders", { select: "short_code", where: { id: order }, limit: 1 }))[0]?.short_code ?? "";
  return act(c, "refund", { order, amount_usd: amount, charged_to: charged, reason, settle, item: item || null }, async () => {
    const r = await c.deps.db.rpc<{ duplicate?: boolean; status?: string; settle?: string; credit_left_usd?: number | string }>("refund_order", {
      p_order: order, p_by: c.staff.partyId, p_amount_usd: amount, p_charged_to: charged, p_reason: reason, p_settle: settle,
      p_ref: ref, p_note: note, p_item: item || null, p_key: key(c),
    });
    if (r?.status === "awaiting_approval") return r.duplicate ? "That refund is already waiting for a second approval." : `Waiting for a second approval: ${usd(amount)} is above the refund limit. Another ops lead or admin approves it under Approvals.`;
    if (r?.duplicate) return "That refund was already recorded; nothing changed.";
    return settle === "credit" ? `Refunded ${usd(amount)} as credit. The customer has ${usd(r?.credit_left_usd)} free to use.`
      : `Refunded ${usd(amount)} and paid out by ${settle}.`;
  }, `/refunds?order=${encodeURIComponent(code)}`);
}

async function payOut(c: Ctx) {
  const party = c.params.party ?? "";
  if (!UUID.test(party)) throw new UserError("That record is not valid.");
  const amount = num(c, "amount_usd", { min: 0.01, max: 10000 })!;
  const method = oneOf(c.form.method, ["cash", "whish", "omt"] as const, "how it is paid");
  const ref = text(c, "ref", 60) || null;
  return act(c, "credit_pay_out", { party, amount_usd: amount, method }, async () => {
    const r = await c.deps.db.rpc<{ duplicate?: boolean; credit_left_usd?: number | string }>("pay_out_credit_checked", {
      p_party: party, p_amount: amount, p_method: method, p_by: c.staff.partyId, p_ref: ref, p_key: key(c),
    });
    if (r?.duplicate) return "That payout was already recorded; nothing changed.";
    return `Paid out ${usd(amount)} by ${method}. ${usd(r?.credit_left_usd)} of credit left.`;
  }, "/refunds");
}

async function applyCredit(c: Ctx) {
  const order = c.params.order ?? "";
  if (!UUID.test(order)) throw new UserError("That record is not valid.");
  const code = (await c.deps.db.rows<{ short_code: string }>("orders", { select: "short_code", where: { id: order }, limit: 1 }))[0]?.short_code ?? "";
  return act(c, "credit_apply", { order }, async () => {
    const r = await c.deps.db.rpc<{ applied_usd: number | string; total_usd: number | string; already?: boolean; reason?: string }>("apply_customer_credit", { p_order: order, p_by: c.staff.partyId });
    if (r.already) return `Credit was already taken off this order (${usd(r.applied_usd)}).`;
    if (Number(r.applied_usd) <= 0) throw new UserError(r.reason === "order_settled" ? "This order is already paid or closed." : "The customer has no free credit.");
    return `${usd(r.applied_usd)} taken off. The order now comes to ${usd(r.total_usd)}.`;
  }, `/refunds?order=${encodeURIComponent(code)}`);
}

export const refundsSection: Section = {
  nav: { href: "/refunds", label: "Refunds", roles: LEADS },
  routes: [
    { method: "GET", path: "/refunds", roles: LEADS, handler: page },
    { method: "POST", path: "/refunds/:order", roles: LEADS, handler: refund },
    { method: "POST", path: "/refunds/:order/apply", roles: LEADS, handler: applyCredit },
    { method: "POST", path: "/credit/:party/pay", roles: LEADS, handler: payOut },
  ],
};
