// WhatsApp messages to customers (DECISIONS §13, §27.3, §27.6, §27.9, §29.3, §30.2.3, §30.3.6).
// Pure builders in Arabic, English, French and Arabizi: they take server data (tool results, the order
// summary, outbox payloads) and return Cloud API payloads. Every amount shown comes from that data; nothing
// here computes a price. Every interactive builder is checked in meta-limits.test.ts. Button ids are opaque
// action + record id; the server re-checks everything a tap claims.

export type CLang = "ar" | "en" | "fr" | "arabizi";
export const LANGS: CLang[] = ["ar", "en", "fr", "arabizi"];
export const asLang = (s: unknown): CLang =>
  s === "en" || s === "fr" || s === "arabizi" ? s : "ar";

const env = (to: string) => ({
  messaging_product: "whatsapp",
  recipient_type: "individual",
  to: to.replace(/^\+/, ""),
});
export const text = (to: string, body: string) => ({
  ...env(to),
  type: "text",
  text: { body: body.slice(0, 4096), preview_url: false },
});
export const buttons = (to: string, body: string, bs: [string, string][], footer?: string) => ({
  ...env(to),
  type: "interactive",
  interactive: {
    type: "button",
    body: { text: body },
    ...(footer ? { footer: { text: footer } } : {}),
    action: { buttons: bs.map(([id, title]) => ({ type: "reply", reply: { id, title } })) },
  },
});
export type Row = { id: string; title: string; description?: string };
export const list = (
  to: string,
  body: string,
  button: string,
  sections: { title?: string; rows: Row[] }[],
  footer?: string,
) => ({
  ...env(to),
  type: "interactive",
  interactive: {
    type: "list",
    body: { text: body },
    ...(footer ? { footer: { text: footer } } : {}),
    action: {
      button,
      sections: sections.map((s) => ({ ...(s.title ? { title: s.title } : {}), rows: s.rows })),
    },
  },
});
export const ctaUrl = (to: string, body: string, label: string, url: string) => ({
  ...env(to),
  type: "interactive",
  interactive: {
    type: "cta_url",
    body: { text: body },
    action: { name: "cta_url", parameters: { display_text: label, url } },
  },
});
/** Meta's native location request: one tap shares a pin (§16 "pin first"). */
export const locationRequest = (to: string, body: string) => ({
  ...env(to),
  type: "interactive",
  interactive: {
    type: "location_request_message",
    body: { text: body },
    action: { name: "send_location" },
  },
});

const n2 = (v: unknown) => Number(v ?? 0);
export const usd = (v: unknown) => `$${n2(v).toFixed(2)}`;
export const lbp = (v: unknown) => Math.round(n2(v)).toLocaleString("en-US");

/** wa.me link to a person's chat, optionally pre-filled. Only for numbers the server supplied. */
export const waMe = (phone: string, msg?: string) =>
  `https://wa.me/${phone.replace(/^\+/, "")}${msg ? `?text=${encodeURIComponent(msg)}` : ""}`;

