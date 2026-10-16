// Deterministic rendering of server results into customer messages (DECISIONS §29.3 interface choice:
// buttons for 1-3 choices, lists for 4-10, the web basket beyond 10; Flows come with session 5). Every
// amount comes from an RPC result. Pure functions, tested in render.test.ts and meta-limits.test.ts.

import {
  buttons,
  ctaUrl,
  list,
  locationRequest,
  moneyLine,
  text,
  tr as baseTr,
  usd,
  type CLang,
  type Row,
} from "../../_shared/customer-cards.ts";

type Msg = Record<string, unknown>;
type V = Record<string, unknown>;

const S: Record<string, Record<CLang, string>> = {
  welcome: {
    ar: "أهلا بـ Alo King 👑 شو بتحب تطلب اليوم؟ دوس «اطلب» أو اكتبلي أو ابعتلي صوت، مثلاً «بدي ٢ شاورما».",
    en: 'Welcome to Alo King 👑 What would you like today? Tap Order, or type or send a voice note, e.g. "2 shawarma".',
    fr: "Bienvenue chez Alo King 👑 Que voulez-vous commander ? Touchez Commander, ou écrivez ou envoyez un vocal, par ex. « 2 shawarmas ».",
    arabizi:
      'Ahla w sahla b Alo King 👑 Shu badak totlob lyom? Dos "Otlob" aw ekteb aw b3at voice, metel "badde 2 shawarma".',
  },
  btnOrder: { ar: "🍽️ اطلب", en: "🍽️ Order", fr: "🍽️ Commander", arabizi: "🍽️ Otlob" },
  btnTrack: { ar: "📦 طلبي", en: "📦 My order", fr: "📦 Ma commande", arabizi: "📦 Talabe" },
  btnPerson: { ar: "🙋 حدا بشري", en: "🙋 A person", fr: "🙋 Une personne", arabizi: "🙋 Shakhs" },
  btnMenu: { ar: "🍽️ المنيو", en: "🍽️ Menu", fr: "🍽️ Menu", arabizi: "🍽️ El menu" },
  aiOff: {
    ar: "ما فيني قرا الكتابة هلق 🙏 اختار من الأزرار:",
    en: "I can't read free text right now 🙏 Please use the buttons:",
    fr: "Je ne peux pas lire le texte libre pour l'instant 🙏 Utilisez les boutons :",
    arabizi: "Ma fine read el kteybe hala2 🙏 Ekhtar men el azrar:",
  },
  glad: {
    ar: "🙏 الحمدلله وصل!",
    en: "🙏 Glad it arrived!",
    fr: "🙏 Content que ça soit arrivé !",
    arabizi: "🙏 Elhamdella wosel!",
  },
  moreBtn: { ar: "المزيد ›", en: "More ›", fr: "Plus ›", arabizi: "Aktar ›" },
  sectionsOf: {
    ar: "اختار قسم من {vendor}:",
    en: "Pick a section of {vendor}:",
    fr: "Choisissez une section de {vendor} :",
    arabizi: "Na22e se2em men {vendor}:",
  },
  itemsCount: { ar: "{n} صنف", en: "{n} items", fr: "{n} articles", arabizi: "{n} sanf" },
  qtyAsk: {
    ar: "كم «{item}»؟",
    en: 'How many "{item}"?',
    fr: "Combien de « {item} » ?",
    arabizi: 'Kam "{item}"?',
  },
  qtyButton: { ar: "الكمية", en: "Quantity", fr: "Quantité", arabizi: "El kammiye" },
  cashAsk: {
    ar: "بأي عملة رح تدفع كاش عالتسليم؟",
    en: "Which currency will you pay cash in?",
    fr: "En quelle devise paierez-vous en espèces ?",
    arabizi: "Ayy 3emle ra7 tdfa3 cash 3al tasleem?",
  },
  fulfilAsk: {
    ar: "كيف بدك تستلم طلبك؟",
    en: "How would you like to get your order?",
    fr: "Comment voulez-vous recevoir votre commande ?",
    arabizi: "Kif badak testalem talabak?",
  },
  btnDelivery: {
    ar: "🛵 توصيل",
    en: "🛵 Delivery",
    fr: "🛵 Livraison",
    arabizi: "🛵 Tawsil",
  },
  btnPickup: {
    ar: "🛍️ استلام",
    en: "🛍️ Pickup",
    fr: "🛍️ Retrait",
    arabizi: "🛍️ Istilam",
  },
  askPin: {
    ar: "📍 ابعتلي موقعك (Location) لنعرف وين نوصّل.",
    en: "📍 Send me your location pin so we know where to deliver.",
    fr: "📍 Envoyez-moi votre position pour la livraison.",
    arabizi: "📍 B3atle location la ne3ref wen nwassel.",
  },
  pinFromWords: {
    ar: "📍 فهمت إنك بـ {place}. ابعتلي الموقع (Location) لنتأكد من الباب.",
    en: "📍 Got it, {place}. Please send your location pin so the driver finds the door.",
    fr: "📍 Compris, {place}. Envoyez votre position pour que le livreur trouve la porte.",
    arabizi: "📍 Fhemt, {place}. B3atle location la yle2i el driver el beb.",
  },
  savedPin: {
    ar: "✅ حفظت العنوان: {where}",
    en: "✅ Address saved: {where}",
    fr: "✅ Adresse enregistrée : {where}",
    arabizi: "✅ Hafazt el 3enwen: {where}",
  },
  noPlace: {
    ar: "ما قدرت لاقي هالموقع ضمن لبنان. جرّب ابعت الموقع مرة تانية أو اكتبلي اسم الضيعة.",
    en: "I couldn't match that pin to a place in Lebanon. Try sending it again, or type your village.",
    fr: "Je n'ai pas trouvé ce lieu au Liban. Renvoyez la position ou écrivez votre village.",
    arabizi: "Ma 2dert le2i hal location b Lebnen. Jarreb b3ato marra tenye aw ekteb esm el day3a.",
  },
  placePaused: {
    ar: "😔 ما منوصّل لهالمنطقة هلق.",
    en: "😔 We don't deliver to that area right now.",
    fr: "😔 Nous ne livrons pas cette zone pour l'instant.",
    arabizi: "😔 Ma mnwassel la hal mante2a hala2.",
  },
  noVendors: {
    ar: "ما لقيت محل بيوصّل لعندك لـ «{q}» هلق. جرّب شي تاني؟",
    en: 'I couldn\'t find a place delivering "{q}" to you right now. Try something else?',
    fr: "Je n'ai trouvé aucun endroit qui livre « {q} » chez vous. Autre chose ?",
    arabizi: 'Ma le2et mahal ywassel "{q}" la 3endak hala2. Jarreb shi tene?',
  },
  noVendorsYet: {
    ar: "🙏 Alo King بعدو عم يبلّش ومافي محلات عم تستقبل طلبات بمنطقتك هلق. منخبرك أول ما يصير في.",
    en: "🙏 Alo King is just starting and no places are taking orders near you yet. We'll be there soon.",
    fr: "🙏 Alo King démarre : aucun commerce ne prend encore de commandes près de chez vous.",
    arabizi: "🙏 Alo King ba3do 3am ybalesh w ma fi mahallet 3am testa2bel talabet 3endak hala2.",
  },
  pickVendor: {
    ar: "اختار محل:",
    en: "Pick a place:",
    fr: "Choisissez un endroit :",
    arabizi: "Na22e mahal:",
  },
  places: { ar: "المحلات", en: "Places", fr: "Endroits", arabizi: "El mahallet" },
  // DECISIONS §39.3: a shop the customer named that is not on Alo King yet.
  notOnAloKing: {
    ar: "«{vendor}»{where} مش على Alo King بعد، فما فيك تطلب منو هون. دوس تحت لتطلب منو ينضمّ: بيفتحلك واتساب مع رسالة جاهزة إلو.",
    en: '"{vendor}"{where} is not on Alo King yet, so it can\'t take orders here. Tap below to ask them to join: it opens your WhatsApp with a message ready for them.',
    fr: "« {vendor} »{where} n'est pas encore sur Alo King : pas de commande possible ici. Touchez ci-dessous pour l'inviter à rejoindre : votre WhatsApp s'ouvre avec un message prêt.",
    arabizi:
      '"{vendor}"{where} mesh 3a Alo King ba3d, fa ma fik totlob meno hon. Dos ta7t la totlob meno yenddam: byeftahlak WhatsApp ma3 message jehze.',
  },
  notOnAloKingNoLink: {
    ar: "«{vendor}»{where} مش على Alo King بعد، فما فيك تطلب منو هون.",
    en: '"{vendor}"{where} is not on Alo King yet, so it can\'t take orders here.',
    fr: "« {vendor} »{where} n'est pas encore sur Alo King : pas de commande possible ici.",
    arabizi: '"{vendor}"{where} mesh 3a Alo King ba3d, fa ma fik totlob meno hon.',
  },
  inPlace: { ar: " ب{place}", en: " in {place}", fr: " à {place}", arabizi: " b {place}" },
  askJoinBtn: {
    ar: "اطلب ينضمّوا",
    en: "Ask them to join",
    fr: "Inviter à rejoindre",
    arabizi: "Otlob yenddammo",
  },
  pickInstead: {
    ar: "فيك تطلب من هول بدالو:",
    en: "You can order from these instead:",
    fr: "Vous pouvez commander ici à la place :",
    arabizi: "Fik totlob men hawde badalo:",
  },
  closedUntil: { ar: "مسكّر هلق", en: "closed now", fr: "fermé", arabizi: "msakkar hala2" },
  menuOf: {
    ar: "منيو {vendor}:",
    en: "{vendor} menu:",
    fr: "Menu de {vendor} :",
    arabizi: "Menu {vendor}:",
  },
  menuButton: { ar: "المنيو", en: "Menu", fr: "Menu", arabizi: "El menu" },
  moreItems: {
    ar: "في كمان أصناف، اكتب اسم الصنف اللي بدك ياه.",
    en: "There's more: type the dish you want.",
    fr: "Il y a d'autres plats : écrivez celui que vous voulez.",
    arabizi: "Fi kamen asnaf, ekteb esm el sanf.",
  },
  lastFew: { ar: "آخر كم حبة", en: "last few", fr: "derniers", arabizi: "akher kam wa7de" },
  soldOut: { ar: "خلصان", en: "sold out", fr: "épuisé", arabizi: "khelsan" },
  flowRetry: {
    ar: "ما قدرت إحفظ هالخيارات. جرّب مرة تانية أو اكتبلي شو بدك.",
    en: "I couldn't save those choices. Please try again or type what you'd like.",
    fr: "Je n'ai pas pu enregistrer ces choix. Réessayez ou écrivez ce que vous voulez.",
    arabizi: "Ma 2drt e7faz hal5ayarat. Jarreb marra tenye aw ekteble shu badak.",
  },
  subPrefAsk: {
    ar: "🛒 إذا صنف خلص عند المحل، شو منعمل؟",
    en: "🛒 If an item is out of stock at the shop, what should we do?",
    fr: "🛒 Si un article manque au magasin, que faisons-nous ?",
    arabizi: "🛒 Iza sanf 5eles 3and el ma7al, shu men3mel?",
  },
  subCall: {
    ar: "📞 اتصلوا فيي",
    en: "📞 Call me",
    fr: "📞 Appelez-moi",
    arabizi: "📞 Ettesalo fiye",
  },
  subReplace: {
    ar: "↔️ بدّلوا لحد ${max}+",
    en: "↔️ Replace ≤ +${max}",
    fr: "↔️ Remplacer ≤ ${max}",
    arabizi: "↔️ Baddlo ≤ +${max}",
  },
  subRemove: { ar: "🚫 شيلو", en: "🚫 Remove it", fr: "🚫 Retirer", arabizi: "🚫 Shilo" },
  subAccepted: {
    ar: "✅ تمام، بدّلنا الصنف. المجموع الجديد {money}.",
    en: "✅ Done, the item was replaced. New total {money}.",
    fr: "✅ C'est fait, l'article est remplacé. Nouveau total {money}.",
    arabizi: "✅ Tamem, baddalna el sanf. El majmou3 el jdid {money}.",
  },
  subDeclined: {
    ar: "تمام، شلنا الصنف. المجموع الجديد {money}.",
    en: "OK, the item was removed. New total {money}.",
    fr: "D'accord, l'article est retiré. Nouveau total {money}.",
    arabizi: "Tamem, shilna el sanf. El majmou3 el jdid {money}.",
  },
  subLast: {
    ar: "هيدا آخر صنف بطلبك، فالمحل رح يتصل فيك.",
    en: "That's the last item in your order, so the shop will call you.",
    fr: "C'est le dernier article de la commande : le magasin va vous appeler.",
    arabizi: "Hayda akher sanf b talabak, fa el ma7al ra7 yettesel fik.",
  },
  subCap: {
    ar: "البديل بيطلّع الطلب فوق حد الدفع كاش، فالمحل رح يتصل فيك.",
    en: "That substitute would take the order over the cash limit, so the shop will call you.",
    fr: "Ce remplacement dépasserait la limite de paiement en espèces : le magasin va vous appeler.",
    arabizi: "El badil bi tale3 el talab fo2 7add el cash, fa el ma7al ra7 yettesel fik.",
  },
  subGone: {
    ar: "هالعرض ما عاد صالح (الطلب تحرّك).",
    en: "That offer is no longer valid (the order has moved on).",
    fr: "Cette proposition n'est plus valable.",
    arabizi: "Hal 3ard ma 3ad sale7.",
  },
  sameShopPrice: {
    ar: "🏷️ نفس سعر المحل",
    en: "🏷️ Same price as in the shop",
    fr: "🏷️ Même prix qu'en magasin",
    arabizi: "🏷️ Nafs se3r el ma7al",
  },
  cartMoreOptions: {
    ar: "ولـ {n} صنف تاني بدنا خيارات: اختار هيدا الأول، وبعدها زيدهن من المنيو.",
    en: "{n} more item(s) need choices: pick this one first, then add them from the menu.",
    fr: "{n} autre(s) article(s) demandent des choix : choisissez d'abord celui-ci, puis ajoutez-les depuis le menu.",
    arabizi: "W la {n} sanf tene badna 5ayarat: e5tar hayda awal, w ba3den zidon men el menu.",
  },
  addressSaved: {
    ar: "✅ حفظنا تفاصيل العنوان.",
    en: "✅ Address details saved.",
    fr: "✅ Détails de l'adresse enregistrés.",
    arabizi: "✅ 7afazna tafasil el 3enwen.",
  },
  noDietItem: {
    ar: "ما في شي عند {vendor} بيطابق طلبك من الأصناف اللي المحل صرّح عنها.",
    en: "Nothing at {vendor} matches, among the items the place has declared.",
    fr: "Rien chez {vendor} ne correspond, parmi les plats que l'établissement a déclarés.",
    arabizi: "Ma fi shi 3end {vendor} byetaba2 men el asnaf yalli el ma7al sarra7 3anon.",
  },
  dietMenuOf: {
    ar: "هيدا اللي بيناسبك عند {vendor}:",
    en: "What fits at {vendor}:",
    fr: "Ce qui vous convient chez {vendor} :",
    arabizi: "Hayda yalli byenesbak 3end {vendor}:",
  },
  protein: { ar: "بروتين", en: "protein", fr: "protéines", arabizi: "protein" },
  estimatedNote: {
    ar: "≈ يعني تقدير من الوصفة، و ✓ يعني المحل أكّد الأرقام.",
    en: "≈ means estimated from the recipe; ✓ means the place confirmed the numbers.",
    fr: "≈ = estimé d'après la recette ; ✓ = chiffres confirmés par l'établissement.",
    arabizi: "≈ ya3ne ta2dir men el wasfa, w ✓ ya3ne el ma7al akkad el ar2am.",
  },
  allergenNote: {
    ar: "⚠️ مسببات الحساسية متل ما صرّح فيها {vendor}. إذا عندك حساسية قوية، أكّد معهن قبل ما تطلب.",
    en: "⚠️ Allergens as declared by {vendor}. If you have a severe allergy, please confirm with them before ordering.",
    fr: "⚠️ Allergènes tels que déclarés par {vendor}. En cas d'allergie sévère, confirmez avec eux avant de commander.",
    arabizi:
      "⚠️ El allergens metel ma sarra7 fiyon {vendor}. Iza 3andak 7asesiye awiye, akked ma3on abel ma totlob.",
  },
  noItem: {
    ar: "ما لقيت «{q}» بمنيو {vendor}.",
    en: "I couldn't find \"{q}\" on {vendor}'s menu.",
    fr: "Je n'ai pas trouvé « {q} » chez {vendor}.",
    arabizi: 'Ma le2et "{q}" b menu {vendor}.',
  },
  pickPlaceFirst: {
    ar: "من أي محل؟ قلّي شو بدك وبلاقيلك.",
    en: "From which place? Tell me what you'd like and I'll find it.",
    fr: "De quel endroit ? Dites-moi ce que vous voulez.",
    arabizi: "Men ayya mahal? 2elle shu badak w ble2iylak.",
  },
  otherVendor: {
    ar: "سلّتك فيها أغراض من {vendor}. بدك تفضّيها وتبلّش من هون؟",
    en: "Your basket has items from {vendor}. Empty it and start here?",
    fr: "Votre panier contient des articles de {vendor}. Le vider et recommencer ici ?",
    arabizi: "Sallitak fiya men {vendor}. Badak tfaddiya w tballesh men hon?",
  },
  replace: {
    ar: "✅ فضّي وكمّل",
    en: "✅ Start new",
    fr: "✅ Recommencer",
    arabizi: "✅ Fadde w kammel",
  },
  keep: { ar: "خلّي السلّة", en: "Keep basket", fr: "Garder", arabizi: "Khalle el salle" },
  unavailable: {
    ar: "😔 «{item}» مش متوفر هلق.",
    en: '😔 "{item}" isn\'t available right now.',
    fr: "😔 « {item} » n'est pas disponible.",
    arabizi: '😔 "{item}" msh metwaffar hala2.',
  },
  basketTitle: {
    ar: "🧺 سلّتك من {vendor}:",
    en: "🧺 Your basket from {vendor}:",
    fr: "🧺 Votre panier chez {vendor} :",
    arabizi: "🧺 Sallitak men {vendor}:",
  },
  basketEmpty: {
    ar: "سلّتك فاضية.",
    en: "Your basket is empty.",
    fr: "Votre panier est vide.",
    arabizi: "Sallitak fadye.",
  },
  subtotal: { ar: "المجموع", en: "Subtotal", fr: "Sous-total", arabizi: "El majmou3" },
  estimated: {
    ar: "تقريبي، النهائي حسب الوزن",
    en: "about, final by weight",
    fr: "environ, final selon le poids",
    arabizi: "ta2ribi, el niha2e 7asab el wazn",
  },
  checkoutBtn: { ar: "✅ اطلب", en: "✅ Checkout", fr: "✅ Commander", arabizi: "✅ Otlob" },
  addMore: { ar: "➕ زيد", en: "➕ Add more", fr: "➕ Ajouter", arabizi: "➕ Zid" },
  summary: {
    ar: "📋 ملخّص طلبك من {vendor}:",
    en: "📋 Your order from {vendor}:",
    fr: "📋 Votre commande chez {vendor} :",
    arabizi: "📋 Talabak men {vendor}:",
  },
  deliveryFee: { ar: "التوصيل", en: "Delivery", fr: "Livraison", arabizi: "El tawsil" },
  deposit: {
    ar: "تأمين القنينة",
    en: "Container deposit",
    fr: "Consigne",
    arabizi: "Ta2min el 2anine",
  },
  stairs: { ar: "رسم الدرج", en: "Stairs fee", fr: "Frais d'escalier", arabizi: "Rasm el daraj" },
  total: { ar: "المجموع", en: "Total", fr: "Total", arabizi: "El majmou3" },
  pickup: {
    ar: "استلام من المحل",
    en: "Pickup from the shop",
    fr: "Retrait au magasin",
    arabizi: "Estilam men el mahal",
  },
  deliverTo: {
    ar: "التوصيل لـ {where}",
    en: "Deliver to {where}",
    fr: "Livraison à {where}",
    arabizi: "El tawsil la {where}",
  },
  payCash: {
    ar: "💵 الدفع كاش عالتسليم",
    en: "💵 Cash on delivery",
    fr: "💵 Paiement à la livraison",
    arabizi: "💵 Cash 3al tasleem",
  },
  confirm: {
    ar: "✅ أكّد الطلب",
    en: "✅ Confirm order",
    fr: "✅ Confirmer",
    arabizi: "✅ Akked el talab",
  },
  change: { ar: "✏️ غيّر", en: "✏️ Change", fr: "✏️ Modifier", arabizi: "✏️ Ghayyer" },
  cancelBasket: { ar: "🗑️ إلغاء", en: "🗑️ Cancel", fr: "🗑️ Annuler", arabizi: "🗑️ Elghe2" },
  codCap: {
    ar: "⚠️ الحدّ للدفع كاش هو {cap} للطلب ({first}). خفّف الطلب شوي.",
    en: "⚠️ Cash orders are limited to {cap} ({first}). Please make the order a bit smaller.",
    fr: "⚠️ Le paiement en espèces est limité à {cap} ({first}). Réduisez un peu la commande.",
    arabizi: "⚠️ El 7add lal cash huwwe {cap} ({first}). Khaffef el talab shway.",
  },
  firstOrder: {
    ar: "لأول طلب",
    en: "for a first order",
    fr: "pour une première commande",
    arabizi: "la awwal talab",
  },
  perOrder: { ar: "لكل طلب", en: "per order", fr: "par commande", arabizi: "la kel talab" },
  beyond: {
    ar: "😔 {vendor} ما بيوصّل لعنوانك (أبعد من {km} كم).",
    en: "😔 {vendor} doesn't deliver to your address (over {km} km).",
    fr: "😔 {vendor} ne livre pas à votre adresse (plus de {km} km).",
    arabizi: "😔 {vendor} ma bywassel la 3enwenak (ab3ad men {km} km).",
  },
  noDelivery: {
    ar: "😔 ما في محل مفتوح بيوصّل لهالموقع هلق. فيك تستلم من المحل أو تبعتلي موقع تاني.",
    en: "😔 No open place delivers to this pin right now. You can pick up from a place, or send another pin.",
    fr: "😔 Aucun endroit ouvert ne livre à cette position pour l'instant. Vous pouvez passer chercher votre commande, ou envoyer une autre position.",
    arabizi:
      "😔 Ma fi mahal maftou7 bywassel la hal location hala2. Fik testelem men el mahal aw tb3at location tene.",
  },
  pickupFrom: {
    ar: "🛍️ استلام من المحل",
    en: "🛍️ Pick up",
    fr: "🛍️ Retrait",
    arabizi: "🛍️ Estilam",
  },
  anotherPin: {
    ar: "📍 موقع تاني",
    en: "📍 Another pin",
    fr: "📍 Autre position",
    arabizi: "📍 Location tene",
  },
  pickPickup: {
    ar: "🛍️ اختار محل للاستلام (بتدفع كاش عند الاستلام):",
    en: "🛍️ Pick a place to collect from (you pay cash when you collect):",
    fr: "🛍️ Choisissez un endroit où retirer (paiement en espèces au retrait) :",
    arabizi: "🛍️ Ekhtar mahal testelem menno (bt dfa3 cash 3end el estilam):",
  },
  noPickup: {
    ar: "ما في محل قريب منك بيقبل استلام هلق. جرّب موقع تاني؟",
    en: "No place near you takes pickup orders right now. Try another pin?",
    fr: "Aucun endroit près de vous ne prend de retrait pour l'instant. Une autre position ?",
    arabizi: "Ma fi mahal 2arib menak byeb2al estilam hala2. Jarreb location tene?",
  },
  tapFailed: {
    ar: "ما قدرت كمّل هالخطوة 🙏 اختار من الأزرار:",
    en: "That step didn't go through 🙏 Please pick from the buttons:",
    fr: "Cette étape n'a pas abouti 🙏 Choisissez parmi les boutons :",
    arabizi: "Ma 2dert kammel hal khatwe 🙏 Ekhtar men el azrar:",
  },
  pickupInstead: {
    ar: "🛍️ باستلم أنا",
    en: "🛍️ I'll pick up",
    fr: "🛍️ Je passe",
    arabizi: "🛍️ Bestelem ana",
  },
  otherPlace: {
    ar: "🔎 محل تاني",
    en: "🔎 Another place",
    fr: "🔎 Autre endroit",
    arabizi: "🔎 Mahal tene",
  },
  noRoute: {
    ar: "ما قدرت احسب الطريق لعنوانك هلق 🙏 جرّب كمان مرة، أو غيّر العنوان.",
    en: "I couldn't work out the road to your address just now 🙏 Try again, or change the address.",
    fr: "Je n'ai pas pu calculer la route jusqu'à votre adresse 🙏 Réessayez, ou changez d'adresse.",
    arabizi:
      "Ma 2dert e7seb el tari2 la 3enwenak hala2 🙏 Jarreb kamen marra, aw ghayyer el 3enwen.",
  },
  btnRetry: {
    ar: "🔄 جرّب كمان مرة",
    en: "🔄 Try again",
    fr: "🔄 Réessayer",
    arabizi: "🔄 Jarreb kamen",
  },
  btnChangeAddress: {
    ar: "📍 غيّر العنوان",
    en: "📍 Change address",
    fr: "📍 Changer d'adresse",
    arabizi: "📍 Ghayyer el 3enwen",
  },
  btnHelp: { ar: "🙋 مساعدة", en: "🙋 Help", fr: "🙋 Aide", arabizi: "🙋 Mosa3ade" },
  btnBasket: { ar: "🧺 السلة", en: "🧺 Basket", fr: "🧺 Panier", arabizi: "🧺 El salle" },
  emptyQ: {
    ar: "🔄 «{item}»: عندك قنينة فاضية ترجّعها؟",
    en: '🔄 "{item}": do you have an empty to return?',
    fr: "🔄 « {item} » : avez-vous une bouteille vide à rendre ?",
    arabizi: '🔄 "{item}": 3endak 2anine fadye traje3a?',
  },
  emptyYes: { ar: "✅ إيه عندي", en: "✅ Yes", fr: "✅ Oui", arabizi: "✅ Eh 3ande" },
  emptyNo: {
    ar: "لا (مع تأمين {dep})",
    en: "No (+{dep} deposit)",
    fr: "Non (+{dep})",
    arabizi: "La (+{dep})",
  },
  upsell: {
    ar: "بتحب تزيد {item}؟",
    en: "Add {item}?",
    fr: "Ajouter {item} ?",
    arabizi: "Badak tzid {item}?",
  },
  upsellYes: { ar: "➕ زيد", en: "➕ Add", fr: "➕ Ajouter", arabizi: "➕ Zid" },
  upsellNo: { ar: "لا شكراً", en: "No thanks", fr: "Non merci", arabizi: "La merci" },
  placed: {
    ar: "🎉 بعتنا طلبك #{code} لـ {vendor}. ناطرين يقبلوه، رح خبّرك.",
    en: "🎉 Order #{code} sent to {vendor}. Waiting for them to accept; I'll update you.",
    fr: "🎉 Commande #{code} envoyée à {vendor}. En attente d'acceptation.",
    arabizi: "🎉 Ba3atna talabak #{code} la {vendor}. Natrin y2ebloh, ra7 khabbrak.",
  },
  repriced: {
    ar: "⚠️ تغيّر شي بالمنيو قبل ما تأكّد:",
    en: "⚠️ Something changed on the menu before you confirmed:",
    fr: "⚠️ Le menu a changé avant votre confirmation :",
    arabizi: "⚠️ Tghayyar shi bel menu abel ma t2akked:",
  },
  vendorPaused: {
    ar: "⏸ {vendor} وقّف الطلبات هلق. بدك محل تاني؟",
    en: "⏸ {vendor} has paused orders right now. Another place?",
    fr: "⏸ {vendor} a mis les commandes en pause. Un autre endroit ?",
    arabizi: "⏸ {vendor} wa22af el talabet hala2. Badak mahal tene?",
  },
  staleConfirm: {
    ar: "هالتأكيد قديم. هيدا الملخّص الجديد:",
    en: "That confirmation is out of date. Here's the current summary:",
    fr: "Cette confirmation n'est plus valable. Voici le récapitulatif actuel :",
    arabizi: "Hal ta2kid 2adim. Hayda el molakhkhas el jdid:",
  },
  trackNone: {
    ar: "ما عندك طلب مفتوح هلق.",
    en: "You don't have an open order right now.",
    fr: "Vous n'avez pas de commande en cours.",
    arabizi: "Ma 3endak talab maftou7 hala2.",
  },
  track: {
    ar: "📦 طلبك #{code} من {vendor}: {status}.{eta}",
    en: "📦 Order #{code} from {vendor}: {status}.{eta}",
    fr: "📦 Commande #{code} chez {vendor} : {status}.{eta}",
    arabizi: "📦 Talabak #{code} men {vendor}: {status}.{eta}",
  },
  etaLine: {
    ar: " بيوصل خلال {eta} دقيقة تقريباً.",
    en: " About {eta} min.",
    fr: " Environ {eta} min.",
    arabizi: " Ba3d {eta} d2i2a ta2riban.",
  },
  cancelAsk: {
    ar: "أكيد بدك تلغي الطلب #{code}؟",
    en: "Cancel order #{code}?",
    fr: "Annuler la commande #{code} ?",
    arabizi: "Akid badak telghe talab #{code}?",
  },
  cancelYes: {
    ar: "❌ إيه ألغي",
    en: "❌ Yes, cancel",
    fr: "❌ Oui, annuler",
    arabizi: "❌ Eh elghe",
  },
  cancelOrderBtn: {
    ar: "❌ إلغاء الطلب",
    en: "❌ Cancel order",
    fr: "❌ Annuler",
    arabizi: "❌ Elghe el talab",
  },
  cancelKeep: { ar: "لا، كمّل", en: "No, keep it", fr: "Non, garder", arabizi: "La, kammel" },
  cancelled: {
    ar: "❌ انلغى الطلب #{code}.",
    en: "❌ Order #{code} cancelled.",
    fr: "❌ Commande #{code} annulée.",
    arabizi: "❌ Nlagha talab #{code}.",
  },
  cancelRequested: {
    ar: "بعتنا طلب الإلغاء للمحل لأنو صار عم يتحضّر. رح خبّرك بالجواب.",
    en: "The shop has started preparing, so I've asked them to cancel. I'll tell you their answer.",
    fr: "La préparation a commencé : j'ai demandé l'annulation au commerçant.",
    arabizi: "Ba3atna talab el elgha2 lal mahal la2an 3am yet7addar. Ra7 khabbrak.",
  },
  tooLate: {
    ar: "الطلب صار عالطريق، ما فينا نلغيه هلق.",
    en: "Your order is already on its way, so it can't be cancelled now.",
    fr: "La commande est déjà en route : impossible d'annuler.",
    arabizi: "El talab sar 3al tari2, ma fina nelghi hala2.",
  },
  handoff: {
    ar: "👤 حوّلتك لرشيد من فريق Alo King، رح يردّ عليك هون بأقرب وقت.",
    en: "👤 I've passed you to Rasheed from the Alo King team; he'll reply here soon.",
    fr: "👤 Je vous passe à Rasheed de l'équipe Alo King, il vous répond ici rapidement.",
    arabizi: "👤 7awwaltak la Rasheed men fari2 Alo King, ra7 yrodd 3alek hon.",
  },
  handoffLate: {
    ar: "👤 حوّلتك لرشيد من فريق Alo King. منردّ من ٩ الصبح لـ ١١ بالليل، رح يردّ عليك الصبح.",
    en: "👤 I've passed you to Rasheed from the Alo King team. We answer 9:00-23:00; he'll reply in the morning.",
    fr: "👤 Je vous passe à Rasheed. Nous répondons de 9h à 23h ; il vous répondra demain matin.",
    arabizi: "👤 7awwaltak la Rasheed. Mnrodd men 9 l sob7 la 11 bel lel, ra7 yrodd 3alek l sob7.",
  },
  handoffWait: {
    ar: "رشيد رح يردّ عليك هون 🙏",
    en: "Rasheed will reply to you here 🙏",
    fr: "Rasheed vous répondra ici 🙏",
    arabizi: "Rasheed ra7 yrodd 3alek hon 🙏",
  },
  stopped: {
    ar: "✅ وقّفنا الرسايل الترويجية. طلباتك بتضل شغّالة عادي.",
    en: "✅ You won't get promotional messages any more. Your orders still work as usual.",
    fr: "✅ Vous ne recevrez plus de messages promotionnels. Vos commandes fonctionnent toujours.",
    arabizi: "✅ Wa22afna el rasayel el tarwijiye. Talabetak btdall sha8ghale.",
  },
  started: {
    ar: "✅ رح نبعتلك العروض (مرتين بالأسبوع كحدّ أقصى). ابعت STOP لتوقيفها.",
    en: "✅ You'll get offers (at most twice a week). Send STOP any time.",
    fr: "✅ Vous recevrez nos offres (2 par semaine maximum). Envoyez STOP pour arrêter.",
    arabizi: "✅ Ra7 neb3atlak el 3orod (marrtein bel jem3a max). B3at STOP la twa22efa.",
  },
  forgotHistory: {
    ar: "✅ نسيت طلباتك وتفضيلاتك. عناوينك بعدها محفوظة.",
    en: "✅ I've forgotten your order history and preferences. Your saved addresses are kept.",
    fr: "✅ J'ai oublié votre historique et vos préférences. Vos adresses sont conservées.",
    arabizi: "✅ Nsit talabetak w tafdilatak. 3anewinak ba3da mahfouza.",
  },
  deletedData: {
    ar: "✅ محينا عناوينك وتفضيلاتك وتاريخك، ووقّفنا الرسايل الترويجية. سجلات الطلبات القديمة بتبقى للمحاسبة بس.",
    en: "✅ Your addresses, preferences and history are deleted and promotions are off. Past order records stay for accounting only.",
    fr: "✅ Vos adresses, préférences et historique sont supprimés. Les commandes passées restent pour la comptabilité.",
    arabizi:
      "✅ Ma7ayna 3anewinak w tafdilatak w tarikhak. El talabet el 2adime bteb2a lal mo7asabe bas.",
  },
  confirmDelete: {
    ar: "أكيد بدك نمحي كل معلوماتك (العناوين، التفضيلات، التاريخ)؟",
    en: "Delete all your data (addresses, preferences, history)?",
    fr: "Supprimer toutes vos données (adresses, préférences, historique) ?",
    arabizi: "Akid badak nem7e kel ma3lometak?",
  },
  yesDelete: {
    ar: "🗑️ إيه امحي",
    en: "🗑️ Yes, delete",
    fr: "🗑️ Oui, supprimer",
    arabizi: "🗑️ Eh em7e",
  },
  listening: {
    ar: "🎧 عم اسمع…",
    en: "🎧 Listening…",
    fr: "🎧 J'écoute…",
    arabizi: "🎧 3am esma3…",
  },
  voiceFail: {
    ar: "ما قدرت افهم الرسالة الصوتية 🙏 فيك تكتبلي شو بدك؟",
    en: "I couldn't understand the voice note 🙏 Could you type what you'd like?",
    fr: "Je n'ai pas compris le vocal 🙏 Pouvez-vous l'écrire ?",
    arabizi: "Ma 2dert efham el voice 🙏 Fik tektebli shu badak?",
  },
  voiceLong: {
    ar: "الرسالة الصوتية طويلة كتير. فيك تختصرها أو تكتبلي؟",
    en: "That voice note is too long. Could you shorten it or type it?",
    fr: "Ce vocal est trop long. Pouvez-vous le raccourcir ou l'écrire ?",
    arabizi: "El voice tawil ktir. Fik t2asro aw tektebli?",
  },
  liveLocation: {
    ar: "ما فيني شوف الموقع المباشر 🙏 ابعتلي الموقع العادي (Send your current location).",
    en: "I can't read live locations 🙏 Please send your current location instead.",
    fr: "Je ne peux pas lire la position en direct 🙏 Envoyez votre position actuelle.",
    arabizi: "Ma fine shouf el live location 🙏 B3atle el location el 3ade.",
  },
  unsupported: {
    ar: "بفهم نص، صوت، موقع وكبسات 🙏 قلّي شو بدك.",
    en: "I understand text, voice notes, locations and taps 🙏 What would you like?",
    fr: "Je comprends le texte, les vocaux, les positions et les boutons 🙏",
    arabizi: "Bfham text, voice, location w kabsat 🙏 2elle shu badak.",
  },
  busy: {
    ar: "عذراً، صار في ضغط. فيك تعيد بكلمات قليلة؟",
    en: "Sorry, I'm a bit slow right now. Could you say it in a few words?",
    fr: "Désolé, petit ralentissement. Pouvez-vous reformuler en quelques mots ?",
    arabizi: "Sorry, fi daghet. Fik t3id b kam kelme?",
  },
  budget: {
    ar: "🙏 خلّيني حوّلك لفريق Alo King، رح يكمّلوا معك.",
    en: "🙏 Let me pass you to the Alo King team; they'll continue with you.",
    fr: "🙏 Je vous passe à l'équipe Alo King.",
    arabizi: "🙏 Khalline 7awwlak la fari2 Alo King.",
  },
  off: {
    ar: "Alo King بيرجع قريباً 🙏",
    en: "Alo King will be back shortly 🙏",
    fr: "Alo King revient bientôt 🙏",
    arabizi: "Alo King byerja3 2ariban 🙏",
  },
  done: { ar: "✅ تمام", en: "✅ Done", fr: "✅ C'est noté", arabizi: "✅ Tamem" },
  thanksRating: {
    ar: "🙏 شكراً على تقييمك!",
    en: "🙏 Thanks for rating!",
    fr: "🙏 Merci pour votre note !",
    arabizi: "🙏 Merci 3ala ta2yimak!",
  },
  sorryProblem: {
    ar: "😔 آسفين! رشيد من فريق Alo King رح يحكيك هون.",
    en: "😔 Sorry about that! Rasheed from the Alo King team will message you here.",
    fr: "😔 Désolé ! Rasheed de l'équipe Alo King vous écrit ici.",
    arabizi: "😔 Asfin! Rasheed men fari2 Alo King ra7 yehkik hon.",
  },
  pickOption: {
    ar: "اختار {group} لـ «{item}»:",
    en: 'Choose {group} for "{item}":',
    fr: "Choisissez {group} pour « {item} » :",
    arabizi: 'Na22e {group} la "{item}":',
  },
  choose: { ar: "اختار", en: "Choose", fr: "Choisir", arabizi: "Na22e" },
  options: { ar: "الخيارات", en: "Options", fr: "Options", arabizi: "El khayarat" },
};

