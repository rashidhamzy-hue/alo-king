// Session B1b (SIM1 fix 6): the customer's language, found from their own words and kept for the conversation.
// SIM1 and B1a's runs on main switched Arabizi and Arabic customers to English or French mid-chat: a tapped button's title (ours,
// often an English product name) was read as the customer's language, and a short "merci" or "ok thanks" was enough to change it.
// Here only the customer's own words (typed or spoken) are evidence, a change needs clear evidence, and Arabizi (Lebanese Arabic in
// Latin letters) is a language of its own: our fixed messages are Arabic for it, and the model writes back in Latin letters.
// Cases: evals/cases/conversation_language.json. Pure: no database, no model.
import type { Lang } from "./messages/types";

/** How the customer writes: Lebanese Arabic in Arabic script, Arabizi, English, French. */
export type Speech = "ar" | "arabizi" | "en" | "fr";

const ARABIC = /[؀-ۿ]/gu;
const LATIN = /[A-Za-zÀ-ÿ]/gu;
// Words that belong to one language only. Words Lebanese people write in every language ("merci", "ok", "please", "yes", "bye",
// brand and product words) are not evidence. Counted once each, so a brand like "Oui Oui" counts once.
const ARABIZI_WORDS = new Set(("baddi badde bade bedde bidde bidi baddak baddik baddon badda shu sho chu shou kifak kifik kifkon kifkoun keefak marhaba " +
  "marhabtein ahla ahlan yalla halla2 hala2 hala ma3 3a 3al 3ala w wa ma mesh msh mish mush ya3ne ya3ni yaany hek hayda haydi hayde hydol " +
  "hawdi kaman kamen kman zid zidli zidlo zidle zidoulé zidoule 3tine 3tini a3tine ba3d bokra lyom el l fi fiye fiyi fina wen wein wayn " +
  "talab talabi talabe tayeb tayyeb tamam khalas eza iza ktir kteer shway shwaye wa7de wa7ad tnein tnen tlete ana enta inta nehna " +
  "bas bass la2 akid ya3tik yislamo yeslamo habibi 2annine 2anenin 3elbe 3elbet ras kilo nos ma3on binaye bineye tabe2 taba2").split(" "));
const FRENCH_WORDS = new Set(("je j' vous votre vos nous est sont pas bonjour bonsoir commande livraison livrer avec pour les des une un le la du " +
  "svp stp oui non désolé desole c'est ça il elle quel quelle voudrais veux peux pouvez combien quand où aujourd'hui demain " +
  "rien merci-beaucoup beaucoup s'il plaît plait d'accord il elle alors mettez manque attends j'attends souci ouverture voulez " +
  "pourriez merci-bien bonne soirée journée encore aussi mais").split(" "));
const ENGLISH_WORDS = new Set(("i i'm i'd my me you your is are the a an and with for what which where when how we it can could would " +
  "sorry want need order delivery deliver have has do does did don't not this that there here someone anyone talk speak english " +
  "hello hi thanks thank anyway still nothing just send to of in on at yesterday today tomorrow same last time as more much many " +
  "will be was get give add remove cancel change but so then also only one two three from be because why who").split(" "));
const UNIT = /^\d+(?:g|gr|kg|l|lt|ml|cl|x|pcs?|k|cm)$/u;
const ARABIZI_DIGIT_WORD = /^(?:[a-z]*[235789][a-z]+|[a-z]+[235789][a-z]*)$/u;

/** The language a piece of the customer's own words is in, and how sure (the count of words that say so). Null: no evidence. */
export function wordsLanguage(text: string): { speech: Speech; score: number; strong: boolean } | null {
  const arabic = (text.match(ARABIC) ?? []).length, latin = (text.match(LATIN) ?? []).length;
  if (arabic === 0 && latin === 0) return null;
  if (arabic >= latin) return { speech: "ar", score: arabic, strong: arabic >= 6 };
  const tokens = [...new Set(text.toLowerCase().split(/[^a-z0-9À-ÿ']+/u).filter(Boolean))];
  let az = 0, fr = 0, en = 0;
  for (const t of tokens) {
    if (ARABIZI_WORDS.has(t) || (ARABIZI_DIGIT_WORD.test(t) && !UNIT.test(t))) az++;
    else if (FRENCH_WORDS.has(t) || /[éèêàçù]/u.test(t) && !/[2357]/u.test(t)) fr++;
    else if (ENGLISH_WORDS.has(t)) en++;
  }
  const ranked = ([["arabizi", az], ["fr", fr], ["en", en]] as [Speech, number][]).sort((a, b) => b[1] - a[1] || (a[0] === "arabizi" ? -1 : 0));
  const [first, second] = ranked;
  if (first![1] === 0) return null;
  // A tie between Arabizi and another language is Arabizi: Lebanese customers mix in French and English words, not the reverse.
  if (first![1] === second![1] && first![0] !== "arabizi" && second![0] !== "arabizi") return null;
  return { speech: first![0], score: first![1], strong: first![1] >= 2 && first![1] >= 2 * second![1] };
}

/** The reading's language (schemas.ts) as a Speech; "mixed" or nothing says nothing. */
export function speechOfReading(language: string | null | undefined): Speech | null {
  if (language === "ar_lb") return "ar";
  if (language === "arabizi" || language === "en" || language === "fr") return language;
  return null;
}

/**
 * The conversation's language after this turn. `own`: the customer's own words (typed texts, voice transcripts); `taps`: titles of
 * buttons they tapped, which are ours and never evidence. With nothing known yet, the words decide, else the reading, else a tap's
 * title. Once known, it changes only on clear evidence in the customer's own words (two or more words of the other language, twice
 * as many as any third); a short "merci", "ok thanks", a product name or the reading alone never change it.
 */
export function keepLanguage(prev: Speech | undefined | null, turn: { reading?: string | null; own: string[]; taps?: string[] }): Speech | null {
  const words = wordsLanguage(turn.own.join("\n"));
  if (!prev) return words?.speech ?? speechOfReading(turn.reading) ?? wordsLanguage((turn.taps ?? []).join("\n"))?.speech ?? null;
  if (words && words.strong && words.speech !== prev) return words.speech;
  return prev;
}

/** The language of our fixed messages for a Speech: Arabizi customers read Arabic. */
export const langOfSpeech = (s: Speech | null | undefined): Lang | null => (s === "en" || s === "fr" ? s : s ? "ar" : null);

/** What the ask loop is told about the language to write in. */
export function replyLanguage(s: Speech | null | undefined): string | null {
  switch (s) {
    case "arabizi": return "Lebanese Arabic in Latin letters (Arabizi), the way the customer writes: e.g. \"tamam, shu baddak kamen?\". Never English or French, never Arabic script.";
    case "ar": return "Lebanese Arabic in Arabic script, as the customer writes. Never formal Standard Arabic, never English.";
    case "en": return "English.";
    case "fr": return "French.";
    default: return null;
  }
}
