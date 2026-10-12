import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

// The language of the private pages (merchant, driver, admin, claim), kept as a toggle until session 6b restyles them.
// The public pages take their language from the URL (/ar, /en, /fr: src/lib/site.ts); `forced` makes this context agree.
export type Lang = "en" | "ar" | "fr";

const dict = {
  en: {
    nav_try: "Try it",
    nav_merchants: "Merchants",
    nav_gift: "Send home",
    nav_crowns: "King Crowns",
    hero_kicker: "WhatsApp-native delivery · Lebanon",
    hero_title: "Order on WhatsApp.",
    hero_sub: "Zero download. Type, speak or tap, and Alo King takes care of the rest.",
    cta_try: "Try it now",
    cta_wa: "Open WhatsApp",
    sim_title: "Talk to Alo King",
    sim_sub: "A live demo of the WhatsApp assistant. Ask in English or Arabic.",
    sim_placeholder: "Type a message",
    sim_track: "Track this order live",
    grid_title: "Places",
    grid_search: "Search merchants",
    grid_all: "All",
    grid_more: "Load more",
    grid_empty: "No merchants match these filters.",
    gift_title: "Send a meal home",
    crowns_title: "King Crowns",
    how_title: "How it works",
  },
  ar: {
    nav_try: "جرّب",
    nav_merchants: "المحلات",
    nav_gift: "هدية للأهل",
    nav_crowns: "تيجان الملك",
    hero_kicker: "توصيل عبر واتساب · لبنان",
    hero_title: "اطلب عالواتساب.",
    hero_sub: "بلا تحميل تطبيق. اكتب أو احكي أو دوس، وألو كينغ بيهتم بالباقي.",
    cta_try: "جرّب هلّق",
    cta_wa: "افتح واتساب",
    sim_title: "احكي مع ألو كينغ",
    sim_sub: "تجربة حيّة للمساعد على واتساب. اسأل بالعربي أو بالإنكليزي.",
    sim_placeholder: "اكتب رسالة",
    sim_track: "تابع الطلب مباشرة",
    grid_title: "المناطق",
    grid_search: "ابحث عن محل",
    grid_all: "الكل",
    grid_more: "عرض المزيد",
    grid_empty: "ما في محلات بهالفلاتر.",
    gift_title: "ابعت أكلة للبيت",
    crowns_title: "تيجان الملك",
    how_title: "كيف بيشتغل",
  },
} as const;

export type DictKey = keyof (typeof dict)["en"];

type Ctx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (k: DictKey) => string;
  dir: "ltr" | "rtl";
};
const LangCtx = createContext<Ctx | null>(null);

export function LangProvider({ children, forced }: { children: ReactNode; forced?: Lang }) {
  const [lang, setLangState] = useState<Lang>(forced ?? "en");
  useEffect(() => {
    if (forced) return;
    const saved = localStorage.getItem("ak_lang");
    if (saved === "ar" || saved === "en" || saved === "fr") setLangState(saved);
  }, [forced]);
  const active = forced ?? lang;
  useEffect(() => {
    document.documentElement.lang = active;
    document.documentElement.dir = active === "ar" ? "rtl" : "ltr";
  }, [active]);
  const setLang = (l: Lang) => {
    setLangState(l);
    localStorage.setItem("ak_lang", l);
  };
  const d = dict[active === "ar" ? "ar" : "en"];
  return <LangCtx.Provider value={{ lang: active, setLang, t: (k) => d[k], dir: active === "ar" ? "rtl" : "ltr" }}>{children}</LangCtx.Provider>;
}

export function useLang() {
  const c = useContext(LangCtx);
  if (!c) throw new Error("useLang outside LangProvider");
  return c;
}

/** Inline bilingual helper for the private pages: const L = useL(); L("Hello", "مرحبا"). French reads the English. */
export function useL() {
  const { lang } = useLang();
  return (en: string, ar: string) => (lang === "ar" ? ar : en);
}
