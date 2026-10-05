import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, Pause, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { CompletenessRing } from "@/components/shared/CompletenessRing";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { saveProfile, useCompleteness, useMerchant, useRefreshMerchant, useVendorProfile, type Completeness } from "@/components/merchant/context";
import { supabase } from "@/lib/supabase";
import { errMsg, lbp, startOfToday, usd } from "@/lib/format";
import { useL } from "@/lib/i18n";

export const Route = createFileRoute("/merchant/")({
  head: () => ({ meta: [{ title: "Home — Alo King Merchant" }, { name: "robots", content: "noindex" }] }),
  component: MerchantHome,
});

type Task = { key: string; en: string; ar: string; prompt: string; to: "/merchant/profile" | "/merchant/menu" | "/merchant/menu/import"; weight: number };

const PROFILE_TASKS: Record<string, Omit<Task, "key" | "weight">> = {
  hours: { en: "Add your opening hours", ar: "أضف أوقات الدوام", prompt: "Help me set my opening hours", to: "/merchant/profile" },
  description: { en: "Write a description", ar: "اكتب وصف للمحل", prompt: "Write my description in English and Arabic", to: "/merchant/profile" },
  tagline: { en: "Add a short tagline", ar: "أضف شعار قصير", prompt: "Suggest a tagline for my business", to: "/merchant/profile" },
  logo: { en: "Upload your logo", ar: "ارفع اللوغو", prompt: "Photo tips for my logo", to: "/merchant/profile" },
  cover: { en: "Upload a cover photo", ar: "ارفع صورة غلاف", prompt: "Photo tips for my cover photo", to: "/merchant/profile" },
  delivery: { en: "Set your delivery area", ar: "حدّد مناطق التوصيل", prompt: "Help me set my delivery area", to: "/merchant/profile" },
  urgent_phone: { en: "Add an urgent owner phone", ar: "أضف رقم طوارئ", prompt: "Why do you need my urgent phone number?", to: "/merchant/profile" },
};

function buildTasks(c: Completeness): Task[] {
  const t: Task[] = (c.missing_profile ?? []).map((k, i) => {
    const known = Object.entries(PROFILE_TASKS).find(([key]) => k.toLowerCase().includes(key));
    const base = known?.[1] ?? { en: `Complete: ${k.replace(/_/g, " ")}`, ar: `أكمل: ${k.replace(/_/g, " ")}`, prompt: `Help me fill in ${k.replace(/_/g, " ")}`, to: "/merchant/profile" as const };
    return { ...base, key: k, weight: 100 - i };
  });
  const m = c.menu;
  if (!m || !m.items) t.unshift({ key: "menu", en: "Upload your menu", ar: "ارفع المنيو", prompt: "How do I upload my menu?", to: "/merchant/menu/import", weight: 200 });
  else {
    const gap = (n: number) => m.items - (n ?? 0);
    if (gap(m.allergens_reviewed)) t.push({ key: "allergens", en: `Review allergens on ${gap(m.allergens_reviewed)} items`, ar: `راجع الحساسية لـ ${gap(m.allergens_reviewed)} صنف`, prompt: "Help me fill in allergens", to: "/merchant/menu", weight: 90 });
    if (gap(m.with_description)) t.push({ key: "desc", en: `Add descriptions to ${gap(m.with_description)} items`, ar: `أضف وصف لـ ${gap(m.with_description)} صنف`, prompt: "Write descriptions for my menu items", to: "/merchant/menu", weight: 70 });
    if (gap(m.with_photo)) t.push({ key: "photo", en: `Add photos to ${gap(m.with_photo)} items`, ar: `أضف صور لـ ${gap(m.with_photo)} صنف`, prompt: "Photo tips", to: "/merchant/menu", weight: 60 });
    if (gap(m.with_ingredients)) t.push({ key: "ingr", en: `List ingredients for ${gap(m.with_ingredients)} items`, ar: `أضف مكونات لـ ${gap(m.with_ingredients)} صنف`, prompt: "Help me list ingredients for my dishes", to: "/merchant/menu", weight: 50 });
    if (gap(m.macros_verified)) t.push({ key: "macros", en: `Confirm nutrition on ${gap(m.macros_verified)} items`, ar: `أكّد القيم الغذائية لـ ${gap(m.macros_verified)} صنف`, prompt: "How do I confirm nutrition values?", to: "/merchant/menu", weight: 30 });
  }
  return t.sort((a, b) => b.weight - a.weight);
}

