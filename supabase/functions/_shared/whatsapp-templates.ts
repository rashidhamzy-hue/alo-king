// WhatsApp message templates (DECISIONS §3, §6, §32.1, §39.8): one source of truth for what is submitted to
// Meta (scripts/kapso/templates.ts reads it) and for what dispatch sends outside the 24-hour window. Templates
// belong to the WhatsApp business account (WABA), so every number on it can send them once Meta approves.
//
// Rules kept here (checked by whatsapp-templates.test.ts and meta-limits.test.ts, from Meta's template guide):
// - names are lowercase letters, digits and underscores; languages are ar, en and fr (Arabizi is not a template
//   language: Arabizi customers get the Arabic one);
// - the body has at most 1024 characters, numbered variables {{1}}..{{n}} in order, never at the very start
//   or end and never two side by side, and an example for each; the footer has no variable and at most 60;
// - quick-reply buttons only (at most 3 here, 25 characters each). A tap comes back as a `button` message whose
//   payload we set at send time, so it lands on the same handler as our own interactive cards and reopens the
//   24-hour window. No URL buttons: their domain is fixed at approval and aloking.com is not owned yet (#74);
// - marketing templates carry a "Stop promotions" button and STOP in the text (§18.3); they go only to
//   customers who opted in (broadcasts.ts).
// Authentication (the claim code) is Meta's fixed format: its body is written by Meta, we only send the code.

export type TemplateLang = "ar" | "en" | "fr";
export const TEMPLATE_LANGS: TemplateLang[] = ["ar", "en", "fr"];
export type TemplateCategory = "UTILITY" | "MARKETING" | "AUTHENTICATION";

export type TemplateDef = {
  name: string;
  category: TemplateCategory;
  /** What it replaces outside the window: the customer outbox kind, the outbox purpose, or a named use. */
  key: string;
  audience: "customer" | "merchant";
  /** The variables, in order, by name (the senders pass an object; the builder orders it). */
  params: string[];
  body: Record<TemplateLang, string>;
  footer?: Record<TemplateLang, string>;
  /** Button titles; the payload of each is chosen by the sender (one per button, same order). */
  buttons?: Record<TemplateLang, string[]>;
  example: Record<string, string>;
};

const FOOTER: Record<TemplateLang, string> = {
  ar: "ألو كينغ · Alo King",
  en: "Alo King · ألو كينغ",
  fr: "Alo King · ألو كينغ",
};
const MKT_FOOTER: Record<TemplateLang, string> = {
  ar: "لإيقاف العروض: اكتب STOP",
  en: "Reply STOP to stop promotions",
  fr: "Répondez STOP pour ne plus en recevoir",
};

