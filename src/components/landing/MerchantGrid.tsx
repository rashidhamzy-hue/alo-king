import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { VendorCard } from "@/components/explore/VendorCard";
import { exploreVendors } from "@/lib/explore";
import { supabase } from "@/lib/supabase";
import { useL } from "@/lib/i18n";

export function MerchantGrid() {
  const L = useL();
  const q = useQuery({ queryKey: ["explore-preview"], queryFn: () => exploreVendors({ has_menu: true }, 8, 0), staleTime: 5 * 60_000 });
  const dishesQ = useQuery({
    queryKey: ["dish-count"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { count } = await supabase.from("menu_items").select("item_id", { count: "exact", head: true });
      return count ?? 0;
    },
  });
  const allQ = useQuery({ queryKey: ["explore-total"], queryFn: () => exploreVendors({}, 1, 0), staleTime: 5 * 60_000 });
  const total = allQ.data?.[0]?.total_count;
  return (
    <section id="merchants" className="border-y border-border bg-card/30">
      <div className="mx-auto max-w-6xl px-5 py-24">
        <p className="text-xs uppercase tracking-[0.3em] text-gold">{L("Merchant map", "خريطة المحلات")}</p>
        <h2 className="mt-4 text-4xl font-semibold md:text-6xl">{L("The Shouf, mapped", "الشوف على الخريطة")}</h2>
        <div className="mt-4 text-muted-foreground">
          {total ? <><span className="font-semibold text-foreground">{total.toLocaleString()}</span> {L("merchants mapped across the Shouf", "محل على خريطة الشوف")}</> : <Skeleton className="inline-block h-5 w-64" />}
          {!!dishesQ.data && <> · <span className="font-semibold text-foreground">{dishesQ.data.toLocaleString()}</span> {L("dishes", "صنف")}</>}
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {q.isLoading && Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-64 rounded-xl" />)}
          {(q.data ?? []).map((v) => <VendorCard key={v.vendor_id} v={v} />)}
        </div>
        <div className="mt-10 text-center">
          <Button variant="gold" size="lg" asChild>
            <Link to="/explore">{L("Explore all merchants", "استكشف كل المحلات")} <ArrowRight className="rtl:rotate-180" /></Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
