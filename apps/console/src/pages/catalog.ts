// 3.7 Catalog: price, availability and stock count for the hub's items, with a reason on every change.
//   Count     count_stock()  (0023): the shelf count; the difference posts as an adjustment with reason "count".
//   Adjust    adjust_stock() (0023): a reason from the database's list; a picker's limit is the database's setting.
//   Price     set_offer()    (proposed in apps/console/sql/proposed_functions.sql): ops lead or admin, with a reason.
// Every form's one-time key is passed as the function's request key, so a double tap changes stock once.
import { act, can, html, id, num, render, text, UserError, type Ctx, type Section } from "../app";
import { form, Raw, usd, when } from "../html";
import { ALL, LEADS } from "../roles";

type Product = { id: string; sku: string | null; name_en: string; name_ar: string | null; brand: string | null; category: string; storage: string; sell_unit: string; is_active: boolean };
const REASONS = ["found", "damaged", "expired", "spoiled", "theft", "recall", "sample", "other"] as const;

async function hub(c: Ctx): Promise<string> {
  const s = (await c.deps.db.rows<{ id: string }>("sources", { select: "id", where: { kind: "dark_store" }, order: [{ col: "id" }], limit: 1 }))[0];
  if (!s) throw new UserError("There is no hub (dark store) in the database.");
  return s.id;
}

async function list(c: Ctx) {
  const { db } = c.deps;
  const src = await hub(c);
  const q = (c.url.searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 80);
  const all = await db.rows<Product>("products", { select: "id,sku,name_en,name_ar,brand,category,storage,sell_unit,is_active", where: { owner_source_id: null }, order: [{ col: "sku" }], limit: 5000 });
  const hits = (q ? all.filter((p) => [p.sku, p.name_en, p.name_ar, p.brand, p.category].some((v) => (v ?? "").toLowerCase().includes(q))) : all).slice(0, 100);
  const ids = hits.map((p) => p.id);
  const [offers, levels] = ids.length ? await Promise.all([
    db.rows<{ product_id: string; price_usd: number | string; is_available: boolean }>("offers", { select: "product_id,price_usd,is_available", where: { source_id: src, product_id: { in: ids } } }),
    db.rows<{ product_id: string; on_hand: number | string; reserved: number | string }>("stock_levels", { select: "product_id,on_hand,reserved", where: { source_id: src, product_id: { in: ids } } }),
  ]) : [[], []];
  const offer = new Map(offers.map((o) => [o.product_id, o]));
  const level = new Map(levels.map((l) => [l.product_id, l]));
  return render(c, "Catalog", html`
<form method="get" action="/catalog"><input name="q" value="${q}" placeholder="name, brand, SKU or category"> <button>Search</button></form>
<p class="muted">${hits.length} shown${q ? html` for “${q}”` : ""} of ${all.length}. Open an item to count it, adjust it or change its price.</p>
<table><tr><th>SKU</th><th>Item</th><th>Brand</th><th>Price</th><th>Available</th><th>On hand</th><th>Reserved</th></tr>
${hits.map((p) => { const o = offer.get(p.id); const l = level.get(p.id); return html`<tr><td><a href="/catalog/${p.id}">${p.sku ?? "—"}</a></td>
<td><a href="/catalog/${p.id}">${p.name_en}</a>${p.name_ar ? html`<br><span class="muted">${p.name_ar}</span>` : ""}</td><td>${p.brand ?? ""}</td>
<td>${o ? usd(o.price_usd) : html`<span class="warn">no price</span>`}</td><td>${o?.is_available ? "yes" : html`<strong class="warn">no</strong>`}</td>
<td>${l ? Number(l.on_hand) : 0}</td><td>${l ? Number(l.reserved) : 0}</td></tr>`; })}</table>`);
}

