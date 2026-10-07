import { Copy, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { DAYS, DAY_LABEL, type Hours } from "@/lib/vendor";
import { useL } from "@/lib/i18n";

export function HoursEditor({ value, onChange }: { value: Hours; onChange: (h: Hours) => void }) {
  const L = useL();
  const set = (d: (typeof DAYS)[number], ranges: [string, string][]) =>
    onChange({ ...value, [d]: ranges });
  return (
    <div className="space-y-3">
      {DAYS.map((d) => {
        const ranges = value[d] ?? [];
        const open = ranges.length > 0;
        return (
          <div
            key={d}
            className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-start"
          >
            <div className="flex w-40 items-center gap-3">
              <Switch
                checked={open}
                onCheckedChange={(on) => set(d, on ? [["09:00", "22:00"]] : [])}
                aria-label={`${DAY_LABEL[d][0]} open`}
              />
              <span className="text-sm font-medium">{L(...DAY_LABEL[d])}</span>
            </div>
            <div className="flex-1 space-y-2">
              {!open && (
                <p className="py-1.5 text-sm text-muted-foreground">{L("Closed", "مسكّر")}</p>
              )}
              {ranges.map((r, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    type="time"
                    value={r[0]}
                    className="w-32"
                    onChange={(e) =>
                      set(
                        d,
                        ranges.map((x, j) => (j === i ? [e.target.value, x[1]] : x)),
                      )
                    }
                  />
                  <span className="text-muted-foreground">–</span>
                  <Input
                    type="time"
                    value={r[1]}
                    className="w-32"
                    onChange={(e) =>
                      set(
                        d,
                        ranges.map((x, j) => (j === i ? [x[0], e.target.value] : x)),
                      )
                    }
                  />
                  {r[1] <= r[0] && (
                    <span className="text-xs text-muted-foreground">
                      {L("next day", "اليوم التالي")}
                    </span>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Remove range"
                    onClick={() =>
                      set(
                        d,
                        ranges.filter((_, j) => j !== i),
                      )
                    }
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </div>
            <div className="flex gap-1">
              {open && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => set(d, [...ranges, ["17:00", "23:00"]])}
                >
                  <Plus /> {L("Range", "فترة")}
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  onChange(
                    Object.fromEntries(
                      DAYS.map((k) => [k, ranges.map((r) => [...r] as [string, string])]),
                    ) as Hours,
                  )
                }
              >
                <Copy /> {L("Copy to all", "نسخ للكل")}
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
