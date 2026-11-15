// One set of templates, three languages (docs/WEBSITE.md "Shape"): Arabic (right to left) and English from day one, French strings
// in the same file. The language follows the visitor's choice, kept in the `lang` cookie; with no choice it follows the browser's
// Accept-Language, and with neither it is Arabic. Names come from the database in Arabic and English; French shows the English name.

export const LANGS = ["ar", "en", "fr"] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = "ar";
export const isLang = (v: unknown): v is Lang => typeof v === "string" && (LANGS as readonly string[]).includes(v);
export const dirOf = (l: Lang): "rtl" | "ltr" => (l === "ar" ? "rtl" : "ltr");
export const LANG_NAMES: Record<Lang, string> = { ar: "العربية", en: "English", fr: "Français" };

/** The visitor's language: the cookie, else the browser's own order of preference, else Arabic. */
export function negotiate(cookie: string | null | undefined, acceptLanguage: string | null | undefined): Lang {
  const m = /(?:^|;\s*)lang=([a-z]{2})(?:;|$)/.exec(cookie ?? "");
  if (m && isLang(m[1])) return m[1];
  const ranked = (acceptLanguage ?? "").split(",").map((part) => {
    const [tag, ...params] = part.trim().split(";");
    const q = params.map((p) => /^\s*q=([0-9.]+)\s*$/.exec(p)).find(Boolean);
    return { code: (tag ?? "").slice(0, 2).toLowerCase(), q: q ? Number(q[1]) : 1 };
  }).filter((x) => x.q > 0 && isLang(x.code)).sort((a, b) => b.q - a.q);
  return (ranked[0]?.code as Lang | undefined) ?? DEFAULT_LANG;
}

/** The name in the page language: Arabic where the database has it, otherwise English. */
export const nameIn = (l: Lang, en: string | null | undefined, ar: string | null | undefined): string => (l === "ar" && ar ? ar : en || ar || "");

export const usd = (n: number | string) => `$${Number(n).toFixed(2)}`;

