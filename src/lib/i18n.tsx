import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "en" | "ar";

const dict = {
  en: {
    nav_try: "Try it",
    nav_merchants: "Merchants",
    nav_gift: "Send home",
    nav_crowns: "King Crowns",
    hero_kicker: "WhatsApp-native delivery · Shouf, Lebanon",
    hero_title: "Order the Shouf, on WhatsApp.",
    hero_sub:
      "Zero download. Type or send a Levantine voice note, and Alo King finds the dish, places the order and tracks your macros and dietary needs with AI.",
    cta_try: "Try it now",
    cta_wa: "Open WhatsApp",
    sim_title: "Talk to Alo King",
    sim_sub: "A live demo of the WhatsApp assistant. Ask in English or Arabic.",
    sim_placeholder: "Type a message",
    sim_track: "Track this order live",
    grid_title: "The Shouf, mapped",
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
    hero_kicker: "توصيل عبر واتساب · الشوف، لبنان",
    hero_title: "اطلب الشوف، عالواتساب.",
    hero_sub:
      "بلا تحميل تطبيق. اكتب أو ابعت رسالة صوتية باللهجة، وألو كينغ بيلاقي الأكلة، بيعمل الطلب، وبيتابع السعرات والحمية بالذكاء الاصطناعي.",
    cta_try: "جرّب هلّق",
    cta_wa: "افتح واتساب",
    sim_title: "احكي مع ألو كينغ",
    sim_sub: "تجربة حيّة للمساعد على واتساب. اسأل بالعربي أو بالإنكليزي.",
    sim_placeholder: "اكتب رسالة",
    sim_track: "تابع الطلب مباشرة",
    grid_title: "الشوف على الخريطة",
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

type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: (k: DictKey) => string; dir: "ltr" | "rtl" };
const LangCtx = createContext<Ctx | null>(null);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");
  useEffect(() => {
    const saved = localStorage.getItem("ak_lang");
    if (saved === "ar" || saved === "en") setLangState(saved);
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);
  const setLang = (l: Lang) => {
    setLangState(l);
    localStorage.setItem("ak_lang", l);
  };
  return (
    <LangCtx.Provider value={{ lang, setLang, t: (k) => dict[lang][k], dir: lang === "ar" ? "rtl" : "ltr" }}>
      {children}
    </LangCtx.Provider>
  );
}

export function useLang() {
  const c = useContext(LangCtx);
  if (!c) throw new Error("useLang outside LangProvider");
  return c;
}
