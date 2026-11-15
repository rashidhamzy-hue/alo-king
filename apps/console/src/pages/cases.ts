// 3.16 Complaint cases: one record per complaint (0048). Order, kind, owner, what was done, the refunds it led to, who closed it.
// An allergen complaint opens at the top of the queue and holds the product (hold_product, 0025) until a person clears it.
// The money is never moved here: a refund is made on the Refunds page (refund_order) and linked to the case.
import { act, html, render, text, UserError, UUID, type Ctx, type Section } from "../app";
import { form, usd, when } from "../html";
import { LEADS } from "../roles";

export const KINDS = ["late", "missing", "wrong", "quality", "allergen", "payment"] as const;
type Case = { id: string; order_id: string; kind: string; priority: number; detail: string; product_id: string | null; hold_id: string | null; owner_id: string | null;
  status: string; actions: { at: string; by: string; note: string; refund?: string | null }[]; refund_ids: string[]; opened_at: string; closed_at: string | null; outcome: string | null };

const keyOf = (c: Ctx) => { const k = (c.form._key ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60); return k.length >= 8 ? `console:${k}` : null; };

async function page(c: Ctx) {
  const { db } = c.deps;
  const [open, closed] = await Promise.all([
    db.rows<Case>("complaint_cases", { where: { status: "open" }, order: [{ col: "priority" }, { col: "opened_at" }], limit: 100 }),
    db.rows<Case>("complaint_cases", { where: { status: "closed" }, order: [{ col: "closed_at", desc: true }], limit: 10 }),
  ]);
  const all = [...open, ...closed];
  const orderIds = [...new Set(all.map((k) => k.order_id))];
  const productIds = [...new Set(all.map((k) => k.product_id).filter(Boolean) as string[])];
  const partyIds = [...new Set(all.flatMap((k) => [k.owner_id, ...k.actions.map((a) => a.by)]).filter(Boolean) as string[])];
  const [orders, products, people, leads, refunds, holds] = await Promise.all([
    orderIds.length ? db.rows<{ id: string; short_code: string }>("orders", { select: "id,short_code", where: { id: { in: orderIds } } }) : [],
    productIds.length ? db.rows<{ id: string; name_en: string }>("products", { select: "id,name_en", where: { id: { in: productIds } } }) : [],
    partyIds.length ? db.rows<{ id: string; display_name: string | null }>("parties", { select: "id,display_name", where: { id: { in: partyIds } } }) : [],
    db.rows<{ id: string; display_name: string | null }>("parties", { select: "id,display_name", where: { role: { in: ["ops_lead", "admin"] }, is_blocked: false }, limit: 50 }),
    orderIds.length ? db.rows<{ id: string; order_id: string; amount_usd: string; reason: string; created_at: string }>("refunds", { select: "id,order_id,amount_usd,reason,created_at", where: { order_id: { in: orderIds } } }) : [],
    productIds.length ? db.rows<{ product_id: string }>("product_holds", { select: "product_id", where: { product_id: { in: productIds }, released_at: null } }) : [],
  ]);
  const code = (id: string) => orders.find((o) => o.id === id)?.short_code ?? "";
  const pname = (id: string | null) => (id ? products.find((p) => p.id === id)?.name_en ?? "" : "");
  const who = (id: string | null) => (id ? people.find((p) => p.id === id)?.display_name ?? leads.find((p) => p.id === id)?.display_name ?? "" : "");
  const held = (id: string | null) => !!id && holds.some((h) => h.product_id === id);

  const asked = (c.url.searchParams.get("order") ?? "").trim().toUpperCase().slice(0, 20);
  let opener: unknown = form(c.f, "/cases", html`<input type="hidden" name="step" value="find"><label>Order <input name="order" placeholder="AK-1234" maxlength="20" required></label> <button>Next</button>`);
  if (asked) {
    const o = (await db.rows<{ id: string; short_code: string; status: string }>("orders", { select: "id,short_code,status", where: { short_code: asked }, limit: 1 }))[0];
    if (!o) opener = html`<p class="flash err">No order ${asked}.</p>${opener}`;
    else {
      const items = await db.rows<{ product_id: string; name_snapshot: string }>("order_items", { select: "product_id,name_snapshot", where: { order_id: o.id } });
      opener = form(c.f, `/cases/open/${o.id}`, html`<p><strong>${o.short_code}</strong> (${o.status})
<label>Kind <select name="kind">${KINDS.map((k) => html`<option>${k}</option>`)}</select></label>
<label>Item <select name="product"><option value="">(the order as a whole)</option>${[...new Map(items.map((i) => [i.product_id, i])).values()].map((i) => html`<option value="${i.product_id}">${i.name_snapshot}</option>`)}</select></label></p>
<p><label>What the customer said <textarea name="detail" rows="2" cols="60" maxlength="1000" required></textarea></label></p>
<p class="muted">An allergen complaint takes the item off sale at once (every order, every customer) until a person clears it.</p>
<p><button>Open the case</button></p>`);
    }
  }

  const caseBlock = (k: Case) => html`<div class="pair${k.kind === "allergen" && k.status === "open" ? " late" : ""}"><div>
<p><strong>${k.kind.toUpperCase()}</strong> · <a href="/refunds?order=${code(k.order_id)}">${code(k.order_id)}</a>${k.product_id ? html` · ${pname(k.product_id)}` : ""}
${held(k.product_id) ? html` · <strong class="warn">ON HOLD</strong>` : ""} · owner ${who(k.owner_id)} · opened ${when(k.opened_at)}</p>
<p>${k.detail}</p>
<ul>${k.actions.map((a) => html`<li class="muted">${when(a.at)} ${who(a.by)}: ${a.note}${a.refund ? html` (refund ${usd(refunds.find((r) => r.id === a.refund)?.amount_usd)})` : ""}</li>`)}</ul>
${k.status === "open" ? html`${form(c.f, `/cases/${k.id}/note`, html`<label>What was done <input name="note" minlength="3" maxlength="500" required></label>
<label>Owner <select name="owner"><option value="">(unchanged)</option>${leads.map((l) => html`<option value="${l.id}">${l.display_name ?? "Staff"}</option>`)}</select></label>
<label>Refund <select name="refund"><option value="">(none)</option>${refunds.filter((r) => r.order_id === k.order_id && !k.refund_ids.includes(r.id)).map((r) => html`<option value="${r.id}">${usd(r.amount_usd)} ${r.reason}</option>`)}</select></label>
<button>Add</button>`)}
${form(c.f, `/cases/${k.id}/close`, html`<label>Outcome <input name="outcome" minlength="3" maxlength="300" required></label>
${held(k.product_id) ? html`<label><input type="checkbox" name="release" value="1"> the item is safe: put it back on sale</label>` : ""} <button>Close the case</button>`)}`
  : html`<p>Closed ${when(k.closed_at)}: ${k.outcome}</p>`}
</div></div>`;

  return render(c, "Complaints", html`
<h2>Open a case</h2>${opener}
<h2>Open (${open.length})</h2>${open.length ? open.map(caseBlock) : html`<p class="muted">None.</p>`}
<h2>Recently closed</h2>${closed.length ? closed.map(caseBlock) : html`<p class="muted">None.</p>`}`);
}

