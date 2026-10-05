import { useMemo, useState } from "react";
import { Search, SlidersHorizontal, UtensilsCrossed } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { AllergenPicker } from "@/components/shared/AllergenPicker";
import { clean, type MenuItem } from "@/lib/vendor";
import { useLang, useL } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { ItemCard, itemName } from "./ItemBits";
import { ItemDrawer } from "./ItemDrawer";

const DIETS: { k: keyof MenuItem; en: string; ar: string }[] = [
  { k: "is_vegan", en: "Vegan", ar: "نباتي صرف" },
  { k: "is_vegetarian", en: "Vegetarian", ar: "نباتي" },
  { k: "is_gluten_free", en: "Gluten-free", ar: "بلا غلوتين" },
  { k: "is_dairy_free", en: "Dairy-free", ar: "بلا ألبان" },
  { k: "is_keto", en: "Keto", ar: "كيتو" },
  { k: "is_halal", en: "Halal", ar: "حلال" },
];

const slug = (s: string) => "sec-" + s.toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/g, "-");

export function MenuTab({ items, vendorName }: { items: MenuItem[]; vendorName: string }) {
  const L = useL();
  const { lang } = useLang();
  const maxPrice = Math.max(1, Math.ceil(Math.max(0, ...items.map((i) => Number(i.price_usd) || 0))));
  const maxCal = Math.max(100, Math.ceil(Math.max(0, ...items.map((i) => Number(i.calories) || 0)) / 50) * 50);
  const maxProt = Math.max(10, Math.ceil(Math.max(0, ...items.map((i) => Number(i.protein_grams) || 0))));
  const [q, setQ] = useState("");
  const [diets, setDiets] = useState<string[]>([]);
  const [avoid, setAvoid] = useState<string[]>([]);
  const [spice, setSpice] = useState(4);
  const [price, setPrice] = useState<[number, number]>([0, maxPrice]);
  const [cal, setCal] = useState(maxCal);
  const [prot, setProt] = useState(0);
  const [sort, setSort] = useState<"popular" | "price" | "protein">("popular");
  const [open, setOpen] = useState<MenuItem | null>(null);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    let list = items.filter((i) => {
      if (s && ![i.item_name_en, i.item_name_ar, i.description_en, i.section, ...(i.ingredients ?? [])].some((x) => (x ?? "").toLowerCase().includes(s))) return false;
      if (diets.some((d) => !i[d as keyof MenuItem])) return false;
      if (avoid.length && (i.allergen_list ?? []).some((a) => avoid.includes(a))) return false;
      if ((i.spice_level ?? 0) > spice) return false;
      const p = Number(i.price_usd);
      if (i.price_usd != null && (p < price[0] || p > price[1])) return false;
      if (cal < maxCal && (i.calories == null || i.calories > cal)) return false;
      if (prot > 0 && (i.protein_grams == null || i.protein_grams < prot)) return false;
      return true;
    });
    if (sort === "price") list = [...list].sort((a, b) => (Number(a.price_usd) || 1e9) - (Number(b.price_usd) || 1e9));
    else if (sort === "protein") list = [...list].sort((a, b) => (Number(b.protein_grams) || 0) - (Number(a.protein_grams) || 0));
    else list = [...list].sort((a, b) => Number(!!b.is_popular) - Number(!!a.is_popular) || Number(!!b.is_chef_pick) - Number(!!a.is_chef_pick) || (a.sort_order ?? 9999) - (b.sort_order ?? 9999) || itemName(a, "en").localeCompare(itemName(b, "en")));
    return list;
  }, [items, q, diets, avoid, spice, price, cal, prot, sort, maxCal]);

  const sections = useMemo(() => {
    const m = new Map<string, { order: number; items: MenuItem[] }>();
    filtered.forEach((i) => {
      const s = clean(i.section) || L("Menu", "المنيو");
      const e = m.get(s) ?? { order: 1e9, items: [] };
      e.order = Math.min(e.order, i.sort_order ?? 1e9);
      e.items.push(i);
      m.set(s, e);
    });
    return [...m.entries()].sort((a, b) => a[1].order - b[1].order || a[0].localeCompare(b[0]));
  }, [filtered, L]);

  const reset = () => { setQ(""); setDiets([]); setAvoid([]); setSpice(4); setPrice([0, maxPrice]); setCal(maxCal); setProt(0); };

  if (!items.length)
    return (
      <div className="lux-card p-10 text-center">
        <UtensilsCrossed className="mx-auto size-10 text-gold" />
        <p className="mt-3 text-muted-foreground">{L("No menu yet. Ask on WhatsApp what's available today.", "ما في منيو بعد. اسأل على واتساب شو في اليوم.")}</p>
      </div>
    );

  return (
    <div>
      <div className="sticky top-16 z-20 -mx-5 space-y-3 border-b border-border bg-background/90 px-5 py-3 backdrop-blur">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("Search this menu", "ابحث بالمنيو")} className="ps-9" />
          </div>
          <Select value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="popular">{L("Popular", "الأكثر طلباً")}</SelectItem>
              <SelectItem value="price">{L("Price low–high", "السعر تصاعدي")}</SelectItem>
              <SelectItem value="protein">{L("Protein high–low", "بروتين أعلى")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2 overflow-x-auto">
          {sections.map(([s]) => (
            <button key={s} onClick={() => document.getElementById(slug(s))?.scrollIntoView({ behavior: "smooth", block: "start" })} className="shrink-0 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:border-gold hover:text-gold">
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {DIETS.map((d) => {
          const on = diets.includes(d.k as string);
          return (
            <button key={d.k as string} aria-pressed={on} onClick={() => setDiets(on ? diets.filter((x) => x !== d.k) : [...diets, d.k as string])} className={cn("rounded-full border px-3 py-1 text-xs", on ? "border-success bg-success/15 text-success" : "border-border text-muted-foreground")}>
              {L(d.en, d.ar)}
            </button>
          );
        })}
      </div>

      <Collapsible className="mt-3">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm"><SlidersHorizontal /> {L("More filters", "فلاتر إضافية")}{avoid.length ? ` · ${avoid.length}` : ""}</Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="lux-card mt-2 space-y-5 p-4">
          <div>
            <p className="mb-2 text-sm font-medium">{L("Avoid allergens", "تجنّب مسببات الحساسية")}</p>
            <AllergenPicker value={avoid} onChange={setAvoid} tone="avoid" />
            <p className="mt-2 text-xs text-muted-foreground">{L("Ask the restaurant if you have a serious allergy.", "اسأل المطعم إذا عندك حساسية قوية.")}</p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <SliderRow label={`${L("Max spice", "أقصى حدّة")}: ${spice}`} value={[spice]} max={4} onChange={(v) => setSpice(v[0]!)} />
            <SliderRow label={`${L("Price", "السعر")}: $${price[0]}–$${price[1]}`} value={price} max={maxPrice} onChange={(v) => setPrice([v[0]!, v[1]!])} />
            <SliderRow label={`${L("Max calories", "أقصى سعرات")}: ${cal >= maxCal ? L("any", "أي") : cal}`} value={[cal]} max={maxCal} step={50} onChange={(v) => setCal(v[0]!)} />
            <SliderRow label={`${L("Min protein", "أدنى بروتين")}: ${prot}g`} value={[prot]} max={maxProt} onChange={(v) => setProt(v[0]!)} />
          </div>
          <Button variant="hairline" size="sm" onClick={reset}>{L("Reset", "مسح")}</Button>
        </CollapsibleContent>
      </Collapsible>

      {sections.length === 0 && <p className="py-12 text-center text-muted-foreground">{L("No dishes match these filters.", "ما في أصناف مطابقة.")}</p>}
      <div className="mt-6 space-y-8">
        {sections.map(([s, { items: list }]) => (
          <section key={s} id={slug(s)} className="scroll-mt-44">
            <h3 className="mb-3 text-2xl font-semibold">{s} <span className="text-sm text-muted-foreground">{list.length}</span></h3>
            <div className="grid gap-3 md:grid-cols-2">
              {list.map((i) => <ItemCard key={i.item_id} i={i} onOpen={() => setOpen(i)} />)}
            </div>
          </section>
        ))}
      </div>
      <ItemDrawer item={open} vendorName={vendorName} onClose={() => setOpen(null)} />
      <span className="hidden">{lang}</span>
    </div>
  );
}

function SliderRow({ label, value, max, step = 1, onChange }: { label: string; value: number[]; max: number; step?: number; onChange: (v: number[]) => void }) {
  return (
    <div>
      <p className="mb-2 text-sm">{label}</p>
      <Slider value={value} max={max} min={0} step={step} onValueChange={onChange} />
    </div>
  );
}
