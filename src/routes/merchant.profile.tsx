import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Camera, Loader2, Lock, Plus, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { HoursEditor } from "@/components/shared/HoursEditor";
import { TagInput } from "@/components/shared/TagInput";
import { PhotoTips } from "@/components/shared/PhotoTips";
import { CompletenessRing } from "@/components/shared/CompletenessRing";
import { LazyVendorMap } from "@/components/maps/LazyVendorMap";
import { ManageByWhatsAppCard } from "@/components/merchant/ManageByWhatsApp";
import { savePrivate, saveProfile, useCompleteness, useMerchant, useRefreshMerchant, useVendorPrivate, useVendorProfile, useVendorRow } from "@/components/merchant/context";
import { supabase } from "@/lib/supabase";
import { aiFriendly, invokeFn, resizeImage, uploadMedia } from "@/lib/edge";
import { errMsg } from "@/lib/format";
import { FEATURES, clean, uuid, type Hours, type VendorPrivate, type VendorProfile } from "@/lib/vendor";
import { useL } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/merchant/profile")({
  head: () => ({ meta: [{ title: "Profile — Alo King Merchant" }, { name: "robots", content: "noindex" }] }),
  component: ProfilePage,
});

const CUISINES = ["Lebanese", "Manakish", "Shawarma", "Grill", "Burgers", "Pizza", "Sandwiches", "Breakfast", "Desserts", "Coffee", "Seafood", "Healthy", "Vegan", "Mezze", "Bakery", "Juices"];
const LANGS = ["Arabic", "English", "French"];

// Track dirty sections globally for the unsaved-changes guard.
const dirtySet = new Set<string>();

function useSection<T extends object>(id: string, initial: T | undefined) {
  const [d, setD] = useState<T | undefined>(initial);
  const base = useRef<string>("");
  useEffect(() => {
    if (initial) {
      setD(initial);
      base.current = JSON.stringify(initial);
    }
  }, [initial]);
  const dirty = !!d && JSON.stringify(d) !== base.current;
  useEffect(() => {
    if (dirty) dirtySet.add(id);
    else dirtySet.delete(id);
    return () => { dirtySet.delete(id); };
  }, [dirty, id]);
  const set = <K extends keyof T>(k: K, v: T[K]) => setD((p) => (p ? { ...p, [k]: v } : p));
  const markSaved = () => { base.current = JSON.stringify(d); dirtySet.delete(id); setD((p) => (p ? { ...p } : p)); };
  return { d, set, dirty, markSaved };
}

function pick<T extends object, K extends keyof T>(o: T | undefined, keys: K[]): Pick<T, K> | undefined {
  if (!o) return undefined;
  return Object.fromEntries(keys.map((k) => [k, o[k] ?? null])) as Pick<T, K>;
}

function ProfilePage() {
  const L = useL();
  const { vendorId } = useMerchant();
  const pQ = useVendorProfile(vendorId);
  const privQ = useVendorPrivate(vendorId);
  const cQ = useCompleteness(vendorId);

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirtySet.size) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, []);

  if (pQ.isLoading || privQ.isLoading) return <div className="mx-auto max-w-3xl space-y-4 p-6"><Skeleton className="h-40" /><Skeleton className="h-64" /></div>;
  if (pQ.isError) return <p className="p-6 text-destructive">{errMsg(pQ.error)}</p>;
  const p = pQ.data!;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">{L("Your page", "صفحتك")}</h1>
          <p className="text-sm text-muted-foreground">{L("Each section saves on its own.", "كل قسم بينحفظ لحالو.")}</p>
        </div>
        <CompletenessRing value={cQ.data?.profile_score ?? 0} size={90} label={L("Profile", "الصفحة")} />
      </div>
      <ManageByWhatsAppCard vendorId={vendorId} />
      <BasicsSection p={p} />
      <HoursSection p={p} />
      <DeliverySection p={p} />
      <ContactSection p={p} />
      <PoliciesSection p={p} />
      <FaqSection p={p} />
      <AiSection p={p} />
      <PhotosSection p={p} />
      <PrivateSection priv={privQ.data} />
    </div>
  );
}

