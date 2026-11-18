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
  | "minimum_by_code" | "catalogue_claim" | "change_claim" | "area_claim" | "wrong_language";
export interface Violation { code: GuardCode; match: string }
import { wordsLanguage, type Speech } from "./language";

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
  // PD1: suitability said as a judgement ("good for kids", «منيح للولاد»). Audience tags are shopping tags, never a claim in a reply.
  /\b(?:good|great|perfect|ideal|suitable|safe|better) for (?:kids|children|babies|toddlers|you|your health|health|the family)\b|\bbon(?:ne)? pour (?:les enfants|la santé|les bébés)|(?<![\p{L}])(?:منيح|منيحة|مفيد|مفيدة|مناسب|مناسبة) (?:لل?ولاد|للأولاد|للاولاد|للأطفال|للاطفال|للصحة|للصحّة)|\b(?:mni7a?|mfid|mfide) (?:lal|la) (?:wled|wlad|ewled|sa77a|sa7a)\b/u,
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
  // PD1: the printed sugar claims customers ask for ("no sugar", "zero sugar", "no added sugar") in four languages.
  ["nutrition", /calorie|calories|kcal|كالوري|سعرات|protein|بروتين|carbs|كربوهيدرات|keto|كيتو|sugar[- ]free|(?:no|zero|without|low)(?: added)? sugar|sans sucre|sucre ajouté|بدون سكر|بلا سكر|خالي من السكر|قليل السكر|زيرو شوغر|زيرو سكر|bala s[eiou]kk?[ae]r|bidoun s[eiou]kk?[ae]r|low[- ]fat|organic|عضوي/u],
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
  /** PD1 (e): the products and dishes a tool returned this turn, each with its exact names. A food word inside one of these names, as
   *  the reply writes it, is part of a name and not a claim ("We have Balance Protein Crackers"). */
  products?: readonly { id: string; names: readonly (string | null | undefined)[] }[];
  /** PD1 (e): the customer's own words this turn. Said back as the request ("you asked for ...", "we don't carry ... yet"), the food
   *  words they asked about are not a claim. A confirming echo («إيه، بدون سكر» to «هيدا بدون سكر؟») is still one. */
  customerWords?: string;
  /** PD1 (e): approved records a tool returned this turn, by product id: the guard attributes they cover. When given, the unlock is per
   *  product: a fact passes only in a sentence that names that product (or, naming none, when one product alone has such a record) and
   *  says where the fact comes from ("the pack says ..."). `approvedFacts` is then ignored. */
  approvedByProduct?: ReadonlyMap<string, ReadonlySet<string>>;
  /** PD1 (g): whether settings.catalog has a WhatsApp catalogue. False: the model may not offer the catalogue (staging, 15 Nov 22:20: the
   *  button it offered answered "write what you want"). Unknown (undefined): not checked. */
  catalogueReady?: boolean;
  /** B1e: the places a tool or the planner returned this turn, each with its answer (served or not). Given (even empty), the model may say
   *  that we do or do not deliver to a place only as one of these says, for that place (sim-021: "we don't deliver to Botmeh" against the
   *  code's own «منوصّل على بطمة»). Unknown (undefined): not checked (the wording evals). */
  areas?: readonly { names: readonly string[]; served: boolean }[];
  /** B1e: the conversation's language (language.ts). Given, the model's own words must be in it: names a tool returned are left out. */
  replyLanguage?: Speech | null;
}

