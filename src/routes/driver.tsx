import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PrivateShell } from "@/components/private/PrivateShell";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { LogOut, Navigation, Package, MapPin, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { StaffGate, signOut } from "@/components/staff/StaffGate";
import { Crown } from "@/design/Crown";
import { LangToggle } from "@/components/landing/SiteHeader";
import { CashGauge } from "@/components/driver/CashGauge";
import { supabase } from "@/lib/supabase";
import { ORDER_COLUMNS, type Order, type Vendor } from "@/lib/types";
import { VENDOR_COLUMNS } from "@/lib/config";
import { errMsg, fmtTime, isCOD, startOfToday, usd } from "@/lib/format";
import { useLbp } from "@/lib/rate";

export const Route = createFileRoute("/driver")({
  head: () => ({
    meta: [
      { title: "Driver — Alo King" },
      {
        name: "description",
        content: "Alo King driver app: dispatch, navigation and cash-on-delivery tracking.",
      },
      { property: "og:title", content: "Driver — Alo King" },
      {
        property: "og:description",
        content: "Dispatch and delivery for Alo King drivers in the Shouf.",
      },
      { name: "robots", content: "noindex" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
    ],
    links: [
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/icon-192.png" },
    ],
  }),
  component: DriverRoute,
});

function DriverRoute() {
  return (
    <PrivateShell>
      <StaffGate roles={["driver", "admin"]} title={["Driver", "السائق", "Livreur"]}>
        {(_p, s) => <DriverApp uid={s.user.id} />}
      </StaffGate>
    </PrivateShell>
  );
}

const navLinks = (lat: number | null | undefined, lng: number | null | undefined, text: string) =>
  lat != null && lng != null
    ? {
        waze: `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`,
        google: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`,
      }
    : {
        waze: `https://waze.com/ul?q=${encodeURIComponent(text)}&navigate=yes`,
        google: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(text)}`,
      };

function DriverApp({ uid }: { uid: string }) {
  const lbp = useLbp();
  const qc = useQueryClient();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Order | null>(null);

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  const cashQ = useQuery({
    queryKey: ["cash", uid],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("driver_cash_on_hand");
      if (error) throw error;
      return Number(data) || 0;
    },
    refetchInterval: 30_000,
  });
  const cash = cashQ.data ?? 0;

  const upsert = useCallback((o: Order) => {
    setOrders((prev) => {
      const i = prev.findIndex((p) => p.id === o.id);
      if (i === -1) return [o, ...prev];
      const n = [...prev];
      n[i] = { ...n[i], ...o };
      return n;
    });
  }, []);

  useEffect(() => {
    Promise.all([
      supabase
        .from("orders")
        .select(ORDER_COLUMNS)
        .eq("driver_id", uid)
        .or(`created_at.gte.${startOfToday()},status.in.(ready,out_for_delivery)`),
      supabase.from("orders").select(ORDER_COLUMNS).eq("status", "ready").is("driver_id", null),
    ]).then(([mine, open]) => {
      if (mine.error) toast.error(mine.error.message);
      setOrders([
        ...((mine.data ?? []) as unknown as Order[]),
        ...((open.data ?? []) as unknown as Order[]),
      ]);
      setLoading(false);
    });
    const ch = supabase
      .channel(`driver-${uid}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, (p) => {
        const o = p.new as Order;
        if (o?.id) upsert(o);
      })
      .subscribe();
    return () => void supabase.removeChannel(ch);
  }, [uid, upsert]);

  const mine = orders.filter((o) => o.driver_id === uid);
  const active = mine.filter((o) => o.status === "ready" || o.status === "out_for_delivery");
  const done = mine.filter(
    (o) => o.status === "delivered" && (o.delivered_at ?? o.created_at) >= startOfToday(),
  );
  const offer = orders.find((o) => o.status === "ready" && !o.driver_id && !skipped.has(o.id));

  const vendorIds = useMemo(
    () => [...new Set([...active, ...(offer ? [offer] : [])].map((o) => o.vendor_id))].sort(),
    [active, offer],
  );
  const vendorsQ = useQuery({
    queryKey: ["drv-vendors", vendorIds.join(",")],
    enabled: vendorIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vendors")
        .select(VENDOR_COLUMNS)
        .in("vendor_id", vendorIds);
      if (error) throw error;
      return Object.fromEntries(((data ?? []) as unknown as Vendor[]).map((v) => [v.vendor_id, v]));
    },
  });
  const vmap: Record<string, Vendor> = vendorsQ.data ?? {};

  // GPS while out for delivery
  const outIds = active
    .filter((o) => o.status === "out_for_delivery")
    .map((o) => o.id)
    .join(",");
  const lastSent = useRef(0);
  useEffect(() => {
    if (!outIds || !("geolocation" in navigator)) return;
    const ids = outIds.split(",");
    const watch = navigator.geolocation.watchPosition(
      (pos) => {
        if (Date.now() - lastSent.current < 8000) return;
        lastSent.current = Date.now();
        void supabase
          .from("orders")
          .update({
            driver_lat: pos.coords.latitude,
            driver_lng: pos.coords.longitude,
            driver_location_at: new Date().toISOString(),
          })
          .in("id", ids);
      },
      () => toast.error("Location unavailable. Enable GPS so customers can follow you."),
      { enableHighAccuracy: true, maximumAge: 5000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [outIds]);

  async function act(o: Order, patch: Record<string, unknown>, extraFilter?: "unassigned") {
    setBusy(true);
    let q = supabase.from("orders").update(patch).eq("id", o.id);
    if (extraFilter === "unassigned") q = q.is("driver_id", null);
    const { data, error } = await q.select(ORDER_COLUMNS).maybeSingle();
    setBusy(false);
    if (error) {
      const m = errMsg(error).toLowerCase();
      if (m.includes("cash") || m.includes("cap") || m.includes("limit") || m.includes("150"))
        toast.error("Cash limit reached, settle with Alo King first");
      else toast.error(errMsg(error));
      return false;
    }
    if (!data && extraFilter === "unassigned") {
      toast.error("Another driver took this delivery.");
      setSkipped((s) => new Set(s).add(o.id));
      return false;
    }
    if (data) upsert(data as unknown as Order);
    if (patch.status)
      void supabase.functions
        .invoke("order-notify", { body: { order_id: o.id } })
        .catch(() => undefined);
    void qc.invalidateQueries({ queryKey: ["cash", uid] });
    return true;
  }

  return (
    <div className="mx-auto min-h-screen max-w-md pb-16">
      <header className="flex items-center justify-between gap-3 px-5 pt-5">
        <h1 className="flex items-center gap-2.5 text-xl font-extrabold">
          <Crown className="h-7 w-9 text-gold" /> Alo King · Driver
        </h1>
        <div className="flex items-center gap-2">
          <LangToggle />
          <Button variant="ghost" size="icon" onClick={signOut} aria-label="Sign out">
            <LogOut />
          </Button>
        </div>
      </header>
      <div className="lux-card mx-5 mt-4 py-5">
        {cashQ.isLoading ? <Skeleton className="mx-auto h-28 w-56" /> : <CashGauge cash={cash} />}
      </div>

      <h2 className="mt-8 px-5 text-xl font-semibold">Active deliveries</h2>
      <div className="mt-3 space-y-4 px-5">
        {loading && <Skeleton className="h-48 rounded-xl" />}
        {!loading && active.length === 0 && (
          <p className="lux-card p-6 text-center text-sm text-muted-foreground">
            No active deliveries. New ready orders will pop up here.
          </p>
        )}
        {active.map((o) => {
          const v = vmap[o.vendor_id];
          const pick = navLinks(
            v?.latitude,
            v?.longitude,
            `${v?.name_en ?? ""}, ${v?.village_canonical ?? ""}, Lebanon`,
          );
          const drop = navLinks(
            o.customer_lat,
            o.customer_lng,
            `${o.building_landmark ?? ""}, ${o.delivery_village ?? ""}, Lebanon`,
          );
          return (
            <article key={o.id} className="lux-card space-y-4 p-5">
              <div className="flex justify-between">
                <span className="font-display text-2xl font-semibold">#{o.short_code}</span>
                <span className="text-sm text-gold">
                  {o.status === "ready" ? "Go to pickup" : "On the way"}
                </span>
              </div>
              <Stop
                icon={Package}
                label="Pickup"
                title={v?.name_en ?? "Restaurant"}
                sub={v?.village_canonical ?? ""}
                links={pick}
              />
              <Stop
                icon={MapPin}
                label="Drop-off"
                title={o.building_landmark ?? "Customer"}
                sub={o.delivery_village ?? ""}
                links={drop}
              />
              <div className="flex items-center justify-between border-t border-border pt-3">
                <span>
                  {isCOD(o.payment_method) ? "Collect" : "Prepaid"} <b>{usd(o.total_usd)}</b>
                </span>
                <span className="text-xs text-muted-foreground">{lbp(o.total_usd)}</span>
              </div>
              {o.status === "ready" ? (
                <Button
                  variant="gold"
                  size="xl"
                  className="w-full"
                  disabled={busy}
                  onClick={() => act(o, { status: "out_for_delivery" })}
                >
                  Picked up
                </Button>
              ) : (
                <Button
                  variant="emerald"
                  size="xl"
                  className="w-full"
                  disabled={busy}
                  onClick={() => setConfirm(o)}
                >
                  Delivered
                </Button>
              )}
            </article>
          );
        })}
      </div>

      <h2 className="mt-8 px-5 text-xl font-semibold">Today's deliveries · {done.length}</h2>
      <ul className="mt-3 space-y-2 px-5">
        {done.length === 0 && <li className="text-sm text-muted-foreground">None yet today.</li>}
        {done.map((o) => (
          <li
            key={o.id}
            className="flex items-center justify-between rounded-lg bg-card/60 px-4 py-3 text-sm"
          >
            <span className="flex items-center gap-2">
              <CheckCircle2 className="size-4 text-success" />#{o.short_code} · {o.delivery_village}
            </span>
            <span>
              {usd(o.total_usd)} · {fmtTime(o.delivered_at)}
            </span>
          </li>
        ))}
      </ul>

      <AnimatePresence>
        {offer && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex flex-col bg-background/95 p-6 backdrop-blur"
          >
            <motion.div
              initial={{ y: 40 }}
              animate={{ y: 0 }}
              className="mx-auto flex w-full max-w-md flex-1 flex-col"
            >
              <p className="text-xs uppercase tracking-[0.3em] text-gold">New delivery</p>
              <h2 className="mt-2 text-5xl font-semibold">#{offer.short_code}</h2>
              <div className="mt-8 space-y-5 text-lg">
                <p>
                  <span className="block text-xs text-muted-foreground">Pickup</span>
                  {vmap[offer.vendor_id]?.name_en ?? "Restaurant"} ·{" "}
                  {vmap[offer.vendor_id]?.village_canonical ?? ""}
                </p>
                <p>
                  <span className="block text-xs text-muted-foreground">Drop-off</span>
                  {offer.delivery_village ?? "n/a"}
                  {offer.building_landmark ? ` · ${offer.building_landmark}` : ""}
                </p>
                <p>
                  <span className="block text-xs text-muted-foreground">Total</span>
                  {usd(offer.total_usd)} · {lbp(offer.total_usd)} ·{" "}
                  {isCOD(offer.payment_method) ? "Cash on delivery" : "Prepaid"}
                </p>
              </div>
              {isCOD(offer.payment_method) && (
                <div className="lux-card mt-6 py-4">
                  <CashGauge cash={cash} pending={Number(offer.total_usd) || 0} />
                  <p className="mt-2 text-center text-xs text-muted-foreground">
                    After delivery: ${(cash + (Number(offer.total_usd) || 0)).toFixed(2)} held
                  </p>
                </div>
              )}
              <div className="mt-auto space-y-3 pt-6">
                <Button
                  variant="gold"
                  size="xl"
                  className="w-full"
                  disabled={busy}
                  onClick={() => act(offer, { driver_id: uid }, "unassigned")}
                >
                  Accept delivery
                </Button>
                <Button
                  variant="hairline"
                  size="xl"
                  className="w-full"
                  onClick={() => setSkipped((s) => new Set(s).add(offer.id))}
                >
                  Skip
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm delivery #{confirm?.short_code}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm && isCOD(confirm.payment_method)
                ? `Collect ${usd(confirm.total_usd)} (${lbp(confirm.total_usd)}) in cash from the customer.`
                : "This order is prepaid. Hand it over and confirm."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!confirm) return;
                const patch: Record<string, unknown> = { status: "delivered" };
                if (isCOD(confirm.payment_method)) patch["payment_status"] = "collected";
                void act(confirm, patch);
                setConfirm(null);
              }}
            >
              {confirm && isCOD(confirm.payment_method) ? "Cash collected, delivered" : "Delivered"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Stop({
  icon: Icon,
  label,
  title,
  sub,
  links,
}: {
  icon: typeof MapPin;
  label: string;
  title: string;
  sub: string;
  links: { waze: string; google: string };
}) {
  return (
    <div>
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-3.5 text-gold" />
        {label}
      </p>
      <p className="font-medium">
        {title} <span className="text-muted-foreground">{sub}</span>
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Button variant="hairline" size="lg" asChild>
          <a href={links.waze} target="_blank" rel="noreferrer">
            <Navigation /> Waze
          </a>
        </Button>
        <Button variant="hairline" size="lg" asChild>
          <a href={links.google} target="_blank" rel="noreferrer">
            <Navigation /> Google Maps
          </a>
        </Button>
      </div>
    </div>
  );
}
