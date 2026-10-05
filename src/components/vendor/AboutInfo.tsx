import { Car, Facebook, Globe, Instagram, Map as MapIcon, Music, Music2, ParkingSquare, ShoppingBag, Sofa, Trees, Users, Utensils, Wifi, Baby, type LucideIcon } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { LazyVendorMap } from "@/components/maps/LazyVendorMap";
import { usd } from "@/lib/format";
import { DAYS, DAY_LABEL, FEATURES, beirutNow, clean, type VendorPage } from "@/lib/vendor";
import { useLang, useL } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/explore/VendorCard";

const FEATURE_ICON: Record<string, LucideIcon> = {
  dine_in: Utensils, takeaway: ShoppingBag, outdoor_seating: Trees, parking: ParkingSquare, wifi: Wifi,
  kids_friendly: Baby, family_section: Users, catering: Car, live_music: Music,
};

export function hasAbout(p: VendorPage["profile"]) {
  return !!p && !!(clean(p.story) || clean(p.description_en) || clean(p.description_ar) || p.established_year || p.cuisine_tags?.length || p.features?.length || p.gallery_urls?.length);
}

export function AboutTab({ page }: { page: VendorPage }) {
  const L = useL();
  const { lang } = useLang();
  const p = page.profile!;
  const desc = lang === "ar" ? clean(p.description_ar) || clean(p.description_en) : clean(p.description_en) || clean(p.description_ar);
  return (
    <div className="space-y-8">
      {desc && <p className="text-lg leading-relaxed text-muted-foreground">{desc}</p>}
      {clean(p.story) && (
        <div>
          <h3 className="mb-2 text-2xl font-semibold">{L("Our story", "قصتنا")}</h3>
          <p className="whitespace-pre-line leading-relaxed text-muted-foreground">{p.story}</p>
        </div>
      )}
      {(p.established_year || p.opened_on) && <p className="text-sm text-gold">{L("Established", "تأسس")} {p.established_year ?? p.opened_on?.slice(0, 4)}</p>}
      {!!p.cuisine_tags?.length && (
        <div className="flex flex-wrap gap-2">{p.cuisine_tags.map((t) => <span key={t} className="rounded-full bg-secondary/50 px-3 py-1 text-sm">{t}</span>)}</div>
      )}
      {!!p.features?.length && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {FEATURES.filter((f) => p.features!.includes(f.key)).map((f) => {
            const I = FEATURE_ICON[f.key] ?? Sofa;
            return <div key={f.key} className="flex items-center gap-2 rounded-lg border border-border p-3 text-sm"><I className="size-4 text-gold" />{L(f.en, f.ar)}</div>;
          })}
        </div>
      )}
      {!!p.gallery_urls?.length && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {p.gallery_urls.map((u) => <img key={u} src={u} alt="" loading="lazy" className="aspect-square w-full rounded-lg object-cover" />)}
        </div>
      )}
    </div>
  );
}

