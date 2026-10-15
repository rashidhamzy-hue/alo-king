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
  | { kind: "substitute"; code: string; missing: string; substitute: string }
  // The copilot (§39.7): each change is still a proposal the merchant confirms with a tap.
  | CopilotCommand;

export type Station = "fryer" | "oven" | "grill" | "saj" | "espresso" | "cold" | "bar";
export type OfferSpec =
  | { type: "percent"; percent: number; target: string | null; days: number }
  | { type: "happy_hour"; percent: number; from: string; to: string; target: string | null; days: number }
  | { type: "first_order"; percent: number; days: number }
  | { type: "free_item"; free: string; minQuantity: number; target: string; days: number };
export type CopilotCommand =
  /** A station, a section or an item off, for some minutes (back automatically) or until switched on. */
  | { kind: "avail_off"; target: string; station: Station | null; minutes: number | null }
  | { kind: "avail_on"; station: Station }
  | { kind: "stock_set"; item: string; quantity: number }
  | { kind: "item_add"; name: string; priceUsd: number; section: string | null }
  | { kind: "item_rename"; item: string; name: string }
  | { kind: "item_describe"; item: string; description: string }
  | { kind: "item_station"; item: string; station: Station }
  | { kind: "item_remove"; item: string }
  | { kind: "offer"; offer: OfferSpec }
  | { kind: "offer_stop" }
  | { kind: "closure"; day: string }
  | { kind: "hours"; weekdays: number[]; opens: string | null; closes: string | null }
  | { kind: "min_order"; usd: number | null }
  | { kind: "radius"; km: number }
  | { kind: "boost"; budgetUsd: number; audience: "nearby" | "past_customers" }
  | { kind: "boost_stop" }
  | { kind: "report"; period: "day" | "week" }
  | { kind: "staff_list" }
  | { kind: "memory" }
  | { kind: "help" };

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
  const copilot = parseCopilot(t, text, now);
  if (copilot) return copilot;

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
  const avail = parseAvailability(t, now);
  if (avail) return avail;

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

