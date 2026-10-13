import { useState } from "react";
import { ChevronDown, MapPin, StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ageLabel, isCOD, usd } from "@/lib/format";
import { lockedLbp } from "@/lib/rate";
import { useL } from "@/lib/i18n";
import type { Order } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  order: Order;
  now: number;
  flashing: boolean;
  onAccept: (mins: number) => void;
  onReject: (reason: string) => void;
  onReady: () => void;
  /** Self-delivery / demo: the kitchen moves an order with no driver on to the customer. */
  onOutForDelivery?: () => void;
  onDelivered?: () => void;
  busy: boolean;
};

export function KitchenOrderCard({
  order: o,
  now,
  flashing,
  onAccept,
  onReject,
  onReady,
  onOutForDelivery,
  onDelivered,
  busy,
}: Props) {
  const L = useL();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const demo = (o.notes ?? "").trim().toUpperCase().startsWith("DEMO");

  return (
    <article className={cn("lux-card p-5", flashing && "animate-gold-flash")}>
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-display text-3xl font-semibold">
            #{o.short_code ?? o.id.slice(0, 6)}
          </span>
          {demo && (
            <span className="rounded bg-gold px-2 py-0.5 text-xs font-bold text-gold-foreground">
              DEMO
            </span>
          )}
        </div>
        <span className="font-mono text-lg text-muted-foreground">
          {ageLabel(o.created_at, now)}
        </span>
      </header>
      <ul className="mt-4 space-y-1.5 text-lg">
        {(o.items ?? []).map((it, i) => (
          <li key={i} className="flex justify-between gap-3">
            <span>
              <span className="font-semibold text-gold">{it.quantity}×</span> {it.name_en}
            </span>
            {it.name_ar && (
              <span dir="rtl" className="font-arabic text-sm text-muted-foreground">
                {it.name_ar}
              </span>
            )}
          </li>
        ))}
      </ul>
      {o.notes && (
        <p className="mt-3 flex gap-2 rounded-lg bg-muted p-3 text-sm">
          <StickyNote className="mt-0.5 size-4 shrink-0 text-gold" />
          {o.notes}
        </p>
      )}
      <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
        <MapPin className="size-4 text-gold" />{" "}
        {o.delivery_village ?? L("Village n/a", "القرية غير محددة", "Village non précisé")}
        {o.building_landmark ? ` · ${o.building_landmark}` : ""}
      </p>
      <div className="mt-3 flex items-end justify-between border-t border-border pt-3">
        <div>
          <p className="text-2xl font-semibold">{usd(o.total_usd)}</p>
          <p className="text-xs text-muted-foreground">{lockedLbp(o)}</p>
        </div>
        <span className="rounded-full border border-border px-3 py-1 text-xs uppercase">
          {isCOD(o.payment_method) ? L("Cash", "كاش", "Espèces") : o.payment_method} ·{" "}
          {o.payment_status ?? L("unpaid", "غير مدفوع", "non payé")}
        </span>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {o.status === "pending" && (
          <>
            <div className="flex min-w-[12rem] flex-1">
              <Button
                variant="gold"
                size="xl"
                className="flex-1 rounded-e-none"
                disabled={busy}
                onClick={() => onAccept(15)}
              >
                {L("Accept", "قبول", "Accepter")} (15m)
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="gold"
                    size="xl"
                    className="rounded-s-none border-s border-gold-foreground/20 px-4"
                    disabled={busy}
                    aria-label={L(
                      "Other prep times",
                      "أوقات تحضير أخرى",
                      "Autres temps de préparation",
                    )}
                  >
                    <ChevronDown />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {[10, 20, 30].map((m) => (
                    <DropdownMenuItem
                      key={m}
                      className="py-3 text-base"
                      onClick={() => onAccept(m)}
                    >
                      {L("Accept", "قبول", "Accepter")} ({m}m)
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <Button variant="hairline" size="xl" disabled={busy} onClick={() => setRejecting(true)}>
              {L("Reject", "رفض", "Refuser")}
            </Button>
          </>
        )}
        {(o.status === "accepted" || o.status === "preparing") && (
          <Button variant="emerald" size="xl" className="flex-1" disabled={busy} onClick={onReady}>
            {L("Food ready", "الأكل جاهز", "Commande prête")}
            {o.prep_minutes ? ` · ${o.prep_minutes}m` : ""}
          </Button>
        )}
        {o.status === "ready" && o.driver_id && (
          <p className="w-full rounded-xl bg-secondary/40 py-4 text-center text-secondary-foreground">
            {L(
              "Driver assigned, awaiting pickup",
              "السائق معيّن، بانتظار الاستلام",
              "Livreur assigné, en attente de retrait",
            )}
          </p>
        )}
        {o.status === "ready" && !o.driver_id && (
          <div className="flex w-full flex-col gap-2">
            <p className="rounded-xl bg-secondary/40 py-3 text-center text-secondary-foreground">
              {L("No driver assigned", "ما في سائق معيّن", "Aucun livreur assigné")}
            </p>
            {onOutForDelivery && (
              <Button
                variant="emerald"
                size="xl"
                className="flex-1"
                disabled={busy}
                onClick={onOutForDelivery}
              >
                {L(
                  "Out for delivery (we deliver)",
                  "عالطريق للتوصيل (منوصّل نحنا)",
                  "En livraison (nous livrons)",
                )}
              </Button>
            )}
          </div>
        )}
        {o.status === "out_for_delivery" &&
          (o.driver_id || !onDelivered ? (
            <p className="w-full rounded-xl bg-secondary/40 py-4 text-center text-secondary-foreground">
              {L("On the way with the driver", "عالطريق مع السائق", "En route avec le livreur")}
            </p>
          ) : (
            <Button
              variant="gold"
              size="xl"
              className="flex-1"
              disabled={busy}
              onClick={onDelivered}
            >
              {L("Mark delivered", "تم التسليم", "Marquer livrée")}
            </Button>
          ))}
      </div>

      <Dialog open={rejecting} onOpenChange={setRejecting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {L("Reject", "رفض", "Refuser")} #{o.short_code}
            </DialogTitle>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={L(
              "Reason (e.g. item unavailable, closing soon)",
              "السبب (مثلاً الصنف خلص، عم نسكّر)",
              "Motif (p. ex. article épuisé, fermeture proche)",
            )}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejecting(false)}>
              {L("Cancel", "إلغاء", "Annuler")}
            </Button>
            <Button
              variant="destructive"
              disabled={!reason.trim()}
              onClick={() => {
                onReject(reason.trim());
                setRejecting(false);
              }}
            >
              {L("Reject order", "رفض الطلب", "Refuser la commande")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  );
}
