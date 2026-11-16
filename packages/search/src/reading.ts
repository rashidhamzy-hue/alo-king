// SR1 (4): the reading step for search. The customer's words become the filters as structured data: a ceiling or a floor on a nutrient,
// a printed claim, an allergy or a diet (a restriction, never a preference: invariant 16), an animal and its life stage, an age, an
// audience, a count of people, a budget, a basket (a dish for N, a week of lunchbox snacks, a budget). What is left is the kind of thing
// asked for ("snacks", «ألواح بروتين»), which goes to find_products as the query. Code, not a model: the same words always read the same,
// and every reading bug becomes a case in evals/cases/sr1_search_reading.json before its fix. No value here is a fact about a product:
// the filters only ask; find_products answers from approved records (invariant 15).
// The website's search page reads its box with this same function (invariant 19). It lives in its own package (packages/search) so the
// website can import it without importing agent code, and the agents without the commerce client (the fence of invariant 4).

export type Allergen = "gluten" | "crustaceans" | "eggs" | "fish" | "peanuts" | "soy" | "milk" | "tree_nuts" | "celery" | "mustard" | "sesame" | "sulphites" | "lupin" | "molluscs";
export type Diet = "vegan" | "vegetarian" | "halal" | "fasting";
export interface SearchFilters {
  sugar?: "none" | "low"; protein?: "high"; fat?: "low" | "none"; salt?: "low" | "none";
  nutrients?: { key: "sugars_g" | "protein_g" | "fat_g" | "salt_g"; max?: number; min?: number }[];
  claims?: string[]; free_of?: Allergen[]; diet?: Diet[];
  species?: "dog" | "cat" | "bird" | "fish"; life_stage?: ("baby" | "young" | "adult" | "senior" | "all")[]; age_months?: number;
  audience?: "kids" | "baby"; tags?: string[]; prefer_tags?: string[]; max_price_usd?: number;
}
export interface BasketAsk { type: "dish" | "lunchbox" | "budget"; people?: number; children?: number; days?: number; max_usd?: number }
export interface SearchReading {
  /** The kind of thing asked for, the customer's own words without the facts, the audience, numbers and filler. */
  query: string;
  filters: SearchFilters;
  /** A count said with the request ("for 5 kids", "3 juices"). */
  count: number | null;
  /** A basket to build by code (0215): the dish itself is found from the words by the database (dishes.words). */
  basket: BasketAsk | null;
  /** Which facts were asked, in honest.ts's keys, for the honest answer and the demand log. */
  asked: string[];
}

const L = "\\p{L}";
/** A pattern for whole words in any script: Latin word boundaries do not work around Arabic letters. */
const w = (src: string) => new RegExp(`(?<![${L}\\p{N}])(?:${src})(?![${L}])`, "giu");
const has = (re: RegExp, s: string) => { re.lastIndex = 0; return re.test(s); };

const NUM_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20,
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, sept: 7, huit: 8, neuf: 9, dix: 10, vingt: 20,
  "واحد": 1, "وحدة": 1, "تنين": 2, "اتنين": 2, "تلاتة": 3, "تلات": 3, "اربعة": 4, "أربعة": 4, "اربع": 4, "أربع": 4, "خمسة": 5, "خمس": 5,
  "ستة": 6, "ست": 6, "سبعة": 7, "تمانية": 8, "تسعة": 9, "عشرة": 10, "عشرين": 20,
  wa7ad: 1, wa7de: 1, tnein: 2, tnen: 2, tleteh: 3, tlete: 3, arba3a: 4, arb3a: 4, khamse: 5, sette: 6, sab3a: 7, tmenye: 8, "3ashra": 10, "3eshrin": 20,
};
const DIGITS = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
const numberOf = (x: string | undefined): number | null => {
  if (!x) return null;
  const d = Number(DIGITS(x).replace(",", "."));
  return Number.isFinite(d) ? d : NUM_WORDS[x.toLowerCase()] ?? null;
};
// A number standing alone: digits (or digits with a unit glued on, "5g"), or a number word; never the digit inside an Arabizi word ("3ando",
// "fosto2", "7asasiye") and never a word inside another ("un" in "lunch").
const NUM = "(?<![\\p{L}\\p{N}])(?:\\d+(?:[.,]\\d+)?(?:(?=(?:g|gr|ml|kg)(?![\\p{L}]))|(?![\\p{L}\\p{N}]))|(?:" + Object.keys(NUM_WORDS).join("|") + ")(?![\\p{L}\\p{N}]))";