// B1a (SIM1 fix 1): the minimum order, the basket and the gap are said by code with their amounts (basket.ts); the model never words
// them. SIM1's customers heard "your order is below the minimum" up to five times with no number.
const MINIMUM = /الحد الأدنى|الحد الادنى|حد أدنى|حد ادنى|الحدّ الأدنى|\bminimum\b|\bminimal\b|\bmin(?:imum)? order\b|7add? el adna|7ad el adna|7ad adna|montant minimum|commande minimum|minimum de commande/u;
// B1a (SIM1 fix 10): what the catalogue holds is said only from a tool result. "The catalogue is not ready" is code's fixed line
// (show_catalog); "the only one" and "no other" need a search this turn.
const CATALOGUE_STATE = /(?:catalog(?:ue)?|كتالوج|كاتالوج|الكتالوج|الكاتالوج|katalog)[^.!?؟\n]{0,20}(?:not ready|isn't ready|is not ready|not available|unavailable|n'est pas prêt|pas disponible|مش جاهز|مش جاهزة|مش متوفر|مش متاح|غير متوفر|ma7adar|mesh jehez|msh jehez)/u;
// PD1 (g): an offer to show the WhatsApp catalogue, refused while settings.catalog has none (catalogueReady false).
const CATALOGUE_OFFER = /(?:catalog(?:ue)?|كتالوج|كاتالوج|الكتالوج|الكاتالوج|katalog)/u;
const ONLY_ONE = /\bthe only (?:one|kind|flavou?r|brand|size|type)\b|\bthe only [\p{L} ]{1,30}? (?:we have|we've got|we carry|available|in stock|left)\b|\bonly (?:one|kind) (?:we have|available)\b|\bno other\b|\bnothing else (?:like|in)\b|\bwe (?:don't|do not) have (?:any )?(?:other|another)\b|c'est (?:la|le) seule?\b|\bseule? (?:disponible|qu'on a)\b|\baucune? autre\b|\bpas d'autres?\b|الوحيد|الوحيدة|ما عنا غير|ما عندنا غير|ما في غير|ما في غيرها|ما في غيرو|ما في غيره|ما عنا غيرها|ما عنا غيرو|ma 3anna ghayr|ma 3anna gher|ma fi ghayra|ma fi gherha|ma fi ghero|el wa7id|el wa7ide/u;

// B1a (the second run on main: sim-079, sim-146, sim-110, sim-052): the model said it had changed the order («عدّلنا», "I've
// updated", «ثواني وبحدّث الطلب») when no tool had touched it, and the card stayed as it was. A change is said only after
// quote_order changed the basket this turn; a code message (basket.changed) says what changed on the card itself.
const CHANGE_CLAIM = /عدّلنا|عدلنا|عدّلت|عدلت|عم (?:م?ن|ب)عدّل|عم (?:م?ن|ب)عدل|غيّرنا|غيرنا|غيّرت|غيرت|بدّلنا|بدلنا|بدّلت|بدلت|حدّثنا|حدثنا|حدّثت|حدثت|بحدّث|بحدث|منحدّث|صحّحنا|صححنا|صحّحت|صححت|ضفنا|ضفت|زدنا|زدت|شلنا|شلت|نقّصنا|نقصنا|نقّصت|نقصت|\bI(?:'ve| have)? (?:updated|changed|adjusted|corrected|modified|added|removed|replaced)\b|\bwe(?:'ve| have)? (?:updated|changed|adjusted|corrected|modified|added|removed|replaced)\b|\b(?:I'm|I am|we're|we are) (?:updating|changing|adjusting|correcting)\b|\b(?:order|basket) (?:is|has been) (?:updated|changed|adjusted|corrected)\b|\bj'ai (?:modifié|ajouté|retiré|changé|corrigé|mis à jour|remplacé)(?!\p{L})|\bnous avons (?:modifié|ajouté|retiré|changé|corrigé)(?!\p{L})|\bon a (?:modifié|ajouté|retiré|changé|corrigé)(?!\p{L})|\b3addalt?\b|\b3addalna\b|\bghayyart?\b|\bghayyarna\b|\bzedt\b|\bzedna\b|\bshelt\b|\bshelna\b/iu;

/** M1: at most two sentences, each short. A line break ends a sentence too (a list is not two sentences). */
export const MAX_SENTENCES = 2;
/** B1b (SIM1 fix 7): the message rules' line limit (rule 1). A sentence becomes a line, so it is the sentence limit too. */
export const MAX_LINE_CHARS = 120;
export const MAX_SENTENCE_CHARS = MAX_LINE_CHARS;
/** The emojis a message may carry (rule 4); the crown is the greeting's only. */
export const ALLOWED_EMOJI = new Set(["📍", "🛒", "🛵", "✅", "💵", "🌙", "⚠️", "📦", "🏠", "🔢"]);
const EMOJI_RE = /\p{Extended_Pictographic}\uFE0F?/gu;

