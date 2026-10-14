// Opening hours of a merchant that is not on Alo King yet (DECISIONS §39.3). They come from the seed file as one line of
// English text ("Monday: 8 AM to 8 PM | Tuesday: Closed | …", vendors' import_labels.hours_seed) and are shown as the
// shop's public hours, unconfirmed. Pure: tested in seed-hours.test.ts. Anything that does not parse is shown as written.

export type DayHours = { closed: true } | { allDay: true } | { ranges: [string, string][] };

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
/** Monday first, the way the vendor page lists hours. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

const TIME = /^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i;

function to24(h: number, m: number, mer: string): string | null {
  if (h < 1 || h > 12 || m > 59) return null;
  const hh = mer === "AM" ? (h === 12 ? 0 : h) : h === 12 ? 12 : h + 12;
  return `${String(hh).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "8 AM to 8 PM", "12 to 10 PM" (the start takes the end's AM/PM), "9:30 AM–11:30 PM". */
function parseRange(s: string): [string, string] | null {
  const parts = s.split(/\s+to\s+|\s*[–-]\s*/i);
  if (parts.length !== 2) return null;
  const a = TIME.exec((parts[0] ?? "").trim());
  const b = TIME.exec((parts[1] ?? "").trim());
  if (!a || !b || !b[3]) return null;
  const endMer = b[3].toUpperCase();
  const startMer = (a[3] ?? endMer).toUpperCase();
  const open = to24(Number(a[1]), Number(a[2] ?? 0), startMer);
  const close = to24(Number(b[1]), Number(b[2] ?? 0), endMer);
  return open && close ? [open, close] : null;
}

function parseDay(value: string): DayHours | null {
  const v = value.replace(/\u202f|\u2009/g, " ").trim();
  if (/^closed$/i.test(v)) return { closed: true };
  if (/^open 24 hours$/i.test(v)) return { allDay: true };
  const ranges = v.split(/\s*,\s*/).map(parseRange);
  return ranges.length && ranges.every(Boolean) ? { ranges: ranges as [string, string][] } : null;
}

/** Weekday (0 = Sunday) → hours, or null when the text is missing or not in the seed file's format. */
export function parseSeedHours(text: string | null | undefined): Map<number, DayHours> | null {
  if (!text || !text.trim()) return null;
  const out = new Map<number, DayHours>();
  for (const part of text.split("|")) {
    const m = /^\s*([A-Za-z]+)\s*:\s*(.+?)\s*$/.exec(part);
    if (!m) return null;
    const day = DAYS.indexOf((m[1] ?? "").toLowerCase());
    const hours = parseDay(m[2] ?? "");
    if (day < 0 || !hours || out.has(day)) return null;
    out.set(day, hours);
  }
  return out.size ? out : null;
}

export type HoursWords = {
  closed: string;
  allDay: string;
  everyDay: string;
  days: readonly string[];
};

/** One day's hours as shown: "08:00–20:00", "12:00–15:00, 18:00–23:00", "Open 24 hours", "Closed". */
export function dayHoursText(
  h: DayHours | undefined,
  w: Pick<HoursWords, "closed" | "allDay">,
): string {
  if (!h || "closed" in h) return w.closed;
  if ("allDay" in h) return w.allDay;
  return h.ranges.map(([a, b]) => `${a}–${b}`).join(", ");
}

/**
 * The week in a few words for a card: "Every day 08:00–20:00", or runs of days with the same hours, Monday first:
 * "Mon–Sat 08:00–22:00 · Sun Closed". Null when the hours are unknown or not in the seed format.
 */
export function hoursSummary(text: string | null | undefined, w: HoursWords): string | null {
  const parsed = parseSeedHours(text);
  if (!parsed) return null;
  const rows = WEEK_ORDER.map((d) => ({ d, t: dayHoursText(parsed.get(d), w) }));
  const first = rows[0]?.t ?? "";
  if (rows.every((r) => r.t === first)) return `${w.everyDay} ${first}`;
  const runs: { from: number; to: number; t: string }[] = [];
  for (const r of rows) {
    const last = runs[runs.length - 1];
    if (last && last.t === r.t) last.to = r.d;
    else runs.push({ from: r.d, to: r.d, t: r.t });
  }
  return runs
    .map((r) => {
      const from = w.days[r.from] ?? "";
      return `${r.from === r.to ? from : `${from}–${w.days[r.to] ?? ""}`} ${r.t}`;
    })
    .join(" · ");
}
