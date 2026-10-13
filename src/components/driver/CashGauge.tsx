// The cash limit comes from the server when the rebuilt driver app arrives (session 8); until then there is no gauge, only the amount.
export function CashGauge({
  cash,
  pending = 0,
  cap = null,
}: {
  cash: number;
  pending?: number;
  cap?: number | null;
}) {
  if (!cap) return <p className="text-center text-2xl font-extrabold">${cash.toFixed(0)}</p>;
  const pct = Math.min(1, cash / cap);
  const after = Math.min(1, (cash + pending) / cap);
  const color = pct > 0.9 ? "var(--destructive)" : pct >= 0.6 ? "var(--warning)" : "var(--success)";
  const R = 80;
  const len = Math.PI * R;
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 110" className="w-56">
        <path
          d="M20 100 A80 80 0 0 1 180 100"
          fill="none"
          stroke="var(--muted)"
          strokeWidth="14"
          strokeLinecap="round"
        />
        {pending > 0 && (
          <path
            d="M20 100 A80 80 0 0 1 180 100"
            fill="none"
            stroke="var(--gold)"
            strokeOpacity="0.35"
            strokeWidth="14"
            strokeLinecap="round"
            strokeDasharray={`${after * len} ${len}`}
          />
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
      <p className="text-xs text-muted-foreground">
        ${cash.toFixed(0)} of ${cap} cash held
      </p>
    </div>
  );
}