// ---- Strings ------------------------------------------------------------------------------------------
type S = Record<string, string>;
export const T: Record<CLang, S> = {
  ar: {
    rate: "سعر الصرف",
    locked: "مثبّت عالطلب",
    today: "سعر اليوم، بيتثبّت عالطلب",
    cash: "كاش عالتسليم",
    accepted: "✅ {vendor} قبل طلبك #{code}. بيوصل خلال {eta} دقيقة تقريباً.",
    pickupAccepted: "✅ {vendor} قبل طلبك #{code}. بيكون جاهز خلال {eta} دقيقة تقريباً.",
    code: "🔐 رمز التسليم: {dcode} — عطيه للسايق بس يوصل.",
    codePickup: "🔐 رمز الاستلام: {dcode} — عطيه للمحل بس تستلم.",
    rejected: "😔 {vendor} ما فيه ياخد طلبك #{code} هلق ({reason}). بدك لاقيلك محل تاني؟",
    findOther: "🔎 محل تاني",
    cancelled: "❌ انلغى طلبك #{code} ({reason}). ما في شي مدفوع. بدك نجرّب محل تاني؟",
    onTheWay: "🛵 طلبك #{code} عالطريق! بيوصل خلال {eta} دقيقة تقريباً.",
    onTheWayLive:
      "🛵 طلبك #{code} عالطريق! بيوصل خلال {eta} دقيقة تقريباً. السايق ممكن يشاركك موقعه المباشر عالواتساب.",
    driverChat: "💬 السايق",
    nearDrop: "📍 طلبك عبعد ٣ دقايق تقريباً.",
    nearDropLive: "📍 طلبك عبعد ٣ دقايق تقريباً. إذا العنوان صعب، شارك موقعك المباشر مع السايق.",
    shareLive: "📍 موقعي للسايق",
    liveGreeting: "مرحبا، هيدا موقعي لطلب Alo King",
    arrivedWait: "🚪 السايق وصل لعندك. إذا ما لاقاك، شاركو موقعك المباشر أو احكيه.",
    readyPickup: "🛍️ طلبك #{code} جاهز تستلمو من {vendor}.",
    delivered: "🎉 وصل طلبك #{code}؟",
    received: "✅ وصل",
    problem: "⚠️ في مشكلة",
    weight: "⚖️ الوزن النهائي لطلبك #{code}: {total} (التقدير كان {est}). موافق؟",
    weightYes: "✅ موافق",
    subOffer:
      "↔️ طلبك #{code}: «{from}» مش متوفر. المحل بيقترح «{to}» ({diff}). المجموع الجديد: {money}. موافق؟",
    subYes: "✅ موافق عالبديل",
    subNo: "❌ بلا بديل",
    weightNo: "❌ إلغاء",
    cancelRefused: "المحل ما قبل إلغاء الطلب #{code} لأنو صار عم يتحضّر. الطلب كمّل.",
    rating: "شو رأيك بطلبك من {vendor}؟",
    rateButton: "قيّم",
    food: "الأكل",
    delivery: "التوصيل",
    good: "👍 منيح",
    bad: "👎 مش منيح",
    reminder: "🧺 سلّتك من {vendor} ناطرتك ({total}). بدك تكمّل؟",
    continue: "✅ كمّل الطلب",
    clear: "🗑️ فضّي السلّة",
    thanksRating: "🙏 شكراً على تقييمك!",
    reason_busy: "مشغول",
    reason_item_unavailable: "صنف مش متوفر",
    reason_closed: "مسكّر",
    reason_area_unavailable: "ما بيوصل لمنطقتك",
    reason_menu_or_price_issue: "مشكلة بالمنيو",
    reason_other: "سبب تاني",
    reason_merchant_unreachable: "المحل ما ردّ",
    reason_merchant_paused: "المحل وقّف الطلبات",
    reason_operator: "من فريق Alo King",
    reason_weight_declined: "رفضت الوزن",
    reason_no_delivery: "ما في توصيل",
    reason_payment_timeout: "الدفع ما تمّ",
    reason_customer_request_accepted: "حسب طلبك",
  },
  en: {
    rate: "rate",
    locked: "locked at order",
    today: "today's rate, locked when you order",
    cash: "Cash on delivery",
    accepted: "✅ {vendor} accepted your order #{code}. Arriving in about {eta} min.",
    pickupAccepted: "✅ {vendor} accepted your order #{code}. Ready in about {eta} min.",
    code: "🔐 Delivery code: {dcode}. Give it to the driver at the door.",
    codePickup: "🔐 Pickup code: {dcode}. Give it to the shop when you collect.",
    rejected:
      "😔 {vendor} can't take order #{code} right now ({reason}). Shall I find another place?",
    findOther: "🔎 Another place",
    cancelled:
      "❌ Order #{code} was cancelled ({reason}). Nothing was charged. Want to try another place?",
    onTheWay: "🛵 Order #{code} is on the way! About {eta} min.",
    onTheWayLive:
      "🛵 Order #{code} is on the way! About {eta} min. Your driver may share their live location with you on WhatsApp.",
    driverChat: "💬 Driver",
    nearDrop: "📍 Your order is about 3 minutes away.",
    nearDropLive:
      "📍 Your order is about 3 minutes away. If the address is hard to find, share your live location with the driver.",
    shareLive: "📍 Live location",
    liveGreeting: "Hi, here is my location for the Alo King order",
    arrivedWait:
      "🚪 Your driver is at your address. If they can't find you, share your live location or message them.",
    readyPickup: "🛍️ Order #{code} is ready for pickup at {vendor}.",
    delivered: "🎉 Did order #{code} arrive?",
    received: "✅ Received",
    problem: "⚠️ Problem",
    weight: "⚖️ Final weight for order #{code}: {total} (estimate was {est}). OK?",
    weightYes: "✅ OK",
    subOffer:
      '↔️ Order #{code}: "{from}" isn\'t available. The shop suggests "{to}" ({diff}). New total: {money}. OK?',
    subYes: "✅ Take substitute",
    subNo: "❌ No substitute",
    weightNo: "❌ Cancel",
    cancelRefused:
      "The shop couldn't cancel order #{code}: it's already being prepared. Your order continues.",
    rating: "How was your order from {vendor}?",
    rateButton: "Rate",
    food: "Food",
    delivery: "Delivery",
    good: "👍 Good",
    bad: "👎 Not good",
    reminder: "🧺 Your basket from {vendor} is waiting ({total}). Continue?",
    continue: "✅ Continue",
    clear: "🗑️ Empty basket",
    thanksRating: "🙏 Thanks for rating!",
    reason_busy: "busy",
    reason_item_unavailable: "an item is unavailable",
    reason_closed: "closed",
    reason_area_unavailable: "doesn't deliver to your area",
    reason_menu_or_price_issue: "menu issue",
    reason_other: "other reason",
    reason_merchant_unreachable: "the shop didn't answer",
    reason_merchant_paused: "the shop paused orders",
    reason_operator: "by the Alo King team",
    reason_weight_declined: "you declined the weight",
    reason_no_delivery: "no delivery",
    reason_payment_timeout: "payment not completed",
    reason_customer_request_accepted: "as you asked",
  },
  fr: {
    rate: "taux",
    locked: "fixé à la commande",
    today: "taux du jour, fixé à la commande",
    cash: "Paiement à la livraison",
    accepted: "✅ {vendor} a accepté votre commande #{code}. Livraison dans {eta} min environ.",
    pickupAccepted: "✅ {vendor} a accepté votre commande #{code}. Prête dans {eta} min environ.",
    code: "🔐 Code de livraison : {dcode}. Donnez-le au livreur.",
    codePickup: "🔐 Code de retrait : {dcode}. Donnez-le au magasin.",
    rejected:
      "😔 {vendor} ne peut pas prendre la commande #{code} ({reason}). Je cherche un autre endroit ?",
    findOther: "🔎 Autre endroit",
    cancelled:
      "❌ La commande #{code} est annulée ({reason}). Rien n'a été payé. Essayer un autre endroit ?",
    onTheWay: "🛵 La commande #{code} est en route ! Environ {eta} min.",
    onTheWayLive:
      "🛵 La commande #{code} est en route ! Environ {eta} min. Le livreur peut partager sa position en direct sur WhatsApp.",
    driverChat: "💬 Livreur",
    nearDrop: "📍 Votre commande arrive dans 3 minutes environ.",
    nearDropLive:
      "📍 Votre commande arrive dans 3 minutes environ. Si l'adresse est difficile, partagez votre position en direct avec le livreur.",
    shareLive: "📍 Ma position",
    liveGreeting: "Bonjour, voici ma position pour la commande Alo King",
    arrivedWait:
      "🚪 Le livreur est à votre adresse. S'il ne vous trouve pas, partagez votre position en direct ou écrivez-lui.",
    readyPickup: "🛍️ La commande #{code} est prête à retirer chez {vendor}.",
    delivered: "🎉 La commande #{code} est bien arrivée ?",
    received: "✅ Reçue",
    problem: "⚠️ Problème",
    weight: "⚖️ Poids final de la commande #{code} : {total} (estimation {est}). D'accord ?",
    weightYes: "✅ D'accord",
    subOffer:
      "↔️ Commande #{code} : « {from} » n'est pas disponible. Le magasin propose « {to} » ({diff}). Nouveau total : {money}. D'accord ?",
    subYes: "✅ J'accepte",
    subNo: "❌ Sans remplacement",
    weightNo: "❌ Annuler",
    cancelRefused:
      "Le commerçant n'a pas pu annuler la commande #{code} : elle est en préparation. Elle continue.",
    rating: "Comment était votre commande chez {vendor} ?",
    rateButton: "Noter",
    food: "Repas",
    delivery: "Livraison",
    good: "👍 Bien",
    bad: "👎 Pas bien",
    reminder: "🧺 Votre panier chez {vendor} vous attend ({total}). Continuer ?",
    continue: "✅ Continuer",
    clear: "🗑️ Vider",
    thanksRating: "🙏 Merci pour votre note !",
    reason_busy: "occupé",
    reason_item_unavailable: "article indisponible",
    reason_closed: "fermé",
    reason_area_unavailable: "ne livre pas votre zone",
    reason_menu_or_price_issue: "problème de menu",
    reason_other: "autre raison",
    reason_merchant_unreachable: "le commerçant n'a pas répondu",
    reason_merchant_paused: "commandes en pause",
    reason_operator: "par l'équipe Alo King",
    reason_weight_declined: "poids refusé",
    reason_no_delivery: "pas de livraison",
    reason_payment_timeout: "paiement non effectué",
    reason_customer_request_accepted: "à votre demande",
  },
  arabizi: {
    rate: "se3r el sarf",
    locked: "msabbat 3al talab",
    today: "se3r el yom, byetsabbat 3al talab",
    cash: "Cash 3al tasleem",
    accepted: "✅ {vendor} 2ebel talabak #{code}. Byousal ba3d {eta} d2i2a ta2riban.",
    pickupAccepted: "✅ {vendor} 2ebel talabak #{code}. Bikoun jehez ba3d {eta} d2i2a ta2riban.",
    code: "🔐 Code el tasleem: {dcode}. 3ati lal driver bas yousal.",
    codePickup: "🔐 Code el istilam: {dcode}. 3ati lal mahal bas testalem.",
    rejected:
      "😔 {vendor} ma fi yekhod talabak #{code} hala2 ({reason}). Badak le2ilak mahal tene?",
    findOther: "🔎 Mahal tene",
    cancelled: "❌ Nlagha talabak #{code} ({reason}). Ma fi shi madfou3. Badak njarreb mahal tene?",
    onTheWay: "🛵 Talabak #{code} 3al tari2! Ba3d {eta} d2i2a ta2riban.",
    onTheWayLive:
      "🛵 Talabak #{code} 3al tari2! Ba3d {eta} d2i2a ta2riban. El driver fi yshareklak live location 3al WhatsApp.",
    driverChat: "💬 El driver",
    nearDrop: "📍 Talabak 3a ba3d 3 d2aye2 ta2riban.",
    nearDropLive:
      "📍 Talabak 3a ba3d 3 d2aye2 ta2riban. Iza el 3enwen sa3b, sharek live location ma3 el driver.",
    shareLive: "📍 Location-e",
    liveGreeting: "Marhaba, hayda location-e la talab Alo King",
    arrivedWait: "🚪 El driver wosel la 3endak. Iza ma le2ak, sharek live location aw ehkih.",
    readyPickup: "🛍️ Talabak #{code} jehez testalmo men {vendor}.",
    delivered: "🎉 Wosel talabak #{code}?",
    received: "✅ Wosel",
    problem: "⚠️ Fi moshkle",
    weight: "⚖️ El wazn el niha2e la talabak #{code}: {total} (el ta2dir ken {est}). Mwefe2?",
    weightYes: "✅ Mwefe2",
    subOffer:
      '↔️ Talabak #{code}: "{from}" msh metwaffar. El ma7al 3am ye2tere7 "{to}" ({diff}). El majmou3 el jdid: {money}. Mwefe2?',
    subYes: "✅ Mwefe2",
    subNo: "❌ Bala badil",
    weightNo: "❌ Elghe2",
    cancelRefused: "El mahal ma 2ebel yelghe talab #{code} la2an 3am yet7addar. El talab kammal.",
    rating: "Shu ra2yak b talabak men {vendor}?",
    rateButton: "2ayyem",
    food: "El akel",
    delivery: "El tawsil",
    good: "👍 Mni7",
    bad: "👎 Msh mni7",
    reminder: "🧺 Sallitak men {vendor} naterta ({total}). Badak tkammel?",
    continue: "✅ Kammel",
    clear: "🗑️ Fadde el salle",
    thanksRating: "🙏 Merci 3ala ta2yimak!",
    reason_busy: "mashghoul",
    reason_item_unavailable: "sanf msh metwaffar",
    reason_closed: "msakkar",
    reason_area_unavailable: "ma bywassel la mante2tak",
    reason_menu_or_price_issue: "moshkle bel menu",
    reason_other: "sabab tene",
    reason_merchant_unreachable: "el mahal ma radd",
    reason_merchant_paused: "el mahal wa22af el talabet",
    reason_operator: "men fari2 Alo King",
    reason_weight_declined: "rafadt el wazn",
    reason_no_delivery: "ma fi tawsil",
    reason_payment_timeout: "el daf3 ma tamm",
    reason_customer_request_accepted: "metel ma tlabt",
  },
};

