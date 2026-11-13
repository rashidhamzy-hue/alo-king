// Our vocabulary (migration 0021's food_attributes) and the fixed tables that connect Open Food Facts to it.
// Everything here is plain data and plain code. No model decides what a tag means.

/** The fourteen allergens of food_attributes, by code. */
export const ALLERGEN_CODES = ["gluten", "crustaceans", "eggs", "fish", "peanuts", "soy", "milk", "tree_nuts", "celery", "mustard", "sesame", "sulphites", "lupin", "molluscs"];

/** Open Food Facts allergen tags (allergens_tags, traces_tags) -> our code. A tag we do not list is left out, not guessed. */
export const OFF_ALLERGEN_TAGS = {
  "en:gluten": "gluten",
  "en:crustaceans": "crustaceans",
  "en:eggs": "eggs",
  "en:fish": "fish",
  "en:peanuts": "peanuts",
  "en:soybeans": "soy",
  "en:milk": "milk",
  "en:nuts": "tree_nuts",
  "en:celery": "celery",
  "en:mustard": "mustard",
  "en:sesame-seeds": "sesame",
  "en:sulphur-dioxide-and-sulphites": "sulphites",
  "en:lupin": "lupin",
  "en:molluscs": "molluscs",
};

/** Label claims (labels_tags) that state a diet attribute outright. A claim on the pack is a proposal for a person to check on the pack. */
export const OFF_LABEL_DIET = { "en:halal": ["halal", "yes"], "en:vegan": ["vegan", "yes"], "en:vegetarian": ["vegetarian", "yes"] };

/** Open Food Facts' own analysis of the ingredient list (ingredients_analysis_tags). Maybe and unknown tags say nothing. */
export const OFF_ANALYSIS_DIET = {
  "en:vegan": ["vegan", "yes"], "en:non-vegan": ["vegan", "no"],
  "en:vegetarian": ["vegetarian", "yes"], "en:non-vegetarian": ["vegetarian", "no"],
};

// A quote has to be about the allergen it is filed under. These are the words that make it so, in English, French and Arabic
// (the languages the packs carry). The list is deliberately plain: a quote with none of them is refused, so a model that files
// "sugar" under milk is caught here, and a synonym we do not list costs a proposal, never a wrong one.
const KEYWORDS = {
  gluten: /wheat|\bble\b|barley|orge|\brye\b|seigle|\boats?\b|avoine|spelt|epeautre|kamut|semolina|semoule|gluten|malt\b|durum|couscous|bulgur|cereal|قمح|غلوتين|شعير|جاودار|شوفان|سميد|برغل|كسكس|حبوب/,
  crustaceans: /crustac|shrimp|prawn|\bcrab|lobster|crevette|homard|langoustine|krill|قشريات|جمبري|روبيان|سرطان البحر|كركند/,
  eggs: /\begg|oeuf|œuf|albumen|ovalbumin|lysozyme|بيض/,
  fish: /\bfish|poisson|anchov|\btuna|\bthon\b|salmon|saumon|\bcod\b|sardine|mackerel|maquereau|سمك|تونة|سلمون|أنشوجة|انشوجة|سردين/,
  peanuts: /peanut|groundnut|cacahu|arachide|فول سوداني|فستق عبيد/,
  soy: /\bsoy|soja|soya|صويا/,
  milk: /\bmilk|\blait\b|dairy|\bwhey|lactose|casein|butter|beurre|cream|creme|cheese|fromage|yogh?urt|yaourt|\bghee\b|حليب|لبن|جبن|زبدة|قشطة|كريمة|مصل|لاكتوز|كازين/,
  tree_nuts: /\bnuts?\b|almond|hazelnut|walnut|cashew|pistach|pecan|macadamia|brazil nut|\bnoix|amande|noisette|pistache|لوز|بندق|جوز|كاجو|فستق|مكسرات/,
  celery: /celery|celeri|كرفس/,
  mustard: /mustard|moutarde|خردل/,
  sesame: /sesame|tahin|طحينة|سمسم/,
  sulphites: /sulph|sulf|sulphur|sulfur|\bso2\b|\be22[0-8]\b|كبريت/,
  lupin: /lupin|ترمس/,
  molluscs: /mollus|squid|octopus|mussel|oyster|\bclam|snail|calamar|moule|huitre|رخويات|حبار|أخطبوط|اخطبوط|محار/,
};

/** Lower case, without accents or Arabic marks, for the keyword check only. The stored quote keeps the source's own letters. */
export function fold(s) {
  return String(s ?? "").normalize("NFKD").replace(/\p{M}/gu, "").replace(/ـ/g, "").toLowerCase();
}

export function quoteFitsAllergen(code, quote) {
  const re = KEYWORDS[code];
  return !!re && re.test(fold(quote));
}

/** Words a name or a category may not gain on the way to a customer: praise, health, diet and religion claims (invariants 14-16).
 *  A word already in the catalog's own name is the catalog's business and is not a proposal. */
export const CLAIM_WORDS = [
  "best", "better", "top", "premium", "finest", "delicious", "tasty", "healthy", "health", "organic", "natural", "fresh", "pure", "light", "diet",
  "halal", "haram", "kosher", "vegan", "vegetarian", "fasting", "lent", "gluten", "sugar", "lactose", "allergy", "popular", "favourite", "favorite", "recommended", "quality",
  "افضل", "أفضل", "ممتاز", "لذيذ", "صحي", "صحية", "عضوي", "طبيعي", "طازج", "حلال", "نباتي", "صيامي", "ديت", "مميز", "فاخر", "الأكثر مبيعا", "الاكثر مبيعا",
];

const claimRe = (w) => (/^[a-z]+$/.test(w) ? new RegExp(`\\b${w}\\b`, "i") : new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
const CLAIM_RES = CLAIM_WORDS.map((w) => [w, claimRe(w)]);

/** Claim words that appear in `text` and not in `source`. */
export function addedClaimWords(text, source) {
  const t = String(text ?? ""); const s = String(source ?? "");
  return CLAIM_RES.filter(([, re]) => re.test(t) && !re.test(s)).map(([w]) => w);
}
