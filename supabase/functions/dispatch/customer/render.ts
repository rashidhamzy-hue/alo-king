// Deterministic rendering of server results into customer messages (DECISIONS §29.3 interface choice:
// buttons for 1-3 choices, lists for 4-10, the web basket beyond 10; Flows come with session 5). Every
// amount comes from an RPC result. Pure functions, tested in render.test.ts and meta-limits.test.ts.

import {
  buttons,
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
    ar: "أهلا بـ Alo King 👑 شو بتحب تطلب اليوم؟ اكتبلي أو ابعتلي صوت، مثلاً «بدي ٢ شاورما» أو «شي طيب بعقلين».",
    en: 'Welcome to Alo King 👑 What would you like today? Type or send a voice note, e.g. "2 shawarma" or "pizza near me".',
    fr: "Bienvenue chez Alo King 👑 Que voulez-vous commander ? Écrivez ou envoyez un vocal, par ex. « 2 shawarmas ».",
    arabizi:
      'Ahla w sahla b Alo King 👑 Shu badak totlob lyom? Ekteb aw b3at voice, metel "badde 2 shawarma".',
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
    ar: "ما قدرت احسب الطريق لعنوانك هلق. جرّب بعد شوي.",
    en: "I couldn't work out the road route to your address right now. Please try again shortly.",
    fr: "Je n'ai pas pu calculer l'itinéraire. Réessayez dans un instant.",
    arabizi: "Ma 2dert e7seb el tari2 la 3enwenak hala2. Jarreb ba3d shway.",
  },
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
const clip = (s: string, n: number) =>
  [...s].length > n ? [...s].slice(0, n - 1).join("") + "…" : s;

// ---- Vendors ---------------------------------------------------------------------------------------------
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
): Msg[] {
  if (!rows.length)
    return [text(to, tr(lang, query ? "noVendors" : "noVendorsYet", { q: query ?? "" }))];
  const label = (r: VendorRow) => `${r.is_open ? "" : "⏸ "}${name(lang, r.name_ar, r.name_en)}`;
  if (rows.length <= 3)
    return [
      buttons(
        to,
        tr(lang, "pickVendor"),
        rows.map((r) => [`pv:${r.ref}`, clip(label(r), 20)] as [string, string]),
      ),
    ];
  return [
    list(to, tr(lang, "pickVendor"), tr(lang, "places"), [
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
};

export function menuList(
  to: string,
  lang: CLang,
  vendor: string,
  rows: MenuRow[],
  query: string | null,
): Msg[] {
  if (!rows.length) return [text(to, tr(lang, "noItem", { q: query ?? "", vendor }))];
  const items = rows.slice(0, 10);
  const desc = (r: MenuRow) =>
    [
      `${usd(r.price_usd)}${r.pricing_unit === "kg" ? "/kg" : ""}`,
      !r.orderable ? tr(lang, "soldOut") : r.last_few ? tr(lang, "lastFew") : "",
    ]
      .filter(Boolean)
      .join(" · ");
  const out: Msg[] = [
    list(to, tr(lang, "menuOf", { vendor }), tr(lang, "menuButton"), [
      {
        rows: items.map<Row>((r) => ({
          id: `pi:${r.ref}`,
          title: clip(
            lang === "fr"
              ? String(r.name_fr ?? r.name_en ?? r.name_ar ?? "")
              : name(lang, r.name_ar, r.name_en),
            24,
          ),
          description: clip(desc(r), 72),
        })),
      },
    ]),
  ];
  if ((rows[0]?.total_count ?? rows.length) > 10) out.push(text(to, tr(lang, "moreItems")));
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
  if (!b || !b.lines?.length) return [text(to, tr(lang, "basketEmpty"))];
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
export function summaryMessage(to: string, lang: CLang, q: Quote, newCustomer: boolean): Msg[] {
  const b = q.basket;
  const vendor = name(lang, b.vendor, b.vendor_en);
  if (q.over_cod_cap)
    return [
      text(
        to,
        tr(lang, "codCap", {
          cap: usd(q.cod_cap_usd),
          first: tr(lang, newCustomer ? "firstOrder" : "perOrder"),
        }),
      ),
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
    `*${tr(lang, "total")}: ${moneyLine(q.total_usd, q.total_lbp, q.usd_lbp_rate, lang, false)}*`,
    ...(q.estimated ? [`* ${tr(lang, "estimated")}`] : []),
    q.address
      ? `📍 ${tr(lang, "deliverTo", { where: where(lang, q.address) })}`
      : `🛍️ ${tr(lang, "pickup")}`,
    tr(lang, "payCash"),
  ];
  return [
    buttons(to, lines.join("\n"), [
      [`cfm:${b.basket_id}:${b.menu_version ?? 0}`, tr(lang, "confirm")],
      ["c:basket", tr(lang, "change")],
      ["c:clear", tr(lang, "cancelBasket")],
    ]),
  ];
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
  eta?: { min?: number; max?: number } | null;
  delivery_code?: string | null;
};

export function trackMessage(to: string, lang: CLang, t: Track | null): Msg[] {
  if (!t) return [text(to, tr(lang, "trackNone"))];
  const eta = t.eta?.min
    ? tr(lang, "etaLine", {
        eta: t.eta.max && t.eta.max !== t.eta.min ? `${t.eta.min}-${t.eta.max}` : t.eta.min,
      })
    : "";
  const code = t.delivery_code ? `\n${baseTr(lang, "code", { dcode: t.delivery_code })}` : "";
  return [
    text(
      to,
      tr(lang, "track", {
        code: t.code,
        vendor: name(lang, t.vendor, t.vendor_en),
        status: STATUS[t.status]?.[lang] ?? t.status,
        eta,
      }) + code,
    ),
  ];
}

export function cancelAsk(to: string, lang: CLang, t: Track): Msg {
  return buttons(to, tr(lang, "cancelAsk", { code: t.code }), [
    [`cxl:${t.order_id}`, tr(lang, "cancelYes")],
    ["c:keep", tr(lang, "cancelKeep")],
  ]);
}
