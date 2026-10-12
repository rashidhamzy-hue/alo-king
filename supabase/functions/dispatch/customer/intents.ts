// Deterministic understanding of customer messages (DECISIONS §4, alo-ai-tool-safety): the language a
// message is written in, and the intents that never go to a model: STOP, "delete my data", "forget my
// history", a person, tracking, yes/no to a pending question, greetings. Arabic, English, French and
// Arabizi, including mixed messages.

import type { CLang } from "../../_shared/customer-cards.ts";

const ARABIC = /[؀-ۿ]/;
const ARABIC_ALL = /[؀-ۿ]/g;
const LATIN_ALL = /[A-Za-z]/g;

const FR =
  /\b(je|j'|voudrais|veux|bonjour|bonsoir|salut|svp|s'il|merci|une|des|avec|sans|commande|commander|livr\w*|où|ou est|c'est|pour|moi|ma|mon|frites|poulet)\b/i;
// Arabizi: digits standing for Arabic letters inside words, or common Lebanese words in Latin script.
const ARABIZI_DIGIT = /[a-z][2357689][a-z]|[2357689][a-z]{2}|[a-z]{2}[2357689]\b/i;
const ARABIZI_WORD =
  /\b(badde|baddi|bade|bde|bidde|biddi|shu|chou|kifak|kifik|3ayez|yalla|habibi|mni7|ma3|kam|wen|wein|feeh|fi|mn|lal|3al|3a|hek|hayda|hayde|ktir|ktiir|shway|tayeb|tayyeb|akel|akl|talab|talabi|ta3mne|bas|ba3d|marhaba|ahla|sahtein|mazbout)\b/i;

/** The language the customer wrote this message in. Mixed Arabic-script and Latin text counts as Arabic. */
export function detectLang(text: string, fallback: CLang = "ar"): CLang {
  const t = text.trim();
  if (!t) return fallback;
  const ar = (t.match(ARABIC_ALL) ?? []).length;
  const lat = (t.match(LATIN_ALL) ?? []).length;
  if (ar > 0 && ar >= lat * 0.4) return "ar";
  if (lat === 0) return ar > 0 ? "ar" : fallback;
  if (ARABIZI_DIGIT.test(t) || (ARABIZI_WORD.test(t) && !FR.test(t))) return "arabizi";
  if (FR.test(t)) return "fr";
  return ar > 0 ? "ar" : "en";
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[ً-ٰٟ]/g, "") // Arabic diacritics
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[̀-ͯ]/g, "") // Latin accents
    .replace(/[^\p{L}\p{N}\s?'’]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

export type Intent =
  | { kind: "stop" }
  | { kind: "start_marketing" }
  | { kind: "delete_data" }
  | { kind: "forget_history" }
  | { kind: "human" }
  | { kind: "track" }
  | { kind: "yes" }
  | { kind: "no" }
  | { kind: "greeting" }
  | { kind: "basket" }
  | { kind: "usual" }
  | { kind: "menu" };

const any = (t: string, words: RegExp[]) => words.some((w) => w.test(t));

/** Intents decided by rules. The model is never asked about these; STOP and deletion never depend on it. */
export function deterministicIntent(raw: string): Intent | null {
  const t = norm(raw);
  if (!t) return null;
  // STOP: the whole message, in any of the four languages (marketing opt-out, §18.3; honoured at once).
  if (
    /^(stop|stopp|unsubscribe|desabonner|desinscrire|arret|arreter|وقف|اوقف|ستوب|توقف|بلا رسايل|w2af|wa2ef)$/.test(
      t,
    )
  )
    return { kind: "stop" };
  if (/^(start|subscribe|ابدا|بلش)$/.test(t)) return { kind: "start_marketing" };
  if (
    any(t, [
      /\b(delete|erase|remove) (all )?my (data|info|information|account)\b/,
      /\bsupprimer? (toutes )?mes (donnees|informations)\b/,
      /(امحوا|امحي|احذف|احذفوا|امسح|امسحوا|شيلوا) (كل )?(معلوماتي|بياناتي|داتا|الداتا تبعي)/,
      /\b(m7i|em7i|im7i|imhi|emhi|i7zof|shilo) (kel )?(ma3lomete|data|bayanete)\b/,
    ])
  )
    return { kind: "delete_data" };
  if (
    any(t, [
      /\bforget (my )?(history|orders|everything)\b/,
      /\boublie(z)? (mon )?historique\b/,
      /(انسى|انسوا|انسا) (كل )?(طلباتي|تاريخي|شو طلبت)/,
      /\b(insa|ensa) (kel )?(talabete|shu talabt)\b/,
    ])
  )
    return { kind: "forget_history" };
  if (
    any(t, [
      /\b(talk|speak) to (a )?(person|human|someone|agent|rasheed|rashid)\b/,
      /\b(human|agent|real person|customer service)\b/,
      /\b(parler a|un humain|une personne|conseiller)\b/,
      /(بدي|بدنا|خليني) (احكي|حاكي) (حدا|شخص|انسان|موظف|رشيد)/,
      /\b(baddi|badde|bade) (e7ke|ehke|i7ki|ehki) (7ada|hada|shakhs|rasheed)\b/,
      /^(rasheed|rashid|رشيد)$/,
    ])
  )
    return { kind: "human" };
  if (
    any(t, [
      /\bwhere('?s| is)? my (order|food|delivery)\b/,
      /\b(track|status of) (my )?order\b/,
      /\bou (est|en est) ma commande\b/,
      /\bma commande (est|arrive)\b/,
      /(وين|وينو|وين صار|وصل) (ال)?(طلب|اكل|الطلبيه|الدليفري)/,
      /(طلبي|الطلبيه) (وين|ما وصل|تاخر)/,
      /\b(wen|wein|wayn) (sar )?(el |l )?(talab|talabi|akel|delivery)\b/,
      /\btalabi (wen|wein|ma wosel|t2akhar)\b/,
    ])
  )
    return { kind: "track" };
  if (
    /^(the usual|usual|comme d'habitude|l'habituel|متل العاده|نفس العاده|العاده|mitl el 3ade|metel el 3ade|el 3ade)$/.test(
      t,
    )
  )
    return { kind: "usual" };
  // "menu" / "order": the main menu, the way out of a handoff and the start of the button path (§34).
  if (
    /^(menu|the menu|main menu|home|order|i want to order|order now|المنيو|منيو|القايمه|اطلب|بدي اطلب|بدي طلب|commander|je veux commander|menu principal|otlob|badde otlob|baddi otlob|badde talab|talab)$/.test(
      t,
    )
  )
    return { kind: "menu" };
  if (/^(basket|cart|my basket|panier|mon panier|السله|سلتي|salle|salleti)$/.test(t))
    return { kind: "basket" };
  if (
    /^(yes|yeah|yep|ok|okay|sure|confirm|go|go ahead|oui|ouais|d'accord|daccord|parfait|ايه|اي|ايوه|نعم|اكيد|تمام|ماشي|اوكي|يلا|e|ee|eh|ey|aywa|akid|tamem|tamam|mashi|yalla)( please| svp| merci| thanks)?$/.test(
      t,
    )
  )
    return { kind: "yes" };
  if (/^(no|nope|cancel|non|annule|annuler|لا|لأ|كنسل|بلا|la2|la|cancel it)$/.test(t))
    return { kind: "no" };
  if (
    /^(hi|hello|hey|salut|bonjour|bonsoir|مرحبا|مرحبتين|هاي|السلام عليكم|سلام|اهلا|marhaba|hi there|ahla|kifak|kifik|salam)( (alo king|ya alo king))?$/.test(
      t,
    )
  )
    return { kind: "greeting" };
  return null;
}

/** Words that mean this conversation is a complaint (routes the turn to the escalation model, §3). */
export function looksLikeComplaint(raw: string): boolean {
  const t = norm(raw);
  return /\b(complain|complaint|wrong|missing|cold|refund|terrible|disgusting|plainte|rembours\w*|froid|manque|ghalat|ghalta|n2es|bared)\b|(غلط|ناقص|بارد|مش زاكي|شكوى|بدي رجع|مصاري|استرجاع)/.test(
    t,
  );
}

/** Spots a price-like amount in model text, so a model can never state a price the server did not render. */
export const PRICE_RE =
  /(\$\s?[\d٠-٩]|[\d٠-٩][\d٠-٩,.]*\s?(\$|usd|lbp|l\.l|ll\b|dollars?|dollar|euros?|ليره|ل\.ل|دولار|الف|ألف))/i;
