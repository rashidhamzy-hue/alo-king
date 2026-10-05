import { motion } from "framer-motion";
import { MessageCircle, Mic, Activity, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLang } from "@/lib/i18n";
import { WHATSAPP_LINK } from "@/lib/config";

export function Hero() {
  const { t } = useLang();
  const feats = [
    { icon: Smartphone, en: "Zero download" },
    { icon: Mic, en: "Text or Levantine voice note" },
    { icon: Activity, en: "AI macro & dietary tracking" },
  ];
  return (
    <section id="top" className="relative overflow-hidden bg-hero">
      <div className="mx-auto max-w-6xl px-5 pb-24 pt-20 md:pt-32">
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-xs uppercase tracking-[0.3em] text-gold"
        >
          {t("hero_kicker")}
        </motion.p>
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.7 }}
          className="mt-6 max-w-4xl text-5xl font-semibold leading-[1.02] md:text-8xl"
        >
          {t("hero_title")}
        </motion.h1>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="mt-6 max-w-2xl text-lg text-muted-foreground"
        >
          {t("hero_sub")}
        </motion.p>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45 }} className="mt-10 flex flex-wrap gap-3">
          <Button variant="gold" size="lg" asChild>
            <a href="#simulator">{t("cta_try")}</a>
          </Button>
          <Button variant="hairline" size="lg" asChild>
            <a href={WHATSAPP_LINK} target="_blank" rel="noreferrer">
              <MessageCircle /> {t("cta_wa")}
            </a>
          </Button>
        </motion.div>
        <div className="mt-14 flex flex-wrap gap-x-8 gap-y-3 text-sm text-muted-foreground">
          {feats.map((f) => (
            <span key={f.en} className="flex items-center gap-2">
              <f.icon className="size-4 text-emerald-glow" /> {f.en}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
