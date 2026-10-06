// Short welcome (P1-7): a greeting gets a one-line hello with [Reorder] [Browse] [Surprise me]. Reorder only when there is a past order; it is a button, never a big card by default.
// "Browse" opens a short list of moods; each row goes to the same free search as typing the word. Pure; index.ts sends the payloads.

export type WelcomeButton = { id: string; title: string };
export const WELCOME_BROWSE = "WELCOME|browse", WELCOME_SURPRISE = "WELCOME|surprise";

export function welcomeCard(o: { ar: boolean; name?: string | null; lastOrderId?: string | null }): { body: string; buttons: WelcomeButton[] } {
  const first = String(o.name ?? "").trim().split(/\s+/)[0]?.slice(0, 20);
  const hi = o.ar ? `أهلا${first ? ` ${first}` : ""} 👋 شو بدك اليوم؟` : `Hi${first ? ` ${first}` : ""} 👋 What can I get you today?`;
  return {
    body: hi,
    buttons: [
      ...(o.lastOrderId ? [{ id: `REORDER|${o.lastOrderId}`, title: o.ar ? "🔁 أعد طلبي" : "🔁 Reorder" }] : []),
      { id: WELCOME_BROWSE, title: o.ar ? "📋 تصفّح" : "📋 Browse" },
      { id: WELCOME_SURPRISE, title: o.ar ? "🎲 فاجئني" : "🎲 Surprise me" },
    ],
  };
}

// mood id -> the typed phrase the free search understands (searchfirst.MOODS)
const MOODS: { key: string; phrase: string; en: string; ar: string }[] = [
  { key: "popular", phrase: "what's good", en: "🔥 What's popular", ar: "🔥 الأكثر طلباً" },
  { key: "breakfast", phrase: "breakfast", en: "🥐 Breakfast", ar: "🥐 فطور" },
  { key: "light", phrase: "something light", en: "🥗 Light and healthy", ar: "🥗 خفيف وصحي" },
  { key: "sweet", phrase: "dessert", en: "🍰 Something sweet", ar: "🍰 شي حلو" },
  { key: "spicy", phrase: "spicy", en: "🌶️ Spicy", ar: "🌶️ حار" },
  { key: "cheap", phrase: "cheap", en: "💸 Cheap eats", ar: "💸 أوفر" },
];
export const moodRows = (ar: boolean) => MOODS.map((m) => ({ id: `MOOD|${m.key}`, title: ar ? m.ar : m.en }));
export const moodPhrase = (key: string): string | null => MOODS.find((m) => m.key === key)?.phrase ?? null;
export function parseWelcomeTap(id: string): "browse" | "surprise" | { mood: string } | null {
  if (id === WELCOME_BROWSE) return "browse";
  if (id === WELCOME_SURPRISE) return "surprise";
  const m = String(id ?? "").match(/^MOOD\|([a-z]+)$/);
  return m && moodPhrase(m[1]) ? { mood: m[1] } : null;
}
