// Pure helpers for human handoff: detecting "talk to a person" (English / Arabic / Arabizi), the context message the admin receives,
// and the rules for relaying the admin's reply. No I/O; the WhatsApp sends and DB writes live in index.ts.

export const HANDOFF_HOURS = 2; // the bot stays silent this long once a person has replied (extended on every relayed reply)
export const HANDOFF_FIRST_MINUTES = 15; // before anyone has answered, the mute only lasts this long, so nobody is left in silence

const normArabic = (s: string) => s.replace(/[ً-ٟـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");
const norm = (s: string) => normArabic(String(s ?? "")).toLowerCase().replace(/[.,!?؟،"'`]+/g, " ").replace(/\s+/g, " ").trim();

const EN_TALK = /\b(?:talk|speak|chat|connect|transfer)\b\s+(?:\w+\s+){0,2}(?:to|with)\s+(?:a |an |the |your |someone |somebody )?(?:real |live |human )?(?:person|human|agent|representative|operator|manager|supervisor|someone|somebody|team member|staff member)\b/;
const EN_BARE = /^(please )?(a )?(real |live )?(person|human|agent|representative)( please)?$/;
const EN_SERVICE = /\bcustomer (service|support|care)\b/;
const AR_TALK = /(?:^|\s)(?:احكي|نحكي|احكيك|اتكلم|نتكلم|اكلم|نكلم|كلم|تكلم|اتواصل|نتواصل|التحدث|اتحدث|نتحدث)\s+(?:\S+\s+){0,2}?(?:مع\s+)?(?:ال)?(?:شخص|حدا|حد|موظف|انسان|مسوول|مسؤول|مدير|فريق|دعم|خدمه العملاء|ادمن)(?:\s|$)/;
const AR_MISC = /(خدمه العملاء|مش بوت|بدي انسان|اريد انسان|بدنا انسان)/;
const AZ_TALK = /\b(e7ki|a7ki|ahki|e7ke|a7ke|ekalem|ekallem|kellem|kallem|kalem|etkallam|etwasal|ewsal)\b.{0,15}\b(shakhs|shakhes|7ada|7ad|insen|insan|moazaf|mouazaf|mawazaf|mas2ul|mas2oul|masoul|mdir|team|khidmet|khedmet)\b/;

/** A customer typing "bot" / "menu" while a person has the chat takes them back to the bot. */
export const isBotRequest = (text: string) => /^(bot|the bot|back to bot|back to the bot|menu|بوت|المنيو|ارجع للبوت)$/.test(norm(text));

/** True when the customer asks for a human. Deliberately needs a "talk/connect…" verb next to a person word (or an unmistakable phrase), so ordinary orders never trigger it. */
export function isHumanRequest(text: string): boolean {
  const t = norm(text);
  if (!t) return false;
  return EN_TALK.test(t) || EN_BARE.test(t) || EN_SERVICE.test(t) || AR_TALK.test(t) || AR_MISC.test(t) || AZ_TALK.test(t);
}

const digits = (p: string) => String(p ?? "").replace(/\D/g, "");
/** Only the configured admin number, replying to (quoting) one of the forwarded messages, is ever relayed. */
export function shouldRelay(from: string, adminPhone: string, contextId: string | undefined | null): boolean {
  const a = digits(adminPhone), f = digits(from);
  return !!a && f === a && !!String(contextId ?? "").trim();
}

export const adminCommand = (text: string): "release" | null => (/^\/(bot|done|handback)$/i.test(String(text ?? "").trim()) ? "release" : null);

const strip = (s: string) => String(s ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
/** Empty after stripping control characters: nothing to relay. */
export const hasRelayableText = (text: string) => strip(text).trim().length > 0;
export const relayText = (text: string, ar: boolean) => `💬 *${ar ? "فريق ألو كينغ" : "Alo King team"}*\n${strip(text).trim().slice(0, 1000)}`;

export type HandoffInfo = { name: string | null; maskedPhone: string; lang: string; reason: string; recent: string[]; baskets: number; lastOrder: { code: string; status: string; totalText: string } | null };
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
/** The message the admin gets. Names and a masked phone only; replying to it reaches the customer, so the number is not needed. Bounded for WhatsApp. */
export function handoffContext(i: HandoffInfo): string {
  const recent = i.recent.slice(-5).map((m, k) => `${k + 1}. ${clip(strip(m).replace(/\s+/g, " "), 200)}`).join("\n");
  const lines = [
    `🙋 *Customer wants a person*`,
    `${i.name ? `${clip(strip(i.name), 60)} · ` : ""}${i.maskedPhone} · ${i.lang === "en" ? "English" : "Arabic"}`,
    `Why: ${clip(strip(i.reason), 160)}`,
    i.lastOrder ? `Last order: #${i.lastOrder.code} · ${i.lastOrder.status} · ${i.lastOrder.totalText}` : `No orders yet`,
    i.baskets ? `Open baskets: ${i.baskets}` : "",
    `Recent messages:\n${recent || "(none)"}`,
    `↩️ Reply to this message to answer them (I'll relay it). Send /bot as a reply to hand the chat back to the bot.`,
  ].filter(Boolean);
  return lines.join("\n").slice(0, 3500);
}