// ---------- the facts ----------
const SUGAR_NONE = w("no(?: added)? sugars?|zero sugar|sugar[- ]?free|without(?: added)? sugars?|unsweetened|sans sucres?(?: ajoutés?)?|0 ?% sucres?|sans sucre ajouté"
  + "|بلا سكر|بدون سكر(?: مضاف)?|من دون سكر|بلا سكّر|خالي من السكر|زيرو سكر|زيرو شوغر|ما فيه سكر|ما في سكر"
  + "|(?:bala|bidoun|bdoun|bidun|bdun|men gher|min ghayr) s[eiou]kk?[ae]r|zero s[eiou]kk?[ae]r|ma fi s[eiou]kk?[ae]r");
const SUGAR_LOW = w("low[- ]sugar|less sugar|little sugar|peu de sucre|pauvres? en sucres?|allégé en sucre|قليل السكر|سكر قليل|سكره قليل|(?:2alil|alil|ktir 2alil) (?:el )?s[eiou]kk?[ae]r");
const PROTEIN_HIGH = w("high[- ]protein|protein[- ]rich|rich in protein|lots of protein|full of protein|riche en protéines?|plein de protéines?|غني بالبروتين|بروتين عالي|في بروتين كتير|كتير بروتين"
  + "|fi protein ktir|protein ktir|ktir protein|ktir protin");
const FAT_NONE = w("fat[- ]free|no fat|0 ?% fat|zero fat|sans matières? grasses?|0 ?% de matières? grasses?|خالي من الدسم|بلا دسم|bala dasam");
const FAT_LOW = w("low[- ]fat|less fat|reduced fat|skimmed|semi[- ]skimmed|allégée?s?(?: en matières? grasses)?|écrémée?|demi[- ]écrémée?|قليل الدسم|خفيف الدسم|(?:2alil|alil) (?:el )?dasam|light");
const SALT_NONE = w("no salt|unsalted|without salt|salt[- ]free|sans sel|non salée?|بلا ملح|بدون ملح|bala m[ei]l[e]?7|bidoun m[ei]l[e]?7");
const SALT_LOW = w("low[- ]salt|less salt|little salt|pauvres? en sel|peu de sel|réduit en sel|قليل الملح|ملح قليل|(?:2alil|alil) (?:el )?m[ei]l[e]?7");
const UNDER = `(?:under|less than|below|max(?:imum)?|at most|moins de|max|بأقل من|باقل من|أقل من|اقل من|تحت|(?:b )?a?2a2al men|a2al men|ta7t)`;
const GRAMS = `(?:g|gr|grams?|grammes?|غ|غرام|غم|gram)`;
const NUTRIENT_WORD: [RegExp, "sugars_g" | "protein_g" | "fat_g" | "salt_g"][] = [
  [/sugars?|sucres?|سكر|s[eiou]kk?[ae]r/iu, "sugars_g"], [/proteins?|protéines?|بروتين/iu, "protein_g"],
  [/fat|matières? grasses?|دسم|dasam/iu, "fat_g"], [/salt|sel|ملح|m[ei]l[e]?7/iu, "salt_g"],
];
const CLAIMS: [RegExp, string][] = [
  [w("lactose[- ]?free|no lactose|without lactose|sans lactose|بدون لاكتوز|بلا لاكتوز|خالي من اللاكتوز|bala lactose"), "lactose_free"],
  [w("fragrance[- ]?free|unscented|no fragrance|no perfume|without (?:fragrance|perfume)|sans parfum|بدون ريحة|بلا ريحة|بدون عطر|بلا عطر|خالي من العطر|bala r[iy]7a|bidoun r[iy]7a"), "fragrance_free"],
  [w("organic|bio|biologique|عضوي|عضوية|organique"), "organic"],
  [w("whole ?grain|wholegrain|complet|complète|حبوب كاملة"), "wholegrain"],
  [w("caffeine[- ]?free|decaf|sans caféine|déca|بلا كافيين|بدون كافيين"), "caffeine_free"],
  [w("paraben[- ]?free|sans parabènes?|بدون بارابين"), "paraben_free"],
  [w("tear[- ]?free|no more tears|ne pique pas les yeux|ما بيحرق العيون"), "tear_free"],
];
// gluten-free is an allergen restriction (free of gluten), as a celiac customer means it
const GLUTEN_FREE = w("gluten[- ]?free|no gluten|without gluten|sans gluten|بدون غلوتين|بلا غلوتين|خالي(?:ة|ه)? من ال?غلوتين|bala gluten|bidoun gluten|celiac|coeliac|cœliaques?|coeliaques?|سيلياك|celiaque");

