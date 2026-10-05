import { useState } from "react";
import { ChevronDown, MapPin, StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ageLabel, isCOD, lbp, usd } from "@/lib/format";
import type { Order } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  order: Order;
  now: number;
  flashing: boolean;
  onAccept: (mins: number) => void;
  onReject: (reason: string) => void;
  onReady: () => void;
  busy: boolean;
};

export function KitchenOrderCard({ order: o, now, flashing, onAccept, onReject, onReady, busy }: Props) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const demo = (o.notes ?? "").trim().toUpperCase().startsWith("DEMO");

  return (
    <article className={cn("lux-card p-5", flashing && "animate-gold-flash")}>
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-display text-3xl font-semibold">#{o.short_code ?? o.id.slice(0, 6)}</span>
          {demo && <span className="rounded bg-gold px-2 py-0.5 text-xs font-bold text-gold-foreground">DEMO</span>}
        </div>
        <span className="font-mono text-lg text-muted-foreground">{ageLabel(o.created_at, now)}</span>
      </header>
      <ul className="mt-4 space-y-1.5 text-lg">
        {(o.items ?? []).map((it, i) => (
          <li key={i} className="flex justify-between gap-3">
            <span><span className="font-semibold text-gold">{it.quantity}×</span> {it.name_en}</span>
            {it.name_ar && <span dir="rtl" className="font-arabic text-sm text-muted-foreground">{it.name_ar}</span>}
          </li>
        ))}
      </ul>
      {o.notes && (
        <p className="mt-3 flex gap-2 rounded-lg bg-muted p-3 text-sm"><StickyNote className="mt-0.5 size-4 shrink-0 text-gold" />{o.notes}</p>
      )}
      <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
        <MapPin className="size-4 text-gold" /> {o.delivery_village ?? "Village n/a"}{o.building_landmark ? ` · ${o.building_landmark}` : ""}
      </p>
      <div className="mt-3 flex items-end justify-between border-t border-border pt-3">
        <div>
          <p className="text-2xl font-semibold">{usd(o.total_usd)}</p>
          <p className="text-xs text-muted-foreground">{lbp(o.total_usd)}</p>
        </div>
        <span className="rounded-full border border-border px-3 py-1 text-xs uppercase">
          {isCOD(o.payment_method) ? "COD" : o.payment_method} · {o.payment_status ?? "unpaid"}
        </span>
      </div>

      <div className="mt-5 flex gap-2">
        {o.status === "pending" && (
          <>
            <div className="flex flex-1">
              <Button variant="gold" size="xl" className="flex-1 rounded-e-none" disabled={busy} onClick={() => onAccept(15)}>
                Accept (15m)
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="gold" size="xl" className="rounded-s-none border-s border-gold-foreground/20 px-4" disabled={busy} aria-label="Other prep times">
                    <ChevronDown />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {[10, 20, 30].map((m) => (
                    <DropdownMenuItem key={m} className="py-3 text-base" onClick={() => onAccept(m)}>Accept ({m}m)</DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <Button variant="hairline" size="xl" disabled={busy} onClick={() => setRejecting(true)}>Reject</Button>
          </>
        )}
        {(o.status === "accepted" || o.status === "preparing") && (
          <Button variant="emerald" size="xl" className="flex-1" disabled={busy} onClick={onReady}>
            Food Ready{o.prep_minutes ? ` · ${o.prep_minutes}m` : ""}
          </Button>
        )}
        {o.status === "ready" && (
          <p className="w-full rounded-xl bg-secondary/40 py-4 text-center text-secondary-foreground">
            {o.driver_id ? "Driver assigned, awaiting pickup" : "Waiting for a driver"}
          </p>
        )}
      </div>

      <Dialog open={rejecting} onOpenChange={setRejecting}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject #{o.short_code}</DialogTitle></DialogHeader>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (e.g. item unavailable, closing soon)" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejecting(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={!reason.trim()}
              onClick={() => {
                onReject(reason.trim());
                setRejecting(false);
              }}
            >
              Reject order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  );
}
