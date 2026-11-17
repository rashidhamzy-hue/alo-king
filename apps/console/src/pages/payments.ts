// 3.3 Payments to confirm: the screenshot, the expected amount, the reference and amount the person types, confirm or reject.
// Writes only through review_payment_proof() and confirm_payment() (0018, 0052, 0106), which check the role, the reference and
// the amount and post the ledger. What the model read from a screenshot is shown as a hint only, never used as the figure.
// F1 (0106): a screenshot for an order the payment timer cancelled is a late payment: confirming it books the money as the
// customer's credit (accept_late_payment) and the order stays cancelled. A transfer more than 5% over the total waits for a
// second person on Approvals; a smaller surplus is the customer's credit, never company income.
import { act, html, id, num, render, text, UserError, type Ctx, type Section } from "../app";
import { DbError } from "../db";
import { form, usd, when } from "../html";
import { pick, type Lang } from "../i18n";
import { LEADS } from "../roles";
import { ACTIVE } from "./today";
import { moneyTabs } from "./moneyframe";
import { button, empty, icon, input } from "@ak/ui/components";

type Proof = { proof_id: string; order_id: string; short_code: string; expected_usd: number | string; method: string; media_path: string;
  reading: Record<string, unknown> | null; reused_image: boolean; received_at: string;
  late?: boolean; order_status?: string; approval_id?: string | null };
type Confirmed = { already?: string; duplicate?: boolean; status?: string; late?: boolean; approval_id?: string; over_pct?: number | string;
  credit_usd?: number | string; amount_usd?: number | string };

/** Plain words for the refusals only this page meets (the shared ones are in app.ts). */
async function plain<T>(p: Promise<T>): Promise<T> {
  try { return await p; }
  catch (e) {
    if (e instanceof DbError && /^NOT_A_LATE_PAYMENT/.test(e.message)) throw new UserError("This order was not cancelled by the payment timer: confirm it as a payment.");
    if (e instanceof DbError && /^ORDER_ALREADY_PAID/.test(e.message)) throw new UserError("This order is already paid; nothing changed.");
    throw e;
  }
}

/** What happened, in the words of the page. */
function outcome(L: Lang, r: Confirmed | null): string {
  if (r?.already) return pick(L, `Already ${r.already}; nothing changed.`, `سبق أن ${r.already}؛ لم يتغيّر شيء.`);
  if (r?.status === "awaiting_approval") {
    return pick(L, `The amount is ${Number(r.over_pct ?? 0).toFixed(1)}% over the order total: it waits for a second person on Approvals. Nothing is booked yet.`,
      `المبلغ يزيد ${Number(r.over_pct ?? 0).toFixed(1)}% عن مجموع الطلب: ينتظر شخصاً ثانياً في الموافقات. لم يُسجَّل شيء بعد.`);
  }
  if (r?.late) {
    return r.duplicate ? pick(L, "This late payment was already booked; nothing changed.", "سُجّلت هذه الدفعة المتأخرة من قبل؛ لم يتغيّر شيء.")
      : pick(L, `Late payment booked as the customer's credit (${usd(r.amount_usd ?? 0)}). The order stays cancelled; the credit comes off their next order or is paid out on Refunds.`,
          `سُجّلت الدفعة المتأخرة رصيداً للزبون (${usd(r.amount_usd ?? 0)}). يبقى الطلب ملغى؛ ويُخصم الرصيد من طلبه التالي أو يُدفع من صفحة المبالغ المستردة.`);
  }
  if (r?.duplicate) return pick(L, "This order was already paid; the screenshot is closed.", "هذا الطلب مدفوع من قبل؛ أُغلقت اللقطة.");
  const credit = Number(r?.credit_usd ?? 0);
  return credit > 0.004 ? pick(L, `Payment confirmed and booked. ${usd(credit)} over the total is the customer's credit.`, `تم تأكيد الدفعة وتسجيلها. ${usd(credit)} فوق المجموع رصيد للزبون.`)
    : pick(L, "Payment confirmed and booked.", "تم تأكيد الدفعة وتسجيلها.");
}

