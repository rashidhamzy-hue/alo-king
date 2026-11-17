// 3.15 Petty cash and bank deposits, 3.12 expenses: money out of the hub drawer (or the bank), each one ledger movement made by
// a SQL function (0047) with who, why and, where there is one, the slip or receipt photo in the private media bucket.
// The drawer must match the count at day close (3.11); these are the movements that explain the difference between the cash
// the riders brought in and the cash in the drawer.
import { act, html, num, render, text, upload, UserError, type Ctx, type Section } from "../app";
import type { Raw } from "../html";
import { form, lbp, usd, when } from "../html";
import { pick } from "../i18n";
import { LEADS } from "../roles";
import { beirutMidnight } from "./today";
import { moneyCounts, moneyTabs } from "./moneyframe";
import type { DayReport } from "./dayclose";
import { button, empty, icon, input, kpis, kpiTile, tileLink } from "@ak/ui/components";

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

const KIND_AR: Record<string, string> = { bank_deposit: "إلى البنك", petty_cash: "نثرية", expense: "مصروف" };

/** The ledger: the drawer and the bank by the books, today's takings by method, and the day's movements, with the three ways cash leaves the drawer. */
async function page(c: Ctx) {
  const L = c.lang;
  const since = beirutMidnight(c.deps.now()).toISOString();
  const v = await c.deps.db.rpc<HubCash>("hub_cash_view", { p_since: since });
  const cats = ((await c.deps.db.rpc<{ categories?: string[] } | null>("setting", { p_key: "hub_expenses" }))?.categories ?? ["other"]).filter((x) => x !== "petty_cash");
  const links = await Promise.all(v.movements.map((m) => (m.media_path ? c.deps.media.sign(m.media_path, 300) : Promise.resolve(null))));
  const report = await c.deps.db.rpc<DayReport | null>("day_close_report", {}).catch(() => null);
  const counts = await moneyCounts(c);
  const takings = Object.entries(report?.payments ?? {});
  const amountCell = (m: Movement) => `${Number(m.usd) ? usd(m.usd) : ""}${Number(m.usd) && Number(m.lbp) ? " + " : ""}${Number(m.lbp) ? lbp(m.lbp) : ""}`;
  const fields = (extra: Raw = html``) => html`<div class="ak-money-fields">${input({ name: "usd", label: pick(L, "Dollars", "دولار"), type: "number", attrs: { step: "0.01", min: "0", inputmode: "decimal" } })}${input({ name: "lbp", label: pick(L, "Lira", "ليرة"), type: "number", attrs: { step: "1000", min: "0", inputmode: "numeric" } })}${extra}</div>`;
  return render(c, pick(L, "Money", "المال"), html`${await moneyTabs(c, "ledger")}
${kpis([
    kpiTile({ label: pick(L, "The drawer, by the books", "الصندوق بحسب الدفاتر"), value: usd(v.drawer.usd), note: `+ ${lbp(v.drawer.lbp)}` }),
    kpiTile({ label: pick(L, "The bank", "البنك"), value: usd(v.bank.usd), note: `+ ${lbp(v.bank.lbp)}` }),
    tileLink({ label: pick(L, "To confirm", "للتأكيد"), value: String(counts.confirm), href: "/payments", icon: "money", state: counts.confirm > 0 ? "warn" : "ok", stateWord: pick(L, "transfers to check", "تحويلات للتحقق") }),
    tileLink({ label: pick(L, "Cash drops", "تسليم النقد"), value: String(counts.drops), href: "/money/drops", icon: "wallet", state: counts.drops > 0 ? "warn" : "ok", stateWord: pick(L, "to count with a rider", "للعدّ مع مندوب") })])}
<p>${pick(L, "Drawer by the books: ", "الصندوق بحسب الدفاتر: ")}<strong>${usd(v.drawer.usd)} + ${lbp(v.drawer.lbp)}</strong> · ${pick(L, "bank:", "البنك:")} ${usd(v.bank.usd)} + ${lbp(v.bank.lbp)}</p>
<p class="muted">${pick(L, "Count the drawer at day close; what is in it must match the books. Everything that leaves it is recorded here.", "اعدّ الصندوق عند إغلاق اليوم؛ ما فيه يجب أن يطابق الدفاتر. كل ما يخرج منه يُسجَّل هنا.")}</p>
${takings.length ? html`<h2>${pick(L, "Today's takings by method", "مقبوضات اليوم حسب الطريقة")}</h2><ul class="ak-rows">${takings.map(([m, x]) => html`<li><div class="head"><strong>${m.replace(/_/g, " ")}</strong><span><bdi>${usd(x.usd)}</bdi> <span class="muted">(${Number(x.count)})</span></span></div></li>`)}</ul>` : ""}
<h2>${pick(L, `Today (${v.movements.length})`, `اليوم (${v.movements.length})`)}</h2>
${v.movements.length === 0 ? empty({ title: pick(L, "Nothing yet today.", "لا شيء بعد اليوم."), icon: "wallet" }) : html`<div class="ak-table-wrap"><table class="ak-table"><caption class="ak-sr">${pick(L, "The day's cash movements", "حركات النقد اليوم")}</caption><thead><tr><th scope="col">${pick(L, "When", "الوقت")}</th><th scope="col">${pick(L, "What", "ماذا")}</th><th scope="col" class="num">${pick(L, "Amount", "المبلغ")}</th><th scope="col">${pick(L, "From", "من")}</th><th scope="col">${pick(L, "Why", "السبب")}</th><th scope="col">${pick(L, "Who", "لمن")}</th><th scope="col">${pick(L, "By", "بواسطة")}</th><th scope="col">${pick(L, "Proof", "الإثبات")}</th></tr></thead><tbody>
${v.movements.map((m, i) => html`<tr><td>${when(m.at)}</td><td>${L === "ar" ? KIND_AR[m.kind] ?? m.kind : KIND_WORDS[m.kind] ?? m.kind}${m.category && m.kind === "expense" ? ` (${m.category})` : ""}</td>
<td class="num">${amountCell(m)}</td><td>${m.paid_from === "bank" ? pick(L, "bank", "البنك") : pick(L, "drawer", "الصندوق")}</td>
<td class="wrap">${m.reason}</td><td>${m.payee ?? ""}</td><td>${m.by}</td><td>${m.reference ?? ""}${links[i] ? html` <a href="${links[i]}" target="_blank" rel="noopener">${pick(L, "photo", "صورة")}</a>` : ""}</td></tr>`)}</tbody></table></div>`}
<h2>${pick(L, "Cash out of the drawer", "نقد يخرج من الصندوق")}</h2>
<details class="ak-more" id="deposit"><summary>${icon("coins")} ${pick(L, "Cash to the bank", "نقد إلى البنك")}</summary>
${form(c.f, "/money/deposit", html`${fields(html`${input({ name: "slip_ref", label: pick(L, "Slip number", "رقم الإيصال"), required: true, maxlength: 60, attrs: { minlength: "3" } })}<label class="ak-field"><span>${pick(L, "Slip photo", "صورة الإيصال")}</span><input class="ak-input" type="file" name="slip" accept="image/*,application/pdf"></label>`)}
<div class="actions-row">${button({ label: pick(L, "Record deposit", "سجّل الإيداع"), icon: "check" })}</div>`, { files: true })}</details>
<details class="ak-more" id="petty"><summary>${icon("wallet")} ${pick(L, "Petty cash", "النثرية")}</summary>
${form(c.f, "/money/petty", html`${fields(html`${input({ name: "reason", label: pick(L, "For what", "لأي غرض"), required: true, maxlength: 200, attrs: { minlength: "3" } })}${input({ name: "name", label: pick(L, "Who spent it or was paid", "من أنفقها أو دُفعت له"), required: true, maxlength: 80, attrs: { minlength: "2" } })}<label class="ak-field"><span>${pick(L, "Receipt photo", "صورة الإيصال")}</span><input class="ak-input" type="file" name="receipt" accept="image/*,application/pdf"></label>`)}
<div class="actions-row">${button({ label: pick(L, "Record", "سجّل"), icon: "check" })}</div>`, { files: true })}</details>
<details class="ak-more" id="expense"><summary>${icon("coins")} ${pick(L, "Expense", "مصروف")}</summary>
${form(c.f, "/money/expense", html`${fields(html`<label class="ak-field"><span>${pick(L, "Paid from", "دُفع من")}</span><select class="ak-select" name="paid_from"><option value="hub_cash">${pick(L, "the drawer", "الصندوق")}</option><option value="bank">${pick(L, "the bank", "البنك")}</option></select></label>
<label class="ak-field"><span>${pick(L, "Category", "الفئة")}</span><select class="ak-select" name="category">${cats.map((x) => html`<option>${x}</option>`)}</select></label>
${input({ name: "reason", label: pick(L, "For what", "لأي غرض"), required: true, maxlength: 200, attrs: { minlength: "3" } })}${input({ name: "payee", label: pick(L, "Paid to", "دُفع إلى"), maxlength: 80 })}${input({ name: "reference", label: pick(L, "Invoice or receipt number", "رقم الفاتورة أو الإيصال"), maxlength: 60 })}
<label class="ak-field"><span>${pick(L, "Receipt photo", "صورة الإيصال")}</span><input class="ak-input" type="file" name="receipt" accept="image/*,application/pdf"></label>`)}
<div class="actions-row">${button({ label: pick(L, "Record expense", "سجّل المصروف"), icon: "check" })}</div>`, { files: true })}</details>`, { translated: true });
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

async function expense(c: Ctx) {
  const a = amounts(c);
  const from = c.form.paid_from === "bank" ? "bank" : c.form.paid_from === "hub_cash" ? "hub_cash" : null;
  if (!from) throw new UserError("Pick where it was paid from.");
  const category = (c.form.category ?? "").trim().slice(0, 40);
  const reason = text(c, "reason", 200);
  if (reason.length < 3) throw new UserError("Write what it was for.");
  const payee = text(c, "payee", 80) || null;
  const reference = text(c, "reference", 60) || null;
  const path = await upload(c, "receipt", "receipts");
  return act(c, "expense", { ...a, paid_from: from, category, reason, payee, reference, photo: !!path }, async () => {
    const r = await c.deps.db.rpc<{ duplicate: boolean; drawer_usd: number | string; drawer_lbp: number | string }>("record_expense", {
      p_category: category, p_usd: a.usd, p_lbp: a.lbp, p_paid_from: from, p_reason: reason, p_payee: payee, p_by: c.staff.partyId,
      p_reference: reference, p_receipt_path: path, p_key: formKey(c),
    });
    if (r.duplicate) return "That expense was already recorded.";
    return `Expense recorded (${category}, from ${from === "bank" ? "the bank" : "the drawer"}).`;
  }, "/money");
}

export const moneySection: Section = {
  nav: { href: "/money", label: "Money", roles: LEADS },
  routes: [
    { method: "GET", path: "/money", roles: LEADS, handler: page },
    { method: "POST", path: "/money/deposit", roles: LEADS, handler: deposit },
    { method: "POST", path: "/money/petty", roles: LEADS, handler: petty },
    { method: "POST", path: "/money/expense", roles: LEADS, handler: expense },
  ],
};
