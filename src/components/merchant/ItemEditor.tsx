import { cloneElement, isValidElement, useEffect, useId, useRef, useState } from "react";
import { Camera, Check, Loader2, Plus, Sparkles, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AllergenPicker } from "@/components/shared/AllergenPicker";
import { TagInput } from "@/components/shared/TagInput";
import { PhotoTips } from "@/components/shared/PhotoTips";
import { supabase } from "@/lib/supabase";
import { aiFriendly, invokeFn, resizeImage, uploadMedia } from "@/lib/edge";
import { errMsg } from "@/lib/format";
import { useLbp } from "@/lib/rate";
import { uuid, type Customization, type MenuItem } from "@/lib/vendor";
import { useL } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type Enriched = {
  ref: string;
  description_en?: string;
  description_ar?: string;
  ingredients?: string[];
  allergen_list?: string[];
  is_vegan?: boolean;
  is_vegetarian?: boolean;
  is_gluten_free?: boolean;
  is_dairy_free?: boolean;
  is_keto?: boolean;
  contains_pork?: boolean;
  contains_alcohol?: boolean;
  spice_level?: number;
  portion_grams?: number;
  serves?: number;
  calories?: number;
  protein_grams?: number;
  carbs_grams?: number;
  fat_grams?: number;
  sugar_grams?: number;
  fiber_g?: number;
  saturated_fat_g?: number;
  sodium_mg?: number;
  nutrition_confidence?: string;
  assumptions?: string[];
  owner_questions?: string[];
};

export const enrichToItem = (e: Enriched): Partial<MenuItem> => {
  const { ref: _r, assumptions: _a, owner_questions: _q, ...rest } = e;
  return {
    ...rest,
    nutrition_source: "ai_estimate",
    nutrition_verified: false,
    allergens_reviewed: false,
  };
};

const NUM = (v: string) => (v === "" ? null : Number(v));

const MACROS: [keyof MenuItem, string, string][] = [
  ["calories", "Calories (kcal)", "سعرات"],
  ["protein_grams", "Protein (g)", "بروتين"],
  ["carbs_grams", "Carbs (g)", "كربوهيدرات"],
  ["fat_grams", "Fat (g)", "دهون"],
  ["saturated_fat_g", "Saturated fat (g)", "دهون مشبعة"],
  ["sugar_grams", "Sugar (g)", "سكر"],
  ["fiber_g", "Fiber (g)", "ألياف"],
  ["sodium_mg", "Sodium (mg)", "صوديوم"],
];

const DIET: [keyof MenuItem, string, string][] = [
  ["is_vegan", "Vegan", "نباتي صرف"],
  ["is_vegetarian", "Vegetarian", "نباتي"],
  ["is_gluten_free", "Gluten-free", "بلا غلوتين"],
  ["is_dairy_free", "Dairy-free", "بلا ألبان"],
  ["is_keto", "Keto", "كيتو"],
  ["is_halal", "Halal", "حلال"],
  ["contains_pork", "Contains pork", "فيه لحم خنزير"],
  ["contains_alcohol", "Contains alcohol", "فيه كحول"],
];