function Card({ title, children, dirty, onSave, busy, tone }: { title: string; children: ReactNode; dirty: boolean; onSave: () => void; busy: boolean; tone?: "private" }) {
  const L = useL();
  return (
    <section className={cn("lux-card space-y-4 p-5", tone === "private" && "border-dashed")}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-2xl font-semibold">{tone === "private" && <Lock className="size-4 text-gold" />}{title}</h2>
        {dirty && <span className="text-xs text-warning">{L("Unsaved changes", "تغييرات غير محفوظة")}</span>}
      </div>
      {children}
      <div className="flex justify-end">
        <Button variant="gold" disabled={!dirty || busy} onClick={onSave}>{busy ? L("Saving…", "عم يحفظ…") : L("Save", "احفظ")}</Button>
      </div>
    </section>
  );
}

function F({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">{label}</Label>{children}{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</div>;
}

function useSaver(kind: "profile" | "private") {
  const L = useL();
  const { vendorId } = useMerchant();
  const refresh = useRefreshMerchant();
  const [busy, setBusy] = useState(false);
  const save = async (patch: object, done: () => void) => {
    setBusy(true);
    try {
      if (kind === "profile") await saveProfile(vendorId, patch as Partial<VendorProfile>);
      else await savePrivate(vendorId, patch as Partial<VendorPrivate>);
      done();
      toast.success(L("Saved", "تم الحفظ"));
      await refresh(vendorId, [kind === "profile" ? "profile" : "priv", "completeness"]);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, save };
}

const num = (v: string) => (v === "" ? null : Number(v));

function BasicsSection({ p }: { p: VendorProfile }) {
  const L = useL();
  const init = useMemo(() => pick(p, ["tagline_en", "tagline_ar", "description_en", "description_ar", "story", "cuisine_tags", "features", "price_tier", "established_year", "opened_on"]), [p]);
  const { d, set, dirty, markSaved } = useSection("basics", init);
  const { busy, save } = useSaver("profile");
  if (!d) return null;
  return (
    <Card title={L("Basics", "الأساسيات")} dirty={dirty} busy={busy} onSave={() => save(d, markSaved)}>
      <div className="grid gap-3 sm:grid-cols-2">
        <F label={L("Tagline (English)", "الشعار (إنكليزي)")}><Input value={d.tagline_en ?? ""} onChange={(e) => set("tagline_en", e.target.value)} /></F>
        <F label={L("Tagline (Arabic)", "الشعار (عربي)")}><Input dir="rtl" value={d.tagline_ar ?? ""} onChange={(e) => set("tagline_ar", e.target.value)} /></F>
      </div>
      <F label={L("Description (English)", "الوصف (إنكليزي)")}><Textarea value={d.description_en ?? ""} onChange={(e) => set("description_en", e.target.value)} /></F>
      <F label={L("Description (Arabic)", "الوصف (عربي)")}><Textarea dir="rtl" value={d.description_ar ?? ""} onChange={(e) => set("description_ar", e.target.value)} /></F>
      <F label={L("Your story", "قصتك")}><Textarea rows={4} value={d.story ?? ""} onChange={(e) => set("story", e.target.value)} /></F>
      <F label={L("Cuisine tags", "نوع المطبخ")}><TagInput value={d.cuisine_tags ?? []} onChange={(v) => set("cuisine_tags", v)} suggestions={CUISINES} /></F>
      <F label={L("Features", "المميزات")}>
        <div className="flex flex-wrap gap-1.5">
          {FEATURES.map((f) => {
            const on = (d.features ?? []).includes(f.key);
            return <button type="button" key={f.key} aria-pressed={on} onClick={() => set("features", on ? (d.features ?? []).filter((x) => x !== f.key) : [...(d.features ?? []), f.key])} className={cn("rounded-full border px-3 py-1 text-xs", on ? "border-gold bg-gold/15 text-gold" : "border-border text-muted-foreground")}>{L(f.en, f.ar)}</button>;
          })}
        </div>
      </F>
      <div className="grid gap-3 sm:grid-cols-3">
        <F label={L("Price tier", "فئة السعر")}>
          <div className="flex gap-1">{[1, 2, 3, 4].map((n) => <Button key={n} type="button" size="sm" variant={d.price_tier === n ? "gold" : "hairline"} onClick={() => set("price_tier", n)}>{"$".repeat(n)}</Button>)}</div>
        </F>
        <F label={L("Established year", "سنة التأسيس")}><Input type="number" value={d.established_year ?? ""} onChange={(e) => set("established_year", num(e.target.value))} /></F>
        <F label={L("Opening date", "تاريخ الافتتاح")}><Input type="date" value={d.opened_on ?? ""} onChange={(e) => set("opened_on", e.target.value || null)} /></F>
      </div>
    </Card>
  );
}

function HoursSection({ p }: { p: VendorProfile }) {
  const L = useL();
  const init = useMemo(() => ({ hours: (p.hours ?? {}) as Hours, closed_dates: p.closed_dates ?? [] }), [p]);
  const { d, set, dirty, markSaved } = useSection("hours", init);
  const { busy, save } = useSaver("profile");
  if (!d) return null;
  const cd = d.closed_dates ?? [];
  return (
    <Card title={L("Opening hours", "أوقات الدوام")} dirty={dirty} busy={busy} onSave={() => save(d, markSaved)}>
      <p className="text-xs text-muted-foreground">{L("Lebanon (Beirut) time. A range ending before it starts runs past midnight.", "بتوقيت بيروت. الفترة اللي بتخلص قبل ما تبلّش بتكمّل بعد نص الليل.")}</p>
      <HoursEditor value={d.hours} onChange={(h) => set("hours", h)} />
      <div className="space-y-2">
        <p className="text-sm font-medium">{L("Holiday closures", "إقفال بالأعياد")}</p>
        {cd.map((c, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <Input type="date" className="w-40" value={c.from} onChange={(e) => set("closed_dates", cd.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))} />
            <Input type="date" className="w-40" value={c.to} onChange={(e) => set("closed_dates", cd.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))} />
            <Input className="flex-1" placeholder={L("Note", "ملاحظة")} value={c.note ?? ""} onChange={(e) => set("closed_dates", cd.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} />
            <Button variant="ghost" size="icon" aria-label="Remove" onClick={() => set("closed_dates", cd.filter((_, j) => j !== i))}><Trash2 /></Button>
          </div>
        ))}
        <Button variant="ghost" size="sm" onClick={() => set("closed_dates", [...cd, { from: "", to: "", note: "" }])}><Plus /> {L("Add closure", "أضف إقفال")}</Button>
      </div>
    </Card>
  );
}

function DeliverySection({ p }: { p: VendorProfile }) {
  const L = useL();
  const init = useMemo(() => pick(p, ["delivery_villages", "delivery_radius_km", "min_order_usd", "prep_time_min", "prep_time_max", "accepts_usd", "accepts_lbp", "accepts_orders"]), [p]);
  const { d, set, dirty, markSaved } = useSection("delivery", init);
  const { busy, save } = useSaver("profile");
  const villagesQ = useQuery({
    queryKey: ["all-villages"],
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("vendors").select("village_canonical").limit(5000);
      return [...new Set((data ?? []).map((r: { village_canonical: string | null }) => clean(r.village_canonical)).filter(Boolean) as string[])].sort();
    },
  });
  if (!d) return null;
  const vs = d.delivery_villages ?? [];
  return (
    <Card title={L("Delivery & orders", "التوصيل والطلبات")} dirty={dirty} busy={busy} onSave={() => save(d, markSaved)}>
      <F label={L("Villages you deliver to", "الضيع اللي بتوصل عليها")}>
        <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
          {(villagesQ.data ?? []).map((v) => {
            const on = vs.includes(v);
            return <button type="button" key={v} aria-pressed={on} onClick={() => set("delivery_villages", on ? vs.filter((x) => x !== v) : [...vs, v])} className={cn("rounded-full border px-3 py-1 text-xs", on ? "border-gold bg-gold/15 text-gold" : "border-border text-muted-foreground")}>{v}</button>;
          })}
        </div>
      </F>
      <div className="grid gap-3 sm:grid-cols-4">
        <F label={L("Radius (km)", "المسافة (كم)")}><Input type="number" value={d.delivery_radius_km ?? ""} onChange={(e) => set("delivery_radius_km", num(e.target.value))} /></F>
        <F label={L("Min order ($)", "الحد الأدنى ($)")}><Input type="number" value={d.min_order_usd ?? ""} onChange={(e) => set("min_order_usd", num(e.target.value))} /></F>
        <F label={L("Prep min", "تحضير من")}><Input type="number" value={d.prep_time_min ?? ""} onChange={(e) => set("prep_time_min", num(e.target.value))} /></F>
        <F label={L("Prep max", "تحضير لـ")}><Input type="number" value={d.prep_time_max ?? ""} onChange={(e) => set("prep_time_max", num(e.target.value))} /></F>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <Tog label={L("Accept USD", "دولار")} v={d.accepts_usd !== false} on={(v) => set("accepts_usd", v)} />
        <Tog label={L("Accept LBP", "ليرة")} v={d.accepts_lbp !== false} on={(v) => set("accepts_lbp", v)} />
        <Tog label={L("Accept orders", "استقبال طلبات")} v={d.accepts_orders !== false} on={(v) => set("accepts_orders", v)} />
      </div>
    </Card>
  );
}

