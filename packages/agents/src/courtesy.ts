// Session B1b (SIM1 fix 8): a greeting, a thank-you or a goodbye is not off-topic. SIM1 sent the fixed off-topic line ("I'm here only
// for Alo King orders") to «kifkon?», «merci, yislamo», «يعطيكن العافية» and "thanks anyway, bye" in 60 conversations, often in the
// middle of an order. The reading may still call them off_topic; code checks after it, as quick-intent.ts does before it.
// Cases: evals/cases/off_topic.json (the B1b block) and evals/test/off-topic.test.ts. Pure: no database, no model.
import { normalise } from "./quick-intent";

const GREET = "مرحبا|مرحبتين|مرحبًا|هلا|هلا والله|اهلين|اهلا|اهلا وسهلا|السلام عليكم|سلام|صباح الخير|صباح النور|مسا الخير|مساء الخير|مسا النور|" +
  "hi|hello|hey|marhaba|marhabtein|ahla|ahlan|hala|salam|sabe7 el kheir|saba7 el khair|masa el kheir|bonjour|bonsoir|salut|coucou|good morning|good evening";
const HOW = "كيفك|كيفكن|كيفكم|كيفكون|كيف حالك|كيف الحال|شو اخبارك|شو الاخبار|شو اخباركن|شو في ما في|kifak|kifik|kifkon|kifkoun|keefak|keefik|kif el 7al|" +
  "shu el a5bar|shu el akhbar|sho el akhbar|shu akhbarak|kif el shi3l|kif el shughl|how are you|how r u|how are u|how is it going|how's it going|" +
  "ca va|comment ca va|comment allez vous|vous allez bien|tout va bien";
// What follows a greeting and keeps it a greeting: an apology for the hour, "I have a question", "a nice day".
const SOFT = "عندي سؤال|عندي سؤال بسيط|سؤال صغير|i have a question|j'ai une question|desole de vous ecrire si tard|sorry to write so late|" +
  "shi hal yom 7elo hek|nhar 7elo|يوم حلو|نهارك سعيد";
const THANKS = "شكرا|شكراً|مرسي|ميرسي|يسلمو|يسلمو ايديكن|يسلمو ايديك|يسلموا|الله يسلمك|يعطيكن العافيه|يعطيك العافيه|الله يعطيك العافيه|تسلم|تسلملي|" +
  "ولا يهمك|ولا يهمكن|ما في مشكله|مافي مشكله|ماشي|تمام|اوكي|خلص|مع السلامه|باي|بخاطرك|بخاطركن|يلا باي|تصبح على خير|ليلتك سعيده|نهارك سعيد|" +
  "thanks|thank you|thank you so much|thx|ty|many thanks|thanks anyway|thank you anyway|no problem|np|no worries|ok|okay|bye|goodbye|bye bye|" +
  "have a good day|have a nice day|good night|see you|take care|merci|merci beaucoup|mersi|yislamo|yeslamo|yslamo|ya3tik el 3afye|ya3tik l 3afye|" +
  "ya3tikon el 3afye|ma fi mushkle|mish mushkle|mesh mushkle|mafi mushkle|tamam|khalas|yalla bye|pas de souci|pas de probleme|d'accord|bonne journee|" +
  "bonne soiree|bonne nuit|au revoir|a bientot|qd mm|je vous recris le matin|je vous reecris le matin|desole|vous ecrire si tard|i'll write tomorrow|bokra bektoblak|no thanks|no thank you|" +
  "لا شكرا|لا مرسي|la2 merci|la merci|non merci|la2 shukran|so much|anyway|cheers|beaucoup|pas grave|qd meme|quand meme|merci qd meme|" +
  "مشي الحال|ماشي الحال|يعطيك العافيه|الله يعطيك العافيه|ya3tik el 3afye";
