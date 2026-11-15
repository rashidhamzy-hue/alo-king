// Output checks on text the model wrote. Fixed texts and cards are built by code from the database and never pass here;
// only the Concierge's free text does (the `reply` and `ask_location_pin` tools). A failed check means the text is not sent:
// the model is told why and rewords, or the loop runs out of steps and a person takes over. Fail closed.
//
// 1.5 Money: no price, fee or total in free text. Amounts reach the customer only on the card, or through `reply`'s
//     `price_of`, which code fills from quote_order.
// 1.10 Neutral and factual: no quality judgement (best, tasty, healthy, a rating) about a merchant or product; no food fact
//     (halal, gluten, vegan, allergens, calories, ...) unless a tool returned an approved record for it this turn, and even
//     then never "safe" for an allergy; nothing that names a religion. A food word is allowed in a sentence that says the
//     information is not verified or offers to ask: that is exactly what the rules require when there is no record.
// M1 Message design: the model's own words are at most two short sentences (SYSTEM_BRIEF rule 3). Everything longer, a card,
//     a list, a status, is a fixed message that code builds (packages/agents/src/messages/).

export type GuardCode = "money_in_free_text" | "quality_judgement" | "unapproved_food_claim" | "allergy_reassurance" | "sensitive_inference" | "too_long"
  | "minimum_by_code" | "catalogue_claim" | "change_claim";
export interface Violation { code: GuardCode; match: string }

/** Arabic-Indic and Persian digits to ASCII, Arabic decimal and thousands marks to "." and ",", tatweel removed, lower case. */
export function normaliseForGuard(text: string): string {
  return text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/٫/g, ".").replace(/٬/g, ",").replace(/ـ/g, "")
    .toLowerCase();
}

const AR = "[\\u0600-\\u06FF]";
const NUM = "\\d+(?:[.,]\\d+)*";
// Words that make a number an amount of money.
const CURRENCY = [
  "\\$", "€", "£", "usd\\b", "dollars?\\b", "dolar\\w*", "dollar\\w*", "lbp\\b", "l\\.?l\\b", "lira\\w*", "leera\\w*", "lera\\b", "cents?\\b",
  "k\\b", "alf\\b", "alef\\b", "dolar", "euros?\\b",
  `دولار${AR}*`, `ليرة`, `ليرات`, `ل\\.?\\s?ل`, `سنت${AR}*`, "ألف", "الف", "آلاف", "الاف", "ملايين", "مليون",
].join("|");
// Words that make a nearby number a price even without a currency.
const PRICE_WORD = [
  "price", "prices", "cost", "costs", "total", "subtotal", "fee", "fees", "charge", "charges", "prix", "coût", "cout", "frais",
  "se3r", "sa3er", "s3r", "ha2", "ha2o", "majmou3",
  "سعر", "سعره", "سعرها", "السعر", "الأسعار", "حق", "حقو", "حقها", "حقه", "بحق", "مجموع", "المجموع", "إجمالي", "الإجمالي", "اجمالي",
  "الاجمالي", "رسوم", "رسم", "كلفة", "الكلفة", "تكلفة", "التكلفة", "ثمن", "ثمنها", "ثمنه", "بيطلع", "بتطلع", "بيكلّف", "بيكلف", "بتكلّف", "بتكلف",
].join("|");
const NUMBER_WORD = [
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "fifteen", "twenty", "fifty", "hundred",
  "half", "thousand", "wa7ad", "wa7de", "tnen", "tnein", "tlete", "arba3a", "khamse", "sette", "sab3a", "tmene", "tes3a", "3ashra", "miye",
  "واحد", "وحدة", "تنين", "اتنين", "إتنين", "اثنين", `تلات${AR}*`, `ثلاث${AR}*`, `اربع${AR}*`, `أربع${AR}*`, `خمس${AR}*`, `ست${AR}*`,
  `سبع${AR}*`, `تمان${AR}*`, `ثمان${AR}*`, `تسع${AR}*`, `عشر${AR}*`, "مية", "مئة", "ميتين", "نص", "ربع",
].join("|");

