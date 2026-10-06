// Pure helpers for language detection and broadcast payloads (unit-tested in broadcast.test.ts).
export type Lang = "ar" | "en";
export type TemplateRef = { name: string; language: string };
export const OPTOUT_PAYLOAD = "OPTOUT";

const ARABIC = /[؀-ۿ]/;
// Lebanese Arabizi: digits standing in for Arabic letters (3 ع, 5 خ, 7 ح, 9 ق) or common words.
const ARABIZI = /\b[3579](?!(?:pm|am|pcs?|km|kg|st|nd|rd|th|x|mins?)\b)[a-z]{2,}|[a-z][3579][a-z]|\b[a-z]{2,}[3579]\b|\b(marhaba|mar7aba|ahla|ahlan|kifak|kifik|kifkon|shu|shou|baddi|bade|habibi|salam|inshallah|ktir|tayeb|yalla|msh)\b/i;
const EN_WORDS = new Set(["the", "i", "you", "want", "would", "like", "please", "can", "could", "what", "is", "are", "do", "does", "have", "has", "order", "my", "me", "we", "for", "with", "and", "to", "of", "in", "at", "on", "from", "how", "much", "where", "when", "thanks", "thank", "need", "send", "get", "give", "a", "an", "it", "this", "that"]);

/** 'ar' for Arabic script or Arabizi, 'en' only when the text is clearly English, else null (caller defaults to Arabic). */
export function detectLanguage(text: string): Lang | null {
  const t = String(text ?? "");
  if (ARABIC.test(t)) return "ar";
  if (ARABIZI.test(t)) return "ar";
  const words = t.toLowerCase().match(/[a-z']+/g) ?? [];
  return words.filter((w) => EN_WORDS.has(w)).length >= 2 ? "en" : null;
}

/** The language to REPLY in: the language of the customer's latest message when it is clear (Arabic script, Arabizi, or two or more English words);
 *  the stored language only as a fallback for very short or unclear messages ("ok", "2", "menu", a button tap); Arabic when there is neither.
 *  `clear` says whether the message itself decided it (the caller may then update the stored language). */
export function replyLanguage(text: string | null | undefined, stored: string | null | undefined): { lang: Lang; clear: boolean } {
  const seen = detectLanguage(String(text ?? ""));
  if (seen) return { lang: seen, clear: true };
  return { lang: stored === "en" ? "en" : stored === "ar" ? "ar" : "ar", clear: false };
}

const optOutLine: Record<Lang, string> = { ar: "لإيقاف العروض اكتب STOP", en: "Reply STOP to opt out." };

/** Payloads to try in order: a plain message when the customer's 24h window is open, then the approved template. */
export function promoAttempts(o: { to: string; lang: Lang; message: string; vendorName: string; inWindow: boolean; templates: Record<Lang, TemplateRef> }) {
  const env = { messaging_product: "whatsapp", recipient_type: "individual", to: o.to };
  const tpl = o.templates[o.lang];
  const template = {
    ...env, type: "template",
    template: {
      name: tpl.name, language: { code: tpl.language },
      components: [
        { type: "body", parameters: [{ type: "text", text: o.message.replace(/\s+/g, " ").slice(0, 900) }] },
        { type: "button", sub_type: "quick_reply", index: "0", parameters: [{ type: "payload", payload: OPTOUT_PAYLOAD }] },
      ],
    },
  };
  const text = { ...env, type: "text", text: { body: `${o.message}\n\n— ${o.vendorName}\n${optOutLine[o.lang]}` } };
  return o.inWindow ? [text, template] : [template];
}

// STOP / unsubscribe keywords and the quick-reply titles of the promo templates (whole message only).
const OPTOUT_TITLES = /^\s*(stop|stop offers|unsubscribe|إيقاف|ايقاف|وقف|توقف|إيقاف العروض|ايقاف العروض)\s*[.!]?\s*$/i;
export const isOptOutTitle = (s: string) => OPTOUT_TITLES.test(String(s ?? ""));

/** A tap, from any of the shapes WhatsApp/Kapso use: interactive reply, list reply, or a template quick-reply (`type: "button"`, `button: { payload, text }`). */
export function replyFrom(m: any): { id: string; title: string } | null {
  const r = m?.interactive?.button_reply ?? m?.interactive?.list_reply ?? m?.button_reply ?? m?.list_reply ?? null;
  if (r?.id) return { id: String(r.id), title: String(r.title ?? "") };
  const b = m?.button;
  if (b && (b.payload || b.text)) return { id: String(b.payload ?? b.text), title: String(b.text ?? b.payload ?? "") };
  return null;
}