async function item(c: Ctx) {
  const { db } = c.deps;
  const product = id(c, "product");
  const src = await hub(c);
  const p = (await db.rows<Product>("products", { select: "id,sku,name_en,name_ar,brand,category,storage,sell_unit,is_active", where: { id: product }, limit: 1 }))[0];
  if (!p) throw new UserError("No such item.");
  const [offers, levels, moves, held, canPrice] = await Promise.all([
    db.rows<{ price_usd: number | string; is_available: boolean }>("offers", { select: "price_usd,is_available", where: { source_id: src, product_id: product }, limit: 1 }),
    db.rows<{ on_hand: number | string; reserved: number | string; avg_cost_usd: number | string | null }>("stock_levels", { select: "on_hand,reserved,avg_cost_usd", where: { source_id: src, product_id: product }, limit: 1 }),
    db.rows<{ qty_delta: number | string; reason: string; adjust_reason: string | null; note: string | null; created_at: string; actor_id: string | null }>("stock_movements", {
      select: "qty_delta,reason,adjust_reason,note,created_at,actor_id", where: { source_id: src, product_id: product }, order: [{ col: "created_at", desc: true }], limit: 15 }),
    db.rpc<boolean>("product_on_hold", { p_product: product }),
    db.hasFunction("set_offer"),
  ]);
  const o = offers[0]; const l = levels[0];
  const actors = moves.some((m) => m.actor_id) ? await db.rows<{ id: string; display_name: string | null }>("parties", { select: "id,display_name", where: { id: { in: [...new Set(moves.map((m) => m.actor_id).filter(Boolean) as string[])] } } }) : [];
  const who = (a: string | null) => (a ? actors.find((x) => x.id === a)?.display_name ?? "" : "");
  const back = `/catalog/${product}`;
  return render(c, p.name_en, html`
<p><a href="/catalog">← Catalog</a> · ${p.sku ?? ""} · ${p.brand ?? ""} · ${p.category} · ${p.storage} · sold ${p.sell_unit}${p.is_active ? "" : html` · <strong class="warn">inactive</strong>`}
${held ? html` · <strong class="warn">ON HOLD (recall): not sellable, not pickable</strong>` : ""}</p>
<p>Price <strong>${o ? usd(o.price_usd) : "none"}</strong> · available <strong>${o?.is_available ? "yes" : "no"}</strong> ·
on hand <strong>${l ? Number(l.on_hand) : 0}</strong> · reserved for open orders <strong>${l ? Number(l.reserved) : 0}</strong>
${l?.avg_cost_usd != null ? html` · average cost ${usd(l.avg_cost_usd)}` : ""}</p>
<h2>Count the shelf</h2>
${form(c.f, `${back}/count`, html`<label>Counted <input type="number" name="counted" min="0" step="1" required></label>
<label>Note <input name="note" maxlength="200"></label> <button>Save count</button>`)}
<h2>Adjust stock</h2>
${form(c.f, `${back}/adjust`, html`<label>Change (+ or −) <input type="number" name="delta" step="1" required></label>
<label>Reason <select name="reason">${REASONS.map((r) => html`<option>${r}</option>`)}</select></label>
<label>Note <input name="note" maxlength="200"></label> <button>Save change</button>`)}
${can(c, LEADS) ? html`<h2>Price and availability</h2>
${canPrice ? form(c.f, `${back}/offer`, html`<label>Price USD <input type="number" name="price_usd" step="0.01" min="0.01" value="${o ? Number(o.price_usd).toFixed(2) : ""}"></label>
<label><input type="checkbox" name="available" value="1"${o?.is_available !== false ? new Raw(" checked") : ""}> available</label>
<label>Reason <input name="reason" minlength="3" maxlength="200" required></label> <button>Save</button>`)
  : html`<p class="note">Changing price or availability needs set_offer(), not in the database yet (see docs/HANDOFF.md, Console).</p>`}` : ""}
<h2>Last movements</h2>
<table><tr><th>When</th><th>Change</th><th>Why</th><th>Who</th><th>Note</th></tr>
${moves.map((m) => html`<tr><td>${when(m.created_at)}</td><td>${Number(m.qty_delta)}</td><td>${m.reason}${m.adjust_reason ? ` (${m.adjust_reason})` : ""}</td><td>${who(m.actor_id)}</td><td>${m.note ?? ""}</td></tr>`)}</table>`);
}

const formKey = (c: Ctx) => { const k = (c.form._key ?? "").replace(/[^A-Za-z0-9_-]/g, ""); return k.length >= 8 ? `console:${k}` : null; };

async function count(c: Ctx) {
  const product = id(c, "product");
  const counted = num(c, "counted", { min: 0 })!;
  const note = text(c, "note", 200) || null;
  const src = await hub(c);
  return act(c, "stock_count", { product, counted, note }, async () => {
    const r = await c.deps.db.rpc<{ duplicate: boolean; expected: number | string; difference: number | string }>("count_stock", {
      p_source: src, p_product: product, p_counted: counted, p_by: c.staff.partyId, p_note: note, p_key: formKey(c),
    });
    if (r.duplicate) return "That count was already saved.";
    const diff = Number(r.difference);
    return diff === 0 ? "Count saved: matches the system." : `Count saved: the system had ${Number(r.expected)}, a difference of ${diff > 0 ? "+" : ""}${diff}.`;
  }, `/catalog/${product}`);
}

async function adjust(c: Ctx) {
  const product = id(c, "product");
  const delta = num(c, "delta")!;
  const reason = c.form.reason ?? "";
  if (!(REASONS as readonly string[]).includes(reason)) throw new UserError("Pick a reason from the list.");
  const note = text(c, "note", 200) || null;
  const src = await hub(c);
  return act(c, "stock_adjust", { product, delta, reason, note }, async () => {
    const r = await c.deps.db.rpc<{ duplicate?: boolean; on_hand?: number | string }>("adjust_stock", {
      p_source: src, p_product: product, p_delta: delta, p_reason: reason, p_by: c.staff.partyId, p_note: note, p_key: formKey(c),
    });
    return r?.duplicate ? "That change was already saved." : `Saved. On hand now ${Number(r?.on_hand ?? 0)}.`;
  }, `/catalog/${product}`);
}

async function offer(c: Ctx) {
  const product = id(c, "product");
  const price = num(c, "price_usd", { min: 0.01, max: 10000 });
  const available = c.form.available === "1";
  const reason = text(c, "reason", 200);
  if (reason.length < 3) throw new UserError("Write the reason for the change.");
  return act(c, "offer_change", { product, price_usd: price, available, reason }, async () => {
    const r = await c.deps.db.rpc<{ price_usd: number | string; is_available: boolean; before: { price_usd: number | string; is_available: boolean } | null }>("set_offer", {
      p_product: product, p_price_usd: price, p_available: available, p_by: c.staff.partyId, p_reason: reason,
    });
    const was = r.before ? `was ${usd(r.before.price_usd)}${r.before.is_available ? "" : ", unavailable"}` : "new";
    return `Saved: ${usd(r.price_usd)}${r.is_available ? "" : ", unavailable"} (${was}).`;
  }, `/catalog/${product}`);
}

export const catalogSection: Section = {
  nav: { href: "/catalog", label: "Catalog", roles: ALL },
  routes: [
    { method: "GET", path: "/catalog", roles: ALL, handler: list },
    { method: "GET", path: "/catalog/:product", roles: ALL, handler: item },
    { method: "POST", path: "/catalog/:product/count", roles: ALL, handler: count },
    { method: "POST", path: "/catalog/:product/adjust", roles: ALL, handler: adjust },
    { method: "POST", path: "/catalog/:product/offer", roles: LEADS, handler: offer },
  ],
};