const MONEY_PATTERNS: RegExp[] = [
  new RegExp(`(?:\\$|€|£)\\s*${NUM}`, "u"),                                   // $3, $ 3.50
  new RegExp(`${NUM}\\s*(?:${CURRENCY})`, "u"),                              // 3$, 3 دولار, 250,000 ل.ل, 50 alf, 2k
  new RegExp(`(?:usd|lbp|دولار|ليرة|ل\\.ل)\\s*${NUM}`, "u"),                 // USD 3, ل.ل 250000
  new RegExp(`(?:^|[^\\p{L}])(?:${PRICE_WORD})(?![\\p{L}])[^.!?؟\\n]{0,24}?\\d`, "u"),   // السعر 3, the total is 8.24
  new RegExp(`(?:^|[^\\p{L}])(?:${NUMBER_WORD})\\s+(?:${CURRENCY})`, "u"),   // خمسة دولار, five dollars, مية ألف
  new RegExp(`(?:^|[^\\p{L}])(?:${PRICE_WORD})(?![\\p{L}])[^.!?؟\\n]{0,24}?(?:دولار|ليرة|dollar|lira|usd|lbp)`, "u"),   // حقو دولار
  new RegExp(`(?:دولار|ليرة|dollar|lira)\\s+(?:و\\s?(?:نص|ربع)|and a half|w ?nos)`, "u"),                    // دولار ونص
];

/** The first fragment that states an amount of money, or null. */
export function moneyInText(text: string): string | null {
  const t = normaliseForGuard(text);
  for (const re of MONEY_PATTERNS) { const m = re.exec(t); if (m) return m[0].trim(); }
  return null;
}

// Arabic words take the article and a conjunction as prefixes (والأطيب) and a feminine or plural ending (لذيذة، صحيين).
const arWord = (words: string[]) => new RegExp(`(?<![\\p{L}])(?:و|ف)?(?:ال)?(?:${words.join("|")})(?:ة|ه|ين|ات)?(?![\\p{L}])`, "u");
const enWord = (words: string[]) => new RegExp(`\\b(?:${words.join("|")})\\b`, "u");

const QUALITY: RegExp[] = [
  enWord(["best", "better", "worse", "worst", "tasty", "tastier", "tastiest", "delicious", "yummy", "healthy", "healthier", "healthiest", "unhealthy",
          "amazing", "excellent", "awesome", "superb", "top[- ]rated", "highly rated", "recommend", "recommended", "i'd recommend", "must[- ]try",
          "meilleure?s?", "délicieux", "délicieuse", "savoureux", "savoureuse", "sain", "saine",
          "a7san", "a7sanon", "af2al", "atyab", "atyabon", "zeki", "zaki", "zakiye", "lazeez", "lazize", "momtaz", "ra2e3", "bjanen", "bi jannin", "sa7e", "sa7i", "se7e", "sa7iye"]),
  arWord(["أحسن", "احسن", "أفضل", "افضل", "أطيب", "اطيب", "أطعم", "اطعم", "لذيذ", "زاكي", "صحي", "صحّي", "ممتاز", "رائع", "رهيب", "بجنن", "بتجنن",
          "أسوأ", "اسوأ", "أوحش", "اوحش", "عاطل", "منصحك", "بنصحك", "أنصحك", "انصحك", "ننصحك", "منوصيك"]),
  /\d(?:[.,]\d)?\s*\/\s*(?:5|10)\b|\d\s*(?:stars?|نجوم|نجمات)|⭐|★|\brating\b|\brated\b|تقييم/u,
];
const SENSITIVE = [enWord(["muslim", "christian", "druze", "jewish", "religion", "religious", "your faith"]),
                   arWord(["مسلم", "مسيحي", "درزي", "يهودي", "دين", "ديانة", "دينك"])];

