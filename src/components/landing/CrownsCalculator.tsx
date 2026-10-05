import { useMemo, useState } from "react";
import { Crown } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { usd } from "@/lib/format";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const TIERS = [
  { name: "Prince", min: 0, bonus: 0 },
  { name: "Duke", min: 500, bonus: 0.01 },
  { name: "King", min: 2000, bonus: 0.02 },
];
const tierFor = (lifetime: number) => [...TIERS].reverse().find((t) => lifetime >= t.min)!;

export function CrownsCalculator() {
  const { t } = useLang();
  const [orders, setOrders] = useState(8);
  const [basket, setBasket] = useState(15);

  const r = useMemo(() => {
    const spend = orders * basket;
    let lifetime = 0;
    let yearCrowns = 0;
    let monthsToKing: number | null = null;
    for (let m = 1; m <= 120; m++) {
      const earned = spend * (1 + tierFor(lifetime).bonus);
      lifetime += earned;
      if (m <= 12) yearCrowns += earned;
      if (monthsToKing === null && lifetime >= 2000) monthsToKing = m;
    }
    let lifetime12 = 0;
    for (let m = 1; m <= 12; m++) lifetime12 += spend * (1 + tierFor(lifetime12).bonus);
    return {
      perMonth: Math.floor(spend),
      cashbackYear: (Math.floor(yearCrowns / 100) * 5),
      tier: tierFor(lifetime12).name,
      monthsToKing,
    };
  }, [orders, basket]);

  return (
    <section id="crowns" className="border-t border-border bg-card/30">
      <div className="mx-auto max-w-6xl px-5 py-24">
        <p className="text-xs uppercase tracking-[0.3em] text-gold">Proposed program</p>
        <h2 className="mt-4 text-4xl font-semibold md:text-6xl">{t("crowns_title")}</h2>
        <p className="mt-4 max-w-xl text-muted-foreground">
          1 Crown per $1 spent. Every 100 Crowns returns $5 cashback. Climb the court for bonus Crowns.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          {TIERS.map((tier) => (
            <div key={tier.name} className={cn("lux-card px-5 py-3", r.tier === tier.name && "border-gold shadow-glow-gold")}>
              <p className="font-display text-xl font-semibold">{tier.name}</p>
              <p className="text-xs text-muted-foreground">
                {tier.min.toLocaleString()}+ Crowns{tier.bonus ? ` · +${tier.bonus * 100}% bonus` : ""}
              </p>
            </div>
          ))}
        </div>
        <div className="mt-10 grid gap-8 md:grid-cols-2">
          <div className="lux-card space-y-8 p-7">
            <Field label="Orders per month" value={`${orders}`}>
              <Slider min={1} max={40} step={1} value={[orders]} onValueChange={(v) => setOrders(v[0] ?? 1)} />
            </Field>
            <Field label="Average basket" value={usd(basket)}>
              <Slider min={5} max={80} step={1} value={[basket]} onValueChange={(v) => setBasket(v[0] ?? 5)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Stat label="Crowns / month" value={r.perMonth.toLocaleString()} />
            <Stat label="Cashback / year" value={usd(r.cashbackYear)} />
            <Stat label="Tier after 12 months" value={r.tier} />
            <Stat label="Months to King" value={r.monthsToKing ? `${r.monthsToKing}` : "10y+"} />
          </div>
        </div>
      </div>
    </section>
  );
}

function Field({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-4 flex justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold">{value}</span>
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="lux-card flex flex-col justify-between p-5">
      <Crown className="size-4 text-gold" />
      <p className="mt-6 font-display text-4xl font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
