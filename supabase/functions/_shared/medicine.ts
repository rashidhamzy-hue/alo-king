// Medicines are never ordered or sold through Alo King (DECISIONS §38.3, the Order of Pharmacists' ruling of 2 June 2026).
// One word list for the customer's refusal (dispatch/customer/intents.ts) and the catalogue's medicine rule
// (catalog-rules.ts), so a word one of them knows the other knows too. "Antibiotic-free chicken" says what a food is
// without (§39.15.4 review): such a claim is set aside before the check, but only when a food word sits in the same
// clause within three words of it, so "I have no antibiotics left, can you bring some" stays a medicine request.
// The text is expected normalized by the caller (lower case, no accents, œ as oe, ة as ه, ا for أ إ آ).

/** Latin and Arabizi words, matched whole. */
const LATIN = [
  "medicine",
  "medicines",
  "medication",
  "medications",
  "meds",
  "pharmacy",
  "pharmacie",
  "prescription",
  "ordonnance",
  "medicament",
  "medicaments",
  "antibiotic",
  "antibiotics",
  "antibiotique",
  "antibiotiques",
  "painkiller",
  "painkillers",
  "panadol",
  "paracetamol",
  "doliprane",
  "aspirin",
  "aspirine",
  "ibuprofen",
  "advil",
  "brufen",
  "augmentin",
  "insulin",
  "insuline",
  "cough syrup",
  "sirop pour la toux",
  "sirop contre la toux",
  "dawa",
  "dawe",
  "dewe",
  "adwye",
  "adwiye",
  "saydaliye",
  "saydaleyye",
  "saydalieh",
];
/**
 * Arabic words matched whole, with ال and its clitics (الدوا, بالدواء, للدوا): دوار ("dizzy", a roundabout) must not read
 * as دوا, nor بدوا ("they want") as ب + دوا, so a one-letter clitic counts only before ال.
 */
const ARABIC_WHOLE = ["دوا", "دواء", "دوائي"];
const ARABIC_PREFIX = "(?:[وفبلك]?ال|لل)?";
/**
 * Arabic words matched inside a word too (Arabic joins ل, بال, و to the word that follows). Not دويه: it is inside يدويه
 * ("handmade") and بدويه ("Bedouin"); ادويه already finds the plural with any clitic.
 */
const ARABIC_INSIDE = [
  "ادويه",
  "صيدليه",
  "وصفه طبيه",
  "روشته",
  "حبوب وجع",
  "حبوب للوجع",
  "بانادول",
  "بنادول",
  "انسولين",
];
/** Patterns matched inside a word: an antibiotic in any of its forms (مضاد حيوي, المضادات الحيويه), "my medicines". */
const ARABIC_PATTERNS = ["مضاد(?:ات)?\\s+(?:ال)?حيوي", "ادويت"];

const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
const LETTER = "a-z0-9\\u0600-\\u06ff";
const MEDICINE = new RegExp(
  [
    `(?<![${LETTER}])(?:${LATIN.map(esc).join("|")})(?![${LETTER}])`,
    `(?<![${LETTER}])${ARABIC_PREFIX}(?:${ARABIC_WHOLE.map(esc).join("|")})(?![${LETTER}])`,
    ARABIC_INSIDE.map(esc).join("|"),
    ARABIC_PATTERNS.join("|"),
  ].join("|"),
);

/** The first medicine word in a normalized text, or null. */
export function findMedicine(t: string): string | null {
  return t.match(MEDICINE)?.[0] ?? null;
}

/**
 * "antibiotic(s) free", "free from/of antibiotics", "no/without/w/o antibiotics" (w/o reads "w o" once normalized),
 * "sans antibiotiques", "بدون مضادات حيوية".
 */
const CLAIM =
  /\bantibiotics?[ -]?free\b|\bfree (?:from|of) antibiotics?\b|\b(?:no|without|w o) antibiotics?\b|\bsans antibiotiques?\b|(?:بدون|بلا|خالي من|خاليه من) (?:ال)?مضاد(?:ات)? (?:ال)?حيوي(?:ه)?/g;

/** The foods such a claim is made about (poultry, meat, fish, eggs, milk and their cuts). */
const FOOD =
  /\b(?:chickens?|djej|dajaj|farrouj|poulets?|poultry|volaille|hens?|poules?|meat|lahme|lahmeh|viande|beef|boeuf|veal|lamb|agneau|turkey|dinde|fish|poisson|samak|salmon|saumon|eggs?|oeufs?|beid|bayd|milk|lait|halib|wings?|thighs?|drumsticks?|fillets?|escalopes?|tawouk|taouk|kafta|burgers?)\b|دجاج|فروج|دواجن|لحم|سمك|سلمون|بيض|حليب|ديك حبش|جوانح|طاووق|كفته/;

/** The word clause punctuation becomes: lower-case Latin letters, which both normalizers keep. */
const MARK = "clausemark";
/**
 * Clause punctuation as a word: call before normalizing, which turns punctuation into spaces, so "no antibiotics,
 * 2 chicken" keeps its two clauses.
 */
export const markClauses = (raw: string): string => raw.replace(/[,.;:!?؟،؛\n]+/g, ` ${MARK} `);

const AT_MARK = new RegExp(`(?:^|\\s)${MARK}(?=\\s|$)`);
/** A spoken "and" in four languages, as a word of its own: it ends a clause. */
const SPOKEN_AND = /(?:^|\s)(?:and|et|w|و)(?=\s|$)/;
/** How many words on each side of the claim may name the food. */
const WORDS = 3;
const words = (t: string) => t.trim().split(/\s+/).filter(Boolean);
const last = <T>(xs: T[]) => xs[xs.length - 1];

/**
 * The words before a claim, in its own clause. A claim that opens a clause after punctuation ("Chicken breast, antibiotic
 * free") reads the end of the clause before it; after a spoken "and" it does not.
 */
const wordsBefore = (side: string): string => {
  const marked = side.split(AT_MARK);
  const own = last(marked).split(SPOKEN_AND);
  let near = words(last(own));
  if (!near.length && own.length === 1 && marked.length > 1)
    near = words(last(marked[marked.length - 2].split(SPOKEN_AND)));
  return near.slice(-WORDS).join(" ");
};

/** The words after a claim, in its own clause only ("no antibiotics, 2 chicken" is not about the chicken). */
const wordsAfter = (side: string): string =>
  words(side.split(AT_MARK)[0].split(SPOKEN_AND)[0]).slice(0, WORDS).join(" ");

/** The text without its food antibiotic claims ("antibiotic-free chicken"); any other mention of antibiotics stays. */
export function stripFoodAntibioticClaims(t: string): string {
  return t.replace(CLAIM, (m: string, offset: number, s: string) => {
    const around = `${wordsBefore(s.slice(0, offset))} ${wordsAfter(s.slice(offset + m.length))}`;
    return FOOD.test(around) ? " " : m;
  });
}
