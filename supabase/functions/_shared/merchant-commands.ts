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
  | { kind: "top_up"; amountUsd: number }
  // Merchant WhatsApp extras (§32.5)
  | { kind: "power_off" }
  | { kind: "power_on" }
  | { kind: "needs_power"; item: string; on: boolean }
  | { kind: "capacity"; max: number | null }
  | { kind: "staff_add"; name: string; role: StaffRole; phone: string }
  | { kind: "staff_remove"; name: string }
  | { kind: "same_price"; on: boolean }
  | { kind: "substitute"; code: string; missing: string; substitute: string };

export type StaffRole = "manager" | "cashier" | "kitchen" | "driver";
const ROLE_WORDS: [StaffRole, RegExp][] = [
  ["kitchen", /^(?:kitchen|cook|chef|cuisine|cuisinier|matbakh|matba5|tabbakh|مطبخ|المطبخ|طباخ|شيف)$/],
  ["cashier", /^(?:cashier|cash|caisse|caissier|caissiere|kashir|kasher|كاشير|كاشيره|صندوق)$/],
  ["manager", /^(?:manager|gerant|gérant|responsable|modir|mdir|مدير|مديره|مسؤول)$/],
  ["driver", /^(?:driver|delivery|livreur|chauffeur|shofer|shofeir|delivery boy|سائق|سايق|شوفير|دليفري|ديليفري)$/],
];

/** A Lebanese or international number as written ("+961 3 123 456", "03 123456", "71-234-567") in E.164. */
export function phoneE164(raw: string): string | null {
  const d = raw.replace(/[\s().-]/g, "");
  if (/^\+[1-9]\d{6,14}$/.test(d)) return d;
  if (/^00[1-9]\d{6,14}$/.test(d)) return `+${d.slice(2)}`;
  if (/^0?(3|7[016-9]|81)\d{6}$/.test(d)) return `+961${d.replace(/^0/, "")}`;
  if (/^961(3|7[016-9]|81)\d{6}$/.test(d)) return `+${d}`;
  return null;
}

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

  const extra = parseExtras(t, text);
  if (extra) return extra;

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

const POWER_OFF =
  /^(?:ma ?fi kahraba2?|ma ?fi kahraba|ma fi kahraba|no power|power off|power cut|power is off|power outage|generator off|generator mode|generator|coupure|coupure de courant|pas de courant|ما ?في كهربا|ما ?في كهرباء|قطعت الكهربا|انقطعت الكهربا|راحت الكهربا|الكهربا مقطوعه|الموتور طافي|طفي الموتور)$/;
const POWER_ON =
  /^(?:power back|power is back|power on|power's back|kahraba rej3et|rej3et el kahraba|ijet el kahraba|ejet el kahraba|courant revenu|le courant est revenu|retour du courant|رجعت الكهربا|اجت الكهربا|الكهربا رجعت|في كهربا|رجعت الكهرباء)$/;

/** The §32.5 extras: generator mode, capacity, staff, same-price badge and substitutes. */
function parseExtras(t: string, raw: string): MerchantCommand | null {
  if (POWER_OFF.test(t)) return { kind: "power_off" };
  if (POWER_ON.test(t)) return { kind: "power_on" };
  let m = t.match(/^(.+?)\s+(?:needs power|needs electricity|on power|بدو كهربا|بدها كهربا|بدو كهرباء|بدها كهرباء|bado kahraba|bada kahraba)$/);
  if (m) return { kind: "needs_power", item: m[1].trim(), on: true };
  m = t.match(/^(.+?)\s+(?:without power|no power needed|works without power|بلا كهربا|بيمشي بلا كهربا|ما بدو كهربا|ما بدها كهربا|bala kahraba)$/);
  if (m) return { kind: "needs_power", item: m[1].trim(), on: false };
  m = t.match(/^(?:capacity|max orders|max active orders|kitchen capacity|capacite|capacité|ta2a|طاقه|طاقتنا|طاقه المطبخ|اقصى عدد طلبات)\s+(\d{1,3}|off|none|no limit|بلا|الغي|annuler)$/);
  if (m) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : null;
    return n === null || (n >= 1 && n <= 200) ? { kind: "capacity", max: n } : null;
  }
  // add Ali as kitchen +961 3 123 456 / زيد علي مطبخ 03123456 / ajoute Ali cuisine +961...
  m = t.match(/^(?:add|ajoute|ajouter|zid|zeed|زيد|ضيف|اضف)\s+(.+?)\s+(?:as\s+|comme\s+|ك\s*)?(\S+(?: boy)?)\s+(\+?[\d\s-]{7,20})$/);
  if (m) {
    const role = ROLE_WORDS.find(([, re]) => re.test(m![2]))?.[0];
    const phone = phoneE164(m[3]);
    // The name as typed (original case), from the raw message.
    const name = raw.trim().split(/\s+/).slice(1).join(" ").match(new RegExp(`^(.{1,60}?)\\s+(?:as\\s+|comme\\s+)?\\S+(?: boy)?\\s+\\+?[\\d\\s٠-٩-]{7,20}$`, "i"))?.[1] ?? m[1];
    if (role && phone) return { kind: "staff_add", name: name.trim().slice(0, 60), role, phone };
  }
  m = t.match(/^(?:remove|delete|supprime|supprimer|enleve|enlève|shil|sheel|شيل|احذف|امحي)\s+(?:staff\s+)?(\S.{0,59})$/);
  if (m && !/\d{3}/.test(m[1])) return { kind: "staff_remove", name: m[1].trim() };
  if (/^(?:same price|same prices|same price as shop|same price as in the shop|meme prix|même prix|nafs el se3r|نفس السعر|نفس الاسعار|نفس اسعار المحل|نفس سعر المحل)$/.test(t))
    return { kind: "same_price", on: true };
  if (/^(?:not same price|different prices|prix differents|مش نفس السعر|الاسعار مختلفه|مش نفس الاسعار)$/.test(t))
    return { kind: "same_price", on: false };
  // sub ABC123 pepsi = 7up / بديل ABC123 بيبسي = سفن اب / remplace ABC123 pepsi = 7up
  m = t.match(/^(?:sub|substitute|replace|remplace|remplacer|badil|بديل|بدل)\s+#?([a-z2-9]{6})\s+(.+?)\s*(?:=|->|→|=>)\s*(.+)$/);
  if (m && m[2].trim() && m[3].trim())
    return { kind: "substitute", code: m[1].toUpperCase(), missing: m[2].trim(), substitute: m[3].trim() };
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