/** Strings from this file first, then the shared customer-cards table. */
export const tr = (lang: CLang, key: string, v: V = {}): string => {
  const s = S[key]?.[lang] ?? S[key]?.en;
  return s ? s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? "")) : baseTr(lang, key, v);
};

// ---- Every error carries a way forward (DECISIONS §39.15.1) -------------------------------------------------------------
// A reply that ends a path without a button is a bug. Each error string the bot can say lists the buttons it is sent with;
// render.test.ts checks that every key turn.ts passes to say() is either here or in INFO_KEYS.
type Way = "retry" | "address" | "order" | "track" | "menu" | "basket" | "help" | "person";
const WAYS: Record<Way, [string, string]> = {
  retry: ["c:retry", "btnRetry"],
  address: ["c:new_address", "btnChangeAddress"],
  order: ["c:order", "btnOrder"],
  track: ["c:track", "btnTrack"],
  menu: ["c:menu", "btnMenu"],
  basket: ["c:basket", "btnBasket"],
  help: ["c:human", "btnHelp"],
  person: ["c:human", "btnPerson"],
};
export const ERROR_WAYS: Record<string, Way[]> = {
  noRoute: ["retry", "address", "help"],
  placePaused: ["address", "help"],
  noPlace: ["address", "help"],
  pickPlaceFirst: ["order", "help"],
  flowRetry: ["menu", "help"],
  unsupported: ["order", "track", "help"],
  busy: ["order", "track", "help"],
  voiceLong: ["order", "help"],
  voiceFail: ["order", "help"],
  unavailable: ["menu", "basket", "help"],
  vendorPaused: ["order", "help"],
  trackNone: ["order", "help"],
  tooLate: ["track", "help"],
  disputeNone: ["track", "person"],
  disputeTooLate: ["person"],
  disputeRejected: ["person"],
  disputeAlready: ["track", "person"],
  cartUnknown: ["menu", "help"],
  cartNothing: ["menu", "basket"],
  savedCartGone: ["menu", "basket"],
  giftUnreachable: ["basket", "help"],
  giftTooMany: ["order", "help"],
  giftBlocked: ["order", "help"],
  giftGone: ["order", "help"],
  recipientBad: ["help"],
  subGone: ["track", "help"],
  subCap: ["track", "help"],
  staleConfirm: ["basket", "help"],
  otherVendor: ["basket", "help"],
  confirmDelete: ["order", "help"],
  noPickup: ["address", "help"],
  basketEmpty: ["menu", "order"],
  noItem: ["menu", "basket"],
  noDietItem: ["menu", "basket"],
  codCap: ["basket", "help"],
};
/**
 * Replies that are not errors: a confirmation, a prompt the customer answers by typing or with the next message's
 * buttons, or a lead-in followed in the same turn by a message with buttons. Never an error: an error goes in ERROR_WAYS.
 */
