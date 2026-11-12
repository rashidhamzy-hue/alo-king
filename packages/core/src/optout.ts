// Opt-out and opt-in detection. Runs on every inbound customer message before any agent sees it.
// A match is honoured immediately and deterministically: no model is asked whether the person "really" meant it.
const norm = (s: string) => s.toLowerCase().normalize("NFKC").replace(/[ً-ْـ]/g, "").replace(/[!?.،,]/g, " ").replace(/\s+/g, " ").trim();

const STOP_EXACT = new Set(["stop", "unsubscribe", "arret", "arrêt", "وقف", "توقف", "الغاء", "إلغاء", "ايقاف", "إيقاف", "khalas", "5alas", "خلص", "بلوك"]);
const STOP_PHRASES = [
  "stop messages", "stop sending", "no more messages", "remove me", "ما بدي رسايل", "ما بدي رسائل", "ما تبعتولي", "ما تبعتلي", "لا تبعتولي",
  "وقفو الرسايل", "وقف الرسايل", "شيلوني", "شيلني", "ma badde rasayel", "ma tb3atoule", "arretez", "ne plus recevoir",
];
const START_EXACT = new Set(["start", "subscribe", "اشترك", "اشتراك"]);

export type ConsentSignal = "opt_out" | "opt_in" | null;

export function detectConsentSignal(text: string): ConsentSignal {
  const t = norm(text);
  if (!t) return null;
  if (STOP_EXACT.has(t)) return "opt_out";
  if (t.length <= 60 && STOP_PHRASES.some((p) => t.includes(norm(p)))) return "opt_out";
  if (START_EXACT.has(t)) return "opt_in";
  return null;
}
