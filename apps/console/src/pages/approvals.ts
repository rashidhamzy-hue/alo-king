// 3.13 Second approval: price changes above settings.approvals.price_change_pct and refunds above settings.approvals.refund_usd
// wait in pending_approvals (0046). Another ops lead or admin approves (decide_approval runs the change as it was asked, in the
// asker's name) or rejects it. The database refuses an approval by the person who asked.
import { act, html, render, text, UserError, UUID, type Ctx, type Section } from "../app";
import { form, when } from "../html";
import { LEADS } from "../roles";

type Approval = { id: string; kind: string; summary: string; requested_by: string; requested_at: string; status: string; decided_by: string | null; decided_at: string | null; note: string | null };

async function page(c: Ctx) {
  const { db } = c.deps;
  const [pending, decided, limits] = await Promise.all([
    db.rows<Approval>("pending_approvals", { where: { status: "pending" }, order: [{ col: "requested_at" }], limit: 100 }),
    db.rows<Approval>("pending_approvals", { where: { status: { not: "pending" } }, order: [{ col: "decided_at", desc: true }], limit: 15 }),
    db.rpc<{ price_change_pct?: number; refund_usd?: number } | null>("setting", { p_key: "approvals" }),
  ]);
  const ids = [...new Set([...pending, ...decided].flatMap((a) => [a.requested_by, a.decided_by]).filter(Boolean) as string[])];
  const people = ids.length ? await db.rows<{ id: string; display_name: string | null }>("parties", { select: "id,display_name", where: { id: { in: ids } } }) : [];
  const who = (id: string | null) => (id ? people.find((p) => p.id === id)?.display_name ?? "Staff" : "");
  return render(c, "Approvals", html`
<p class="muted">A price change of more than ${limits?.price_change_pct ?? 10}% and a refund above $${limits?.refund_usd ?? 20} need a second person.</p>
<h2>Waiting (${pending.length})</h2>
${pending.length === 0 ? html`<p class="muted">Nothing waiting.</p>` : html`<table><tr><th>What</th><th>Asked by</th><th>When</th><th></th></tr>
${pending.map((a) => html`<tr><td>${a.kind === "price" ? "Price" : "Refund"}: ${a.summary}</td><td>${who(a.requested_by)}</td><td>${when(a.requested_at)}</td>
<td>${a.requested_by === c.staff.partyId ? html`<span class="muted">waiting for someone else</span>` : form(c.f, `/approvals/${a.id}/approve`, html`<button>Approve</button>`, { cls: "inline" })}
${form(c.f, `/approvals/${a.id}/reject`, html`<input name="note" placeholder="why" maxlength="200"> <button>${a.requested_by === c.staff.partyId ? "Withdraw" : "Reject"}</button>`, { cls: "inline" })}</td></tr>`)}</table>`}
<h2>Decided</h2>
${decided.length === 0 ? html`<p class="muted">None yet.</p>` : html`<table><tr><th>What</th><th>Asked by</th><th>Decision</th><th>By</th><th>When</th></tr>
${decided.map((a) => html`<tr><td>${a.summary}</td><td>${who(a.requested_by)}</td><td>${a.status}${a.note ? `: ${a.note}` : ""}</td><td>${who(a.decided_by)}</td><td>${when(a.decided_at)}</td></tr>`)}</table>`}`);
}

async function decide(c: Ctx) {
  const id = c.params.id ?? "";
  if (!UUID.test(id)) throw new UserError("That record is not valid.");
  const approve = c.params.decision === "approve" ? true : c.params.decision === "reject" ? false : null;
  if (approve === null) throw new UserError("Unknown decision.");
  const note = text(c, "note", 200) || null;
  return act(c, approve ? "approval_approve" : "approval_reject", { approval: id }, async () => {
    const r = await c.deps.db.rpc<{ already: string | null; status: string }>("decide_approval", { p_id: id, p_by: c.staff.partyId, p_approve: approve, p_note: note });
    if (r.already) return `Already ${r.already}.`;
    return approve ? "Approved: the change is made." : "Rejected: nothing changes.";
  }, "/approvals");
}

export const approvalsSection: Section = {
  nav: { href: "/approvals", label: "Approvals", roles: LEADS },
  routes: [
    { method: "GET", path: "/approvals", roles: LEADS, handler: page },
    { method: "POST", path: "/approvals/:id/:decision", roles: LEADS, handler: decide },
  ],
};
