// 3.12 Money in and out of the hub: suppliers, what we owe them, and the last receipts. Since WH1a, goods come in only by receiving a
// purchase order (/purchase-orders, receive_purchase_order, 0237, which calls receive_goods, 0024): the form that received without an
// order is gone (docs/DECISIONS.md, WH1a), and this page sends you to the purchase orders.
// Suppliers are added with create_supplier() and paid with pay_supplier_checked() (0081: pay_supplier, after the drawer check).
// Nothing is paid from the drawer beyond what it holds by the books (receive_goods and pay_supplier_checked refuse, 0081).
// Each receipt shows the margin at today's price, and the gross margin of the day is in the day-close report (3.11).
// WH1a (coordinator, 18 November): the page is in Arabic and English, on DS2's components; its lines are in docs/ARABIC_REVIEW.md, WH1a.
import { can, html, num, render, text, UserError, UUID, type Ctx, type Section } from "../app";
import { form, usd, when } from "../html";
import { pick } from "../i18n";
import { ALL, LEADS } from "../roles";
import { badge, button, empty, input } from "@ak/ui/components";
import { doAct, hubId } from "./warehouse";

type Supplier = { id: string; name: string; phone: string | null; terms: string | null };
type Receipt = { id: string; supplier_id: string; supplier_ref: string | null; paid_from: string; total_usd: number | string; created_at: string; received_by: string };

async function page(c: Ctx) {
  const { db } = c.deps;
  const L = c.lang;
  const src = await hubId(c);
  const suppliers = await db.rows<Supplier>("suppliers", { select: "id,name,phone,terms", where: { is_active: true }, order: [{ col: "name" }], limit: 200 });
  const [balances, receipts, value] = await Promise.all([
    Promise.all(suppliers.map((s) => db.rpc<number | string>("supplier_balance", { p_supplier: s.id }))),
    db.rows<Receipt>("goods_receipts", { select: "id,supplier_id,supplier_ref,paid_from,total_usd,created_at,received_by", order: [{ col: "created_at", desc: true }], limit: 10 }),
    db.rpc<{ stock_value_usd: number | string; ledger_usd: number | string; uncosted_products: number | string }>("inventory_valuation", { p_source: src }),
  ]);
  const name = (id: string) => suppliers.find((s) => s.id === id)?.name ?? "";
  const leads = can(c, LEADS);
  const uncosted = Number(value.uncosted_products);
  return render(c, pick(L, "Receiving", "الاستلام"), html`
<h2>${pick(L, "Goods in", "البضاعة الداخلة")}</h2>
${suppliers.length === 0 ? html`<p class="note">${pick(L, "No supplier yet.", "لا مورّد بعد.")} ${leads ? pick(L, "Add one below first.", "أضف واحداً أدناه أولاً.") : pick(L, "Ask the ops lead to add the supplier.", "اطلب من مسؤول العمليات إضافة المورّد.")}</p>` : ""}
<p>${pick(L, "Goods come in only against a purchase order: open it on Purchase orders, count each line, and receive it there. A delivery with no order: the ops lead writes one first.", "تدخل البضاعة فقط مقابل طلب شراء: افتحه في «طلبات الشراء»، عُدّ كل سطر، واستلمه هناك. تسليم بلا طلب: يكتب مسؤول العمليات طلباً أولاً.")}</p>
<div class="actions-row">${button({ label: pick(L, "Purchase orders", "طلبات الشراء"), href: "/purchase-orders", icon: "list", variant: "primary" })}</div>
<h2>${pick(L, "Last receipts", "آخر الاستلامات")}</h2>
${receipts.length === 0 ? html`<p class="muted">${pick(L, "None.", "لا شيء.")}</p>` : html`<ul class="ak-rows">${receipts.map((g) => html`<li><div class="head"><strong><bdi>${name(g.supplier_id)}</bdi></strong><span class="tags">${badge(g.paid_from === "credit" ? pick(L, "on credit", "بالدَّين") : pick(L, "from the drawer", "من الصندوق"), "neutral")}</span></div>
<p class="muted">${when(g.created_at)} · ${pick(L, "Number", "الرقم")}: ${g.supplier_ref?.startsWith("console:") ? pick(L, "none", "لا يوجد") : html`<bdi>${g.supplier_ref ?? ""}</bdi>`} · ${pick(L, "Total at cost", "المجموع بالكلفة")}: <bdi>${usd(g.total_usd)}</bdi></p></li>`)}</ul>`}
<p>${pick(L, "Stock at cost", "المخزون بالكلفة")}: <bdi>${usd(value.stock_value_usd)}</bdi> (${pick(L, "books", "الدفاتر")}: <bdi>${usd(value.ledger_usd)}</bdi>)${uncosted ? html` · <span class="warn">${pick(L, `${uncosted} items on the shelf have no cost yet`, `${uncosted} صنف على الرف بلا كلفة بعد`)}</span>` : ""}</p>
<h2>${pick(L, "Suppliers", "المورّدون")}</h2>
${suppliers.length ? html`<ul class="ak-rows">${suppliers.map((s, i) => html`<li><div class="head"><strong><bdi>${s.name}</bdi></strong><span class="tags">${badge(pick(L, `We owe ${usd(balances[i])}`, `ندين ${usd(balances[i])}`), Number(balances[i]) > 0.004 ? "warn" : "neutral")}</span></div>
${s.phone || s.terms ? html`<p class="muted">${s.phone ? html`<bdi>${s.phone}</bdi>` : ""}${s.phone && s.terms ? " · " : ""}${s.terms ? html`<bdi>${s.terms}</bdi>` : ""}</p>` : ""}
${leads && Number(balances[i]) > 0.004 ? html`<details class="ak-more"><summary>${pick(L, "Pay from the drawer", "ادفع من الصندوق")}</summary>${form(c.f, `/suppliers/${s.id}/pay`, html`<div class="ak-money-fields">
${input({ name: "amount_usd", label: pick(L, "Amount USD", "المبلغ بالدولار"), type: "number", required: true, attrs: { step: "0.01", min: "0.01", inputmode: "decimal" } })}
${input({ name: "ref", label: pick(L, "Receipt number", "رقم الإيصال"), required: true, maxlength: 60, attrs: { minlength: "3" } })}</div>
<div class="actions-row">${button({ label: pick(L, "Pay", "ادفع"), icon: "money" })}</div>`)}</details>` : ""}</li>`)}</ul>` : leads ? "" : empty({ title: pick(L, "No supplier yet.", "لا مورّد بعد."), icon: "list" })}
${leads ? html`<h3>${pick(L, "Add a supplier", "أضف مورّداً")}</h3>${form(c.f, "/suppliers", html`<div class="ak-money-fields">
${input({ name: "name", label: pick(L, "Name", "الاسم"), required: true, maxlength: 100, attrs: { minlength: "2" } })}
${input({ name: "phone", label: pick(L, "Phone", "الهاتف"), maxlength: 30 })}
${input({ name: "terms", label: pick(L, "Terms", "الشروط"), maxlength: 100, placeholder: pick(L, "cash on delivery, 30 days", "نقداً عند التسليم، 30 يوماً") })}</div>
<div class="actions-row">${button({ label: pick(L, "Add", "أضف"), icon: "plus" })}</div>`)}` : ""}`, { translated: true });
}

