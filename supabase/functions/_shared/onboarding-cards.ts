// Merchant onboarding on the Merchant number (DECISIONS §18.1): claim search, codes, documents and
// registration. Pure message builders in Arabic, English and French; every one passes meta-limits (test).
// The `merchant_claim` Flow (§12) is the richer path; these messages are its text fallback.

export type OLang = "ar" | "en" | "fr";

const env = (to: string) => ({
  messaging_product: "whatsapp",
  recipient_type: "individual",
  to: to.replace(/^\+/, ""),
});

export const text = (to: string, body: string) => ({ ...env(to), type: "text", text: { body } });

const buttons = (to: string, body: string, btns: { id: string; title: string }[]) => ({
  ...env(to),
  type: "interactive",
  interactive: {
    type: "button",
    body: { text: body },
    action: { buttons: btns.map((b) => ({ type: "reply", reply: b })) },
  },
});

const list = (
  to: string,
  body: string,
  button: string,
  rows: { id: string; title: string; description?: string }[],
) => ({
  ...env(to),
  type: "interactive",
  interactive: {
    type: "list",
    body: { text: body },
    action: { button, sections: [{ title: button, rows }] },
  },
});

export const BUSINESS_TYPES = [
  "restaurant",
  "fast_food",
  "cafe",
  "bakery_manakish",
  "sweets_pastry",
  "grocery_supermarket",
  "minimarket",
  "butcher",
  "produce",
  "home_essentials",
] as const;

const TYPE_LABEL: Record<OLang, Record<(typeof BUSINESS_TYPES)[number], string>> = {
  ar: {
    restaurant: "مطعم",
    fast_food: "سناك / فاست فود",
    cafe: "كافيه",
    bakery_manakish: "فرن / مناقيش",
    sweets_pastry: "حلويات",
    grocery_supermarket: "سوبرماركت",
    minimarket: "دكانة / ميني ماركت",
    butcher: "ملحمة",
    produce: "خضرة وفواكه",
    home_essentials: "مي وغاز",
  },
  en: {
    restaurant: "Restaurant",
    fast_food: "Snack / fast food",
    cafe: "Café",
    bakery_manakish: "Bakery / manakish",
    sweets_pastry: "Sweets",
    grocery_supermarket: "Supermarket",
    minimarket: "Minimarket",
    butcher: "Butcher",
    produce: "Fruit & veg",
    home_essentials: "Water & gas",
  },
  fr: {
    restaurant: "Restaurant",
    fast_food: "Snack / fast-food",
    cafe: "Café",
    bakery_manakish: "Boulangerie / manakish",
    sweets_pastry: "Pâtisserie",
    grocery_supermarket: "Supermarché",
    minimarket: "Épicerie",
    butcher: "Boucherie",
    produce: "Fruits et légumes",
    home_essentials: "Eau et gaz",
  },
};

const DOC_LABEL: Record<OLang, Record<string, string>> = {
  ar: {
    registration: "📄 السجل التجاري أو رخصة البلدية",
    company: "📄 مستند الشركة (سجل تجاري باسم الشركة)",
    sign_photo: "📷 صورة لآرمة المحل من برّا",
  },
  en: {
    registration: "📄 your commercial registration or municipal permit",
    company: "📄 the company document (commercial registration in the company name)",
    sign_photo: "📷 a photo of the shop sign from outside",
  },
  fr: {
    registration: "📄 votre registre de commerce ou permis municipal",
    company: "📄 le document de la société (registre de commerce)",
    sign_photo: "📷 une photo de l'enseigne vue de l'extérieur",
  },
};

