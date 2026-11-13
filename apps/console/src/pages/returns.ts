// 3.6 Returns and refunds. Goods back from a failed delivery are received with receive_return() (0008): the person says how
// many of each item go back on the shelf; the rest is written off. Chilled, frozen and fresh default to written off.
// Refunds after delivery are task 2.3 (session C2): this page lists them once that function exists.
import { act, html, id, render, UserError, type Ctx, type Section } from "../app";
import { form, usd } from "../html";
import { ALL } from "../roles";

type Item = { order_id: string; product_id: string; name_snapshot: string; qty: number | string; unit_price_usd: number | string };

async function page(c: Ctx) {
  const { db } = c.deps;
  const pending = (await db.rpc<{ order_id: string; short_code: string }[]>("returns_pending", {})) ?? [];
  const items = pending.length ? await db.rows<Item>("order_items", { select: "order_id,product_id,name_snapshot,qty,unit_price_usd", where: { order_id: { in: pending.map((p) => p.order_id) } } }) : [];
  const products = items.length ? await db.rows<{ id: string; storage: string }>("products", { select: "id,storage", where: { id: { in: [...new Set(items.map((i) => i.product_id))] } } }) : [];
  const storage = new Map(products.map((p) => [p.id, p.storage]));
  return render(c, "Returns", html`
<h2>Goods to receive back (${pending.length})</h2>
<p class="muted">From failed deliveries. Count what comes back in good condition; only that goes back on the shelf. Chilled, frozen and fresh items are written off unless you clear them here.</p>
${pending.length === 0 ? html`<p class="muted">Nothing waiting.</p>` : pending.map((p) => html`<div class="pair"><div>
<p><strong>${p.short_code}</strong></p>
${form(c.f, `/returns/${p.order_id}`, html`<table><tr><th>Item</th><th>Storage</th><th>Sent</th><th>Back on the shelf</th></tr>
${items.filter((i) => i.order_id === p.order_id).map((i) => {
  const s = storage.get(i.product_id) ?? "ambient";
  return html`<tr><td>${i.name_snapshot}</td><td>${s}</td><td>${Number(i.qty)}</td>
<td><input type="number" name="restock_${i.product_id}" min="0" max="${Number(i.qty)}" step="1" value="${s === "ambient" ? Number(i.qty) : 0}"></td></tr>`;
})}</table><p><button>Received: restock and close</button></p>`)}
</div></div>`)}
<h2>Refunds</h2>
<p class="note">Refunds after delivery (credit, cash or Whish) come with task 2.3, session C2. Nothing to do here until then.</p>`);
}

async function receive(c: Ctx) {
  const order = id(c, "order");
  const restock: Record<string, number> = {};
  for (const [k, v] of Object.entries(c.form)) {
    if (!k.startsWith("restock_")) continue;
    const product = k.slice(8);
    if (!/^[0-9a-f-]{36}$/i.test(product)) continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new UserError("Counts must be zero or more.");
    restock[product] = n;
  }
  return act(c, "return_receive", { order, restock }, async () => {
    const r = await c.deps.db.rpc<{ already?: boolean; restocked_units?: number; wasted_units?: number; wasted_at_sell_price_usd?: number }>("receive_return", {
      p_order: order, p_by: c.staff.partyId, p_restock: restock,
    });
    if (r?.already) return "Already received; nothing changed.";
    return `Received. ${Number(r?.restocked_units ?? 0)} back on the shelf, ${Number(r?.wasted_units ?? 0)} written off (${usd(r?.wasted_at_sell_price_usd ?? 0)} at sale price).`;
  }, "/returns");
}

export const returnsSection: Section = {
  nav: { href: "/returns", label: "Returns", roles: ALL },
  routes: [
    { method: "GET", path: "/returns", roles: ALL, handler: page },
    { method: "POST", path: "/returns/:order", roles: ALL, handler: receive },
  ],
};