export const INFO_KEYS = new Set([
  "savedCartDropped",
  "cartBothSaved",
  // lead-ins: the split list, the basket or checkout follows in the same turn
  "cartUnavailable",
  "cartAltRest",
  "done",
  "glad",
  "placed",
  "cancelled",
  "cancelRequested",
  "addressSaved",
  "savedPin",
  "recipientAsk",
  "recipientSaved",
  "recipientOwn",
  "consentSaved",
  "consentDeclined",
  "memDeleted",
  "forgotHistory",
  "deletedData",
  "stopped",
  "started",
  "thanksRating",
  "subAccepted",
  "subDeclined",
  "subLast",
  "giftAsked",
  "giftThanks",
  "giftNoThanks",
  "disputeCredit",
  "sorryProblem",
  "repriced",
  "cartMoreOptions",
  "memNothing",
  "listening",
  // Lines added under a message that carries the buttons, or a note after a list.
  "allergenNote",
  "estimatedNote",
  "moreItems",
  "notOnAloKingNoLink",
  // A person takes it from here: the handoff replies (the next message is theirs).
  "handoff",
  "handoffLate",
  "disputeDamaged",
  "disputeReview",
  // The kill switch: the bot is off, so no button would answer either.
  "off",
]);

/** One error string with its buttons (at most 3, Meta's limit). */
export function errorCard(to: string, lang: CLang, key: string, v: V = {}): Msg {
  const ways = ERROR_WAYS[key] ?? ["help"];
  return buttons(
    to,
    tr(lang, key, v),
    ways.slice(0, 3).map((w) => [WAYS[w][0], tr(lang, WAYS[w][1])] as [string, string]),
  );
}

/** What say() sends: an error with its buttons, anything else as plain text. */
export function sayMessage(to: string, lang: CLang, key: string, v: V = {}): Msg {
  return ERROR_WAYS[key] ? errorCard(to, lang, key, v) : text(to, tr(lang, key, v));
}

export const STATUS: Record<string, Record<CLang, string>> = {
  awaiting_payment: {
    ar: "ناطر الدفع",
    en: "waiting for payment",
    fr: "en attente de paiement",
    arabizi: "nater el daf3",
  },
  placed: {
    ar: "ناطر المحل يقبل",
    en: "waiting for the shop to accept",
    fr: "en attente d'acceptation",
    arabizi: "nater el mahal y2ebel",
  },
  accepted: { ar: "انقبل", en: "accepted", fr: "acceptée", arabizi: "n2abal" },
  preparing: {
    ar: "عم يتحضّر",
    en: "being prepared",
    fr: "en préparation",
    arabizi: "3am yet7addar",
  },
  ready: { ar: "جاهز", en: "ready", fr: "prête", arabizi: "jehez" },
  driver_assigned: {
    ar: "في سايق",
    en: "driver assigned",
    fr: "livreur assigné",
    arabizi: "fi driver",
  },
  heading_to_pickup: {
    ar: "السايق رايح يجيبو",
    en: "driver heading to the shop",
    fr: "livreur en route vers le commerce",
    arabizi: "el driver rayi7 yjibo",
  },
  at_pickup: {
    ar: "السايق بالمحل",
    en: "driver at the shop",
    fr: "livreur au commerce",
    arabizi: "el driver bel mahal",
  },
  picked_up: { ar: "عالطريق", en: "on the way", fr: "en route", arabizi: "3al tari2" },
  near_drop: { ar: "قريب منك", en: "almost there", fr: "presque arrivée", arabizi: "2arib menak" },
  arrived: { ar: "وصل لعندك", en: "at your door", fr: "à votre porte", arabizi: "wosel la 3endak" },
  delivered: { ar: "وصل", en: "delivered", fr: "livrée", arabizi: "wosel" },
  failed: { ar: "ما وصل", en: "not delivered", fr: "non livrée", arabizi: "ma wosel" },
  rejected: { ar: "انرفض", en: "declined", fr: "refusée", arabizi: "nrafad" },
  cancelled: { ar: "انلغى", en: "cancelled", fr: "annulée", arabizi: "nlagha" },
};

const name = (lang: CLang, ar?: unknown, en?: unknown) =>
  String((lang === "ar" ? (ar ?? en) : (en ?? ar)) ?? "");
export { name as localName };
export const clip = (s: string, n: number) =>
  [...s].length > n ? [...s].slice(0, n - 1).join("") + "…" : s;

// ---- Vendors ---------------------------------------------------------------------------------------------
/** A shop that is not on Alo King yet (DECISIONS §39.3), from vendor_search_unclaimed: names and village only. */
export type UnclaimedShop = {
  name_ar?: string | null;
  name_en?: string | null;
  place_ar?: string | null;
  place_en?: string | null;
  /** The counted "Ask them to join" route on the website (…/<lang>/ask/<slug>?ch=bot); null without a site_url. */
  ask_url?: string | null;
};

/**
 * "Not on Alo King yet": the customer's own WhatsApp opens on the shop with an invitation, through the website's counted
 * route. Alo King never messages the shop itself (§25). Without a link, the same words as plain text.
 */
export function notOnAloKingCard(to: string, lang: CLang, shop: UnclaimedShop): Msg {
  const place = name(lang, shop.place_ar, shop.place_en);
  const v = {
    vendor: name(lang, shop.name_ar, shop.name_en),
    where: place ? tr(lang, "inPlace", { place }) : "",
  };
  const url =
    typeof shop.ask_url === "string" && /^https:\/\/\S+$/.test(shop.ask_url) ? shop.ask_url : null;
  return url
    ? ctaUrl(to, tr(lang, "notOnAloKing", v), tr(lang, "askJoinBtn"), url)
    : text(to, tr(lang, "notOnAloKingNoLink", v));
}

export type VendorRow = {
  ref: string;
  name_ar?: string | null;
  name_en?: string | null;
  is_open: boolean;
  straight_km?: number | null;
};

export function vendorChoices(
  to: string,
  lang: CLang,
  rows: VendorRow[],
  query: string | null,
  bodyKey: "pickVendor" | "pickPickup" | "pickInstead" = "pickVendor",
): Msg[] {
  if (!rows.length)
    return [text(to, tr(lang, query ? "noVendors" : "noVendorsYet", { q: query ?? "" }))];
  const label = (r: VendorRow) => `${r.is_open ? "" : "⏸ "}${name(lang, r.name_ar, r.name_en)}`;
  if (rows.length <= 3)
    return [
      buttons(
        to,
        tr(lang, bodyKey),
        rows.map((r) => [`pv:${r.ref}`, clip(label(r), 20)] as [string, string]),
      ),
    ];
  return [
    list(to, tr(lang, bodyKey), tr(lang, "places"), [
      {
        rows: rows.slice(0, 10).map<Row>((r) => ({
          id: `pv:${r.ref}`,
          title: clip(label(r), 24),
          ...(r.is_open
            ? r.straight_km != null
              ? { description: `~${Number(r.straight_km).toFixed(1)} km` }
              : {}
            : { description: tr(lang, "closedUntil") }),
        })),
      },
    ]),
  ];
}

// ---- Menu ------------------------------------------------------------------------------------------------
export type MenuRow = {
  ref: string;
  name_ar?: string | null;
  name_en?: string | null;
  name_fr?: string | null;
  price_usd: number | string;
  pricing_unit?: string;
  orderable: boolean;
  last_few?: boolean;
  total_count?: number;
  /** Allergens the dish library suggests and the merchant has not declared (§38.3), shown as "≈ may contain". */
  hint?: string[];
};

/** Checkout at a grocery-type shop (§32.5): what to do if an item is out. */
export function substitutionAsk(to: string, lang: CLang, maxUsd: number): Msg {
  const max = Number.isInteger(maxUsd) ? String(maxUsd) : maxUsd.toFixed(2);
  return buttons(to, tr(lang, "subPrefAsk"), [
    ["sbp:call", tr(lang, "subCall")],
    ["sbp:replace", tr(lang, "subReplace", { max })],
    ["sbp:remove", tr(lang, "subRemove")],
  ]);
}

