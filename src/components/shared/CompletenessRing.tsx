import { cn } from "@/lib/utils";

export function CompletenessRing({
  value,
  size = 140,
  label,
  className,
}: {
  value: number;
  size?: number;
  label?: string;
  className?: string;
}) {
  const v = Math.max(0, Math.min(100, Math.round(value || 0)));
  const r = size / 2 - 10;
  const c = 2 * Math.PI * r;
  const tone = v >= 80 ? "text-success" : v >= 50 ? "text-gold" : "text-destructive";
  return (
    <div
      className={cn("relative inline-grid place-items-center", className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${label ?? "Score"} ${v}%`}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={10}
          className="fill-none stroke-muted"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={10}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (v / 100) * c}
          className={cn("fill-none stroke-current transition-all duration-700", tone)}
        />
      </svg>
      <div className="absolute text-center">
        <div className="font-display text-3xl font-semibold">{v}%</div>
        {label && <div className="text-[11px] text-muted-foreground">{label}</div>}
      </div>
    </div>
  );
}
