import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/lib/supabase";
import { WHATSAPP_DISPLAY, WHATSAPP_NUMBER } from "@/lib/config";
import { errMsg } from "@/lib/format";
import { useL } from "@/lib/i18n";

type OwnerConsole = { linked: boolean; owner_phone: string | null; credits_usd: number | null };

const consoleKey = (vendorId: string) => ["m-owner-console", vendorId] as const;
const mask = (p: string) => `+${p.slice(0, 3)} ••• ••• ${p.slice(-2)}`;

/** Link the owner's WhatsApp so they can manage prices, pauses, summaries and offers by chat. */
export function ManageByWhatsAppCard({ vendorId }: { vendorId: string }) {
  const L = useL();
  const qc = useQueryClient();
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const consoleQ = useQuery({
    queryKey: consoleKey(vendorId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_owner_console", { p_vendor: vendorId });
      if (error) throw error;
      return data as OwnerConsole;
    },
  });

  const gen = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("create_owner_link_code", { p_vendor: vendorId });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (c) => {
      setCode(c);
      setCopied(false);
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const copy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(
        L("Couldn't copy — select the code manually.", "ما قدرنا ننسخ — حدد الكود يدوياً."),
      );
    }
  };

  const c = consoleQ.data;
  const linked = !!c?.linked;
  const waLink = code ? `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(code)}` : null;

  return (
    <section className="lux-card space-y-4 p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-2xl font-semibold">
          <MessageCircle className="size-5 text-gold" />
          {L("Manage by WhatsApp", "أدِر من واتساب")}
        </h2>
        {c && (
          <span className={linked ? "text-xs text-success" : "text-xs text-muted-foreground"}>
            {linked ? L("Linked", "مربوط") : L("Not linked", "غير مربوط")}
          </span>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        {L(
          "Text or voice-note Alo King to change prices, mark items sold out, pause orders, see today's numbers and send offers to your customers.",
          "ابعت رسالة أو فويس لألو كينغ لتغيّر الأسعار، تعلّم صنف خلصان، توقّف الطلبات، تشوف أرقام اليوم وتبعت عروض لزبائنك.",
        )}
      </p>

      {consoleQ.isLoading && <Skeleton className="h-16" />}
      {consoleQ.isError && <p className="text-sm text-destructive">{errMsg(consoleQ.error)}</p>}

      {c && (
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted-foreground">{L("Linked number", "الرقم المربوط")}</p>
            <p className="font-medium">
              {c.owner_phone ? mask(c.owner_phone) : L("None yet", "ما في بعد")}
            </p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted-foreground">{L("Broadcast credit", "رصيد البث")}</p>
            <p className="font-medium">${Number(c.credits_usd ?? 0).toFixed(2)}</p>
          </div>
        </div>
      )}

      {code && (
        <div className="space-y-3 rounded-lg border border-dashed border-border p-4">
          <p className="text-sm">
            {L(
              "Send this code from the WhatsApp number you want to link to",
              "ابعت هالكود من رقم الواتساب اللي بدك تربطو على",
            )}{" "}
            <span className="font-medium">{WHATSAPP_DISPLAY}</span>.{" "}
            {L("It expires in 30 minutes.", "بينتهي بعد 30 دقيقة.")}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code
              className="rounded-md bg-muted px-3 py-2 text-lg font-semibold tracking-widest"
              dir="ltr"
            >
              {code}
            </code>
            <Button type="button" variant="outline" size="sm" onClick={copy}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? L("Copied", "اننسخ") : L("Copy", "انسخ")}
            </Button>
            {waLink && (
              <Button asChild variant="gold" size="sm">
                <a href={waLink} target="_blank" rel="noreferrer">
                  {L("Open WhatsApp", "افتح واتساب")}
                </a>
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <Button
          variant={linked ? "outline" : "gold"}
          disabled={gen.isPending || consoleQ.isLoading}
          onClick={() =>
            gen.mutate(undefined, {
              onSuccess: () => {
                void qc.invalidateQueries({ queryKey: consoleKey(vendorId) });
              },
            })
          }
        >
          {gen.isPending && <Loader2 className="size-4 animate-spin" />}
          {code
            ? L("New code", "كود جديد")
            : linked
              ? L("Link a different number", "اربط رقم تاني")
              : L("Generate link code", "أنشئ كود الربط")}
        </Button>
      </div>
    </section>
  );
}