export function ItemEditor({
  vendorId,
  item,
  sections,
  onClose,
  onSaved,
}: {
  vendorId: string;
  item: MenuItem | "new" | null;
  sections: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const L = useL();
  const lbp = useLbp();
  const [d, setD] = useState<MenuItem | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ai, setAi] = useState<{
    fields: Partial<MenuItem>;
    accepted: Set<string>;
    conf?: string;
    questions: string[];
    assumptions: string[];
  } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [review, setReview] = useState<{
    score: number;
    verdict: string;
    issues: string[];
    tips: string[];
  } | null>(null);
  const lastImg = useRef<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setAi(null);
    setReview(null);
    lastImg.current = null;
    if (item === "new") {
      setIsNew(true);
      setD({
        item_id: `m_${uuid()}`,
        vendor_id: vendorId,
        item_name_en: "",
        item_name_ar: "",
        section: sections[0] ?? "",
        price_usd: null,
        available: true,
        price_currency: "USD",
      });
    } else {
      setIsNew(false);
      setD(item ? { ...item } : null);
    }
  }, [item, vendorId, sections]);

  const set = <K extends keyof MenuItem>(k: K, v: MenuItem[K]) =>
    setD((p) => (p ? { ...p, [k]: v } : p));

  async function save() {
    if (!d) return;
    if (!d.item_name_en?.trim() && !d.item_name_ar?.trim())
      return toast.error(L("Add a name first", "أضف اسم أول"));
    setBusy(true);
    try {
      const row = {
        ...d,
        price_value: d.price_currency === "LBP" ? d.price_value : d.price_usd,
        price_currency: d.price_currency || "USD",
      };
      const { error } = isNew
        ? await supabase.from("menu_items").insert(row)
        : await supabase.from("menu_items").update(row).eq("item_id", d.item_id);
      if (error) throw error;
      toast.success(L("Saved", "تم الحفظ"));
      setIsNew(false);
      onSaved();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function fillAI() {
    if (!d) return;
    setAiBusy(true);
    try {
      const r = await invokeFn<{ items: Enriched[] }>("merchant-ai", {
        action: "enrich_items",
        vendor_id: vendorId,
        items: [
          {
            ref: d.item_id,
            name_en: d.item_name_en ?? "",
            name_ar: d.item_name_ar ?? undefined,
            description: d.description_en ?? undefined,
            section: d.section ?? undefined,
            ingredients: d.ingredients ?? undefined,
            portion_grams: d.portion_grams ?? undefined,
            price_usd: d.price_usd ?? undefined,
          },
        ],
      });
      const e = r.items?.[0];
      if (!e) throw new Error(L("No suggestions returned", "ما رجعت اقتراحات"));
      const { ref: _r, assumptions, owner_questions, nutrition_confidence, ...fields } = e;
      const clean = Object.fromEntries(
        Object.entries(fields).filter(([, v]) => v !== null && v !== undefined),
      ) as Partial<MenuItem>;
      setAi({
        fields: clean,
        accepted: new Set(Object.keys(clean)),
        conf: nutrition_confidence,
        questions: owner_questions ?? [],
        assumptions: assumptions ?? [],
      });
    } catch (e) {
      toast.error(aiFriendly(e));
    } finally {
      setAiBusy(false);
    }
  }

  function acceptAI() {
    if (!ai || !d) return;
    const picked = Object.fromEntries(
      Object.entries(ai.fields).filter(([k]) => ai.accepted.has(k)),
    );
    setD({
      ...d,
      ...picked,
      nutrition_source: "ai_estimate",
      nutrition_verified: false,
      allergens_reviewed: false,
      nutrition_confidence: ai.conf ?? d.nutrition_confidence,
    });
    setAi(null);
    toast.success(L("Suggestions added. Review, then save.", "انضافت الاقتراحات. راجع واحفظ."));
  }

  async function upload(f: File) {
    if (!d) return;
    setBusy(true);
    try {
      const img = await resizeImage(f);
      lastImg.current = img.base64;
      const url = await uploadMedia(`${vendorId}/items/${d.item_id}.jpg`, img.blob);
      set("image_url", url);
      toast.success(L("Photo uploaded. Save to keep it.", "انرفعت الصورة. احفظ لتثبيتها."));
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function reviewPhoto() {
    if (!d?.image_url) return;
    setAiBusy(true);
    try {
      let b64 = lastImg.current;
      if (!b64) {
        const blob = await (await fetch(d.image_url)).blob();
        b64 = (await resizeImage(blob)).base64;
      }
      const r = await invokeFn<typeof review>("merchant-ai", {
        action: "photo_review",
        vendor_id: vendorId,
        image: { media_type: "image/jpeg", data: b64 },
        purpose: "menu_item",
        item_name: d.item_name_en,
      });
      setReview(r);
    } catch (e) {
      toast.error(aiFriendly(e));
    } finally {
      setAiBusy(false);
    }
  }

  const cz = d?.customizations ?? [];
  const setCz = (v: Customization[]) => set("customizations", v);

  return (
    <Sheet open={!!item} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col overflow-y-auto sm:max-w-xl">
        {d && (
          <>
            <SheetHeader>
              <SheetTitle>
                {isNew ? L("New item", "صنف جديد") : d.item_name_en || d.item_name_ar}
              </SheetTitle>
            </SheetHeader>
            <div className="flex-1 space-y-4 px-4 pb-4">
              <Button variant="hairline" size="sm" onClick={fillAI} disabled={aiBusy}>
                {aiBusy ? <Loader2 className="animate-spin" /> : <Sparkles />}{" "}
                {L("Fill with AI", "عبّي بالذكاء الاصطناعي")}
              </Button>
              {ai && (
                <div className="space-y-3 rounded-xl border border-gold/30 bg-gold/5 p-3">
                  <p className="text-sm font-semibold text-gold">
                    {L("AI suggestions (estimates)", "اقتراحات (تقديرات)")}{" "}
                    {ai.conf && (
                      <span className="ms-2 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                        {L("confidence", "الثقة")}: {ai.conf}
                      </span>
                    )}
                  </p>
                  {ai.questions.map((q) => (
                    <p key={q} className="rounded-lg bg-background/60 p-2 text-sm">
                      ❓ {q}
                    </p>
                  ))}
                  <div className="max-h-64 space-y-1 overflow-y-auto">
                    {Object.entries(ai.fields).map(([k, v]) => (
                      <label key={k} className="flex items-start gap-2 text-xs">
                        <Checkbox
                          checked={ai.accepted.has(k)}
                          onCheckedChange={(c) => {
                            const s = new Set(ai.accepted);
                            if (c) s.add(k);
                            else s.delete(k);
                            setAi({ ...ai, accepted: s });
                          }}
                        />
                        <span className="font-mono text-muted-foreground">{k}</span>
                        <span className="flex-1 break-words">
                          {Array.isArray(v) ? v.join(", ") : String(v)}
                        </span>
                      </label>
                    ))}
                  </div>
                  {!!ai.assumptions.length && (
                    <p className="text-xs text-muted-foreground">
                      {L("Assumptions", "افتراضات")}: {ai.assumptions.join("; ")}
                    </p>
                  )}
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setAi(null)}>
                      <X /> {L("Reject all", "رفض الكل")}
                    </Button>
                    <Button size="sm" variant="gold" onClick={acceptAI}>
                      <Check /> {L("Accept selected", "قبول المحدد")}
                    </Button>
                  </div>
                </div>
              )}
              <Tabs defaultValue="basics">
                <TabsList className="flex h-auto flex-wrap">
                  <TabsTrigger value="basics">{L("Basics", "أساسي")}</TabsTrigger>
                  <TabsTrigger value="details">{L("Details", "تفاصيل")}</TabsTrigger>
                  <TabsTrigger value="diet">{L("Dietary", "غذائي")}</TabsTrigger>
                  <TabsTrigger value="nutrition">{L("Nutrition", "قيم")}</TabsTrigger>
                  <TabsTrigger value="photo">{L("Photo", "صورة")}</TabsTrigger>
                  <TabsTrigger value="options">{L("Options", "خيارات")}</TabsTrigger>
                </TabsList>

                <TabsContent value="basics" className="space-y-4 pt-3">
                  <Field label={L("Name (English)", "الاسم (إنكليزي)")}>
                    <Input
                      value={d.item_name_en ?? ""}
                      onChange={(e) => set("item_name_en", e.target.value)}
                    />
                  </Field>
                  <Field label={L("Name (Arabic)", "الاسم (عربي)")}>
                    <Input
                      dir="rtl"
                      value={d.item_name_ar ?? ""}
                      onChange={(e) => set("item_name_ar", e.target.value)}
                    />
                  </Field>
                  <Field label={L("Section", "القسم")}>
                    <Input
                      list="sections-list"
                      value={d.section ?? ""}
                      onChange={(e) => set("section", e.target.value)}
                    />
                    <datalist id="sections-list">
                      {sections.map((s) => (
                        <option key={s} value={s} />
                      ))}
                    </datalist>
                  </Field>
                  <Field label={L("Price (USD)", "السعر (دولار)")}>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={d.price_usd ?? ""}
                      onChange={(e) => set("price_usd", NUM(e.target.value))}
                    />
                    {d.price_usd != null && (
                      <p className="text-xs text-muted-foreground">{lbp(d.price_usd)}</p>
                    )}
                  </Field>
                  <Toggle
                    label={L("Available", "متوفر")}
                    checked={d.available !== false}
                    onChange={(v) => set("available", v)}
                  />
                  <Toggle
                    label={L("Popular", "الأكثر طلباً")}
                    checked={!!d.is_popular}
                    onChange={(v) => set("is_popular", v)}
                  />
                  <Toggle
                    label={L("Chef's pick", "اختيار الشيف")}
                    checked={!!d.is_chef_pick}
                    onChange={(v) => set("is_chef_pick", v)}
                  />
                </TabsContent>

                <TabsContent value="details" className="space-y-4 pt-3">
                  <Field label={L("Description (English)", "الوصف (إنكليزي)")}>
                    <Textarea
                      value={d.description_en ?? ""}
                      onChange={(e) => set("description_en", e.target.value)}
                    />
                  </Field>
                  <Field label={L("Description (Arabic)", "الوصف (عربي)")}>
                    <Textarea
                      dir="rtl"
                      value={d.description_ar ?? ""}
                      onChange={(e) => set("description_ar", e.target.value)}
                    />
                  </Field>
                  <Field label={L("Ingredients", "المكونات")}>
                    <TagInput
                      value={d.ingredients ?? []}
                      onChange={(v) => set("ingredients", v)}
                      placeholder={L("Type and press Enter", "اكتب واضغط Enter")}
                    />
                  </Field>
                  <div className="grid grid-cols-3 gap-3">
                    <Field label={L("Portion (g)", "الحصة (غ)")}>
                      <Input
                        type="number"
                        value={d.portion_grams ?? ""}
                        onChange={(e) => set("portion_grams", NUM(e.target.value))}
                      />
                    </Field>
                    <Field label={L("Serves", "لكم شخص")}>
                      <Input
                        type="number"
                        value={d.serves ?? ""}
                        onChange={(e) => set("serves", NUM(e.target.value))}
                      />
                    </Field>
                    <Field label={L("Prep (min)", "تحضير (د)")}>
                      <Input
                        type="number"
                        value={d.prep_time_min ?? ""}
                        onChange={(e) => set("prep_time_min", NUM(e.target.value))}
                      />
                    </Field>
                  </div>
                  <Field label={L("Cooking method", "طريقة الطبخ")}>
                    <Input
                      value={d.cooking_method ?? ""}
                      onChange={(e) => set("cooking_method", e.target.value)}
                      placeholder={L("grilled, fried, baked…", "مشوي، مقلي، بالفرن…")}
                    />
                  </Field>
                  <Field label={`${L("Spice level", "الحدّة")}: ${d.spice_level ?? 0}/4`}>
                    <div className="flex gap-1">
                      {[0, 1, 2, 3, 4].map((n) => (
                        <Button
                          key={n}
                          type="button"
                          size="sm"
                          variant={(d.spice_level ?? 0) === n ? "gold" : "hairline"}
                          onClick={() => set("spice_level", n)}
                        >
                          {n}
                        </Button>
                      ))}
                    </div>
                  </Field>
                  <Field label={L("Tags", "وسوم")}>
                    <TagInput value={d.tags ?? []} onChange={(v) => set("tags", v)} />
                  </Field>
                </TabsContent>

                <TabsContent value="diet" className="space-y-4 pt-3">
                  <Field label={L("Allergens in this dish", "مسببات الحساسية بهالطبق")}>
                    <AllergenPicker
                      value={d.allergen_list ?? []}
                      onChange={(v) => set("allergen_list", v)}
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    {DIET.map(([k, en, ar]) => (
                      <Toggle
                        key={k}
                        label={L(en, ar)}
                        checked={!!d[k]}
                        onChange={(v) => set(k, v as never)}
                      />
                    ))}
                  </div>
                  <label
                    className={cn(
                      "flex items-start gap-3 rounded-lg border p-3",
                      d.allergens_reviewed
                        ? "border-success/50 bg-success/10"
                        : "border-warning/50",
                    )}
                  >
                    <Checkbox
                      checked={!!d.allergens_reviewed}
                      onCheckedChange={(c) => set("allergens_reviewed", !!c)}
                    />
                    <span className="text-sm">
                      {L("I reviewed the allergens for this dish", "راجعت مسببات الحساسية لهالطبق")}
                    </span>
                  </label>
                </TabsContent>

                <TabsContent value="nutrition" className="space-y-4 pt-3">
                  <p className="text-sm">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs",
                        d.nutrition_verified
                          ? "bg-success/15 text-success"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {d.nutrition_verified
                        ? L("Owner verified", "موثّق من المالك")
                        : `${L("Source", "المصدر")}: ${d.nutrition_source ?? L("none", "لا شيء")}`}
                    </span>
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    {MACROS.map(([k, en, ar]) => (
                      <Field key={k} label={L(en, ar)}>
                        <Input
                          type="number"
                          value={(d[k] as number | null | undefined) ?? ""}
                          onChange={(e) =>
                            setD({ ...d, [k]: NUM(e.target.value), nutrition_verified: false })
                          }
                        />
                      </Field>
                    ))}
                  </div>
                  <Button
                    variant="emerald"
                    onClick={() =>
                      setD({ ...d, nutrition_verified: true, nutrition_source: "merchant" })
                    }
                  >
                    <Check /> {L("I confirm these values", "أؤكد هالقيم")}
                  </Button>
                </TabsContent>

                <TabsContent value="photo" className="space-y-4 pt-3">
                  <div className="aspect-video overflow-hidden rounded-xl bg-muted">
                    {d.image_url ? (
                      <img src={d.image_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="grid h-full place-items-center text-muted-foreground">
                        <Camera className="size-10" />
                      </div>
                    )}
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void upload(f);
                      e.target.value = "";
                    }}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button variant="gold" onClick={() => fileRef.current?.click()} disabled={busy}>
                      <Camera /> {L("Upload photo", "ارفع صورة")}
                    </Button>
                    {d.image_url && (
                      <Button variant="hairline" onClick={reviewPhoto} disabled={aiBusy}>
                        {aiBusy ? <Loader2 className="animate-spin" /> : <Sparkles />}{" "}
                        {L("Review my photo with AI", "قيّم صورتي")}
                      </Button>
                    )}
                  </div>
                  {review && (
                    <div className="rounded-xl border border-border p-3 text-sm">
                      <p className="font-semibold">
                        {review.score}/10 · {review.verdict}
                      </p>
                      {!!review.issues?.length && (
                        <ul className="mt-1 list-disc ps-5 text-destructive">
                          {review.issues.map((x) => (
                            <li key={x}>{x}</li>
                          ))}
                        </ul>
                      )}
                      {!!review.tips?.length && (
                        <ul className="mt-1 list-disc ps-5 text-muted-foreground">
                          {review.tips.map((x) => (
                            <li key={x}>{x}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                  <PhotoTips />
                </TabsContent>

                <TabsContent value="options" className="space-y-4 pt-3">
                  {cz.map((g, gi) => (
                    <div key={gi} className="space-y-3 rounded-xl border border-border p-3">
                      <div className="flex gap-2">
                        <Input
                          value={g.name}
                          placeholder={L("Group name, e.g. Size", "اسم المجموعة، مثلاً الحجم")}
                          onChange={(e) =>
                            setCz(cz.map((x, i) => (i === gi ? { ...x, name: e.target.value } : x)))
                          }
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Remove group"
                          onClick={() => setCz(cz.filter((_, i) => i !== gi))}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                      <div className="flex flex-wrap items-center gap-4 text-sm">
                        <Toggle
                          label={L("Required", "إلزامي")}
                          checked={g.required}
                          onChange={(v) =>
                            setCz(cz.map((x, i) => (i === gi ? { ...x, required: v } : x)))
                          }
                        />
                        <label className="flex items-center gap-1">
                          {L("Min", "أدنى")}
                          <Input
                            type="number"
                            className="w-16"
                            value={g.min}
                            onChange={(e) =>
                              setCz(
                                cz.map((x, i) =>
                                  i === gi ? { ...x, min: Number(e.target.value) } : x,
                                ),
                              )
                            }
                          />
                        </label>
                        <label className="flex items-center gap-1">
                          {L("Max", "أقصى")}
                          <Input
                            type="number"
                            className="w-16"
                            value={g.max}
                            onChange={(e) =>
                              setCz(
                                cz.map((x, i) =>
                                  i === gi ? { ...x, max: Number(e.target.value) } : x,
                                ),
                              )
                            }
                          />
                        </label>
                      </div>
                      {g.options.map((o, oi) => (
                        <div key={oi} className="flex gap-2">
                          <Input
                            value={o.name}
                            placeholder={L("Option", "خيار")}
                            onChange={(e) =>
                              setCz(
                                cz.map((x, i) =>
                                  i === gi
                                    ? {
                                        ...x,
                                        options: x.options.map((y, j) =>
                                          j === oi ? { ...y, name: e.target.value } : y,
                                        ),
                                      }
                                    : x,
                                ),
                              )
                            }
                          />
                          <Input
                            type="number"
                            step="0.25"
                            className="w-28"
                            placeholder="+$"
                            value={o.price_delta_usd}
                            onChange={(e) =>
                              setCz(
                                cz.map((x, i) =>
                                  i === gi
                                    ? {
                                        ...x,
                                        options: x.options.map((y, j) =>
                                          j === oi
                                            ? { ...y, price_delta_usd: Number(e.target.value) }
                                            : y,
                                        ),
                                      }
                                    : x,
                                ),
                              )
                            }
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Remove option"
                            onClick={() =>
                              setCz(
                                cz.map((x, i) =>
                                  i === gi
                                    ? { ...x, options: x.options.filter((_, j) => j !== oi) }
                                    : x,
                                ),
                              )
                            }
                          >
                            <X />
                          </Button>
                        </div>
                      ))}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setCz(
                            cz.map((x, i) =>
                              i === gi
                                ? {
                                    ...x,
                                    options: [...x.options, { name: "", price_delta_usd: 0 }],
                                  }
                                : x,
                            ),
                          )
                        }
                      >
                        <Plus /> {L("Add option", "أضف خيار")}
                      </Button>
                    </div>
                  ))}
                  <Button
                    variant="hairline"
                    onClick={() =>
                      setCz([
                        ...cz,
                        {
                          name: "",
                          required: false,
                          min: 0,
                          max: 1,
                          options: [{ name: "", price_delta_usd: 0 }],
                        },
                      ])
                    }
                  >
                    <Plus /> {L("Add option group", "أضف مجموعة خيارات")}
                  </Button>
                </TabsContent>
              </Tabs>
            </div>
            <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-background p-4">
              <Button variant="ghost" onClick={onClose}>
                {L("Close", "إغلاق")}
              </Button>
              <Button variant="gold" onClick={save} disabled={busy}>
                {busy ? L("Saving…", "عم يحفظ…") : L("Save item", "احفظ الصنف")}
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  // The label is tied to its control (a single input or textarea gets the id), so screen readers announce it.
  const id = useId();
  const only = isValidElement<{ id?: string }>(children) ? children : null;
  return (
    <div className="space-y-1.5">
      <Label
        htmlFor={only ? (only.props.id ?? id) : undefined}
        className="text-xs text-muted-foreground"
      >
        {label}
      </Label>
      {only ? cloneElement(only, { id: only.props.id ?? id }) : children}
    </div>
  );
}
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}
