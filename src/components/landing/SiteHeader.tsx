import { Crown } from "lucide-react";
import { useLang } from "@/lib/i18n";

export function LangToggle() {
  const { lang, setLang } = useLang();
  return (
    <button
      onClick={() => setLang(lang === "en" ? "ar" : "en")}
      className="hairline rounded-full px-3 py-1.5 text-xs font-medium text-gold hover:bg-gold/10"
      aria-label="Toggle language"
    >
      {lang === "en" ? "العربية" : "English"}
    </button>
  );
}

export function SiteHeader() {
  const { t } = useLang();
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <a href="#top" className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-full bg-gold-gradient text-gold-foreground">
            <Crown className="size-4" />
          </span>
          <span className="font-display text-xl font-semibold">Alo King</span>
          <span className="font-arabic text-sm text-muted-foreground">ألو كينغ</span>
        </a>
        <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
          <a href="#simulator" className="hover:text-gold">{t("nav_try")}</a>
          <a href="#merchants" className="hover:text-gold">{t("nav_merchants")}</a>
          <a href="#gift" className="hover:text-gold">{t("nav_gift")}</a>
          <a href="#crowns" className="hover:text-gold">{t("nav_crowns")}</a>
        </nav>
        <LangToggle />
      </div>
    </header>
  );
}