export const TEMPLATES: TemplateDef[] = [
  {
    name: "alo_order_confirmed",
    category: "UTILITY",
    key: "accepted",
    audience: "customer",
    params: ["code", "vendor", "eta", "total"],
    body: {
      ar: "تم تأكيد طلبك رقم {{1}} من {{2}}. بيكون جاهز خلال {{3}}. المجموع: {{4}}، الدفع كاش عند الاستلام. اضغط تحت لتتابع طلبك.",
      en: "Your order #{{1}} from {{2}} is confirmed. It will be ready in {{3}}. Total: {{4}}, cash on delivery. Tap below to follow your order.",
      fr: "Votre commande n°{{1}} chez {{2}} est confirmée. Elle sera prête dans {{3}}. Total : {{4}}, paiement en espèces à la livraison. Touchez ci-dessous pour la suivre.",
    },
    footer: FOOTER,
    buttons: { ar: ["تابع طلبي"], en: ["Track my order"], fr: ["Suivre ma commande"] },
    example: {
      code: "4821",
      vendor: "Alo Test Grill",
      eta: "25-35 min",
      total: "$12.50 / 1,118,750 LBP",
    },
  },
  {
    name: "alo_order_on_the_way",
    category: "UTILITY",
    key: "on_the_way",
    audience: "customer",
    params: ["code", "eta"],
    body: {
      ar: "طلبك رقم {{1}} صار عالطريق، وبيوصل خلال {{2}} تقريباً. اضغط تحت لتتابعه أو لتحكي معنا.",
      en: "Your order #{{1}} is on the way and should arrive in about {{2}}. Tap below to track it or to reach us.",
      fr: "Votre commande n°{{1}} est en route et devrait arriver dans environ {{2}}. Touchez ci-dessous pour la suivre ou nous joindre.",
    },
    footer: FOOTER,
    buttons: { ar: ["تابع طلبي"], en: ["Track my order"], fr: ["Suivre ma commande"] },
    example: { code: "4821", eta: "10-15 min" },
  },
  {
    name: "alo_order_delivered",
    category: "UTILITY",
    key: "delivered",
    audience: "customer",
    params: ["code", "vendor"],
    body: {
      ar: "وصل طلبك رقم {{1}} من {{2}}. كيف كان الأكل؟ اختار تقييم تحت، بيساعد المحل.",
      en: "Your order #{{1}} from {{2}} was delivered. How was the food? Pick a rating below; it helps the shop.",
      fr: "Votre commande n°{{1}} de {{2}} a été livrée. C'était comment ? Choisissez une note ci-dessous, cela aide le commerce.",
    },
    footer: FOOTER,
    buttons: {
      ar: ["ممتاز ⭐⭐⭐⭐⭐", "مقبول ⭐⭐⭐", "في مشكلة"],
      en: ["Great ⭐⭐⭐⭐⭐", "OK ⭐⭐⭐", "A problem"],
      fr: ["Excellent ⭐⭐⭐⭐⭐", "Correct ⭐⭐⭐", "Un problème"],
    },
    example: { code: "4821", vendor: "Alo Test Grill" },
  },
  {
    name: "alo_gift_request",
    category: "UTILITY",
    key: "gift_request",
    audience: "customer",
    params: ["sender", "vendor", "total"],
    body: {
      ar: "مرحبا، {{1}} بدو يبعتلك طلب من {{2}} عبر ألو كينغ: المجموع {{3}}، بيندفع كاش عند الباب. ما منطلب شي إلا إذا وافقت.",
      en: "Hello, {{1}} would like to send you an order from {{2}} through Alo King. The total is {{3}}, paid in cash at the door. Nothing is ordered unless you accept.",
      fr: "Bonjour, {{1}} souhaite vous envoyer une commande de {{2}} via Alo King. Le total est de {{3}}, payé en espèces à la porte. Rien n'est commandé sans votre accord.",
    },
    footer: FOOTER,
    buttons: {
      ar: ["✅ موافق، بدفع", "لا شكراً"],
      en: ["✅ Accept, I'll pay", "No thanks"],
      fr: ["✅ J'accepte, je paie", "Non merci"],
    },
    example: { sender: "Rami", vendor: "Alo Test Grill", total: "$18.00 / 1,611,000 LBP" },
  },
  {
    name: "alo_send_home_receipt",
    category: "UTILITY",
    key: "gift_accepted",
    audience: "customer",
    params: ["recipient", "vendor", "code", "total"],
    body: {
      ar: "طلبك لـ {{1}} من {{2}} تأكّد (رقم {{3}}). المجموع {{4}}، بيندفع كاش عند الباب. منخبرك لما يوصل.",
      en: "Your Send Home order for {{1}} from {{2}} is confirmed (#{{3}}). The total is {{4}}, paid in cash at the door. We will tell you when it is delivered.",
      fr: "Votre commande Send Home pour {{1}} chez {{2}} est confirmée (n°{{3}}). Le total est de {{4}}, payé en espèces à la porte. Nous vous dirons quand elle sera livrée.",
    },
    footer: FOOTER,
    buttons: { ar: ["تابع الطلب"], en: ["Track the order"], fr: ["Suivre la commande"] },
    example: {
      recipient: "Mama",
      vendor: "Alo Test Grill",
      code: "4821",
      total: "$18.00 / 1,611,000 LBP",
    },
  },
  {
    name: "alo_payment_link",
    category: "UTILITY",
    key: "payment_link",
    audience: "customer",
    params: ["amount", "code", "link"],
    body: {
      ar: "لتدفع {{1}} لطلبك رقم {{2}}، افتح هالرابط الآمن: {{3}} . الطلب بيبلّش بس يتأكد الدفع.",
      en: "To pay {{1}} for your order #{{2}}, open this secure link: {{3}} . The order starts as soon as the payment is confirmed.",
      fr: "Pour payer {{1}} pour votre commande n°{{2}}, ouvrez ce lien sécurisé : {{3}} . La commande démarre dès que le paiement est confirmé.",
    },
    footer: FOOTER,
    example: { amount: "$12.50", code: "4821", link: "https://pay.example.com/abc123" },
  },
  {
    name: "alo_support_reply",
    category: "UTILITY",
    key: "support_reply",
    audience: "customer",
    params: ["name"],
    body: {
      ar: "مرحبا، {{1}} من ألو كينغ ردّ على رسالتك. اضغط تحت لتقرا الرد.",
      en: "Hello, {{1}} from Alo King answered your message. Tap below to read the reply.",
      fr: "Bonjour, {{1}} d'Alo King a répondu à votre message. Touchez ci-dessous pour lire la réponse.",
    },
    footer: FOOTER,
    buttons: { ar: ["اقرا الرد"], en: ["Read the reply"], fr: ["Lire la réponse"] },
    example: { name: "Rasheed" },
  },
  {
    name: "alo_merchant_new_order",
    category: "UTILITY",
    key: "new_order",
    audience: "merchant",
    params: ["code", "items", "total"],
    body: {
      ar: "طلب جديد على ألو كينغ رقم {{1}}: {{2}}. المجموع {{3}}. اضغط قبول ليتأكد الطلب.",
      en: "New Alo King order #{{1}}: {{2}}. Total {{3}}. Tap Accept to confirm the order.",
      fr: "Nouvelle commande Alo King n°{{1}} : {{2}}. Total {{3}}. Touchez Accepter pour la confirmer.",
    },
    footer: FOOTER,
    buttons: {
      ar: ["✅ قبول ١٥ د", "✅ قبول ٣٠ د", "❌ رفض"],
      en: ["✅ Accept 15 min", "✅ Accept 30 min", "❌ Reject"],
      fr: ["✅ Accepter 15 min", "✅ Accepter 30 min", "❌ Refuser"],
    },
    example: { code: "4821", items: "2 × Shish taouk, 1 × Fries", total: "$14.00" },
  },
  {
    name: "alo_copilot_suggestion",
    category: "UTILITY",
    key: "proposal",
    audience: "merchant",
    params: ["shop", "suggestion"],
    body: {
      ar: "اقتراح من ألو كينغ لـ {{1}}: {{2}} ما بيتغيّر شي إلا إذا ضغطت نعم.",
      en: "An Alo King suggestion for {{1}}: {{2}} Nothing changes unless you tap Yes.",
      fr: "Une suggestion d'Alo King pour {{1}} : {{2}} Rien ne change sans votre Oui.",
    },
    footer: FOOTER,
    buttons: { ar: ["✅ نعم", "لا"], en: ["✅ Yes", "No"], fr: ["✅ Oui", "Non"] },
    example: { shop: "Alo Test Grill", suggestion: "mark Knefe sold out after 9 pm, as on most days?" },
  },
  {
    name: "alo_merchant_weekly",
    category: "UTILITY",
    key: "merchant_weekly",
    audience: "merchant",
    params: ["shop", "orders", "delivered", "sales", "rating"],
    body: {
      ar: "هيدا ملخّص أسبوع {{1}} على ألو كينغ: عدد الطلبات {{2}}، وصل منهن {{3}}، مبيعات الأكل {{4}}، والتقييم {{5}}. اضغط تحت لتشوف التفاصيل كاملة.",
      en: "The week of {{1}} on Alo King: {{2}} orders, {{3}} delivered, food sales {{4}}, rating {{5}}. Tap below for details.",
      fr: "La semaine de {{1}} sur Alo King : {{2}} commandes, {{3}} livrées, ventes {{4}}, note {{5}}. Touchez ci-dessous pour le détail.",
    },
    footer: FOOTER,
    buttons: { ar: ["التفاصيل"], en: ["Details"], fr: ["Détails"] },
    example: { shop: "Alo Test Grill", orders: "42", delivered: "40", sales: "$612.00", rating: "4.6" },
  },
  {
    name: "alo_claim_code",
    category: "AUTHENTICATION",
    key: "claim_code",
    audience: "merchant",
    params: ["code"],
    // Meta writes the body of an authentication template ("{{1}} is your verification code."); these are
    // what the approved template reads, kept for the tests and the dry run.
    body: {
      ar: "{{1}} هو رمز التحقق الخاص بك.",
      en: "{{1}} is your verification code.",
      fr: "Votre code de vérification est {{1}}.",
    },
    example: { code: "482913" },
  },
  {
    name: "alo_offer_nearby",
    category: "MARKETING",
    key: "marketing_offer",
    audience: "customer",
    params: ["shop", "offer"],
    body: {
      ar: "عرض جديد من {{1}} على ألو كينغ: {{2}}. اطلب على واتساب بكم كبسة، والدفع كاش.",
      en: "A new offer from {{1}} on Alo King: {{2}}. Order on WhatsApp in a few taps, cash on delivery.",
      fr: "Nouvelle offre de {{1}} sur Alo King : {{2}}. Commandez sur WhatsApp en quelques touches, paiement en espèces.",
    },
    footer: MKT_FOOTER,
    buttons: {
      ar: ["اطلب هلق", "وقّف العروض"],
      en: ["Order now", "Stop promotions"],
      fr: ["Commander", "Stop promotions"],
    },
    example: { shop: "Alo Test Grill", offer: "20% off all wraps until Sunday" },
  },
  {
    name: "alo_new_shop_nearby",
    category: "MARKETING",
    key: "marketing_new_shop",
    audience: "customer",
    params: ["shop", "village"],
    body: {
      ar: "خبر حلو: {{1}} بـ {{2}} صار ياخد طلبات على ألو كينغ. اطلب على واتساب بكم كبسة، والدفع كاش عند الاستلام.",
      en: "Good news: {{1}} in {{2}} now takes orders on Alo King. Order on WhatsApp in a few taps, cash on delivery.",
      fr: "Bonne nouvelle : {{1}} à {{2}} prend maintenant les commandes sur Alo King. Commandez sur WhatsApp en quelques touches, paiement en espèces.",
    },
    footer: MKT_FOOTER,
    buttons: {
      ar: ["شوف المنيو", "وقّف العروض"],
      en: ["See the menu", "Stop promotions"],
      fr: ["Voir le menu", "Stop promotions"],
    },
    example: { shop: "Alo Test Grill", village: "Baakline" },
  },
];