/** Food facts by attribute. A term counts only when no approved record for its attribute came back from a tool this turn. */
export const FOOD_TERMS: [string, RegExp][] = [
  ["halal", /halal|7alal|حلال|kosher/u],
  ["gluten", /gluten|gluten[- ]free|غلوتين|غلوتن|جلوتين|coeliac|celiac|سيلياك/u],
  ["vegan", /vegan|فيغان|ڤيغان|نباتي صرف/u],
  ["vegetarian", /vegetarian|végétarien|نباتي|نباتية/u],
  ["fasting", /siyami|syami|صيامي|fasting[- ]friendly|lenten/u],
  ["nutrition", /calorie|calories|kcal|كالوري|سعرات|protein|بروتين|carbs|كربوهيدرات|keto|كيتو|sugar[- ]free|بدون سكر|خالي من السكر|low[- ]fat|organic|عضوي/u],
  ["allergens", /allerg|حساسي|nuts?\b|nut[- ]free|peanut|مكسرات|فستق|sesame|سمسم|dairy[- ]free|lactose|لاكتوز|خالي من الحليب|egg[- ]free|shellfish|soy/u],
];
const UNCERTAIN = /not verified|unverified|no verified|isn't verified|is not verified|don't have|do not have|no information|can't confirm|cannot confirm|can not confirm|not sure|unknown|check the label|ask (?:the )?(?:restaurant|merchant|kitchen|maker|shop)|must confirm|has to confirm|needs to confirm|will ask|i can ask|we can ask|ما عندي|ما عنا|ما عندنا|ما في معلوم|مش متأكد|مش مأكد|مش موثّق|مش موثق|غير موثّق|غير موثق|مش مؤكد|غير مؤكد|ما منقدر نأكّد|ما منقدر نأكد|ما فينا نأكّد|ما فينا نأكد|لازم المطبخ|لازم المحل|لازم يأكّد|لازم يأكد|منسأل|بنسأل|نسأل|بسأل|اسأل|شوف الملصق|تشوف الملصق|اتطلع عالملصق|تطلع عالملصق|ما بعرف|ma 3ande|ma 3anna|mesh mt2akkad|pas vérifié|je ne sais pas/u;
// Repeating the customer's own allergy or restriction back is recording it, not stating a fact about a product.
const THEIR_OWN = /your allergy|you're allergic|you are allergic|noted|i've noted|حساسيتك|عندك حساسية|سجّلت|سجلت|سجّلنا|سجلنا|نقلنا|منبلّغ|منبلغ|بلّغنا/u;
const REASSURE = /\bsafe\b|\bfine\b|no problem|don't worry|no risk|آمن|ما في مشكلة|مافي مشكلة|ما في خطر|مافي خطر|ما تخاف|لا تخاف|ما تعتل هم|sans risque/u;

// Declining to rank, rate, judge or recommend. No word that turns it into a judgement may follow in the same clause.
const DECLINE = /(?:can't|cannot|can not|don't|do not|won't|will not|not able to|unable to)\s+(?:\w+\s+){0,2}?(?:rank|rate|judge|compare|recommend|say which|tell (?:you )?which|call (?:any|one))|ما (?:فيني|فينا|بقدر|منقدر) (?:قول|قلّك|قلك|قيّم|قيم|نقيّم|نقيم|نقول|رتّب|نرتّب|احكم|نحكم)|je ne peux pas (?:dire|classer|recommander)/u;
const clauses = (t: string) => sentences(t).flatMap((x) => x.split(/[,،:]|\b(?:but|however|though|although|mais)\b|(?<![\p{L}])(?:بس|لكن|بينما)(?![\p{L}])/u)).map((x) => x.trim()).filter(Boolean);
// An offer to filter or leave things out by a kind of fact, from approved records.
const FILTER_OFFER = /(?:i|we) can (?:filter|leave out|exclude|check)|filter by|what (?:should|shall|do you want) (?:i|me to) leave out|فيني (?:شيل|فلتر)|فينا (?:نشيل|نفلتر)|منقدر (?:نشيل|نفلتر)|شو بدك (?:نشيل|شيل)/u;
// The category words themselves (allergens, ingredients), as opposed to a fact about a product.
const FOOD_CATEGORY = /\ballerg(?:ens?|ies|y)\b|\bingredients?\b|حساسي(?:ة|ات)|مكوّنات|مكونات/gu;

const sentences = (t: string) => t.split(/[.!?؟؛;\n]+/u).map((x) => x.trim()).filter(Boolean);

export interface CheckOptions {
  /** Food-fact attributes ("halal", "gluten", ...) for which a tool returned an approved record during this turn. */
  approvedFacts?: ReadonlySet<string>;
  /** Leave out the length rule (M1): for the live evals only, which judge length on the reply sent and every other rule on the first draft. */
  skipLength?: boolean;
  /** Leave out the quality-word rule (coordinator, 15 Nov): for the live evals only, which judge it on the reply sent as well.
   *  The guard itself never skips it: a refused draft is the guard doing its job. */
  skipQuality?: boolean;
  /** B1a: search_catalog ran this turn, so "the only one we have" / "no other" has a tool result behind it. */
  catalogueSearched?: boolean;
  /** B1a: quote_order or a card changed the basket this turn, so "I changed it" has a tool result behind it. */
  basketChanged?: boolean;
}

// B1a (SIM1 fix 1): the minimum order, the basket and the gap are said by code with their amounts (basket.ts); the model never words
// them. SIM1's customers heard "your order is below the minimum" up to five times with no number.
const MINIMUM = /الحد الأدنى|الحد الادنى|حد أدنى|حد ادنى|الحدّ الأدنى|\bminimum\b|\bminimal\b|\bmin(?:imum)? order\b|7add? el adna|7ad el adna|7ad adna|montant minimum|commande minimum|minimum de commande/u;
// B1a (SIM1 fix 10): what the catalogue holds is said only from a tool result. "The catalogue is not ready" is code's fixed line
// (show_catalog); "the only one" and "no other" need a search this turn.
const CATALOGUE_STATE = /(?:catalog(?:ue)?|كتالوج|كاتالوج|الكتالوج|الكاتالوج|katalog)[^.!?؟\n]{0,20}(?:not ready|isn't ready|is not ready|not available|unavailable|n'est pas prêt|pas disponible|مش جاهز|مش جاهزة|مش متوفر|مش متاح|غير متوفر|ma7adar|mesh jehez|msh jehez)/u;
const ONLY_ONE = /\bthe only (?:one|kind|flavou?r|brand|size|type)\b|\bthe only [\p{L} ]{1,30}? (?:we have|we've got|we carry|available|in stock|left)\b|\bonly (?:one|kind) (?:we have|available)\b|\bno other\b|\bnothing else (?:like|in)\b|\bwe (?:don't|do not) have (?:any )?(?:other|another)\b|c'est (?:la|le) seule?\b|\bseule? (?:disponible|qu'on a)\b|\baucune? autre\b|\bpas d'autres?\b|الوحيد|الوحيدة|ما عنا غير|ما عندنا غير|ما في غير|ما في غيرها|ما في غيرو|ما في غيره|ما عنا غيرها|ما عنا غيرو|ma 3anna ghayr|ma 3anna gher|ma fi ghayra|ma fi gherha|ma fi ghero|el wa7id|el wa7ide/u;