function Tog({ label, v, on }: { label: string; v: boolean; on: (v: boolean) => void }) {
  return <label className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">{label}<Switch checked={v} onCheckedChange={on} /></label>;
}

function ContactSection({ p }: { p: VendorProfile }) {
  const L = useL();
  const { vendorId } = useMerchant();
  const vQ = useVendorRow(vendorId);
  const refresh = useRefreshMerchant();
  const init = useMemo(() => pick(p, ["public_phone", "whatsapp_orders_number", "instagram_url", "facebook_url", "tiktok_url", "website_url", "google_maps_url"]), [p]);
  const { d, set, dirty, markSaved } = useSection("contact", init);
  const loc = useMemo(() => (vQ.data ? { lat: Number(vQ.data.latitude ?? 33.69), lng: Number(vQ.data.longitude ?? 35.58), address: vQ.data.address ?? "", name_ar: clean(vQ.data.name_ar) ?? "" } : undefined), [vQ.data]);
  const locS = useSection("location", loc);
  const { busy, save } = useSaver("profile");
  if (!d) return null;
  const fields: [keyof typeof d, string, string][] = [
    ["public_phone", "Public phone", "رقم عام"], ["whatsapp_orders_number", "WhatsApp orders number", "رقم واتساب للطلبات"],
    ["instagram_url", "Instagram", "إنستغرام"], ["facebook_url", "Facebook", "فيسبوك"], ["tiktok_url", "TikTok", "تيك توك"],
    ["website_url", "Website", "الموقع"], ["google_maps_url", "Google Maps link", "رابط خرائط غوغل"],
  ];
  const doSave = async () => {
    if (dirty) await save(d, markSaved);
    if (locS.dirty && locS.d) {
      const { error } = await supabase.from("vendors").update({ latitude: locS.d.lat, longitude: locS.d.lng, address: locS.d.address, name_ar: locS.d.name_ar || null }).eq("vendor_id", vendorId);
      if (error) toast.error(errMsg(error));
      else { locS.markSaved(); toast.success(L("Location saved", "انحفظ الموقع")); await refresh(vendorId, ["vendor"]); }
    }
  };
  return (
    <Card title={L("Contact, social & location", "التواصل والموقع")} dirty={dirty || locS.dirty} busy={busy} onSave={doSave}>
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map(([k, en, ar]) => <F key={k} label={L(en, ar)}><Input dir="ltr" value={(d[k] as string) ?? ""} onChange={(e) => set(k, e.target.value)} /></F>)}
      </div>
      {locS.d && (
        <>
          <F label={L("Arabic business name", "اسم المحل بالعربي")}><Input dir="rtl" value={locS.d.name_ar} onChange={(e) => locS.set("name_ar", e.target.value)} /></F>
          <F label={L("Address", "العنوان")}><Input value={locS.d.address} onChange={(e) => locS.set("address", e.target.value)} /></F>
          <F label={L("Map pin (drag or tap to move)", "الدبوس عالخريطة (اسحب أو اضغط)")}>
            <LazyVendorMap lat={locS.d.lat} lng={locS.d.lng} draggable onMove={(lat, lng) => { locS.set("lat", lat); locS.set("lng", lng); }} />
          </F>
        </>
      )}
    </Card>
  );
}

