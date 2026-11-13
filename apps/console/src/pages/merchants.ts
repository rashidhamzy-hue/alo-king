// 3.10 Merchants (minimal): approve a menu import (apply_menu_import) and approve a merchant (approve_merchant).
// A restaurant becomes orderable only through approve_merchant() (invariant 11): it needs an applied menu with prices and a
// contracted commission. This page never opens a merchant any other way, and shows no rating of anyone (invariant 14).
// Also here: the learned aliases waiting for a person (alias_candidates_ready / review_alias, B2's 1.14).
import { act, html, id, num, render, text, UserError, type Ctx, type Section } from "../app";
import { form, when } from "../html";
import { LEADS } from "../roles";

type Merchant = { id: string; name: string; is_open: boolean; commission_pct: number | string; approved_at: string | null; terms_accepted_at: string | null };
type Import = { id: string; source_id: string; media_path: string; extracted: { items?: { name_en?: string; name_ar?: string; section?: string; price?: number; currency?: string; confidence?: number }[] } | null; status: string; created_at: string };
type Alias = { alias_folded: string; product_id: string; alias: string; product: string; product_ar: string | null; hits: number; customers: number };

async function page(c: Ctx) {
  const { db, media } = c.deps;
  const merchants = await db.rows<Merchant>("sources", { select: "id,name,is_open,commission_pct,approved_at,terms_accepted_at", where: { kind: "merchant" }, order: [{ col: "name" }], limit: 500 });
  const imports = await db.rows<Import>("merchant_menu_imports", { select: "id,source_id,media_path,extracted,status,created_at", where: { status: "needs_review" }, order: [{ col: "created_at" }], limit: 50 });
  const menuLinks = await Promise.all(imports.map((i) => media.sign(i.media_path, 600)));
  const priced = merchants.length ? await db.rows<{ source_id: string }>("offers", { select: "source_id", where: { source_id: { in: merchants.map((m) => m.id) }, is_available: true } }) : [];
  const items = (s: string) => priced.filter((p) => p.source_id === s).length;
  const aliases = (await db.rpc<Alias[]>("alias_candidates_ready", {})) ?? [];
  const name = (s: string) => merchants.find((m) => m.id === s)?.name ?? "merchant";

  return render(c, "Merchants", html`
<h2>Menu imports to check (${imports.length})</h2>
<p class="muted">Compare every line with the menu. Applying it sets these prices as the merchant's offers and switches off anything not on it. Lines read with low confidence are skipped by the database.</p>
${imports.length === 0 ? html`<p class="muted">None waiting.</p>` : imports.map((m, i) => html`<div class="pair"><div style="flex:1">
<p><strong>${name(m.source_id)}</strong> · read ${when(m.created_at)}${menuLinks[i] ? html` · <a href="${menuLinks[i]}" target="_blank" rel="noopener">the menu as received</a>` : ""}</p>
<table><tr><th>Section</th><th>Item</th><th>Price</th><th>Confidence</th></tr>
${(m.extracted?.items ?? []).map((it) => html`<tr class="${(it.confidence ?? 1) < 0.6 ? "late" : ""}"><td>${it.section ?? ""}</td><td>${it.name_en ?? ""} ${it.name_ar ? html`<span class="muted">${it.name_ar}</span>` : ""}</td>
<td>${it.price ?? ""} ${it.currency ?? ""}</td><td>${it.confidence ?? ""}</td></tr>`)}</table>
${form(c.f, `/merchants/import/${m.id}`, html`<button>The menu matches: apply it</button>`)}
</div></div>`)}
<h2>Merchants</h2>
${merchants.length === 0 ? html`<p class="muted">No merchant yet. The hub is the whole catalog until a restaurant signs.</p>` : html`<table>
<tr><th>Merchant</th><th>Items with a price</th><th>Status</th><th>Approve: contracted commission and date terms were accepted</th></tr>
${merchants.map((m) => html`<tr><td>${m.name}</td><td>${items(m.id)}</td>
<td>${m.approved_at ? html`approved ${when(m.approved_at)}, commission ${Number(m.commission_pct)}%${m.is_open ? "" : " (closed)"}` : html`<strong>not orderable</strong>`}</td>
<td>${m.approved_at ? "" : form(c.f, `/merchants/${m.id}/approve`, html`<input type="number" name="commission_pct" min="0.5" max="40" step="0.5" placeholder="%" required>
<input type="date" name="terms_accepted" required> <button>Approve</button>`, { cls: "inline" })}</td></tr>`)}</table>`}
<h2>Words customers use, waiting for a person (${aliases.length})</h2>
<p class="muted">Learned from confirmed orders. Approving one lets search find the item by that word for everyone.</p>
${aliases.length === 0 ? html`<p class="muted">None waiting.</p>` : html`<table><tr><th>Word</th><th>Item</th><th>Times</th><th>Customers</th><th></th></tr>
${aliases.map((a) => html`<tr><td>${a.alias}</td><td>${a.product}${a.product_ar ? html` <span class="muted">${a.product_ar}</span>` : ""}</td><td>${a.hits}</td><td>${a.customers}</td>
<td>${form(c.f, `/aliases/${a.product_id}`, html`<input type="hidden" name="alias_folded" value="${a.alias_folded}">
<button name="decision" value="approve">Approve</button> <button name="decision" value="reject">Reject</button>`, { cls: "inline" })}</td></tr>`)}</table>`}`);
}

