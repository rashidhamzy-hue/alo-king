// 3.3 Payments to confirm: the screenshot, the expected amount, the reference and amount the person types, confirm or reject.
// Writes only through review_payment_proof() and confirm_payment() (0018, 0052), which check the role, the reference and
// the amount and post the ledger. What the model read from a screenshot is shown as a hint only, never used as the figure.
import { act, html, id, num, render, text, UserError, type Ctx, type Section } from "../app";
import { form, usd, when } from "../html";
import { LEADS } from "../roles";
import { ACTIVE } from "./today";

type Proof = { proof_id: string; order_id: string; short_code: string; expected_usd: number | string; method: string; media_path: string;
  reading: Record<string, unknown> | null; reused_image: boolean; received_at: string };

async function list(c: Ctx) {
  const { db, media } = c.deps;
  const proofs = (await db.rpc<Proof[]>("payment_proofs_open", {})) ?? [];
  const pictures = await Promise.all(proofs.map((p) => media.sign(p.media_path, 300)));
  const proofOrders = new Set(proofs.map((p) => p.order_id));
  const transfers = (await db.rows<{ id: string; short_code: string; total_usd: number | string; payment_method: string; status: string; created_at: string }>("orders", {
    select: "id,short_code,total_usd,payment_method,status,created_at", where: { payment_method: { in: ["whish", "omt"] }, status: { in: ACTIVE } }, order: [{ col: "created_at" }], limit: 200,
  })).filter((o) => !proofOrders.has(o.id));
  const paid = transfers.length ? new Set((await db.rows<{ order_id: string }>("payments", { select: "order_id", where: { order_id: { in: transfers.map((t) => t.id) }, status: "confirmed" } })).map((p) => p.order_id)) : new Set<string>();
  const waiting = transfers.filter((t) => !paid.has(t.id));

  return render(c, "Payments to confirm", html`
<p class="muted">Check the money in the Whish or OMT account first. Type the amount and the reference you see there, not what the screenshot says.</p>
<h2>Screenshots (${proofs.length})</h2>
${proofs.length === 0 ? html`<p class="muted">None waiting.</p>` : proofs.map((p, i) => html`<div class="pair">
<div>${pictures[i] ? html`<a href="${pictures[i]}" target="_blank" rel="noopener"><img class="proof" src="${pictures[i]}" alt="payment screenshot"></a>` : html`<p class="warn">Picture not available.</p>`}</div>
<div><p><strong>${p.short_code}</strong> · ${p.method} · expected <strong>${usd(p.expected_usd)}</strong> · received ${when(p.received_at)}</p>
${p.reused_image ? html`<p class="warn"><strong>This picture was sent before for another payment.</strong> Check the account carefully.</p>` : ""}
${p.reading ? html`<p class="muted">Read by the model (a hint, may be wrong): ${readingText(p.reading)}</p>` : ""}
${form(c.f, `/payments/proof/${p.proof_id}`, html`
<p><label>Amount received, USD <input type="number" name="amount_usd" step="0.01" min="0"></label>
<label>Reference <input name="reference" minlength="4" maxlength="60"></label></p>
<p><label>Note <input name="note" maxlength="300"></label></p>
<p><button name="decision" value="confirm">Confirm payment</button> <button name="decision" value="reject">Reject screenshot</button></p>`)}
</div></div>`)}
<h2>Transfers without a screenshot (${waiting.length})</h2>
${waiting.length === 0 ? html`<p class="muted">None.</p>` : html`<table><tr><th>Order</th><th>Method</th><th>Total</th><th>Status</th><th>Since</th><th>Confirm, once the money is in the account</th></tr>
${waiting.map((o) => html`<tr><td>${o.short_code}</td><td>${o.payment_method}</td><td>${usd(o.total_usd)}</td><td>${o.status}</td><td>${when(o.created_at)}</td>
<td>${form(c.f, `/payments/order/${o.id}`, html`<input type="number" name="amount_usd" step="0.01" min="0" placeholder="amount USD">
<input name="reference" minlength="4" maxlength="60" placeholder="reference"> <button>Confirm</button>`, { cls: "inline" })}</td></tr>`)}</table>`}`);
}

function readingText(r: Record<string, unknown>) {
  const parts = ["amount", "currency", "reference", "datetime"].filter((k) => r[k] !== undefined && r[k] !== null).map((k) => `${k} ${String(r[k])}`);
  return parts.join(", ") || "nothing readable";
}

async function reviewProof(c: Ctx) {
  const proof = id(c, "proof");
  const decision = c.form.decision === "confirm" ? "confirm" : c.form.decision === "reject" ? "reject" : null;
  if (!decision) throw new UserError("Choose confirm or reject.");
  const accept = decision === "confirm";
  const amount = accept ? num(c, "amount_usd", { min: 0 }) : null;
  const reference = text(c, "reference", 60) || null;
  const note = text(c, "note", 300) || null;
  return act(c, accept ? "payment_proof_confirm" : "payment_proof_reject", { proof, amount_usd: amount, reference, note }, async () => {
    const r = await c.deps.db.rpc<{ already?: string; duplicate?: boolean; status?: string }>("review_payment_proof", {
      p_proof: proof, p_by: c.staff.partyId, p_accept: accept, p_external_ref: reference, p_amount_usd: amount, p_note: note,
    });
    if (r?.already) return `Already ${r.already}; nothing changed.`;
    return accept ? (r?.duplicate ? "This order was already paid; the screenshot is closed." : "Payment confirmed and booked.") : "Screenshot rejected. The customer still owes the transfer.";
  }, "/payments");
}

async function confirmOrder(c: Ctx) {
  const order = id(c, "order");
  const amount = num(c, "amount_usd", { min: 0 });
  const reference = text(c, "reference", 60);
  return act(c, "payment_confirm", { order, amount_usd: amount, reference }, async () => {
    const r = await c.deps.db.rpc<{ duplicate?: boolean }>("confirm_payment", { p_order: order, p_by: c.staff.partyId, p_external_ref: reference, p_amount_usd: amount });
    return r?.duplicate ? "Already paid; nothing changed." : "Payment confirmed and booked.";
  }, "/payments");
}

export const paymentsSection: Section = {
  nav: { href: "/payments", label: "Payments", roles: LEADS },
  routes: [
    { method: "GET", path: "/payments", roles: LEADS, handler: list },
    { method: "POST", path: "/payments/proof/:proof", roles: LEADS, handler: reviewProof },
    { method: "POST", path: "/payments/order/:order", roles: LEADS, handler: confirmOrder },
  ],
};
