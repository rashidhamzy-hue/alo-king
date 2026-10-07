import { Link } from "@tanstack/react-router";
import { BadgeCheck, MapPin, UtensilsCrossed } from "lucide-react";
import { clean, categoryGradient, priceTier, type ExploreRow } from "@/lib/vendor";
import { useLang, useL } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { CategoryIcon, catLabel } from "./categories";

export function StatusBadge({ open }: { open: boolean | null | undefined }) {
  const L = useL();
  if (open === true)
    return (
      <span className="rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success">
        {L("Open now", "مفتوح الآن")}
      </span>
    );
  if (open === false)
    return (
      <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-medium text-destructive">
        {L("Closed", "مسكّر")}
      </span>
    );
  return (
    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
      {L("Hours not listed", "الدوام غير محدد")}
    </span>
  );
}

export function VerifiedBadge({ className }: { className?: string }) {
  const L = useL();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-gold/15 px-2 py-0.5 text-[11px] font-medium text-gold",
        className,
      )}
    >
      <BadgeCheck className="size-3.5" /> {L("Verified by owner", "موثّق من المالك")}
    </span>
  );
}

export function VendorCard({ v, showMatches }: { v: ExploreRow; showMatches?: boolean }) {
  const { lang } = useLang();
  const L = useL();
  const en = clean(v.name_en);
  const ar = clean(v.name_ar);
  const tagline =
    lang === "ar"
      ? clean(v.tagline_ar) || clean(v.tagline_en)
      : clean(v.tagline_en) || clean(v.tagline_ar);
  const tier = priceTier(v.price_tier);
  return (
    <Link
      to="/m/$slug"
      params={{ slug: v.slug }}
      className="lux-card group block overflow-hidden transition hover:-translate-y-0.5 hover:shadow-glow-emerald focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className={cn("relative h-32 bg-gradient-to-br", categoryGradient(v.category))}>
        {clean(v.cover_url) ? (
          <img
            src={v.cover_url!}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition group-hover:scale-105"
          />
        ) : (
          <CategoryIcon
            cat={v.category}
            className="absolute end-4 top-4 size-14 text-foreground/10"
          />
        )}
        <div className="absolute start-3 top-3 flex gap-1.5">
          <StatusBadge open={v.open_now} />
        </div>
        {clean(v.logo_url) && (
          <img
            src={v.logo_url!}
            alt=""
            loading="lazy"
            className="absolute -bottom-6 start-4 size-14 rounded-full border-2 border-gold/60 bg-card object-cover"
          />
        )}
      </div>
      <div className={cn("p-4", clean(v.logo_url) && "pt-8")}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-xl font-semibold">{en || ar || "Unnamed"}</h3>
            {ar && en && (
              <p dir="rtl" className="font-arabic truncate text-sm text-muted-foreground">
                {ar}
              </p>
            )}
          </div>
          {tier && <span className="shrink-0 text-sm font-semibold text-gold">{tier}</span>}
        </div>
        {tagline && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{tagline}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {v.category && (
            <span className="flex items-center gap-1">
              <CategoryIcon cat={v.category} className="size-3.5 text-gold" />
              {catLabel(v.category, lang)}
            </span>
          )}
          {clean(v.village) && (
            <span className="flex items-center gap-1">
              <MapPin className="size-3.5 text-gold" />
              {v.village}
            </span>
          )}
          {!!v.menu_count && (
            <span className="flex items-center gap-1">
              <UtensilsCrossed className="size-3.5 text-gold" />
              {v.menu_count} {L("dishes", "صنف")}
            </span>
          )}
        </div>
        {v.claimed && <VerifiedBadge className="mt-3" />}
        {showMatches && !!v.matched_items?.length && (
          <div className="mt-3 flex flex-wrap gap-1">
            {v.matched_items.slice(0, 4).map((m) => (
              <span key={m} className="rounded-full bg-secondary/50 px-2 py-0.5 text-[11px]">
                {m}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}