async function applyImport(c: Ctx) {
  const imp = id(c, "import");
  return act(c, "menu_import_apply", { import: imp }, async () => {
    const r = await c.deps.db.rpc<{ already?: boolean; new?: number; updated?: number; switched_off?: number }>("apply_menu_import", { p_import: imp, p_by: c.staff.partyId });
    if (r.already) return "Already applied.";
    return `Menu applied: ${r.new ?? 0} new items, ${r.updated ?? 0} prices updated, ${r.switched_off ?? 0} switched off. The merchant is still not orderable until approved.`;
  }, "/merchants");
}

async function approve(c: Ctx) {
  const source = id(c, "source");
  const pct = num(c, "commission_pct", { min: 0.5, max: 40 })!;
  const day = (c.form.terms_accepted ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day))) throw new UserError("Give the date the terms were accepted.");
  if (Date.parse(day) > c.deps.now().getTime()) throw new UserError("The terms date cannot be in the future.");
  return act(c, "merchant_approve", { source, commission_pct: pct, terms_accepted: day }, async () => {
    const r = await c.deps.db.rpc<{ items: number }>("approve_merchant", { p_source: source, p_by: c.staff.partyId, p_commission_pct: pct, p_terms_accepted_at: `${day}T00:00:00Z` });
    return `Approved: ${r.items} items orderable, commission ${pct}%.`;
  }, "/merchants");
}

async function alias(c: Ctx) {
  const product = id(c, "product");
  const folded = text(c, "alias_folded", 200);
  const approveIt = c.form.decision === "approve";
  if (!folded || !["approve", "reject"].includes(c.form.decision ?? "")) throw new UserError("Choose approve or reject.");
  return act(c, approveIt ? "alias_approve" : "alias_reject", { product, alias_folded: folded }, async () => {
    const r = await c.deps.db.rpc<{ already?: string }>("review_alias", { p_alias_folded: folded, p_product: product, p_by: c.staff.partyId, p_approve: approveIt });
    return r?.already ? `Already ${r.already}.` : approveIt ? "Approved: search now knows this word." : "Rejected.";
  }, "/merchants");
}

export const merchantsSection: Section = {
  nav: { href: "/merchants", label: "Merchants", roles: LEADS },
  routes: [
    { method: "GET", path: "/merchants", roles: LEADS, handler: page },
    { method: "POST", path: "/merchants/import/:import", roles: LEADS, handler: applyImport },
    { method: "POST", path: "/merchants/:source/approve", roles: LEADS, handler: approve },
    { method: "POST", path: "/aliases/:product", roles: LEADS, handler: alias },
  ],
};
