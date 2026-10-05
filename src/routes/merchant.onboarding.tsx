import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2, Circle, Crown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMenuItems, useMerchant, useVendorPrivate, useVendorProfile } from "@/components/merchant/context";
import { useL } from "@/lib/i18n";

export const Route = createFileRoute("/merchant/onboarding")({
  head: () => ({ meta: [{ title: "Welcome — Alo King Merchant" }, { name: "robots", content: "noindex" }] }),
  component: Onboarding,
});

function Onboarding() {
  const L = useL();
  const { vendorId } = useMerchant();
  const p = useVendorProfile(vendorId).data;
  const priv = useVendorPrivate(vendorId).data;
  const items = useMenuItems(vendorId).data;
  const steps = [
    { done: !!p?.hours && Object.values(p.hours).some((r) => r?.length), en: "Set your opening hours", ar: "حدّد أوقات الدوام", to: "/merchant/profile" as const },
    { done: !!(p?.delivery_villages?.length || p?.delivery_radius_km), en: "Choose your delivery area", ar: "اختار مناطق التوصيل", to: "/merchant/profile" as const },
    { done: !!items?.length, en: "Upload your menu", ar: "ارفع المنيو", to: "/merchant/menu/import" as const },
    { done: !!priv?.owner_phone_urgent, en: "Add an urgent phone number", ar: "أضف رقم للطوارئ", to: "/merchant/profile" as const },
  ];
  const n = steps.filter((s) => s.done).length;
  return (
    <div className="mx-auto max-w-xl p-4 md:p-8">
      <div className="text-center">
        <Crown className="mx-auto size-10 text-gold" />
        <h1 className="mt-3 text-4xl font-semibold">{L("Welcome to Alo King", "أهلا فيك بألو كينغ")}</h1>
        <p className="mt-2 text-muted-foreground">{L("Four quick steps and your page is ready for orders.", "أربع خطوات سريعة وصفحتك جاهزة للطلبات.")} ({n}/4)</p>
      </div>
      <ol className="mt-8 space-y-3">
        {steps.map((s) => (
          <li key={s.en}>
            <Link to={s.to} className="lux-card flex items-center gap-3 p-4 hover:border-gold/50">
              {s.done ? <CheckCircle2 className="size-6 text-success" /> : <Circle className="size-6 text-muted-foreground" />}
              <span className={s.done ? "text-muted-foreground line-through" : ""}>{L(s.en, s.ar)}</span>
            </Link>
          </li>
        ))}
      </ol>
      <Button variant="gold" className="mt-8 w-full" size="lg" asChild><Link to="/merchant">{L("Go to dashboard", "روح عاللوحة")}</Link></Button>
    </div>
  );
}
