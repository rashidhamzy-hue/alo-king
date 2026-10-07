import { ALLERGENS } from "@/lib/config";
import { ALLERGEN_LABEL } from "@/lib/vendor";
import { useL } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function AllergenPicker({
  value,
  onChange,
  tone = "neutral",
}: {
  value: string[];
  onChange: (v: string[]) => void;
  tone?: "neutral" | "avoid";
}) {
  const L = useL();
  const toggle = (a: string) =>
    onChange(value.includes(a) ? value.filter((x) => x !== a) : [...value, a]);
  return (
    <div className="flex flex-wrap gap-2" role="group">
      {ALLERGENS.map((a) => {
        const on = value.includes(a);
        const [en, ar] = ALLERGEN_LABEL[a]!;
        return (
          <button
            type="button"
            key={a}
            aria-pressed={on}
            onClick={() => toggle(a)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs transition",
              on
                ? tone === "avoid"
                  ? "border-destructive bg-destructive/15 text-destructive line-through"
                  : "border-gold bg-gold/15 text-gold"
                : "border-border text-muted-foreground hover:border-gold/50",
            )}
          >
            {L(en, ar)}
          </button>
        );
      })}
    </div>
  );
}
