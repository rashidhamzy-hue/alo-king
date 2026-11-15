// HO1 (docs/strategy/05 section D): a customer asking for a person is recognised by code, before any model, in Lebanese Arabic,
// Arabizi, English and French. "person" opens a case (kind person_requested); "chase" is a customer asking after a request that
// is already open ("when will someone answer?", "is anyone there?"), and only means something while a case is open.
// The cases are evals/cases/person_request.json: every wrong match found later is added there before a pattern changes.

/** Arabic folded the way people type it: no diacritics or tatweel, alef forms as alef, ta marbuta as ha, alef maqsura as ya. */
function fold(text: string): string {
  return text.normalize("NFKC").toLowerCase()
    .replace(/[ً-ٰٟـ]/gu, "")
    .replace(/[أإآٱ]/gu, "ا").replace(/ة/gu, "ه").replace(/ى/gu, "ي")
    .replace(/[’`]/gu, "'").replace(/\s+/gu, " ").trim();
}

const AR_WHO = "(?:حدا|حد|شخص|موظف|موظفه|انسان|مسؤول|المسؤول|المدير|بني ادم)";
const PERSON: RegExp[] = [
  // بدي احكي مع حدا · فيني احكي مع مسؤول · بدي كلم حدا من المحل
  new RegExp(`(?:بدي|بدنا|ممكن|فيني|فينا|بقدر|اريد|حابب|حابه)\\s*(?:اني\\s*)?(?:احكي|احاكي|اتكلم|كلم|اكلم|حاكي)\\s*(?:مع\\s*)?(?:شي\\s*)?${AR_WHO}`, "u"),
  // بدي موظف · بدي إنسان · بدي شخص حقيقي
  new RegExp(`(?:^|\\s)بدي\\s*(?:موظف|انسان|شخص حقيقي|حدا حقيقي|مسؤول)`, "u"),
  // بدي حدا يحكيني · خلي حدا يتصل فيي · حدا يرن لي
  new RegExp(`${AR_WHO}\\s*(?:من\\s*\\S+\\s*)?(?:يحكيني|يحاكيني|يكلمني|يحكي معي|يتصل فيي|يتصل في|يتصل بي|يرنلي|يرن لي|يرن علي|يدقلي)`, "u"),
  /(?:شخص|حدا)\s*حقيقي/u,
  /مش\s*(?:بوت|روبوت|ماكينه|الي|آلي)/u,
  // Arabizi
  /\b(?:baddi|badde|bade|bde|bidi|badi)\s+(?:e7ki|i7ki|ehke|ehki|ihki|e7ke|7ki|7ake|ekhod)\s+(?:ma3|m3|ma)\s+(?:shi\s+)?(?:7ada|hada|7ade|7ad|shakhs|chakhs|insan|employee|mas2oul|mas2ool)\b/u,
  /\b(?:7ada|hada|7ade|shakhs)\s+(?:men el shop\s+)?(?:7a2i2i|ha2i2i|real|ye7kine|yi7kine|ye7kini|yekellimne|yekalemne|yetassal|yettasel|yitasal|yrenn)\b/u,
  /\b(?:mesh|msh|mish|mush|mosh)\s+(?:bot|robot)\b/u,
  // English
  /\b(?:talk|speak|chat)\s+(?:to|with)\s+(?:a\s+|an\s+|the\s+)?(?:real\s+|actual\s+)?(?:person|human|someone|somebody|agent|representative|staff|manager|operator|employee)\b/u,
  /\breal\s+(?:person|human)\b/u,
  /\bnot\s+(?:a\s+)?(?:bot|robot|machine)\b/u,
  /^(?:a\s+)?(?:human|person|agent)\s+please\b/u,
  /\b(?:someone|somebody|anyone|a person)\s+(?:to\s+)?call\s+me\b/u,
  /\bcall\s+me\s+back\b/u,
  // French
  /\bparler\s+(?:à|a|avec)\s+(?:une\s+|un\s+|le\s+|la\s+)?(?:vraie\s+)?(?:personne|humain|conseill|agent|employ|responsable|quelqu'un|quelqu un)/u,
  /\bvraie\s+personne\b/u,
  /\bpas\s+(?:un\s+)?(?:robot|bot)\b/u,
  /\b(?:rappelez|appelez)[- ]moi\b/u,
];

const CHASE: RegExp[] = [
  // ايمتى (رح) يجاوبني / يتصل فيي حدا
  /(?:ايمتي|امتي|اديش|قديش|كم)\s*(?:بتقريب\s*)?(?:رح\s*|بدو\s*)?(?:بي|ب|ي|ر)?(?:جاوب|رد|يرد|تصل|يتصل|يطول)/u,
  /(?:ايمتي|امتي).{0,30}(?:يتصل|يجاوب|يرد|حدا)/u,
  /(?:^|[\s،,؟?])(?:في|بعدك|بعدكن|بعد في)\s*حدا(?:\s*هون)?\s*[؟?]/u,
  /حدا\s*هون\s*[؟?]/u,
  /(?:في|بعد)\s*حدا\s*(?:يجاوب|يرد|يردلي|يجاوبني)/u,
  /لسا\s*(?:ما\s*حدا|بانتظار|ناطر|ناطره|منتظر|منتظره)/u,
  /(?:ناطر|ناطره|منتظر|منتظره|بانتظار)\s*(?:ال)?جواب/u,
  /بدي\s*(?:ال)?جو?اب/u,
  /(?:تردولي|تردو علي|ردولي|تجاوبوني|جاوبوني)/u,
  // Arabizi
  /\bemta\b.{0,25}\b(?:y?jaweb|yjeweb|jawb|yrod|yrodd|yetsal|yettasel|ye7ki)/u,
  /\b(?:fi|ba3ed fi|ba3d fi|ba3dak|halla2 fi)\s+(?:7ada|hada|7ade)\b/u,
  // English
  /\bwhen\s+(?:will\s+(?:someone|somebody|anyone|a person|you)|(?:someone|somebody|anyone|a person)\s+will)\b.{0,20}\b(?:answer|reply|call|respond|get back)/u,
  /\b(?:is|anyone|someone|anybody)\s+(?:anyone|someone|anybody)?\s*there\b/u,
  /\bstill\s+waiting\b/u,
  /\bany\s+(?:news|update|answer)\b/u,
  // French
  /\bquelqu'un\s+a\s+pu\b/u,
  /\bavez-vous\s+pu\b/u,
  /\bj'attends\s+(?:votre|une)\s+réponse\b/u,
  /\btoujours\s+(?:en\s+attente|rien)\b/u,
  /\bquand\s+(?:est-ce\s+qu'|est ce qu')?(?:on|quelqu'un)\s+(?:va|me|pourra)\b/u,
];

/** "person" (ask for a person), "chase" (asking after an open request) or "none". A person request wins over a chase. */
export function personSignal(text: string): "person" | "chase" | "none" {
  const t = fold(text);
  if (!t) return "none";
  if (PERSON.some((r) => r.test(t))) return "person";
  if (CHASE.some((r) => r.test(t))) return "chase";
  return "none";
}
