// A bare greeting and three questions are common enough, and short enough, to recognise without a model: where is my order, when are you open,
// and "same as last time". The match is deliberately strict: the whole message must be one of these phrases, with at most a
// greeting before and a "please" or "thanks" after. Anything longer ("same as last time but add bread") goes to the model.
// Every miss or false match found in production becomes a case in evals/cases/quick_intents.json before it is fixed.

export type QuickIntent = "status" | "hours" | "repeat_last" | "greeting";

/** Lower case, no diacritics or tatweel, one spelling of alef, ta marbuta and alef maqsura, no punctuation or emoji. */
export function normalise(text: string): string {
  return text.toLowerCase()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .replace(/\s+/g, " ").trim();
}

const GREET = "(?:(?:مرحبا|مرحبتين|هلا|اهلين|اهلا|السلام عليكم|سلام|صباح الخير|مسا الخير|hi|hello|hey|marhaba|bonjour|salut|bonsoir)\\s+)?";
const POLITE = "(?:\\s+(?:لو سمحت|عافاك|من فضلك|يعطيك العافيه|شكرا|please|pls|plz|thanks|thank you|svp|stp|merci))*";
const ORDER_AR = "(?:ال)?طلب(?:يه|يتي|ي)?(?: تبعي)?";

const PATTERNS: Record<QuickIntent, string[]> = {
  // A bare hello. Answered without a model only when there is something to offer (the repeat button); otherwise the model greets.
  greeting: ["(?:مرحبا|مرحبتين|هلا|اهلين|اهلا|السلام عليكم|سلام|صباح الخير|مسا الخير|كيفكن|hi|hello|hey|marhaba|bonjour|salut|bonsoir)"],
  status: [
    `(?:وين|لوين|شو) (?:صار |وصل )?${ORDER_AR}`,
    `(?:شو صار ب|شو صار مع |شو صار في )${ORDER_AR}`,
    `${ORDER_AR} (?:وين|لوين) (?:صار|وصل)`,
    `(?:wen|wein|wayn|wain|wen sar|wein sar|lawen wosel) (?:el |l )?(?:talab|talabi|talabiye|order)(?: taba3i)?`,
    `where(?:'s| is) my (?:order|delivery)`, `(?:order status|track my order|status of my order)`,
    `(?:ou|où) est ma commande`,
  ],
  hours: [
    `(?:قديش|ايمتي|ايمت|امتي|اي ساعه|شو ساعه) (?:بتفتحو|بتسكرو|بتفتحوا|بتسكروا|بتسكرو اليوم|بتفتحو بكرا)`,
    `(?:شو )?(?:الدوام|دوامكن|دوامكم|ساعات الدوام|مواعيد الدوام)`,
    `(?:انتو |انتم )?(?:فاتحين|مفتوحين)(?: هلق| هلا| اليوم| هلء)?`,
    `(?:aymta|emta|adesh|2adesh) (?:btefta7o|btsakro|btfta7o)`, `(?:fet7in|fat7in)(?: halla2| hala2)?`,
    `what time do you (?:open|close)(?: today)?`, `(?:your )?(?:opening|working|business) hours`, `are you (?:open|still open)(?: now| today)?`,
    `(?:quels sont )?(?:vos )?horaires`, `(?:vous etes|etes vous|êtes vous) ouverts?(?: maintenant)?`,
  ],
  repeat_last: [
    `(?:متل|مثل|نفس|زي) (?:ال)?مره (?:الماضيه|اللي فاتت|الي فاتت|السابقه|الاخيره)`,
    `(?:نفس|متل|مثل) ${ORDER_AR} (?:الماضي|السابق|الاخير|تبع المره الماضيه)`,
    `(?:عيدلي|رجعلي|بدي نفس) (?:ال)?طلب(?:يه)? (?:الماضي|السابق|الاخير)`,
    `(?:metel|mitl|metl|nafs|zay) (?:el )?(?:marra|mara|mare) (?:el )?(?:madye|madyeh|li fetet|l fetet)`,
    `nafs (?:el )?talab(?: el madi)?`,
    `same as (?:last time|before)`, `same (?:order )?as last time`, `(?:repeat|reorder) (?:my )?(?:last )?order`, `same order(?: again)?`, `the usual`,
    `comme la derniere fois`, `comme la dernière fois`, `(?:la )?meme commande`,
  ],
};

const COMPILED: [QuickIntent, RegExp][] = (Object.keys(PATTERNS) as QuickIntent[])
  .map((k) => [k, new RegExp(`^${GREET}(?:${PATTERNS[k].join("|")})${POLITE}$`, "u")]);

export function quickIntent(text: string): QuickIntent | null {
  const t = normalise(text);
  if (!t || t.split(" ").length > 10) return null;
  for (const [k, re] of COMPILED) if (re.test(t)) return k;
  return null;
}