// Chat about the assistant itself stays off-topic (K1: «kifak? shu 3am ta3mol lyom? khabberne 3an 7alak»).
const CHAT = /shu 3am ta3mol|shu 3am te3mel|shu 3am ta3mel|sho 3am ta3mol|شو عم تعمل|شو عم تساوي|khabber+n[ei] 3an 7alak|خبرني عن حالك|خبرني عنك|احكيلي عنك|what are you doing|tell me about (?:yourself|you)|que fais tu|qu'est ce que tu fais/u;
// Shopping for a dish is ordering (HANDOFF lane B (b): «بدي أغراض لمجدرة» read as off-topic in 3 of 4 gate runs).
// B1b's branch run (43746511047): the minimum («بدي شي بسيط لحتى يكمل الحد»), "can't you bring it anyway?", waiting for the team's answer,
// and the pin («Yimkin el pin ma tla3 sah») are about the order too: the Concierge answers them.
const SHOPPING = new RegExp("(?<![\\p{L}\\d])(?:و|ف|ب|ل|ال|وال|بال|لل)?(?:اغراض|غراض|مشتريات|مكونات|لوازم|agrad|aghrad|ghrad|grocer|ingredients?|ingrédients?|courses pour|de quoi j'ai besoin pour|" +
  "i want to buy|baddi ishtri|بدي اشتري|" +
  "الحد|يكمل|يكمّل|كمّل|كمل|زيد|زيدلي|ضيف|ضيفلي|minimum|ekmel|kamel|kammel|ykamel|zid|zidli|dif|difli|" +
  "تجيب|تجيبو|تجيبون|جيبلي|جيبولي|tjib|tjibo|tjibon|tjibouha|jibli|bring|apporter|" +
  "الفريق|فريق|جواب|بنتظر|عم استنى|fareek|fari2|team|jawab|bantazer|natar|équipe|equipe|reponse|réponse|" +
  // Someone from the shop («emta bijaweb 7ada?»): the open request, which the Concierge knows about.
  "حدا|7ada|someone|anyone|somebody|quelqu'un|personne|bijaweb|byjaweb|يجاوب|بيجاوب|يرد|بيرد|" +
  "pin|location|lokation|موقع|لوكيشن|localisation|position|maw2a3|mawqe3|" +
  // A request for something (a product we may not sell: the Concierge says so) or about an order («ما فيي طلب بس هالشيئين؟»).
  "بدي|بدنا|عطيني|طلب|طلبي|الطلب|baddi|badde|bade|beddi|3tine|3tini|talab|talabi|i want|i need|order|je veux|je voudrais|commande)(?:ي|ك|ه|ها|كن|نا)?(?![\\p{L}\\d])", "iu");

/** quick-intent's normalise, and Latin accents dropped («ça va» = "ca va», «soirée» = "soiree"). */
const fold = (x: string) => normalise(x).normalize("NFD").replace(/[\u0300-\u036f]/g, "").normalize("NFC");
const piece = (alts: string) => alts.split("|").map((x) => fold(x)).filter(Boolean).sort((a, b) => b.length - a.length)
  .map((x) => x.replace(/[.*+?^${}()[\]\\]/g, "\\$&")).join("|");
const WHOLE = (alts: string) => new RegExp(`^(?:(?:${alts})(?: |$))+$`, "u");
const GREETING_RE = WHOLE(`${piece(GREET)}|${piece(HOW)}|${piece(SOFT)}|${piece(THANKS)}`);
const HAS_GREETING = new RegExp(`(?:^| )(?:${piece(GREET)}|${piece(HOW)})(?: |$)`, "u");
const THANKS_RE = WHOLE(`${piece(THANKS)}|${piece(GREET)}`);
// B1b's second branch run (43748069612): a short message that says thanks, whatever else it says in passing («لا خلص، مرسي. رح اسأل
// غير محل», "ok ma tshghol, merci. yslamo"), and asks nothing, is a thank-you.
const THANKS_MARK = new RegExp(`(?:^| )(?:${piece("شكرا|مرسي|ميرسي|يسلمو|يسلموا|يعطيكن العافيه|يعطيك العافيه|thanks|thank you|thx|merci|mersi|yislamo|yeslamo|yslamo|ya3tik el 3afye|ya3tik l 3afye|shukran|choukran")})(?: |$)`, "u");

const GREETING_START = new RegExp(`^(?:${piece(GREET)}|${piece(HOW)})(?: |$)`, "u");

export type Courtesy = "greeting" | "thanks";

/** A message that is only a greeting (with "how are you"), or only thanks, a goodbye or "no thanks". Null otherwise. */
export function courtesyOf(text: string): Courtesy | null {
  const t = fold(text);
  if (!t || t.split(" ").length > 20 || CHAT.test(t)) return null;
  if (THANKS_RE.test(t) && !HAS_GREETING.test(t)) return "thanks";
  if (GREETING_RE.test(t)) return HAS_GREETING.test(t) ? "greeting" : "thanks";
  if (THANKS_MARK.test(t) && t.split(" ").length <= 20 && !/[?؟]/u.test(text) && !SHOPPING.test(t)) return "thanks";
  // B1b's run on main (43751120408): a message that opens with a greeting and says little else («مرحبا، كيفكن؟ شو أخباركن اليوم؟»,
  // "marhaba kifkon? shu el a5bar, kif el 2ata3 el yom") is a greeting; the Concierge answers whatever follows it.
  if (GREETING_START.test(t) && t.split(" ").length <= 12) return "greeting";
  return null;
}

/** After the reading said off_topic: is it still off-topic? False for a courtesy or a message about shopping for a dish. */
export function stillOffTopic(text: string): boolean {
  if (courtesyOf(text)) return false;
  return !SHOPPING.test(fold(text)) && !SHOPPING.test(normalise(text));
}
