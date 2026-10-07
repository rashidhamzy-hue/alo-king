import { useState } from "react";
import { Check, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useL } from "@/lib/i18n";

export type Proposal = {
  id: string;
  target: "profile" | "private" | "menu_item";
  item_id: string | null;
  fields: Record<string, unknown>;
  reason: string;
};

const show = (v: unknown) => {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "string") return v;
  return JSON.stringify(v, null, 1);
};

export function ProposalCard({
  proposal,
  current,
  title,
  onApply,
  onDismiss,
}: {
  proposal: Proposal;
  current: Record<string, unknown> | null | undefined;
  title?: string;
  onApply: () => Promise<void>;
  onDismiss: () => void;
}) {
  const L = useL();
  const [busy, setBusy] = useState(false);
  const label =
    proposal.target === "profile"
      ? L("Public profile", "الصفحة العامة")
      : proposal.target === "private"
        ? L("Private details", "معلومات خاصة")
        : title || L("Menu item", "صنف");
  return (
    <div className="rounded-xl border border-gold/30 bg-card p-4">
      <p className="flex items-center gap-2 text-xs uppercase tracking-wider text-gold">
        <Sparkles className="size-3.5" /> {L("Suggested change", "تعديل مقترح")} · {label}
      </p>
      <p className="mt-2 text-sm text-muted-foreground">{proposal.reason}</p>
      <div className="mt-3 space-y-2">
        {Object.entries(proposal.fields).map(([k, v]) => (
          <div key={k} className="rounded-lg bg-muted/40 p-2 text-xs">
            <p className="font-mono text-[11px] text-muted-foreground">{k}</p>
            <div className="mt-1 grid gap-2 sm:grid-cols-2">
              <div>
                <span className="text-[10px] uppercase text-muted-foreground">
                  {L("Current", "الحالي")}
                </span>
                <pre className="whitespace-pre-wrap break-words font-sans text-muted-foreground line-through decoration-destructive/50">
                  {show(current?.[k])}
                </pre>
              </div>
              <div>
                <span className="text-[10px] uppercase text-gold">{L("Proposed", "المقترح")}</span>
                <pre className="whitespace-pre-wrap break-words font-sans text-foreground">
                  {show(v)}
                </pre>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDismiss} disabled={busy}>
          <X /> {L("Dismiss", "تجاهل")}
        </Button>
        <Button
          size="sm"
          variant="gold"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onApply();
            } finally {
              setBusy(false);
            }
          }}
        >
          <Check /> {busy ? L("Applying…", "عم يطبّق…") : L("Apply", "طبّق")}
        </Button>
      </div>
    </div>
  );
}