export function menuList(
  to: string,
  lang: CLang,
  vendor: string,
  rows: MenuRow[],
  query: string | null,
  samePrice = false,
  extra: {
    title?: string;
    more?: { ref: string; offset: number } | null;
    /** The "More" row's tap when it pages something other than the section list (the section's other items: mr:). */
    moreId?: string;
  } = {},
): Msg[] {
  if (!rows.length) return [errorCard(to, lang, "noItem", { q: query ?? "", vendor })];
  const items = rows.slice(0, extra.more ? 9 : 10);
  const desc = (r: MenuRow) =>
    [
      `${usd(r.price_usd)}${r.pricing_unit === "kg" ? "/kg" : ""}`,
      !r.orderable ? tr(lang, "soldOut") : r.last_few ? tr(lang, "lastFew") : "",
      r.hint?.length ? hintText(lang, r.hint) : "",
    ]
      .filter(Boolean)
      .join(" · ");
  const out: Msg[] = [
    // The badge only after the merchant confirmed it (§32.5); never an estimated saving.
    list(
      to,
      (extra.title ? `${vendor} · ${extra.title}` : tr(lang, "menuOf", { vendor })) +
        (samePrice ? `\n${tr(lang, "sameShopPrice")}` : ""),
      tr(lang, "menuButton"),
      [
        {
          rows: [
            ...items.map<Row>((r) => ({
              id: `pi:${r.ref}`,
              title: clip(
                lang === "fr"
                  ? String(r.name_fr ?? r.name_en ?? r.name_ar ?? "")
                  : name(lang, r.name_ar, r.name_en),
                24,
              ),
              description: clip(desc(r), 72),
            })),
            ...(extra.more
              ? [
                  {
                    id: extra.moreId ?? `mo:${extra.more.ref}:${extra.more.offset}`,
                    title: tr(lang, "moreBtn"),
                  },
                ]
              : []),
          ],
        },
      ],
      tr(lang, "kitchenDisclaimer"),
    ),
  ];
  // A section page shows "More" instead; the flat list says the rest is by name.
  if (!extra.more && (rows[0]?.total_count ?? rows.length) > 10 && !extra.title)
    out.push(text(to, tr(lang, "moreItems")));
  return out;
}

/**
 * Items that fit a dietary request (§32.3): each row says whether its numbers are estimated ("≈") or the
 * merchant's own ("✓"); an allergen request adds the note that allergens are as the place declared them.
 * Never says an item is safe.
 */
export function dietaryList(
  to: string,
  lang: CLang,
  vendor: string,
  rows: (MenuRow & {
    kcal?: number | string | null;
    protein_g?: number | string | null;
    nutrition_source?: string;
  })[],
  opts: { allergens: boolean },
): Msg[] {
  if (!rows.length) return [errorCard(to, lang, "noDietItem", { vendor })];
  const est = (r: (typeof rows)[number]) =>
    r.kcal === null || r.kcal === undefined
      ? ""
      : `${r.nutrition_source === "merchant_verified" ? "✓ " : "≈ "}${Math.round(Number(r.kcal))} kcal · ${Math.round(Number(r.protein_g ?? 0))}g ${tr(lang, "protein")}`;
  const out: Msg[] = [
    list(
      to,
      tr(lang, "dietMenuOf", { vendor }),
      tr(lang, "menuButton"),
      [
        {
          rows: rows.slice(0, 10).map<Row>((r) => ({
            id: `pi:${r.ref}`,
            title: clip(
              lang === "fr"
                ? String(r.name_fr ?? r.name_en ?? r.name_ar ?? "")
                : name(lang, r.name_ar, r.name_en),
              24,
            ),
            description: clip([usd(r.price_usd), est(r)].filter(Boolean).join(" · "), 72),
          })),
        },
      ],
      tr(lang, "kitchenDisclaimer"),
    ),
  ];
  if (rows.some((r) => r.nutrition_source === "estimated"))
    out.push(text(to, tr(lang, "estimatedNote")));
  if (opts.allergens) out.push(text(to, tr(lang, "allergenNote", { vendor })));
  return out;
}

export function optionList(
  to: string,
  lang: CLang,
  item: string,
  group: {
    name?: string;
    name_en?: string;
    options: {
      option_id: string;
      name?: string;
      name_en?: string;
      price_delta_usd?: number | string;
    }[];
  },
): Msg {
  return list(
    to,
    tr(lang, "pickOption", { group: name(lang, group.name, group.name_en), item }),
    tr(lang, "choose"),
    [
      {
        rows: group.options.slice(0, 10).map<Row>((o) => ({
          id: `opt:${o.option_id}`,
          title: clip(name(lang, o.name, o.name_en), 24),
          ...(Number(o.price_delta_usd ?? 0) > 0
            ? { description: `+${usd(o.price_delta_usd)}` }
            : {}),
        })),
      },
    ],
  );
}

// ---- Basket and summary --------------------------------------------------------------------------------------
type Line = {
  name: string;
  name_en?: string;
  quantity: number;
  line_total_usd?: number | string | null;
  estimated?: boolean;
  options?: string[];
};
export type Basket = {
  basket_id: string;
  vendor: string;
  vendor_en?: string;
  subtotal_usd: number | string;
  lines: Line[];
  usd_lbp_rate?: number | string;
  menu_version?: number;
};

const lineText = (lang: CLang, l: Line) =>
  `• ${l.quantity}× ${name(lang, l.name, l.name_en)}${l.options?.length ? ` (${l.options.join("، ")})` : ""}${
    l.line_total_usd != null ? ` — ${usd(l.line_total_usd)}${l.estimated ? "*" : ""}` : ""
  }`;

export function basketMessage(to: string, lang: CLang, b: Basket | null): Msg[] {
  if (!b || !b.lines?.length) return [errorCard(to, lang, "basketEmpty")];
  const vendor = name(lang, b.vendor, b.vendor_en);
  const est = b.lines.some((l) => l.estimated) ? `\n* ${tr(lang, "estimated")}` : "";
  const body = [
    tr(lang, "basketTitle", { vendor }),
    ...b.lines.map((l) => lineText(lang, l)),
    `${tr(lang, "subtotal")}: ${usd(b.subtotal_usd)}${est}`,
  ].join("\n");
  return [
    buttons(to, body, [
      ["c:checkout", tr(lang, "checkoutBtn")],
      ["c:menu", tr(lang, "addMore")],
      ["c:clear", tr(lang, "cancelBasket")],
    ]),
  ];
}

export type Quote = {
  status: string;
  basket: Basket;
  subtotal_usd?: number | string;
  delivery_fee_usd?: number | string;
  deposit_usd?: number | string;
  stairs_fee_usd?: number | string;
  total_usd?: number | string;
  total_lbp?: number | string;
  usd_lbp_rate?: number | string;
  cod_cap_usd?: number | string;
  over_cod_cap?: boolean;
  estimated?: boolean;
  limit_km?: number | string;
  pickup_enabled?: boolean;
  /** Customer credits taken off the total (disputes, §38.3). */
  credit_usd?: number | string;
  /** The shop's own offer taken off the food (§20.4, §39.7). */
  offer_usd?: number | string;
  offer?: { kind: string; percent: number | string | null } | null;
  /** below_minimum: the shop's minimum order and what is missing (§39.7). */
  min_order_usd?: number | string;
  missing_usd?: number | string;
  /** A gift order (§22.1): the recipient accepts and pays cash. */
  is_gift?: boolean;
  recipient_name?: string | null;
  /** The customer's consented allergy note, sent to the kitchen on this order (§39.6). */
  allergy_note?: string | null;
  address?: {
    place?: string;
    place_en?: string;
    building?: string | null;
    near?: { landmark?: { name_ar?: string; name_en?: string } | null } | null;
  } | null;
};

export function where(lang: CLang, a: Quote["address"]): string {
  if (!a) return "";
  const lm = a.near?.landmark ? name(lang, a.near.landmark.name_ar, a.near.landmark.name_en) : "";
  return [name(lang, a.place, a.place_en), a.building, lm ? `(${lm})` : ""]
    .filter(Boolean)
    .join(", ");
}

/** The order summary the customer confirms (§30.1.1): both totals at today's rate, then the Confirm button. */
export function summaryMessage(
  to: string,
  lang: CLang,
  q: Quote,
  newCustomer: boolean,
  cash: string | null = null,
): Msg[] {
  const b = q.basket;
  const vendor = name(lang, b.vendor, b.vendor_en);
  if (q.over_cod_cap)
    return [
      errorCard(to, lang, "codCap", {
        cap: usd(q.cod_cap_usd),
        first: tr(lang, newCustomer ? "firstOrder" : "perOrder"),
      }),
    ];
  const fee = Number(q.delivery_fee_usd ?? 0);
  const lines = [
    tr(lang, "summary", { vendor }),
    ...b.lines.map((l) => lineText(lang, l)),
    `${tr(lang, "subtotal")}: ${usd(q.subtotal_usd)}`,
    ...(q.address ? [`${tr(lang, "deliveryFee")}: ${usd(fee)}`] : []),
    ...(Number(q.deposit_usd ?? 0) > 0 ? [`${tr(lang, "deposit")}: ${usd(q.deposit_usd)}`] : []),
    ...(Number(q.stairs_fee_usd ?? 0) > 0
      ? [`${tr(lang, "stairs")}: ${usd(q.stairs_fee_usd)}`]
      : []),
    ...(Number(q.offer_usd ?? 0) > 0
      ? [
          `🏷️ ${tr(lang, "offerLine")}${q.offer?.percent ? ` ${Number(q.offer.percent)}%` : ""}: −${usd(q.offer_usd)}`,
        ]
      : []),
    ...(Number(q.credit_usd ?? 0) > 0 ? [`${tr(lang, "creditLine")}: −${usd(q.credit_usd)}`] : []),
    `*${tr(lang, "total")}: ${moneyLine(q.total_usd, q.total_lbp, q.usd_lbp_rate, lang, false)}*`,
    ...(q.estimated ? [`* ${tr(lang, "estimated")}`] : []),
    q.address
      ? `📍 ${tr(lang, "deliverTo", { where: where(lang, q.address) })}`
      : `🛍️ ${tr(lang, "pickup")}`,
    tr(lang, "payCash") + (cash ? ` (${cash})` : ""),
    ...(q.allergy_note ? [tr(lang, "allergyLine", { note: q.allergy_note })] : []),
    ...(q.is_gift && q.recipient_name ? [tr(lang, "giftLine", { name: q.recipient_name })] : []),
  ];
  return [
    buttons(to, lines.join("\n"), [
      [`cfm:${b.basket_id}:${b.menu_version ?? 0}`, tr(lang, "confirm")],
      ["c:basket", tr(lang, "change")],
      ["c:clear", tr(lang, "cancelBasket")],
    ]),
  ];
}

// ---- The button path (DECISIONS §34): main menu, sections, quantity, cash currency ----------------------------
/** The first message and the way back: three buttons that need no model. */
export function mainMenu(
  to: string,
  lang: CLang,
  bodyKey:
    | "welcome"
    | "aiOff"
    | "tapFailed"
    | "offTopic"
    | "voiceOff"
    | "catalogNone"
    | "medicine"
    | "memoryDone" = "welcome",
  v: V = {},
): Msg {
  return buttons(to, tr(lang, bodyKey, v), [
    ["c:order", tr(lang, "btnOrder")],
    ["c:track", tr(lang, "btnTrack")],
    ["c:human", tr(lang, "btnPerson")],
  ]);
}

/** Shown to a customer whose conversation is with a person: always an answer, and a way out. */
export function handoffWaitCard(to: string, lang: CLang): Msg {
  return buttons(to, tr(lang, "handoffWait"), [
    ["c:order", tr(lang, "btnMenu")],
    ["c:track", tr(lang, "btnTrack")],
  ]);
}

export type SectionRow = {
  ref: string;
  name_ar?: string | null;
  name_en?: string | null;
  items: number;
};
export function sectionList(to: string, lang: CLang, vendor: string, rows: SectionRow[]): Msg {
  return list(
    to,
    tr(lang, "sectionsOf", { vendor }),
    tr(lang, "menuButton"),
    [
      {
        rows: rows.slice(0, 10).map<Row>((r) => ({
          id: `ps:${r.ref}`,
          title: clip(name(lang, r.name_ar, r.name_en), 24),
          description: tr(lang, "itemsCount", { n: r.items }),
        })),
      },
    ],
    tr(lang, "kitchenDisclaimer"),
  );
}

/** 1 to 10 of an item, as a list. Weighed items count pieces; the merchant weighs them (§29.2). */
export function qtyList(to: string, lang: CLang, item: string, ref: string): Msg {
  return list(to, tr(lang, "qtyAsk", { item }), tr(lang, "qtyButton"), [
    {
      rows: Array.from({ length: 10 }, (_, k) => ({
        id: `qt:${ref}:${k + 1}`,
        title: String(k + 1),
      })),
    },
  ]);
}

/** USD or LBP cash, only the currencies the shop takes (vendors.cash_currencies). */
export function cashAsk(to: string, lang: CLang, allowed: string[]): Msg {
  const bs: [string, string][] = [];
  if (allowed.includes("USD")) bs.push(["cur:USD", "💵 USD"]);
  if (allowed.includes("LBP")) bs.push(["cur:LBP", "💴 LBP"]);
  return buttons(to, tr(lang, "cashAsk"), bs);
}

/** Checkout, when the shop takes both (DECISIONS §37.6): the customer says how the order reaches them. */
export function fulfilmentAsk(to: string, lang: CLang): Msg {
  return buttons(to, tr(lang, "fulfilAsk"), [
    ["c:delivery", tr(lang, "btnDelivery")],
    ["c:pickup", tr(lang, "btnPickup")],
  ]);
}

export function askPin(to: string, lang: CLang, place?: string | null): Msg {
  return locationRequest(to, place ? tr(lang, "pinFromWords", { place }) : tr(lang, "askPin"));
}

export function beyondRadius(to: string, lang: CLang, q: Quote): Msg {
  const vendor = name(lang, q.basket.vendor, q.basket.vendor_en);
  const bs: [string, string][] = [["c:find", tr(lang, "otherPlace")]];
  if (q.pickup_enabled) bs.unshift(["c:pickup", tr(lang, "pickupInstead")]);
  return buttons(to, tr(lang, "beyond", { vendor, km: q.limit_km ?? "" }), bs);
}

/** Right after the pin: nothing open delivers there. Pickup or another pin, before any basket is built. */
export function noDeliveryCard(to: string, lang: CLang): Msg {
  return buttons(to, tr(lang, "noDelivery"), [
    ["c:pickup_list", tr(lang, "pickupFrom")],
    ["c:address_list", tr(lang, "anotherPin")],
  ]);
}

export function emptyQuestion(
  to: string,
  lang: CLang,
  lineId: string,
  item: string,
  deposit: unknown,
): Msg {
  return buttons(to, tr(lang, "emptyQ", { item }), [
    [`emp:${lineId}:y`, tr(lang, "emptyYes")],
    [`emp:${lineId}:n`, clip(tr(lang, "emptyNo", { dep: usd(deposit) }), 20)],
  ]);
}

export function upsellMessage(
  to: string,
  lang: CLang,
  u: { item_id: string; name: string; name_en?: string; price_usd: number | string },
): Msg {
  return buttons(
    to,
    tr(lang, "upsell", { item: `${name(lang, u.name, u.name_en)} (${usd(u.price_usd)})` }),
    [
      [`ups:${u.item_id}`, tr(lang, "upsellYes")],
      ["c:no_upsell", tr(lang, "upsellNo")],
    ],
  );
}

export type Track = {
  order_id: string;
  code: string;
  status: string;
  vendor: string;
  vendor_en?: string;
  /** `pickup` orders are collected at the shop: their code line says "shop", never "driver" (§37.6). */
  fulfilment?: "delivery" | "pickup" | null;
  eta?: { min?: number; max?: number } | null;
  delivery_code?: string | null;
};

export function trackMessage(to: string, lang: CLang, t: Track | null): Msg[] {
  if (!t) return [errorCard(to, lang, "trackNone")];
  const eta = t.eta?.min
    ? tr(lang, "etaLine", {
        eta: t.eta.max && t.eta.max !== t.eta.min ? `${t.eta.min}-${t.eta.max}` : t.eta.min,
      })
    : "";
  const code = t.delivery_code
    ? `\n${baseTr(lang, t.fulfilment === "pickup" ? "codePickup" : "code", { dcode: t.delivery_code })}`
    : "";
  const body =
    tr(lang, "track", {
      code: t.code,
      vendor: name(lang, t.vendor, t.vendor_en),
      status: STATUS[t.status]?.[lang] ?? t.status,
      eta,
    }) + code;
  // The way to cancel without the AI (found by the staging simulator): a button while the order can still be
  // cancelled or a cancel request can still be sent (order_cancel_by_customer decides which).
  return CANCELLABLE.includes(t.status)
    ? [buttons(to, body, [["c:cancel", tr(lang, "cancelOrderBtn")]])]
    : [text(to, body)];
}

