import { Link } from "@tanstack/react-router";
import { Crown } from "lucide-react";
import { useLang, useL } from "@/lib/i18n";

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
  const L = useL();
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-5">
        <Link to="/" className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-full bg-gold-gradient text-gold-foreground">
            <Crown className="size-4" />
          </span>
          <span className="font-display text-xl font-semibold">Alo King</span>
          <span className="font-arabic hidden text-sm text-muted-foreground sm:inline">
            ألو كينغ
          </span>
        </Link>
        <nav className="flex items-center gap-4 text-sm text-muted-foreground md:gap-6">
          <Link to="/explore" className="hover:text-gold" activeProps={{ className: "text-gold" }}>
            {L("Explore", "استكشف")}
          </Link>
          <Link
            to="/for-business"
            className="hidden hover:text-gold sm:inline"
            activeProps={{ className: "text-gold" }}
          >
            {L("For business", "لأصحاب المحلات")}
          </Link>
          <a href="/#simulator" className="hidden hover:text-gold md:inline">
            {L("Try it", "جرّب")}
          </a>
          <a href="/#gift" className="hidden hover:text-gold lg:inline">
            {L("Send home", "هدية للأهل")}
          </a>
        </nav>
        <LangToggle />
      </div>
    </header>
  );
}
