import { COD_CAP } from "@/lib/config";

export function CashGauge({ cash, pending = 0 }: { cash: number; pending?: number }) {
  const pct = Math.min(1, cash / COD_CAP);
  const after = Math.min(1, (cash + pending) / COD_CAP);
  const color = pct > 0.9 ? "var(--destructive)" : pct >= 0.6 ? "var(--warning)" : "var(--success)";
  const R = 80;
  const len = Math.PI * R;
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 110" className="w-56">
        <path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="var(--muted)" strokeWidth="14" strokeLinecap="round" />
        {pending > 0 && (
          <path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="var(--gold)" strokeOpacity="0.35" strokeWidth="14" strokeLinecap="round" strokeDasharray={`${after * len} ${len}`} />
        )}
        <path
          d="M20 100 A80 80 0 0 1 180 100"
          fill="none"
          stroke={color}
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={`${pct * len} ${len}`}
          style={{ transition: "stroke-dasharray 0.6s ease" }}
        />
      </svg>
      <p className="-mt-10 font-display text-3xl font-semibold">${cash.toFixed(2)}</p>
      <p className="text-xs text-muted-foreground">${cash.toFixed(0)} of ${COD_CAP} cash held</p>
    </div>
  );
}