// ---------- allergies and diets: restrictions, never preferences ----------
const ALLERGEN_WORDS: [RegExp, Allergen][] = [
  [/peanuts?|arachides?|cacahu[eè]tes?|فستق(?! حلبي)|fost[ou]2|fostok|fistok|فستق عبيد|فول سوداني/iu, "peanuts"],
  [/tree ?nuts?|\bnuts?\b|noix|fruits à coque|مكسرات|جوز|لوز|بندق|kaju|mkassarat|amandes?|noisettes?|pistachios?|فستق حلبي/iu, "tree_nuts"],
  [/sesame|sésame|سمسم|simsim|semsom|tahini|طحينة/iu, "sesame"],
  [/gluten|wheat|blé|قمح|غلوتين|5am7|2am7/iu, "gluten"],
  [/\bmilk\b|dairy|lait|lactose|حليب|ألبان|البان|7al[ie]b/iu, "milk"],
  [/\beggs?\b|œufs?|oeufs?|بيض|bayd|beid/iu, "eggs"],
  [/\bsoy\b|soya|soja|صويا/iu, "soy"],
  [/\bfish\b|poissons?|سمك|samak/iu, "fish"],
  [/shellfish|crustaceans?|shrimps?|crustacés?|crevettes?|قريدس|قشريات|jambari/iu, "crustaceans"],
  [/mustard|moutarde|خردل/iu, "mustard"],
  [/celery|céleri|كرفس/iu, "celery"],
];
/** An allergy said: "allergic to X", "X allergy", «حساسية من X», "7asasiye 3al X", "allergique aux X", "no X, allergy". */
const ALLERGY = w("allerg(?:y|ies|ic)(?: to)?|intoleran(?:t|ce)(?: to)?|allergiques?(?: (?:aux?|à la|au|à l'|à))?|allergie(?: (?:aux?|à la|au|à))?|intolérant(?:e)?(?: (?:aux?|à la|au))?"
  + "|حساسية|حساسيه|عندو حساسية|عندها حساسية|عندي حساسية|7asasiy[ey]h?|7assasiye|7asasiye");
const DIETS: [RegExp, Diet][] = [
  [w("vegan|végan|végétalien(?:ne)?s?|نباتي صرف|نباتية صرف|فيغان|ڤيغان"), "vegan"],
  [w("vegetarian|végétarien(?:ne)?s?|نباتي|نباتية|nabati|nabateye"), "vegetarian"],
  [w("halal|حلال|7alal|halel"), "halal"],
  [w("fasting|siyami|siyemi|صيامي|صيامية|carême"), "fasting"],
];

