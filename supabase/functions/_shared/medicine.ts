// Medicines are never ordered or sold through Alo King (DECISIONS §38.3, the Order of Pharmacists' ruling of 2 June 2026).
// "Antibiotic-free chicken" says what a food is without (§39.15.4 review): such a claim is set aside before the medicine
// check, but only when a food word sits next to it, so "I have no antibiotics left, can you bring some" stays a medicine
// request. Used by the customer's refusal (dispatch/customer/intents.ts) and the catalogue's medicine rule
// (catalog-rules.ts). The text is expected normalized by the caller (lower case, no accents, ة as ه).

/** "antibiotic(s) free", "free from/of antibiotics", "no/without antibiotics", "sans antibiotiques", "بدون مضادات حيوية". */
const CLAIM =
  /\bantibiotics?[ -]?free\b|\bfree (?:from|of) antibiotics?\b|\b(?:no|without) antibiotics?\b|\bsans antibiotiques?\b|(?:بدون|بلا|خالي من|خاليه من) (?:ال)?مضاد(?:ات)? (?:ال)?حيوي(?:ه)?/g;

/** The foods such a claim is made about (poultry, meat, eggs, milk and their cuts). */
const FOOD =
  /\b(?:chickens?|djej|dajaj|farrouj|poulets?|meat|lahme|lahmeh|viande|beef|boeuf|veal|lamb|agneau|turkey|dinde|eggs?|oeufs?|beid|bayd|milk|lait|halib|breasts?|wings?|thighs?|drumsticks?|fillets?|escalopes?|tawouk|taouk|kafta|burgers?)\b|دجاج|فروج|لحم|بيض|حليب|ديك حبش|صدر|جوانح|طاووق|كفته/;

/** How far a food word may sit from the claim, in characters (about three words). */
const NEAR = 32;

/** The text without its food antibiotic claims ("antibiotic-free chicken"); any other mention of antibiotics stays. */
export function stripFoodAntibioticClaims(t: string): string {
  return t.replace(CLAIM, (m: string, offset: number, s: string) => {
    const around = `${s.slice(Math.max(0, offset - NEAR), offset)} ${s.slice(offset + m.length, offset + m.length + NEAR)}`;
    return FOOD.test(around) ? " " : m;
  });
}
