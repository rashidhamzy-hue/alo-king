import { useState } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";

export function TagInput({
  value,
  onChange,
  placeholder,
  suggestions = [],
  id,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  suggestions?: string[];
  /** Set by the label around it, so the field is announced by name. */
  id?: string;
}) {
  const [draft, setDraft] = useState("");
  const add = (t: string) => {
    const s = t.trim();
    if (s && !value.includes(s)) onChange([...value, s]);
    setDraft("");
  };
  const sugg = suggestions
    .filter((s) => !value.includes(s) && (!draft || s.toLowerCase().includes(draft.toLowerCase())))
    .slice(0, 10);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {value.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 rounded-full bg-secondary/60 px-2.5 py-1 text-xs"
          >
            {t}
            <button
              type="button"
              aria-label={`Remove ${t}`}
              onClick={() => onChange(value.filter((x) => x !== t))}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
      </div>
      <Input
        id={id}
        aria-label={id ? undefined : placeholder}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add(draft);
          } else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => draft && add(draft)}
      />
      {sugg.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {sugg.map((s) => (
            <button
              type="button"
              key={s}
              onClick={() => add(s)}
              className="rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-muted-foreground hover:border-gold hover:text-gold"
            >
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