async function list(c: Ctx) {
  const { db, media } = c.deps;
  const L = c.lang;
  const proofs = (await db.rpc<Proof[]>("payment_proofs_open", {})) ?? [];
  const pictures = await Promise.all(proofs.map((p) => media.sign(p.media_path, 300)));
  const proofOrders = new Set(proofs.map((p) => p.order_id));
  const transfers = (await db.rows<{ id: string; short_code: string; total_usd: number | string; payment_method: string; status: string; created_at: string }>("orders", {
    select: "id,short_code,total_usd,payment_method,status,created_at", where: { payment_method: { in: ["whish", "omt"] }, status: { in: ACTIVE } }, order: [{ col: "created_at" }], limit: 200,
  })).filter((o) => !proofOrders.has(o.id));
  const paid = transfers.length ? new Set((await db.rows<{ order_id: string }>("payments", { select: "order_id", where: { order_id: { in: transfers.map((t) => t.id) }, status: "confirmed" } })).map((p) => p.order_id)) : new Set<string>();
  const waiting = transfers.filter((t) => !paid.has(t.id));

  return render(c, pick(L, "Payments to confirm", "دفعات للتأكيد"), html`${await moneyTabs(c, "confirm")}
<p class="muted">${pick(L, "Check the money in the Whish or OMT account first. Type the amount and the reference you see there, not what the screenshot says.", "تحقق من المبلغ في حساب Whish أو OMT أولاً. اكتب المبلغ والمرجع كما تراهما هناك، لا كما في اللقطة.")}</p>
<h2>${pick(L, "Screenshots", "اللقطات")} (${proofs.length})</h2>
${proofs.length === 0 ? empty({ title: pick(L, "None waiting.", "لا شيء ينتظر."), ok: true, icon: "check" }) : html`<div class="ak-cards">${proofs.map((p, i) => html`<article class="ak-card ak-approve-card">
<div class="ak-compare ak-compare--photo"><div class="ak-photo">${pictures[i] ? html`<a href="${pictures[i]}" target="_blank" rel="noopener"><img class="proof" src="${pictures[i]}" alt="${pick(L, "payment screenshot", "لقطة الدفع")}"></a>` : html`<p class="note">${pick(L, "Picture not available.", "الصورة غير متاحة.")}</p>`}</div>
<div><p><strong>${p.short_code}</strong> · ${p.method} · ${pick(L, "expected", "المتوقع")} <strong>${usd(p.expected_usd)}</strong> · ${pick(L, "received", "وصلت")} ${when(p.received_at)}</p>
${p.late ? html`<p class="note">${icon("alert")} <strong>${pick(L, "Late payment.", "دفعة متأخرة.")}</strong> ${pick(L, "The payment timer cancelled this order. If the money is in the account, confirm it: it becomes the customer's credit and the order stays cancelled.", "ألغى مؤقّت الدفع هذا الطلب. إن كان المال في الحساب فأكّده: يصبح رصيداً للزبون ويبقى الطلب ملغى.")}</p>` : ""}
${p.approval_id ? html`<p class="note">${icon("clock")} <strong>${pick(L, "Waiting for a second person", "بانتظار شخص ثانٍ")}</strong> ${pick(L, "on", "في")} <a href="/approve?tab=money">${pick(L, "Approvals", "الموافقات")}</a>: ${pick(L, "the amount is more than 5% over the total.", "المبلغ يزيد عن المجموع بأكثر من 5%.")}</p>` : ""}
${p.reused_image ? html`<p class="note">${icon("alert")} <strong>${pick(L, "This picture was sent before for another payment.", "أُرسلت هذه الصورة من قبل لدفعة أخرى.")}</strong> ${pick(L, "Check the account carefully.", "تحقق من الحساب بعناية.")}</p>` : ""}
${p.reading ? html`<p class="muted">${pick(L, "Read by the model (a hint, may be wrong):", "قرأها النموذج (تلميح قد يكون خاطئاً):")} ${readingText(p.reading)}</p>` : ""}</div></div>
${form(c.f, `/payments/proof/${p.proof_id}`, html`
<div class="ak-money-fields">${input({ name: "amount_usd", label: pick(L, "Amount received, USD", "المبلغ المستلم بالدولار"), type: "number", attrs: { step: "0.01", min: "0", inputmode: "decimal" } })}${input({ name: "reference", label: pick(L, "Reference", "المرجع"), maxlength: 60 })}${input({ name: "note", label: pick(L, "Note", "ملاحظة"), maxlength: 300 })}</div>
<div class="actions-row">${p.approval_id ? "" : button({ label: p.late ? pick(L, "Book as the customer's credit", "سجّلها رصيداً للزبون") : pick(L, "Confirm payment", "أكّد الدفعة"), variant: "gold", icon: "check", name: "decision", value: "confirm" })}${button({ label: pick(L, "Reject screenshot", "ارفض اللقطة"), variant: "danger", icon: "close", name: "decision", value: "reject" })}</div>`)}
</article>`)}</div>`}
<h2>${pick(L, "Transfers without a screenshot", "تحويلات بلا لقطة")} (${waiting.length})</h2>
${waiting.length === 0 ? empty({ title: pick(L, "None.", "لا شيء."), ok: true, icon: "check" }) : html`<div class="ak-table-wrap"><table class="ak-table"><caption class="ak-sr">${pick(L, "Transfers without a screenshot", "تحويلات بلا لقطة")}</caption><thead><tr><th scope="col">${pick(L, "Order", "الطلب")}</th><th scope="col">${pick(L, "Method", "الطريقة")}</th><th scope="col" class="num">${pick(L, "Total", "المجموع")}</th><th scope="col">${pick(L, "Status", "الحالة")}</th><th scope="col">${pick(L, "Since", "منذ")}</th><th scope="col">${pick(L, "Confirm, once the money is in the account", "أكّد بعد وصول المال إلى الحساب")}</th></tr></thead><tbody>
${waiting.map((o) => html`<tr><td>${o.short_code}</td><td>${o.payment_method}</td><td class="num">${usd(o.total_usd)}</td><td>${o.status}</td><td>${when(o.created_at)}</td>
<td>${form(c.f, `/payments/order/${o.id}`, html`<input class="ak-input" type="number" name="amount_usd" step="0.01" min="0" placeholder="${pick(L, "amount USD", "المبلغ بالدولار")}" aria-label="${pick(L, "amount USD", "المبلغ بالدولار")}">
<input class="ak-input" name="reference" minlength="4" maxlength="60" placeholder="${pick(L, "reference", "المرجع")}" aria-label="${pick(L, "reference", "المرجع")}"> ${button({ label: pick(L, "Confirm", "أكّد"), icon: "check" })}`, { cls: "inline" })}</td></tr>`)}</tbody></table></div>`}`, { translated: true });
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
    const r = await plain(c.deps.db.rpc<Confirmed>("review_payment_proof", {
      p_proof: proof, p_by: c.staff.partyId, p_accept: accept, p_external_ref: reference, p_amount_usd: amount, p_note: note,
    }));
    if (r?.already) return pick(c.lang, `Already ${r.already}; nothing changed.`, `سبق أن ${r.already}؛ لم يتغيّر شيء.`);
    return accept ? outcome(c.lang, r) : pick(c.lang, "Screenshot rejected. The customer still owes the transfer.", "رُفضت اللقطة. ما زال الزبون مديناً بالتحويل.");
  }, "/payments");
}

async function confirmOrder(c: Ctx) {
  const order = id(c, "order");
  const amount = num(c, "amount_usd", { min: 0 });
  const reference = text(c, "reference", 60);
  return act(c, "payment_confirm", { order, amount_usd: amount, reference }, async () => {
    const r = await plain(c.deps.db.rpc<Confirmed>("confirm_payment", { p_order: order, p_by: c.staff.partyId, p_external_ref: reference, p_amount_usd: amount }));
    if (r?.status === "awaiting_approval") return outcome(c.lang, r);
    return r?.duplicate ? pick(c.lang, "Already paid; nothing changed.", "مدفوع من قبل؛ لم يتغيّر شيء.") : outcome(c.lang, r);
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
