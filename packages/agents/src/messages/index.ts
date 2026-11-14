// M1: the one way code gets a fixed message. messages(lang) returns every template in that language; the conversation's language
// lives in ConversationState.lang (set from the reading, or from the words for a turn code answers alone). Default Arabic.
import { ar } from "./ar";
import { en } from "./en";
import { fr } from "./fr";
import type { Lang, Messages } from "./types";

export { usd, grouped } from "./types";
export type { Lang, Messages, PayMethod } from "./types";
export { ar, en, fr };

export const LANGS: readonly Lang[] = ["ar", "en", "fr"];
const BY: Record<Lang, Messages> = { ar, en, fr };

/** Every fixed message in one language. Anything that is not "en" or "fr" is Arabic. */
export function messages(lang?: string | null): Messages {
  return BY[asLang(lang)];
}
export const asLang = (lang?: string | null): Lang => (lang === "en" || lang === "fr" ? lang : "ar");

/**
 * M1: the length rule for the model's own words (SYSTEM_BRIEF rule 3), sent with the ask loop's input only. The reading and the
 * ask loop share the system prompt and the tools, and a line there moved the reading (language-pack runs 43629416444 and
 * 43632950715: «bazella w jazar mkhalta» read wrong both times with it, right without it). The output guard enforces it either way.
 */
// Live run 43640755742 (M1): with "the system sends cards, lists and totals" the model often answered in plain text («I've
// recorded your message, the system will reply») and ended the turn: text outside a tool is never sent, so the turn went to
// a person. The rule now says that only the reply tool reaches the customer. Run 43641359322: 39/41, the two misses first drafts
// the guard refused («which is better», «الأكل الصيامي» echoed back); the last sentence restates invariants 14-15 for this input.
// Run 43644483826: 40/41, the miss called extract_order and ended the turn without a reply: every turn ends with reply.
export const REPLY_RULE = "Answer the customer now, through the reply tool (or ask_location_pin): every turn ends with one of them, also after extract_order or any other tool. Text outside a tool is never sent, and nothing else will answer for you. In it, at most two short sentences: one thing at a time; offer choices as buttons. Never say which is better, best or healthier, and never repeat a diet, health or halal word unless a tool returned it.";

/** Staff on the ops line read Arabic: no staff language is stored yet. One constant, so a later setting replaces it in one place. */
export const STAFF_LANG: Lang = "ar";

/** The reading's language (schemas.ts) as the language of our replies. Arabizi is Arabic; "mixed" says nothing. */
export function langFromReading(language: string | null | undefined): Lang | null {
  if (language === "en" || language === "fr") return language;
  if (language === "ar_lb" || language === "arabizi") return "ar";
  return null;
}

const ARABIC = /[؀-ۿ]/u;
const ARABIZI = /\b\w*[2357]\w*[a-z]\w*\b|\b(?:shu|sho|badde|baddi|bade|kifak|kifik|marhaba|yalla|halla2|hala2|ma3|3a|bi|wen|wein|talab|talabi|lyom|bokra|mni7|tayeb|khalas|eza|ya)\b/iu;
const FRENCH = /\b(?:je|j'|bonjour|bonsoir|merci|commande|livraison|livrer|vous|votre|est|où|ou est|quand|combien|s'il|svp|stp|pour|avec|demain|aujourd'hui|ouvert|horaires)\b|[éèêàçù]/iu;
const ENGLISH = /\b(?:i|i'd|i'm|my|the|where|what|when|how|is|are|you|your|please|want|need|order|deliver|delivery|open|same|last|time|can|could|would|much|today|tomorrow|thanks|thank)\b/iu;

/**
 * The language of a message code answers without the model (a quick question, a time in words). Arabic script is Arabic; Latin
 * text is French or English only on a clear word of that language and no Arabizi; anything else returns null (keep what we had).
 */
export function langOfText(text: string): Lang | null {
  const t = text.trim();
  if (!t) return null;
  if (ARABIC.test(t)) return "ar";
  if (ARABIZI.test(t)) return null;
  if (FRENCH.test(t)) return "fr";
  if (ENGLISH.test(t)) return "en";
  return null;
}

/** A product as code holds it: the English name and, once approved, the Arabic one. */
export interface Named { product_id?: string | null; name: string; name_ar?: string | null }

/**
 * A product's name in the conversation's language. Arabic shows the approved Arabic name; until one exists, the English name, and
 * the product goes into `gaps` so the caller records it (name_gaps, 0120). French shows the English name (no French names yet).
 */
export function productName(p: Named, lang: Lang, gaps?: Set<string>): string {
  if (lang !== "ar") return p.name;
  if (p.name_ar && p.name_ar.trim()) return p.name_ar;
  if (gaps && p.product_id) gaps.add(p.product_id);
  return p.name;
}

/** A village's name in the conversation's language: Arabic for Arabic, else the English name, falling back to the other. */
export const villageName = (lang: Lang, ar: string | null | undefined, en: string | null | undefined): string =>
  (lang === "ar" ? ar || en : en || ar) ?? "";

/** A delivery window as the database gives it (window_json, migration 0040): the hub's local date and times. */
export interface WindowLike { date: string; dow: number; day_offset: number; starts: string; ends: string }

/** «بكرا 10:00-12:00», "Friday 21/11, 10:00-12:00". From the database's local date and times; no clock or time zone here. */
export function windowLabel(w: WindowLike, lang: Lang = "ar"): string {
  const m = messages(lang).days;
  const [, mm, dd] = w.date.split("-");
  const day = w.day_offset === 0 ? m.today : w.day_offset === 1 ? m.tomorrow : `${m.names[w.dow] ?? ""} ${Number(dd)}/${Number(mm)}${m.dateSep}`;
  return `${day} ${w.starts}-${w.ends}`;
}

/** WhatsApp's limit for a list row title. */
export const ROW_TITLE_LIMIT = 24;
/** A list row: WhatsApp cuts a row title at 24 characters, so a longer label puts the times in the row's description (W1). */
export function windowRow(w: WindowLike, lang: Lang = "ar"): { title: string; description?: string } {
  const label = windowLabel(w, lang);
  if (label.length <= ROW_TITLE_LIMIT) return { title: label };
  return { title: label.slice(0, label.length - `${w.starts}-${w.ends}`.length).replace(/[،,\s]+$/u, ""), description: `${w.starts}-${w.ends}` };
}
