import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { RotateCcw, Search, SlidersHorizontal, Store } from "lucide-react";
import { SiteHeader } from "@/components/landing/SiteHeader";
import { Footer } from "@/components/landing/HowItWorks";
import { VendorCard } from "@/components/explore/VendorCard";
import { CATEGORIES } from "@/components/explore/categories";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { DEFAULT_FILTERS, exploreVendors, type ExploreFilters } from "@/lib/explore";
import { supabase } from "@/lib/supabase";
import { clean } from "@/lib/vendor";
import { useLang, useL } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const TITLE = "Explore Shouf merchants — Alo King (ألو كينغ)";
const DESC = "Search restaurants, cafes, bakeries, groceries and sweets across the Shouf by dish, cuisine, village and diet.";

export const Route = createFileRoute("/explore")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ExplorePage,
});

const PAGE = 24;

function useDebounced<T>(v: T, ms = 350) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const id = setTimeout(() => setD(v), ms);
    return () => clearTimeout(id);
  }, [v, ms]);
  return d;
}

function ExplorePage() {
  const L = useL();
  const { lang } = useLang();
  const [f, setF] = useState<ExploreFilters>(DEFAULT_FILTERS);
  const q = useDebounced(f.q);
  const filters = useMemo(() => ({ ...f, q }), [f, q]);
  const set = <K extends keyof ExploreFilters>(k: K, v: ExploreFilters[K]) => setF((p) => ({ ...p, [k]: v }));

  const villagesQ = useQuery({
    queryKey: ["village-counts"],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("vendors").select("village_canonical").limit(5000);
      if (error) throw error;
      const m = new Map<string, number>();
      (data ?? []).forEach((r: { village_canonical: string | null }) => {
        const v = clean(r.village_canonical);
        if (v) m.set(v, (m.get(v) ?? 0) + 1);
      });
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    },
  });

  const listQ = useInfiniteQuery({
    queryKey: ["explore", filters],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => exploreVendors(filters, PAGE, pageParam),
    getNextPageParam: (last, all) => (last.length === PAGE ? all.length * PAGE : undefined),
  });
  const rows = listQ.data?.pages.flat() ?? [];
  const total = listQ.data?.pages[0]?.[0]?.total_count ?? 0;
  const activeCount = (Object.keys(DEFAULT_FILTERS) as (keyof ExploreFilters)[]).filter((k) => k !== "q" && f[k] !== DEFAULT_FILTERS[k]).length;
  const reset = () => setF(DEFAULT_FILTERS);

  const toggles: { k: keyof ExploreFilters; en: string; ar: string }[] = [
    { k: "open_now", en: "Open now", ar: "مفتوح الآن" },
    { k: "has_menu", en: "Has menu", ar: "عنده منيو" },
    { k: "claimed", en: "Verified by owner", ar: "موثّق من المالك" },
    { k: "vegan", en: "Vegan", ar: "نباتي صرف" },
    { k: "gluten_free", en: "Gluten-free", ar: "خالي من الغلوتين" },
    { k: "keto", en: "Keto", ar: "كيتو" },
  ];

  const filterPanel = (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">{L("Village", "الضيعة")}</p>
        <div className="flex max-h-64 flex-wrap gap-1.5 overflow-y-auto">
          <Chip active={!f.village} onClick={() => set("village", null)}>{L("All villages", "كل الضيع")}</Chip>
          {villagesQ.isLoading && <Skeleton className="h-7 w-40 rounded-full" />}
          {(villagesQ.data ?? []).map(([name, n]) => (
            <Chip key={name} active={f.village === name} onClick={() => set("village", f.village === name ? null : name)}>
              {name} <span className="opacity-60">{n}</span>
            </Chip>
          ))}
        </div>
      </div>
      <div className="space-y-3">
        {toggles.map((t) => (
          <div key={t.k} className="flex items-center justify-between">
            <Label htmlFor={`t-${t.k}`} className="text-sm">{L(t.en, t.ar)}</Label>
            <Switch id={`t-${t.k}`} checked={!!f[t.k]} onCheckedChange={(c) => set(t.k, c as never)} />
          </div>
        ))}
      </div>
      <div>
        <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">{L("Sort", "ترتيب")}</p>
        <Select value={f.sort} onValueChange={(v) => set("sort", v as ExploreFilters["sort"])}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="relevance">{L("Relevance", "الأنسب")}</SelectItem>
            <SelectItem value="name">{L("A–Z", "أبجدي")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {activeCount > 0 && (
        <Button variant="hairline" className="w-full" onClick={reset}><RotateCcw /> {L("Reset filters", "مسح الفلاتر")}</Button>
      )}
    </div>
  );

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-5 py-10">
        <p className="text-xs uppercase tracking-[0.3em] text-gold">{L("Directory", "الدليل")}</p>
        <h1 className="mt-3 text-4xl font-semibold md:text-6xl">{L("Explore the Shouf", "استكشف الشوف")}</h1>
        <div className="relative mt-6">
          <Search className="absolute start-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={f.q}
            onChange={(e) => set("q", e.target.value)}
            placeholder={L("Search merchants, dishes or cuisines… e.g. manakish, shawarma, burger", "ابحث عن محل، أكلة أو مطبخ… مثلاً منقوشة، شاورما")}
            className="h-14 rounded-2xl ps-12 text-base"
            aria-label={L("Search", "بحث")}
          />
        </div>
        <div className="mt-5 flex gap-2 overflow-x-auto pb-2" role="tablist">
          {CATEGORIES.map((c) => {
            const I = c.icon;
            const on = f.category === c.value;
            return (
              <button
                key={c.en}
                role="tab"
                aria-selected={on}
                onClick={() => set("category", c.value)}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-xl border px-4 py-2.5 text-sm transition",
                  on ? "border-gold bg-gold/15 text-gold" : "border-border text-muted-foreground hover:border-gold/40",
                )}
              >
                <I className="size-4" /> {lang === "ar" ? c.ar : c.en}
              </button>
            );
          })}
        </div>

        <div className="mt-6 grid gap-8 lg:grid-cols-[260px_1fr]">
          <aside className="hidden lg:block">
            <div className="lux-card sticky top-24 p-5">{filterPanel}</div>
          </aside>
          <section>
            <div className="mb-4 flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                {listQ.isLoading ? <Skeleton className="h-5 w-32" /> : <><span className="font-semibold text-foreground">{total.toLocaleString()}</span> {L("merchants", "محل")}</>}
              </p>
              <Sheet>
                <SheetTrigger asChild>
                  <Button variant="hairline" className="lg:hidden">
                    <SlidersHorizontal /> {L("Filters", "فلاتر")} {activeCount > 0 && `(${activeCount})`}
                  </Button>
                </SheetTrigger>
                <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl">
                  <SheetHeader><SheetTitle>{L("Filters", "فلاتر")}</SheetTitle></SheetHeader>
                  <div className="p-4">{filterPanel}</div>
                </SheetContent>
              </Sheet>
            </div>
            {listQ.isError && <p className="py-10 text-center text-destructive">{L("Couldn't load merchants. Try again.", "ما قدرنا نحمّل المحلات.")}</p>}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {listQ.isLoading && Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-64 rounded-xl" />)}
              {rows.map((v) => <VendorCard key={v.vendor_id} v={v} showMatches={!!q.trim()} />)}
            </div>
            {!listQ.isLoading && !listQ.isError && rows.length === 0 && (
              <div className="lux-card mt-4 p-10 text-center">
                <Store className="mx-auto size-10 text-gold" />
                <p className="mt-4 text-xl font-semibold">{L("No merchants match", "ما في محلات مطابقة")}</p>
                <p className="mt-1 text-sm text-muted-foreground">{L("Try a different search or clear some filters.", "جرّب بحث تاني أو امسح بعض الفلاتر.")}</p>
                <Button variant="gold" className="mt-5" onClick={reset}><RotateCcw /> {L("Reset filters", "مسح الفلاتر")}</Button>
              </div>
            )}
            {listQ.hasNextPage && (
              <div className="mt-8 text-center">
                <Button variant="hairline" size="lg" disabled={listQ.isFetchingNextPage} onClick={() => listQ.fetchNextPage()}>
                  {listQ.isFetchingNextPage ? L("Loading…", "عم يحمّل…") : `${L("Load more", "عرض المزيد")} (${Math.max(0, total - rows.length)})`}
                </Button>
              </div>
            )}
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs transition",
        active ? "border-gold bg-gold/15 text-gold" : "border-border text-muted-foreground hover:border-gold/40",
      )}
    >
      {children}
    </button>
  );
}