// Session 5c (DECISIONS §22, §38.3): consolidated messages, gift orders, alternatives after an order that could not go ahead.
const T5C: Record<CLang, S> = {
  ar: {
    deliveredRate: "🎉 وصل طلبك #{code}! كيف كان؟",
    rateNow: "قيّم",
    problemRow: "⚠️ في مشكلة",
    trackBtn: "📍 تتبّع",
    alternatives: "هيدي محلات فاتحة بتوصّل لعندك:",
    giftRequest:
      "🎁 {sender} بعتلك طلب من {vendor}:\n{lines}\nالمجموع {money}، بتدفعو كاش عالتسليم على {place}. بتقبل؟\n(إذا ما بدك طلبات هدايا، ابعت STOP)",
    giftAccept: "✅ قبول، بدفع",
    giftDecline: "❌ لا شكراً",
    giftAccepted: "🎉 {name} قبل! الطلب #{code} صار عند المحل.",
    giftDeclined: "{name} ما قبل الطلب. ما انطلب شي.",
    giftExpired: "{name} ما ردّ عالوقت، ما انطلب شي. سلّتك بعدها موجودة.",
    giftFailed:
      "{name} قبل بس ما قدرنا نبعت الطلب ({reason}). ما في شي مدفوع؛ افتح سلّتك وجرّب من جديد.",
    giftThanks: "🙏 شكراً! الطلب #{code} صار عند المحل. منخبّر {sender} بكل شي.",
    giftNoThanks: "تمام، ما انطلب شي.",
    giftGone: "هالطلب ما عاد ناطر جواب.",
    someone: "حدا",
  },
  en: {
    deliveredRate: "🎉 Order #{code} delivered! How was it?",
    rateNow: "Rate",
    problemRow: "⚠️ A problem",
    trackBtn: "📍 Track",
    alternatives: "These open shops deliver to you:",
    giftRequest:
      "🎁 {sender} sent you an order from {vendor}:\n{lines}\nTotal {money}, paid in cash on delivery to {place}. Accept?\n(Reply STOP to block gift orders.)",
    giftAccept: "✅ Accept, I'll pay",
    giftDecline: "❌ No thanks",
    giftAccepted: "🎉 {name} accepted! Order #{code} is with the shop.",
    giftDeclined: "{name} declined the order. Nothing was ordered.",
    giftExpired: "{name} didn't answer in time; nothing was ordered. Your basket is still here.",
    giftFailed:
      "{name} accepted, but the order couldn't be placed ({reason}). Nothing was charged; open your basket to try again.",
    giftThanks: "🙏 Thank you! Order #{code} is with the shop. We'll keep {sender} updated.",
    giftNoThanks: "OK, nothing was ordered.",
    giftGone: "This order is no longer waiting for an answer.",
    someone: "Someone",
  },
  fr: {
    deliveredRate: "🎉 Commande #{code} livrée ! C'était comment ?",
    rateNow: "Noter",
    problemRow: "⚠️ Un problème",
    trackBtn: "📍 Suivre",
    alternatives: "Ces commerces ouverts livrent chez vous :",
    giftRequest:
      "🎁 {sender} vous a envoyé une commande de {vendor} :\n{lines}\nTotal {money}, payé en espèces à la livraison à {place}. Accepter ?\n(Répondez STOP pour bloquer les commandes cadeaux.)",
    giftAccept: "✅ J'accepte, je paie",
    giftDecline: "❌ Non merci",
    giftAccepted: "🎉 {name} a accepté ! La commande #{code} est chez le commerce.",
    giftDeclined: "{name} a refusé la commande. Rien n'a été commandé.",
    giftExpired:
      "{name} n'a pas répondu à temps ; rien n'a été commandé. Votre panier est toujours là.",
    giftFailed:
      "{name} a accepté, mais la commande n'a pas pu être passée ({reason}). Rien n'a été payé ; ouvrez votre panier pour réessayer.",
    giftThanks:
      "🙏 Merci ! La commande #{code} est chez le commerce. Nous tenons {sender} informé(e).",
    giftNoThanks: "D'accord, rien n'a été commandé.",
    giftGone: "Cette commande n'attend plus de réponse.",
    someone: "Quelqu'un",
  },
  arabizi: {
    deliveredRate: "🎉 Wosel talabak #{code}! Kif ken?",
    rateNow: "2ayyem",
    problemRow: "⚠️ Fi moshkle",
    trackBtn: "📍 Tatabba3",
    alternatives: "Hawde ma7alat fet7a bwaslo la 3endak:",
    giftRequest:
      "🎁 {sender} ba3atlak talab men {vendor}:\n{lines}\nEl majmou3 {money}, btedfa3o cash 3al tasleem 3a {place}. Bte2bal?\n(Iza ma badak talabet hadaya, b3at STOP)",
    giftAccept: "✅ 2abilt, bedfa3",
    giftDecline: "❌ La2 merci",
    giftAccepted: "🎉 {name} 2ebel! El talab #{code} sar 3and el ma7al.",
    giftDeclined: "{name} ma 2ebel el talab. Ma ntalab shi.",
    giftExpired: "{name} ma radd 3al wa2et, ma ntalab shi. Salltak ba3da mawjoude.",
    giftFailed:
      "{name} 2ebel bas ma 2derna neb3at el talab ({reason}). Ma fi shi madfou3; efta7 salltak w jarreb men jdid.",
    giftThanks: "🙏 Merci! El talab #{code} sar 3and el ma7al. Mnkhabber {sender} b kel shi.",
    giftNoThanks: "Tamem, ma ntalab shi.",
    giftGone: "Hal talab ma 3ad nater jaweb.",
    someone: "7ada",
  },
};
for (const l of LANGS) Object.assign(T[l], T5C[l]);