type Dict = Record<string, string>;
const en: Dict = {
  site: "Alo King", tagline: "Groceries delivered in the Chouf.",
  search: "Search", search_placeholder: "Search products", search_label: "Search the catalog",
  categories: "Categories", home: "Home", skip: "Skip to content",
  open_now: "Open now", closed_now: "Closed now. You can still browse.", hours: "Opening hours", delivery_to: "We deliver to",
  fee: "delivery", about_min: "about {n} min", villages_none: "The delivery area will be listed here soon.",
  order_whatsapp: "Order on WhatsApp", ask_whatsapp: "Ask on WhatsApp about this item",
  items: "{n} items", in_stock: "In stock", out_of_stock: "Out of stock", price: "Price", brand: "Brand", size_unit: "Sold by",
  no_picture: "No picture yet", credit_pictures: "Some pictures are from Open Food Facts contributors (CC BY-SA 3.0): openfoodfacts.org.",
  facts_title: "Food facts", facts_intro: "Shown only after our team checked them, with how each was checked. Where it says \"not verified\" we have not confirmed it: do not assume it is safe or free of anything. If you have an allergy, tell us on WhatsApp before you order.",
  allergens: "Allergens", diets: "Diet", ingredients: "Ingredients", nutrition: "Nutrition per 100 g", storage: "Storage", origin: "Country of origin",
  contains: "Contains", may_contain: "May contain", free_of: "Free of", yes: "Yes", no: "No",
  not_verified: "Not verified", not_verified_list: "Not verified: {list}", nothing_verified: "Nothing is verified yet for this item.",
  status_certified: "certified", status_declared: "declared", status_calculated: "calculated",
  src_label: "pack label", src_supplier: "supplier", src_certificate: "certificate", src_lab: "lab report", src_calculation: "calculation",
  src_merchant: "merchant", src_open_food_facts: "Open Food Facts", src_staff: "our team",
  checked_on: "checked {date}", credit_off: "Some information and pictures here come from Open Food Facts (openfoodfacts.org), under the ODbL and CC BY-SA licences.",
  search_results: "Results for \"{q}\"", search_none: "We do not have \"{q}\" yet. We have noted that you looked for it.", search_short: "Type at least two letters.",
  search_found: "{n} found", try_whatsapp: "Ask us on WhatsApp",
  not_found: "Page not found", not_found_text: "This page does not exist, or the item is not available now.", back_home: "Back to the home page",
  unavailable: "Temporarily unavailable", unavailable_text: "We could not load this page. Please try again in a moment.",
  offline: "You are offline", offline_text: "This page is not saved on your phone. Pages you opened before still work. Ordering needs a connection.",
  privacy: "Privacy", terms: "Terms", language: "Language",
  placeholder_legal: "This text is being prepared with our lawyer and will be published here before the site opens for orders.",
  footer_note: "Prices are in US dollars. Price and stock are checked again when you order.",
};
const ar: Dict = {
  site: "ألو كينغ", tagline: "توصيل البقالة في الشوف.",
  search: "بحث", search_placeholder: "ابحث عن منتج", search_label: "ابحث في الكتالوج",
  categories: "الأقسام", home: "الرئيسية", skip: "انتقل إلى المحتوى",
  open_now: "مفتوح الآن", closed_now: "مغلق الآن. يمكنك التصفح.", hours: "ساعات العمل", delivery_to: "نوصّل إلى",
  fee: "التوصيل", about_min: "حوالي {n} دقيقة", villages_none: "ستظهر منطقة التوصيل هنا قريبًا.",
  order_whatsapp: "اطلب عبر واتساب", ask_whatsapp: "اسألنا عن هذا المنتج عبر واتساب",
  items: "{n} منتج", in_stock: "متوفر", out_of_stock: "غير متوفر", price: "السعر", brand: "الماركة", size_unit: "يُباع بـ",
  no_picture: "لا توجد صورة بعد", credit_pictures: "بعض الصور من مساهمي Open Food Facts (CC BY-SA 3.0): openfoodfacts.org.",
  facts_title: "معلومات غذائية", facts_intro: "لا تظهر إلا بعد أن يتحقق فريقنا منها، مع طريقة التحقق. عندما تقرأ «لم يتم التحقق» فهذا يعني أننا لم نؤكد المعلومة: لا تفترض أن المنتج آمن أو خالٍ من أي مكوّن. إذا عندك حساسية، أخبرنا عبر واتساب قبل أن تطلب.",
  allergens: "مسببات الحساسية", diets: "النظام الغذائي", ingredients: "المكوّنات", nutrition: "القيم الغذائية لكل ١٠٠ غ", storage: "طريقة الحفظ", origin: "بلد المنشأ",
  contains: "يحتوي على", may_contain: "قد يحتوي على", free_of: "خالٍ من", yes: "نعم", no: "لا",
  not_verified: "لم يتم التحقق", not_verified_list: "لم يتم التحقق من: {list}", nothing_verified: "لم يتم التحقق بعد من أي معلومة لهذا المنتج.",
  status_certified: "موثّق بشهادة", status_declared: "مُصرَّح به", status_calculated: "محسوب",
  src_label: "ملصق العبوة", src_supplier: "المورّد", src_certificate: "شهادة", src_lab: "تقرير مخبري", src_calculation: "حساب",
  src_merchant: "التاجر", src_open_food_facts: "Open Food Facts", src_staff: "فريقنا",
  checked_on: "تم التحقق {date}", credit_off: "بعض المعلومات والصور هنا من Open Food Facts (openfoodfacts.org) بموجب رخصتي ODbL وCC BY-SA.",
  search_results: "نتائج «{q}»", search_none: "ما عندنا «{q}» بعد. سجّلنا أنك سألت عنه.", search_short: "اكتب حرفين على الأقل.",
  search_found: "وُجد {n}", try_whatsapp: "اسألنا عبر واتساب",
  not_found: "الصفحة غير موجودة", not_found_text: "هذه الصفحة غير موجودة، أو أن المنتج غير متوفر الآن.", back_home: "العودة إلى الرئيسية",
  unavailable: "غير متاح مؤقتًا", unavailable_text: "تعذّر تحميل هذه الصفحة. حاول مرة أخرى بعد قليل.",
  offline: "لا يوجد اتصال", offline_text: "هذه الصفحة غير محفوظة على هاتفك. الصفحات التي فتحتها سابقًا تعمل. الطلب يحتاج إلى اتصال.",
  privacy: "الخصوصية", terms: "الشروط", language: "اللغة",
  placeholder_legal: "يجري إعداد هذا النص مع محامينا وسيُنشر هنا قبل فتح الموقع للطلبات.",
  footer_note: "الأسعار بالدولار الأميركي. يُعاد التحقق من السعر والتوفر عند الطلب.",
};
const fr: Dict = {
  site: "Alo King", tagline: "Courses livrées dans le Chouf.",
  search: "Rechercher", search_placeholder: "Rechercher un produit", search_label: "Rechercher dans le catalogue",
  categories: "Catégories", home: "Accueil", skip: "Aller au contenu",
  open_now: "Ouvert maintenant", closed_now: "Fermé pour le moment. Vous pouvez parcourir.", hours: "Horaires", delivery_to: "Nous livrons à",
  fee: "livraison", about_min: "environ {n} min", villages_none: "La zone de livraison sera bientôt indiquée ici.",
  order_whatsapp: "Commander sur WhatsApp", ask_whatsapp: "Poser une question sur WhatsApp à propos de cet article",
  items: "{n} articles", in_stock: "En stock", out_of_stock: "Épuisé", price: "Prix", brand: "Marque", size_unit: "Vendu par",
  no_picture: "Pas encore de photo", credit_pictures: "Certaines photos viennent des contributeurs d'Open Food Facts (CC BY-SA 3.0) : openfoodfacts.org.",
  facts_title: "Informations alimentaires", facts_intro: "Affichées seulement après vérification par notre équipe, avec la façon dont elles ont été vérifiées. Quand on lit « non vérifié », nous ne l'avons pas confirmé : ne supposez pas que le produit est sûr ou exempt de quoi que ce soit. En cas d'allergie, dites-le-nous sur WhatsApp avant de commander.",
  allergens: "Allergènes", diets: "Régime", ingredients: "Ingrédients", nutrition: "Valeurs nutritionnelles pour 100 g", storage: "Conservation", origin: "Pays d'origine",
  contains: "Contient", may_contain: "Peut contenir", free_of: "Sans", yes: "Oui", no: "Non",
  not_verified: "Non vérifié", not_verified_list: "Non vérifié : {list}", nothing_verified: "Rien n'est encore vérifié pour cet article.",
  status_certified: "certifié", status_declared: "déclaré", status_calculated: "calculé",
  src_label: "étiquette de l'emballage", src_supplier: "fournisseur", src_certificate: "certificat", src_lab: "rapport de laboratoire", src_calculation: "calcul",
  src_merchant: "commerçant", src_open_food_facts: "Open Food Facts", src_staff: "notre équipe",
  checked_on: "vérifié le {date}", credit_off: "Certaines informations et photos viennent d'Open Food Facts (openfoodfacts.org), sous licences ODbL et CC BY-SA.",
  search_results: "Résultats pour « {q} »", search_none: "Nous n'avons pas encore « {q} ». Nous avons noté votre recherche.", search_short: "Tapez au moins deux lettres.",
  search_found: "{n} trouvé(s)", try_whatsapp: "Demandez-nous sur WhatsApp",
  not_found: "Page introuvable", not_found_text: "Cette page n'existe pas, ou l'article n'est pas disponible maintenant.", back_home: "Retour à l'accueil",
  unavailable: "Temporairement indisponible", unavailable_text: "Nous n'avons pas pu charger cette page. Réessayez dans un instant.",
  offline: "Vous êtes hors ligne", offline_text: "Cette page n'est pas enregistrée sur votre téléphone. Les pages déjà ouvertes fonctionnent. Commander demande une connexion.",
  privacy: "Confidentialité", terms: "Conditions", language: "Langue",
  placeholder_legal: "Ce texte est en cours de rédaction avec notre avocat et sera publié ici avant l'ouverture du site aux commandes.",
  footer_note: "Les prix sont en dollars américains. Prix et stock sont revérifiés à la commande.",
};
export const DICTS: Record<Lang, Dict> = { en, ar, fr };

export type Key = keyof typeof en;
/** A string in the page language, with {name} placeholders filled. A missing key is a bug the test names; the key itself is shown. */
export function t(l: Lang, key: Key, vars: Record<string, string | number> = {}): string {
  const s = DICTS[l][key] ?? DICTS.en[key] ?? String(key);
  return s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
}
export const unitLabel = (l: Lang, unit: string | null | undefined): string => {
  const u = (unit ?? "").toLowerCase();
  if (!u || u === "each") return "";
  const names: Record<string, Record<Lang, string>> = {
    kg: { en: "kg", ar: "كغ", fr: "kg" }, g: { en: "g", ar: "غ", fr: "g" }, l: { en: "litre", ar: "ليتر", fr: "litre" },
    pack: { en: "pack", ar: "علبة", fr: "paquet" }, bundle: { en: "bundle", ar: "ربطة", fr: "lot" }, bottle: { en: "bottle", ar: "زجاجة", fr: "bouteille" },
    dozen: { en: "dozen", ar: "دزينة", fr: "douzaine" }, carton: { en: "carton", ar: "كرتونة", fr: "carton" },
  };
  return names[u]?.[l] ?? u;
};
