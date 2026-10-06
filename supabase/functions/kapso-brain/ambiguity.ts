// Ambiguity (P1-5): a vague "ok / deal / yes / تمام" answer to an either/or question ("the chicken or the beef?") must apply nothing.
// The bot re-asks with the two options as buttons. Pure; index.ts reads the last assistant message and sends the card.

const norm = (s: string) => String(s ?? "").normalize("NFKD").replace(/[̀-ًͯ-ٟـ]/g, "").toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[.!؟?,،;:~]+/g, " ").replace(/\s+/g, " ").trim();
const VAGUE = new Set([
  "ok", "okay", "okey", "okk", "ok ok", "k", "kk", "deal", "yes", "yeah", "yep", "yup", "sure", "fine", "alright", "all right", "sounds good", "good", "great", "perfect", "either", "any", "any one", "whatever", "both", "that one", "go ahead", "do it", "yes please", "ok please", "ok thanks", "ok thank you",
  "تمام", "ماشي", "اوكي", "اوك", "اوكيه", "اه", "ايه", "اي", "نعم", "طيب", "حلو", "منيح", "تكرم", "اي تمام", "تمام تمام", "هيك تمام", "اكيد", "يلا", "شو ما كان", "ولا يهم", "ايا كان", "اي واحد",
  "tamem", "tamam", "mashi", "mashe", "eh", "e", "ayeh", "aye", "tayeb", "tayyeb", "yalla", "akid", "akeed", "ok tamem", "ok tamam", "ok yalla",
]);
/** A short, vague agreement that does not say WHICH option. "the chicken" or "the first one" are specific and never match. */
export const isVagueAssent = (text: string): boolean => VAGUE.has(norm(text));

const GENERIC_TITLE = /confirm|cancel|edit|change|basket|checkout|menu|location|human|person|reorder|تأكيد|اكد|إلغاء|الغاء|تعديل|سلة|سلتي|المنيو|موقع|احكي/i;
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const stripBullets = (s: string) => s.replace(/^[^\p{L}\p{N}]+/u, "").trim();

/** The two options of an either/or question in the bot's last message, or null. Two-button cards ending in a question count; so does plain "A or B?" text.
 *  Order summaries and other fixed-action cards (Confirm / Cancel / Edit ...) never count: a plain "yes" there is the customer's own confirmation. */
export function eitherOrOptions(lastAssistant: string): [string, string] | null {
  const raw = String(lastAssistant ?? "").trim();
  const m = raw.match(/^\[interactive buttons: ([\s\S]*) \| ([^|\]]*)\]$/);
  if (m) {
    const body = m[1], titles = m[2].split(" / ").map((t) => t.trim()).filter(Boolean);
    if (titles.length !== 2 || !/[?؟]/.test(body) || titles.some((t) => GENERIC_TITLE.test(t))) return null;
    return [clip(titles[0], 20), clip(titles[1], 20)];
  }
  if (raw.startsWith("[")) return null; // other cards (lists, reorder, location)
  const line = raw.split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? "";
  if (!/[?؟]\s*$/.test(line)) return null;
  const q = line.replace(/[?؟]\s*$/, "");
  const parts = q.split(/\s+(?:or|أو|او|ولا)\s+/i);
  if (parts.length !== 2) return null;
  const a = parts[0].split(/[,،:!.]|\band\b/i).pop()!.replace(/^\s*(?:(?:do|would|did) you |you )?(?:want|like|prefer|fancy|need|take|go for)\s+/i, "").replace(/^\s*(?:بدك|بتحب|تحب|بتفضل)\s+/, "").trim().split(/\s+/).slice(-3).join(" ");
  const b = parts[1].replace(/\b(?:today|tonight|please|now)\b.*$/i, "").trim().split(/\s+/).slice(0, 3).join(" ");
  const A = stripBullets(a), B = stripBullets(b);
  return A.length >= 2 && B.length >= 2 && A.toLowerCase() !== B.toLowerCase() ? [clip(A, 20), clip(B, 20)] : null;
}

/** The re-ask: nothing was applied; two buttons, one per option. A tap arrives as the option's own words. */
export function reAskCard(options: [string, string], ar: boolean): { body: string; buttons: { id: string; title: string }[] } {
  return {
    body: ar ? "بس لأتأكد، أي واحد بدك؟ 👇" : "Just to be sure, which one do you want? 👇",
    buttons: options.map((o, i) => ({ id: `OPT|${i}`, title: clip(o, 20) })),
  };
}
