import { MessageSquareText, ChefHat, Bike, Crown } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { WHATSAPP_DISPLAY, WHATSAPP_LINK } from "@/lib/config";

const STEPS = [
  { icon: MessageSquareText, title: "Message Alo King", body: "Text or voice-note what you want, in Arabic, English or a bit of both." },
  { icon: ChefHat, title: "The kitchen confirms", body: "The merchant accepts on their terminal and starts cooking. You get a live tracking link." },
  { icon: Bike, title: "Delivered across the Shouf", body: "A local driver brings it to your door. Pay cash on delivery." },
];

export function HowItWorks() {
  const { t } = useLang();
  return (
    <section className="mx-auto max-w-6xl px-5 py-24">
      <h2 className="text-4xl font-semibold md:text-6xl">{t("how_title")}</h2>
      <div className="mt-12 grid gap-6 md:grid-cols-3">
        {STEPS.map((s, i) => (
          <div key={s.title} className="lux-card p-7">
            <div className="flex items-center justify-between">
              <s.icon className="size-6 text-gold" />
              <span className="font-display text-5xl text-muted-foreground/40">0{i + 1}</span>
            </div>
            <h3 className="mt-6 text-2xl font-semibold">{s.title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-12 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2">
          <Crown className="size-5 text-gold" />
          <span className="font-display text-xl font-semibold">Alo King</span>
          <span className="font-arabic text-muted-foreground">ألو كينغ</span>
        </div>
        <div className="flex flex-wrap gap-6 text-sm text-muted-foreground">
          <a href={WHATSAPP_LINK} target="_blank" rel="noreferrer" className="hover:text-gold">WhatsApp {WHATSAPP_DISPLAY}</a>
          <a href="/merchant" className="hover:text-gold">Kitchen terminal</a>
          <a href="/driver" className="hover:text-gold">Driver app</a>
        </div>
        <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} Alo King · Shouf, Lebanon</p>
      </div>
    </footer>
  );
}