// ---------- animals, ages, audience ----------
const DOG = w("dogs?|puppy|puppies|chiens?|chiots?|كلب|كلاب|جرو|جراء|kalb|kleb|jarw|jaro");
const CAT = w("cats?|kittens?|chats?|chatons?|قطة|قطط|بسين|بسينة|هريرة|2otta|2otat|bseine|bsein");
const YOUNG = w("puppy|puppies|kittens?|chiots?|chatons?|جرو|جراء|هريرة|صغير|zghir|zgher|petit chat|petit chien");
const SENIOR = w("senior|old dog|old cat|âgé|vieux|كبير بالعمر|ختيار");
const KIDS = w("kids?|children|child|toddlers?|my son|my daughter|for him|enfants?|mon fils|ma fille|bébés?|baby|babies"
  + "|ولاد|أولاد|اولاد|الولاد|للولاد|ولادي|أطفال|اطفال|الأطفال|للأطفال|ابني|إبني|بنتي|لابني|لبنتي|طفل|ولد"
  + "|wl[ae]d|wled|ewled|awlad|lal wled|ibni|binti|la ibni|la binti|ebni|tfel");
const AGE = new RegExp(`(?<![\\p{L}\\p{N}])(${NUM})\\s*(?:-|\\s)?\\s*(years?|yrs?|y\\.?o\\.?|ans?|سنين|سنوات|سنة|sneen|snin|sene|months?|mois|شهر|شهور|ashhor|shhor)(?![\\p{L}])`, "giu");
const AGE_AR2 = w("سنتين|sentein|santen|2 ans");
// ---------- shopping tags (preferences, never facts) ----------
const TAGS: [RegExp, string][] = [
  [w("lunch ?box(?:es)?|boîte à lunch|زوادة|زوادة المدرسة|zouwade|zwede|lal madrase|للمدرسة|pour l'école|school"), "lunchbox"],
  [w("party|parties|soirée|fête|سهرة|حفلة|sahra|sa7ra|7afle"), "party"],
  [w("breakfast|petit[- ]déjeuner|ترويقة|فطور|terwi2a|terwi2ah|ftour"), "breakfast"],
];
// ---------- counts, people, budgets, baskets ----------
const PEOPLE = new RegExp(`(?:for|pour|ل|لـ|la|lal|l)\\s*(${NUM})\\s*(?:people|persons?|personnes?|kids?|children|enfants?|ولاد|أولاد|اولاد|أشخاص|اشخاص|شخص|ashkhas|wl[ae]d|wled|guests?|invités?|ضيوف)?(?![\\p{L}\\p{N}])`, "iu");
const KIDS_AFTER = /(?:kids?|children|enfants?|ولاد|أولاد|اولاد|wl[ae]d|wled)\s*$/iu;
const TWO_PEOPLE = w("لشخصين|for two|pour deux|la shakhsein|la tnein");
const BUDGET = new RegExp(`${UNDER}\\s*\\$?\\s*(${NUM})\\s*(?:\\$|usd|dollars?|دولار|dolar)?`, "iu");
const WEEK = w("week|the week|semaine|جمعة|الجمعة|للجمعة|لجمعة|بالجمعة|أسبوع|اسبوع|jem3a|jom3a|esbou3");
const DAYS = new RegExp(`(${NUM})\\s*(?:days?|jours?|أيام|ايام|يوم|iyyem|ayam)`, "iu");
const BASKET_WORD = w("basket|panier|سلة|سلّة|sallet|salle|salleh|ingredients for|everything for|de quoi faire|غراض|أغراض|اغراض|a8rad|ghrad|agh?rad");
const LUNCHBOX = TAGS[0]![0];
const DISH_PEOPLE = new RegExp(`(?:for|pour|ل|لـ|la)\\s*(${NUM})`, "iu");

const FILLER = w("i want|i need|i'd like|i would like|we need|send me|bring me|get me|give me|do you have|have you got|any|some|something|please|pls|for|with|and|a|an|the|my|me|of|to|is|am|he|she|but|also|packs?|packets?"
  + "|je veux|je voudrais|il me faut|avez[- ]vous|des|du|de la|de l'|de|la|le|les|un|une|pour|avec|et|mon|ma|mes|il est|elle est|est|aux?|sans"
  + "|ل|بدي|بدّي|بدنا|عطيني|جيبلي|ابعتلي|في عندكن|عندكن|شي|مع|و|بس|لـ|عشان|كرمال|يلي|من|على|ع|إلى|الى|عندو|عندها|عندي|هو|هي"
  + "|baddi|badde|bade|bidde|3tine|jibli|ab3atli|fi 3andkon|3andkon|shi|ma3|w|bas|la|lal|l|men|3al|3a|3ando|3anda|3ande|kel");

