// Scope guard: the bot helps with ordering and with questions about our vendors, nothing else.
// A clear off-topic request (poem, joke, capital cities, code, homework, medical or legal or investment advice, politics, weather, adult talk) gets a fixed redirect and NO model call.
// Conservative on purpose: any food / order / vendor word means "on topic", and every off-topic pattern needs an explicit request verb or question form, so "Joker burger",
// "write a note on the order" or "translate the menu" are never blocked. Anything ambiguous goes to the model, whose prompt carries the same scope rule.

const norm = (s: string) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[ً-ٟـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").toLowerCase().replace(/[.,!?؟،"'`]+/g, " ").replace(/\s+/g, " ").trim();

const FOODISH = new RegExp([
  "(?<![a-z])(menus?|orders?|ordering|deliver\\w*|restaurants?|cafes?|dish\\w*|food\\w*|meals?|pizzas?|burgers?|shawarma|sandwich\\w*|wraps?|combos?|fries|fry|chicken|meat|beef|lamb|fish|wings?|kebab\\w*|kafta|kibbeh|kibbe|manoushe|manakish|falafel|hummus|hommos|labneh|tabbouleh|fattoush|mjaddara|rice|salad\\w*|soup\\w*|coffee|tea|juice|cakes?|desserts?|sweets?|drinks?|water|beer|wine|arak|open|opening|close|closes|closed|hours|basket|cart|checkout|pay|payment|paid|cash|halal|vegan|vegetarian|allerg\\w*|nuts?|gluten|dairy|kitchen|vendors?|groceries|grocer\\w*|bakery|breakfast|lunch|dinner|eat|eating|hungry|hunger|fee|fees|promo|coupon|driver|drivers|courier|late|arrive\\w*|rain|bill|total|wrong|missing|cold|refund|address|building|street|floor|near|next to|bank|station|lbp|lira|usd|dollar|rate)(?![a-z])",
  "منيو|قائمه|طلب|اطلب|توصيل|مطعم|مطاعم|كافيه|وجبه|اكل|اكله|اكلات|طعام|بيتزا|برغر|شاورما|ساندويش|مشروب|مفتوح|مسكر|ساعات|سله|دفع|حلال|نباتي|حساسيه|مطبخ|حلويات|حلو|مناقيش|منقوشه|قهوه|فطور|غداء|غدا|عشاء|جوعان|فلافل|عصير|شوربه|سلطه|دجاج|لحم|سواق|سائق|متاخر|فاتوره|المجموع|عنوان|بناي|شارع|طابق|قرب|دولار|ليره|لبناني|كود الخصم|خصم",
  "(?<![a-z])(badde|bade|baddi|3andkon|3endkon|talab|akel|akl|tawsil|ma3am|mat3am|ghada|3asha|ftour|mana2ish|manaesh|mjaddara|shawarma|3enwen|binaye|share3)(?![a-z])",
  "(?<![a-z])(commander|commande|livraison|restaurant|pizza|manger|carte|menu|poulet|adresse|livreur)(?![a-z])",
].join("|"));

// Every pattern needs an explicit request addressed to the bot. Bare words (code, exam, letter, weather, exchange rate, calculate, dosage, translate ...) are NOT triggers: they appear in real orders.
const OFF = new RegExp([
  // English
  "\\b(write|compose|make up) (me )?(a |an |some )?(poem|poems|poetry|song|songs|lyrics|essay|story|stories|haiku|joke|jokes)\\b",
  "\\btell me (a |an |some )?(joke|jokes|story|riddle|fun fact)\\b",
  "\\b(write|code|program|debug|fix)\\b.{0,20}\\b(python|javascript|typescript|html|css|sql|c\\+\\+|regex|algorithm)\\b",
  "\\bwhat( ?s| is) the capital of\\b|\\bwho (is|was) the (president|prime minister) of\\b|\\bwho won the (world cup|champions league|election)\\b",
  "^(what( ?s| is)|how s) the weather( like)?( in \\w+)?( today| tomorrow| now)?$",
  "^(solve|calculate|compute|what( ?s| is))\\s+(?=[^a-z]*\\d\\s*[x×+*/^=-])[\\d\\sx×+\\-*/^=().]+$",
  "\\b(help me with|do) my (homework|assignment|exam|thesis)\\b",
  "\\b(medical advice|health advice)\\b",
  "\\b(legal advice|should i invest|i need a lawyer)\\b|should i buy (bitcoin|stocks?|gold|crypto)",
  "\\b(who should i vote for|your opinion on (the )?(war|politics|elections?|religion))\\b",
  "\\bporn\\b",
  // Arabic (normalised: ة->ه, ى->ي, hamza forms -> ا)
  "(?:اكتب لي|اكتبلي|الف لي|الفلي|احكيلي|احكي لي)\\s*(?:قصيده|قصه|نكته|شعر|اغنيه)",
  "(?:اكتب لي|اكتبلي)\\s+كود\\s+(?:بايثون|جافا|html|sql)",
  "(?:شو|ما|ماهي|ما هي)\\s+(?:هي\\s+)?عاصمه",
  "مين\\s+(?:ربح|فاز)\\s+(?:كاس|بطوله|الانتخابات)",
  "^(?:شو|كيف)\\s+الطقس(?:\\s+اليوم|\\s+بكره)?$",
  "(?:ساعدني|ساعديني)\\s*(?:ب|في)?\\s*(?:ال)?(?:واجب|امتحان|برمجه)",
  // Arabizi
  "\\b(ahki|e7ki|ehki|a7ki|ahkili|e7kili|a7kili)\\s+(li\\s+)?(nokte|noukte|nokta|2issa|kassa)\\b",
  "\\b(ktoub|aktob|ektob|ektoub)\\s*(li|lee)?\\s*(2asside|2assida|shi3er|nokte)\\b",
  "\\bsa3dne\\b.{0,15}\\b(wajeb|imti7an|homework)\\b",
  // French
  "\\b(raconte|dis)[- ]moi une (blague|histoire)\\b",
  "\\b(ecris|redige)[- ]moi\\b.{0,20}\\b(poeme|histoire)\\b",
  "\\bquelle est la capitale\\b|\\bqui est le president\\b",
].join("|"));

/** True only for a clear off-topic request in a short plain-text message. */
export function offTopic(text: unknown): boolean {
  if (typeof text !== "string") return false;
  const t = norm(text);
  if (!t || t.length > 140) return false;
  if (FOODISH.test(t)) return false;
  return OFF.test(t);
}

/** One short redirect, in the customer's language: what the bot does, then back to food. */
export function scopeReply(ar: boolean): string {
  return ar
    ? "أنا ألو كينغ 👑 بساعدك تطلب أكل وغراض من مطاعم الشوف وبجاوب عن المطاعم والمنيو. شو مشتهي اليوم؟"
    : "I'm Alo King 👑 I help you order food and groceries from restaurants in the Shouf and answer questions about them. What are you craving?";
}