export const T: Record<OLang, Record<string, string>> = {
  ar: {
    welcome:
      "أهلا 👋 منسجّل محلك على Alo King ببلاش.\nابعتلي *اسم المحل* (والضيعة إذا بتحب)، مثلا: «فرن الضيعة بعقلين».",
    pick: "لقيت هودي. اختار محلك:",
    pickButton: "اختار المحل",
    notListed: "مش موجود؟ منسجّلو جديد.",
    newBusiness: "➕ محل جديد",
    cancel: "إلغاء",
    nothing: "ما لقيت محل بهالإسم. فيك تكتب الإسم بطريقة تانية، أو تسجّلو جديد.",
    codeSent:
      "بعتنا رمز من ٦ أرقام على واتساب رقم المحل اللي بيخلص بـ {tail}. اكتبو هون.\nالرقم غلط أو ما عندك ياه؟ اكبس «الرقم غلط».",
    codeCall:
      "رح نتصل على رقم المحل الأرضي اللي بيخلص بـ {tail} ونقرالك رمز من ٦ أرقام. اكتبو هون.",
    wrongNumber: "الرقم غلط",
    wrongCode: "❌ الرمز غلط. باقيلك {left} محاولات.",
    expired: "⏱️ خلص وقت الرمز. اكبس على المحل مرة تانية لنبعتلك رمز جديد.",
    locked: "🔒 كتير محاولات غلط. منكمّل بالمستندات.",
    docs: "لنأكّد إنو المحل إلك، ابعتلي صورة:\n{docs}",
    docNext: "✅ وصل. هلق ابعتلي:\n{docs}",
    review:
      "✅ وصلت المستندات. رشيد من Alo King بيراجعها ومنرجعلك (عادة خلال ساعات، من ٩ الصبح لـ ١١ بالليل).",
    contested: "⚠️ في حدا تاني عم يطالب بنفس المحل، فوقّفنا الطلبين. ابعت المستندات ورشيد بيقرّر.",
    sale: "هالمحل مسجّل لصاحب تاني. إذا اشتريت المحل، ابعت مستندات الملكية ومنعطي الصاحب القديم ٧٢ ساعة ليعترض.",
    alreadyOwner: "✅ هالمحل مسجّل إلك من قبل.",
    rateLimited: "وصلت للحد اليومي للطلبات من هالرقم. جرّب بكرا أو احكي مع رشيد.",
    regType: "شو نوع المحل؟",
    regTypeButton: "نوع المحل",
    regHome: "المحل محل تجاري ولا مطبخ بيتي؟",
    shop: "🏪 محل",
    home: "🏠 مطبخ بيتي",
    regPin: "📍 ابعتلي موقع المحل (Location) من زر المشبك 📎 ← الموقع، وإنت بالمحل.",
    noRegistration: "ما عندي سجل",
    waitlist:
      "تمام. المطابخ البيتية بدها سجل تجاري حاليا، فحطّيناك على لائحة الانتظار ومنحكيك أول ما يتغيّر هالشي.",
    pending: "طلبك عم ينراجع. منرجعلك قريبا.",
    cancelled: "تمام، وقّفنا. ابعت «سجّل محلي» بأي وقت لتبلّش من جديد.",
    objected: "✅ وصل اعتراضك. وقّفنا النقل ورشيد بيتواصل معك.",
    tooLate: "ما عاد فيك تعترض على هالطلب.",
    recoverOk: "✅ تم. الرقم الجديد صار صاحب بالمحل.",
    recoverNo: "تمام، رفضنا الطلب.",
    notAllowed: "مش مسموح.",
    sendPhoto: "ابعت الصورة كصورة أو ملف PDF 📎.",
    joinAsk: "بدك تسجّل محل أو مطعم على Alo King؟",
    joinYes: "🏪 إيه، سجّل محلي",
    notAvailable: "هالمحل مش متاح للتسجيل حاليا. احكي مع رشيد إذا في غلط.",
  },
  en: {
    welcome:
      "Hi 👋 Let's list your business on Alo King, free.\nSend me the *business name* (and town if you like), e.g. “Al Day3a Bakery Baakline”.",
    pick: "I found these. Pick your business:",
    pickButton: "Pick business",
    notListed: "Not there? We'll register it as new.",
    newBusiness: "➕ New business",
    cancel: "Cancel",
    nothing: "No business with that name. Try another spelling, or register it as new.",
    codeSent:
      "We sent a 6-digit code by WhatsApp to the shop's number ending {tail}. Type it here.\nWrong number or no access to it? Tap “Wrong number”.",
    codeCall: "We'll call the shop's landline ending {tail} and read a 6-digit code. Type it here.",
    wrongNumber: "Wrong number",
    wrongCode: "❌ Wrong code. {left} tries left.",
    expired: "⏱️ The code expired. Tap your business again for a new one.",
    locked: "🔒 Too many wrong codes. Let's continue with documents.",
    docs: "To confirm the business is yours, send a photo of:\n{docs}",
    docNext: "✅ Received. Now send:\n{docs}",
    review:
      "✅ Documents received. Rasheed from Alo King reviews them and we'll get back to you (usually within hours, 9am–11pm).",
    contested:
      "⚠️ Someone else is claiming the same business, so both claims are paused. Send your documents and Rasheed decides.",
    sale: "This business is registered to another owner. If you bought it, send proof of ownership; the previous owner gets 72 hours to object.",
    alreadyOwner: "✅ This business is already yours.",
    rateLimited: "This number reached today's limit of claims. Try tomorrow or talk to Rasheed.",
    regType: "What kind of business is it?",
    regTypeButton: "Business type",
    regHome: "Is it a shop or a home kitchen?",
    shop: "🏪 Shop",
    home: "🏠 Home kitchen",
    regPin: "📍 Send me the business location: 📎 → Location, while you're there.",
    noRegistration: "No registration",
    waitlist:
      "OK. Home kitchens need a commercial registration for now, so you're on the waitlist; we'll tell you when that changes.",
    pending: "Your request is being reviewed. We'll get back to you soon.",
    cancelled: "OK, stopped. Send “join” any time to start again.",
    objected: "✅ Objection received. The transfer is paused and Rasheed will contact you.",
    tooLate: "This request can no longer be objected to.",
    recoverOk: "✅ Done. The new number is now an owner.",
    recoverNo: "OK, request refused.",
    notAllowed: "Not allowed.",
    sendPhoto: "Send it as a photo or a PDF file 📎.",
    joinAsk: "Do you want to register a shop or restaurant on Alo King?",
    joinYes: "🏪 Yes, register",
    notAvailable: "This business can't be claimed right now. Talk to Rasheed if that's wrong.",
  },
  fr: {
    welcome:
      "Bonjour 👋 Inscrivons votre commerce sur Alo King, gratuitement.\nEnvoyez le *nom du commerce* (et le village si vous voulez).",
    pick: "J'ai trouvé ceci. Choisissez votre commerce :",
    pickButton: "Choisir",
    notListed: "Pas dans la liste ? On l'inscrit comme nouveau.",
    newBusiness: "➕ Nouveau commerce",
    cancel: "Annuler",
    nothing: "Aucun commerce à ce nom. Essayez une autre orthographe, ou inscrivez-le.",
    codeSent:
      "Nous avons envoyé un code à 6 chiffres par WhatsApp au numéro du commerce finissant par {tail}. Tapez-le ici.\nMauvais numéro ? Touchez « Mauvais numéro ».",
    codeCall:
      "Nous allons appeler le fixe du commerce finissant par {tail} pour lire un code à 6 chiffres. Tapez-le ici.",
    wrongNumber: "Mauvais numéro",
    wrongCode: "❌ Code incorrect. Encore {left} essais.",
    expired: "⏱️ Le code a expiré. Touchez votre commerce pour un nouveau code.",
    locked: "🔒 Trop de codes incorrects. Continuons avec des documents.",
    docs: "Pour confirmer que le commerce est à vous, envoyez une photo de :\n{docs}",
    docNext: "✅ Reçu. Envoyez maintenant :\n{docs}",
    review:
      "✅ Documents reçus. Rasheed d'Alo King les vérifie et revient vers vous (en général en quelques heures, 9h–23h).",
    contested:
      "⚠️ Quelqu'un d'autre réclame le même commerce : les deux demandes sont suspendues. Envoyez vos documents, Rasheed décide.",
    sale: "Ce commerce est enregistré à un autre propriétaire. Si vous l'avez acheté, envoyez la preuve ; l'ancien propriétaire a 72 heures pour s'opposer.",
    alreadyOwner: "✅ Ce commerce est déjà à vous.",
    rateLimited: "Ce numéro a atteint la limite du jour. Réessayez demain ou parlez à Rasheed.",
    regType: "Quel type de commerce ?",
    regTypeButton: "Type",
    regHome: "Un commerce ou une cuisine à domicile ?",
    shop: "🏪 Commerce",
    home: "🏠 Cuisine maison",
    regPin: "📍 Envoyez la position du commerce : 📎 → Position, sur place.",
    noRegistration: "Pas de registre",
    waitlist:
      "D'accord. Les cuisines à domicile ont besoin d'un registre pour l'instant : vous êtes sur la liste d'attente.",
    pending: "Votre demande est en cours de vérification.",
    cancelled: "D'accord, arrêté. Envoyez « inscrire » pour recommencer.",
    objected: "✅ Opposition reçue. Le transfert est suspendu, Rasheed vous contacte.",
    tooLate: "Il n'est plus possible de s'opposer à cette demande.",
    recoverOk: "✅ C'est fait. Le nouveau numéro est propriétaire.",
    recoverNo: "D'accord, demande refusée.",
    notAllowed: "Non autorisé.",
    sendPhoto: "Envoyez-la en photo ou en PDF 📎.",
    joinAsk: "Voulez-vous inscrire un commerce ou un restaurant sur Alo King ?",
    joinYes: "🏪 Oui, inscrire",
    notAvailable: "Ce commerce ne peut pas être réclamé pour l'instant. Parlez à Rasheed si c'est une erreur.",
  },
};

