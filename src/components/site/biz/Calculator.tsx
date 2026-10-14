import { useId, useState } from "react";
import { CALC_DEFAULTS, COMPETITOR_COMMISSION } from "@/lib/site-config";
import { fmt } from "@/lib/site";
import { useSite } from "../context";

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const toNum = (s: string) => {
  const n = Number(s.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? Math.min(n, 1_000_000) : 0;
};

/** The flat fee as shown ("$1", "$1.50"), or "" when the price list has none. */
export const feeLabel = (fee: number | null) =>
  fee != null ? `$${fee % 1 === 0 ? fee.toFixed(0) : fee.toFixed(2)}` : "";

/**
 * The savings calculator (DECISIONS §37.3.5, moved to the business side by §39.11), set like a receipt: the merchant types
 * monthly orders and the average ticket and sees the flat fee against a 22-30% commission, "calculated from your numbers".
 */
export function CalcCard({ id: anchor }: { id?: string }) {
  const { t, overview } = useSite();
  const m = t.home.merchants;
  const [orders, setOrders] = useState<string>(String(CALC_DEFAULTS.ordersPerMonth));
  const [ticket, setTicket] = useState<string>(String(CALC_DEFAULTS.averageTicketUsd));
  const id = useId();
  const fee = overview.order_fee_usd;
  const low = Math.round(COMPETITOR_COMMISSION.low * 100);
  const high = Math.round(COMPETITOR_COMMISSION.high * 100);
  const o = toNum(orders);
  const tk = toNum(ticket);
  const sales = o * tk;
  const alo = fee != null ? o * fee : null;
  const cLow = sales * COMPETITOR_COMMISSION.low;
  const cHigh = sales * COMPETITOR_COMMISSION.high;
  const keepMax = alo != null ? cHigh - alo : null;
  const feeText = feeLabel(fee);
  if (fee == null) return null;
  return (
    <div id={anchor} className="ak-receipt" role="group" aria-labelledby={`${id}-t`}>
      <h2 id={`${id}-t`} className="ak-h3">
        {m.calc.title}
      </h2>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="ak-receipt-field" htmlFor={`${id}-o`}>
          {m.calc.orders}
          <input
            id={`${id}-o`}
            inputMode="numeric"
            autoComplete="off"
            value={orders}
            onChange={(e) => setOrders(e.target.value)}
          />
        </label>
        <label className="ak-receipt-field" htmlFor={`${id}-k`}>
          {m.calc.ticket}
          <input
            id={`${id}-k`}
            inputMode="decimal"
            autoComplete="off"
            value={ticket}
            onChange={(e) => setTicket(e.target.value)}
          />
        </label>
      </div>
      <dl className="ak-receipt-lines" aria-live="polite">
        <div className="is-alo">
          <dt>{m.calc.withAlo}</dt>
          <dd className="ak-num">
            <bdi>{money(alo ?? 0)}</bdi>
          </dd>
        </div>
        {[low, high].map((p, i) => (
          <div key={p}>
            <dt>{fmt(m.calc.withCommission, { pct: p })}</dt>
            <dd className="ak-num">
              <bdi>{money(i === 0 ? cLow : cHigh)}</bdi>
            </dd>
          </div>
        ))}
        <div className="is-total">
          <dt>
            {m.calc.save} <span>{m.calc.perMonth}</span>
          </dt>
          <dd className="ak-num">
            <bdi>{money(Math.max(keepMax ?? 0, 0))}</bdi>
          </dd>
        </div>
      </dl>
      <p className="mt-4 text-sm font-semibold text-tone-ok">{m.calc.label}</p>
      <p className="mt-1 text-xs text-tone-mute">
        {fmt(m.calc.fineprint, { fee: feeText, low, high })}
      </p>
    </div>
  );
}