function MerchantHome() {
  const L = useL();
  const { vendorId, openAssistant } = useMerchant();
  const cQ = useCompleteness(vendorId);
  const pQ = useVendorProfile(vendorId);
  const refresh = useRefreshMerchant();
  const todayQ = useQuery({
    queryKey: ["m-today", vendorId],
    queryFn: async () => {
      const { data, error } = await supabase.from("orders").select("total_usd,status").eq("vendor_id", vendorId).gte("created_at", startOfToday());
      if (error) throw error;
      const ok = (data ?? []).filter((o: { status: string }) => o.status !== "cancelled" && o.status !== "rejected");
      return { count: ok.length, revenue: ok.reduce((s: number, o: { total_usd: number | null }) => s + (Number(o.total_usd) || 0), 0) };
    },
  });
  const p = pQ.data;
  const paused = p?.paused_until && new Date(p.paused_until).getTime() > Date.now();
  const accepting = p?.accepts_orders !== false && !paused;

  async function setOrders(patch: { accepts_orders?: boolean; paused_until?: string | null }) {
    try {
      await saveProfile(vendorId, patch);
      await refresh(vendorId, ["profile", "completeness"]);
      toast.success(L("Saved", "تم الحفظ"));
    } catch (e) {
      toast.error(errMsg(e));
    }
  }
  const tomorrow = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(8, 0, 0, 0);
    return d.toISOString();
  };

  const tasks = cQ.data ? buildTasks(cQ.data) : [];

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
      <div className="grid gap-4 md:grid-cols-[1.2fr_1fr]">
        <div className="lux-card flex flex-col items-center gap-6 p-6 sm:flex-row">
          {cQ.isLoading ? <Skeleton className="size-36 rounded-full" /> : <CompletenessRing value={cQ.data?.overall ?? 0} label={L("AI readiness", "جاهزية الذكاء")} />}
          <div className="flex-1 space-y-3">
            <h1 className="text-3xl font-semibold">{L("AI readiness", "جاهزية الذكاء الاصطناعي")}</h1>
            <p className="text-sm text-muted-foreground">{L("The more complete your page, the better the WhatsApp assistant answers your customers.", "كل ما كانت صفحتك كاملة أكتر، كل ما جاوب المساعد زباينك أحسن.")}</p>
            <div className="flex gap-4">
              <div><p className="text-xs text-muted-foreground">{L("Profile", "الصفحة")}</p><p className="font-display text-2xl">{Math.round(cQ.data?.profile_score ?? 0)}%</p></div>
              <div><p className="text-xs text-muted-foreground">{L("Menu", "المنيو")}</p><p className="font-display text-2xl">{Math.round(cQ.data?.menu_score ?? 0)}%</p></div>
            </div>
          </div>
        </div>
        <div className="lux-card space-y-4 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold">{L("Accepting orders", "عم نستقبل طلبات")}</p>
              <p className="text-xs text-muted-foreground">{paused ? `${L("Paused until", "متوقف لحتى")} ${new Date(p!.paused_until!).toLocaleString()}` : accepting ? L("Customers can order now", "الزباين فيهن يطلبوا") : L("Orders are off", "الطلبات موقفة")}</p>
            </div>
            <Switch checked={accepting} onCheckedChange={(on) => setOrders(on ? { accepts_orders: true, paused_until: null } : { accepts_orders: false })} aria-label={L("Accepting orders", "استقبال الطلبات")} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="hairline" size="sm" onClick={() => setOrders({ paused_until: new Date(Date.now() + 3600_000).toISOString() })}><Pause /> {L("Pause 1 hour", "وقف ساعة")}</Button>
            <Button variant="hairline" size="sm" onClick={() => setOrders({ paused_until: tomorrow() })}><Pause /> {L("Until tomorrow", "لبكرا")}</Button>
          </div>
          <div className="grid grid-cols-2 gap-3 border-t border-border pt-4">
            <div><p className="text-xs text-muted-foreground">{L("Today's orders", "طلبات اليوم")}</p><p className="font-display text-3xl">{todayQ.data?.count ?? "—"}</p></div>
            <div><p className="text-xs text-muted-foreground">{L("Revenue", "المبيعات")}</p><p className="font-display text-3xl">{usd(todayQ.data?.revenue ?? 0)}</p><p className="text-xs text-muted-foreground">{lbp(todayQ.data?.revenue ?? 0)}</p></div>
          </div>
        </div>
      </div>

      <div className="lux-card p-6">
        <h2 className="text-2xl font-semibold">{L("What to do next", "شو الخطوة الجاية")}</h2>
        {cQ.isLoading && <Skeleton className="mt-4 h-40" />}
        {cQ.isError && <p className="mt-3 text-sm text-destructive">{errMsg(cQ.error)}</p>}
        {cQ.data && tasks.length === 0 && <p className="mt-4 flex items-center gap-2 text-success"><CheckCircle2 className="size-5" /> {L("Everything's complete. Great work!", "كل شي كامل. شغل ممتاز!")}</p>}
        <ul className="mt-4 divide-y divide-border">
          {tasks.map((t) => (
            <li key={t.key} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
              <span>{L(t.en, t.ar)}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => openAssistant(t.prompt)}><Sparkles /> {L("Fix with assistant", "صلّحها مع المساعد")}</Button>
                <Button size="sm" variant="hairline" asChild><Link to={t.to}>{L("Open", "افتح")} <ArrowRight className="rtl:rotate-180" /></Link></Button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
