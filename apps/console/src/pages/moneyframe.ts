// UX2b: the frame Money's pages share (the reference's `/ops/money`). Four places, one tab bar with what is waiting on each:
//   Ledger (/money: the drawer, the bank and the day's movements)   To confirm (/payments: Whish and OMT transfers, with the customer's screenshot)
//   Cash drops (/money/drops: what each rider hands in)             Refunds (/refunds: refunds and credit)
// Money moves only through the functions each page already calls (confirm_payment, review_payment_proof, confirm_cash_drop, refund_order, record_*):
// the frame only shows where to go and how many are waiting. Exchange rate and the day's open and close are one link away.
import { html, type Ctx } from "../app";
import type { Raw } from "../html";
import { pick } from "../i18n";
import { tabs } from "@ak/ui/components";

export type MoneyTab = "ledger" | "confirm" | "drops" | "refunds";

/** What is waiting, per tab. A database that lags behind (a missing function) costs that one number, never the page. */
export async function moneyCounts(c: Ctx): Promise<{ confirm: number; drops: number; approvals: number }> {
  const quiet = async (f: () => Promise<number>) => { try { return await f(); } catch { return 0; } };
  const { db } = c.deps;
  const [confirm, drops, approvals] = await Promise.all([
    quiet(async () => ((await db.rpc<unknown[] | null>("payment_proofs_open", {})) ?? []).length),
    quiet(async () => (await db.rows<{ id: string }>("cash_drops", { select: "id", where: { status: "declared" }, limit: 200 })).length),
    quiet(async () => (await db.rows<{ id: string }>("pending_approvals", { select: "id", where: { status: "pending" }, limit: 200 })).length),
  ]);
  return { confirm, drops, approvals };
}

export async function moneyTabs(c: Ctx, current: MoneyTab | null): Promise<Raw> {
  const L = c.lang;
  const n = await moneyCounts(c);
  const items: { id: MoneyTab; label: string; href: string; count: number }[] = [
    { id: "ledger", label: pick(L, "Ledger", "السجل"), href: "/money", count: 0 },
    { id: "confirm", label: pick(L, "To confirm", "للتأكيد"), href: "/payments", count: n.confirm },
    { id: "drops", label: pick(L, "Cash drops", "تسليم النقد"), href: "/money/drops", count: n.drops },
    { id: "refunds", label: pick(L, "Refunds", "المبالغ المستردة"), href: "/refunds", count: 0 },
  ];
  return html`${tabs(items.map((x) => ({ label: x.label, href: x.href, current: x.id === current, count: x.count || undefined })), pick(L, "Money", "المال"))}
<p class="muted ak-more-links">${pick(L, "Also:", "أيضاً:")} <a href="/fx">${pick(L, "Exchange rate", "سعر الصرف")}</a> · <a href="/day-open">${pick(L, "Day open", "فتح اليوم")}</a> · <a href="/day-close">${pick(L, "Day close", "إغلاق اليوم")}</a>${n.approvals > 0 ? html` · <a href="/approve?tab=money">${pick(L, `${n.approvals} waiting for a second person`, `${n.approvals} بانتظار شخص ثانٍ`)}</a>` : ""}</p>`;
}