export const templateByKey = (key: string) => TEMPLATES.find((t) => t.key === key) ?? null;
export const templateByName = (name: string) => TEMPLATES.find((t) => t.name === name) ?? null;

/** The template language for a customer or merchant language (Arabizi reads the Arabic template). */
export function templateLang(lang: unknown): TemplateLang {
  return lang === "en" ? "en" : lang === "fr" ? "fr" : "ar";
}

/** A variable value as Meta accepts it: one line, no tabs, no run of more than 4 spaces, never empty. */
export function templateParam(v: unknown, max = 300): string {
  const s = [...String(v ?? "").replace(/\s+/g, " ").trim()].slice(0, max).join("");
  return s || "-";
}

/**
 * The send payload for one template. `values` are by parameter name; `payloads` are the quick-reply payloads in
 * button order (a missing one leaves that button without a payload, which Meta refuses: the caller always gives
 * all of them). Throws on an unknown parameter set, so a template is never sent with a hole in it.
 */
export function templateMessage(
  to: string,
  def: TemplateDef,
  lang: TemplateLang,
  values: Record<string, unknown>,
  payloads: string[] = [],
): Record<string, unknown> {
  for (const p of def.params)
    if (values[p] === undefined || values[p] === null) throw new Error(`template ${def.name}: ${p} missing`);
  const text = def.params.map((p) => ({ type: "text", text: templateParam(values[p]) }));
  const components: Record<string, unknown>[] = [{ type: "body", parameters: text }];
  if (def.category === "AUTHENTICATION") {
    // The copy-code button repeats the code (Meta's one-tap format).
    components.push({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: templateParam(values[def.params[0] ?? "code"], 15) }],
    });
  } else {
    const n = def.buttons?.[lang]?.length ?? 0;
    if (payloads.length !== n) throw new Error(`template ${def.name}: ${n} buttons, ${payloads.length} payloads`);
    payloads.forEach((p, i) =>
      components.push({
        type: "button",
        sub_type: "quick_reply",
        index: String(i),
        parameters: [{ type: "payload", payload: p }],
      }),
    );
  }
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: to.replace(/^\+/, ""),
    type: "template",
    template: { name: def.name, language: { code: lang }, components },
  };
}

