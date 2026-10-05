import { useState } from "react";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { queryOptions, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Crown, MapPin, MessageCircle, Navigation, Phone, Share2, Store } from "lucide-react";
import { toast } from "sonner";
import { SiteHeader } from "@/components/landing/SiteHeader";
import { Footer } from "@/components/landing/HowItWorks";
import { StatusBadge, VerifiedBadge } from "@/components/explore/VendorCard";
import { CategoryIcon, catLabel } from "@/components/explore/categories";
import { MenuTab } from "@/components/vendor/MenuTab";
import { AboutTab, InfoTab, hasAbout } from "@/components/vendor/AboutInfo";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/lib/supabase";
import { categoryGradient, clean, mapsLink, openFromHours, priceTier, vendorName, waLink, type MenuItem, type VendorPage } from "@/lib/vendor";
import { useLang, useL } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const pageQuery = (slug: string) =>
  queryOptions({
    queryKey: ["vendor-page", slug],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_vendor_page", { p_slug: slug });
      if (error) throw error;
      return (data ?? null) as VendorPage | null;
    },
  });

export const Route = createFileRoute("/m/$slug")({
  loader: async ({ context, params }) => {
    const page = await context.queryClient.ensureQueryData(pageQuery(params.slug));
    if (!page?.vendor) throw notFound();
    return { name: vendorName(page.vendor), village: clean(page.vendor.village_canonical), cover: clean(page.profile?.cover_url), tagline: clean(page.profile?.tagline_en) };
  },
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: "Merchant not found — Alo King" }, { name: "robots", content: "noindex" }] };
    const title = `${loaderData.name}${loaderData.village ? `, ${loaderData.village}` : ""} — Order on WhatsApp | Alo King`;
    const desc = loaderData.tagline || `Menu, hours and WhatsApp ordering for ${loaderData.name} in the Shouf, Lebanon.`;
    const img = loaderData.cover?.startsWith("https://") ? loaderData.cover : null;
    return {
      meta: [
        { title },
        { name: "description", content: desc },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
        ...(img ? [{ property: "og:image", content: img }, { name: "twitter:image", content: img }] : []),
      ],
    };
  },
  component: MerchantPage,
  notFoundComponent: NotFoundVendor,
  errorComponent: () => <NotFoundVendor error />,
});

function NotFoundVendor({ error }: { error?: boolean }) {
  const L = useL();
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <div className="mx-auto max-w-md px-5 py-24 text-center">
        <Store className="mx-auto size-12 text-gold" />
        <h1 className="mt-4 text-4xl font-semibold">{error ? L("This page didn't load", "الصفحة ما تحمّلت") : L("We couldn't find this merchant", "ما لقينا هالمحل")}</h1>
        <p className="mt-2 text-muted-foreground">{L("It may have moved. Browse the directory to find it.", "يمكن انتقل. فتّش عليه بالدليل.")}</p>
        <Button variant="gold" className="mt-6" asChild><Link to="/explore">{L("Explore merchants", "استكشف المحلات")}</Link></Button>
      </div>
    </div>
  );
}