// B1a (the second run on main: sim-079, sim-146, sim-110, sim-052): the model said it had changed the order («عدّلنا», "I've
// updated", «ثواني وبحدّث الطلب») when no tool had touched it, and the card stayed as it was. A change is said only after
// quote_order changed the basket this turn; a code message (basket.changed) says what changed on the card itself.
const CHANGE_CLAIM = /عدّلنا|عدلنا|عدّلت|عدلت|عم (?:م?ن|ب)عدّل|عم (?:م?ن|ب)عدل|غيّرنا|غيرنا|غيّرت|غيرت|بدّلنا|بدلنا|بدّلت|بدلت|حدّثنا|حدثنا|حدّثت|حدثت|بحدّث|بحدث|منحدّث|صحّحنا|صححنا|صحّحت|صححت|ضفنا|ضفت|زدنا|زدت|شلنا|شلت|نقّصنا|نقصنا|نقّصت|نقصت|\bI(?:'ve| have)? (?:updated|changed|adjusted|corrected|modified|added|removed|replaced)\b|\bwe(?:'ve| have)? (?:updated|changed|adjusted|corrected|modified|added|removed|replaced)\b|\b(?:I'm|I am|we're|we are) (?:updating|changing|adjusting|correcting)\b|\b(?:order|basket) (?:is|has been) (?:updated|changed|adjusted|corrected)\b|\bj'ai (?:modifié|ajouté|retiré|changé|corrigé|mis à jour|remplacé)(?!\p{L})|\bnous avons (?:modifié|ajouté|retiré|changé|corrigé)(?!\p{L})|\bon a (?:modifié|ajouté|retiré|changé|corrigé)(?!\p{L})|\b3addalt?\b|\b3addalna\b|\bghayyart?\b|\bghayyarna\b|\bzedt\b|\bzedna\b|\bshelt\b|\bshelna\b/iu;

/** M1: at most two sentences, each short. A line break ends a sentence too (a list is not two sentences). */
export const MAX_SENTENCES = 2;
export const MAX_SENTENCE_CHARS = 160;
/** The model's sentences: split after . ! ? ؟ followed by a space or the end, and at line breaks ("2.5 kg" stays whole). */
export function modelSentences(text: string): string[] {
  return text.split(/(?<=[.!?؟…])\s+|\n+/u).map((x) => x.trim()).filter((x) => /[\p{L}\p{N}]/u.test(x));
}
export function tooLong(text: string): string | null {
  const s = modelSentences(text);
  if (s.length > MAX_SENTENCES) return `${s.length} sentences`;
  const long = s.find((x) => x.length > MAX_SENTENCE_CHARS);
  return long ? `${long.length} characters` : null;
}

