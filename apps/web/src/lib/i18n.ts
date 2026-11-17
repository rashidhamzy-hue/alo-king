// One set of templates, three languages (docs/WEBSITE.md "Shape"): Arabic (right to left) and English from day one, French strings
// in the same file. The language follows the visitor's choice, kept in the `lang` cookie; with no choice it follows the browser's
// Accept-Language, and with neither it is Arabic. Names come from the database in Arabic and English; French shows the English name.
import { joinAr, joinEn, joinFr } from "./join-words";


import { W2 } from "./i18n-web2";

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
  items: "{n} items", in_stock: "In stock", out_of_stock: "Out of stock", coming_soon: "Coming soon", no_price: "Price not set yet", size_label: "Size", price: "Price", brand: "Brand", size_unit: "Sold by",
  no_picture: "No picture yet", credit_pictures: "Some pictures are from Open Food Facts contributors (CC BY-SA 3.0): openfoodfacts.org.",
  facts_title: "Food facts", facts_intro: "Shown only after our team checked them, with where each comes from. Where it says \"not confirmed yet\" we have not confirmed it: do not assume it is safe or free of anything. If you have an allergy, tell us on WhatsApp before you order.",
  allergens: "Allergens", diets: "Diet", ingredients: "Ingredients", nutrition: "Nutrition", storage: "Storage", origin: "Country of origin",
  contains: "Contains", may_contain: "May contain", free_of: "Free of", yes: "Yes", no: "No",
  not_verified: "Not confirmed yet", not_verified_list: "Not confirmed yet: {list}", nothing_verified: "Nothing is confirmed yet for this item.", not_confirmed_yet: "Not confirmed yet",
  status_certified: "certified", status_declared: "declared", status_calculated: "calculated",
  src_label: "from the pack", src_supplier: "declared by the supplier", src_certificate: "from the certificate", src_lab: "from a lab report", src_calculation: "calculated by us",
  src_merchant: "declared by the vendor", src_open_food_facts: "from Open Food Facts", src_staff: "checked by our team",
  src_label_photo: "from the pack", src_barcode_lookup: "from the barcode record", src_brand_site: "from the brand's own page", src_retailer_page: "from a retailer's page",
  src_supplier_sheet: "declared by the supplier", src_vendor: "declared by the vendor", src_menu: "declared by the vendor", src_rules: "set by our rules",
  src_model: "checked by our team", src_person: "checked by our team", src_research_file: "from our product research",
  details_title: "Product details", details_intro: "Shown only after our team confirmed them, with where each comes from. Where it says \"not confirmed yet\" we have not confirmed it.",
  barcode: "Barcode", claims_title: "Printed on the pack", per_amount: "Per {amount}", certificate: "Certificate", valid_until: "valid until {date}",
  checked_on: "checked {date}", credit_off: "Some information and pictures here come from Open Food Facts (openfoodfacts.org), under the ODbL and CC BY-SA licences.",
  search_results: "Results for \"{q}\"", search_none: "We do not have \"{q}\" yet. We have noted that you looked for it.", search_short: "Type at least two letters.",
  search_found: "{n} found", try_whatsapp: "Ask us on WhatsApp",
  not_found: "Page not found", not_found_text: "This page does not exist, or the item is not available now.", back_home: "Back to the home page",
  unavailable: "Temporarily unavailable", unavailable_text: "We could not load this page. Please try again in a moment.",
  offline: "You are offline", offline_text: "This page is not saved on your phone. Pages you opened before still work. Ordering needs a connection.",
  privacy: "Privacy", terms: "Terms", language: "Language",
  placeholder_legal: "This text is being prepared with our lawyer and will be published here before the site opens for orders.",
  hero_title: "Groceries to your door in the Chouf", hero_text: "Order on WhatsApp by text or voice note, or shop here. Pay cash when it arrives.",
  shop_here: "Shop here", wa_greeting: "Hello, I would like to order", order_item_whatsapp: "Order this item on WhatsApp",
  check_title: "Do we deliver to you?", check_label: "Your village", check_choose: "Choose your village", check_go: "Check",
  check_yes: "We deliver to {village}.", check_fee: "Delivery {fee}", check_time: "About {n} minutes", check_other: "Not on the list? Ask us on WhatsApp.",
  trust_cash: "Cash on delivery", trust_cash_text: "In dollars, or in pounds at the day's rate.",
  trust_rider: "The rider keeps the whole delivery fee", trust_rider_text: "The delivery fee and any tip go in full to the person who brings your order.",
  trust_hours: "Opening hours", trust_person: "A person on WhatsApp", trust_person_text: "When you need help, someone from our team answers.",
  filter_brand: "Brand", filter_unit: "Sold by", filter_stock: "In stock only", filter_all: "All", filter_show: "Show", filter_clear: "Clear filters",
  sort: "Sort", sort_default: "As arranged", sort_price_asc: "Price, low to high", sort_price_desc: "Price, high to low",
  items_of: "{n} of {total} items", filter_none: "Nothing matches these filters.", unit_each: "each", live_hint: "Results appear as you type.",
  gallery: "Component gallery",
  footer_note: "Prices are in US dollars. Price and stock are checked again when you order.",
  // LV1: the Chouf food places listed before they sign (docs/DECISIONS.md, "Listings before they sign, 17 November 2026"). No price, rating, menu, hours or photo.
  food: "Food places", food_title: "Food places in the Chouf", food_tile_note: "Not on Alo King yet",
  food_intro: "Places near you that are not on Alo King yet. You can't order from them here. Tell us which ones you want. Owners can claim a page or have it removed.",
  food_not_yet: "Not on Alo King yet. You can't order from here yet.",
  food_places: "Places: {n}", food_none: "No places match this.", food_km: "{km} km from our hub", food_village_none: "Village not listed",
  food_kind: "Kind", food_village: "Village", food_sort_distance: "Distance from our hub", food_sort_name: "Name",
  food_next: "Next", food_prev: "Previous", food_page: "Page {n} of {total}", food_map: "Open in Google Maps",
  food_want: "I want to order from here", food_asked: "Thanks. We've noted that you want to order from {name}. Nothing else is needed from you.",
  food_claim: "Is this your place? Claim it", food_claim_note: "This opens WhatsApp with a message to us already typed. Send it and we will get in touch.",
  food_remove: "Remove this listing", food_remove_title: "Remove this listing", food_remove_intro: "This hides the page for {name} right away. Our team is told and will look at it.",
  food_who: "Who are you?", food_who_choose: "Choose", food_who_owner: "The owner", food_who_manager: "A manager", food_who_staff: "Staff", food_who_other: "Someone else",
  food_who_error: "Choose who you are.", food_reason: "Why? (optional)", food_reason_hint: "Please don't include private details such as numbers or addresses.",
  food_remove_go: "Hide this page", food_cancel: "Cancel", food_removed: "Done. The page is hidden and our team has been told.",
  food_remove_queued: "We have your request. Our team will look at it.",
  kind_restaurant: "Restaurant", kind_cafe: "Café", kind_bakery: "Bakery", kind_sweets: "Sweets", kind_catering: "Catering", kind_butcher: "Butcher",
  ...joinEn,
};
const ar: Dict = {
  site: "ألو كينغ", tagline: "توصيل البقالة في الشوف.",
  search: "بحث", search_placeholder: "ابحث عن منتج", search_label: "ابحث في الكتالوج",
  categories: "الأقسام", home: "الرئيسية", skip: "انتقل إلى المحتوى",
  open_now: "مفتوح الآن", closed_now: "مغلق الآن. يمكنك التصفح.", hours: "ساعات العمل", delivery_to: "نوصّل إلى",
  fee: "التوصيل", about_min: "حوالي {n} دقيقة", villages_none: "ستظهر منطقة التوصيل هنا قريبًا.",
  order_whatsapp: "اطلب عبر واتساب", ask_whatsapp: "اسألنا عن هذا المنتج عبر واتساب",
  items: "{n} منتج", in_stock: "متوفر", out_of_stock: "غير متوفر", coming_soon: "قريباً", no_price: "لم يُحدَّد السعر بعد", size_label: "الحجم", price: "السعر", brand: "الماركة", size_unit: "يُباع بـ",
  no_picture: "لا توجد صورة بعد", credit_pictures: "بعض الصور من مساهمي Open Food Facts (CC BY-SA 3.0): openfoodfacts.org.",
  facts_title: "معلومات غذائية", facts_intro: "لا تظهر إلا بعد أن يتحقق فريقنا منها، مع مصدر كل معلومة. عندما تقرأ «لم يتم التأكيد بعد» فهذا يعني أننا لم نؤكد المعلومة: لا تفترض أن المنتج آمن أو خالٍ من أي مكوّن. إذا عندك حساسية، أخبرنا عبر واتساب قبل أن تطلب.",
  allergens: "مسببات الحساسية", diets: "النظام الغذائي", ingredients: "المكوّنات", nutrition: "القيم الغذائية", storage: "طريقة الحفظ", origin: "بلد المنشأ",
  contains: "يحتوي على", may_contain: "قد يحتوي على", free_of: "خالٍ من", yes: "نعم", no: "لا",
  not_verified: "لم يتم التأكيد بعد", not_verified_list: "لم يتم التأكيد بعد: {list}", nothing_verified: "لم يتم تأكيد أي معلومة لهذا المنتج بعد.", not_confirmed_yet: "لم يتم التأكيد بعد",
  status_certified: "موثّق بشهادة", status_declared: "مُصرَّح به", status_calculated: "محسوب",
  src_label: "من العبوة", src_supplier: "مُصرَّح به من المورّد", src_certificate: "من الشهادة", src_lab: "من تقرير مخبري", src_calculation: "محسوب لدينا",
  src_merchant: "مُصرَّح به من البائع", src_open_food_facts: "من Open Food Facts", src_staff: "تم التحقق منه من فريقنا",
  src_label_photo: "من العبوة", src_barcode_lookup: "من سجل الباركود", src_brand_site: "من صفحة الماركة نفسها", src_retailer_page: "من صفحة متجر",
  src_supplier_sheet: "مُصرَّح به من المورّد", src_vendor: "مُصرَّح به من البائع", src_menu: "مُصرَّح به من البائع", src_rules: "حسب قواعدنا",
  src_model: "تم التحقق منه من فريقنا", src_person: "تم التحقق منه من فريقنا", src_research_file: "من بحثنا عن المنتج",
  details_title: "تفاصيل المنتج", details_intro: "لا تظهر إلا بعد أن يؤكدها فريقنا، مع مصدر كل معلومة. عندما تقرأ «لم يتم التأكيد بعد» فهذا يعني أننا لم نؤكد المعلومة.",
  barcode: "الباركود", claims_title: "مكتوب على العبوة", per_amount: "لكل {amount}", certificate: "شهادة", valid_until: "صالحة حتى {date}",
  checked_on: "تم التحقق {date}", credit_off: "بعض المعلومات والصور هنا من Open Food Facts (openfoodfacts.org) بموجب رخصتي ODbL وCC BY-SA.",
  search_results: "نتائج «{q}»", search_none: "ما عندنا «{q}» بعد. سجّلنا أنك سألت عنه.", search_short: "اكتب حرفين على الأقل.",
  search_found: "وُجد {n}", try_whatsapp: "اسألنا عبر واتساب",
  not_found: "الصفحة غير موجودة", not_found_text: "هذه الصفحة غير موجودة، أو أن المنتج غير متوفر الآن.", back_home: "العودة إلى الرئيسية",
  unavailable: "غير متاح مؤقتًا", unavailable_text: "تعذّر تحميل هذه الصفحة. حاول مرة أخرى بعد قليل.",
  offline: "لا يوجد اتصال", offline_text: "هذه الصفحة غير محفوظة على هاتفك. الصفحات التي فتحتها سابقًا تعمل. الطلب يحتاج إلى اتصال.",
  privacy: "الخصوصية", terms: "الشروط", language: "اللغة",
  placeholder_legal: "يجري إعداد هذا النص مع محامينا وسيُنشر هنا قبل فتح الموقع للطلبات.",
  hero_title: "البقالة إلى باب بيتك في الشوف", hero_text: "اطلب عبر واتساب برسالة مكتوبة أو صوتية، أو تسوّق هنا. الدفع نقدًا عند الاستلام.",
  shop_here: "تسوّق هنا", wa_greeting: "مرحبا، بدي اطلب", order_item_whatsapp: "اطلب هذا المنتج عبر واتساب",
  check_title: "هل نوصّل إليك؟", check_label: "قريتك", check_choose: "اختر قريتك", check_go: "تحقّق",
  check_yes: "نوصّل إلى {village}.", check_fee: "التوصيل {fee}", check_time: "حوالي {n} دقيقة", check_other: "قريتك غير موجودة في القائمة؟ اسألنا عبر واتساب.",
  trust_cash: "الدفع نقدًا عند الاستلام", trust_cash_text: "بالدولار، أو بالليرة بسعر اليوم.",
  trust_rider: "رسم التوصيل كله للسائق", trust_rider_text: "رسم التوصيل وأي إكرامية يذهبان كاملين إلى من يوصل طلبك.",
  trust_hours: "ساعات العمل", trust_person: "شخص يجيبك على واتساب", trust_person_text: "عندما تحتاج إلى مساعدة، يجيبك أحد أفراد فريقنا.",
  filter_brand: "الماركة", filter_unit: "يُباع بـ", filter_stock: "المتوفر فقط", filter_all: "الكل", filter_show: "اعرض", filter_clear: "إزالة التصفية",
  sort: "الترتيب", sort_default: "ترتيب القسم", sort_price_asc: "السعر: من الأقل إلى الأعلى", sort_price_desc: "السعر: من الأعلى إلى الأقل",
  items_of: "{n} من {total} منتج", filter_none: "لا شيء يطابق هذه التصفية.", unit_each: "بالقطعة", live_hint: "تظهر النتائج أثناء الكتابة.",
  gallery: "معرض المكوّنات",
  footer_note: "الأسعار بالدولار الأميركي. يُعاد التحقق من السعر والتوفر عند الطلب.",
  food: "أماكن الطعام", food_title: "أماكن الطعام في الشوف", food_tile_note: "ليس على ألو كينغ بعد",
  food_intro: "أماكن قريبة منك ليست على ألو كينغ بعد. لا يمكنك الطلب منها من هنا. أخبرنا أيّها تريد. ويستطيع أصحاب الأماكن المطالبة بصفحتهم أو إزالتها.",
  food_not_yet: "ليس على ألو كينغ بعد. لا يمكنك الطلب من هنا بعد.",
  food_places: "عدد الأماكن: {n}", food_none: "لا توجد أماكن تطابق هذا.", food_km: "{km} كم من مستودعنا", food_village_none: "القرية غير مذكورة",
  food_kind: "النوع", food_village: "القرية", food_sort_distance: "المسافة من مستودعنا", food_sort_name: "الاسم",
  food_next: "التالي", food_prev: "السابق", food_page: "الصفحة {n} من {total}", food_map: "افتح في خرائط Google",
  food_want: "أريد الطلب من هنا", food_asked: "شكرًا. سجّلنا أنك تريد الطلب من {name}. لا يلزمك أي شيء آخر.",
  food_claim: "هل هذا مكانك؟ اطلب إدارته", food_claim_note: "يفتح هذا واتساب مع رسالة إلينا مكتوبة مسبقًا. أرسلها وسنتواصل معك.",
  food_remove: "إزالة هذه الصفحة", food_remove_title: "إزالة هذه الصفحة", food_remove_intro: "هذا يُخفي صفحة {name} فورًا. يُبلَّغ فريقنا وسينظر في الأمر.",
  food_who: "من أنت؟", food_who_choose: "اختر", food_who_owner: "صاحب المكان", food_who_manager: "مدير", food_who_staff: "موظف", food_who_other: "شخص آخر",
  food_who_error: "اختر من أنت.", food_reason: "لماذا؟ (اختياري)", food_reason_hint: "من فضلك لا تكتب تفاصيل خاصة مثل الأرقام أو العناوين.",
  food_remove_go: "أخفِ هذه الصفحة", food_cancel: "إلغاء", food_removed: "تم. الصفحة مخفية وقد أُبلغ فريقنا.",
  food_remove_queued: "وصلنا طلبك. سينظر فريقنا فيه.",
  kind_restaurant: "مطعم", kind_cafe: "مقهى", kind_bakery: "مخبز", kind_sweets: "حلويات", kind_catering: "تموين وضيافة", kind_butcher: "ملحمة",
  ...joinAr,
};
const fr: Dict = {
  site: "Alo King", tagline: "Courses livrées dans le Chouf.",
  search: "Rechercher", search_placeholder: "Rechercher un produit", search_label: "Rechercher dans le catalogue",
  categories: "Catégories", home: "Accueil", skip: "Aller au contenu",
  open_now: "Ouvert maintenant", closed_now: "Fermé pour le moment. Vous pouvez parcourir.", hours: "Horaires", delivery_to: "Nous livrons à",
  fee: "livraison", about_min: "environ {n} min", villages_none: "La zone de livraison sera bientôt indiquée ici.",
  order_whatsapp: "Commander sur WhatsApp", ask_whatsapp: "Poser une question sur WhatsApp à propos de cet article",
  items: "{n} articles", in_stock: "En stock", out_of_stock: "Épuisé", coming_soon: "Bientôt disponible", no_price: "Prix pas encore fixé", size_label: "Taille", price: "Prix", brand: "Marque", size_unit: "Vendu par",
  no_picture: "Pas encore de photo", credit_pictures: "Certaines photos viennent des contributeurs d'Open Food Facts (CC BY-SA 3.0) : openfoodfacts.org.",
  facts_title: "Informations alimentaires", facts_intro: "Affichées seulement après vérification par notre équipe, avec l'origine de chaque information. Quand on lit « pas encore confirmé », nous ne l'avons pas confirmé : ne supposez pas que le produit est sûr ou exempt de quoi que ce soit. En cas d'allergie, dites-le-nous sur WhatsApp avant de commander.",
  allergens: "Allergènes", diets: "Régime", ingredients: "Ingrédients", nutrition: "Valeurs nutritionnelles", storage: "Conservation", origin: "Pays d'origine",
  contains: "Contient", may_contain: "Peut contenir", free_of: "Sans", yes: "Oui", no: "Non",
  not_verified: "Pas encore confirmé", not_verified_list: "Pas encore confirmé : {list}", nothing_verified: "Rien n'est encore confirmé pour cet article.", not_confirmed_yet: "Pas encore confirmé",
  status_certified: "certifié", status_declared: "déclaré", status_calculated: "calculé",
  src_label: "d'après l'emballage", src_supplier: "déclaré par le fournisseur", src_certificate: "d'après le certificat", src_lab: "d'après un rapport de laboratoire", src_calculation: "calculé par nous",
  src_merchant: "déclaré par le vendeur", src_open_food_facts: "d'après Open Food Facts", src_staff: "vérifié par notre équipe",
  src_label_photo: "d'après l'emballage", src_barcode_lookup: "d'après la fiche du code-barres", src_brand_site: "d'après la page de la marque", src_retailer_page: "d'après la page d'un détaillant",
  src_supplier_sheet: "déclaré par le fournisseur", src_vendor: "déclaré par le vendeur", src_menu: "déclaré par le vendeur", src_rules: "selon nos règles",
  src_model: "vérifié par notre équipe", src_person: "vérifié par notre équipe", src_research_file: "d'après notre recherche produit",
  details_title: "Détails du produit", details_intro: "Affichés seulement après confirmation par notre équipe, avec l'origine de chaque information. Quand on lit « pas encore confirmé », nous ne l'avons pas confirmé.",
  barcode: "Code-barres", claims_title: "Indiqué sur l'emballage", per_amount: "Pour {amount}", certificate: "Certificat", valid_until: "valable jusqu'au {date}",
  checked_on: "vérifié le {date}", credit_off: "Certaines informations et photos viennent d'Open Food Facts (openfoodfacts.org), sous licences ODbL et CC BY-SA.",
  search_results: "Résultats pour « {q} »", search_none: "Nous n'avons pas encore « {q} ». Nous avons noté votre recherche.", search_short: "Tapez au moins deux lettres.",
  search_found: "{n} trouvé(s)", try_whatsapp: "Demandez-nous sur WhatsApp",
  not_found: "Page introuvable", not_found_text: "Cette page n'existe pas, ou l'article n'est pas disponible maintenant.", back_home: "Retour à l'accueil",
  unavailable: "Temporairement indisponible", unavailable_text: "Nous n'avons pas pu charger cette page. Réessayez dans un instant.",
  offline: "Vous êtes hors ligne", offline_text: "Cette page n'est pas enregistrée sur votre téléphone. Les pages déjà ouvertes fonctionnent. Commander demande une connexion.",
  privacy: "Confidentialité", terms: "Conditions", language: "Langue",
  placeholder_legal: "Ce texte est en cours de rédaction avec notre avocat et sera publié ici avant l'ouverture du site aux commandes.",
  hero_title: "Vos courses à votre porte dans le Chouf", hero_text: "Commandez sur WhatsApp par message ou note vocale, ou achetez ici. Paiement en espèces à la livraison.",
  shop_here: "Acheter ici", wa_greeting: "Bonjour, je voudrais commander", order_item_whatsapp: "Commander cet article sur WhatsApp",
  check_title: "Livrons-nous chez vous ?", check_label: "Votre village", check_choose: "Choisissez votre village", check_go: "Vérifier",
  check_yes: "Nous livrons à {village}.", check_fee: "Livraison {fee}", check_time: "Environ {n} minutes", check_other: "Pas dans la liste ? Demandez-nous sur WhatsApp.",
  trust_cash: "Paiement à la livraison", trust_cash_text: "En dollars, ou en livres au taux du jour.",
  trust_rider: "Le livreur garde tous les frais de livraison", trust_rider_text: "Les frais de livraison et le pourboire reviennent en entier à la personne qui vous livre.",
  trust_hours: "Horaires", trust_person: "Une personne sur WhatsApp", trust_person_text: "Si vous avez besoin d'aide, quelqu'un de notre équipe vous répond.",
  filter_brand: "Marque", filter_unit: "Vendu par", filter_stock: "En stock seulement", filter_all: "Tous", filter_show: "Afficher", filter_clear: "Retirer les filtres",
  sort: "Trier", sort_default: "Ordre du rayon", sort_price_asc: "Prix croissant", sort_price_desc: "Prix décroissant",
  items_of: "{n} sur {total} articles", filter_none: "Rien ne correspond à ces filtres.", unit_each: "à l'unité", live_hint: "Les résultats s'affichent pendant la saisie.",
  gallery: "Galerie des composants",
  footer_note: "Les prix sont en dollars américains. Prix et stock sont revérifiés à la commande.",
  food: "Lieux pour manger", food_title: "Lieux pour manger dans le Chouf", food_tile_note: "Pas encore sur Alo King",
  food_intro: "Des lieux près de chez vous qui ne sont pas encore sur Alo King. Vous ne pouvez pas y commander d'ici. Dites-nous lesquels vous voulez. Les propriétaires peuvent revendiquer leur page ou la faire retirer.",
  food_not_yet: "Pas encore sur Alo King. Vous ne pouvez pas encore commander ici.",
  food_places: "Lieux : {n}", food_none: "Aucun lieu ne correspond.", food_km: "{km} km de notre centre", food_village_none: "Village non indiqué",
  food_kind: "Type", food_village: "Village", food_sort_distance: "Distance de notre centre", food_sort_name: "Nom",
  food_next: "Suivant", food_prev: "Précédent", food_page: "Page {n} sur {total}", food_map: "Ouvrir dans Google Maps",
  food_want: "Je veux commander ici", food_asked: "Merci. Nous avons noté que vous voulez commander chez {name}. Rien d'autre n'est nécessaire de votre part.",
  food_claim: "C'est votre établissement ? Revendiquez-le", food_claim_note: "Cela ouvre WhatsApp avec un message pour nous déjà écrit. Envoyez-le et nous vous contacterons.",
  food_remove: "Retirer cette page", food_remove_title: "Retirer cette page", food_remove_intro: "Cela masque tout de suite la page de {name}. Notre équipe est prévenue et l'examinera.",
  food_who: "Qui êtes-vous ?", food_who_choose: "Choisir", food_who_owner: "Le propriétaire", food_who_manager: "Un gérant", food_who_staff: "Un employé", food_who_other: "Quelqu'un d'autre",
  food_who_error: "Choisissez qui vous êtes.", food_reason: "Pourquoi ? (facultatif)", food_reason_hint: "N'indiquez pas de détails privés, comme des numéros ou des adresses.",
  food_remove_go: "Masquer cette page", food_cancel: "Annuler", food_removed: "C'est fait. La page est masquée et notre équipe est prévenue.",
  food_remove_queued: "Nous avons votre demande. Notre équipe va l'examiner.",
  kind_restaurant: "Restaurant", kind_cafe: "Café", kind_bakery: "Boulangerie", kind_sweets: "Pâtisserie", kind_catering: "Traiteur", kind_butcher: "Boucherie",
  ...joinFr,
};
export const DICTS: Record<Lang, Dict> = { en: { ...en, ...W2.en }, ar: { ...ar, ...W2.ar }, fr: { ...fr, ...W2.fr } };

/** A word's key: any key of the English dictionary (WEB2's `w2_` keys included). A missing key is a bug the test names. */
export type Key = string;
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

/** The chat link with a greeting already typed (a wa.me address takes ?text=). A link that already carries a query is left as it is. */
export const withGreeting = (link: string | null | undefined, l: Lang): string | null =>
  !link ? null : link.includes("?") ? link : `${link}?text=${encodeURIComponent(t(l, "wa_greeting"))}`;
/** The chat's address without its query: the door to the chat from any page. */
export const chatBase = (link: string | null | undefined): string | null => (link ? link.replace(/\?.*$/, "") || null : null);