function PoliciesSection({ p }: { p: VendorProfile }) {
  const L = useL();
  const init = useMemo(() => pick(p, ["halal_certified", "allergen_policy", "kitchen_notes", "languages"]), [p]);
  const { d, set, dirty, markSaved } = useSection("policies", init);
  const { busy, save } = useSaver("profile");
  if (!d) return null;
  return (
    <Card title={L("Policies", "السياسات")} dirty={dirty} busy={busy} onSave={() => save(d, markSaved)}>
      <Tog label={L("Halal certified", "حلال معتمد")} v={!!d.halal_certified} on={(v) => set("halal_certified", v)} />
      <F label={L("Allergen policy", "سياسة الحساسية")}><Textarea value={d.allergen_policy ?? ""} onChange={(e) => set("allergen_policy", e.target.value)} /></F>
      <F label={L("Kitchen notes", "ملاحظات المطبخ")}><Textarea value={d.kitchen_notes ?? ""} onChange={(e) => set("kitchen_notes", e.target.value)} /></F>
      <F label={L("Languages spoken", "اللغات")}><TagInput value={d.languages ?? []} onChange={(v) => set("languages", v)} suggestions={LANGS} /></F>
    </Card>
  );
}

function FaqSection({ p }: { p: VendorProfile }) {
  const L = useL();
  const init = useMemo(() => ({ faqs: p.faqs ?? [] }), [p]);
  const { d, set, dirty, markSaved } = useSection("faqs", init);
  const { busy, save } = useSaver("profile");
  if (!d) return null;
  const f = d.faqs;
  return (
    <Card title={L("FAQs", "أسئلة شائعة")} dirty={dirty} busy={busy} onSave={() => save({ faqs: f.filter((x) => x.q.trim()) }, markSaved)}>
      {f.map((x, i) => (
        <div key={i} className="space-y-2 rounded-lg border border-border p-3">
          <div className="flex gap-2"><Input placeholder={L("Question", "السؤال")} value={x.q} onChange={(e) => set("faqs", f.map((y, j) => (j === i ? { ...y, q: e.target.value } : y)))} /><Button variant="ghost" size="icon" aria-label="Remove" onClick={() => set("faqs", f.filter((_, j) => j !== i))}><Trash2 /></Button></div>
          <Textarea placeholder={L("Answer", "الجواب")} value={x.a} onChange={(e) => set("faqs", f.map((y, j) => (j === i ? { ...y, a: e.target.value } : y)))} />
        </div>
      ))}
      <Button variant="ghost" size="sm" onClick={() => set("faqs", [...f, { q: "", a: "" }])}><Plus /> {L("Add question", "أضف سؤال")}</Button>
    </Card>
  );
}