export const CANCELLABLE = [
  "awaiting_payment",
  "placed",
  "accepted",
  "preparing",
  "ready",
  "driver_assigned",
  "heading_to_pickup",
  "at_pickup",
];

export function cancelAsk(to: string, lang: CLang, t: Track): Msg {
  return buttons(to, tr(lang, "cancelAsk", { code: t.code }), [
    [`cxl:${t.order_id}`, tr(lang, "cancelYes")],
    ["c:keep", tr(lang, "cancelKeep")],
  ]);
}

// ---- Session 5c: the customer agent (DECISIONS §38.3, §39.6) ----------------------------------------------------------
const S5C: Record<string, Record<CLang, string>> = {
  welcomeBack: {
    ar: "أهلا فيك من جديد{name} 👑 بدك متل آخر مرة ({items} من {vendor})، ولا شي جديد؟",
    en: "Welcome back{name} 👑 Same as last time ({items} from {vendor}), or something new?",
    fr: "Bon retour{name} 👑 Comme la dernière fois ({items} chez {vendor}), ou autre chose ?",
    arabizi:
      "Ahla fik men jdid{name} 👑 Badak metel akher marra ({items} men {vendor}), wala shi jdid?",
  },
  btnSameAgain: {
    ar: "🔁 متل آخر مرة",
    en: "🔁 Same again",
    fr: "🔁 Pareil",
    arabizi: "🔁 Metel akher marra",
  },
  btnNewOrder: {
    ar: "🍽️ طلب جديد",
    en: "🍽️ New order",
    fr: "🍽️ Nouvelle commande",
    arabizi: "🍽️ Talab jdid",
  },
  medicine: {
    ar: "💊 ما منقدر نوصّل أدوية: طلب الأدوية عبر تطبيقات التوصيل ممنوع بلبنان. تواصل مع أقرب صيدلية إلك. بدك شي تاني؟",
    en: "💊 We can't deliver medicines: ordering them through delivery apps isn't allowed in Lebanon. Please contact a pharmacy near you. Anything else?",
    fr: "💊 Nous ne livrons pas de médicaments : les commander via une application de livraison est interdit au Liban. Contactez une pharmacie proche. Autre chose ?",
    arabizi:
      "💊 Ma mn2ader nwasel adwye: talab el adwye 3abr apps el delivery mamnou3 b Lebnen. Ehke ma3 a2rab saydaliye. Badak shi tene?",
  },
  offTopic: {
    ar: "بساعدك بس بالأكل والأغراض والتوصيل وطلباتك 🙏 اختار:",
    en: "I can only help with food, groceries, delivery and your orders 🙏 Choose:",
    fr: "Je peux seulement vous aider pour les repas, les courses, la livraison et vos commandes 🙏 Choisissez :",
    arabizi: "Bse3dak bas bel akel wel aghrad wel delivery w talabetak 🙏 Ekhtar:",
  },
  voiceOff: {
    ar: "ما فيني إسمع رسايل صوتية هلق 🙏 اكتب اسم الأكلة (مثلاً «منقوشة كشك») أو اختار:",
    en: 'I can\'t listen to voice notes yet 🙏 Type the dish (e.g. "manoushe kishk") or choose:',
    fr: "Je ne peux pas encore écouter les vocaux 🙏 Écrivez le plat (ex. « manouché kishk ») ou choisissez :",
    arabizi: 'Ma fine esma3 voice hala2 🙏 Ekteb esm el akle (metel "manoushe kishk") aw ekhtar:',
  },
  catalogNone: {
    ar: "ما لقيت «{q}» عند المحلات اللي بتوصّل لعندك 🙏 اختار:",
    en: 'I couldn\'t find "{q}" at the shops that deliver to you 🙏 Choose:',
    fr: "Je n'ai pas trouvé « {q} » chez les commerces qui livrent chez vous 🙏 Choisissez :",
    arabizi: 'Ma le2et "{q}" bel ma7alat li bwaslo la 3endak 🙏 Ekhtar:',
  },
  catalogFound: {
    ar: "هيدا اللي لقيتو لـ«{q}» (الأسعار من المحلات):",
    en: 'Here\'s what I found for "{q}" (prices from the shops):',
    fr: "Voici ce que j'ai trouvé pour « {q} » (prix des commerces) :",
    arabizi: 'Hayda li le2eto la "{q}" (el as3ar men el ma7alat):',
  },
  catalogQty: {
    ar: " الكمية: {n}.",
    en: " Quantity: {n}.",
    fr: " Quantité : {n}.",
    arabizi: " El kammiye: {n}.",
  },
  itemsBtn: { ar: "الأصناف", en: "Items", fr: "Articles", arabizi: "El asnaf" },
  kitchenDisclaimer: {
    ar: "مطبخ مشترك: ممكن آثار لأي مسبّب حساسية",
    en: "Shared kitchens: traces of any allergen possible",
    fr: "Cuisines partagées : traces d'allergènes possibles",
    arabizi: "Matbakh moshtarak: momken asar la ay allergy",
  },
  mayContain: {
    ar: "≈ ممكن فيه: {a}",
    en: "≈ may contain {a}",
    fr: "≈ peut contenir {a}",
    arabizi: "≈ momken fi {a}",
  },
  // Memory (§39.6)
  memTitle: {
    ar: "🧠 هيدا اللي بتذكّرو عنك (بس لنساعدك تطلب، ما منستعملو للإعلانات وما منعطيه للمحلات):",
    en: "🧠 Here's what I remember about you (only to help you order; never for ads, never shown to shops):",
    fr: "🧠 Voici ce que je retiens de vous (seulement pour vous aider à commander ; jamais pour la pub ni montré aux commerces) :",
    arabizi:
      "🧠 Hayda li btzakaro 3anak (bas la nse3dak totlob; ma mnesta3mlo lal i3lanet w ma mn3ateh lal ma7alat):",
  },
  memName: { ar: "• الاسم: {v}", en: "• Name: {v}", fr: "• Nom : {v}", arabizi: "• El esm: {v}" },
  memLang: {
    ar: "• اللغة: {v}",
    en: "• Language: {v}",
    fr: "• Langue : {v}",
    arabizi: "• El lugha: {v}",
  },
  memAddress: {
    ar: "• عنوان: {v}",
    en: "• Address: {v}",
    fr: "• Adresse : {v}",
    arabizi: "• 3enwen: {v}",
  },
  memUsual: {
    ar: "• عادةً بتطلب: {v}",
    en: "• You usually order: {v}",
    fr: "• Vous commandez souvent : {v}",
    arabizi: "• 3ade btotlob: {v}",
  },
  memOrders: {
    ar: "• طلبات وصلت: {v}",
    en: "• Delivered orders: {v}",
    fr: "• Commandes livrées : {v}",
    arabizi: "• Talabet wislo: {v}",
  },
  memFact: {
    ar: "• طلبت «{v}» ({d})",
    en: "• You asked for {v} ({d})",
    fr: "• Vous avez demandé : {v} ({d})",
    arabizi: "• Talabt {v} ({d})",
  },
  memNothing: {
    ar: "🧠 ما عندي شي محفوظ عنك.",
    en: "🧠 I don't have anything saved about you.",
    fr: "🧠 Je n'ai rien d'enregistré sur vous.",
    arabizi: "🧠 Ma 3ende shi ma7fouz 3anak.",
  },
  memDeleteBtn: { ar: "امحي", en: "Delete", fr: "Effacer", arabizi: "Em7i" },
  memDelAll: {
    ar: "🗑️ امحي كل شي",
    en: "🗑️ Delete everything",
    fr: "🗑️ Tout effacer",
    arabizi: "🗑️ Em7i kel shi",
  },
  memDelName: {
    ar: "امحي الاسم",
    en: "Delete my name",
    fr: "Effacer mon nom",
    arabizi: "Em7i el esm",
  },
  memDelLang: {
    ar: "امحي اللغة",
    en: "Delete my language",
    fr: "Effacer ma langue",
    arabizi: "Em7i el lugha",
  },
  memDelOrders: {
    ar: "انسى طلباتي",
    en: "Forget my orders",
    fr: "Oublier mes commandes",
    arabizi: "Insa talabete",
  },
  memDelAddrs: {
    ar: "امحي كل العناوين",
    en: "Delete all addresses",
    fr: "Effacer les adresses",
    arabizi: "Em7i kel el 3anawin",
  },
  memDelFacts: {
    ar: "امحي كل الملاحظات",
    en: "Delete all notes",
    fr: "Effacer les notes",
    arabizi: "Em7i kel el notes",
  },
  memDeleted: {
    ar: "🗑️ انمحى. ",
    en: "🗑️ Deleted. ",
    fr: "🗑️ Effacé. ",
    arabizi: "🗑️ Nma7a. ",
  },
  memoryDone: {
    ar: "🗑️ انمحى. شو بتحب تعمل؟",
    en: "🗑️ Deleted. What would you like to do?",
    fr: "🗑️ Effacé. Que voulez-vous faire ?",
    arabizi: "🗑️ Nma7a. Shu badak ta3mel?",
  },
  consentAsk: {
    ar: "ذكرت «{v}». بدك إتذكّرها لطلباتك الجاية؟ هيدي معلومة صحية: بحفظها بس إذا وافقت، وبتنبعت ملاحظة للمطبخ عطلباتك. فيك تمحيها بأي وقت.",
    en: 'You mentioned "{v}". Shall I remember it for your next orders? It\'s health information: I keep it only if you agree, and it goes to the kitchen as a note on your orders. You can delete it anytime.',
    fr: "Vous avez mentionné « {v} ». Je m'en souviens pour vos prochaines commandes ? C'est une information de santé : je la garde seulement si vous êtes d'accord, et elle va en cuisine comme note sur vos commandes. Effaçable à tout moment.",
    arabizi:
      'Zakart "{v}". Badak etzakkara la talabetak el jeye? Hayde ma3loume sa77iye: b7fazha bas iza wafa2t, w btenba3at note lal matbakh 3a talabetak. Fik tem7iya ay wa2et.',
  },
  consentYes: {
    ar: "✅ إيه، تذكّر",
    en: "✅ Yes, remember",
    fr: "✅ Oui, retenir",
    arabizi: "✅ Eh, tzakkar",
  },
  consentNo: { ar: "❌ لا", en: "❌ No", fr: "❌ Non", arabizi: "❌ La2" },
  consentSaved: {
    ar: "✅ تمام، بتذكّر. تذكّر: المحل هو اللي بيأكّد شو فيه بالأكل.",
    en: "✅ Got it, I'll remember. Remember: only the shop can confirm what's in the food.",
    fr: "✅ C'est noté. Rappel : seul le commerce peut confirmer ce que contient un plat.",
    arabizi: "✅ Tamem, btzakkar. Tzakkar: el ma7al bas fi y2akked shu fi bel akel.",
  },
  consentDeclined: {
    ar: "تمام، ما حفظتها.",
    en: "OK, I haven't saved it.",
    fr: "D'accord, je ne l'ai pas enregistré.",
    arabizi: "Tamem, ma 7afazta.",
  },
  // Address on every order and §22.1
  addressConfirm: {
    ar: "📍 منوصّل على {where}، ولا لمحل تاني اليوم؟",
    en: "📍 Deliver to {where}, or somewhere else today?",
    fr: "📍 Livraison à {where}, ou ailleurs aujourd'hui ?",
    arabizi: "📍 Nwasel 3a {where}, wala la ma7al tene lyom?",
  },
  addressPick: {
    ar: "📍 لوين منوصّل اليوم؟",
    en: "📍 Where should we deliver today?",
    fr: "📍 Où livrer aujourd'hui ?",
    arabizi: "📍 La wen nwasel lyom?",
  },
  btnDeliverHere: { ar: "✅ هون", en: "✅ Deliver here", fr: "✅ Ici", arabizi: "✅ Hon" },
  btnElsewhere: {
    ar: "📍 محل تاني",
    en: "📍 Somewhere else",
    fr: "📍 Ailleurs",
    arabizi: "📍 Ma7al tene",
  },
  addressesBtn: { ar: "العناوين", en: "Addresses", fr: "Adresses", arabizi: "El 3anawin" },
  forWhom: {
    ar: "📍 {where}. هالطلب إلك ولا لحدا تاني؟",
    en: "📍 {where}. Is this order for you or someone else?",
    fr: "📍 {where}. Cette commande est pour vous ou pour quelqu'un d'autre ?",
    arabizi: "📍 {where}. Hal talab elak wala la 7ada tene?",
  },
  btnMeSave: {
    ar: "🏠 إلي، احفظو",
    en: "🏠 Me, save it",
    fr: "🏠 Moi, garder",
    arabizi: "🏠 Ele, e7fazo",
  },
  btnMeOnce: {
    ar: "📍 إلي، هالمرة",
    en: "📍 Me, just once",
    fr: "📍 Moi, cette fois",
    arabizi: "📍 Ele, hal marra",
  },
  btnSomeoneElse: {
    ar: "🎁 لحدا تاني",
    en: "🎁 Someone else",
    fr: "🎁 Quelqu'un d'autre",
    arabizi: "🎁 La 7ada tene",
  },
  recipientAsk: {
    ar: "🎁 لمين الطلب؟ ابعت اسمو ورقم الواتساب تبعو، مثلاً «ماما 70 123 456».",
    en: '🎁 Who is it for? Send their name and WhatsApp number, e.g. "Mom 70 123 456".',
    fr: "🎁 C'est pour qui ? Envoyez son nom et son numéro WhatsApp, ex. « Maman 70 123 456 ».",
    arabizi: '🎁 La min el talab? B3at esmo w ra2m el WhatsApp, metel "Mama 70 123 456".',
  },
  recipientBad: {
    ar: "بدي اسم ورقم واتساب، مثلاً «ماما 70 123 456».",
    en: 'I need a name and a WhatsApp number, e.g. "Mom 70 123 456".',
    fr: "Il me faut un nom et un numéro WhatsApp, ex. « Maman 70 123 456 ».",
    arabizi: 'Badde esm w ra2m WhatsApp, metel "Mama 70 123 456".',
  },
  recipientOwn: {
    ar: "هيدا رقمك إنت 🙂 ابعت رقم الشخص اللي رح يستلم.",
    en: "That's your own number 🙂 Send the number of the person receiving it.",
    fr: "C'est votre propre numéro 🙂 Envoyez celui de la personne qui reçoit.",
    arabizi: "Hayda ra2mak enta 🙂 B3at ra2m li ra7 yestelem.",
  },
  recipientSaved: {
    ar: "🎁 لـ{name}. حفظتو بعناوينك.",
    en: "🎁 For {name}. Saved in your addresses.",
    fr: "🎁 Pour {name}. Enregistré dans vos adresses.",
    arabizi: "🎁 La {name}. 7afazto b 3anawinak.",
  },
  giftLine: {
    ar: "🎁 لـ{name}: بيدفع كاش عالتسليم بعد ما يقبل. دوس «أكّد» بس إذا {name} ناطر هالطلب.",
    en: "🎁 For {name}: they pay cash on delivery after accepting. Tap Confirm only if {name} expects this order.",
    fr: "🎁 Pour {name} : paiement en espèces à la livraison après acceptation. Confirmez seulement si {name} attend cette commande.",
    arabizi:
      "🎁 La {name}: byedfa3 cash 3al tasleem ba3d ma y2ebal. Dos Confirm bas iza {name} nater hal talab.",
  },
  giftAsked: {
    ar: "🎁 بعتنا الطلب لـ{name} ليقبل. بيبلّش أول ما يدوس «قبول» (خلال {min} دقيقة).",
    en: "🎁 We sent the order to {name} to accept. It starts as soon as they tap Accept (within {min} minutes).",
    fr: "🎁 Nous avons envoyé la commande à {name}. Elle démarre dès qu'il/elle accepte (sous {min} minutes).",
    arabizi:
      "🎁 Ba3atna el talab la {name} ta y2ebal. Byballesh awwal ma ydous Accept (khilel {min} d2i2a).",
  },
  giftUnreachable: {
    ar: "ما فينا نبعت لـ{name} بعد: واتساب بيسمحلنا نكتب بس للي بعتولنا خلال آخر ٢٤ ساعة. خلّي {name} يبعت «مرحبا» لهالرقم، وبعدين دوس «أكّد» مرة تانية.",
    en: 'We can\'t message {name} yet: WhatsApp lets us write only to people who messaged us in the last 24 hours. Ask {name} to send "hi" to this number, then tap Confirm again.',
    fr: "Nous ne pouvons pas encore écrire à {name} : WhatsApp ne nous permet d'écrire qu'aux personnes qui nous ont écrit ces dernières 24 h. Demandez-lui d'envoyer « bonjour » à ce numéro, puis confirmez à nouveau.",
    arabizi:
      'Ma fina neb3at la {name} ba3d: WhatsApp byesma7elna nekteb bas lal nas li ba3atulna bi akher 24 se3a. Khalli {name} yeb3at "marhaba" la hal ra2m, w ba3den dos Confirm marra tenye.',
  },
  giftTooMany: {
    ar: "بعتنا لـ{name} كذا طلب اليوم. جرّب بكرا، أو خلّي {name} يطلب لحالو.",
    en: "We've already asked {name} several times today. Try again tomorrow, or ask {name} to order directly.",
    fr: "Nous avons déjà sollicité {name} plusieurs fois aujourd'hui. Réessayez demain, ou demandez-lui de commander directement.",
    arabizi: "Ba3atna la {name} kaza talab el yom. Jarreb bokra, aw khalli {name} yotlob la7alo.",
  },
  giftBlocked: {
    ar: "رقم {name} طالب ما توصلو طلبات هدايا.",
    en: "{name}'s number has asked not to receive gift orders.",
    fr: "Le numéro de {name} a demandé à ne pas recevoir de commandes cadeaux.",
    arabizi: "Ra2m {name} taleb ma tousalo talabet hadaya.",
  },
  allergyLine: {
    ar: "⚠️ ملاحظة للمطبخ: حساسية {note}",
    en: "⚠️ Kitchen note: allergy, {note}",
    fr: "⚠️ Note pour la cuisine : allergie, {note}",
    arabizi: "⚠️ Note lal matbakh: allergy {note}",
  },
  offerLine: {
    ar: "عرض المحل",
    en: "Shop offer",
    fr: "Offre du commerce",
    arabizi: "3ard el ma7al",
  },
  belowMinimum: {
    ar: "أقل طلب بهالمحل {min} (أكل). زيد {missing} وكمّل.",
    en: "This shop's minimum order is {min} of food. Add {missing} more to continue.",
    fr: "La commande minimum de ce commerce est de {min}. Ajoutez {missing} pour continuer.",
    arabizi: "A2al talab bi hal ma7al {min}. Zid {missing} w kammel.",
  },
  creditLine: {
    ar: "رصيد من Alo King",
    en: "Alo King credit",
    fr: "Crédit Alo King",
    arabizi: "Credit men Alo King",
  },
  // Problems and refunds (§20.1, §38.3)
  problemAsk: {
    ar: "😔 آسفين! شو صار بطلبك #{code}؟",
    en: "😔 Sorry! What went wrong with order #{code}?",
    fr: "😔 Désolé ! Quel est le problème avec la commande #{code} ?",
    arabizi: "😔 Asfin! Shu sar b talabak #{code}?",
  },
  problemBtn: { ar: "المشكلة", en: "The problem", fr: "Le problème", arabizi: "El moshkle" },
  pk_missing_item: {
    ar: "صنف ناقص",
    en: "Missing item",
    fr: "Article manquant",
    arabizi: "Sanf na2es",
  },
  pk_wrong_item: { ar: "صنف غلط", en: "Wrong item", fr: "Mauvais article", arabizi: "Sanf ghalat" },
  pk_cold_food: {
    ar: "الأكل وصل بارد",
    en: "Food arrived cold",
    fr: "Plat arrivé froid",
    arabizi: "El akel wosel bared",
  },
  pk_late: { ar: "تأخّر كتير", en: "Very late", fr: "Très en retard", arabizi: "T2akhar ktir" },
  pk_damaged: {
    ar: "وصل مخربط/منكبّ",
    en: "Damaged or spilled",
    fr: "Abîmé ou renversé",
    arabizi: "Wosel mkharbat",
  },
  pk_other: { ar: "شي تاني", en: "Something else", fr: "Autre chose", arabizi: "Shi tene" },
  problemLines: { ar: "أي صنف؟", en: "Which item?", fr: "Quel article ?", arabizi: "Ayya sanf?" },
  problemQty: {
    ar: "كم {name}؟",
    en: "How many {name}?",
    fr: "Combien de {name} ?",
    arabizi: "Addeh {name}?",
  },
  disputeCredit: {
    ar: "🙏 آسفين. {amount} ({lbp} ل.ل) رصيد عطلبك الجاي (صالح {days} يوم).",
    en: "🙏 Sorry about that. {amount} ({lbp} LBP) is credited to your next order (valid {days} days).",
    fr: "🙏 Désolé. {amount} ({lbp} LBP) sont crédités sur votre prochaine commande (valable {days} jours).",
    arabizi: "🙏 Asfin. {amount} ({lbp} LBP) credit 3a talabak el jeye (sale7 {days} yom).",
  },
  disputeReview: {
    ar: "🙏 شكراً إنك خبّرتنا. حدا من Alo King رح يشوف الطلب #{code} ويرد عليك هون.",
    en: "🙏 Thanks for telling us. A person from Alo King will look at order #{code} and reply here.",
    fr: "🙏 Merci de nous l'avoir signalé. Une personne d'Alo King va examiner la commande #{code} et vous répondre ici.",
    arabizi:
      "🙏 Merci ennak khabbartna. 7ada men Alo King ra7 ychouf el talab #{code} w yrodd 3alek hon.",
  },
  disputeDamaged: {
    ar: "📷 ابعتلنا صورة للمشكلة هون، وحدا من Alo King بيقرر (منعيد الطلب أو منعطيك رصيد).",
    en: "📷 Please send a photo of the problem here; a person from Alo King decides (remake or credit).",
    fr: "📷 Envoyez une photo du problème ici ; une personne d'Alo King décide (refaire ou créditer).",
    arabizi:
      "📷 B3atelna sura lal moshkle hon, w 7ada men Alo King by2arrer (mn3id el talab aw mna3tik credit).",
  },
  disputeRejected: {
    ar: "شيّكنا الطلب #{code}: الوقت كان ضمن المتوقع، فما في رصيد هالمرة. إذا في شي تاني دوس «حدا بشري».",
    en: "We checked order #{code}: the times were within what we expect, so there's no credit this time. If something else went wrong, tap A person.",
    fr: "Nous avons vérifié la commande #{code} : les délais étaient dans la norme, pas de crédit cette fois. Autre souci ? Touchez Une personne.",
    arabizi:
      "Chayyakna el talab #{code}: el wa2et kan dimn el metwa22a3, fa ma fi credit hal marra. Iza fi shi tene dos Shakhs.",
  },
  disputeAlready: {
    ar: "خبّرتنا عن هيدا من قبل، عم نشتغل عليه.",
    en: "You've already reported this; we're on it.",
    fr: "Vous l'avez déjà signalé ; nous nous en occupons.",
    arabizi: "Khabbartna 3an hayda men 2abl, 3am neshtighel 3leh.",
  },
  disputeTooLate: {
    ar: "منقدر نستقبل المشاكل خلال {days} يوم من التسليم. دوس «حدا بشري» إذا لازم.",
    en: "Problems can be reported within {days} days of delivery. Tap A person if needed.",
    fr: "Les problèmes se signalent sous {days} jours après la livraison. Touchez Une personne si besoin.",
    arabizi:
      "Mn2ader nesta2bel el mashakel khilel {days} yom men el tasleem. Dos Shakhs iza lezem.",
  },
  disputeNone: {
    ar: "ما لقيت طلب وصلك مأخراً.",
    en: "I can't find a recently delivered order.",
    fr: "Je ne trouve pas de commande livrée récemment.",
    arabizi: "Ma le2et talab wsolak mn2akhran.",
  },
};
Object.assign(S, S5C);