/** Every check that applies to text written by the model. Returns the first violation, or null when the text may be sent. */
export function checkModelText(text: string, opts: CheckOptions = {}): Violation | null {
  const money = moneyInText(text);
  if (money) return { code: "money_in_free_text", match: money };
  const long = opts.skipLength ? null : tooLong(text);
  if (long) return { code: "too_long", match: long };
  const t = normaliseForGuard(text);
  const minimum = MINIMUM.exec(t);
  if (minimum) return { code: "minimum_by_code", match: minimum[0] };
  const state = CATALOGUE_STATE.exec(t);
  if (state) return { code: "catalogue_claim", match: state[0] };
  const only = opts.catalogueSearched ? null : ONLY_ONE.exec(t);
  if (only) return { code: "catalogue_claim", match: only[0] };
  const claim = opts.basketChanged ? null : CHANGE_CLAIM.exec(t);
  if (claim) return { code: "change_claim", match: claim[0] };
  for (const re of SENSITIVE) { const m = re.exec(t); if (m) return { code: "sensitive_inference", match: m[0].trim() }; }
  // A quality word in a clause that declines to judge («I can't say which is healthiest») is the refusal the rules ask for, not a
  // judgement (K1: B4's live run refused it). A comma or a contrast word starts a new clause, so "I can't rank them, X is the best" fails.
  for (const c of opts.skipQuality ? [] : clauses(t)) {
    if (DECLINE.test(c)) continue;
    for (const re of QUALITY) { const m = re.exec(c); if (m) return { code: "quality_judgement", match: m[0].trim() }; }
  }
  for (const s of sentences(t)) {
    const foods = FOOD_TERMS.filter(([, re]) => re.test(s));
    if (foods.length === 0) continue;
    // An offer to filter by a kind of fact («I can filter by allergens where we have approved records») names the category, not
    // a fact about a product (K1). Only the category words may appear: "filter: these are nut-free" is still a claim.
    if (FILTER_OFFER.test(s) && !FOOD_TERMS.some(([, re]) => re.test(s.replace(FOOD_CATEGORY, " ")))) continue;
    // Never "safe" or "no problem" next to an allergy or diet word, whatever the record says: the kitchen confirms, not us.
    const calm = REASSURE.exec(s);
    if (calm && foods.some(([a]) => a === "allergens" || a === "gluten")) return { code: "allergy_reassurance", match: calm[0] };
    if (UNCERTAIN.test(s) || THEIR_OWN.test(s)) continue;
    const unapproved = foods.find(([a]) => !opts.approvedFacts?.has(a));
    if (unapproved) return { code: "unapproved_food_claim", match: (unapproved[1].exec(s)?.[0] ?? unapproved[0]).trim() };
  }
  return null;
}

/** What the model is told when its text is refused, so it can reword instead of repeating itself. */
export const GUARD_HINT: Record<GuardCode, string> = {
  quality_judgement: "Never call a merchant, dish or product good, bad, best, tasty or healthy, never recommend one and never give a rating. Present options by measurable facts (what was asked for, availability, size) and let the customer choose, or ask what matters to them.",
  unapproved_food_claim: "No approved record for this food fact came back from a tool. Say you do not have verified information, and offer to ask the merchant or suggest checking the label.",
  allergy_reassurance: "Never reassure about an allergy or a diet. Pass it on as an allergy and say the kitchen must confirm before the order is accepted.",
  sensitive_inference: "Never mention or infer a religion, health condition or diet from a name, a place or past orders. Ask only what the customer wants to exclude.",
  too_long: "Your own words are at most two short sentences. Say one thing: ask the one question that matters, or offer the choices as buttons (at most three). Lists, cards and totals are sent by the system.",
  minimum_by_code: "Do not mention the minimum order: the system already tells the customer the minimum, their basket and what is missing, with buttons. Answer the rest of their message, or ask what they want to add.",
  change_claim: "Never say the order or basket was changed unless quote_order changed it this turn. To change it, call quote_order with the new lines (and remove), then send_confirmation for the new card; or ask what to change.",
  catalogue_claim: "Say only what a tool returned about the catalogue. Before saying a product is the only one or that there is no other, call search_catalog for it this turn; never say the catalogue is not ready (call show_catalog: the system answers if it cannot be shown).",
  money_in_free_text: "Prices, fees and totals are never written in free text. Leave amounts out: pass the product ids in `price_of` and the system adds prices from the database, or call quote_order and send_confirmation so the card shows the total.",
};
