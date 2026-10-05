import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, MapPin, Clock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { VENDOR_COLUMNS } from "@/lib/config";
import type { Vendor } from "@/lib/types";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const PAGE = 24;

async function fetchVendors(): Promise<Vendor[]> {
  const out: Vendor[] = [];
  for (let from = 0; from < 5000; from += 1000) {
    const { data, error } = await supabase.from("vendors").select(VENDOR_COLUMNS).range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as unknown as Vendor[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function fetchDishCount() {
  const { count, error } = await supabase.from("menu_items").select("item_id", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
}

const villageOf = (v: Vendor) => v.village_canonical || "Other";

export function MerchantGrid() {
  const { t } = useLang();
  const vendorsQ = useQuery({ queryKey: ["vendors"], queryFn: fetchVendors, staleTime: 5 * 60_000 });
  const dishesQ = useQuery({ queryKey: ["dish-count"], queryFn: fetchDishCount, staleTime: 5 * 60_000 });
  const [q, setQ] = useState("");
  const [village, setVillage] = useState<string | null>(null);
  const [cat, setCat] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);

  const vendors = vendorsQ.data ?? [];
  const villages = useMemo(() => {
    const m = new Map<string, number>();
    vendors.forEach((v) => m.set(villageOf(v), (m.get(villageOf(v)) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => (a[0] === "Other" ? 1 : b[0] === "Other" ? -1 : b[1] - a[1]));
  }, [vendors]);
  const cats = useMemo(() => {
    const m = new Map<string, number>();
    vendors.forEach((v) => v.category_canonical && m.set(v.category_canonical, (m.get(v.category_canonical) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [vendors]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return vendors.filter(
      (v) =>
        (!village || villageOf(v) === village) &&
        (!cat || v.category_canonical === cat) &&
        (!s || (v.name_en ?? "").toLowerCase().includes(s) || (v.name_ar ?? "").includes(q.trim())),
    );
  }, [vendors, q, village, cat]);

  const reset = () => setLimit(PAGE);

  return (
    <section id="merchants" className="border-y border-border bg-card/30">
      <div className="mx-auto max-w-6xl px-5 py-24">
        <p className="text-xs uppercase tracking-[0.3em] text-gold">Merchant map</p>
        <h2 className="mt-4 text-4xl font-semibold md:text-6xl">{t("grid_title")}</h2>
        <div className="mt-4 text-muted-foreground">
          {vendorsQ.isLoading ? (
            <Skeleton className="h-5 w-80" />
          ) : vendorsQ.isError ? (
            <span className="text-destructive">Couldn't load merchants right now.</span>
          ) : (
            <p>
              <span className="font-semibold text-foreground">{vendors.length.toLocaleString()}</span> merchants mapped across the Shouf
              {dishesQ.data ? (
                <>
                  {" · "}
                  <span className="font-semibold text-foreground">{dishesQ.data.toLocaleString()}</span> dishes with estimated macros
                </>
              ) : null}
            </p>
          )}
        </div>

        <div className="relative mt-8 max-w-md">
          <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              reset();
            }}
            placeholder={t("grid_search")}
            className="h-11 ps-9"
          />
        </div>

        <div className="mt-5 flex gap-2 overflow-x-auto pb-2">
          <Chip active={!village} onClick={() => { setVillage(null); reset(); }}>{t("grid_all")} · {vendors.length}</Chip>
          {villages.map(([name, n]) => (
            <Chip key={name} active={village === name} onClick={() => { setVillage(name); reset(); }}>
              {name} · {n}
            </Chip>
          ))}
        </div>
        <div className="mt-2 flex gap-2 overflow-x-auto pb-2">
          <Chip subtle active={!cat} onClick={() => { setCat(null); reset(); }}>All categories</Chip>
          {cats.map(([name, n]) => (
            <Chip subtle key={name} active={cat === name} onClick={() => { setCat(name); reset(); }}>
              {name} · {n}
            </Chip>
          ))}
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {vendorsQ.isLoading &&
            Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}
          {filtered.slice(0, limit).map((v) => (
            <article key={v.vendor_id} className="lux-card p-5 transition hover:-translate-y-0.5 hover:shadow-glow-emerald">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-xl font-semibold">{v.name_en || v.name_ar || "Unnamed"}</h3>
                  {v.name_ar && <p dir="rtl" className="font-arabic truncate text-sm text-muted-foreground">{v.name_ar}</p>}
                </div>
                {v.category_canonical && (
                  <span className="shrink-0 rounded-full bg-secondary/60 px-2.5 py-1 text-xs text-secondary-foreground">
                    {v.category_canonical}
                  </span>
                )}
              </div>
              <div className="mt-4 space-y-1.5 text-sm text-muted-foreground">
                <p className="flex items-center gap-2"><MapPin className="size-3.5 text-gold" /> {villageOf(v)}</p>
                <p className="flex items-center gap-2">
                  <Clock className="size-3.5 text-gold" />
                  {v.open_time && v.close_time ? `${v.open_time.slice(0, 5)}–${v.close_time.slice(0, 5)}` : "Hours not listed"}
                  {v.open_days ? <span className="truncate opacity-70">· {v.open_days}</span> : null}
                </p>
              </div>
            </article>
          ))}
        </div>
        {!vendorsQ.isLoading && filtered.length === 0 && (
          <p className="mt-10 text-center text-muted-foreground">{t("grid_empty")}</p>
        )}
        {filtered.length > limit && (
          <div className="mt-10 text-center">
            <Button variant="hairline" size="lg" onClick={() => setLimit((l) => l + PAGE)}>
              {t("grid_more")} ({filtered.length - limit})
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

function Chip({ active, subtle, onClick, children }: { active: boolean; subtle?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-xs transition",
        active
          ? subtle ? "border-emerald-glow bg-secondary text-secondary-foreground" : "border-gold bg-gold text-gold-foreground"
          : "border-border text-muted-foreground hover:border-gold/50 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