export const fill = (s: string, v: Record<string, unknown>) =>
  s.replace(/\{(\w+)\}/g, (_, k) => (v[k] === undefined || v[k] === null ? "" : String(v[k])));
export const tr = (lang: CLang, key: string, v: Record<string, unknown> = {}) =>
  fill(T[lang][key] ?? T.en[key] ?? key, v);

/** "$12.50 = 1,118,750 LBP (rate 89,500, locked at order)" (§13). `locked` false = shown before ordering. */
export function moneyLine(
  totalUsd: unknown,
  totalLbp: unknown,
  rate: unknown,
  lang: CLang,
  locked = true,
): string {
  const t = T[lang];
  return `${usd(totalUsd)} = ${lbp(totalLbp)} LBP (${t.rate} ${lbp(rate)}, ${locked ? t.locked : t.today})`;
}

const etaText = (eta: any) =>
  eta && eta.min
    ? eta.max && eta.max !== eta.min
      ? `${eta.min}-${eta.max}`
      : `${eta.min}`
    : "30-45";

// ---- Order status messages (outbox purpose customer_message) ---------------------------------------------
export type OrderInfo = {
  order_id: string;
  code: string;
  vendor_name?: string | null;
  fulfilment?: string;
  total_usd?: number | string;
  total_lbp?: number | string;
  usd_lbp_rate?: number | string;
};