const fill = (s: string, v: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ""));

/** The language a merchant writes in: Arabic script → ar, French cues → fr, otherwise en. */
export function guessLang(s: string | null | undefined): OLang {
  const t = String(s ?? "");
  if (/[؀-ۿ]/.test(t)) return "ar";
  if (/\b(bonjour|inscri|mon|ma|commerce|boulangerie|je|rejoindre|s'il)\b/i.test(t)) return "fr";
  if (/\b(sajjel|sajel|ma7al|m7al|bade|baddi|bde)\b/i.test(t)) return "ar";
  return "en";
}

/** "join Alo King", "claim my shop", "سجّل محلي", "inscrire mon commerce"… (zero model calls). */
export function isJoinIntent(s: string | null | undefined): boolean {
  const t = String(s ?? "")
    .toLowerCase()
    .replace(/[ّ]/g, "");
  return (
    /\b(join alo ?king|claim my (shop|business|restaurant|store|bakery)|register my (shop|business|restaurant|store|bakery)|list my (shop|business|restaurant)|add my (shop|business|restaurant))\b/.test(
      t,
    ) ||
    /\b(inscrire mon (commerce|restaurant|magasin)|ajouter mon (commerce|restaurant))\b/.test(t) ||
    /(سجل محلي|سجل مطعمي|سجل فرني|بدي سجل محل|ضيف محلي|اربط محلي|انضم ل ?(الو|ألو) ?كينغ|تسجيل محل)/.test(t) ||
    /\b(sajjel|sajel) (ma7ale|ma7alle|m7ale|mat3ame)\b/.test(t)
  );
}

// STOP is not a cancel word here: it is the marketing opt-out, which the customer bot honours (CLAUDE.md).
export const isCancel = (s: string | null | undefined) =>
  /^\s*(cancel|annuler|الغاء|إلغاء|bas|ba2a)\s*$/i.test(String(s ?? ""));

export const joinConfirm = (to: string, lang: OLang) =>
  buttons(to, T[lang].joinAsk, [
    { id: "CLM|JOIN", title: T[lang].joinYes },
    { id: "CLM|X", title: T[lang].cancel },
  ]);

export type ClaimMatch = {
  vendor_id: string;
  name: string;
  branch_label?: string | null;
  town?: string | null;
  claim_status: string;
};

export function claimSearchList(to: string, matches: ClaimMatch[], lang: OLang) {
  return list(
    to,
    T[lang].pick,
    T[lang].pickButton,
    matches.slice(0, 10).map((m) => ({
      id: `CLM|V|${m.vendor_id}`,
      title: m.name,
      description: [m.branch_label, m.town, m.claim_status === "claimed" ? "✔" : null]
        .filter(Boolean)
        .join(" · "),
    })),
  );
}

export const notListedButtons = (to: string, lang: OLang, nothing = false) =>
  buttons(to, nothing ? T[lang].nothing : T[lang].notListed, [
    { id: "CLM|NEW", title: T[lang].newBusiness },
    { id: "CLM|X", title: T[lang].cancel },
  ]);

export const codeSentCard = (
  to: string,
  claimId: string,
  tail: string,
  channel: "whatsapp" | "voice",
  lang: OLang,
) =>
  buttons(to, fill(channel === "voice" ? T[lang].codeCall : T[lang].codeSent, { tail }), [
    { id: `CLM|DOCS|${claimId}`, title: T[lang].wrongNumber },
    { id: "CLM|X", title: T[lang].cancel },
  ]);

export function documentsAsk(
  to: string,
  missing: string[],
  lang: OLang,
  opts: { next?: boolean; homeKitchen?: boolean; claimId?: string; prefix?: string } = {},
) {
  const docs = missing.map((k) => `• ${DOC_LABEL[lang][k] ?? k}`).join("\n");
  const body = `${opts.prefix ? `${opts.prefix}\n\n` : ""}${fill(opts.next ? T[lang].docNext : T[lang].docs, { docs })}\n${T[lang].sendPhoto}`;
  if (opts.homeKitchen && opts.claimId && missing.includes("registration"))
    return buttons(to, body, [
      { id: `CLM|NOREG|${opts.claimId}`, title: T[lang].noRegistration },
      { id: "CLM|X", title: T[lang].cancel },
    ]);
  return text(to, body);
}

export const businessTypeList = (to: string, lang: OLang) =>
  list(
    to,
    T[lang].regType,
    T[lang].regTypeButton,
    BUSINESS_TYPES.map((t) => ({ id: `CLM|T|${t}`, title: TYPE_LABEL[lang][t] })),
  );

export const homeKitchenButtons = (to: string, lang: OLang) =>
  buttons(to, T[lang].regHome, [
    { id: "CLM|H|0", title: T[lang].shop },
    { id: "CLM|H|1", title: T[lang].home },
  ]);

export const pinRequest = (to: string, lang: OLang) => ({
  ...env(to),
  type: "interactive",
  interactive: {
    type: "location_request_message",
    body: { text: T[lang].regPin },
    action: { name: "send_location" },
  },
});

/** The code message to the shop's own number (case A). */
export const claimCodeText = (to: string, code: string) =>
  text(
    to,
    `🔐 Alo King: رمز تأكيد المحل ${code}\nYour Alo King business code: ${code}\nلا تعطيه لحدا إلا إذا إنت عم تسجّل المحل. Share it only if you are registering this business.`,
  );

/** What the voice call says (case B): the code twice, digit by digit, in Arabic then English. */
export function claimCodeScript(code: string): string {
  const d = code.split("").join(" ");
  return `ألو كينغ. رمز تأكيد المحل هو ${d}. مرة تانية: ${d}. Alo King business code: ${d}. Again: ${d}.`;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export type OnboardingTap =
  | { a: "vendor"; vendorId: string }
  | { a: "new" }
  | { a: "join" }
  | { a: "cancel" }
  | { a: "docs"; claimId: string }
  | { a: "noreg"; claimId: string }
  | { a: "type"; type: (typeof BUSINESS_TYPES)[number] }
  | { a: "home"; home: boolean }
  | { a: "object"; claimId: string }
  | { a: "recover"; claimId: string; approve: boolean };

export function parseOnboardingTap(id: string | null | undefined): OnboardingTap | null {
  const s = String(id ?? "");
  let m: RegExpMatchArray | null;
  if ((m = s.match(new RegExp(`^CLM\\|V\\|(${UUID})$`, "i")))) return { a: "vendor", vendorId: m[1] };
  if (s === "CLM|NEW") return { a: "new" };
  if (s === "CLM|JOIN") return { a: "join" };
  if (s === "CLM|X") return { a: "cancel" };
  if ((m = s.match(new RegExp(`^CLM\\|DOCS\\|(${UUID})$`, "i")))) return { a: "docs", claimId: m[1] };
  if ((m = s.match(new RegExp(`^CLM\\|NOREG\\|(${UUID})$`, "i"))))
    return { a: "noreg", claimId: m[1] };
  if ((m = s.match(/^CLM\|T\|([a-z_]+)$/)) && (BUSINESS_TYPES as readonly string[]).includes(m[1]))
    return { a: "type", type: m[1] as (typeof BUSINESS_TYPES)[number] };
  if ((m = s.match(/^CLM\|H\|([01])$/))) return { a: "home", home: m[1] === "1" };
  if ((m = s.match(new RegExp(`^CLM\\|OBJ\\|(${UUID})$`, "i")))) return { a: "object", claimId: m[1] };
  if ((m = s.match(new RegExp(`^CLM\\|L(OK|NO)\\|(${UUID})$`, "i"))))
    return { a: "recover", claimId: m[2], approve: m[1] === "OK" };
  return null;
}

export const say = (lang: OLang, key: string, v: Record<string, string | number> = {}) =>
  fill(T[lang][key] ?? T.en[key] ?? key, v);