/** Arabic-Indic and Persian digits to Latin, the Arabic decimal mark to "." (message rule 7). Nothing else changes. */
export const latinDigits = (text: string): string => text
  .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
  .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
  .replace(/(?<=\d)٫(?=\d)/g, ".");

/**
 * B1b (SIM1 fix 7): the model's words shaped to the message rules before the checks and the send. Digits copied from the customer
 * («٣ بيبسي») or a product name become Latin; an emoji outside the allowed set is dropped; a line over the limit is split into its
 * sentences, one per line. A sentence still over the limit is left as it is, and checkModelText refuses it (too_long), so the model
 * says it shorter. In SIM1, 261 of 500 conversations broke a rule, nearly all in the model's own lines.
 */
export function shapeModelText(text: string): string {
  const folded = latinDigits(text)
    .replace(EMOJI_RE, (e) => (ALLOWED_EMOJI.has(e) || (e.replace("\uFE0F", "") === "⚠" && ALLOWED_EMOJI.has("⚠️")) ? e : ""));
  return folded.split("\n").map((line) => {
    const l = line.replace(/[ \t]{2,}/g, " ").trim();
    if (l.length <= MAX_LINE_CHARS) return l;
    return l.split(/(?<=[.!?؟…])\s+/u).map((x) => x.trim()).filter(Boolean).join("\n");
  }).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
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

// ---------- PD1 (e): names and echoes ----------
// A placeholder for a name taken out of the text: private-use characters, so no check's pattern can match it. The second character
// says which returned product it was (or none, for the customer's words said back).
const MARK = "\uE000";
const ECHO = "\uE0FF";
const markOf = (i: number) => MARK + String.fromCharCode(0xE100 + i);
const MARKS = /\uE000([\uE100-\uEFFF])/gu;
const TOKEN = /[\p{L}\p{N}]+/gu;
const tokens = (t: string) => [...t.matchAll(TOKEN)].map((m) => ({ w: m[0], at: m.index!, end: m.index! + m[0].length }));

/**
 * The text with every returned product's name taken out, each replaced by its mark. A name counts as written when the reply has, word
 * for word and with nothing in between, the name's first word followed by at least one more of its words in order ("Lipton Ice Tea Zero
 * Sugar" for "Lipton Ice Tea Tropical Zero Sugar 320Ml"), or the whole name. Words the name does not have end the match, so a claim
 * written after a name ("... is sugar-free") stays in the text.
 */
export function withoutNames(t: string, products: CheckOptions["products"]): string {
  const spans: { at: number; end: number; i: number }[] = [];
  const words = tokens(t);
  (products ?? []).forEach((p, i) => {
    for (const raw of p.names) {
      const name = tokens(normaliseForGuard(String(raw ?? ""))).map((x) => x.w);
      if (!name.length) continue;
      for (let k = 0; k < words.length; k++) {
        if (words[k]!.w !== name[0]) continue;
        let j = k + 1, n = 1, matched = 1;
        while (j < words.length) {
          let found = -1;
          for (let q = n; q < name.length; q++) if (name[q] === words[j]!.w) { found = q; break; }
          if (found < 0) break;
          n = found + 1; matched++; j++;
        }
        if (matched >= 2 || name.length === 1) spans.push({ at: words[k]!.at, end: words[j - 1]!.end, i });
      }
    }
  });
  // Longest first, then left to right; overlapping spans are dropped.
  spans.sort((a, b) => (b.end - b.at) - (a.end - a.at) || a.at - b.at);
  const kept: typeof spans = [];
  for (const s of spans) if (!kept.some((k) => s.at < k.end && k.at < s.end)) kept.push(s);
  kept.sort((a, b) => b.at - a.at);
  let out = t;
  for (const s of kept) out = out.slice(0, s.at) + ` ${markOf(s.i)} ` + out.slice(s.end);
  return out;
}

// The request said back: what follows these words, to the end of the clause, is the customer's own request.
const REQUEST_FRAME = new RegExp([
  "you(?:'ve| have)? asked (?:for|about)", "you(?:'re| are) (?:asking|looking) for", "you want(?:ed)?", "you(?:'d| would) like", "you need",
  "we (?:don't|do not|didn't|did not) (?:carry|have|sell|stock)(?: any)?", "we have no", "there (?:are|is) no", "no one sells",
  "vous (?:avez demandé|cherchez|voulez)", "tu (?:as demandé|cherches|veux)", "(?:nous n'avons|on n'a|nous ne vendons|on ne vend) pas(?: de| d'| des)?",
  "طلبت(?:ي)?", "سألت(?:ي)? عن", "بد(?:ّ)?ك", "بدكن", "عم تدو(?:ّ)?ر(?:ي)? على", "ما عنا", "ما عندنا", "ما في عنا", "ما منبيع",
  "talabt(?:e|i)?", "sa2alt(?:e|i)? 3an", "badd?(?:ak|ik|kon)", "3am tdawwer(?:e|i)? 3a", "ma 3a[n]+a", "ma 3enna", "ma fi 3anna",
].map((f) => `(?:^|[^\\p{L}])${f}(?![\\p{L}])`).join("|"), "gu");
const CLAUSE_END = /[.,!?؟،;:\n]|\b(?:but|and it|it is|it's|mais)\b|(?<![\p{L}])(?:بس|لكن)(?![\p{L}])/u;

/** The text with the customer's request said back taken out, when every food word in it is one the customer used this turn. */
export function withoutEchoes(t: string, customerWords: string | undefined): string {
  const said = normaliseForGuard(customerWords ?? "");
  if (!said.trim()) return t;
  const asked = new Set(FOOD_TERMS.filter(([, re]) => re.test(said)).map(([a]) => a));
  let out = t;
  for (const m of [...t.matchAll(REQUEST_FRAME)].reverse()) {
    const from = m.index! + m[0].length;
    const rest = t.slice(from);
    const stop = CLAUSE_END.exec(rest);
    const phrase = stop ? rest.slice(0, stop.index) : rest;
    const terms = FOOD_TERMS.filter(([, re]) => re.test(phrase)).map(([a]) => a);
    if (!terms.length || !terms.every((a) => asked.has(a))) continue;
    out = out.slice(0, from) + ` ${ECHO} ` + out.slice(from + phrase.length);
  }
  return out;
}

// Where a fact comes from, said in the reply: the pack, the label, the certificate, the maker or the kitchen's declaration.
const SOURCE = /\b(?:pack|packet|package|label|box|bottle|wrapper|certificate|certified)\b|\b(?:the )?pack(?:et)? says\b|according to|declared by|the (?:maker|brand|vendor|kitchen) (?:says|declares)|l'emballage|l'étiquette|le paquet|selon|déclaré|العلبة|عالعلبة|على العلبة|الملصق|عالملصق|الكيس|عالكيس|مكتوب|حسب|بحسب|الشهادة|\b3al? (?:3elbe|3ilbe|el 3elbe)\b|\bmaktoub\b|\bmektoub\b/u;

// ---------- B1e: where we deliver ----------
// A sentence that says we do, or do not, deliver to a place. Delivery areas come only from the database (invariant 7, as for prices): the
// model may say it only for a place a tool returned this turn with that answer. Text is folded by normaliseForGuard (lower case).
const AREA_NO = new RegExp([
  "\\b(?:we |i )?(?:don't|do not|can't|cannot|can not|won't|will not|are not able to|aren't able to)(?: yet)? (?:deliver|ship|cover|serve|go)\\b",
  "\\bno deliver(?:y|ies) (?:to|in|for|there|at)\\b", "\\b(?:delivery|deliveries) (?:isn't|is not|aren't|are not)(?: yet)? (?:available|possible)\\b",
  "\\bnot(?: yet)? (?:in|within|part of|inside|covered by) (?:our|the) (?:delivery |service )?(?:area|zone|range|coverage)\\b",
  "\\b(?:outside|out of|beyond) (?:of )?(?:our|the) (?:delivery |service )?(?:area|zone|range|coverage)\\b", "\\b(?:isn't|is not|not)(?: yet)? (?:served|covered|deliverable)\\b",
  "\\b(?:on|nous) ne (?:livr(?:e|ons)|dessert|desservons|couvr(?:e|ons)) pas\\b", "\\bpas (?:encore )?de livraison\\b", "\\bhors (?:de )?(?:notre |la )?zone\\b",
  "\\bn'est pas (?:encore )?(?:desservi|couvert|livrable)",
  "ما (?:منوص(?:ّ)?ل|بنوص(?:ّ)?ل|فينا نوص(?:ّ)?ل|منغط(?:ّ)?ي|منخدم|منطلع)", "ما في توصيل", "ما (?:عنا|عندنا|عندو|عنده|في عنا) توصيل", "ما بيوصل(?:و|ا)? التوصيل",
  "مش (?:ضمن|ب)منطقت(?:نا|ن)", "(?:خارج|برّا|برا) (?:منطقة|منطقتنا|المنطقة|نطاق)", "التوصيل (?:مش|غير) (?:متاح|متوفر|موجود)", "لا يوجد توصيل",
  "\\bma (?:mn|mni|bn|bni|mna|fina n|fina)?(?:wass?(?:e|i)l|wasel|wassel)\\b", "\\bma fi taws(?:ee|i|ea)l\\b", "\\bma (?:3and(?:o|na|kon)?|3anna|3enna) taws(?:ee|i|ea)l\\b",
  "\\b(?:mesh|msh|mish) (?:b|bi|bel)?mant(?:e|i)2(?:a|e|itna|etna)\\b", "\\bbarra (?:el |l )?mant(?:e|i)2(?:a|e|itna|etna)\\b",
].join("|"), "u");
const AREA_YES = new RegExp([
  "\\bwe (?:do |can |will |also )?(?:deliver|ship) (?:to (?!you\\b|your\\b|the door\\b)|there\\b|all over|across)", "\\byes,? we deliver\\b",
  "\\bwe (?:do )?(?:cover|serve) (?!you\\b)\\p{L}", "\\b(?:is|are) (?:in|within|inside|covered by) (?:our|the) (?:delivery |service )?(?:area|zone|range|coverage)\\b",
  "\\b(?:delivery|deliveries) (?:to|in) [\\p{L} ]{1,30}? (?:is|are) (?:available|possible)\\b",
  "\\b(?:on|nous) livr(?:e|ons) (?:à|a|au|aux|en|dans|là|partout)\\b", "\\b(?:on|nous) (?:dessert|desservons)\\b",
  "(?:^|[^\\p{L}])(?:منوص(?:ّ)?ل|بنوص(?:ّ)?ل|منغط(?:ّ)?ي|منخدم)(?![\\p{L}])", "في توصيل (?:على|ع|عل|ل|لـ|ل)", "(?:ضمن|ب)منطقت(?:نا|ن)",
  "\\b(?:mn|mni|bn|bni)(?:wass?(?:e|i)l)\\b", "\\bfi taws(?:ee|i|ea)l (?:3a|la|3al|l)\\b", "\\b(?:b|bi|bel)mant(?:e|i)2(?:itna|etna)\\b",
].join("|"), "u");
/** A place's name folded for comparison: alef forms, taa marbuta, diacritics and tatweel; lower case. */
const foldPlace = (x: string) => normaliseForGuard(x).replace(/[أإآ]/gu, "ا").replace(/ة/gu, "ه").replace(/[ً-ْ]/gu, "");
/** The places of `areas` the sentence names, as whole words (an Arabic name may carry one clitic: «لبطمة», «عبعقلين»). */
function placesNamed(s: string, areas: NonNullable<CheckOptions["areas"]>): { served: boolean }[] {
  const t = foldPlace(s);
  return areas.filter((a) => a.names.some((n) => {
    const f = foldPlace(String(n ?? "")).trim();
    if (f.length < 2) return false;
    const esc = f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?<![\\p{L}\\p{N}])(?:(?:و|ف)?(?:ل|ب|ع|عل|لل|من))?${esc}(?![\\p{L}\\p{N}])`, "u").test(t);
  }));
}
/** A sentence that says where we deliver, against what the tools said this turn. Null when it may be sent. */
function areaClaim(t: string, areas: NonNullable<CheckOptions["areas"]>): string | null {
  for (const s of t.split(/[.!?؟؛;\n]+/u).map((x) => x.trim()).filter(Boolean)) {
    const no = AREA_NO.exec(s);
    const yes = no ? null : AREA_YES.exec(s);
    const m = no ?? yes;
    if (!m) continue;
    const served = !no;
    const named = placesNamed(s, areas);
    if (named.length) { if (named.every((a) => a.served === served)) continue; return m[0].trim(); }
    // naming no place a tool returned: allowed only when the turn's tools returned exactly one place, with this answer ("we deliver there")
    const mentionsOther = /(?<![\p{L}])(?:to|la|3a|à|au)\s+(?!you\b|your\b|there\b|here\b|el\b|l\b|the\b|3andak\b|3andik\b)\p{L}|(?<![\p{L}])(?:على|لـ)\s*\p{L}/u.test(s);
    if (!mentionsOther && areas.length === 1 && areas[0]!.served === served) continue;
    return m[0].trim();
  }
  return null;
}

// ---------- B1e: the conversation's language ----------
/** The model's own words in a language other than the conversation's (sim-021: English to an Arabizi customer). Names are taken out first. */
function otherLanguage(t: string, expected: Speech): string | null {
  const said = wordsLanguage(t.replace(MARKS, " ").split(ECHO).join(" "));
  if (!said) return null;
  const arabicSide = expected === "ar" || expected === "arabizi";
  if (said.speech === "ar") return arabicSide ? null : (said.strong ? "ar" : null);
  if (!said.strong) return null;
  if (arabicSide) return said.speech === "arabizi" ? null : said.speech;
  return said.speech === expected ? null : said.speech;
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
  if (opts.catalogueReady === false) { const m = CATALOGUE_OFFER.exec(t); if (m) return { code: "catalogue_claim", match: m[0].trim() }; }
  for (const re of SENSITIVE) { const m = re.exec(t); if (m) return { code: "sensitive_inference", match: m[0].trim() }; }
  // B1e: where we deliver is the database's to say, for the place it was asked of (sim-021).
  if (opts.areas) { const a = areaClaim(t, opts.areas); if (a) return { code: "area_claim", match: a }; }
  // PD1 (e): names a tool returned this turn and the customer's request said back are taken out; the rest is checked as before.
  const named = withoutNames(t, opts.products);
  if (opts.replyLanguage) { const l = otherLanguage(named, opts.replyLanguage); if (l) return { code: "wrong_language", match: l }; }
  const rest = withoutEchoes(named, opts.customerWords);
  // A quality word in a clause that declines to judge («I can't say which is healthiest») is the refusal the rules ask for, not a
  // judgement (K1: B4's live run refused it). A comma or a contrast word starts a new clause, so "I can't rank them, X is the best" fails.
  for (const c of opts.skipQuality ? [] : clauses(rest)) {
    if (DECLINE.test(c)) continue;
    for (const re of QUALITY) { const m = re.exec(c); if (m) return { code: "quality_judgement", match: m[0].trim() }; }
  }
  for (const s of sentences(rest)) {
    const foods = FOOD_TERMS.filter(([, re]) => re.test(s));
    if (foods.length === 0) continue;
    // An offer to filter by a kind of fact («I can filter by allergens where we have approved records») names the category, not
    // a fact about a product (K1). Only the category words may appear: "filter: these are nut-free" is still a claim.
    if (FILTER_OFFER.test(s) && !FOOD_TERMS.some(([, re]) => re.test(s.replace(FOOD_CATEGORY, " ")))) continue;
    // Never "safe" or "no problem" next to an allergy or diet word, whatever the record says: the kitchen confirms, not us.
    const calm = REASSURE.exec(s);
    if (calm && foods.some(([a]) => a === "allergens" || a === "gluten")) return { code: "allergy_reassurance", match: calm[0] };
    if (UNCERTAIN.test(s) || THEIR_OWN.test(s)) continue;
    const unapproved = foods.find(([a]) => !factUnlocked(a, s, opts));
    if (unapproved) return { code: "unapproved_food_claim", match: (unapproved[1].exec(s)?.[0] ?? unapproved[0]).trim() };
  }
  return null;
}

/**
 * May this sentence state a fact of this attribute? With records by product (PD1), only for a product the sentence names whose record
 * covers it, or for the one product with such a record when the sentence names none, and only with its source said. Without them, the
 * attribute-group rule of 1.10 (used by the wording evals).
 */
function factUnlocked(attribute: string, s: string, opts: CheckOptions): boolean {
  const byProduct = opts.approvedByProduct;
  if (!byProduct) return !!opts.approvedFacts?.has(attribute);
  if (!SOURCE.test(s.replace(MARKS, " "))) return false;
  const ids = (opts.products ?? []).map((p) => p.id);
  const named = [...s.matchAll(MARKS)].map((m) => ids[m[1]!.charCodeAt(0) - 0xE100]).filter((x): x is string => !!x);
  const covering = [...byProduct.entries()].filter(([, attrs]) => attrs.has(attribute)).map(([id]) => id);
  if (named.length) return named.some((id) => covering.includes(id));
  return covering.length === 1;
}

/** What the model is told when its text is refused, so it can reword instead of repeating itself. */
export const GUARD_HINT: Record<GuardCode, string> = {
  quality_judgement: "Never call a merchant, dish or product good, bad, best, tasty or healthy, never recommend one and never give a rating. Present options by measurable facts (what was asked for, availability, size) and let the customer choose, or ask what matters to them.",
  unapproved_food_claim: "No approved record for this food fact came back from a tool for this product. Say you cannot confirm it yet, and offer to ask the merchant or suggest checking the label. Product names exactly as the tools returned them are fine; with an approved record, name the product and say where the fact comes from (\"the pack says ...\").",
  allergy_reassurance: "Never reassure about an allergy or a diet. Pass it on as an allergy and say the kitchen must confirm before the order is accepted.",
  sensitive_inference: "Never mention or infer a religion, health condition or diet from a name, a place or past orders. Ask only what the customer wants to exclude.",
  too_long: "Your own words are at most two short sentences, each under 120 characters. Say one thing: ask the one question that matters, or offer the choices as buttons (at most three). Lists, cards and totals are sent by the system.",
  minimum_by_code: "Do not mention the minimum order: the system already tells the customer the minimum, their basket and what is missing, with buttons. Answer the rest of their message, or ask what they want to add.",
  change_claim: "Never say the order or basket was changed unless quote_order changed it this turn. To change it, call quote_order with the new lines (and remove), then send_confirmation for the new card; or ask what to change.",
  catalogue_claim: "Say only what a tool returned about the catalogue, and never offer the catalogue while it is not connected: ask what they need in words. Before saying a product is the only one or that there is no other, call search_catalog for it this turn; never say the catalogue is not ready (call show_catalog: the system answers if it cannot be shown).",
  area_claim: "Never say whether we deliver to a place, or what delivery costs or how long it takes: only the system says it, from the database. If the customer asks, the system answers; if the plan has no village or does not recognise it (no_delivery_village, village_not_recognised), ask for the village or a location pin.",
  wrong_language: "Write in the customer's own language and script (reply_language), as they write: never switch to another language. Product names stay as the tools returned them.",
  money_in_free_text: "Prices, fees and totals are never written in free text. Leave amounts out: pass the product ids in `price_of` and the system adds prices from the database, or call quote_order and send_confirmation so the card shows the total.",
};