/**
 * The customer messages for one outbox row. `p` is the outbox payload (kind, lang, eta, reason,
 * driver_phone, ...), `card` the order summary from outbox_claim, `extra` server facts read at send time
 * (delivery code, after sunset). Returns [] when there is nothing to send.
 */
export function customerStatusMessages(
  to: string,
  p: Record<string, any>,
  card: OrderInfo | null,
  extra: { deliveryCode?: string | null; afterSunset?: boolean } = {},
): Record<string, unknown>[] {
  const lang = asLang(p.lang);
  const code = card?.code ?? "";
  const vendor = card?.vendor_name ?? "";
  const oid = card?.order_id ?? "";
  const reason = (r: unknown) => tr(lang, `reason_${String(r ?? "other")}`);
  const codeLine = extra.deliveryCode
    ? `\n${tr(lang, card?.fulfilment === "pickup" ? "codePickup" : "code", { dcode: extra.deliveryCode })}`
    : "";
  const money = card
    ? `\n${moneyLine(card.total_usd, card.total_lbp, card.usd_lbp_rate, lang)}`
    : "";
  const driver =
    typeof p.driver_phone === "string" && /^\+[1-9]\d{6,14}$/.test(p.driver_phone)
      ? p.driver_phone
      : null;
  switch (p.kind) {
    case "accepted":
      return [
        text(
          to,
          tr(lang, card?.fulfilment === "pickup" ? "pickupAccepted" : "accepted", {
            vendor,
            code,
            eta: etaText(p.eta),
          }) +
            money +
            codeLine,
        ),
      ];
    case "rejected":
      return [
        alternativesCard(
          to,
          tr(lang, "rejected", { vendor, code, reason: reason(p.reason) }),
          p.alternatives,
          lang,
        ),
      ];
    case "cancelled":
      return [
        alternativesCard(
          to,
          tr(lang, "cancelled", { code, reason: reason(p.reason) }),
          p.alternatives,
          lang,
        ),
      ];
    case "on_the_way": {
      const body =
        tr(lang, driver ? "onTheWayLive" : "onTheWay", { code, eta: etaText(p.eta) }) + codeLine;
      // "On the way + tracking" in one message (§38.3) once the public tracking page exists.
      const track =
        typeof p.track_url === "string" && /^https:\/\/\S+$/.test(p.track_url) ? p.track_url : null;
      if (track) return [ctaUrl(to, body, tr(lang, "trackBtn"), track)];
      return driver ? [ctaUrl(to, body, tr(lang, "driverChat"), waMe(driver))] : [text(to, body)];
    }
    case "near_drop": {
      // §27.3: the live-location button when the drop is uncertain or after sunset.
      const ask = driver && (!p.door_confirmed || extra.afterSunset);
      return ask
        ? [
            ctaUrl(
              to,
              tr(lang, "nearDropLive") + codeLine,
              tr(lang, "shareLive"),
              waMe(driver, tr(lang, "liveGreeting")),
            ),
          ]
        : [text(to, tr(lang, "nearDrop") + codeLine)];
    }
    case "arrived_wait":
      return driver
        ? [
            ctaUrl(
              to,
              tr(lang, "arrivedWait"),
              tr(lang, "shareLive"),
              waMe(driver, tr(lang, "liveGreeting")),
            ),
          ]
        : [text(to, tr(lang, "arrivedWait"))];
    case "ready_for_pickup":
      return [text(to, tr(lang, "readyPickup", { code, vendor }) + money)];
    case "delivered":
      // "Delivered + rate" in one message (§38.3): a rating tap also means received; "Problem" opens the problem list.
      return oid ? [deliveredRateList(to, oid, !!p.ask_delivery, lang, code)] : [];
    case "weight_confirm":
      return [
        buttons(
          to,
          tr(lang, "weight", { code, total: usd(p.total_usd), est: usd(p.estimated_total_usd) }) +
            `\n= ${lbp(p.total_lbp)} LBP`,
          [
            [`wgt:${oid}:y`, tr(lang, "weightYes")],
            [`wgt:${oid}:n`, tr(lang, "weightNo")],
          ],
        ),
      ];
    case "cancel_refused":
      return [text(to, tr(lang, "cancelRefused", { code }))];
    case "substitution": {
      // A substitute the merchant offered (§32.5): priced by the server, shown in USD and LBP at the locked rate.
      if (!/^[0-9a-f-]{36}$/.test(String(p.substitution_id ?? ""))) return [];
      const d = n2(p.diff_usd);
      const diff =
        d === 0
          ? "="
          : `${d > 0 ? "+" : "-"}${usd(Math.abs(d))} / ${d > 0 ? "+" : "-"}${lbp(Math.abs(n2(p.diff_lbp)))} LBP`;
      const en = lang === "en" || lang === "fr";
      return [
        buttons(
          to,
          tr(lang, "subOffer", {
            code,
            from: en ? p.from_en : p.from_ar,
            to: en ? p.to_en : p.to_ar,
            diff,
            money: moneyLine(p.new_total_usd, p.new_total_lbp, p.usd_lbp_rate, lang),
          }),
          [
            [`sub:${p.substitution_id}:y`, tr(lang, "subYes")],
            [`sub:${p.substitution_id}:n`, tr(lang, "subNo")],
          ],
        ),
      ];
    }
    case "rating":
      return [ratingList(to, oid, vendor, !!p.ask_delivery, lang)];
    case "gift_request": {
      // To the recipient (§22.2 scenario 7): nothing is ordered until they accept and agree to pay cash.
      if (!/^[0-9a-f-]{36}$/.test(String(p.gift_id ?? ""))) return [];
      const en = lang === "en" || lang === "fr";
      const lines = (Array.isArray(p.lines) ? p.lines : [])
        .slice(0, 12)
        .map(
          (l: any) =>
            `• ${n2(l.q)}× ${String((en ? (l.name_en ?? l.name) : (l.name ?? l.name_en)) ?? "")}`,
        )
        .join("\n");
      const body = tr(lang, "giftRequest", {
        sender: String(p.sender || tr(lang, "someone")),
        vendor: en ? (p.vendor_en ?? p.vendor) : (p.vendor ?? p.vendor_en),
        lines,
        money: moneyLine(p.total_usd, p.total_lbp, p.usd_lbp_rate, lang, false),
        place: en ? (p.place_en ?? p.place ?? "") : (p.place ?? p.place_en ?? ""),
      });
      // The money line and the question come last; a long list of lines is cut, never the total (Meta: body ≤ 1024).
      const fit =
        [...body].length > 1024
          ? body.replace(
              lines,
              [...lines].slice(0, lines.length - ([...body].length - 1000)).join("") + "…",
            )
          : body;
      return [
        buttons(to, fit, [
          [`gft:${p.gift_id}:y`, tr(lang, "giftAccept")],
          [`gft:${p.gift_id}:n`, tr(lang, "giftDecline")],
        ]),
      ];
    }
    case "gift_accepted":
      return [text(to, tr(lang, "giftAccepted", { name: p.recipient_name, code: p.code }))];
    case "gift_declined":
      return [text(to, tr(lang, "giftDeclined", { name: p.recipient_name }))];
    case "gift_expired":
      return [
        buttons(to, tr(lang, "giftExpired", { name: p.recipient_name }), [
          ["c:basket", tr(lang, "continue")],
        ]),
      ];
    case "gift_failed":
      return [
        buttons(
          to,
          tr(lang, "giftFailed", { name: p.recipient_name, reason: String(p.reason ?? "") }),
          [["c:basket", tr(lang, "continue")]],
        ),
      ];
    case "basket_reminder": {
      const b = p.basket;
      if (!b?.lines?.length) return [];
      return [
        buttons(
          to,
          tr(lang, "reminder", {
            vendor: lang === "ar" ? b.vendor : (b.vendor_en ?? b.vendor),
            total: usd(b.subtotal_usd),
          }),
          [
            ["c:checkout", tr(lang, "continue")],
            ["c:clear", tr(lang, "clear")],
          ],
        ),
      ];
    }
    default:
      return [];
  }
}

