import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ImagePlus, Loader2, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ProposalCard, type Proposal } from "@/components/shared/ProposalCard";
import { aiFriendly, invokeFn, resizeImage } from "@/lib/edge";
import { useL } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { savePrivate, saveProfile, updateItem, useMenuItems, useMerchant, useRefreshMerchant, useVendorPrivate, useVendorProfile, type ChatMsg } from "./context";

type Entry = { role: "user" | "assistant"; content: string; proposals?: Proposal[] };

type AssistantState = {
  entries: Entry[];
  setEntries: React.Dispatch<React.SetStateAction<Entry[]>>;
  draft: string;
  setDraft: (s: string) => void;
};
const Ctx = createContext<AssistantState | null>(null);

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState("");
  return <Ctx.Provider value={{ entries, setEntries, draft, setDraft }}>{children}</Ctx.Provider>;
}
export const useAssistantState = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("AssistantProvider missing");
  return c;
};

const CHIPS: [string, string][] = [
  ["What should I fix first?", "شو لازم صلّح أول؟"],
  ["Help me fill in allergens", "ساعدني بمسببات الحساسية"],
  ["Photo tips", "نصائح للصور"],
  ["Write my description", "اكتبلي وصف المحل"],
  ["Set my opening hours", "ظبطلي أوقات الدوام"],
];

export function AssistantChat({ className }: { className?: string }) {
  const L = useL();
  const { vendorId } = useMerchant();
  const { entries, setEntries, draft, setDraft } = useAssistantState();
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const profileQ = useVendorProfile(vendorId);
  const privQ = useVendorPrivate(vendorId);
  const itemsQ = useMenuItems(vendorId);
  const refresh = useRefreshMerchant();
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.length, busy]);

  async function send(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    const next: Entry[] = [...entries, { role: "user", content: t }];
    setEntries(next);
    setDraft("");
    setBusy(true);
    try {
      const messages: ChatMsg[] = next.slice(-14).map(({ role, content }) => ({ role, content }));
      const r = await invokeFn<{ reply: string; proposals?: Proposal[] }>("merchant-ai", { action: "chat", vendor_id: vendorId, messages });
      setEntries((e) => [...e, { role: "assistant", content: r.reply, proposals: r.proposals ?? [] }]);
    } catch (e) {
      const msg = aiFriendly(e);
      setEntries((x) => [...x, { role: "assistant", content: msg }]);
    } finally {
      setBusy(false);
    }
  }

  async function reviewPhoto(f: File) {
    setBusy(true);
    setEntries((e) => [...e, { role: "user", content: L("📷 Please review this photo", "📷 قيّم هالصورة") }]);
    try {
      const img = await resizeImage(f);
      const r = await invokeFn<{ score: number; verdict: string; issues: string[]; tips: string[] }>("merchant-ai", { action: "photo_review", vendor_id: vendorId, image: { media_type: img.media_type, data: img.base64 } });
      const txt = [`${L("Score", "التقييم")}: ${r.score}/10 · ${r.verdict}`, ...(r.issues?.length ? [`${L("Issues", "مشاكل")}:`, ...r.issues.map((x) => `• ${x}`)] : []), ...(r.tips?.length ? [`${L("Tips", "نصائح")}:`, ...r.tips.map((x) => `• ${x}`)] : [])].join("\n");
      setEntries((e) => [...e, { role: "assistant", content: txt }]);
    } catch (e) {
      setEntries((x) => [...x, { role: "assistant", content: aiFriendly(e) }]);
    } finally {
      setBusy(false);
    }
  }

  async function apply(p: Proposal) {
    try {
      if (p.target === "profile") await saveProfile(vendorId, p.fields);
      else if (p.target === "private") await savePrivate(vendorId, p.fields);
      else if (p.item_id) await updateItem(p.item_id, p.fields);
      toast.success(L("Applied", "تم التطبيق"));
      setDismissed((s) => new Set(s).add(p.id));
      await refresh(vendorId);
    } catch (e) {
      toast.error(aiFriendly(e));
    }
  }

  const current = (p: Proposal) =>
    (p.target === "profile" ? profileQ.data : p.target === "private" ? privQ.data : itemsQ.data?.find((i) => i.item_id === p.item_id)) as Record<string, unknown> | undefined;

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div className="flex-1 space-y-3 overflow-y-auto p-1">
        {entries.length === 0 && (
          <div className="py-6 text-center">
            <Sparkles className="mx-auto size-8 text-gold" />
            <p className="mt-2 font-display text-2xl">{L("Your Alo King assistant", "مساعدك من ألو كينغ")}</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{L("Ask in English or Arabic. I suggest changes, you approve them.", "اسأل بالعربي أو بالإنكليزي. أنا بقترح، وانت بتوافق.")}</p>
          </div>
        )}
        {entries.map((e, i) => (
          <div key={i} className={cn("space-y-2", e.role === "user" && "flex flex-col items-end")}>
            <div className={cn("max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm", e.role === "user" ? "bg-secondary text-secondary-foreground" : "bg-muted")}>{e.content}</div>
            {e.proposals?.filter((p) => !dismissed.has(p.id)).map((p) => (
              <ProposalCard
                key={p.id}
                proposal={p}
                current={current(p)}
                title={p.item_id ? itemsQ.data?.find((x) => x.item_id === p.item_id)?.item_name_en ?? undefined : undefined}
                onApply={() => apply(p)}
                onDismiss={() => setDismissed((s) => new Set(s).add(p.id))}
              />
            ))}
          </div>
        ))}
        {busy && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{L("Thinking…", "عم فكّر…")}</div>}
        <div ref={endRef} />
      </div>
      <div className="mt-2 flex gap-1.5 overflow-x-auto pb-2">
        {CHIPS.map(([en, ar]) => (
          <button key={en} disabled={busy} onClick={() => send(L(en, ar))} className="shrink-0 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:border-gold hover:text-gold">
            {L(en, ar)}
          </button>
        ))}
      </div>
      <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void send(draft); }}>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void reviewPhoto(f); e.target.value = ""; }} />
        <Button type="button" variant="ghost" size="icon" aria-label={L("Attach photo for review", "أرفق صورة للتقييم")} onClick={() => fileRef.current?.click()} disabled={busy}><ImagePlus /></Button>
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(draft); } }}
          rows={1}
          placeholder={L("Ask the assistant…", "اسأل المساعد…")}
          className="min-h-10 resize-none"
        />
        <Button type="submit" variant="gold" size="icon" disabled={busy || !draft.trim()} aria-label="Send"><Send className="rtl:-scale-x-100" /></Button>
      </form>
    </div>
  );
}
