import { useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, FileUp, Loader2, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { PhotoTips } from "@/components/shared/PhotoTips";
import { enrichToItem, type Enriched } from "@/components/merchant/ItemEditor";
import { useMenuItems, useMerchant, useRefreshMerchant } from "@/components/merchant/context";
import { supabase } from "@/lib/supabase";
import { aiFriendly, fileToBase64, invokeFn, resizeImage } from "@/lib/edge";
import { LBP_RATE } from "@/lib/config";
import { errMsg } from "@/lib/format";
import { uuid } from "@/lib/vendor";
import { useL } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/merchant/menu/import")({
  head: () => ({ meta: [{ title: "Import menu — Alo King Merchant" }, { name: "robots", content: "noindex" }] }),
  component: ImportWizard,
});

type Extracted = { name_en: string; name_ar?: string; section?: string; description?: string; price?: number | null; price_text?: string; currency_guess?: string; ingredients_listed?: string[]; confidence?: number | string; note?: string };
type ExtractRes = { items: Extracted[]; menu_language?: string; detected_currency?: string; prices_look_like_thousands_of_lbp?: boolean; questions_for_owner?: string[]; image_quality_issues?: string[] };
type Row = Extracted & { ref: string; include: boolean; dup: boolean; enriched?: Enriched };

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]/g, "");