/** One message: food 1-5, plus 👍/👎 for the delivery when our app's driver delivered (§30.2.3). */
export function ratingList(
  to: string,
  orderId: string,
  vendor: string,
  askDelivery: boolean,
  lang: CLang,
) {
  const food: Row[] = [5, 4, 3, 2, 1].map((n) => ({
    id: `rate:${orderId}:f${n}`,
    title: "⭐".repeat(n),
  }));
  const sections: { title?: string; rows: Row[] }[] = [{ title: tr(lang, "food"), rows: food }];
  if (askDelivery)
    sections.push({
      title: tr(lang, "delivery"),
      rows: [
        { id: `rate:${orderId}:d1`, title: tr(lang, "good") },
        { id: `rate:${orderId}:d0`, title: tr(lang, "bad") },
      ],
    });
  return list(to, tr(lang, "rating", { vendor }), tr(lang, "rateButton"), sections);
}

/** "Delivered + rate" in one message (§38.3): food 1-5, the delivery 👍/👎 when our driver delivered, and "Problem". */
export function deliveredRateList(
  to: string,
  orderId: string,
  askDelivery: boolean,
  lang: CLang,
  code: string,
) {
  const sections: { title?: string; rows: Row[] }[] = [
    {
      title: tr(lang, "food"),
      rows: [5, 4, 3, 2, 1].map((n) => ({ id: `rate:${orderId}:f${n}`, title: "⭐".repeat(n) })),
    },
  ];
  if (askDelivery)
    sections.push({
      title: tr(lang, "delivery"),
      rows: [
        { id: `rate:${orderId}:d1`, title: tr(lang, "good") },
        { id: `rate:${orderId}:d0`, title: tr(lang, "bad") },
      ],
    });
  sections.push({ rows: [{ id: `rcv:${orderId}:no`, title: tr(lang, "problemRow") }] });
  return list(to, tr(lang, "deliveredRate", { code }), tr(lang, "rateNow"), sections);
}

