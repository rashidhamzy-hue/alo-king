// Output checks on text the model wrote. Fixed texts and cards are built by code from the database and never pass here;
// only the Concierge's free text does (the `reply` and `ask_location_pin` tools). A failed check means the text is not sent:
// the model is told why and rewords, or the loop runs out of steps and a person takes over. Fail closed.
//
// 1.5 Money: no price, fee or total in free text. Amounts reach the customer only on the card, or through `reply`'s
//     `price_of`, which code fills from quote_order.

export type GuardCode = "money_in_free_text";
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

/** Every check that applies to text written by the model. Returns the first violation, or null when the text may be sent. */
export function checkModelText(text: string): Violation | null {
  const money = moneyInText(text);
  if (money) return { code: "money_in_free_text", match: money };
  return null;
}

/** What the model is told when its text is refused, so it can reword instead of repeating itself. */
export const GUARD_HINT: Record<GuardCode, string> = {
  money_in_free_text: "Prices, fees and totals are never written in free text. Leave amounts out: pass the product ids in `price_of` and the system adds prices from the database, or call quote_order and send_confirmation so the card shows the total.",
};
