import { Flame, Settings2, Star, ChefHat, UtensilsCrossed } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { lbp, usd } from "@/lib/format";
import { clean, type MenuItem } from "@/lib/vendor";
import { useLang, useL } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const itemName = (i: MenuItem, lang: "en" | "ar") =>
  (lang === "ar" ? clean(i.item_name_ar) || clean(i.item_name_en) : clean(i.item_name_en) || clean(i.item_name_ar)) || "Item";

export function Chilis({ level }: { level: number | null | undefined }) {
  if (!level) return null;
  return (
    <span className="inline-flex items-center text-destructive" aria-label={`Spice level ${level}`}>
      {Array.from({ length: level }).map((_, i) => <Flame key={i} className="size-3.5" />)}
    </span>
  );
}

export function MacroChip({ i }: { i: MenuItem }) {
  const L = useL();
  if (i.calories == null && i.protein_grams == null) return null;
  const verified = !!i.nutrition_verified;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px]", verified ? "bg-success/15 text-success" : "bg-muted text-muted-foreground")}>
            {[i.calories != null && `~${Math.round(i.calories)} kcal`, i.protein_grams != null && `${Math.round(i.protein_grams)}g ${L("protein", "بروتين")}`].filter(Boolean).join(" · ")}
            <span className="opacity-70">· {verified ? L("Owner verified", "موثّق من المالك") : L("AI estimate", "تقدير ذكي")}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-60">
          {verified
            ? L("Values confirmed by the restaurant.", "القيم مؤكدة من المطعم.")
            : L("Estimated by AI from the dish description. Real values may differ.", "تقدير بالذكاء الاصطناعي من وصف الطبق. القيم الفعلية ممكن تختلف.")}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function ItemBadges({ i }: { i: MenuItem }) {
  const L = useL();
  const b: [boolean | null | undefined, string, string][] = [
    [i.is_vegan, "Vegan", "نباتي صرف"],
    [!i.is_vegan && i.is_vegetarian, "Vegetarian", "نباتي"],
    [i.is_gluten_free, "GF", "بلا غلوتين"],
    [i.is_keto, "Keto", "كيتو"],
    [i.is_halal, "Halal", "حلال"],
  ];
  return (
    <div className="flex flex-wrap items-center gap-1">
      {i.is_popular && <span className="inline-flex items-center gap-1 rounded-full bg-gold/15 px-2 py-0.5 text-[11px] text-gold"><Star className="size-3" />{L("Popular", "الأكثر طلباً")}</span>}
      {i.is_chef_pick && <span className="inline-flex items-center gap-1 rounded-full bg-gold/15 px-2 py-0.5 text-[11px] text-gold"><ChefHat className="size-3" />{L("Chef's pick", "اختيار الشيف")}</span>}
      {b.filter(([on]) => on).map(([, en, ar]) => <span key={en} className="rounded-full bg-success/15 px-2 py-0.5 text-[11px] text-success">{L(en, ar)}</span>)}
      <Chilis level={i.spice_level} />
    </div>
  );
}

export function ItemCard({ i, onOpen }: { i: MenuItem; onOpen: () => void }) {
  const { lang } = useLang();
  const L = useL();
  const desc = lang === "ar" ? clean(i.description_ar) || clean(i.description_en) : clean(i.description_en) || clean(i.description_ar);
  const altName = lang === "ar" ? clean(i.item_name_en) : clean(i.item_name_ar);
  return (
    <button onClick={onOpen} className={cn("lux-card flex w-full gap-3 p-3 text-start transition hover:border-gold/40", i.available === false && "opacity-60")}>
      <div className="min-w-0 flex-1">
        <p className="font-semibold leading-tight">{itemName(i, lang)}</p>
        {altName && <p className="truncate text-xs text-muted-foreground">{altName}</p>}
        {desc && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{desc}</p>}
        <div className="mt-2 space-y-1.5">
          <ItemBadges i={i} />
          <div className="flex flex-wrap gap-1">
            <MacroChip i={i} />
            {!i.allergens_reviewed && <span className="rounded-full border border-warning/40 px-2 py-0.5 text-[10px] text-warning">{L("allergens unconfirmed", "الحساسية غير مؤكدة")}</span>}
            {!!i.customizations?.length && <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"><Settings2 className="size-3" />{L("Options", "خيارات")}</span>}
            {i.available === false && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px]">{L("Unavailable", "غير متوفر")}</span>}
          </div>
        </div>
        {i.price_usd != null && (
          <p className="mt-2 text-sm">
            <span className="font-semibold text-gold">{usd(i.price_usd)}</span>{" "}
            <span className="text-xs text-muted-foreground">{lbp(i.price_usd)}</span>
          </p>
        )}
      </div>
      <div className="size-24 shrink-0 overflow-hidden rounded-lg bg-gradient-to-br from-emerald/50 to-card">
        {clean(i.image_url) ? (
          <img src={i.image_url!} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full place-items-center"><UtensilsCrossed className="size-7 text-foreground/15" /></div>
        )}
      </div>
    </button>
  );
}