/** The body as the recipient reads it (dry runs, the simulator transcript and the tests). */
export function renderTemplate(def: TemplateDef, lang: TemplateLang, values: Record<string, unknown>): string {
  return def.body[lang].replace(/\{\{(\d+)\}\}/g, (_, n) =>
    templateParam(values[def.params[Number(n) - 1] ?? ""]),
  );
}

/** The create request Meta expects at POST /{waba_id}/message_templates for one template in one language. */
export function metaTemplateCreate(def: TemplateDef, lang: TemplateLang): Record<string, unknown> {
  const examples = def.params.map((p) => def.example[p]);
  if (def.category === "AUTHENTICATION") {
    return {
      name: def.name,
      language: lang,
      category: "AUTHENTICATION",
      components: [
        { type: "BODY", add_security_recommendation: true },
        { type: "FOOTER", code_expiration_minutes: 10 },
        { type: "BUTTONS", buttons: [{ type: "OTP", otp_type: "COPY_CODE" }] },
      ],
    };
  }
  const components: Record<string, unknown>[] = [
    { type: "BODY", text: def.body[lang], example: { body_text: [examples] } },
  ];
  if (def.footer) components.push({ type: "FOOTER", text: def.footer[lang] });
  if (def.buttons)
    components.push({
      type: "BUTTONS",
      buttons: def.buttons[lang].map((text) => ({ type: "QUICK_REPLY", text })),
    });
  return { name: def.name, language: lang, category: def.category, components };
}

