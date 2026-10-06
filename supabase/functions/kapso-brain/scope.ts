// Scope guard: the bot helps with ordering and with questions about our vendors, nothing else.
// A clear off-topic request (poem, joke, capital cities, code, homework, medical or legal or investment advice, politics, weather, adult talk) gets a fixed redirect and NO model call.
// Conservative on purpose: any food / order / vendor word means "on topic", and every off-topic pattern needs an explicit request verb or question form, so "Joker burger",
// "write a note on the order" or "translate the menu" are never blocked. Anything ambiguous goes to the model, whose prompt carries the same scope rule.

const norm = (s: string) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[ً-ٟـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").toLowerCase().replace(/[.,!?؟،"'`]+/g, " ").replace(/\s+/g, " ").trim();

const FOODISH = new RegExp([
  "(?<![a-z])(menu|order|orders|deliver\\w*|restaurants?|cafes?|dish|dishes|food|meal|meals|pizza|burgers?|shawarma|sandwich\\w*|soup|salad|kibbeh|kibbe|manoushe|manakish|falafel|coffee|juice|cake|dessert|drinks?|open|opening|close|closes|closed|hours|basket|cart|checkout|pay|payment|halal|vegan|vegetarian|allerg\\w*|nuts?|kitchen|vendors?|grocer\\w*|bakery|breakfast|lunch|dinner|eat|hungry|hunger|fee|promo|restaurant)(?![a-z])",
  "منيو|قائمه|طلب|اطلب|توصيل|مطعم|مطاعم|كافيه|وجبه|اكل|اكله|اكلات|طعام|بيتزا|برغر|شاورما|ساندويش|مشروب|مفتوح|مسكر|ساعات|سله|دفع|حلال|نباتي|حساسيه|مطبخ|حلويات|حلو|مناقيش|منقوشه|قهوه|فطور|غداء|غدا|عشاء|جوعان|فلافل|عصير|شوربه|سلطه",
  "(?<![a-z])(badde|baddi|talab|akel|akl|tawsil|ma3am|mat3am|ghada|3asha|ftour|mana2ish|manaesh)(?![a-z])",
  "(?<![a-z])(commander|commande|livraison|restaurant|pizza|manger|carte|menu)(?![a-z])",
].join("|"));

const OFF = new RegExp([
  // English: creative and generic requests
  "\\b(write|compose|make up|generate)\\b.{0,25}\\b(poem|poems|poetry|song|songs|lyrics|essay|story|stories|letter|email|speech|code|script|program|cv|resume|haiku|joke|jokes)\\b",
  "\\btell me (a |an |some )?(joke|jokes|story|riddle|fun fact)\\b",
  "\\b(what( ?s| is| are)|who (is|was|are)|who won|when (is|was|did)|where is) .{0,40}\\b(capital of|president|prime minister|king of|election|world cup|champions league|bitcoin|crypto|stocks?|dollar rate|exchange rate|weather|temperature|horoscope|meaning of life)\\b",
  "\\b(solve|calculate|integral|derivative|equation)\\b|what( ?s| is) \\d+\\s*[-+*/x×^]\\s*\\d+",
  "\\b(homework|assignment|exam|thesis)\\b",
  "\\b(python|javascript|typescript|html|css|sql|c\\+\\+|regex|algorithm|debug)\\b",
  "\\b(translate|translation)\\b",
  "\\b(medical advice|health advice|diagnos\\w*|symptoms? of|medicine for|medication|prescription|dosage|cure for|should i take)\\b",
  "\\b(lawyer|legal advice|sue (him|her|them|someone)|should i invest|invest in|mortgage|tax return)\\b|should i buy (bitcoin|stocks?|gold|crypto)",
  "\\b(who should i vote|your opinion on (the )?(war|politics|elections?|religion))\\b",
  "\\b(girlfriend|boyfriend|dating|nude|porn)\\b",
  // Arabic (normalised: ة->ه, ى->ي, hamza forms -> ا)
  "(اكتب|اكتبلي|الف|نظم|احكيلي|احكي لي|قولي|قل لي|عطيني)\\s*(لي)?\\s*.{0,20}(قصيده|قصه|نكته|شعر|مقال|رساله|اغنيه|كود|برنامج|لغز)",
  "(شو|ما|ماهي|ما هي|مين|من)\\s+(هي\\s+)?(عاصمه|رئيس|ملك|ربح|فاز|بطل)",
  "(كم|شو|ما)\\s+(سعر|صرف)\\s+(الدولار|البيتكوين|الذهب)",
  "(شو|كيف)\\s+الطقس",
  "(ساعدني|ساعديني|حل لي|حللي)\\s*(ب|في)?\\s*(ال)?(واجب|امتحان|مساله|معادله|برمجه)",
  "(?:^|\\s)(?:الدوا|دوا|دواء|علاج|اعراض|طبيب)(?:\\s|$)",
  "(?:^|\\s)(?:ترجم|ترجملي)\\s",
  // Arabizi
  "\\b(ahki|e7ki|ehki|a7ki|ahkili|e7kili|a7kili)\\s+(li\\s+)?(nokte|noukte|nokta|2issa|kassa)\\b",
  "\\b(ktoub|aktob|ektob|ektoub)\\s*(li|lee)?\\s*(2asside|2assida|shi3er|nokte|code|resume)\\b",
  "\\bsa3dne\\b.{0,15}\\b(wajeb|imti7an|homework)\\b",
  // French
  "\\b(raconte|dis)[- ]moi une (blague|histoire)\\b",
  "\\b(ecris|redige)[- ]moi\\b.{0,20}\\b(poeme|histoire|lettre|code)\\b",
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
