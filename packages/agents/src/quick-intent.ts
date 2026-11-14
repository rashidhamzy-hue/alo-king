// A bare greeting, chat about the assistant (answered with the one off-topic line, 1.18), and three questions are common enough, and short enough, to recognise without a model: where is my order, when are you open,
// and "same as last time". The match is deliberately strict: the whole message must be one of these phrases, with at most a
// greeting before and a "please" or "thanks" after. Anything longer ("same as last time but add bread") goes to the model.
// Every miss or false match found in production becomes a case in evals/cases/quick_intents.json before it is fixed.

export type QuickIntent = "status" | "hours" | "repeat_last" | "greeting" | "small_talk";

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

const PATTERNS: Record<Exclude<QuickIntent, "small_talk">, string[]> = {
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

const COMPILED: [QuickIntent, RegExp][] = (Object.keys(PATTERNS) as (keyof typeof PATTERNS)[])
  .map((k) => [k, new RegExp(`^${GREET}(?:${PATTERNS[k].join("|")})${POLITE}$`, "u")]);

// Chat about the assistant itself, with nothing about an order (K1: «kifak? shu 3am ta3mol lyom? khabberne 3an 7alak» was read
// as a greeting live, twice). The whole message must be made of these pieces, and at least one must be more than "how are you".
const HOW_ARE_YOU = "kifak|kifik|kifkon|kifkoun|keefak|keefik|كيفك|كيفكن|كيفكم|كيف حالك|شو اخبارك|how are you|how r u|how are u|ca va|comment ca va|comment vas tu";
const CHAT = "shu 3am ta3mol|shu 3am te3mel|shu 3am ta3mel|shu 3am tsawe|shu 3amel|sho 3am ta3mol|شو عم تعمل|شو عم تساوي|شو عامل|what are you doing|what r u doing|what's up|whats up|" +
  "khabberne 3an 7alak|khabbirne 3an 7alak|khabberni 3an 7alak|5abberne 3an 7alak|خبرني عن حالك|خبرني عنك|خبرني عن نفسك|احكيلي عن حالك|احكيلي عنك|" +
  "tell me about yourself|tell me about you|qu'est ce que tu fais|que fais tu";
const WHEN = "(?: (?:lyom|el yom|al yom|اليوم|today|hala2|halla2|هلق|aujourd'hui))?";
const GREET_WORD = "مرحبا|مرحبتين|هلا|اهلين|اهلا|السلام عليكم|سلام|صباح الخير|مسا الخير|hi|hello|hey|marhaba|bonjour|salut|bonsoir";
const SMALL_TALK = new RegExp(`^(?:(?:${GREET_WORD}|${HOW_ARE_YOU}|${CHAT})${WHEN}(?: |$))+$`, "u");
const CHAT_RE = new RegExp(`(?:^| )(?:${CHAT})(?: |$)`, "u");

export function quickIntent(text: string): QuickIntent | null {
  const t = normalise(text);
  if (!t || t.split(" ").length > 14) return null;
  if (SMALL_TALK.test(t) && CHAT_RE.test(t)) return "small_talk";
  if (t.split(" ").length > 10) return null;
  for (const [k, re] of COMPILED) if (re.test(t)) return k;
  return null;
}