async function find(c: Ctx): Promise<Response> {
  const o = (c.form.order ?? "").trim().toUpperCase().slice(0, 20);
  return new Response(null, { status: 303, headers: { location: `/cases?order=${encodeURIComponent(o)}` } });
}

async function openCase(c: Ctx) {
  const order = c.params.order ?? "";
  if (!UUID.test(order)) throw new UserError("That record is not valid.");
  const kind = c.form.kind ?? "";
  if (!(KINDS as readonly string[]).includes(kind)) throw new UserError("Pick the kind of complaint.");
  const product = (c.form.product ?? "").trim() || null;
  if (product && !UUID.test(product)) throw new UserError("That item is not valid.");
  const detail = text(c, "detail", 1000);
  if (detail.length < 3) throw new UserError("Write what the customer said.");
  return act(c, "case_open", { order, kind, product }, async () => {
    const r = await c.deps.db.rpc<{ duplicate: boolean; held: boolean; open_orders: unknown[] }>("open_complaint", {
      p_order: order, p_kind: kind, p_detail: detail, p_by: c.staff.partyId, p_product: product, p_key: keyOf(c),
    });
    if (r.duplicate) return "That case was already opened.";
    return r.held ? `Case opened at the top of the queue. The item is on hold: off sale and not pickable.${r.open_orders.length ? ` ${r.open_orders.length} open orders carry it: see Catalog.` : ""}` : "Case opened.";
  }, "/cases");
}

async function note(c: Ctx) {
  const id = c.params.case ?? "";
  if (!UUID.test(id)) throw new UserError("That record is not valid.");
  const n = text(c, "note", 500);
  if (n.length < 3) throw new UserError("Write what was done.");
  const owner = (c.form.owner ?? "").trim() || null;
  const refund = (c.form.refund ?? "").trim() || null;
  if ((owner && !UUID.test(owner)) || (refund && !UUID.test(refund))) throw new UserError("That record is not valid.");
  return act(c, "case_note", { case: id, owner, refund }, async () => {
    await c.deps.db.rpc("note_complaint", { p_case: id, p_by: c.staff.partyId, p_note: n, p_owner: owner, p_refund: refund });
    return "Added to the case.";
  }, "/cases");
}

async function close(c: Ctx) {
  const id = c.params.case ?? "";
  if (!UUID.test(id)) throw new UserError("That record is not valid.");
  const outcome = text(c, "outcome", 300);
  if (outcome.length < 3) throw new UserError("Write the outcome.");
  const release = c.form.release === "1";
  return act(c, "case_close", { case: id, release }, async () => {
    const r = await c.deps.db.rpc<{ already: boolean; hold_released: boolean; still_held: boolean }>("close_complaint", { p_case: id, p_by: c.staff.partyId, p_outcome: outcome, p_release_hold: release });
    if (r.already) return "Already closed.";
    return r.hold_released ? "Case closed; the item is back on sale." : r.still_held ? "Case closed. The item stays on hold until someone clears it." : "Case closed.";
  }, "/cases");
}

export const casesSection: Section = {
  nav: { href: "/cases", label: "Complaints", roles: LEADS },
  routes: [
    { method: "GET", path: "/cases", roles: LEADS, handler: page },
    { method: "POST", path: "/cases", roles: LEADS, handler: find },
    { method: "POST", path: "/cases/open/:order", roles: LEADS, handler: openCase },
    { method: "POST", path: "/cases/:case/note", roles: LEADS, handler: note },
    { method: "POST", path: "/cases/:case/close", roles: LEADS, handler: close },
  ],
};
