// Alcohol exclusion (P0-1): one pure classifier driven by the data we hold about an item (the contains_alcohol flag, the section name, the dish name)
// plus a brand/keyword list in Arabic, English and Arabizi. Alcohol is never searched, listed, suggested or added to a basket. No I/O.

export type AlcoholLite = { item_name_en?: string | null; item_name_ar?: string | null; name_en?: string | null; name_ar?: string | null; section?: string | null; contains_alcohol?: boolean | null };

const AR_DIACRITICS = /[ً-ٰٟـ]/g;
/** Lower-case, Latin accents and Arabic diacritics stripped, alef/ya/ta-marbuta unified, punctuation to spaces. */
export const alcNorm = (s: unknown): string =>
  String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(AR_DIACRITICS, "").toLowerCase()
    .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/[^a-z0-9؀-ۿ]+/g, " ").replace(/\s+/g, " ").trim();

// Whole words or phrases. Arabizi digits stand for Arabic letters (3 = ع, 7 = ح).
const STRONG_RAW = [
  // categories
  "alcohol", "alcoholic", "beer", "beers", "wine", "wines", "whisky", "whiskey", "whiskies", "vodka", "arak", "araq", "liquor", "liquors", "spirits", "champagne", "prosecco", "tequila", "cognac", "brandy", "scotch", "bourbon", "lager", "cider", "liqueur", "vermouth", "absinthe", "ouzo",
  // brands
  "almaza", "amstel", "heineken", "budweiser", "carlsberg", "becks", "stella artois", "tuborg", "guinness", "moretti", "peroni", "mbeer", "johnnie walker", "johnny walker", "jack daniel", "jack daniels", "jameson", "chivas", "glenfiddich", "glenlivet", "ballantine", "ballantines", "dewars", "grey goose", "absolut", "smirnoff", "belvedere", "baileys", "jagermeister", "martini", "campari", "aperol", "hennessy", "remy martin", "bacardi", "captain morgan", "havana club", "jose cuervo", "chateau ksara", "chateau kefraya", "chateau musar", "ksara reserve", "red label", "black label",
  // Arabic
  "كحول", "كحولي", "كحوليه", "مشروبات كحوليه", "مشروبات روحيه", "خمر", "خمور", "بيره", "بيرا", "نبيذ", "ويسكي", "وسكي", "فودكا", "عرق", "تيكيلا", "كونياك", "شمبانيا", "الماظه", "املاظه", "امستل", "هاينكن", "هاينيكن", "بدوايزر", "كارلسبرغ", "تيوبورغ", "جاك دانيلز", "جوني ووكر", "جوني واكر", "ريد ليبل", "بلاك ليبل", "شيفاس", "سمير نوف", "ابسولوت", "كسارا", "كفريا", "شاتو ميزار", "مسايا",
  // Arabizi
  "bira", "beera", "nbeez", "nabeez", "nabiz", "nbiz", "wiski", "wisky", "ouiski", "weski", "fodka", "3arak", "3araq", "3rak", "3raq", "arrak", "shampania",
];
// Ambiguous words: alcohol only when they are the whole name or sit next to a drink word ("Gin & Tonic", "Rum shot", "Corona bottle").
const WEAK_RAW = ["ksara", "kefraya", "massaya", "musar", "double black", "gin", "rum", "ale", "sake", "stout", "jager", "corona", "efes", "laziza", "stella", "white label", "blue label", "gold label", "green label", "gold reserve", "جن", "رم", "ستيلا"];
const WEAK_COMPANION = /\b(?:shot|shots|bottle|bottles|glass|glasses|tonic|cocktail|beer|lager|premium|draft|draught)\b|زجاجه|كاس|كاسه|قنينه|شوت/;
const STRONG = STRONG_RAW.map(alcNorm), WEAK = WEAK_RAW.map(alcNorm);

/** Wording that makes a boozy-looking name safe: root/ginger beer, malt drinks, "0%", "alcohol free", licorice "arak soos". */
const SAFE_NAME = /\b(?:non alcoholic|nonalcoholic|alcohol free|zero alcohol|0 alcohol|0 0|zero|root beer|ginger beer|ginger ale|malt drink|malt beverage|moussy|barbican|malta|mocktail|virgin|sparkling grape|grape juice|vinegar|licorice|liquorice|wine leaves|vine leaves|arak soos|arak sous|erk soos|erk sous|3erk soos|3erk sous|ar2 soos)\b|(?:beer|wine|cognac|bourbon|champagne|tequila|brandy|rum|cider|whisky|whiskey|vodka|arak)(?: \w+)? (?:battered|sauce|glaze|glazed|braised|reduction|cake|baba|infused|marinated|chicken|steak|bbq|lime|vinaigrette|dressing)|baba au rhum|بدون كحول|خالي من الكحول|خاليه من الكحول|عديم الكحول|بلا كحول|زيرو|عرق سوس|عرق ورد|عرق حلو|مالت/;
const ALC_SECTION = /\b(?:alcohol|alcoholic|beers?|wines?|spirits|liquors?|whisk(?:e)?y|whiskies|vodka|arak|champagne)\b|كحول|كحوليه|خمور|خمر|بيره|نبيذ|مشروبات روحيه|ويسكي|فودكا|عرق|امستل|الماظه/;

const hasPhrase = (hay: string, phrase: string) => ` ${hay} `.includes(` ${phrase} `);

function nameHit(name: string): boolean {
  if (!name || SAFE_NAME.test(name)) return false;
  if (STRONG.some((w) => hasPhrase(name, w))) return true;
  const n = name.split(" ").length;
  return WEAK.some((w) => hasPhrase(name, w) && (n === w.split(" ").length || WEAK_COMPANION.test(name)));
}
const sectionHit = (section: string): boolean => !!section && !SAFE_NAME.test(section) && ALC_SECTION.test(section);

/** True when the item is alcohol: flagged in the data, in an alcohol section, or named like a beer, wine, spirit or known brand. */
export function isAlcohol(it: AlcoholLite | null | undefined): boolean {
  if (!it) return false;
  if (it.contains_alcohol === true) return true;
  if (sectionHit(alcNorm(it.section))) return true;
  return nameHit(alcNorm(it.item_name_en ?? it.name_en)) || nameHit(alcNorm(it.item_name_ar ?? it.name_ar));
}

/** The items a customer may be shown or sold. */
export const withoutAlcohol = <T extends AlcoholLite>(items: T[]): T[] => items.filter((it) => !isAlcohol(it));

/** The customer ASKED for alcohol ("beer", "bottle of arak", "red label", "بيرة"): answered with a fixed polite line, never with a search. */
export function asksForAlcohol(text: string): boolean {
  const t = alcNorm(text);
  if (!t || t.split(" ").length > 5 || t.length > 60 || SAFE_NAME.test(t) || /\b(?:no|without|sans|bala|bdon)\b|بدون|بلا/.test(t)) return false; // a short request mainly about the drink; "no wine sauce please" or "beer battered onion rings?" go to the normal flow
  return STRONG.some((w) => hasPhrase(t, w)) || WEAK.some((w) => t === w);
}

export const alcoholRefusal = (ar: boolean) => ar
  ? "ما منوصّل كحول عبر ألو كينغ 🙏 بس عنا عصاير ومشروبات وأكل حلو. شو بتحب تاكل؟"
  : "We don't deliver alcohol through Alo King 🙏 but we have plenty of juices, drinks and great food. What are you craving?";
