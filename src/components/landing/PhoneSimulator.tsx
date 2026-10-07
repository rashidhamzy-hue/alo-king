import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Send, Crown, MapPin } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DEMO_CHAT_URL, SUPABASE_KEY } from "@/lib/config";
import { hasArabic } from "@/lib/format";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Msg = { role: "user" | "assistant"; content: string; orderId?: string | null };

const CHIPS = [
  "High-protein lunch in Baakleen",
  "Vegan mezze under $8",
  "شو في مناقيش بالباكلين؟",
  "Gluten-free dinner",
];

export function PhoneSimulator() {
  const { t } = useLang();
  const [msgs, setMsgs] = useState<Msg[]>([
    {
      role: "assistant",
      content:
        "Ahla w sahla! I'm Alo King. Tell me what you're craving in the Shouf, in English or Arabic.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [msgs, busy]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    const next = [...msgs, { role: "user" as const, content }];
    setMsgs(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch(DEMO_CHAT_URL, {
        method: "POST",
        headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next.slice(-8).map(({ role, content }) => ({ role, content })),
        }),
      });
      if (res.status === 429)
        throw new Error("The demo is busy right now. Give it a few seconds and try again.");
      if (!res.ok)
        throw new Error(`The assistant couldn't answer (${res.status}). Please try again.`);
      const data = (await res.json()) as { reply?: string; order_id?: string | null };
      setMsgs((m) => [
        ...m,
        { role: "assistant", content: data.reply || "…", orderId: data.order_id ?? null },
      ]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Network error";
      toast.error(msg);
      setMsgs((m) => [
        ...m,
        {
          role: "assistant",
          content: "Sorry, I couldn't reach the kitchen just now. Try again in a moment.",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      id="simulator"
      className="mx-auto grid max-w-6xl items-center gap-14 px-5 py-24 md:grid-cols-2"
    >
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-gold">Live demo</p>
        <h2 className="mt-4 text-4xl font-semibold md:text-6xl">{t("sim_title")}</h2>
        <p className="mt-4 max-w-md text-muted-foreground">{t("sim_sub")}</p>
        <div className="mt-8 flex flex-wrap gap-2">
          {CHIPS.map((c) => (
            <button
              key={c}
              disabled={busy}
              onClick={() => send(c)}
              dir={hasArabic(c) ? "rtl" : "ltr"}
              className="hairline rounded-full px-4 py-2 text-sm text-foreground transition hover:bg-gold/10 disabled:opacity-50"
            >
              {c}
            </button>
          ))}
        </div>
        <p className="mt-6 text-xs text-muted-foreground">
          Nutrition figures from the assistant are approximate estimates.
        </p>
      </div>

      {/* Phone frame */}
      <div className="mx-auto w-full max-w-[360px]">
        <div className="rounded-[3rem] border-[10px] border-muted bg-muted p-0 shadow-glow-emerald">
          <div className="relative flex h-[640px] flex-col overflow-hidden rounded-[2.3rem] bg-wa-bg">
            <div className="absolute left-1/2 top-2 z-10 h-6 w-28 -translate-x-1/2 rounded-full bg-obsidian" />
            <div className="flex items-center gap-3 bg-secondary px-4 pb-3 pt-10 text-secondary-foreground">
              <ArrowLeft className="size-5 opacity-80" />
              <span className="grid size-9 place-items-center rounded-full bg-gold-gradient text-gold-foreground">
                <Crown className="size-4" />
              </span>
              <div className="leading-tight">
                <p className="text-sm font-semibold">Alo King</p>
                <p className="text-xs opacity-75">{busy ? "typing…" : "online"}</p>
              </div>
            </div>
            <div ref={scroller} className="flex-1 space-y-2 overflow-y-auto px-3 py-4">
              <AnimatePresence initial={false}>
                {msgs.map((m, i) => {
                  const rtl = hasArabic(m.content);
                  return (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 8, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
                    >
                      <div
                        dir={rtl ? "rtl" : "ltr"}
                        className={cn(
                          "max-w-[82%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed",
                          rtl && "font-arabic",
                          m.role === "user" ? "rounded-ee-sm bg-wa-out" : "rounded-es-sm bg-wa-in",
                        )}
                      >
                        {m.content}
                        {m.orderId && (
                          <Button variant="gold" size="sm" className="mt-3 w-full" asChild>
                            <Link to="/track/$orderId" params={{ orderId: m.orderId }}>
                              <MapPin /> {t("sim_track")}
                            </Link>
                          </Button>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
              {busy && (
                <div className="flex">
                  <div className="flex gap-1 rounded-2xl rounded-es-sm bg-wa-in px-4 py-3">
                    {[0, 1, 2].map((d) => (
                      <span
                        key={d}
                        className="typing-dot size-1.5 rounded-full bg-muted-foreground"
                        style={{ animationDelay: `${d * 0.15}s` }}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send(input);
              }}
              className="flex items-center gap-2 p-2"
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                dir={hasArabic(input) ? "rtl" : "ltr"}
                placeholder={t("sim_placeholder")}
                className="h-11 flex-1 rounded-full bg-wa-in px-4 text-sm outline-none placeholder:text-muted-foreground"
              />
              <button
                type="submit"
                disabled={busy || !input.trim()}
                aria-label="Send"
                className="grid size-11 place-items-center rounded-full bg-secondary text-secondary-foreground disabled:opacity-50"
              >
                <Send className="size-4 rtl:-scale-x-100" />
              </button>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}
