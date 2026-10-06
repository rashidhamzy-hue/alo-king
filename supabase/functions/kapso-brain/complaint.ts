// Complaints and frustration (P0-2): detected deterministically so they are never rate-limited, never need the model, and always get an apology plus a fix.
// Conservative on purpose: every pattern needs a negative framing ("order was cold", "never arrived", "worst"), so "cold drinks", "I'm late" or "late night menu" are not complaints. No I/O.

const norm = (s: string) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[ً-ٰٟـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").toLowerCase().replace(/[.,!?؟،"'`]+/g, " ").replace(/\s+/g, " ").trim();

const EN = [
  /\b(?:my |the )?(?:order|food|delivery|driver|burger|pizza|meal|sandwich|items?)\b.{0,25}\b(?:is|was|came|arrived|got|were|are)\b.{0,12}\b(?:cold|late|wrong|missing|burnt|burned|raw|stale|soggy|spilled|damaged|terrible|awful|bad|horrible|disgusting)\b/,
  /\bwrong (?:order|item|items|food)\b|\bmissing (?:item|items|food|something|my)\b|\b(?:never|didn t|did not|hasn t|has not|still hasn t) (?:arrive|arrived|come|came|show|showed|get here|got here|deliver|delivered)\b/,
  /\bstill (?:waiting|not here|nothing|no (?:food|order|answer|response))\b|\bwhere (?:is|s) my (?:order|food|delivery|driver)\b|\bwaiting (?:for )?(?:over |more than |almost )?\d+\s*(?:min|mins|minutes|hour|hours|hrs)\b/,
  /\b(?:worst|terrible|awful|horrible|disgusting|unacceptable|ridiculous|pathetic|useless|rubbish|scam|rude)\b/,
  /\b(?:refund|money back|complain|complaint|compensat\w*)\b/,
  /\b(?:you |this )?(?:bot|app|service)\b.{0,15}\b(?:stupid|dumb|useless|broken|sucks|doesn t work|not working)\b|\b(?:stupid|dumb) bot\b|\byou (?:don t|do not|never) (?:understand|listen)\b|\bnot what i (?:asked|ordered|said)\b|\bi (?:already )?(?:told|said) you\b/,
];
const AR = [
  /(?:طلبي|الطلب|الاكل|الاكله|التوصيل|السواق|السائق|الوجبه|البرغر|البيتزا|الساندويش).{0,25}(?:بارد|باردي|متاخر|متاخره|غلط|ناقص|ناقصه|محروق|محروقه|سيء|سيئه|زفت|وسخ|وسخه|مدعوس|مكسور)/,
  /طلب غلط|غلطتو|غلطتم|ناقص(?:ين|ه)? (?:صنف|اكل|شي|اغراض)|ما وصل|ما وصلت|لسا ما وصل|لسه ما وصل|وينو طلبي|وين طلبي|وين الاكل|وين السواق|لسا (?:عم )?استنى|لسه (?:عم )?استنى|استنيت (?:\S+ )?(?:ساعه|ساعتين|ساعات|\d+ دقيقه)/,
  /(?:^| )(?:اسوا|زفت|مقرف|مش معقول|غير مقبول|حرام عليكم|بشع|فاشل|فضيحه|سرقه|نصب|بوت غبي|غبي)(?: |$)/,
  /استرداد|رجعولي (?:مصاري|فلوسي|المبلغ)|رجعو(?:ا)?لي (?:مصاري|فلوسي)|شكوى|شكوي|بدي اشتكي|ما فهمت علي|ما بتفهم|ما بتسمع/,
];
const AZ = [
  /\b(?:ma wasal|ma wasalet|ma wsel|lessa ma wasal|lissa ma wasal|ta2akhar|ta2akhret|t2akhar|ghalat|ghalaT|3am estenna|3am staanna|estanit|bared|barde)\b/,
  /\bwayn (?:talabi|el akel|el akl|el driver|el sawwe2)\b|\bwein (?:talabi|el akel|el akl)\b/,
  /\b(?:zeft|zift|mou ma2oul|mish ma2oul|mesh ma2oul|ghayr maqbool|harram 3alaykon|haram 3alaykon|a2sa2|aswa2)\b/,
];
const FRENCH = [/\b(?:commande (?:froide|en retard|erronee|fausse)|n est jamais arrive|toujours pas|inacceptable|rembours\w*)\b/];

/** A complaint or an expression of frustration about an order, the delivery, the food or the bot itself. */
export function isComplaint(text: string): boolean {
  const t = norm(text);
  if (!t || t.length > 400) return false;
  return [...EN, ...AR, ...AZ, ...FRENCH].some((r) => r.test(t));
}

export const complaintApology = (ar: boolean, order?: { code: string; status: string } | null): string => {
  const ref = order ? (ar ? ` (الطلب #${order.code})` : ` (order #${order.code})`) : "";
  return ar
    ? `آسفين كتير على هالتجربة 🙏${ref} أنا آخد المشكلة بإيدي هلأ.`
    : `I'm really sorry about that 🙏${ref} I'm taking this on myself right now.`;
};
