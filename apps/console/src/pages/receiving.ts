// 3.12 Money in and out of the hub: the receiving form. Goods in from a supplier through receive_goods() (0024): quantity, cost
// and expiry per line, on credit or paid from the drawer (the database lets only the ops lead or an admin pay from the drawer).
// Suppliers are added with create_supplier() and paid with pay_supplier_checked() (0081: pay_supplier, after the drawer check).
// Nothing is paid from the drawer beyond what it holds by the books (receive_goods and pay_supplier_checked refuse, 0081).
// Each receipt shows the margin at today's price, and the gross margin of the day is in the day-close report (3.11).
import { act, can, html, num, render, text, UserError, UUID, type Ctx, type Section } from "../app";
import { form, usd, when } from "../html";
import { ALL, LEADS } from "../roles";

const LINES = 8;
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
${suppliers.length === 0 ? html`<p class="note">No supplier yet. ${leads ? "Add one below first." : "Ask the ops lead to add the supplier."}</p>` : form(c.f, "/receiving", html`
<p><label>Supplier <select name="supplier">${suppliers.map((s) => html`<option value="${s.id}">${s.name}</option>`)}</select></label>
<label>Invoice or delivery-note number <input name="supplier_ref" maxlength="60"></label>
<label>Paid <select name="paid_from"><option value="credit">on credit (we owe the supplier)</option><option value="hub_cash">from the drawer, now</option></select></label></p>
<table><tr><th>SKU or barcode</th><th>Quantity</th><th>Unit cost USD</th><th>Expiry (chilled, frozen, fresh)</th><th>Lot</th></tr>
${Array.from({ length: LINES }, (_, i) => html`<tr><td><input name="code_${i}" maxlength="40"></td><td><input type="number" name="qty_${i}" min="0" step="1"></td>
<td><input type="number" name="cost_${i}" min="0" step="0.0001"></td><td><input type="date" name="expiry_${i}"></td><td><input name="lot_${i}" maxlength="40"></td></tr>`)}</table>
<p><label>Note <input name="note" maxlength="200"></label> <button>Receive</button></p>`)}
<p class="muted">The same invoice number for the same supplier is received once, however many times the form is sent.</p>
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

async function receive(c: Ctx) {
  const supplier = (c.form.supplier ?? "").trim();
  if (!UUID.test(supplier)) throw new UserError("Pick the supplier.");
  const paidFrom = c.form.paid_from === "hub_cash" ? "hub_cash" : "credit";
  const src = await hub(c);
  const raw: { code: string; qty: number; cost: number; expiry: string | null; lot: string | null }[] = [];
  for (let i = 0; i < LINES; i++) {
    const code = (c.form[`code_${i}`] ?? "").trim();
    if (!code) continue;
    const qty = num(c, `qty_${i}`, { min: 0.001, max: 100000 })!;
    const cost = num(c, `cost_${i}`, { min: 0, max: 100000 })!;
    const expiry = (c.form[`expiry_${i}`] ?? "").trim();
    if (expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) throw new UserError(`Line ${i + 1}: the expiry date is not a date.`);
    raw.push({ code: code.slice(0, 40), qty, cost, expiry: expiry || null, lot: text(c, `lot_${i}`, 40) || null });
  }
  if (!raw.length) throw new UserError("Fill in at least one line.");
  const codes = raw.map((l) => l.code);
  const [bySku, byBarcode] = await Promise.all([
    c.deps.db.rows<{ id: string; sku: string | null; barcode: string | null; name_en: string }>("products", { select: "id,sku,barcode,name_en", where: { sku: { in: codes } } }),
    c.deps.db.rows<{ id: string; sku: string | null; barcode: string | null; name_en: string }>("products", { select: "id,sku,barcode,name_en", where: { barcode: { in: codes } } }),
  ]);
  const lines = raw.map((l) => {
    const p = bySku.find((x) => x.sku === l.code) ?? byBarcode.find((x) => x.barcode === l.code);
    if (!p) throw new UserError(`No item with SKU or barcode ${l.code}.`);
    return { product_id: p.id, qty: l.qty, unit_cost_usd: l.cost, expiry_date: l.expiry, lot: l.lot };
  });
  // Without the supplier's number, the form's one-time key stands in for it, so a double tap still receives once.
  const ref = text(c, "supplier_ref", 60) || `console:${(c.form._key ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40)}`;
  const note = text(c, "note", 200) || null;
  return act(c, "goods_receive", { supplier, paid_from: paidFrom, ref, lines: lines.length }, async () => {
    const r = await c.deps.db.rpc<{ duplicate: boolean; total_usd: number | string; lines?: { name: string; margin_pct: number | string | null }[] }>("receive_goods", {
      p_supplier: supplier, p_source: src, p_lines: lines, p_by: c.staff.partyId, p_supplier_ref: ref, p_paid_from: paidFrom, p_note: note,
    });
    if (r.duplicate) return `Already received under that number (${usd(r.total_usd)}); nothing changed.`;
    const margins = (r.lines ?? []).map((l) => `${l.name} ${l.margin_pct == null ? "no price" : `${Number(l.margin_pct)}%`}`).join("; ");
    return `Received ${lines.length} line${lines.length === 1 ? "" : "s"}, ${usd(r.total_usd)} at cost. Margin at today's price: ${margins}.`;
  }, "/receiving");
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
    { method: "POST", path: "/receiving", roles: ALL, handler: receive },
    { method: "POST", path: "/suppliers", roles: LEADS, handler: addSupplier },
    { method: "POST", path: "/suppliers/:supplier/pay", roles: LEADS, handler: paySupplier },
  ],
};