/** An order that could not go ahead, with up to three open shops that deliver there (§38.3), or "find another". */
export function alternativesCard(to: string, body: string, alts: unknown, lang: CLang) {
  const rows = (Array.isArray(alts) ? alts : [])
    .filter((a: any) => /^v\d{1,2}$/.test(String(a?.ref ?? "")))
    .slice(0, 3) as { ref: string; name_ar?: string; name_en?: string }[];
  if (!rows.length) return buttons(to, body, [["c:find", tr(lang, "findOther")]]);
  return buttons(
    to,
    `${body}\n${tr(lang, "alternatives")}`,
    rows.map((r) => {
      const nm = String(
        (lang === "ar" ? (r.name_ar ?? r.name_en) : (r.name_en ?? r.name_ar)) ?? "",
      );
      return [`pv:${r.ref}`, [...nm].length > 20 ? [...nm].slice(0, 19).join("") + "…" : nm] as [
        string,
        string,
      ];
    }),
  );
}

/** Customer button and list ids. Anything else is not ours and gets no action. */
export type CustomerAction =
  | { a: "received"; orderId: string; ok: boolean }
  | { a: "weight"; orderId: string; accept: boolean }
  | { a: "rate"; orderId: string; food?: number; deliveryOk?: boolean }
  | { a: "confirm"; basketId: string; version: number }
  | { a: "cancel"; orderId: string }
  | { a: "empty"; lineId: string; hasEmpty: boolean }
  | { a: "pick_vendor"; ref: string }
  | { a: "pick_item"; ref: string }
  | { a: "add_upsell"; itemId: string }
  | { a: "replace_basket"; itemId: string; qty: number }
  | { a: "option"; optionId: string }
  | { a: "substitution"; substitutionId: string; accept: boolean }
  | { a: "sub_pref"; pref: "call" | "replace" | "remove" }
  | { a: "section"; ref: string }
  | { a: "more"; ref: string; offset: number }
  | { a: "qty"; ref: string; qty: number }
  | { a: "cash"; currency: "USD" | "LBP" }
  | { a: "gift"; giftId: string; accept: boolean }
  | {
      a: "memory_delete";
      part: "all" | "name" | "lang" | "orders" | "addrs" | "facts" | "address" | "fact";
      ref?: string;
    }
  | { a: "consent"; key: string | null; ok: boolean }
  | { a: "address"; ref: string }
  | { a: "for_whom"; what: "self_save" | "self_once" | "other" }
  | {
      a: "problem_kind";
      kind: "missing_item" | "wrong_item" | "cold_food" | "late" | "damaged" | "other";
    }
  | { a: "problem_line"; itemId: string; kind: "missing_item" | "wrong_item" }
  | {
      a: "simple";
      what:
        | "find"
        | "checkout"
        | "clear"
        | "menu"
        | "basket"
        | "pickup"
        | "delivery"
        | "human"
        | "delete_ok"
        | "keep"
        | "usual"
        | "address_list"
        | "no_upsell"
        | "order"
        | "track"
        | "pickup_list"
        | "cancel"
        | "remember"
        | "new_address";
    };

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const re = (s: string) => new RegExp(`^${s}$`);
export function parseCustomerAction(id: string): CustomerAction | null {
  let m: RegExpMatchArray | null;
  if ((m = id.match(re(`rcv:(${UUID}):(ok|no)`))))
    return { a: "received", orderId: m[1], ok: m[2] === "ok" };
  if ((m = id.match(re(`wgt:(${UUID}):(y|n)`))))
    return { a: "weight", orderId: m[1], accept: m[2] === "y" };
  if ((m = id.match(re(`rate:(${UUID}):f([1-5])`))))
    return { a: "rate", orderId: m[1], food: Number(m[2]) };
  if ((m = id.match(re(`rate:(${UUID}):d([01])`))))
    return { a: "rate", orderId: m[1], deliveryOk: m[2] === "1" };
  if ((m = id.match(re(`cfm:(${UUID}):(\\d{1,12})`))))
    return { a: "confirm", basketId: m[1], version: Number(m[2]) };
  if ((m = id.match(re(`cxl:(${UUID})`)))) return { a: "cancel", orderId: m[1] };
  if ((m = id.match(re(`emp:(${UUID}):(y|n)`))))
    return { a: "empty", lineId: m[1], hasEmpty: m[2] === "y" };
  if ((m = id.match(re(`pv:(v\\d{1,2})`)))) return { a: "pick_vendor", ref: m[1] };
  if ((m = id.match(re(`pi:(i\\d{1,3})`)))) return { a: "pick_item", ref: m[1] };
  if ((m = id.match(re(`ups:(${UUID})`)))) return { a: "add_upsell", itemId: m[1] };
  if ((m = id.match(re(`rpl:(${UUID}):(\\d{1,2})`))))
    return { a: "replace_basket", itemId: m[1], qty: Number(m[2]) };
  if ((m = id.match(re(`opt:(${UUID})`)))) return { a: "option", optionId: m[1] };
  if ((m = id.match(re(`sub:(${UUID}):(y|n)`))))
    return { a: "substitution", substitutionId: m[1], accept: m[2] === "y" };
  if ((m = id.match(re(`ps:(s\\d{1,2})`)))) return { a: "section", ref: m[1] };
  if ((m = id.match(re(`mo:(s\\d{1,2}):(\\d{1,3})`))))
    return { a: "more", ref: m[1], offset: Number(m[2]) };
  if ((m = id.match(re(`qt:(i\\d{1,3}):(\\d{1,2})`))))
    return { a: "qty", ref: m[1], qty: Number(m[2]) };
  if ((m = id.match(re(`cur:(USD|LBP)`)))) return { a: "cash", currency: m[1] as "USD" | "LBP" };
  if ((m = id.match(/^sbp:(call|replace|remove)$/)))
    return { a: "sub_pref", pref: m[1] as "call" | "replace" | "remove" };
  if (
    (m = id.match(
      /^c:(find|checkout|clear|menu|basket|pickup|delivery|human|delete_ok|keep|usual|address_list|no_upsell|order|track|pickup_list|cancel|remember|new_address)$/,
    ))
  )
    return { a: "simple", what: m[1] as any };
  if ((m = id.match(re(`gft:(${UUID}):(y|n)`))))
    return { a: "gift", giftId: m[1], accept: m[2] === "y" };
  if ((m = id.match(/^mem:(all|name|lang|orders|addrs|facts)$/)))
    return { a: "memory_delete", part: m[1] as any };
  if ((m = id.match(/^mem:a:(a\d{1,2})$/)))
    return { a: "memory_delete", part: "address", ref: m[1] };
  if (
    (m = id.match(
      /^mem:f:(vegetarian|vegan|no_pork|no_alcohol|fasting|halal|allergy|gluten_free|no_sugar|spice|note)$/,
    ))
  )
    return { a: "memory_delete", part: "fact", ref: m[1] };
  if ((m = id.match(/^mok:(allergy|gluten_free|no_sugar)$/)))
    return { a: "consent", key: m[1], ok: true };
  if (id === "mno") return { a: "consent", key: null, ok: false };
  if ((m = id.match(/^adr:(a\d{1,2})$/))) return { a: "address", ref: m[1] };
  if ((m = id.match(/^fw:(self_save|self_once|other)$/)))
    return { a: "for_whom", what: m[1] as any };
  if ((m = id.match(/^dpk:(missing_item|wrong_item|cold_food|late|damaged|other)$/)))
    return { a: "problem_kind", kind: m[1] as any };
  if ((m = id.match(re(`dpl:(${UUID}):(m|w)`))))
    return { a: "problem_line", itemId: m[1], kind: m[2] === "m" ? "missing_item" : "wrong_item" };
  return null;
}

/** Approximate sunset in Beirut, UTC hour and minute by month (§27.3 "after sunset"); ±15 min is enough here. */
const SUNSET_UTC = [
  [15, 0],
  [15, 30],
  [15, 55],
  [16, 15],
  [16, 35],
  [16, 50],
  [16, 50],
  [16, 30],
  [15, 55],
  [15, 20],
  [14, 50],
  [14, 40],
];
export function afterSunset(now: Date): boolean {
  const [h, m] = SUNSET_UTC[now.getUTCMonth()];
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  return mins >= h * 60 + m || mins < 3 * 60; // until about 05:00 Beirut
}