function AiSection({ p }: { p: VendorProfile }) {
  const L = useL();
  const init = useMemo(() => ({ ai_instructions: p.ai_instructions ?? "" }), [p]);
  const { d, set, dirty, markSaved } = useSection("ai", init);
  const { busy, save } = useSaver("profile");
  if (!d) return null;
  return (
    <Card title={L("Instructions for the Alo King assistant", "تعليمات لمساعد ألو كينغ")} dirty={dirty} busy={busy} onSave={() => save(d, markSaved)}>
      <Textarea rows={5} value={d.ai_instructions ?? ""} onChange={(e) => set("ai_instructions", e.target.value)} placeholder={L("e.g. Recommend our mixed grill for groups. We don't deliver after 10pm on weekdays. Our fries are cooked in the same oil as fish.", "مثلاً: اقترح المشاوي المشكلة للمجموعات. ما منوصل بعد العشرة بأيام الأسبوع.")} />
      <p className="text-xs text-muted-foreground">{L("These are suggestions the assistant treats as information about your business, not commands. It will still follow Alo King's rules and stay honest with customers.", "هيدي اقتراحات بيعتبرها المساعد معلومات عن محلك، مش أوامر. رح يضل يلتزم بقواعد ألو كينغ ويكون صادق مع الزباين.")}</p>
    </Card>
  );
}

