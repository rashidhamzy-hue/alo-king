// BK0: the pure parts of the backup, so they can be tested without a database or a bucket.
//
// An index (`<environment>/index.json` in the store) lists every copy. It is not secret: a key, a time, a size, a checksum and the
// Postgres major version, never a row or a name. The copies themselves are encrypted (gpg, AES-256) before they leave the runner.
//
// Retention: every run makes one copy. The first copy of each ISO week is also kept as the week's copy. A copy stays while it is
// one of the newest NIGHTLY (14) copies or one of the newest WEEKLY (8) week copies, and goes when it is neither.

export const NIGHTLY = 14;
export const WEEKLY = 8;
export const STALE_HOURS = 36;

/** ISO 8601 week id of a date, e.g. "2026-W47". Weeks start on Monday (UTC). */
export function isoWeek(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);                       // the Thursday of this week decides the year
  const year = t.getUTCFullYear();
  const week = Math.ceil(((t - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** The object key of a copy: `<environment>/<UTC time>.tar.gpg`, sortable by name. */
export function copyKey(environment, when) {
  const stamp = when.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `${environment}/${stamp}.tar.gpg`;
}

/** Adds a new copy to an index and works out what to keep. Returns the new index (newest first) and the entries to delete. */
export function addAndPrune(entries, copy, { nightly = NIGHTLY, weekly = WEEKLY } = {}) {
  const week = isoWeek(new Date(copy.created_at));
  const hasWeek = entries.some((e) => e.weekly && isoWeek(new Date(e.created_at)) === week);
  const added = { ...copy, weekly: !hasWeek };
  const all = [added, ...entries.filter((e) => e.key !== copy.key)].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  const keepKeys = new Set([
    ...all.slice(0, nightly).map((e) => e.key),
    ...all.filter((e) => e.weekly).slice(0, weekly).map((e) => e.key),
  ]);
  return { index: all.filter((e) => keepKeys.has(e.key)), remove: all.filter((e) => !keepKeys.has(e.key)) };
}

export const newest = (entries) => [...entries].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0] ?? null;

export const ageHours = (entry, now = new Date()) => (entry ? (now.getTime() - new Date(entry.created_at).getTime()) / 3600000 : Infinity);

/** "6.2 hours", "3.1 days" */
export const humanAge = (h) => (!Number.isFinite(h) ? "no copy at all" : h < 48 ? `${h.toFixed(1)} hours` : `${(h / 24).toFixed(1)} days`);

/** The passphrase rules, in one place so the message is the same everywhere. Returns an error string or null. */
export function passphraseProblem(p) {
  if (!p) return "BACKUP_PASSPHRASE is not set (BACKUP_PASSPHRASE_PRODUCTION for production). Add it as a repository secret (Settings, Secrets and variables, Actions). It exists only with the founder; see docs/RUNBOOK.md \"Restore\". Nothing was dumped.";
  if (p.length < 24) return "BACKUP_PASSPHRASE is shorter than 24 characters. Make a long random one (a password manager's generator) and set the secret again. Nothing was dumped.";
  return null;
}
