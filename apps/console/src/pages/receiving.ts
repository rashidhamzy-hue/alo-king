// 3.12 Money in and out of the hub: suppliers, what we owe them, and the last receipts. Since WH1a, goods come in only by receiving a
// purchase order (/purchase-orders, receive_purchase_order, 0237, which calls receive_goods, 0024): the form that received without an
// order is gone (docs/DECISIONS.md, WH1a), and this page sends you to the purchase orders.
// Suppliers are added with create_supplier() and paid with pay_supplier_checked() (0081: pay_supplier, after the drawer check).
// Nothing is paid from the drawer beyond what it holds by the books (receive_goods and pay_supplier_checked refuse, 0081).
// Each receipt shows the margin at today's price, and the gross margin of the day is in the day-close report (3.11).
import { act, can, html, num, render, text, UserError, UUID, type Ctx, type Section } from "../app";
import { form, usd, when } from "../html";
import { ALL, LEADS } from "../roles";

type Supplier = { id: string; name: string; phone: string | null; terms: string | null };
type Receipt = { id: string; supplier_id: string; supplier_ref: string | null; paid_from: string; total_usd: number | string; created_at: string; received_by: string };

async function hub(c: Ctx): Promise<string> {
  const s = (await c.deps.db.rows<{ id: string }>("sources", { select: "id", where: { kind: "dark_store" }, order: [{ col: "id" }], limit: 1 }))[0];
  if (!s) throw new UserError("There is no hub (dark store) in the database.");
  return s.id;
}

async function page(c: Ctx) {
  const { db } = c.deps;
  const src = await hub(c);
  const suppliers = await db.rows<Supplier>("suppliers", { select: "id,name,phone,terms", where: { is_active: true }, order: [{ col: "name" }], limit: 200 });
  const [balances, receipts, value] = await Promise.all([
    Promise.all(suppliers.map((s) => db.rpc<number | string>("supplier_balance", { p_supplier: s.id }))),
    db.rows<Receipt>("goods_receipts", { select: "id,supplier_id,supplier_ref,paid_from,total_usd,created_at,received_by", order: [{ col: "created_at", desc: true }], limit: 10 }),
    db.rpc<{ stock_value_usd: number | string; ledger_usd: number | string; uncosted_products: number | string }>("inventory_valuation", { p_source: src }),
  ]);
  const name = (id: string) => suppliers.find((s) => s.id === id)?.name ?? "";
  const leads = can(c, LEADS);
  return render(c, "Receiving", html`
<h2>Goods in</h2>
${suppliers.length === 0 ? html`<p class="note">No supplier yet. ${leads ? "Add one below first." : "Ask the ops lead to add the supplier."}</p>` : ""}
<p>Goods come in only against a purchase order: open it on <a href="/purchase-orders">Purchase orders</a>, count each line, and receive it there.
A delivery with no order: the ops lead writes one first.</p>
<h2>Last receipts</h2>
${receipts.length === 0 ? html`<p class="muted">None.</p>` : html`<table><tr><th>When</th><th>Supplier</th><th>Number</th><th>Paid</th><th>Total at cost</th></tr>
${receipts.map((g) => html`<tr><td>${when(g.created_at)}</td><td>${name(g.supplier_id)}</td><td>${g.supplier_ref?.startsWith("console:") ? html`<span class="muted">none</span>` : g.supplier_ref ?? ""}</td>
<td>${g.paid_from === "credit" ? "on credit" : "from the drawer"}</td><td>${usd(g.total_usd)}</td></tr>`)}</table>`}
<p>Stock at cost: ${usd(value.stock_value_usd)} (books: ${usd(value.ledger_usd)})${Number(value.uncosted_products) ? html` · <span class="warn">${Number(value.uncosted_products)} items on the shelf have no cost yet</span>` : ""}</p>
<h2>Suppliers</h2>
${suppliers.length ? html`<table><tr><th>Supplier</th><th>Phone</th><th>Terms</th><th>We owe</th>${leads ? html`<th>Pay from the drawer</th>` : ""}</tr>
${suppliers.map((s, i) => html`<tr><td>${s.name}</td><td>${s.phone ?? ""}</td><td>${s.terms ?? ""}</td><td>${usd(balances[i])}</td>
${leads ? html`<td>${Number(balances[i]) > 0.004 ? form(c.f, `/suppliers/${s.id}/pay`, html`<input type="number" name="amount_usd" step="0.01" min="0.01" required>
<input name="ref" placeholder="receipt number" minlength="3" maxlength="60" required> <button>Pay</button>`, { cls: "inline" }) : ""}</td>` : ""}</tr>`)}</table>` : ""}
${leads ? html`<h3>Add a supplier</h3>${form(c.f, "/suppliers", html`<label>Name <input name="name" minlength="2" maxlength="100" required></label>
<label>Phone <input name="phone" maxlength="30"></label> <label>Terms <input name="terms" maxlength="100" placeholder="cash on delivery, 30 days"></label> <button>Add</button>`)}` : ""}`);
}

async function addSupplier(c: Ctx) {
  const name = text(c, "name", 100);
  if (name.length < 2) throw new UserError("Write the supplier's name.");
  const phone = text(c, "phone", 30) || null;
  const terms = text(c, "terms", 100) || null;
  return act(c, "supplier_add", { name }, async () => {
    await c.deps.db.rpc("create_supplier", { p_name: name, p_by: c.staff.partyId, p_phone: phone, p_terms: terms });
    return `Supplier ${name} saved.`;
  }, "/receiving");
}

async function paySupplier(c: Ctx) {
  const supplier = c.params.supplier ?? "";
  if (!UUID.test(supplier)) throw new UserError("That record is not valid.");
  const amount = num(c, "amount_usd", { min: 0.01, max: 1_000_000 })!;
  const ref = text(c, "ref", 60);
  if (ref.length < 3) throw new UserError("Type the receipt number.");
  return act(c, "supplier_pay", { supplier, amount_usd: amount, ref }, async () => {
    const r = await c.deps.db.rpc<{ duplicate: boolean; owed_usd: number | string }>("pay_supplier_checked", { p_supplier: supplier, p_amount_usd: amount, p_by: c.staff.partyId, p_ref: ref });
    return r.duplicate ? "That payment was already recorded." : `Paid ${usd(amount)} from the drawer. We now owe ${usd(r.owed_usd)}.`;
  }, "/receiving");
}

export const receivingSection: Section = {
  nav: { href: "/receiving", label: "Receiving", roles: ALL },
  routes: [
    { method: "GET", path: "/receiving", roles: ALL, handler: page },
    { method: "POST", path: "/suppliers", roles: LEADS, handler: addSupplier },
    { method: "POST", path: "/suppliers/:supplier/pay", roles: LEADS, handler: paySupplier },
  ],
};
