import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, ClipboardList, Crown, Search, Sparkles, Store } from "lucide-react";
import { SiteHeader } from "@/components/landing/SiteHeader";
import { Footer } from "@/components/landing/HowItWorks";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { exploreVendors } from "@/lib/explore";
import { clean } from "@/lib/vendor";
import { useL } from "@/lib/i18n";

const TITLE = "Alo King for business — claim your Shouf merchant page";
const DESC =
  "Own your page, let the AI assistant build your menu, and receive WhatsApp orders in a live dashboard.";

export const Route = createFileRoute("/for-business")({
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
  component: ForBusiness,
});

function ForBusiness() {
  const L = useL();
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDq(q.trim()), 350);
    return () => clearTimeout(id);
  }, [q]);
  const res = useQuery({
    queryKey: ["biz-search", dq],
    enabled: dq.length >= 2,
    queryFn: () => exploreVendors({ q: dq, sort: "relevance" }, 8, 0),
  });
  const benefits = [
    {
      I: Store,
      t: L("Your own page", "صفحتك الخاصة"),
      d: L(
        "Photos, hours, delivery area and a verified badge customers trust.",
        "صور، دوام، مناطق توصيل وشارة توثيق بيثق فيها الزباين.",
      ),
    },
    {
      I: Sparkles,
      t: L("AI menu assistant", "مساعد منيو ذكي"),
      d: L(
        "Snap your paper menu, the assistant types it up, adds descriptions, allergens and macros for you to review.",
        "صوّر المنيو الورقي، المساعد بيكتبه وبيضيف الوصف والحساسية والقيم الغذائية لتراجعها.",
      ),
    },
    {
      I: ClipboardList,
      t: L("Orders dashboard", "لوحة الطلبات"),
      d: L(
        "WhatsApp orders arrive on a live kitchen screen with a chime. Accept, prep, hand off.",
        "طلبات واتساب بتوصل على شاشة المطبخ مع رنّة. اقبل، حضّر، سلّم.",
      ),
    },
  ];
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main>
        <section className="bg-hero">
          <div className="mx-auto max-w-4xl px-5 py-20 text-center">
            <Crown className="mx-auto size-10 text-gold" />
            <p className="mt-4 text-xs uppercase tracking-[0.3em] text-gold">
              {L("For business", "لأصحاب المحلات")}
            </p>
            <h1 className="mt-3 text-5xl font-semibold md:text-6xl">
              {L("Your business is already on the map.", "محلّك صار على الخريطة.")}
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
              {L(
                "Claim it for free to fix your details, publish your real menu and take orders on WhatsApp.",
                "استلمه مجاناً لتصحّح معلوماتك، تنشر المنيو الحقيقي، وتستقبل طلبات على واتساب.",
              )}
            </p>
            <div className="relative mx-auto mt-8 max-w-xl text-start">
              <Search className="absolute start-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={L("Find your business by name…", "فتّش عن محلك بالاسم…")}
                className="h-14 rounded-2xl ps-12 text-base"
                aria-label={L("Find your business", "فتّش عن محلك")}
              />
            </div>
            {dq.length >= 2 && (
              <div className="lux-card mx-auto mt-3 max-w-xl divide-y divide-border text-start">
                {res.isLoading && (
                  <div className="p-4">
                    <Skeleton className="h-10" />
                  </div>
                )}
                {res.data?.length === 0 && (
                  <p className="p-4 text-sm text-muted-foreground">
                    {L(
                      "No match. Message us on WhatsApp and we'll add you.",
                      "ما في نتيجة. راسلنا على واتساب ومنضيفك.",
                    )}
                  </p>
                )}
                {res.data?.map((v) => (
                  <Link
                    key={v.vendor_id}
                    to="/claim/$slug"
                    params={{ slug: v.slug }}
                    className="flex items-center justify-between gap-3 p-4 hover:bg-gold/5"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{clean(v.name_en) || clean(v.name_ar)}</p>
                      <p className="text-xs text-muted-foreground">
                        {v.category} · {v.village}
                      </p>
                    </div>
                    {v.claimed ? (
                      <span className="flex shrink-0 items-center gap-1 text-xs text-gold">
                        <BadgeCheck className="size-4" />
                        {L("Verified", "موثّق")}
                      </span>
                    ) : (
                      <span className="shrink-0 rounded-full bg-gold-gradient px-3 py-1 text-xs font-semibold text-gold-foreground">
                        {L("Claim", "استلم")}
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>
        <section className="mx-auto grid max-w-6xl gap-5 px-5 py-20 md:grid-cols-3">
          {benefits.map(({ I, t, d }) => (
            <div key={t} className="lux-card p-6">
              <I className="size-7 text-gold" />
              <h2 className="mt-4 text-2xl font-semibold">{t}</h2>
              <p className="mt-2 text-muted-foreground">{d}</p>
            </div>
          ))}
        </section>
      </main>
      <Footer />
    </div>
  );
}