/** Every way a template breaks Meta's rules (empty array = fine). */
export function checkTemplate(def: TemplateDef): string[] {
  const v: string[] = [];
  const len = (s: string) => [...s].length;
  if (!/^[a-z0-9_]{1,512}$/.test(def.name)) v.push(`${def.name}: bad name`);
  for (const p of def.params) if (!(p in def.example)) v.push(`${def.name}: no example for ${p}`);
  for (const lang of TEMPLATE_LANGS) {
    const b = def.body[lang];
    if (!b) {
      v.push(`${def.name}/${lang}: no body`);
      continue;
    }
    if (len(b) > 1024) v.push(`${def.name}/${lang}: body ${len(b)} > 1024`);
    const nums = [...b.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
    const want = def.params.map((_, i) => i + 1);
    if (JSON.stringify([...new Set(nums)].sort((a, c) => a - c)) !== JSON.stringify(want))
      v.push(`${def.name}/${lang}: variables ${nums.join(",")} != 1..${def.params.length}`);
    if (def.category !== "AUTHENTICATION") {
      if (/^\s*\{\{\d+\}\}/.test(b)) v.push(`${def.name}/${lang}: starts with a variable`);
      if (/\{\{\d+\}\}\s*$/.test(b)) v.push(`${def.name}/${lang}: ends with a variable`);
      if (/\}\}\s*\{\{/.test(b)) v.push(`${def.name}/${lang}: two variables side by side`);
      // Meta refuses a body with too many variables for its length; keep at least 3 words of text per variable.
      const words = b.replace(/\{\{\d+\}\}/g, " ").split(/\s+/).filter(Boolean).length;
      if (words < 3 * def.params.length) v.push(`${def.name}/${lang}: ${words} words for ${def.params.length} variables`);
      if (/\n{3,}/.test(b)) v.push(`${def.name}/${lang}: more than two line breaks in a row`);
    }
    const f = def.footer?.[lang];
    if (f !== undefined) {
      if (len(f) > 60) v.push(`${def.name}/${lang}: footer ${len(f)} > 60`);
      if (/\{\{/.test(f)) v.push(`${def.name}/${lang}: variable in the footer`);
    }
    const bs = def.buttons?.[lang] ?? [];
    if (bs.length > 3) v.push(`${def.name}/${lang}: ${bs.length} buttons > 3`);
    if (new Set(bs).size !== bs.length) v.push(`${def.name}/${lang}: duplicate button`);
    for (const t of bs) if (!t.trim() || len(t) > 25) v.push(`${def.name}/${lang}: button "${t}" (${len(t)} > 25)`);
    if ((def.buttons?.ar?.length ?? 0) !== bs.length) v.push(`${def.name}/${lang}: button count differs from ar`);
  }
  if (def.category === "MARKETING") {
    for (const lang of TEMPLATE_LANGS)
      if (!/STOP/.test(def.footer?.[lang] ?? "")) v.push(`${def.name}/${lang}: marketing without STOP`);
    if (!def.buttons) v.push(`${def.name}: marketing without an opt-out button`);
  }
  if (def.category === "AUTHENTICATION" && (def.buttons || def.params.length !== 1))
    v.push(`${def.name}: authentication takes exactly the code`);
  return v;
}