async function addSupplier(c: Ctx) {
  const L = c.lang;
  const name = text(c, "name", 100);
  if (name.length < 2) throw new UserError(pick(L, "Write the supplier's name.", "اكتب اسم المورّد."));
  const phone = text(c, "phone", 30) || null;
  const terms = text(c, "terms", 100) || null;
  return doAct(c, "supplier_add", { name }, "/receiving", async () => {
    await c.deps.db.rpc("create_supplier", { p_name: name, p_by: c.staff.partyId, p_phone: phone, p_terms: terms });
    return { msg: pick(L, `Supplier ${name} saved.`, `حُفظ المورّد ${name}.`) };
  });
}

async function paySupplier(c: Ctx) {
  const L = c.lang;
  const supplier = c.params.supplier ?? "";
  if (!UUID.test(supplier)) throw new UserError(pick(L, "That record is not valid.", "هذا السجل غير صالح."));
  const amount = num(c, "amount_usd", { min: 0.01, max: 1_000_000 })!;
  const ref = text(c, "ref", 60);
  if (ref.length < 3) throw new UserError(pick(L, "Type the receipt number.", "اكتب رقم الإيصال."));
  return doAct(c, "supplier_pay", { supplier, amount_usd: amount, ref }, "/receiving", async () => {
    const r = await c.deps.db.rpc<{ duplicate: boolean; owed_usd: number | string }>("pay_supplier_checked", { p_supplier: supplier, p_amount_usd: amount, p_by: c.staff.partyId, p_ref: ref });
    return { msg: r.duplicate ? pick(L, "That payment was already recorded.", "سُجّلت هذه الدفعة من قبل.") : pick(L, `Paid ${usd(amount)} from the drawer. We now owe ${usd(r.owed_usd)}.`, `دُفع ${usd(amount)} من الصندوق. ندين الآن ${usd(r.owed_usd)}.`) };
  });
}

export const receivingSection: Section = {
  nav: { href: "/receiving", label: "Receiving", roles: ALL },
  routes: [
    { method: "GET", path: "/receiving", roles: ALL, handler: page },
    { method: "POST", path: "/suppliers", roles: LEADS, handler: addSupplier },
    { method: "POST", path: "/suppliers/:supplier/pay", roles: LEADS, handler: paySupplier },
  ],
};