export function InfoTab({ page }: { page: VendorPage }) {
  const L = useL();
  const p = page.profile;
  const v = page.vendor;
  const today = beirutNow().day;
  const hours = p?.hours && Object.keys(p.hours).length ? p.hours : null;
  const socials = p
    ? ([
        [p.instagram_url, Instagram, "Instagram"],
        [p.facebook_url, Facebook, "Facebook"],
        [p.tiktok_url, Music2, "TikTok"],
        [p.website_url, Globe, L("Website", "الموقع")],
        [p.google_maps_url, MapIcon, "Google Maps"],
      ] as const).filter(([u]) => clean(u))
    : [];
  const delivery = p && (p.delivery_villages?.length || p.delivery_radius_km || p.min_order_usd || p.prep_time_min || p.accepts_usd != null || p.accepts_lbp != null);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {hours && (
        <div className="lux-card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-2xl font-semibold">{L("Hours", "الدوام")}</h3>
            <StatusBadge open={page.open_now} />
          </div>
          <table className="w-full text-sm">
            <tbody>
              {DAYS.map((d) => (
                <tr key={d} className={cn("border-b border-border/40", d === today && "font-semibold text-gold")}>
                  <td className="py-1.5">{L(...DAY_LABEL[d])}</td>
                  <td className="py-1.5 text-end">{hours[d]?.length ? hours[d]!.map((r) => `${r[0]}–${r[1]}`).join(", ") : L("Closed", "مسكّر")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted-foreground">{L("Times in Lebanon (Beirut) time.", "الأوقات بتوقيت بيروت.")}</p>
        </div>
      )}
      {delivery && p && (
        <div className="lux-card space-y-2 p-5 text-sm">
          <h3 className="mb-2 text-2xl font-semibold">{L("Delivery & payment", "التوصيل والدفع")}</h3>
          {!!p.delivery_villages?.length && <p><span className="text-muted-foreground">{L("Delivers to", "بيوصل على")}:</span> {p.delivery_villages.join(", ")}</p>}
          {!!p.delivery_radius_km && <p><span className="text-muted-foreground">{L("Radius", "المسافة")}:</span> {p.delivery_radius_km} km</p>}
          {!!p.min_order_usd && <p><span className="text-muted-foreground">{L("Minimum order", "الحد الأدنى")}:</span> {usd(p.min_order_usd)}</p>}
          {!!p.prep_time_min && <p><span className="text-muted-foreground">{L("Prep time", "وقت التحضير")}:</span> {p.prep_time_min}{p.prep_time_max ? `–${p.prep_time_max}` : ""} min</p>}
          {(p.accepts_usd != null || p.accepts_lbp != null) && (
            <p><span className="text-muted-foreground">{L("Pay in", "الدفع")}:</span> {[p.accepts_usd && "USD", p.accepts_lbp && "LBP"].filter(Boolean).join(" · ") || "—"}</p>
          )}
        </div>
      )}
      {v.latitude != null && v.longitude != null && (
        <div className="space-y-2 lg:col-span-2">
          <LazyVendorMap lat={Number(v.latitude)} lng={Number(v.longitude)} className="h-72" />
          {clean(v.address) && <p className="text-sm text-muted-foreground">{v.address}</p>}
        </div>
      )}
      {socials.length > 0 && (
        <div className="flex flex-wrap gap-2 lg:col-span-2">
          {socials.map(([u, I, label]) => (
            <a key={label} href={u!} target="_blank" rel="noreferrer" className="hairline flex items-center gap-2 rounded-full px-4 py-2 text-sm text-gold hover:bg-gold/10">
              <I className="size-4" /> {label}
            </a>
          ))}
        </div>
      )}
      {!!p?.faqs?.length && (
        <div className="lg:col-span-2">
          <h3 className="mb-2 text-2xl font-semibold">{L("FAQ", "أسئلة شائعة")}</h3>
          <Accordion type="single" collapsible>
            {p.faqs.filter((f) => clean(f.q)).map((f, i) => (
              <AccordionItem key={i} value={String(i)}>
                <AccordionTrigger>{f.q}</AccordionTrigger>
                <AccordionContent className="text-muted-foreground">{f.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      )}
      {(clean(p?.allergen_policy) || p?.halal_certified) && (
        <div className="lux-card p-5 text-sm lg:col-span-2">
          <h3 className="mb-2 text-xl font-semibold">{L("Allergen policy", "سياسة الحساسية")}</h3>
          {p?.halal_certified && <p className="mb-1 text-success">{L("Halal certified", "حلال معتمد")}</p>}
          {clean(p?.allergen_policy) && <p className="text-muted-foreground">{p!.allergen_policy}</p>}
          <p className="mt-2 text-xs text-muted-foreground">{L("Ask the restaurant if you have a serious allergy.", "اسأل المطعم إذا عندك حساسية قوية.")}</p>
        </div>
      )}
    </div>
  );
}