/** Reads one request. */
export function readSearch(text: string): SearchReading {
  const said = DIGITS(String(text ?? "")).replace(/œ/g, "oe").replace(/Œ/g, "Oe").replace(/æ/g, "ae").replace(/\s+/g, " ").trim();
  const f: SearchFilters = {};
  const asked: string[] = [];
  let rest = ` ${said} `;
  const take = (re: RegExp) => { rest = rest.replace(re, " "); };

  // a ceiling or a floor said in numbers: "under 5 g of sugar", «أقل من ٥ غ سكر», "moins de 5 g de sucre", "more than 10 g protein"
  const numRe = new RegExp(`(${UNDER}|more than|at least|over|plus de|au moins|أكتر من|اكتر من|aktar men)\\s*(${NUM})\\s*${GRAMS}\\s*(?:of|de|d'|من)?\\s*([\\p{L}]+(?: [\\p{L}]+)?)`, "giu");
  for (const m of said.matchAll(numRe)) {
    const word = NUTRIENT_WORD.find(([re]) => re.test(m[3]!));
    const n = numberOf(m[2]);
    if (!word || n === null) continue;
    const floor = /more|least|over|plus|au moins|أكتر|اكتر|aktar/i.test(m[1]!);
    (f.nutrients ??= []).push({ key: word[1], ...(floor ? { min: n } : { max: n }) });
    asked.push(word[1] === "sugars_g" ? "sugar" : word[1] === "protein_g" ? "protein" : word[1] === "fat_g" ? "fat" : "salt");
    take(new RegExp(m[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu"));
  }
  if (has(SUGAR_NONE, rest)) { f.sugar = "none"; asked.push("sugar"); take(SUGAR_NONE); }
  else if (has(SUGAR_LOW, rest)) { f.sugar = "low"; asked.push("sugar"); take(SUGAR_LOW); }
  if (has(PROTEIN_HIGH, rest)) { f.protein = "high"; asked.push("protein"); take(PROTEIN_HIGH); }
  if (has(FAT_NONE, rest)) { f.fat = "none"; asked.push("fat"); take(FAT_NONE); }
  else if (has(FAT_LOW, rest)) { f.fat = "low"; asked.push("fat"); take(FAT_LOW); }
  if (has(SALT_NONE, rest)) { f.salt = "none"; asked.push("salt"); take(SALT_NONE); }
  else if (has(SALT_LOW, rest)) { f.salt = "low"; asked.push("salt"); take(SALT_LOW); }
  for (const [re, code] of CLAIMS) if (has(re, rest)) {
    (f.claims ??= []).push(code); take(re);
    if (code === "lactose_free") asked.push("lactose"); else if (code === "fragrance_free") asked.push("fragrance");
  }
  const free = new Set<Allergen>();
  if (has(GLUTEN_FREE, rest)) { free.add("gluten"); asked.push("gluten"); take(GLUTEN_FREE); }
  // an allergy: the allergens named in the same sentence as the allergy word
  if (has(ALLERGY, rest)) {
    for (const sentence of rest.split(/[.!?؟\n]|,(?=[^,]*(?:allerg|حساسي|7asasi))/u)) {
      if (!has(ALLERGY, sentence)) continue;
      for (const [re, code] of ALLERGEN_WORDS) if (re.test(sentence)) free.add(code);
    }
    // the allergy words and what they named leave the query
    rest = rest.replace(new RegExp(`${ALLERGY.source}\\s*(?:(?:من|ل|لل|ع|عل|3al|3a|el|al|to|aux?|à|de)\\s*)?(?:ال)?[\\p{L}\\p{N}']+`, "giu"), " ");
    take(ALLERGY);
  }
  // "no peanuts", «بلا فستق», "sans cacahuètes", "without nuts": an allergen excluded by name is a restriction too
  const without = /(?:no|without|free of|sans|بلا|بدون|من دون|bala|bidoun|bdoun)\s+([\p{L}']+(?: [\p{L}']+)?)/giu;
  for (const m of rest.matchAll(without)) {
    const hit = ALLERGEN_WORDS.find(([re]) => re.test(m[1]!));
    if (hit) { free.add(hit[1]); rest = rest.replace(m[0], " "); }
  }
  if (free.size) f.free_of = [...free];
  for (const [re, code] of DIETS) if (has(re, rest)) {
    (f.diet ??= []).includes(code) || f.diet!.push(code);
    take(re);
    if (code === "vegan") { f.diet = f.diet!.filter((d) => d !== "vegetarian"); break; }
  }
  // animals: the species and, for a puppy or a kitten, the young life stages
  const dog = has(DOG, rest), cat = has(CAT, rest);
  if (dog !== cat) {
    f.species = dog ? "dog" : "cat";
    if (has(YOUNG, rest)) f.life_stage = ["baby", "young"];
    else if (has(SENIOR, rest)) f.life_stage = ["senior"];
    rest = rest.replace(dog ? DOG : CAT, " ").replace(YOUNG, " ").replace(SENIOR, " ");
    // "cat food", «أكل كلاب», "croquettes": the animal's food, never its litter or its toys
    if (!f.life_stage && /food|akl|أكل|اكل|nourriture|croquettes?|pâtée|patee|ta3am|طعام/iu.test(rest)) f.life_stage = ["baby", "young", "adult", "senior", "all"];
    rest = ` ${f.species === "dog" ? "dog" : "cat"} ${rest} `;      // the kind stays in the query ("dog food", "cat food")
  }
  // an age: "2 year old", «عمرو سنتين», "2 ans", "18 months"
  const age = [...rest.matchAll(AGE)][0];
  if (age) {
    const n = numberOf(age[1]);
    if (n !== null) f.age_months = /month|mois|شهر|شهور|shhor|ashhor/i.test(age[2]!) ? n : n * 12;
    take(AGE);
  } else if (has(AGE_AR2, rest)) { f.age_months = 24; take(AGE_AR2); }
  if (f.age_months !== undefined) rest = rest.replace(w("old|عمرو|عمرها|عمر|3omro|3omra|âgée?|de"), " ");
  if (has(KIDS, rest) && !f.species) { f.audience = "kids"; take(KIDS); }
  for (const [re, tag] of TAGS) if (has(re, rest)) { (f.prefer_tags ??= []).push(tag); take(re); }

  // a basket: a dish for N, a week of lunchbox snacks, a budget
  let basket: BasketAsk | null = null;
  const budget = said.match(BUDGET);
  const max_usd = budget ? numberOf(budget[1]) ?? undefined : undefined;
  if (budget) take(new RegExp(budget[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu"));
  const people = said.match(PEOPLE) ?? said.match(DISH_PEOPLE);
  const nPeople = has(TWO_PEOPLE, said) ? 2 : people ? numberOf(people[1]) : null;
  const week = has(WEEK, said), days = said.match(DAYS);
  const lunch = has(LUNCHBOX, said) || /goûters?|سناكات للزوادة|سناكس للزوادة|lal madrase|للمدرسة/iu.test(said);
  if (lunch && (week || days)) {
    const kids = said.match(new RegExp(`(${NUM})\\s*(?:kids?|children|enfants?|ولاد|أولاد|اولاد|wl[ae]d|wled)(?![\\p{L}])`, "iu"));
    const children = /ولدين|لولدين/u.test(said) ? 2 : kids ? numberOf(kids[1]) ?? 1 : 1;
    basket = { type: "lunchbox", children, days: days ? numberOf(days[1]) ?? 5 : 5, ...(max_usd !== undefined ? { max_usd } : {}) };
  } else if (nPeople !== null && !KIDS_AFTER.test(people?.[0] ?? "") && (has(BASKET_WORD, said) || !hasProductCount(said, people?.[0] ?? ""))) {
    // "for 6", "for 6 people", «ل ٦ أشخاص»: people for a dish (the database finds the dish in the words, or the reading is a search).
    // "for 5 kids" is a count of children for a search ("snacks with no sugar for 5 kids"), never a dish.
    basket = { type: "dish", people: nPeople, ...(max_usd !== undefined ? { max_usd } : {}) };
  } else if (max_usd !== undefined && (has(BASKET_WORD, said) || /snacks?|تسالي|cleaning|ménage|tanzif|تنظيف|breakfast|ترويقة/iu.test(said))) {
    basket = { type: "budget", max_usd };
  }

  // the count said with the request: "for 5 kids", "3 juices", «٦ مشروبات»
  const countMatch = said.match(new RegExp(`(?<![\\p{L}\\p{N}])(${NUM})(?![\\p{L}\\p{N}])`, "iu"));
  const count = basket ? null : (nPeople ?? (countMatch ? numberOf(countMatch[1]) : null));
  if (people) take(new RegExp(people[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu"));
  rest = rest.replace(new RegExp(`(?<![\\p{L}\\p{N}])(?:${NUM})(?![\\p{L}\\p{N}])`, "giu"), " ")
             .replace(/[$€%]|\b(?:usd|dollars?)\b|دولار/giu, " ");
  if (basket) rest = rest.replace(WEEK, " ").replace(DAYS, " ").replace(BASKET_WORD, " ").replace(/(?:people|personnes?|persons?|أشخاص|اشخاص|ashkhas|شخص)/giu, " ");
  for (let i = 0; i < 3; i++) rest = rest.replace(FILLER, " ");
  const query = rest.replace(/[^\p{L}\p{N}' -]+/gu, " ").replace(/(?<![\p{L}])[-'](?![\p{L}])/gu, " ").replace(/\s+/g, " ").trim();
  for (const k of Object.keys(f) as (keyof SearchFilters)[]) if (f[k] === undefined) delete f[k];
  return { query, filters: f, count, basket, asked: [...new Set(asked)] };
}

/** "3 juices", «٦ مشروبات»: a number before a product word is a count of items, not of people ("for 6" is people). */
function hasProductCount(said: string, peoplePhrase: string): boolean {
  return !/^(?:for|pour|ل|لـ|la|lal|l)(?![\p{L}])/iu.test(peoplePhrase.trim()) && peoplePhrase.trim() !== "";
}

/** The filters that hold for every line of an order: allergies and diets said anywhere (a restriction is never only for one item). */
export function restrictionsOf(f: SearchFilters): string[] {
  return [...(f.free_of ?? []), ...(f.diet ?? [])];
}

/** Two readings together (the model's phrase and the customer's own words): the customer's facts win, nothing is dropped. */
export function mergeFilters(a: SearchFilters, b: SearchFilters): SearchFilters {
  const out: SearchFilters = { ...a, ...b };
  const uni = <T,>(x?: T[], y?: T[]) => (x || y ? [...new Set([...(x ?? []), ...(y ?? [])])] : undefined);
  out.claims = uni(a.claims, b.claims); out.free_of = uni(a.free_of, b.free_of); out.diet = uni(a.diet, b.diet);
  out.prefer_tags = uni(a.prefer_tags, b.prefer_tags); out.tags = uni(a.tags, b.tags); out.life_stage = uni(a.life_stage, b.life_stage);
  out.nutrients = a.nutrients || b.nutrients ? [...(a.nutrients ?? []), ...(b.nutrients ?? [])] : undefined;
  for (const k of Object.keys(out) as (keyof SearchFilters)[]) if (out[k] === undefined) delete out[k];
  return out;
}

/** Does this reading ask a fact an approved record must answer? (A shopping tag or a price does not.) */
export function asksFacts(f: SearchFilters): boolean {
  return !!(f.sugar || f.protein || f.fat || f.salt || f.nutrients?.length || f.claims?.length || f.free_of?.length || f.diet?.length
            || f.species || f.life_stage?.length || f.age_months !== undefined);
}