/** "30 min", "1 hour", "1.5 hours", "nos se3a", "نص ساعه", "ساعتين", "half an hour", "une demi-heure", "ربع ساعة". */
export function durationMinutes(s: string): number | null {
  const t = s.trim().replace(/-/g, " ");
  if (/^(?:a\s+|un\s+)?(?:quarter(?:\s+(?:of\s+)?an?)?|quart\s+d'?|rob3|rib3|ربع)\s*(?:hour|heure|se3a|sa3a|ساعه)$/.test(t))
    return 15;
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

// ---- The copilot's commands (§39.7) ------------------------------------------------------------------------------
const STATIONS: [Station, RegExp][] = [
  ["fryer", /^(?:the\s+)?(?:fryer|fryers|deep fryer|friteuse|la friteuse|frayeh|fraye|2alaye|alaye|el 2alaye|قلايه|القلايه|فرايه|الفرايه|المقلايه|مقلايه)$/],
  ["oven", /^(?:the\s+)?(?:oven|four|le four|fern|el fern|فرن|الفرن)$/],
  ["grill", /^(?:the\s+)?(?:grill|bbq|barbecue|mashewe|mashawi|manqal|man2al|el man2al|منقل|المنقل|المشاوي|الشوايه|شوايه)$/],
  ["saj", /^(?:the\s+)?(?:saj|el saj|صاج|الصاج)$/],
  ["espresso", /^(?:the\s+)?(?:espresso|espresso machine|coffee machine|machine a cafe|machine à café|mekinet el ahwe|ماكينه القهوه|ماكينه الاكسبريسو|الاكسبريسو)$/],
  ["cold", /^(?:the\s+)?(?:cold station|cold kitchen|cold line|القسم البارد|البارد)$/],
  ["bar", /^(?:the\s+)?(?:bar|juice bar|el bar|البار)$/],
];
export const stationOf = (s: string): Station | null =>
  STATIONS.find(([, re]) => re.test(s.trim()))?.[0] ?? null;

const OFF_WORDS =
  "(?:off|down|stopped|not working|en panne|arrete|arrêté|ma3attal|m3attal|mtaffe|metfe|mtafye|مطفي|مطفيه|مطفايه|معطل|معطله|واقف|واقفه|خربان|خربانه)";
const ON_WORDS =
  "(?:on|back on|back|working|fixed|rja3|rje3 ysht8l|shaghal|sha8al|marche|remarche|شغال|شغاله|اشتغل|اشتغلت|رجع|رجعت|تصلح|تصلحت)";
const DAYS_WORDS = "(?:days?|jours?|iyyem|ayam|yom|يوم|ايام)";
const ON_TARGET = "(?:on|sur|3a|3al|ع|عال|علي|علي)";

const WEEKDAYS: [number, RegExp][] = [
  [0, /^(?:sun|sunday|sundays|dim|dimanche|a7ad|el a7ad|احد|الاحد)$/],
  [1, /^(?:mon|monday|mondays|lun|lundi|tanein|itnein|el tanein|اثنين|الاثنين|الاتنين|تنين|التنين)$/],
  [2, /^(?:tue|tues|tuesday|tuesdays|mar|mardi|talata|el talata|ثلاثاء|الثلاثاء|التلاته|تلاته|الثلاثا)$/],
  [3, /^(?:wed|wednesday|wednesdays|mer|mercredi|arba3a|el arba3a|اربعاء|الاربعاء|الاربعا|اربعا)$/],
  [4, /^(?:thu|thur|thurs|thursday|thursdays|jeu|jeudi|khamis|el khamis|خميس|الخميس)$/],
  [5, /^(?:fri|friday|fridays|ven|vendredi|jem3a|jom3a|el jem3a|جمعه|الجمعه)$/],
  [6, /^(?:sat|saturday|saturdays|sam|samedi|sabet|el sabet|سبت|السبت)$/],
];
const weekdayOf = (s: string): number | null => WEEKDAYS.find(([, re]) => re.test(s.trim()))?.[0] ?? null;

/** "every day", "mon-fri", "sat sun", "الجمعة" → weekdays 0-6 (0 = Sunday), or null. */
export function weekdaysOf(s: string): number[] | null {
  const t = s.trim();
  if (/^(?:every ?day|daily|all week|7\/7|kel yom|kel youm|tous les jours|كل يوم|كل الايام|طول الاسبوع)$/.test(t))
    return [0, 1, 2, 3, 4, 5, 6];
  const range = t.match(/^(\S+(?: \S+)?)\s*(?:-|to|a|à|la|لل|ل|الي|لـ)\s*(\S+(?: \S+)?)$/);
  if (range) {
    const a = weekdayOf(range[1]);
    const b = weekdayOf(range[2]);
    if (a !== null && b !== null) {
      const out: number[] = [];
      for (let d = a; ; d = (d + 1) % 7) {
        out.push(d);
        if (d === b) break;
      }
      return out;
    }
  }
  const words = t.split(/\s+/).filter((w) => w && !/^(?:and|et|w|و|,)$/.test(w));
  const days = words.map(weekdayOf);
  if (days.length && days.every((d) => d !== null)) return [...new Set(days as number[])].sort();
  return null;
}

/** "9", "9:30", "21", "9pm", "9h" → "HH:MM" (24-hour clock as written; am/pm when given). */
export function clockOf(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})(?:[:h](\d{2}))?\s*(am|pm|h|masa|sob7|soir|matin|مسا|المسا|صبح|الصبح)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (h > 24 || min > 59) return null;
  if (/pm|masa|soir|مسا/.test(m[3] ?? "") && h < 12) h += 12;
  if (/am|sob7|matin|صبح/.test(m[3] ?? "") && h === 12) h = 0;
  if (h === 24) h = 0;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** The Beirut calendar date of a moment plus some days, as YYYY-MM-DD. */
export function beirutDate(now: Date, plusDays = 0): string {
  const d = new Date(now.getTime() + plusDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Beirut" }).format(d);
}

function dayOf(s: string, now: Date): string | null {
  const t = s.trim();
  if (/^(?:today|aujourd'?hui|lyom|el yom|l yom|اليوم)$/.test(t)) return beirutDate(now);
  if (/^(?:tomorrow|demain|bukra|bokra|bkra|بكرا|بكره|بكري)$/.test(t)) return beirutDate(now, 1);
  const wd = weekdayOf(t.replace(/^(?:on|le|nhar|يوم)\s+/, ""));
  if (wd !== null) {
    const today = new Date(`${beirutDate(now)}T12:00:00Z`).getUTCDay();
    return beirutDate(now, (wd - today + 7) % 7 || 7);
  }
  const m = t.replace(/^(?:on|le|nhar|يوم)\s+/, "").match(/^(\d{1,2})[/-](\d{1,2})$/);
  if (m) {
    const [y] = beirutDate(now).split("-").map(Number);
    const day = Number(m[1]);
    const month = Number(m[2]);
    if (day < 1 || day > 31 || month < 1 || month > 12) return null;
    const iso = (yy: number) => `${yy}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return iso(iso(y) < beirutDate(now) ? y + 1 : y);
  }
  return null;
}

const money = (s: string) => Number(s.replace(",", "."));
const PRICE = "\\$?(\\d{1,5}(?:[.,]\\d{1,2})?)\\s*(?:\\$|usd|dollars?|دولار)?";

/** The copilot's typed commands: unambiguous wording only; anything else falls through to the older rules. */
function parseCopilot(t: string, raw: string, now: Date): CopilotCommand | null {
  let m: RegExpMatchArray | null;
  if (/^(?:help|aide|sa3edne|saa3edne|ساعدني|مساعده|شو فيني اعمل|what can you do|que peux-tu faire)$/.test(t))
    return { kind: "help" };
  if (/^(?:what do you remember|what do you know about my shop|memory|shou btetzakar|shu btetzakkar|شو بتتذكر|شو بتعرف عن المحل|شو بتعرف عني|ذاكرتك|que retiens-tu|que sais-tu)$/.test(t))
    return { kind: "memory" };
  if (/^(?:staff|my staff|team|my team|equipe|équipe|mon equipe|el staff|الموظفين|موظفيني|الفريق|فريقي)$/.test(t))
    return { kind: "staff_list" };
  if (/^(?:report|today|today's report|daily report|rapport|rapport du jour|ta2rir|ta2rir el yom|تقرير|تقرير اليوم|شو عملنا اليوم)$/.test(t))
    return { kind: "report", period: "day" };
  if (/^(?:week|this week|weekly report|week report|rapport semaine|rapport de la semaine|ta2rir el jem3a|تقرير الاسبوع|الاسبوع|تقرير الجمعه)$/.test(t))
    return { kind: "report", period: "week" };

  // Offers (§20.4: merchant-funded, the server validates and prices them).
  if (/^(?:stop (?:the )?offer|end (?:the )?offer|no (?:more )?offer|cancel (?:the )?offer|fin de l'?offre|arreter l'?offre|wa22ef el 3ard|shil el 3ard|وقف العرض|الغي العرض|شيل العرض)$/.test(t))
    return { kind: "offer_stop" };
  const days = (d?: string) => (d ? Math.min(Math.max(Number(d), 1), 30) : 7);
  m = t.match(new RegExp(`^(?:happy hour|happy hours|ساعه سعيده)\\s+(\\d{1,2})\\s*%\\s+(\\S+)\\s*(?:-|to|a|à|la|لل|ل)\\s*(\\S+?)(?:\\s+${ON_TARGET}\\s+(.+?))?(?:\\s+(?:for|pour|la|ل)?\\s*(\\d{1,2})\\s*${DAYS_WORDS})?$`));
  if (m) {
    const from = clockOf(m[2]);
    const to = clockOf(m[3]);
    if (from && to && from !== to)
      return { kind: "offer", offer: { type: "happy_hour", percent: Number(m[1]), from, to, target: m[4]?.trim() || null, days: days(m[5]) } };
  }
  m = t.match(/^(?:first order|premiere commande|première commande|awwal talab|اول طلب|اول طلبيه)\s+(\d{1,2})\s*%(?:\s+(?:off|discount|remise|khasm|خصم))?$/);
  if (m) return { kind: "offer", offer: { type: "first_order", percent: Number(m[1]), days: 30 } };
  m = t.match(new RegExp(`^(?:free|gratuit|offert|majjanan|ببلاش|مجانا|مجاني|هديه)\\s+(.+?)\\s+(?:with|avec|ma3|مع)\\s+(\\d{1,2})\\s+(.+?)(?:\\s+(?:for|pour|la|ل)?\\s*(\\d{1,2})\\s*${DAYS_WORDS})?$`));
  if (m) return { kind: "offer", offer: { type: "free_item", free: m[1].trim(), minQuantity: Number(m[2]), target: m[3].trim(), days: days(m[4]) } };
  // "10% off", "10% on sandwiches", "10% off sandwiches 3 days", "خصم 20% على الكنافة".
  m = t.match(new RegExp(`^(?:(?:offer|offre|promo|3ard|عرض|khasm|خصم|حسم)\\s+)?(\\d{1,2})\\s*%(?:\\s+(?:off|discount|remise|reduction|réduction|khasm|خصم|حسم))?(?:\\s+(?:${ON_TARGET}\\s+)?(?!(?:for|pour)\\b)(.+?))?(?:\\s+(?:for|pour|la|ل)?\\s*(\\d{1,2})\\s*${DAYS_WORDS})?$`));
  if (m && /%/.test(t))
    return { kind: "offer", offer: { type: "percent", percent: Number(m[1]), target: m[2]?.trim() || null, days: days(m[3]) } };

  // Menu items: add, rename, describe, station, remove, stock.
  m = t.match(new RegExp(`^(?:add item|new item|add dish|new dish|nouveau plat|ajoute plat|ajouter plat|zid sanf|zeed sanf|sanf jdid|زيد صنف|ضيف صنف|صنف جديد|اضف صنف)\\s+(.+?)\\s+${PRICE}(?:\\s+(?:(?:in|to|dans|bi|b|fi|في|علي)\\s+(?:ال)?|بال|ب)(.+))?$`));
  if (m && m[1].trim()) {
    const name = raw.trim().split(/\s+/).length > 0 ? m[1].trim() : m[1].trim();
    return { kind: "item_add", name: name.slice(0, 80), priceUsd: money(m[2]), section: m[3]?.trim() || null };
  }
  m = t.match(/^(?:rename|renomme|renommer|ghayyer esm|8ayyer esm|غير اسم|بدل اسم)\s+(?:ال)?(.+?)\s+(?:to|en|la|l|ل|الي|لـ)\s+(.+)$/);
  if (m && m[1].trim() && m[2].trim()) return { kind: "item_rename", item: m[1].trim(), name: m[2].trim().slice(0, 80) };
  const d = raw.match(/^\s*(?:describe|description|décris|decris|wasf|وصف)\s+(.+?)\s*[:=]\s*(.+?)\s*$/i);
  if (d && d[1].trim() && d[2].trim())
    return { kind: "item_describe", item: normalize(d[1]), description: d[2].trim().slice(0, 500) };
  m = t.match(/^(.+?)\s+(?:station|from the|on the|sur la|sur le|men el|3al|علي|عال|من ال)\s*(\S+(?: \S+)?)$/);
  if (m && stationOf(m[2]) && !/\d/.test(m[1]) && !/^(?:turn|switch)\b/.test(m[1])) return { kind: "item_station", item: m[1].trim(), station: stationOf(m[2])! };
  m = t.match(/^(?:remove item|delete item|remove dish|delete dish|supprime plat|supprimer plat|enleve plat|shil sanf|sheel sanf|شيل صنف|احذف صنف|امحي صنف|شيل من المنيو)\s+(?:ال)?(.+)$/);
  if (m && m[1].trim()) return { kind: "item_remove", item: m[1].trim() };
  m = t.match(/^(?:stock|inventory|mekhzoun|makhzoun|مخزون|المخزون)\s+(?:ال)?(.+?)\s+(\d{1,5})$/) ?? t.match(/^(.+?)\s+(?:stock|en stock|مخزون)\s+(\d{1,5})$/);
  if (m && m[1].trim()) return { kind: "stock_set", item: m[1].trim(), quantity: Number(m[2]) };

  // Closures, hours, minimum order, radius.
  m = t.match(/^(?:closed|close|ferme|fermé|fermes|fermés|msakrin|msakkrin|msaker|مسكرين|مسكر|سكرانين)\s+(?:every|chaque|kel|كل)\s+(.+)$/)
    ?? t.match(/^(?:closed|ferme|fermé|msakrin|مسكرين)\s+(sundays|mondays|tuesdays|wednesdays|thursdays|fridays|saturdays)$/);
  if (m) {
    const wd = weekdaysOf(m[1]);
    if (wd) return { kind: "hours", weekdays: wd, opens: null, closes: null };
  }
  m = t.match(/^(?:closed|close|ferme|fermé|fermes|fermés|msakrin|msakkrin|msaker|مسكرين|مسكر|سكرانين)\s+(.+)$/);
  if (m) {
    const day = dayOf(m[1], now);
    if (day) return { kind: "closure", day };
  }
  m = t.match(/^(?:hours|horaires|dawam|dawem|دوام|الدوام|ساعات|open|ouvert|fat7in|فاتحين)\s+(.+?)\s+(\d{1,2}(?:[:h]\d{2})?\s*(?:am|pm|h|masa|sob7|soir|matin|مسا|المسا|صبح|الصبح)?)\s*(?:-|to|à|a|la|لل|ل|الي)\s*(\d{1,2}(?:[:h]\d{2})?\s*(?:am|pm|h|masa|sob7|soir|matin|مسا|المسا|صبح|الصبح)?)$/);
  if (m) {
    const wd = weekdaysOf(m[1]);
    const opens = clockOf(m[2]);
    const closes = clockOf(m[3]);
    if (wd && opens && closes && opens !== closes) return { kind: "hours", weekdays: wd, opens, closes };
  }
  if (/^(?:no minimum|no min|no minimum order|pas de minimum|bala 7add adna|بلا حد ادني|ما في حد ادني|بلا حد)$/.test(t))
    return { kind: "min_order", usd: null };
  m = t.match(new RegExp(`^(?:min|minimum|min order|minimum order|order minimum|commande minimum|minimum de commande|a2al talab|ا?قل طلب|الحد الادني|حد ادني)\\s+${PRICE}$`));
  if (m) return { kind: "min_order", usd: money(m[1]) };
  m = t.match(/^(?:radius|delivery radius|delivery range|rayon|rayon de livraison|nita2|نطاق|نطاق التوصيل|مسافه التوصيل|بنوصل لـ?)\s+(\d{1,2}(?:[.,]\d)?)\s*(?:km|kms|كم|كلم|كيلو)?$/);
  if (m) return { kind: "radius", km: money(m[1]) };

  // Boost and sponsored placement (§20.4, §39.7).
  if (/^(?:stop boost|boost off|end boost|arrete boost|wa22ef el boost|وقف البوست|الغي البوست|وقف الاعلان)$/.test(t))
    return { kind: "boost_stop" };
  m = t.match(new RegExp(`^(?:boost|sponsor|promote|booster|بوست|اعلان|ترويج)\\s+${PRICE}(?:\\s+(?:to\\s+|for\\s+|pour\\s+|la\\s+|ل)?(nearby|near me|around|people nearby|past customers|old customers|my customers|regulars|clients|mes clients|zbeyne|zabeyni|زباين|الزباين|زبايني|حولي|قريب|القريبين))?$`));
  if (m) {
    const past = /past|old|my customers|regulars|clients|zbeyne|zabeyni|زباين|الزباين|زبايني/.test(m[2] ?? "");
    return { kind: "boost", budgetUsd: money(m[1]), audience: past ? "past_customers" : "nearby" };
  }
  return null;
}

/** Availability (§38.3 "fryer off 15 min"): a station, a section or an item off for a while, and a station back on.
 * Read after the older rules, so "capacity off" and "generator off" keep their meaning. */
function parseAvailability(t: string, now: Date): CopilotCommand | null {
  let m: RegExpMatchArray | null;
  m = t.match(new RegExp(`^(?:turn on|switch on|${"شغل|رجع"})\\s+(.+)$`)) ?? t.match(new RegExp(`^(.+?)\\s+${ON_WORDS}$`));
  if (m && stationOf(m[1])) return { kind: "avail_on", station: stationOf(m[1])! };
  m = t.match(/^(?:turn off|switch off|tafi|taffi|طفي|اطفي)\s+(.+)$/);
  if (m) {
    const words = m[1].split(" ");
    for (let k = words.length; k >= 1; k--) {
      const head = words.slice(0, k).join(" ");
      const rest = words.slice(k).join(" ").replace(/^(?:for|pour|la|ل)\s+/, "");
      const mins = rest ? untilMinutes(rest, now) : null;
      if (stationOf(head) && (!rest || mins !== null))
        return { kind: "avail_off", target: head, station: stationOf(head), minutes: mins };
    }
  }
  m = t.match(new RegExp(`^(.+?)\\s+${OFF_WORDS}(?:\\s+(?:for|pour|la|ل)?\\s*(.+))?$`));
  if (m && m[1].trim() && durationMinutes(m[1]) === null) {
    const mins = m[2] ? untilMinutes(m[2], now) : null;
    if (!m[2] || mins !== null) return { kind: "avail_off", target: m[1].replace(/^ال(?=\S)/, "").trim(), station: stationOf(m[1]), minutes: mins };
  }
  return null;
}

/** "15 min", "ربع ساعة", "till 6", "lal 9 masa" → minutes from now (1 minute to 24 hours), else null. */
export function untilMinutes(s: string, now: Date): number | null {
  const d = durationMinutes(s);
  if (d !== null) return d >= 1 && d <= 24 * 60 ? d : null;
  const untilRe = new RegExp(`^${UNTIL}\\s*`);
  if (!untilRe.test(s.trim())) return null;
  const c = clockTime(s.trim().replace(untilRe, ""), now);
  if (!c) return null;
  return Math.round((nextBeirutTime(c.hour, c.minute, now).getTime() - now.getTime()) / 60_000);
}
