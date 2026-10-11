// Deterministic merchant commands (DECISIONS §30.2.1): common messages on the Merchant number are parsed by
// rules before any model call, in Arabic, English, French and Arabizi. Only text these rules do not
// recognise goes to the model (session 5). Every change still needs the merchant's confirming tap (§18.2):
// the parser only proposes. Pure: no I/O, runs under vitest and Deno.

export type MerchantCommand =
  | { kind: "sold_out"; item: string }
  | { kind: "back_in_stock"; item: string }
  | { kind: "price"; item: string; priceUsd: number }
  | { kind: "pause"; minutes: number }
  | { kind: "pause_until"; hour: number; minute: number }
  | { kind: "open" }
  | { kind: "balance" }
  | { kind: "top_up"; amountUsd: number };

// Arabic-Indic and Persian digits to ASCII; Arabic decimal separator to a dot.
const DIGITS: Record<string, string> = {
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
  "۰": "0",
  "۱": "1",
  "۲": "2",
  "۳": "3",
  "۴": "4",
  "۵": "5",
  "۶": "6",
  "۷": "7",
  "۸": "8",
  "۹": "9",
  "٫": ".",
};

/** Lower-case, ASCII digits, no tashkeel or tatweel, alef/ya/ta-marbuta folded, single spaces. */
export function normalize(text: string): string {
  return (
    text
      .replace(/[٠-٩۰-۹٫]/g, (d) => DIGITS[d] ?? d)
      .replace(/[ً-ْـ]/g, "")
      .replace(/[أإآ]/g, "ا")
      .replace(/ى/g, "ي")
      .replace(/ة(?=\s|$)/g, "ه")
      .toLowerCase()
      // Punctuation goes, except a dot, comma or colon inside a number (3.5, 3,5, 20:30).
      .replace(/(?<!\d)[.,:]|[.,:](?!\d)|[!?،؛;]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

const num = (s: string) => Number(s.replace(",", "."));

// Words that open a "pause" message, and the unit words that follow a number.
const PAUSE_WORDS =
  "(?:pause|paused|close|closed|closing|ferme|fermé|fermer|pause|msaker|msakar|msakkar|mrakad|m?sakra|sakrin|سكرنا|مسكر|مسكرين|مسكّر|مسكره|سكر|سكّر|وقف|اوقف|بريك)";
const MIN_WORDS =
  "(?:m|min|mins|minute|minutes|mn|d2i2a|d2ay2|dakika|da2ay2|da2i2a|دقيقه|دقايق|دقائق|د)";
const HOUR_WORDS = "(?:h|hr|hrs|hour|hours|heure|heures|se3a|sa3a|sa3at|ساعه|ساعات|ساعتين)";
const HALF = "(?:nos|nus|noss|nas|نص|نصف|half|demi|demie)";
const UNTIL = "(?:jusqu'?a|jusqua|until|till|lal|lel|la|to|l|à|a|حتى|الى|لل|ل)";

const SOLD_OUT = [
  /^(?:sold ?out|out of|no more|finished|khelset|khlset|khelis|khalas|5elset|5les|5elis|fini|epuise|épuisé|plus de|rupture(?: de)?)\s+(.+)$/,
  /^(.+?)\s+(?:sold ?out|finished|is out|khelset|khlset|5elset|5ls|fini|finie|epuise|épuisé|خلص|خلصت|خلصو|مخلص|مخلصه)$/,
  /^(?:خلص|خلصت|خلصو|ما في|مافي|مخلص|نفد|نفذ)\s+(?:ال)?(.+)$/,
];
const BACK = [
  /^(?:back|available|back in stock|rja3|rje3|raje3|ja|dispo|disponible|de retour)\s+(.+)$/,
  /^(.+?)\s+(?:is back|back|available|rje3|rja3|raje3|dispo|disponible|de retour|رجع|رجعت|متوفر|متوفره|موجود)$/,
  /^(?:رجع|رجعت|في|متوفر|متوفره)\s+(?:ال)?(.+)$/,
];

/** Parses one merchant message. Returns null when the rules do not recognise it (the model gets it). */
export function parseMerchantCommand(text: string, now: Date = new Date()): MerchantCommand | null {
  const t = normalize(text);
  if (!t || t.length > 120) return null;

  // balance / رصيدي / solde
  if (
    /^(?:balance|my balance|credit|solde|mon solde|rasidi|raside|rasid|رصيد|رصيدي|كم رصيدي|شو رصيدي)$/.test(
      t,
    )
  ) {
    return { kind: "balance" };
  }
  // top up 20 / charge 20$ / شحن 20 / recharge 20
  let m = t.match(
    /^(?:top ?up|charge|recharge|recharger|ishhan|shhan|sha7en|e4hen|شحن|اشحن|عبي)\s*\$?\s*(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:\$|usd|dollar|dollars|دولار)?$/,
  );
  if (m) return { kind: "top_up", amountUsd: num(m[1]) };

  // open / فتحنا / ouvert
  if (
    /^(?:open|opened|we are open|re ?open|ouvert|ouverts|on est ouvert|fata7na|fta7na|fete7na|fat7in|فتحنا|فاتحين|مفتوح|فتح)$/.test(
      t,
    )
  ) {
    return { kind: "open" };
  }

  // pause 30 min / closed 1 hour / مسكر نص ساعة / Mrakad 30 mins
  const pauseRe = new RegExp(`^${PAUSE_WORDS}(?:\\s+(?:for|pour))?\\s+(.+)$`);
  m = t.match(pauseRe);
  if (m) {
    const rest = m[1].trim();
    // Arabizi "la"/"li" can mean "for" ("msaker la nos se3a") or "until" ("msaker la 9"): try both.
    const minutes = durationMinutes(rest.replace(/^(?:la|li|l)\s+/, ""));
    if (minutes !== null)
      return minutes >= 1 && minutes <= 24 * 60 ? { kind: "pause", minutes } : null;
    const untilRe = new RegExp(`^${UNTIL}\\s*`);
    if (untilRe.test(rest)) {
      const until = clockTime(rest.replace(untilRe, ""), now);
      if (until) return { kind: "pause_until", ...until };
    }
  }

  // price knefe 3.5 / سعر الكنافة 3.5 / prix knefe 3,5
  m = t.match(
    /^(?:price|prix|se3r|si3r|sa3r|سعر|حط سعر)\s+(?:ال)?(.+?)\s+\$?(\d{1,5}(?:[.,]\d{1,2})?)\s*(?:\$|usd|dollar|dollars|دولار)?$/,
  );
  if (m && m[1].trim()) return { kind: "price", item: m[1].trim(), priceUsd: num(m[2]) };

  for (const re of SOLD_OUT) {
    m = t.match(re);
    if (m && m[1].trim()) return { kind: "sold_out", item: m[1].trim() };
  }
  for (const re of BACK) {
    m = t.match(re);
    if (m && m[1].trim()) return { kind: "back_in_stock", item: m[1].trim() };
  }
  return null;
}

/** "30 min", "1 hour", "1.5 hours", "nos se3a", "نص ساعه", "ساعتين", "half an hour", "une demi-heure". */
export function durationMinutes(s: string): number | null {
  const t = s.trim().replace(/-/g, " ");
  if (new RegExp(`^(?:une\\s+|a\\s+)?${HALF}\\s*(?:an?\\s+)?${HOUR_WORDS}$`).test(t)) return 30;
  if (/^(?:ساعتين|se3tein|sa3tein|se3ten|sa3ten)$/.test(t)) return 120;
  if (new RegExp(`^(?:a|an|one|une|wa7de|ساعه)?\\s*${HOUR_WORDS}$`).test(t)) return 60;
  let m = t.match(new RegExp(`^(\\d{1,4}(?:[.,]\\d)?)\\s*${MIN_WORDS}$`));
  if (m) return Math.round(num(m[1]));
  m = t.match(new RegExp(`^(\\d{1,2})\\s*${HOUR_WORDS}\\s*(?:w|و|and|et)\\s*${HALF}$`));
  if (m) return Number(m[1]) * 60 + 30;
  m = t.match(new RegExp(`^(\\d{1,2}(?:[.,]\\d)?)\\s*${HOUR_WORDS}$`));
  if (m) return Math.round(num(m[1]) * 60);
  return null;
}

/** Beirut wall-clock hour and minute of a moment. */
export function beirutClock(at: Date): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Beirut",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (k: string) => Number(parts.find((p) => p.type === k)?.value ?? "0");
  return { hour: get("hour"), minute: get("minute") };
}

/**
 * "8", "8pm", "20:30", "8 masa", "11" → hour and minute on the Beirut clock. Without am/pm, an hour from
 * 1 to 11 that has already passed this morning means the evening (a restaurant closing "till 8").
 */
export function clockTime(s: string, now: Date): { hour: number; minute: number } | null {
  const m = s
    .trim()
    .match(
      /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|masa|el masa|sob7|sbe7|soir|matin|المسا|مسا|الصبح|صبح)?$/,
    );
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  if (hour > 23 || minute > 59) return null;
  const suffix = m[3] ?? "";
  if (/pm|masa|soir|مسا/.test(suffix) && hour < 12) hour += 12;
  if (/am|sob7|sbe7|matin|صبح/.test(suffix) && hour === 12) hour = 0;
  const nowH = beirutClock(now);
  if (
    !suffix &&
    hour >= 1 &&
    hour <= 11 &&
    (hour < nowH.hour || (hour === nowH.hour && minute <= nowH.minute))
  )
    hour += 12;
  return { hour, minute };
}

/** The next moment the Beirut clock shows hour:minute (today, or tomorrow if it has passed). */
export function nextBeirutTime(hour: number, minute: number, now: Date): Date {
  const cur = beirutClock(now);
  let diff = hour * 60 + minute - (cur.hour * 60 + cur.minute);
  if (diff <= 0) diff += 24 * 60;
  const out = new Date(now.getTime() + diff * 60_000);
  out.setUTCSeconds(0, 0);
  return out;
}