const ALLERGEN_NAMES: Record<string, Record<CLang, string>> = {
  sesame: { ar: "سمسم", en: "sesame", fr: "sésame", arabizi: "semsom" },
  eggs: { ar: "بيض", en: "egg", fr: "œuf", arabizi: "bayd" },
  gluten: { ar: "غلوتين", en: "gluten", fr: "gluten", arabizi: "gluten" },
  dairy: { ar: "حليب", en: "milk", fr: "lait", arabizi: "7alib" },
  nuts: { ar: "مكسرات", en: "nuts", fr: "fruits à coque", arabizi: "mkassarat" },
  peanuts: { ar: "فول سوداني", en: "peanuts", fr: "arachides", arabizi: "fol soudene" },
  fish: { ar: "سمك", en: "fish", fr: "poisson", arabizi: "samak" },
  shellfish: { ar: "قشريات", en: "shellfish", fr: "crustacés", arabizi: "2eshriyet" },
  soy: { ar: "صويا", en: "soy", fr: "soja", arabizi: "soya" },
  mustard: { ar: "خردل", en: "mustard", fr: "moutarde", arabizi: "khardal" },
  celery: { ar: "كرفس", en: "celery", fr: "céleri", arabizi: "karafs" },
  sulphites: { ar: "كبريتات", en: "sulphites", fr: "sulfites", arabizi: "sulphites" },
  lupin: { ar: "ترمس", en: "lupin", fr: "lupin", arabizi: "tormos" },
  molluscs: { ar: "رخويات", en: "molluscs", fr: "mollusques", arabizi: "rakhwiyet" },
};
/** "≈ may contain sesame, egg" (§38.3 estimates: never a declaration, never "safe"). */
export function hintText(lang: CLang, allergens: string[]): string {
  const a = allergens.map((x) => ALLERGEN_NAMES[x]?.[lang] ?? x).join(lang === "ar" ? "، " : ", ");
  return tr(lang, "mayContain", { a });
}

const LANG_NAMES: Record<string, Record<CLang, string>> = {
  ar: { ar: "عربي", en: "Arabic", fr: "arabe", arabizi: "3arabe" },
  en: { ar: "إنكليزي", en: "English", fr: "anglais", arabizi: "english" },
  fr: { ar: "فرنساوي", en: "French", fr: "français", arabizi: "fransawe" },
  arabizi: { ar: "عربيزي", en: "Arabizi", fr: "arabizi", arabizi: "arabizi" },
};
const FACT_NAMES: Record<string, Record<CLang, string>> = {
  vegetarian: { ar: "نباتي", en: "vegetarian", fr: "végétarien", arabizi: "nabete" },
  vegan: { ar: "نباتي صرف", en: "vegan", fr: "végan", arabizi: "vegan" },
  no_pork: { ar: "بلا خنزير", en: "no pork", fr: "sans porc", arabizi: "bala khanzir" },
  no_alcohol: { ar: "بلا كحول", en: "no alcohol", fr: "sans alcool", arabizi: "bala ko7ol" },
  fasting: { ar: "صيامي", en: "siyami (fasting)", fr: "siyami (jeûne)", arabizi: "siyami" },
  halal: { ar: "حلال", en: "halal", fr: "halal", arabizi: "7alal" },
  gluten_free: { ar: "بلا غلوتين", en: "gluten-free", fr: "sans gluten", arabizi: "bala gluten" },
  no_sugar: { ar: "بلا سكر", en: "no sugar", fr: "sans sucre", arabizi: "bala sekkar" },
  allergy: { ar: "حساسية", en: "allergy", fr: "allergie", arabizi: "allergy" },
  spice: { ar: "حرّ", en: "spice", fr: "piquant", arabizi: "7arr" },
  note: { ar: "ملاحظة", en: "note", fr: "note", arabizi: "note" },
};
/** "gluten-free", "allergy: nuts": how a remembered fact is shown back, never as a diagnosis (§39.6). */
export function factLabel(lang: CLang, key: string, value: string): string {
  const k = FACT_NAMES[key]?.[lang] ?? key;
  return ["allergy", "spice", "note"].includes(key) ? `${k}: ${value}` : k;
}

export type Memory = {
  name?: string | null;
  language?: string | null;
  addresses?: {
    address_id: string;
    label?: string | null;
    place_ar?: string | null;
    place_en?: string | null;
    for_whom?: string | null;
    recipient_name?: string | null;
  }[];
  usual?: { name?: string; name_en?: string; n?: number }[];
  orders?: number;
  facts?: { key: string; value: string; since?: string; health?: boolean }[];
};

/**
 * "What do you remember about me?" (§39.6): every kept fact with its source, then a list where one tap deletes a part
 * or everything. `refs` maps the list's address rows (a1…) to address ids, kept in the session.
 */
export function memoryCard(to: string, lang: CLang, m: Memory, addrRefs: string[]): Msg[] {
  const lines: string[] = [];
  const day = (s?: string) =>
    s
      ? new Date(s).toLocaleDateString(
          lang === "ar" ? "ar-LB" : lang === "fr" ? "fr-FR" : "en-GB",
          { day: "numeric", month: "short", timeZone: "Asia/Beirut" },
        )
      : "";
  if (m.name) lines.push(tr(lang, "memName", { v: m.name }));
  if (m.language && LANG_NAMES[m.language])
    lines.push(tr(lang, "memLang", { v: LANG_NAMES[m.language][lang] }));
  for (const a of m.addresses ?? [])
    lines.push(
      tr(lang, "memAddress", {
        v: [a.label ?? a.recipient_name, name(lang, a.place_ar, a.place_en)]
          .filter(Boolean)
          .join(" – "),
      }),
    );
  if (m.usual?.length)
    lines.push(
      tr(lang, "memUsual", {
        v: m.usual
          .slice(0, 3)
          .map((u) => name(lang, u.name, u.name_en))
          .join(lang === "ar" ? "، " : ", "),
      }),
    );
  if (Number(m.orders ?? 0) > 0) lines.push(tr(lang, "memOrders", { v: m.orders }));
  for (const f of m.facts ?? [])
    lines.push(tr(lang, "memFact", { v: factLabel(lang, f.key, f.value), d: day(f.since) }));
  if (!lines.length) return [text(to, tr(lang, "memNothing"))];
  const rows: Row[] = [];
  (m.addresses ?? []).slice(0, 3).forEach((a, k) => {
    if (addrRefs[k])
      rows.push({
        id: `mem:a:${addrRefs[k]}`,
        title: clip(`🗑️ ${a.label ?? a.recipient_name ?? name(lang, a.place_ar, a.place_en)}`, 24),
      });
  });
  for (const f of (m.facts ?? []).slice(0, 3))
    rows.push({ id: `mem:f:${f.key}`, title: clip(`🗑️ ${factLabel(lang, f.key, f.value)}`, 24) });
  if (m.name) rows.push({ id: "mem:name", title: tr(lang, "memDelName") });
  if (Number(m.orders ?? 0) > 0) rows.push({ id: "mem:orders", title: tr(lang, "memDelOrders") });
  if (m.language) rows.push({ id: "mem:lang", title: tr(lang, "memDelLang") });
  rows.push({ id: "mem:all", title: tr(lang, "memDelAll") });
  return [
    list(to, clip([tr(lang, "memTitle"), ...lines].join("\n"), 1024), tr(lang, "memDeleteBtn"), [
      { rows: rows.slice(0, 10) },
    ]),
  ];
}

/** Health information is kept only after this tap (Law 81/2018, §39.6). */
export function consentAsk(to: string, lang: CLang, key: string, value: string): Msg {
  return buttons(to, tr(lang, "consentAsk", { v: factLabel(lang, key, value) }), [
    [`mok:${key}`, tr(lang, "consentYes")],
    ["mno", tr(lang, "consentNo")],
  ]);
}

/** The 2-tap greeting for a returning customer (§38.3): the same order again, or a new one. */
export function welcomeBack(
  to: string,
  lang: CLang,
  last: { vendor?: string; vendor_en?: string; items?: string; items_ar?: string },
  nm?: string | null,
): Msg {
  return buttons(
    to,
    tr(lang, "welcomeBack", {
      name: nm ? (lang === "ar" ? ` ${nm}` : ` ${nm}`) : "",
      items: clip(String((lang === "ar" ? last.items_ar : last.items) ?? last.items ?? ""), 120),
      vendor: name(lang, last.vendor, last.vendor_en),
    }),
    [
      ["c:usual", tr(lang, "btnSameAgain")],
      ["c:order", tr(lang, "btnNewOrder")],
      ["c:human", tr(lang, "btnPerson")],
    ],
  );
}

