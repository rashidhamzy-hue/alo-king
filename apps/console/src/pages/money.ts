// 3.15 Petty cash and bank deposits: money out of the hub drawer (or the bank), each one ledger movement made by
// a SQL function (0047) with who, why and, where there is one, the slip or receipt photo in the private media bucket.
// The drawer must match the count at day close (3.11); these are the movements that explain the difference between the cash
// the riders brought in and the cash in the drawer.
import { act, html, num, render, text, upload, UserError, type Ctx, type Section } from "../app";
import { form, lbp, usd, when } from "../html";
import { LEADS } from "../roles";
import { beirutMidnight } from "./today";

type Native = { usd: number | string; lbp: number | string; lbp_carried_usd: number | string };
type Movement = { id: string; kind: string; usd: number | string; lbp: number | string; value_usd: number | string; paid_from: string; category: string | null;
  reason: string; payee: string | null; reference: string | null; media_path: string | null; by: string; at: string };
export type HubCash = { drawer: Native; bank: Native; movements: Movement[] };

const KIND_WORDS: Record<string, string> = { bank_deposit: "to the bank", petty_cash: "petty cash", expense: "expense" };
const formKey = (c: Ctx) => { const k = (c.form._key ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60); return k.length >= 8 ? `console:${k}` : null; };

/** Dollars and lira from a form: either may be empty, not both. */
export function amounts(c: Ctx): { usd: number; lbp: number } {
  const u = num(c, "usd", { min: 0, max: 1_000_000, optional: true }) ?? 0;
  const l = num(c, "lbp", { min: 0, max: 100_000_000_000, optional: true }) ?? 0;
  if (u <= 0 && l <= 0) throw new UserError("Type an amount in dollars or lira.");
  return { usd: u, lbp: l };
}

async function page(c: Ctx) {
  const since = beirutMidnight(c.deps.now()).toISOString();
  const v = await c.deps.db.rpc<HubCash>("hub_cash_view", { p_since: since });
  const links = await Promise.all(v.movements.map((m) => (m.media_path ? c.deps.media.sign(m.media_path, 300) : Promise.resolve(null))));
  return render(c, "Hub money", html`
<p>Drawer by the books: <strong>${usd(v.drawer.usd)} + ${lbp(v.drawer.lbp)}</strong> · bank: ${usd(v.bank.usd)} + ${lbp(v.bank.lbp)}</p>
<p class="muted">Count the drawer at day close; what is in it must match the books. Everything that leaves it is recorded here.</p>
<h2>Cash to the bank</h2>
${form(c.f, "/money/deposit", html`<p><label>Dollars <input type="number" name="usd" step="0.01" min="0"></label>
<label>Lira <input type="number" name="lbp" step="1000" min="0"></label>
<label>Slip number <input name="slip_ref" minlength="3" maxlength="60" required></label>
<label>Slip photo <input type="file" name="slip" accept="image/*,application/pdf"></label> <button>Record deposit</button></p>`, { files: true })}
<h2>Petty cash</h2>
${form(c.f, "/money/petty", html`<p><label>Dollars <input type="number" name="usd" step="0.01" min="0"></label>
<label>Lira <input type="number" name="lbp" step="1000" min="0"></label>
<label>For what <input name="reason" minlength="3" maxlength="200" required></label>
<label>Who spent it or was paid <input name="name" minlength="2" maxlength="80" required></label>
<label>Receipt photo <input type="file" name="receipt" accept="image/*,application/pdf"></label> <button>Record</button></p>`, { files: true })}
<h2>Today (${v.movements.length})</h2>
${v.movements.length === 0 ? html`<p class="muted">Nothing yet today.</p>` : html`<table><tr><th>When</th><th>What</th><th>Amount</th><th>From</th><th>Why</th><th>Who</th><th>By</th><th>Proof</th></tr>
${v.movements.map((m, i) => html`<tr><td>${when(m.at)}</td><td>${KIND_WORDS[m.kind] ?? m.kind}${m.category && m.kind === "expense" ? ` (${m.category})` : ""}</td>
<td>${Number(m.usd) ? usd(m.usd) : ""}${Number(m.usd) && Number(m.lbp) ? " + " : ""}${Number(m.lbp) ? lbp(m.lbp) : ""}</td><td>${m.paid_from === "bank" ? "bank" : "drawer"}</td>
<td>${m.reason}</td><td>${m.payee ?? ""}</td><td>${m.by}</td><td>${m.reference ?? ""}${links[i] ? html` <a href="${links[i]}" target="_blank" rel="noopener">photo</a>` : ""}</td></tr>`)}</table>`}`);
}

async function deposit(c: Ctx) {
  const a = amounts(c);
  const slip = text(c, "slip_ref", 60);
  if (slip.length < 3) throw new UserError("Type the slip number.");
  const path = await upload(c, "slip", "bank_slips");
  return act(c, "bank_deposit", { ...a, slip_ref: slip, photo: !!path }, async () => {
    const r = await c.deps.db.rpc<{ duplicate: boolean; drawer_usd: number | string; drawer_lbp: number | string }>("record_bank_deposit", {
      p_usd: a.usd, p_lbp: a.lbp, p_by: c.staff.partyId, p_slip_ref: slip, p_slip_path: path, p_key: formKey(c),
    });
    if (r.duplicate) return "That deposit was already recorded.";
    return `Deposit recorded. The drawer now holds ${usd(r.drawer_usd)} + ${lbp(r.drawer_lbp)} by the books.`;
  }, "/money");
}

async function petty(c: Ctx) {
  const a = amounts(c);
  const reason = text(c, "reason", 200);
  const name = text(c, "name", 80);
  if (reason.length < 3) throw new UserError("Write what it was for.");
  if (name.length < 2) throw new UserError("Write who spent it or was paid.");
  const path = await upload(c, "receipt", "receipts");
  return act(c, "petty_cash", { ...a, reason, name, photo: !!path }, async () => {
    const r = await c.deps.db.rpc<{ duplicate: boolean; drawer_usd: number | string; drawer_lbp: number | string }>("record_petty_cash", {
      p_usd: a.usd, p_lbp: a.lbp, p_reason: reason, p_name: name, p_by: c.staff.partyId, p_receipt_path: path, p_key: formKey(c),
    });
    if (r.duplicate) return "That was already recorded.";
    return `Petty cash recorded. The drawer now holds ${usd(r.drawer_usd)} + ${lbp(r.drawer_lbp)} by the books.`;
  }, "/money");
}

export const moneySection: Section = {
  nav: { href: "/money", label: "Hub money", roles: LEADS },
  routes: [
    { method: "GET", path: "/money", roles: LEADS, handler: page },
    { method: "POST", path: "/money/deposit", roles: LEADS, handler: deposit },
    { method: "POST", path: "/money/petty", roles: LEADS, handler: petty },
  ],
};
