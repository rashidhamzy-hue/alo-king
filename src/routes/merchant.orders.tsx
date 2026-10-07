import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BellRing, Volume2, VolumeX, Wifi, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useMerchant } from "@/components/merchant/context";
import { KitchenOrderCard } from "@/components/merchant/KitchenOrderCard";
import { supabase } from "@/lib/supabase";
import { ORDER_COLUMNS, type Order } from "@/lib/types";
import { errMsg, lbp, startOfToday, usd } from "@/lib/format";
import { playChime, unlockAudio } from "@/lib/chime";
import { useNow } from "@/hooks/use-now";

export const Route = createFileRoute("/merchant/orders")({
  head: () => ({
    meta: [
      { title: "Orders — Alo King Kitchen" },
      {
        name: "description",
        content: "Live order terminal for Alo King merchant kitchens in the Shouf.",
      },
      { property: "og:title", content: "Kitchen Terminal — Alo King" },
      {
        property: "og:description",
        content: "Accept, prepare and hand off WhatsApp orders in real time.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OrdersPage,
});

function OrdersPage() {
  const { vendorId } = useMerchant();
  return <Terminal key={vendorId} vendorId={vendorId} />;
}

function Terminal({ vendorId }: { vendorId: string }) {
  const now = useNow(1000);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(false);
  const [unacked, setUnacked] = useState<Set<string>>(new Set());
  const [soundOn, setSoundOn] = useState(false);
  const [muted, setMuted] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const soundRef = useRef({ soundOn, muted });
  soundRef.current = { soundOn, muted };

  const vendorQ = useQuery({
    queryKey: ["vendor-name", vendorId],
    queryFn: async () => {
      const { data } = await supabase
        .from("vendors")
        .select("vendor_id,name_en,name_ar")
        .eq("vendor_id", vendorId)
        .maybeSingle();
      return data as { name_en: string | null; name_ar: string | null } | null;
    },
  });

  const upsert = useCallback((o: Order) => {
    setOrders((prev) => {
      const i = prev.findIndex((p) => p.id === o.id);
      if (i === -1) return [o, ...prev];
      const next = [...prev];
      next[i] = { ...next[i], ...o };
      return next;
    });
  }, []);

  useEffect(() => {
    let alive = true;
    supabase
      .from("orders")
      .select(ORDER_COLUMNS)
      .eq("vendor_id", vendorId)
      .or(
        `created_at.gte.${startOfToday()},status.in.(pending,accepted,preparing,ready,out_for_delivery)`,
      )
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) toast.error(`Couldn't load orders: ${error.message}`);
        setOrders((data ?? []) as unknown as Order[]);
        setLoading(false);
      });
    const ch = supabase
      .channel(`kitchen-${vendorId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders", filter: `vendor_id=eq.${vendorId}` },
        (payload) => {
          const o = payload.new as Order;
          if (!o?.id) return;
          upsert(o);
          if (payload.eventType === "INSERT") {
            setUnacked((s) => new Set(s).add(o.id));
            toast(`New order #${o.short_code ?? ""}`, { icon: <BellRing className="size-4" /> });
          }
        },
      )
      .subscribe((status) => setOnline(status === "SUBSCRIBED"));
    return () => {
      alive = false;
      void supabase.removeChannel(ch);
    };
  }, [vendorId, upsert]);

  // repeating chime while unacknowledged
  useEffect(() => {
    if (unacked.size === 0) return undefined;
    const ring = () => {
      if (soundRef.current.soundOn && !soundRef.current.muted) playChime();
    };
    ring();
    const id = setInterval(ring, 1800);
    return () => clearInterval(id);
  }, [unacked.size]);

  const pending = orders.filter((o) => o.status === "pending");
  useEffect(() => {
    document.title = pending.length
      ? `(${pending.length}) New orders — Alo King Kitchen`
      : "Kitchen Terminal — Alo King";
  }, [pending.length]);

  const today = useMemo(() => {
    const t0 = startOfToday();
    const list = orders.filter(
      (o) => o.created_at >= t0 && o.status !== "cancelled" && o.status !== "rejected",
    );
    return {
      count: list.length,
      revenue: list.reduce((s, o) => s + (Number(o.total_usd) || 0), 0),
    };
  }, [orders]);

  const ack = (id: string) =>
    setUnacked((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });

  async function update(
    o: Order,
    patch: Partial<Pick<Order, "status" | "prep_minutes" | "notes">>,
  ) {
    setBusyId(o.id);
    ack(o.id);
    const { data, error } = await supabase
      .from("orders")
      .update(patch)
      .eq("id", o.id)
      .select(ORDER_COLUMNS)
      .maybeSingle();
    setBusyId(null);
    if (error) {
      toast.error(errMsg(error));
      return;
    }
    // Tell the customer on WhatsApp right away (the scheduled sweep is only the backup); failures here never block the kitchen.
    if (patch.status)
      void supabase.functions
        .invoke("order-notify", { body: { order_id: o.id } })
        .catch(() => undefined);
    if (data) upsert(data as unknown as Order);
    else upsert({ ...o, ...patch });
  }

  const cols = [
    { title: "New", list: pending },
    {
      title: "In kitchen",
      list: orders.filter((o) => o.status === "accepted" || o.status === "preparing"),
    },
    {
      title: "Ready / on the way",
      list: orders.filter((o) => o.status === "ready" || o.status === "out_for_delivery"),
    },
  ];

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-6 py-4">
        <div>
          <h1 className="text-3xl font-semibold">{vendorQ.data?.name_en ?? "Kitchen"}</h1>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            {online ? (
              <Wifi className="size-4 text-success" />
            ) : (
              <WifiOff className="size-4 text-destructive" />
            )}
            {online ? "Live" : "Offline, reconnecting…"} · Today {today.count} orders ·{" "}
            {usd(today.revenue)} ({lbp(today.revenue)})
          </p>
        </div>
        <div className="flex gap-2">
          {unacked.size > 0 && (
            <Button variant="gold" size="lg" onClick={() => setUnacked(new Set())}>
              Acknowledge ({unacked.size})
            </Button>
          )}
          {!soundOn ? (
            <Button
              variant="emerald"
              size="lg"
              onClick={() => {
                unlockAudio();
                setSoundOn(true);
                playChime();
              }}
            >
              <Volume2 /> Enable sound
            </Button>
          ) : (
            <Button
              variant="hairline"
              size="lg"
              onClick={() => setMuted((m) => !m)}
              aria-label="Toggle mute"
            >
              {muted ? <VolumeX /> : <Volume2 />} {muted ? "Muted" : "Sound on"}
            </Button>
          )}
        </div>
      </header>
      <div className="grid flex-1 gap-5 p-5 lg:grid-cols-3">
        {cols.map((c) => (
          <section key={c.title} className="flex flex-col rounded-2xl bg-card/40 p-4">
            <h2 className="mb-4 flex items-center justify-between text-2xl font-semibold">
              {c.title}{" "}
              <span className="rounded-full bg-muted px-3 text-base">{c.list.length}</span>
            </h2>
            <div className="space-y-4">
              {loading && <Skeleton className="h-56 rounded-xl" />}
              {!loading && c.list.length === 0 && (
                <p className="py-10 text-center text-muted-foreground">Nothing here</p>
              )}
              {c.list.map((o) => (
                <div key={o.id} onPointerDown={() => ack(o.id)}>
                  <KitchenOrderCard
                    order={o}
                    now={now}
                    flashing={unacked.has(o.id)}
                    busy={busyId === o.id}
                    onAccept={(m) => update(o, { status: "accepted", prep_minutes: m })}
                    onReject={(r) =>
                      update(o, {
                        status: "rejected",
                        notes: [o.notes, `REJECTED: ${r}`].filter(Boolean).join(" | "),
                      })
                    }
                    onReady={() => update(o, { status: "ready" })}
                    onOutForDelivery={() => update(o, { status: "out_for_delivery" })}
                    onDelivered={() => update(o, { status: "delivered" })}
                  />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