export type CatalogItem = {
  ref: string;
  item_id?: string;
  name_ar?: string | null;
  name_en?: string | null;
  price_usd: number | string;
  vendor_ar?: string | null;
  vendor_en?: string | null;
  is_open?: boolean;
  hint?: string[];
};
/** Items across every shop that delivers to the customer (§39.6), each with its server price and its shop. */
export function catalogList(
  to: string,
  lang: CLang,
  q: string,
  rows: CatalogItem[],
  qty: number | null,
  /** The results a product message did not hold (DECISIONS §39.15.2): "More results (n)" instead of "found". */
  rest = false,
): Msg {
  return list(
    to,
    (rest
      ? tr(lang, "moreResults", { q: clip(q, 40), n: rows.length })
      : tr(lang, "catalogFound", { q: clip(q, 40) })) +
      (qty ? tr(lang, "catalogQty", { n: qty }) : ""),
    tr(lang, "itemsBtn"),
    [
      {
        rows: rows.slice(0, 10).map<Row>((r) => ({
          id: `pi:${r.ref}`,
          title: clip(`${r.is_open === false ? "⏸ " : ""}${name(lang, r.name_ar, r.name_en)}`, 24),
          description: clip(
            [
              usd(r.price_usd),
              name(lang, r.vendor_ar, r.vendor_en),
              r.hint?.length ? hintText(lang, r.hint) : "",
            ]
              .filter(Boolean)
              .join(" · "),
            72,
          ),
        })),
      },
    ],
    tr(lang, "kitchenDisclaimer"),
  );
}

/** "Deliver to Home in Baakline, or somewhere else today?" on every order (§39.6). */
export function addressConfirmCard(
  to: string,
  lang: CLang,
  current: { ref: string; where: string },
  others: { ref: string; where: string }[],
): Msg {
  if (!others.length)
    return buttons(to, tr(lang, "addressConfirm", { where: current.where }), [
      [`adr:${current.ref}`, tr(lang, "btnDeliverHere")],
      ["c:new_address", tr(lang, "btnElsewhere")],
    ]);
  return list(to, tr(lang, "addressPick"), tr(lang, "addressesBtn"), [
    {
      rows: [
        {
          id: `adr:${current.ref}`,
          title: clip(`✅ ${current.where}`, 24),
          description: clip(current.where, 72),
        },
        ...others.slice(0, 8).map<Row>((o) => ({
          id: `adr:${o.ref}`,
          title: clip(o.where, 24),
          description: clip(o.where, 72),
        })),
        { id: "c:new_address", title: tr(lang, "btnElsewhere") },
      ],
    },
  ]);
}

/** §22.1: asked once per new address; the answer is remembered on the address. */
export function forWhomCard(to: string, lang: CLang, where: string): Msg {
  return buttons(to, tr(lang, "forWhom", { where }), [
    ["fw:self_save", tr(lang, "btnMeSave")],
    ["fw:self_once", tr(lang, "btnMeOnce")],
    ["fw:other", tr(lang, "btnSomeoneElse")],
  ]);
}

const PROBLEM_KINDS = [
  "missing_item",
  "wrong_item",
  "cold_food",
  "late",
  "damaged",
  "other",
] as const;
/** "What went wrong?" (§20.1, §38.3): the server decides eligibility and amount for each answer. */
export function problemList(to: string, lang: CLang, code: string): Msg {
  return list(to, tr(lang, "problemAsk", { code }), tr(lang, "problemBtn"), [
    { rows: PROBLEM_KINDS.map<Row>((k) => ({ id: `dpk:${k}`, title: tr(lang, `pk_${k}`) })) },
  ]);
}
/** "How many were missing?" for a line of more than one (the credit is per unit, §38.3). */
export function problemQtyList(
  to: string,
  lang: CLang,
  kind: "missing_item" | "wrong_item",
  line: { order_item_id: string; name_ar?: string; name_en?: string; quantity: number },
): Msg {
  const n = Math.min(Math.max(line.quantity, 1), 10);
  return list(
    to,
    clip(tr(lang, "problemQty", { name: name(lang, line.name_ar, line.name_en) }), 1024),
    tr(lang, "itemsBtn"),
    [
      {
        rows: Array.from({ length: n }, (_, k) => ({
          id: `dpl:${line.order_item_id}:${kind === "missing_item" ? "m" : "w"}:${k + 1}`,
          title: `${k + 1}`,
        })),
      },
    ],
  );
}

export function problemLinesList(
  to: string,
  lang: CLang,
  kind: "missing_item" | "wrong_item",
  lines: { order_item_id: string; name_ar?: string; name_en?: string; quantity?: number }[],
): Msg {
  return list(to, tr(lang, "problemLines"), tr(lang, "itemsBtn"), [
    {
      rows: lines.slice(0, 10).map<Row>((l) => ({
        id: `dpl:${l.order_item_id}:${kind === "missing_item" ? "m" : "w"}`,
        title: clip(`${l.quantity ?? 1}× ${name(lang, l.name_ar, l.name_en)}`, 24),
      })),
    },
  ]);
}

/** Under the shop's minimum order (§39.7): what is missing, and back to the basket. */
export function belowMinimumMessage(to: string, lang: CLang, q: Quote): Msg {
  return buttons(
    to,
    tr(lang, "belowMinimum", { min: usd(q.min_order_usd ?? 0), missing: usd(q.missing_usd ?? 0) }),
    [["c:basket", tr(lang, "change")]],
  );
}

// ---- Session 5d: the Meta catalogue and the native cart (DECISIONS §39.12) ----------------------------------------------
const S5D: Record<string, Record<CLang, string>> = {
  catalogBrowse: {
    ar: "دوس على أي صنف لتشوفو، زيد اللي بدك ياه عالسلّة 🛒، وبعدين ابعت السلّة. منأكّدلك السعر قبل ما تطلب.",
    en: "Tap an item to see it, add what you want to the cart 🛒, then send the cart. We confirm the price before you order.",
    fr: "Touchez un article pour le voir, ajoutez ce que vous voulez au panier 🛒, puis envoyez le panier. Le prix est confirmé avant la commande.",
    arabizi:
      "Dous 3a ay sanf la tchoufo, zid li badak ye 3al salle 🛒, w ba3den eb3at el salle. Mn2akkedlak el se3r abel ma totlob.",
  },
  moreOfSection: {
    ar: "باقي {section} ({n})",
    en: "More {section} ({n})",
    fr: "Autres {section} ({n})",
    arabizi: "Ba2e {section} ({n})",
  },
  moreResults: {
    ar: "كمان نتائج لـ «{q}» ({n}):",
    en: 'More results for "{q}" ({n}):',
    fr: "Autres résultats pour « {q} » ({n}) :",
    arabizi: 'Kamen natije2 la "{q}" ({n}):',
  },
  catalogFooter: {
    ar: "الأسعار من المحل، والمجموع بيتأكّد بالآخر",
    en: "Prices from the shop; the total is confirmed at the end",
    fr: "Prix du commerce ; total confirmé à la fin",
    arabizi: "El as3ar men el ma7al, w el majmou3 byet2akkad bel 2a5er",
  },
  catalogBest: {
    ar: "⭐ الأكتر طلباً. باقي المنيو بالأقسام تحت.",
    en: "⭐ The most ordered. The rest of the menu is in the sections below.",
    fr: "⭐ Les plus commandés. Le reste du menu est dans les sections ci-dessous.",
    arabizi: "⭐ El aktar talab. Ba2e el menu bel a2sem ta7t.",
  },
  bestSellers: {
    ar: "الأكتر طلباً",
    en: "Best sellers",
    fr: "Les plus commandés",
    arabizi: "El aktar talab",
  },
  catalogSearch: {
    ar: "هيدا اللي لقيناه لـ «{q}». زيد عالسلّة 🛒 وابعتها.",
    en: 'Here is what we found for "{q}". Add to the cart 🛒 and send it.',
    fr: "Voici ce que nous avons trouvé pour « {q} ». Ajoutez au panier 🛒 et envoyez-le.",
    arabizi: 'Hayda li le2ayne la "{q}". Zid 3al salle 🛒 w eb3ata.',
  },
  catalogOne: {
    ar: "لقينا «{q}». زيدو عالسلّة 🛒 وابعتها، أو كمّل تسوّق.",
    en: 'We found "{q}". Add it to the cart 🛒 and send it, or keep browsing.',
    fr: "Nous avons trouvé « {q} ». Ajoutez-le au panier 🛒 et envoyez-le, ou continuez.",
    arabizi: 'Le2ayna "{q}". Zido 3al salle 🛒 w eb3ata, aw kammel.',
  },
  cartOtherVendor: {
    ar: "سلّتك فيها أغراض من {basket}، والسلّة اللي بعتّها من {cart}. منقدر ناخد من محل واحد بالطلب. شو بتحب؟",
    en: "Your basket has items from {basket}, and the cart you sent is from {cart}. One order is from one shop. What would you like?",
    fr: "Votre panier contient des articles de {basket}, et celui que vous avez envoyé vient de {cart}. Une commande = un commerce. Que préférez-vous ?",
    arabizi:
      "Sallet-ak fiya aghrad men {basket}, w el salle li ba3atta men {cart}. Talab wa7ad men ma7al wa7ad. Chou bt7eb?",
  },
  cartUnknown: {
    ar: "😔 ما عرفنا الأصناف بهالسلّة. جرّب المنيو من جديد.",
    en: "😔 We couldn't match the items in that cart. Please open the menu again.",
    fr: "😔 Nous n'avons pas reconnu les articles de ce panier. Rouvrez le menu.",
    arabizi: "😔 Ma 3refna el asnaf b hal salle. Jarreb el menu men jdid.",
  },
  cartNothing: {
    ar: "😔 ولا صنف من السلّة متوفّر هلق. سلّتك متل ما هيّي.",
    en: "😔 None of the items in that cart is available right now. Your basket is as it was.",
    fr: "😔 Aucun article de ce panier n'est disponible pour le moment. Votre panier n'a pas changé.",
    arabizi: "😔 Wala sanf men el salle metwaffar hala2. Sallet-ak metel ma hiye.",
  },
  cartDiffs: {
    ar: "💲 تغيّرت أسعار عند المحل، وهيدي الأسعار اللي منحسب فيها:\n{lines}",
    en: "💲 Some prices changed at the shop; these are the prices we charge:\n{lines}",
    fr: "💲 Des prix ont changé chez le commerce ; voici les prix appliqués :\n{lines}",
    arabizi: "💲 Tghayyaret as3ar 3and el ma7al, hayde el as3ar li mne7seb fiya:\n{lines}",
  },
  cartDiffLine: {
    ar: "• {item}: كان ${was}، هلق ${now}",
    en: "• {item}: was ${was}, now ${now}",
    fr: "• {item} : était ${was}, maintenant ${now}",
    arabizi: "• {item}: ken ${was}, hala2 ${now}",
  },
};
Object.assign(S, S5D);

// ---- Session 5e: browsing through the bot (categories, shops near you, a shop's cover) --------------------------------
const S5E: Record<string, Record<CLang, string>> = {
  craving: {
    ar: "شو نفسك تاكل؟ 😋 اختار صنف، أو شوف كل المحلات اللي بتوصّل لـ {place}.\nأو اكتبلي شو بدك، مثلاً «٢ شاورما».",
    en: 'What are you craving? 😋 Pick a category, or see every shop that delivers to {place}.\nOr just type what you want, e.g. "2 shawarma".',
    fr: "Qu'est-ce qui vous ferait plaisir ? 😋 Choisissez une catégorie, ou voyez les commerces qui livrent à {place}.\nOu écrivez ce que vous voulez, par ex. « 2 chawarmas ».",
    arabizi:
      'Shu nafsak takol? 😋 Ekhtar sanf, aw chouf kel el ma7allet li bwasslo 3a {place}.\nAw ekteb shu badak, metel "2 shawarma".',
  },
  cravingButton: { ar: "تصفّح", en: "Browse", fr: "Parcourir", arabizi: "Tsafa7" },
  categories: { ar: "الأصناف", en: "Categories", fr: "Catégories", arabizi: "El asnaf" },
  shopsSection: { ar: "المحلات", en: "Shops", fr: "Commerces", arabizi: "El ma7allet" },
  nearRow: {
    ar: "🛵 محلات قريبة منك",
    en: "🛵 Shops near you",
    fr: "🛵 Commerces proches",
    arabizi: "🛵 Ma7allet 2arib",
  },
  nearRowDesc: {
    ar: "{n} محل بيوصّلوا لعندك",
    en: "{n} shops deliver to you",
    fr: "{n} commerces livrent chez vous",
    arabizi: "{n} ma7al bwasslo la 3endak",
  },
  shopsCount: { ar: "{n} محل", en: "{n} shops", fr: "{n} commerces", arabizi: "{n} ma7al" },
  shopCount1: { ar: "محل واحد", en: "1 shop", fr: "1 commerce", arabizi: "Ma7al wa7ad" },
  categoryShops: {
    ar: "{emoji} {name}: اختار محل.",
    en: "{emoji} {name}: pick a shop.",
    fr: "{emoji} {name} : choisissez un commerce.",
    arabizi: "{emoji} {name}: ekhtar ma7al.",
  },
  nearShops: {
    ar: "🛵 المحلات اللي بتوصّل لـ {place}، الأقرب أول:",
    en: "🛵 Shops that deliver to {place}, nearest first:",
    fr: "🛵 Commerces qui livrent à {place}, les plus proches d'abord :",
    arabizi: "🛵 El ma7allet li bwasslo 3a {place}, el a2rab awwal:",
  },
  shopsButton: { ar: "المحلات", en: "Shops", fr: "Commerces", arabizi: "El ma7allet" },
  nearest10: {
    ar: "الأقرب 10 من {n}. اكتب اسم محل لتلاقي غيرو.",
    en: "The nearest 10 of {n}. Type a shop's name to find another.",
    fr: "Les 10 plus proches sur {n}. Écrivez le nom d'un commerce pour en trouver un autre.",
    arabizi: "El a2rab 10 men {n}. Ktob esm ma7al la tla2i ghayro.",
  },
  yourPlace: { ar: "عندك", en: "you", fr: "chez vous", arabizi: "3endak" },
  closedShort: { ar: "مسكّر", en: "closed", fr: "fermé", arabizi: "msakkar" },
  browseFee: {
    ar: "توصيل {fee}",
    en: "{fee} delivery",
    fr: "livraison {fee}",
    arabizi: "tawsil {fee}",
  },
  openToday: { ar: "اليوم {h}", en: "today {h}", fr: "aujourd'hui {h}", arabizi: "lyom {h}" },
  openNow: { ar: "فاتح", en: "open now", fr: "ouvert", arabizi: "fete7" },
  open24: {
    ar: "فاتح 24 ساعة",
    en: "open 24 hours",
    fr: "ouvert 24 h/24",
    arabizi: "fete7 24 se3a",
  },
  closedToday: {
    ar: "مسكّر اليوم",
    en: "closed today",
    fr: "fermé aujourd'hui",
    arabizi: "msakkar lyom",
  },
  closedNow: { ar: "مسكّر هلق", en: "closed now", fr: "fermé", arabizi: "msakkar hala2" },
  moreSections: {
    ar: "باقي منيو {shop}: اختار قسم.",
    en: "More from {shop}: pick a section.",
    fr: "Plus de {shop} : choisissez une section.",
    arabizi: "Ba2e menu {shop}: ekhtar se2em.",
  },
  moreCategoriesRow: {
    ar: "➕ أصناف تانية",
    en: "➕ More categories",
    fr: "➕ Autres catégories",
    arabizi: "➕ Asnaf tenye",
  },
  moreCategoriesDesc: {
    ar: "{n} كمان",
    en: "{n} more",
    fr: "{n} de plus",
    arabizi: "{n} kamen",
  },
  moreSectionsRow: {
    ar: "أقسام تانية ›",
    en: "More sections ›",
    fr: "Autres sections ›",
    arabizi: "A2sem tenye ›",
  },
  sectionNext: {
    ar: "باقي «{section}» ({from}–{to} من {n}):",
    en: '"{section}" continues ({from}–{to} of {n}):',
    fr: "« {section} » continue ({from}–{to} sur {n}) :",
    arabizi: '"{section}" bikammel ({from}–{to} men {n}):',
  },
  nextItems: {
    ar: "الأصناف التالية ›",
    en: "Next items ›",
    fr: "Articles suivants ›",
    arabizi: "El asnaf el jeye ›",
  },
  searchHeader: {
    ar: "نتائج «{q}»",
    en: 'Results for "{q}"',
    fr: "Résultats pour « {q} »",
    arabizi: 'Nata2ej "{q}"',
  },
  searchShops: {
    ar: "هيدا اللي لقيناه لـ «{q}» بالمحلات اللي بتوصّل لعندك. كل طلب من محل واحد: زيد عالسلّة 🛒 من محل وابعتها.",
    en: 'Here is what we found for "{q}" at shops that deliver to you. One order is from one shop: add from one shop to the cart 🛒 and send it.',
    fr: "Voici ce que nous avons trouvé pour « {q} » chez les commerces qui vous livrent. Une commande = un commerce : ajoutez au panier 🛒 depuis un seul commerce, puis envoyez-le.",
    arabizi:
      'Hayda li le2ayne la "{q}" bel ma7allet li bwasslo la 3endak. Kel talab men ma7al wa7ad: zid 3al salle 🛒 men ma7al w eb3ata.',
  },
};
Object.assign(S, S5E);