function ImportWizard() {
  const L = useL();
  const { vendorId } = useMerchant();
  const existing = useMenuItems(vendorId).data ?? [];
  const refresh = useRefreshMerchant();
  const [step, setStep] = useState(1);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<ExtractRes | null>(null);
  const [currency, setCurrency] = useState<"USD" | "LBP">("USD");
  const [thousands, setThousands] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [published, setPublished] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isPdf = files.length === 1 && files[0]!.type === "application/pdf";
  function pick(list: FileList | null) {
    if (!list) return;
    const arr = [...list];
    const pdf = arr.find((f) => f.type === "application/pdf");
    if (pdf) return setFiles([pdf]);
    setFiles((prev) => [...prev.filter((f) => f.type !== "application/pdf"), ...arr.filter((f) => f.type.startsWith("image/"))].slice(0, 6));
  }

  async function extract() {
    setBusy(true);
    try {
      const payload = isPdf
        ? [{ media_type: "application/pdf", data: await fileToBase64(files[0]!) }]
        : await Promise.all(files.map(async (f) => { const r = await resizeImage(f, 1600, 0.85); return { media_type: r.media_type, data: r.base64 }; }));
      const r = await invokeFn<ExtractRes>("merchant-ai", { action: "extract_menu", vendor_id: vendorId, files: payload });
      setRes(r);
      setCurrency(r.detected_currency === "LBP" ? "LBP" : "USD");
      setThousands(!!r.prices_look_like_thousands_of_lbp);
      const names = new Set(existing.flatMap((e) => [norm(e.item_name_en), norm(e.item_name_ar)]).filter(Boolean));
      setRows((r.items ?? []).map((x) => ({ ...x, ref: uuid(), include: !names.has(norm(x.name_en)), dup: names.has(norm(x.name_en)) || (!!x.name_ar && names.has(norm(x.name_ar))) })));
      setStep(2);
    } catch (e) {
      toast.error(aiFriendly(e));
    } finally {
      setBusy(false);
    }
  }

  const priceValue = (p: number | null | undefined) => (p == null ? null : currency === "LBP" && thousands ? p * 1000 : p);
  const toUsd = (p: number | null | undefined) => {
    const v = priceValue(p);
    if (v == null) return null;
    return currency === "LBP" ? Math.round((v / LBP_RATE) * 100) / 100 : v;
  };

  async function enrich() {
    const list = rows.filter((r) => r.include);
    setProgress(0);
    try {
      for (let i = 0; i < list.length; i += 15) {
        const batch = list.slice(i, i + 15);
        const r = await invokeFn<{ items: Enriched[] }>("merchant-ai", {
          action: "enrich_items",
          vendor_id: vendorId,
          items: batch.map((b) => ({ ref: b.ref, name_en: b.name_en, name_ar: b.name_ar, description: b.description, section: b.section, ingredients: b.ingredients_listed, price_usd: toUsd(b.price) ?? undefined })),
        });
        const byRef = new Map((r.items ?? []).map((e) => [e.ref, e]));
        setRows((prev) => prev.map((p) => (byRef.has(p.ref) ? { ...p, enriched: byRef.get(p.ref) } : p)));
        setProgress(Math.round(((i + batch.length) / list.length) * 100));
      }
      toast.success(L("Enrichment done", "خلص الإغناء"));
    } catch (e) {
      toast.error(aiFriendly(e));
    }
  }

  async function publish() {
    const list = rows.filter((r) => r.include && r.name_en?.trim());
    if (!list.length) return toast.error(L("Nothing selected", "ما في شي محدد"));
    setBusy(true);
    const base = Math.max(0, ...existing.map((e) => e.sort_order ?? 0));
    const payload = list.map((r, idx) => ({
      item_id: `m_${uuid()}`,
      vendor_id: vendorId,
      item_name_en: r.name_en.trim(),
      item_name_ar: r.name_ar?.trim() || null,
      section: r.section?.trim() || null,
      description_en: r.description || null,
      ingredients: r.ingredients_listed ?? null,
      price_value: priceValue(r.price),
      price_currency: currency,
      price_usd: toUsd(r.price),
      available: true,
      sort_order: base + (idx + 1) * 10,
      ...(r.enriched ? enrichToItem(r.enriched) : {}),
    }));
    try {
      for (let i = 0; i < payload.length; i += 100) {
        const { error } = await supabase.from("menu_items").insert(payload.slice(i, i + 100));
        if (error) throw error;
      }
      setPublished(payload.length);
      setStep(5);
      await refresh(vendorId, ["items", "completeness"]);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const setRow = (ref: string, patch: Partial<Row>) => setRows((p) => p.map((r) => (r.ref === ref ? { ...r, ...patch } : r)));
  const included = useMemo(() => rows.filter((r) => r.include).length, [rows]);
  const STEPS = [L("Upload", "رفع"), L("Confirm", "تأكيد"), L("Review", "مراجعة"), L("Enrich", "إغناء"), L("Publish", "نشر")];

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
      <h1 className="text-3xl font-semibold">{L("Import your menu with AI", "استورد المنيو بالذكاء الاصطناعي")}</h1>
      <ol className="flex gap-2 overflow-x-auto text-xs">
        {STEPS.map((s, i) => <li key={s} className={cn("shrink-0 rounded-full px-3 py-1", step === i + 1 ? "bg-gold text-gold-foreground" : step > i + 1 ? "bg-success/15 text-success" : "bg-muted text-muted-foreground")}>{i + 1}. {s}</li>)}
      </ol>

      {step === 1 && (
        <div className="grid gap-5 md:grid-cols-[1fr_320px]">
          <div className="lux-card space-y-4 p-6">
            <input ref={inputRef} type="file" multiple accept="image/*,application/pdf" className="hidden" onChange={(e) => { pick(e.target.files); e.target.value = ""; }} />
            <button onClick={() => inputRef.current?.click()} className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border p-10 text-muted-foreground hover:border-gold hover:text-gold">
              <FileUp className="size-10" />
              <span>{L("Up to 6 photos or one PDF", "حتى ٦ صور أو PDF واحد")}</span>
            </button>
            {files.length > 0 && (
              <ul className="space-y-1 text-sm">
                {files.map((f, i) => <li key={i} className="flex items-center justify-between rounded bg-muted/40 px-3 py-1.5"><span className="truncate">{f.name}</span><button aria-label="Remove" onClick={() => setFiles(files.filter((_, j) => j !== i))}><X className="size-4" /></button></li>)}
              </ul>
            )}
            <Button variant="gold" size="lg" className="w-full" disabled={!files.length || busy} onClick={extract}>
              {busy ? <><Loader2 className="animate-spin" /> {L("Reading your menu…", "عم نقرأ المنيو…")}</> : <><Sparkles /> {L("Read my menu", "اقرأ المنيو")}</>}
            </Button>
          </div>
          <PhotoTips kind="menu" />
        </div>
      )}

      {step === 2 && res && (
        <div className="lux-card space-y-5 p-6">
          <p>{L("We found", "لقينا")} <b>{res.items?.length ?? 0}</b> {L("items. Please confirm how prices are written:", "صنف. أكّد كيف مكتوبة الأسعار:")}</p>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex gap-1">
              {(["USD", "LBP"] as const).map((c) => <Button key={c} variant={currency === c ? "gold" : "hairline"} onClick={() => setCurrency(c)}>{c}</Button>)}
            </div>
            {currency === "LBP" && <label className="flex items-center gap-2 text-sm"><Switch checked={thousands} onCheckedChange={setThousands} />{L("Prices are written in thousands (e.g. 450 = 450,000 LBP)", "الأسعار مكتوبة بالآلاف (مثلاً ٤٥٠ = ٤٥٠٬٠٠٠)")}</label>}
          </div>
          {!!res.questions_for_owner?.length && <div className="space-y-1">{res.questions_for_owner.map((q) => <p key={q} className="rounded-lg bg-gold/10 p-2 text-sm">❓ {q}</p>)}</div>}
          {!!res.image_quality_issues?.length && <div className="space-y-1">{res.image_quality_issues.map((q) => <p key={q} className="flex items-center gap-2 text-sm text-warning"><AlertTriangle className="size-4" />{q}</p>)}</div>}
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep(1)}>{L("Back", "رجوع")}</Button>
            <Button variant="gold" onClick={() => setStep(3)}>{L("Continue", "كمّل")}</Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{included} / {rows.length} {L("selected. Items that look like duplicates of your existing menu are unticked.", "محدد. الأصناف المكررة مش محددة.")}</p>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr><th className="p-2"></th><th className="p-2 text-start">{L("Name EN", "الاسم EN")}</th><th className="p-2 text-start">{L("Name AR", "الاسم AR")}</th><th className="p-2 text-start">{L("Section", "القسم")}</th><th className="p-2 text-start">{L("Price", "السعر")} ({currency})</th><th className="p-2">{L("Confidence", "الثقة")}</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.ref} className={cn("border-t border-border", !r.include && "opacity-50")}>
                    <td className="p-2"><Checkbox checked={r.include} onCheckedChange={(c) => setRow(r.ref, { include: !!c })} aria-label="Include" /></td>
                    <td className="p-2"><Input value={r.name_en} onChange={(e) => setRow(r.ref, { name_en: e.target.value })} className="h-8" />{r.dup && <span className="text-[10px] text-warning">{L("Possible duplicate", "ممكن مكرر")}</span>}</td>
                    <td className="p-2"><Input dir="rtl" value={r.name_ar ?? ""} onChange={(e) => setRow(r.ref, { name_ar: e.target.value })} className="h-8" /></td>
                    <td className="p-2"><Input value={r.section ?? ""} onChange={(e) => setRow(r.ref, { section: e.target.value })} className="h-8" /></td>
                    <td className="p-2"><Input type="number" value={r.price ?? ""} onChange={(e) => setRow(r.ref, { price: e.target.value === "" ? null : Number(e.target.value) })} className="h-8 w-28" />{r.price_text && <span className="text-[10px] text-muted-foreground">“{r.price_text}”</span>}</td>
                    <td className="p-2 text-center"><Conf c={r.confidence} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep(2)}>{L("Back", "رجوع")}</Button>
            <Button variant="gold" onClick={() => setStep(4)} disabled={!included}>{L("Continue", "كمّل")}</Button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="lux-card space-y-5 p-6">
          <h2 className="text-2xl font-semibold">{L("Enrich with AI (optional)", "إغناء بالذكاء (اختياري)")}</h2>
          <p className="text-sm text-muted-foreground">{L("Adds descriptions, ingredients, allergens and estimated macros. These are estimates you'll review later.", "بيضيف وصف، مكونات، حساسية وقيم تقديرية. هيدي تقديرات بتراجعها بعدين.")}</p>
          {progress != null && <Progress value={progress} />}
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="ghost" onClick={() => setStep(3)}>{L("Back", "رجوع")}</Button>
            <div className="flex gap-2">
              <Button variant="hairline" disabled={progress != null && progress < 100} onClick={enrich}><Sparkles /> {L("Enrich", "إغناء")} ({included})</Button>
              <Button variant="gold" disabled={busy || (progress != null && progress < 100)} onClick={publish}>{busy ? L("Publishing…", "عم ينشر…") : L("Publish", "انشر")} {included}</Button>
            </div>
          </div>
        </div>
      )}

      {step === 5 && (
        <div className="lux-card space-y-4 p-8 text-center">
          <CheckCircle2 className="mx-auto size-12 text-success" />
          <h2 className="text-3xl font-semibold">{published} {L("items published", "صنف انشروا")}</h2>
          <p className="text-muted-foreground">{L("Next: confirm allergens so customers can trust them.", "التالي: أكّد الحساسية ليثقوا فيها الزباين.")}</p>
          <div className="flex justify-center gap-2">
            <Button variant="gold" asChild><Link to="/merchant/menu">{L("Review allergens", "راجع الحساسية")}</Link></Button>
            <Button variant="hairline" onClick={() => { setStep(1); setFiles([]); setRows([]); setRes(null); setProgress(null); }}>{L("Import more", "استورد كمان")}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Conf({ c }: { c: number | string | undefined }) {
  const n = typeof c === "number" ? (c <= 1 ? c * 100 : c) : c === "high" ? 90 : c === "medium" ? 60 : c === "low" ? 30 : null;
  if (n == null) return <span className="text-muted-foreground">—</span>;
  return <span className={cn("rounded-full px-2 py-0.5 text-[11px]", n >= 75 ? "bg-success/15 text-success" : n >= 50 ? "bg-gold/15 text-gold" : "bg-destructive/15 text-destructive")}>{Math.round(n)}%</span>;
}
