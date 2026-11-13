// 3.8 Daily exchange rate. One person sets it each morning. A later move of more than settings.fx.pause_move_pct within
// the day is held, and quoting pauses, until a person confirms it. The rule lives in SQL (set_fx_rate, confirm_fx_rate,
// fx_quoting_paused: proposed in apps/console/sql/proposed_functions.sql); this page only shows and asks.
import { act, can, html, id, num, render, type Ctx, type Section } from "../app";
import { form, lbp, when } from "../html";
import { LEADS } from "../roles";

async function page(c: Ctx) {
  const { db } = c.deps;
  const ready = await db.hasFunction("set_fx_rate");
  const [current, history] = await Promise.all([
    db.rpc<number | string | null>("current_fx", {}),
    db.rows<{ id: string; lbp_per_usd: number | string; effective_from: string; set_by: string | null }>("fx_rates", { select: "id,lbp_per_usd,effective_from,set_by", order: [{ col: "effective_from", desc: true }], limit: 15 }),
  ]);
  const pending = ready ? await db.rows<{ id: string; lbp_per_usd: number | string; base_rate: number | string; move_pct: number | string; proposed_by: string; proposed_at: string }>("fx_pending", {
    select: "id,lbp_per_usd,base_rate,move_pct,proposed_by,proposed_at", where: { status: "pending" }, limit: 1 }) : [];
  const ids = [...new Set([...history.map((h) => h.set_by), ...pending.map((p) => p.proposed_by)].filter(Boolean) as string[])];
  const names = ids.length ? await db.rows<{ id: string; display_name: string | null }>("parties", { select: "id,display_name", where: { id: { in: ids } } }) : [];
  const who = (x: string | null) => (x ? names.find((n) => n.id === x)?.display_name ?? "" : "(seed or script)");
  const p = pending[0];
  return render(c, "Exchange rate", html`
<p>Rate in force: <strong>${current ? lbp(current) : "none set"}</strong> per US dollar.</p>
${p ? html`<div class="note"><p><strong>Quoting is paused.</strong> ${who(p.proposed_by)} entered ${lbp(p.lbp_per_usd)} at ${when(p.proposed_at)}:
a move of ${Number(p.move_pct)}% from this morning's ${lbp(p.base_rate)}. Check the market rate, then confirm, or enter the right rate.</p>
${can(c, LEADS) ? form(c.f, `/fx/confirm/${p.id}`, html`<button>Confirm ${lbp(p.lbp_per_usd)}</button>`) : ""}</div>` : ""}
${!ready ? html`<p class="note">Setting the rate here needs set_fx_rate(), not in the database yet (see docs/HANDOFF.md, Console). Until then the rate is set by script.</p>`
  : can(c, LEADS) ? html`<h2>Set today's rate</h2>${form(c.f, "/fx", html`<label>LBP per USD <input type="number" name="lbp_per_usd" min="1" step="1" required></label> <button>Save</button>`)}
<p class="muted">The first rate after midnight (Beirut) is the morning rate. A later rate that moves more than the set percentage from it pauses quoting until someone confirms it.</p>` : ""}
<h2>Recent rates</h2>
<table><tr><th>From</th><th>LBP per USD</th><th>Set by</th></tr>${history.map((h) => html`<tr><td>${when(h.effective_from)}</td><td>${lbp(h.lbp_per_usd)}</td><td>${who(h.set_by)}</td></tr>`)}</table>`);
}

async function set(c: Ctx) {
  const rate = num(c, "lbp_per_usd", { min: 1, max: 10_000_000 })!;
  return act(c, "fx_set", { lbp_per_usd: rate }, async () => {
    const r = await c.deps.db.rpc<{ status: string; move_pct?: number | string }>("set_fx_rate", { p_lbp_per_usd: rate, p_by: c.staff.partyId });
    return r.status === "paused"
      ? `Held: ${lbp(rate)} moves ${Number(r.move_pct)}% from this morning's rate. Quoting is paused until it is confirmed.`
      : `Rate set: ${lbp(rate)} per dollar.`;
  }, "/fx");
}

async function confirm(c: Ctx) {
  const pending = id(c, "pending");
  return act(c, "fx_confirm", { pending }, async () => {
    const r = await c.deps.db.rpc<{ already?: string | null }>("confirm_fx_rate", { p_pending: pending, p_by: c.staff.partyId });
    return r.already ? `Already ${r.already}.` : "Confirmed. Quoting runs again at the new rate.";
  }, "/fx");
}

export const fxSection: Section = {
  nav: { href: "/fx", label: "Exchange rate", roles: LEADS },
  routes: [
    { method: "GET", path: "/fx", roles: LEADS, handler: page },
    { method: "POST", path: "/fx", roles: LEADS, handler: set },
    { method: "POST", path: "/fx/confirm/:pending", roles: LEADS, handler: confirm },
  ],
};