export type BrowseCategory = { key: string; emoji: string; name: string; shops: number };

/** "What are you craving?": the categories that have shops delivering here, then "Shops near you" (10 rows at most). */
export function cravingList(
  to: string,
  lang: CLang,
  cats: BrowseCategory[],
  shops: number,
  place: string | null,
  offset = 0,
): Msg {
  // Nine rows fit beside "Shops near you"; with more categories, eight and a "More categories" row that pages on.
  const left = cats.slice(offset);
  const page = left.length > 9 ? left.slice(0, 8) : left;
  const rows = page.map<Row>((c) => ({
    id: `cat:${c.key}`,
    title: clip(`${c.emoji} ${c.name}`, 24),
    description: c.shops === 1 ? tr(lang, "shopCount1") : tr(lang, "shopsCount", { n: c.shops }),
  }));
  if (left.length > 9)
    rows.push({
      id: `cm:${offset + 8}`,
      title: tr(lang, "moreCategoriesRow"),
      description: tr(lang, "moreCategoriesDesc", { n: left.length - 8 }),
    });
  return list(
    to,
    tr(lang, "craving", { place: place || tr(lang, "yourPlace") }),
    tr(lang, "cravingButton"),
    [
      ...(rows.length ? [{ title: tr(lang, "categories"), rows }] : []),
      {
        title: tr(lang, "shopsSection"),
        rows: [
          {
            id: "c:near",
            title: tr(lang, "nearRow"),
            description: tr(lang, "nearRowDesc", { n: shops }),
          },
        ],
      },
    ],
  );
}

export type BrowseShop = {
  ref: string;
  name_ar?: string | null;
  name_en?: string | null;
  is_open: boolean;
  km?: number | null;
  fee_usd?: number | null;
  village_ar?: string | null;
  village_en?: string | null;
};

/** One row per shop: name, then delivery fee, distance and village (closed shops say so). */
export function shopRows(lang: CLang, shops: BrowseShop[]): Row[] {
  return shops.slice(0, 10).map((s) => {
    const bits = [
      s.is_open ? null : tr(lang, "closedShort"),
      s.fee_usd != null ? `🛵 ${usd(s.fee_usd)}` : null,
      s.km != null ? `${Number(s.km).toFixed(1)} km` : null,
      name(lang, s.village_ar, s.village_en),
    ].filter(Boolean);
    return {
      id: `pv:${s.ref}`,
      title: clip(`${s.is_open ? "" : "⏸ "}${name(lang, s.name_ar, s.name_en)}`, 24),
      ...(bits.length ? { description: clip(bits.join(" · "), 72) } : {}),
    };
  });
}

export function shopList(to: string, lang: CLang, body: string, shops: BrowseShop[]): Msg {
  return list(to, body, tr(lang, "shopsButton"), [{ rows: shopRows(lang, shops) }]);
}

export type ShopCard = {
  name_ar?: string | null;
  name_en?: string | null;
  village_ar?: string | null;
  village_en?: string | null;
  cuisine_ar?: string | null;
  cuisine_en?: string | null;
  cuisine_fr?: string | null;
  open_now?: boolean;
  hours_today?: string | null;
};

/** The one line under a shop's cover: cuisine · village · delivery fee · hours today. */
export function shopLine(lang: CLang, c: ShopCard, feeUsd: number | null): string {
  const cuisine =
    lang === "fr"
      ? (c.cuisine_fr ?? c.cuisine_en)
      : lang === "ar"
        ? (c.cuisine_ar ?? c.cuisine_en)
        : c.cuisine_en;
  // The seed listing writes "Closed" and "Open 24 hours" in English; every other value is a time range.
  const today = (c.hours_today ?? "").trim();
  const hours = /^closed$/i.test(today)
    ? tr(lang, "closedToday")
    : c.open_now === false
      ? tr(lang, "closedNow")
      : /^open 24 hours$/i.test(today)
        ? tr(lang, "open24")
        : today
          ? tr(lang, "openToday", { h: today })
          : null;
  return [
    cuisine,
    name(lang, c.village_ar, c.village_en),
    feeUsd != null ? `🛵 ${tr(lang, "browseFee", { fee: usd(feeUsd) })}` : null,
    hours ? `🕒 ${hours}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The sections of a shop not shown in full in its first product message, 9 at a time with "More sections". */
export function moreSectionsList(
  to: string,
  lang: CLang,
  shop: string,
  rows: { ref: string; name_ar?: string | null; name_en?: string | null; items: number }[],
  nextOffset: number | null,
): Msg {
  const shown = rows.slice(0, nextOffset != null ? 9 : 10).map<Row>((r) => ({
    id: `ps:${r.ref}`,
    title: clip(name(lang, r.name_ar, r.name_en), 24),
    description: tr(lang, "itemsCount", { n: r.items }),
  }));
  if (nextOffset != null)
    shown.push({ id: `sp:${nextOffset}`, title: tr(lang, "moreSectionsRow") });
  return list(to, tr(lang, "moreSections", { shop }), tr(lang, "menuButton"), [{ rows: shown }]);
}

/** After a section's product message when the section has more than 30 items: the next 30. */
export function sectionNextButton(
  to: string,
  lang: CLang,
  section: string,
  ref: string,
  offset: number,
  shown: number,
  total: number,
): Msg {
  return buttons(
    to,
    tr(lang, "sectionNext", { section, from: offset + 1, to: offset + shown, n: total }),
    [[`mo:${ref}:${offset + shown}`, tr(lang, "nextItems")]],
  );
}

// ---- Session 5f: carts from several shops are split, never dropped (DECISIONS §39.15.2) ----------------------------
const S5F: Record<string, Record<CLang, string>> = {
  cartSplit: {
    ar: "🛒 سلّتك فيها أغراض من {n} محلات. الطلب الواحد من محل واحد. من وين بتبلّش؟ الباقي منحفظلك ياه.",
    en: "🛒 Your cart has items from {n} shops. One order comes from one shop. Which one first? We keep the rest for you.",
    fr: "🛒 Votre panier contient des articles de {n} commerces. Une commande vient d'un seul commerce. Lequel d'abord ? Nous gardons le reste.",
    arabizi:
      "🛒 Sallet-ak fiya aghrad men {n} ma7alat. El talab men ma7al wa7ad. Men wen bet balle4? El ba2i mn7efzo-lak.",
  },
  cartSplitButton: {
    ar: "اختار المحل",
    en: "Pick a shop",
    fr: "Choisir",
    arabizi: "E5tar el ma7al",
  },
  cartSplitRow: {
    ar: "{items} صنف · ${subtotal}",
    en: "{items} item(s) · ${subtotal}",
    fr: "{items} article(s) · {subtotal} $",
    arabizi: "{items} sanf · ${subtotal}",
  },
  cartNoDelivery: {
    ar: "ما بيوصّل لـ {place}",
    en: "Doesn't deliver to {place}",
    fr: "Ne livre pas à {place}",
    arabizi: "Ma bywassel la {place}",
  },
  cartNoDeliveryHere: {
    ar: "ما بيوصّل لعنوانك",
    en: "Doesn't deliver to your address",
    fr: "Ne livre pas à votre adresse",
    arabizi: "Ma bywassel la 3enwenak",
  },
  cartAlternativeRow: {
    ar: "بدالها من {vendor} · {price}",
    en: "Instead, from {vendor} · {price}",
    fr: "À la place, chez {vendor} · {price}",
    arabizi: "Badala men {vendor} · {price}",
  },
  cartUnavailable: {
    ar: "😔 مش متوفّر هلق: {items}",
    en: "😔 Not available right now: {items}",
    fr: "😔 Pas disponible pour le moment : {items}",
    arabizi: "😔 Msh metwaffar hala2: {items}",
  },
  cartSwitch: {
    ar: "بدّل لـ {shop}",
    en: "Switch to {shop}",
    fr: "Passer à {shop}",
    arabizi: "Baddel la {shop}",
  },
  cartKeep: { ar: "خلّي {shop}", en: "Keep {shop}", fr: "Garder {shop}", arabizi: "5alli {shop}" },
  cartBoth: { ar: "الاتنين", en: "Do both", fr: "Les deux", arabizi: "El tnen" },
  cartBothSaved: {
    ar: "✅ حفظنالك سلّة {vendor}. منكمّل هلق طلب {basket}، وبعدها منعرض عليك {vendor}.",
    en: "✅ We kept your {vendor} cart. Let's finish your {basket} order first; then we'll offer {vendor}.",
    fr: "✅ Nous gardons votre panier {vendor}. Terminons d'abord la commande {basket} ; ensuite nous vous proposerons {vendor}.",
    arabizi:
      "✅ 7afazna-lak sallet {vendor}. Mnkammel hala2 talab {basket}, w ba3den mn3red 3leik {vendor}.",
  },
  savedCartOffer: {
    ar: "🛒 كمان نقّيت {items} صنف من {vendor}. بدّك تطلبن هلق؟",
    en: "🛒 You also picked {items} item(s) from {vendor}. Order them now?",
    fr: "🛒 Vous avez aussi choisi {items} article(s) chez {vendor}. Les commander maintenant ?",
    arabizi: "🛒 Kamen na22ayt {items} sanf men {vendor}. Baddak tetlbon hala2?",
  },
  savedCartNow: { ar: "اطلب هلق", en: "Order now", fr: "Commander", arabizi: "Otlob hala2" },
  savedCartLater: { ar: "لا شكراً", en: "No thanks", fr: "Non merci", arabizi: "La2 merci" },
  cartSplitMore: {
    ar: "منحفظلك كمان {n} محلات ومنعرضن عليك بعد هالطلب.",
    en: "We also keep {n} more shop(s) for you and offer them after this order.",
    fr: "Nous gardons aussi {n} autre(s) commerce(s) et vous les proposons après cette commande.",
    arabizi: "Mn7efzlak kamen {n} ma7alat w mn3red-on 3leik ba3d hal talab.",
  },
  cartAltRest: {
    ar: "{vendor} ما بيوصّل لعندك. خلّينالك منه: {items}، إذا بدّك تستلمن من المحل.",
    en: "{vendor} doesn't deliver to you. We still keep {items} from it, in case you collect them.",
    fr: "{vendor} ne livre pas chez vous. Nous gardons {items}, si vous voulez les retirer sur place.",
    arabizi:
      "{vendor} ma bywassel la 3endak. 5allayna-lak mno: {items}, iza baddak testalmon men el ma7al.",
  },
  cartAltPrice: { ar: "${price}", en: "${price}", fr: "{price} $", arabizi: "${price}" },
  cartAltQty: {
    ar: "{qty} × ${price}",
    en: "{qty} × ${price}",
    fr: "{qty} × {price} $",
    arabizi: "{qty} × ${price}",
  },
  cartSplitPaused: {
    ar: "😔 ما منوصّل لمنطقتك هلق. فيك تختار محل وتستلم منه.",
    en: "😔 We don't deliver to your area right now. You can still pick a shop and collect from it.",
    fr: "😔 Nous ne livrons pas votre zone pour l'instant. Vous pouvez choisir un commerce et retirer sur place.",
    arabizi: "😔 Ma mnwassel la mante2tak hala2. Fik t5tar ma7al w testalem mno.",
  },
  savedCartGone: {
    ar: "هالسلّة ما عادت محفوظة. فيك تبعتها من جديد من الكتالوج.",
    en: "That cart is no longer kept. You can send it again from the catalogue.",
    fr: "Ce panier n'est plus gardé. Vous pouvez le renvoyer depuis le catalogue.",
    arabizi: "Hal salle ma 3adet ma7fouza. Fik teb3ata men jdid men el catalogue.",
  },
  savedCartDropped: {
    ar: "تمام، ما منطلبها. فيك تبعتها من جديد من الكتالوج وقت ما بدّك.",
    en: "Okay, we won't order it. You can send it again from the catalogue any time.",
    fr: "D'accord, nous ne la commandons pas. Vous pouvez la renvoyer depuis le catalogue à tout moment.",
    arabizi: "Tamem, ma mnotlboba. Fik teb3ata men jdid men el catalogue wa2t ma baddak.",
  },
};
Object.assign(S, S5F);

export type SplitShop = {
  saved_cart_id: string;
  vendor: string;
  vendor_en?: string | null;
  items: number;
  subtotal_usd: number | string | null;
  delivers: boolean | null;
  alternative?: {
    item_id: string;
    vendor: string;
    vendor_en?: string | null;
    item: string;
    item_en?: string | null;
    quantity?: number | null;
    price_usd: number | string;
  } | null;
};

/**
 * "Your cart has items from 3 shops. Which one first?" (§39.15.2): one row per shop with its items and subtotal; a shop
 * that does not deliver to the customer's pin says so, and the closest shop's same dish follows it as its own row. Row
 * ids are unique (an alternative names the saved cart it stands in for), the same alternative is offered once, and the
 * shops past the list's 10 rows are named as kept for after this order: Meta refuses a list with a repeated id or more
 * than 10 rows, and a refused list would leave the cart without any reply.
 */
export function splitCartList(
  to: string,
  lang: CLang,
  shops: SplitShop[],
  place: string | null,
  placePaused = false,
): Msg {
  const rows: Row[] = [];
  const offered = new Set<string>();
  let shown = 0;
  for (const s of shops) {
    if (rows.length >= 10) break;
    const vendor = name(lang, s.vendor, s.vendor_en ?? null);
    rows.push({
      id: `sc:${s.saved_cart_id}`,
      title: clip(vendor, 24),
      description: clip(
        s.delivers === false
          ? place
            ? tr(lang, "cartNoDelivery", { place })
            : tr(lang, "cartNoDeliveryHere")
          : tr(lang, "cartSplitRow", {
              items: s.items,
              subtotal: Number(s.subtotal_usd ?? 0).toFixed(2),
            }),
        72,
      ),
    });
    shown++;
    const alt = s.delivers === false ? s.alternative : null;
    if (alt && !offered.has(alt.item_id) && rows.length < 10) {
      offered.add(alt.item_id);
      const qty = Math.min(Math.max(Math.trunc(Number(alt.quantity) || 1), 1), 50);
      rows.push({
        id: `alt:${s.saved_cart_id}:${alt.item_id}:${qty}`,
        title: clip(`🔁 ${name(lang, alt.item, alt.item_en ?? null)}`, 24),
        description: clip(
          tr(lang, "cartAlternativeRow", {
            vendor: name(lang, alt.vendor, alt.vendor_en ?? null),
            price: tr(lang, qty > 1 ? "cartAltQty" : "cartAltPrice", {
              qty,
              price: Number(alt.price_usd).toFixed(2),
            }),
          }),
          72,
        ),
      });
    }
  }
  // Only shops that can still come after this order are promised (one that does not deliver here is never offered).
  const later = shops.slice(shown).filter((s) => s.delivers !== false).length;
  const body = [
    placePaused ? tr(lang, "cartSplitPaused") : null,
    tr(lang, "cartSplit", { n: shops.length }),
    later ? tr(lang, "cartSplitMore", { n: later }) : null,
  ]
    .filter(Boolean)
    .join("\n\n");
  return list(to, body, tr(lang, "cartSplitButton"), [{ rows }]);
}

/** A cart from shop B met an open basket from shop A: Switch to B, Keep A, or Do both (A first, B saved) (§39.15.2). */
export function otherVendorCard(to: string, lang: CLang, basket: string, cart: string): Msg {
  return buttons(to, tr(lang, "cartOtherVendor", { basket, cart }), [
    ["c:cart_replace", clip(tr(lang, "cartSwitch", { shop: clip(cart, 10) }), 20)],
    ["c:keep", clip(tr(lang, "cartKeep", { shop: clip(basket, 14) }), 20)],
    ["c:cart_both", tr(lang, "cartBoth")],
  ]);
}

/** After an order: the next saved cart of a split cart, one at a time (§39.15.2). */
export function savedCartOfferCard(
  to: string,
  lang: CLang,
  next: { saved_cart_id: string; items?: number | null; vendor: string; vendor_en?: string | null },
): Msg {
  return buttons(
    to,
    tr(lang, "savedCartOffer", {
      items: next.items ?? 1,
      vendor: name(lang, next.vendor, next.vendor_en ?? null),
    }),
    [
      [`sc:${next.saved_cart_id}`, tr(lang, "savedCartNow")],
      [`scl:${next.saved_cart_id}`, tr(lang, "savedCartLater")],
    ],
  );
}