function PhotosSection({ p }: { p: VendorProfile }) {
  const L = useL();
  const { vendorId } = useMerchant();
  const refresh = useRefreshMerchant();
  const [busy, setBusy] = useState<string | null>(null);
  const [review, setReview] = useState<{ score: number; verdict: string; issues: string[]; tips: string[] } | null>(null);

  async function upload(kind: "logo" | "cover" | "gallery", f: File) {
    setBusy(kind);
    setReview(null);
    try {
      const img = await resizeImage(f);
      const path = kind === "gallery" ? `${vendorId}/gallery/${uuid()}.jpg` : `${vendorId}/${kind}.jpg`;
      const url = await uploadMedia(path, img.blob);
      const patch = kind === "gallery" ? { gallery_urls: [...(p.gallery_urls ?? []), url] } : { [`${kind}_url`]: url };
      await saveProfile(vendorId, patch);
      await refresh(vendorId, ["profile", "completeness"]);
      toast.success(L("Uploaded", "انرفعت"));
      invokeFn<typeof review>("merchant-ai", { action: "photo_review", vendor_id: vendorId, image: { media_type: img.media_type, data: img.base64 }, purpose: kind })
        .then(setReview)
        .catch((e) => toast.message(aiFriendly(e)));
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  }
  async function removeGallery(u: string) {
    await saveProfile(vendorId, { gallery_urls: (p.gallery_urls ?? []).filter((x) => x !== u) });
    await refresh(vendorId, ["profile", "completeness"]);
  }
  const Up = ({ kind, label }: { kind: "logo" | "cover" | "gallery"; label: string }) => (
    <label className="hairline inline-flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-gold hover:bg-gold/10">
      {busy === kind ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />} {label}
      <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(kind, f); e.target.value = ""; }} />
    </label>
  );
  return (
    <section className="lux-card space-y-4 p-5">
      <h2 className="text-2xl font-semibold">{L("Photos", "الصور")}</h2>
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-2"><div className="size-24 overflow-hidden rounded-2xl bg-muted">{p.logo_url && <img src={p.logo_url} alt="" className="h-full w-full object-cover" />}</div><Up kind="logo" label={L("Logo", "لوغو")} /></div>
        <div className="flex-1 space-y-2"><div className="h-24 overflow-hidden rounded-xl bg-muted">{p.cover_url && <img src={p.cover_url} alt="" className="h-full w-full object-cover" />}</div><Up kind="cover" label={L("Cover", "غلاف")} /></div>
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {(p.gallery_urls ?? []).map((u) => (
          <div key={u} className="group relative aspect-square overflow-hidden rounded-lg">
            <img src={u} alt="" className="h-full w-full object-cover" />
            <button onClick={() => removeGallery(u)} aria-label="Remove photo" className="absolute end-1 top-1 rounded-full bg-background/80 p-1"><Trash2 className="size-3.5" /></button>
          </div>
        ))}
      </div>
      <Up kind="gallery" label={L("Add to gallery", "أضف للمعرض")} />
      {review && (
        <div className="rounded-xl border border-gold/30 p-3 text-sm">
          <p className="flex items-center gap-2 font-semibold"><Sparkles className="size-4 text-gold" /> {L("AI photo review", "تقييم الصورة")}: {review.score}/10 · {review.verdict}</p>
          {!!review.issues?.length && <ul className="mt-1 list-disc ps-5 text-destructive">{review.issues.map((x) => <li key={x}>{x}</li>)}</ul>}
          {!!review.tips?.length && <ul className="mt-1 list-disc ps-5 text-muted-foreground">{review.tips.map((x) => <li key={x}>{x}</li>)}</ul>}
        </div>
      )}
      <PhotoTips />
    </section>
  );
}

function PrivateSection({ priv }: { priv: VendorPrivate | undefined }) {
  const L = useL();
  const init = useMemo(() => pick(priv, ["owner_name", "owner_phone_urgent", "backup_phone", "owner_email", "order_alert_whatsapp", "notes_for_team"]), [priv]);
  const { d, set, dirty, markSaved } = useSection("private", init);
  const { busy, save } = useSaver("private");
  if (!d) return null;
  const fields: [keyof typeof d, string, string][] = [
    ["owner_name", "Owner name", "اسم المالك"], ["owner_phone_urgent", "Urgent owner phone", "رقم المالك للطوارئ"],
    ["backup_phone", "Backup phone", "رقم احتياطي"], ["owner_email", "Owner email", "إيميل المالك"], ["order_alert_whatsapp", "Order-alert WhatsApp", "واتساب تنبيه الطلبات"],
  ];
  return (
    <Card tone="private" title={L("Private, only the Alo King team sees this", "خاص، بس فريق ألو كينغ بيشوفه")} dirty={dirty} busy={busy} onSave={() => save(d, markSaved)}>
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map(([k, en, ar]) => <F key={k} label={L(en, ar)}><Input dir="ltr" value={(d[k] as string) ?? ""} onChange={(e) => set(k, e.target.value)} /></F>)}
      </div>
      <F label={L("Notes for the team", "ملاحظات للفريق")}><Textarea value={d.notes_for_team ?? ""} onChange={(e) => set("notes_for_team", e.target.value)} /></F>
    </Card>
  );
}
