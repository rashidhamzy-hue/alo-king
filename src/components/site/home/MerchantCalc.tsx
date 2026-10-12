import { useId, useState } from "react";
import { CALC_DEFAULTS, COMPETITOR_COMMISSION } from "@/lib/site-config";
import { fmt } from "@/lib/site";
import { useSite } from "../context";

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const toNum = (s: string) => {
  const n = Number(s.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? Math.min(n, 1_000_000) : 0;
};

/** "{fee} per order. Not {pct}%." and the savings calculator (DECISIONS §37.3.5), labelled "calculated from your numbers". */
export function MerchantCalc() {
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
  const feeText = fee != null ? `$${fee % 1 === 0 ? fee.toFixed(0) : fee.toFixed(2)}` : "";
  const days = overview.order_fee_free_days;

  return (
    <section id="merchants" className="tone-cream ak-section" aria-labelledby="merch-title">
      <div className="ak-container grid items-start gap-12 lg:grid-cols-[1fr_1.05fr]">
        <div>
          <p className="ak-eyebrow">{m.eyebrow}</p>
          <h2 id="merch-title" className="ak-display mt-3 !text-[clamp(2.2rem,1rem+4.6vw,4.2rem)]">
            {fee != null ? fmt(m.title, { fee: feeText, pct: high }) : fmt(m.title.replace("{fee} ", ""), { pct: high })}
          </h2>
          <p className="ak-lead mt-5">{days != null ? fmt(m.sub, { days }) : m.subNoFree}</p>
          <a href="/for-business" className="ak-btn ak-btn-ink ak-btn-lg mt-8">
            {m.cta}
          </a>
          <p className="mt-3 text-sm text-tone-mute">{m.ctaNote}</p>
        </div>

        {fee != null && (
          <div className="ak-card p-6 sm:p-8" role="group" aria-labelledby={`${id}-t`}>
            <h3 id={`${id}-t`} className="ak-h3">
              {m.calc.title}
            </h3>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-semibold" htmlFor={`${id}-o`}>
                {m.calc.orders}
                <input
                  id={`${id}-o`}
                  inputMode="numeric"
                  autoComplete="off"
                  value={orders}
                  onChange={(e) => setOrders(e.target.value)}
                  className="mt-1.5 block h-12 w-full rounded-xl border border-tone-line bg-cream px-4 text-lg font-bold text-ink"
                />
              </label>
              <label className="block text-sm font-semibold" htmlFor={`${id}-k`}>
                {m.calc.ticket}
                <input
                  id={`${id}-k`}
                  inputMode="decimal"
                  autoComplete="off"
                  value={ticket}
                  onChange={(e) => setTicket(e.target.value)}
                  className="mt-1.5 block h-12 w-full rounded-xl border border-tone-line bg-cream px-4 text-lg font-bold text-ink"
                />
              </label>
            </div>

            <dl className="mt-6 divide-y divide-[var(--tone-line-soft)]" aria-live="polite">
              <div className="flex items-baseline justify-between gap-4 py-3">
                <dt className="font-semibold">{m.calc.withAlo}</dt>
                <dd className="ak-num rounded-lg bg-gold px-3 py-1 text-xl font-extrabold text-ink">
                  <bdi>{money(alo ?? 0)}</bdi>
                </dd>
              </div>
              {[low, high].map((p, i) => (
                <div key={p} className="flex items-baseline justify-between gap-4 py-3 text-tone-mute">
                  <dt>{fmt(m.calc.withCommission, { pct: p })}</dt>
                  <dd className="ak-num text-lg font-bold text-tone-fg">
                    <bdi>{money(i === 0 ? cLow : cHigh)}</bdi>
                  </dd>
                </div>
              ))}
              <div className="flex items-baseline justify-between gap-4 py-3">
                <dt className="font-bold">
                  {m.calc.save} <span className="font-medium text-tone-mute">{m.calc.perMonth}</span>
                </dt>
                <dd className="ak-num text-xl font-extrabold">
                  <bdi>{money(Math.max(keepMax ?? 0, 0))}</bdi>
                </dd>
              </div>
            </dl>
            <p className="mt-2 text-sm font-semibold text-tone-ok">{m.calc.label}</p>
            <p className="mt-1 text-xs text-tone-mute">{fmt(m.calc.fineprint, { fee: feeText, low, high })}</p>
          </div>
        )}
      </div>
    </section>
  );
}