function MerchantPage() {
  const { slug } = Route.useParams();
  const { data: page } = useSuspenseQuery(pageQuery(slug));
  const L = useL();
  const { lang } = useLang();
  const [tab, setTab] = useState("menu");
  const v = page!.vendor;
  const p = page!.profile;
  const name = vendorName(v);
  const ar = clean(v.name_ar);
  const open = page!.open_now ?? openFromHours(p?.hours);
  const itemsQ = useQuery({
    queryKey: ["menu", v.vendor_id],
    queryFn: async () => {
      const { data, error } = await supabase.from("menu_items").select("*").eq("vendor_id", v.vendor_id).order("sort_order", { ascending: true, nullsFirst: false }).limit(1000);
      if (error) throw error;
      return (data ?? []) as MenuItem[];
    },
  });
  const tagline = lang === "ar" ? clean(p?.tagline_ar) || clean(p?.tagline_en) : clean(p?.tagline_en) || clean(p?.tagline_ar);
  const dir = mapsLink(v.latitude, v.longitude);
  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: name, url });
      else {
        await navigator.clipboard.writeText(url);
        toast.success(L("Link copied", "تم نسخ الرابط"));
      }
    } catch {
      /* cancelled */
    }
  };

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <div className={cn("relative h-56 bg-gradient-to-br md:h-72", categoryGradient(v.category_canonical))}>
        {clean(p?.cover_url) ? <img src={p!.cover_url!} alt="" className="h-full w-full object-cover" /> : <CategoryIcon cat={v.category_canonical} className="absolute end-10 top-10 size-32 text-foreground/10" />}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/30 to-transparent" />
      </div>
      <main className="mx-auto -mt-20 max-w-5xl px-5 pb-16">
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="grid size-24 shrink-0 place-items-center overflow-hidden rounded-2xl border-2 border-gold/60 bg-card">
            {clean(p?.logo_url) ? <img src={p!.logo_url!} alt="" className="h-full w-full object-cover" /> : <Crown className="size-10 text-gold" />}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap gap-2">
              <StatusBadge open={open} />
              {page!.claimed && <VerifiedBadge />}
            </div>
            <h1 className="mt-2 text-4xl font-semibold md:text-5xl">{name}</h1>
            {ar && clean(v.name_en) && <p dir="rtl" className="font-arabic text-lg text-muted-foreground">{ar}</p>}
            <p className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              {v.category_canonical && <span className="flex items-center gap-1"><CategoryIcon cat={v.category_canonical} className="size-4 text-gold" />{catLabel(v.category_canonical, lang)}</span>}
              {clean(v.village_canonical) && <span className="flex items-center gap-1"><MapPin className="size-4 text-gold" />{v.village_canonical}</span>}
              {priceTier(p?.price_tier) && <span className="font-semibold text-gold">{priceTier(p?.price_tier)}</span>}
            </p>
            {tagline && <p className="mt-2 text-muted-foreground">{tagline}</p>}
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <Button variant="gold" size="lg" asChild>
            <a href={waLink(`Hi Alo King, I'd like to order from ${name}`)} target="_blank" rel="noreferrer"><MessageCircle /> {L("Order on WhatsApp", "اطلب على واتساب")}</a>
          </Button>
          {dir && <Button variant="hairline" size="lg" asChild><a href={dir} target="_blank" rel="noreferrer"><Navigation /> {L("Directions", "الاتجاهات")}</a></Button>}
          {clean(p?.public_phone) && <Button variant="hairline" size="lg" asChild><a href={`tel:${p!.public_phone}`}><Phone /> {L("Call", "اتصل")}</a></Button>}
          <Button variant="hairline" size="lg" onClick={share}><Share2 /> {L("Share", "شارك")}</Button>
        </div>

        {!page!.claimed && (
          <div className="mt-6 space-y-3">
            <p className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
              {L("Menu compiled from public sources. Prices and details may differ until the owner verifies this page.", "المنيو مجمّع من مصادر عامة. الأسعار والتفاصيل ممكن تختلف لحتى يوثّق المالك الصفحة.")}
            </p>
            <Link to="/claim/$slug" params={{ slug }} className="flex items-center justify-between gap-3 rounded-xl bg-gold-gradient p-4 text-gold-foreground shadow-glow-gold">
              <span className="font-semibold">{L("Is this your business? Claim this page", "هيدا محلك؟ استلم الصفحة")}</span>
              <Crown className="size-5" />
            </Link>
          </div>
        )}

        <Tabs value={tab} onValueChange={setTab} className="mt-8">
          <TabsList>
            <TabsTrigger value="menu">{L("Menu", "المنيو")}{itemsQ.data ? ` (${itemsQ.data.length})` : ""}</TabsTrigger>
            {hasAbout(p) && <TabsTrigger value="about">{L("About", "عنّا")}</TabsTrigger>}
            <TabsTrigger value="info">{L("Info", "معلومات")}</TabsTrigger>
          </TabsList>
          <TabsContent value="menu" className="mt-4">
            {itemsQ.isLoading ? <div className="grid gap-3 md:grid-cols-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}</div>
              : itemsQ.isError ? <p className="text-destructive">{L("Couldn't load the menu.", "ما قدرنا نحمّل المنيو.")}</p>
              : <MenuTab items={itemsQ.data ?? []} vendorName={name} />}
          </TabsContent>
          {hasAbout(p) && <TabsContent value="about" className="mt-4"><AboutTab page={page!} /></TabsContent>}
          <TabsContent value="info" className="mt-4"><InfoTab page={page!} /></TabsContent>
        </Tabs>
      </main>
      <Footer />
    </div>
  );
}
