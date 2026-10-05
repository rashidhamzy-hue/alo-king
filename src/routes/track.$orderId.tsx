import { lazy, Suspense } from "react";
import { createFileRoute, ClientOnly, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Check, Crown, Gift, XCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { LangToggle } from "@/components/landing/SiteHeader";
import { supabase } from "@/lib/supabase";
import type { TrackedOrder } from "@/lib/types";
import { fmtTime, isCOD, lbp, usd } from "@/lib/format";
import { cn } from "@/lib/utils";

const TrackMap = lazy(() => import("@/components/track/TrackMap"));

export const Route = createFileRoute("/track/$orderId")({
  head: () => ({
    meta: [
      { title: "Track your order — Alo King" },
      { name: "description", content: "Follow your Alo King order live, from the kitchen to your door." },
      { property: "og:title", content: "Track your order — Alo King" },
      { property: "og:description", content: "Live status and map for your Alo King delivery in the Shouf." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: TrackPage,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function haversineKm(a: [number, number], b: [number, number]) {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function TrackPage() {
  const { orderId } = Route.useParams();
  const valid = UUID.test(orderId);
  const q = useQuery({
    queryKey: ["track", orderId],
    enabled: valid,
    refetchInterval: (query) => (["delivered", "cancelled", "rejected"].includes(query.state.data?.status ?? "") ? false : 5000),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("track_order", { p_order_id: orderId });
      if (error) throw error;
      return (data as TrackedOrder | null) ?? null;
    },
  });
  const o = q.data;

  if (!valid || (!q.isLoading && !o)) return <NotFound />;

  return (
    <div className="mx-auto min-h-screen max-w-2xl pb-16">
      <header className="flex items-center justify-between px-5 py-4">
        <Link to="/" className="flex items-center gap-2"><Crown className="size-5 text-gold" /><span className="font-display text-xl font-semibold">Alo King</span></Link>
        <LangToggle />
      </header>
      {q.isLoading || !o ? (
        <div className="space-y-4 px-5"><Skeleton className="h-10 w-48" /><Skeleton className="h-72 rounded-2xl" /><Skeleton className="h-64 rounded-2xl" /></div>
      ) : (
        <Body o={o} />
      )}
    </div>
  );
}

function Body({ o }: { o: TrackedOrder }) {
  const vendor = o.vendor_lat != null && o.vendor_lng != null ? ([o.vendor_lat, o.vendor_lng] as [number, number]) : null;
  const dest = o.customer_lat != null && o.customer_lng != null ? ([o.customer_lat, o.customer_lng] as [number, number]) : null;
  const driver = o.status === "out_for_delivery" && o.driver_lat != null && o.driver_lng != null ? ([o.driver_lat, o.driver_lng] as [number, number]) : null;
  const etaMin = driver && dest ? Math.max(1, Math.round((haversineKm(driver, dest) / 25) * 60)) : null;
  const failed = o.status === "cancelled" || o.status === "rejected";
  const order = ["pending", "accepted", "preparing", "ready", "out_for_delivery", "delivered"];
  const idx = order.indexOf(o.status);
  const steps = [
    { label: "Received", at: o.created_at, reached: idx >= 0 },
    { label: `Kitchen accepted${o.prep_minutes ? ` · ~${o.prep_minutes} min prep` : ""}`, at: o.accepted_at, reached: idx >= 1 },
    { label: "Ready", at: o.ready_at, reached: idx >= 3 },
    { label: "On the way", at: o.picked_up_at, reached: idx >= 4 },
    { label: "Delivered", at: o.delivered_at, reached: idx >= 5 },
  ];

  return (
    <div className="space-y-6 px-5">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-gold">Order #{o.short_code}</p>
        <h1 className="mt-2 text-4xl font-semibold">{o.vendor_name ?? "Your order"}</h1>
        {etaMin && <p className="mt-1 text-emerald-glow">Arriving in about {etaMin} min</p>}
      </div>

      {(vendor || dest) && (
        <div className="h-72 overflow-hidden rounded-2xl hairline">
          <ClientOnly fallback={<Skeleton className="h-full w-full" />}>
            <Suspense fallback={<Skeleton className="h-full w-full" />}>
              <TrackMap vendor={vendor} dest={dest} driver={driver} />
            </Suspense>
          </ClientOnly>
        </div>
      )}

      <section className="lux-card p-6">
        {failed ? (
          <div className="flex items-start gap-3">
            <XCircle className="size-6 shrink-0 text-destructive" />
            <div>
              <p className="text-lg font-semibold">Order {o.status}</p>
              <p className="text-sm text-muted-foreground">We're sorry, this order couldn't be completed. Message Alo King on WhatsApp and we'll sort it out.</p>
            </div>
          </div>
        ) : (
          <ol className="space-y-5">
            {steps.map((s, i) => (
              <li key={s.label} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <span className={cn("grid size-7 place-items-center rounded-full border", s.reached ? "border-gold bg-gold text-gold-foreground" : "border-border text-muted-foreground")}>
                    {s.reached ? <Check className="size-4" /> : <span className="size-1.5 rounded-full bg-muted-foreground" />}
                  </span>
                  {i < steps.length - 1 && <span className={cn("mt-1 h-6 w-px", s.reached ? "bg-gold" : "bg-border")} />}
                </div>
                <div className="flex flex-1 justify-between">
                  <span className={s.reached ? "font-medium" : "text-muted-foreground"}>{s.label}</span>
                  <span className="text-sm text-muted-foreground">{fmtTime(s.at)}</span>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {o.is_expat_gift && (
        <section className="lux-card border-gold/40 p-6">
          <p className="flex items-center gap-2 text-sm text-gold"><Gift className="size-4" /> A gift from {o.gift_sender_name ?? "someone who loves you"}</p>
          {o.gift_message && <p className="mt-3 font-display text-2xl italic">“{o.gift_message}”</p>}
        </section>
      )}

      <section className="lux-card p-6">
        <h2 className="text-2xl font-semibold">Receipt</h2>
        <ul className="mt-4 space-y-2 text-sm">
          {(o.items ?? []).map((it, i) => (
            <li key={i} className="flex justify-between gap-3">
              <span>{it.quantity} × {it.name_en} <span className="text-muted-foreground">@ {usd(it.unit_price_usd)}</span></span>
              <span>{usd(it.quantity * it.unit_price_usd)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-4 space-y-1.5 border-t border-border pt-4 text-sm">
          <div className="flex justify-between"><dt className="text-muted-foreground">Subtotal</dt><dd>{usd(o.subtotal_usd)}</dd></div>
          <div className="flex justify-between"><dt className="text-muted-foreground">Delivery</dt><dd>{usd(o.delivery_fee_usd)}</dd></div>
          <div className="flex justify-between pt-2 text-lg font-semibold"><dt>Total</dt><dd>{usd(o.total_usd)}</dd></div>
          <div className="flex justify-between text-muted-foreground"><dt /><dd>{lbp(o.total_usd)}</dd></div>
        </dl>
        <p className="mt-4 text-xs uppercase tracking-wide text-muted-foreground">
          {isCOD(o.payment_method) ? "Cash on delivery" : o.payment_method} · {o.payment_status ?? "unpaid"}
          {o.delivery_village ? ` · ${o.delivery_village}` : ""}
        </p>
      </section>
    </div>
  );
}

function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-hero px-5">
      <div className="lux-card max-w-sm p-8 text-center">
        <Crown className="mx-auto size-8 text-gold" />
        <h1 className="mt-4 text-3xl font-semibold">Order not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">We couldn't find this order. Check the link from your WhatsApp chat and try again.</p>
        <Button variant="gold" className="mt-6" asChild><Link to="/">Back to Alo King</Link></Button>
      </div>
    </div>
  );
}
