// Demo testers (session 5f part 6, DECISIONS §39.15.3): the owner's `tester remove +…` on WhatsApp and `/ak tester remove +…`
// in Slack name a tester by number. Pure helpers, shared by dispatch and ops-slack.

const E164 = /^\+[1-9][0-9]{6,14}$/;

/** A typed number ("+961 70 123 456", "0044 7700-900001") in E.164, or null. */
export function testerPhone(raw: string | null | undefined): string | null {
  const t = String(raw ?? "").trim();
  if (!/^\+?[0-9][0-9\s\-().]{5,24}$/.test(t)) return null;
  let digits = t.replace(/[^0-9+]/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  const e164 = digits.startsWith("+") ? digits : `+${digits}`;
  return E164.test(e164) ? e164 : null;
}

/**
 * `tester remove <number>`: null for any other message; otherwise the tester's number, or a null phone when it cannot be read
 * (the server still decides whether the sender may remove anyone, and the owner is told how to write it).
 */
export function parseTesterRemove(
  text: string | null | undefined,
): { phone: string | null } | null {
  const m = String(text ?? "")
    .trim()
    .match(/^tester\s+remove\s+(.+)$/i);
  return m ? { phone: testerPhone(m[1]) } : null;
}

/** A number as Slack and the owner's reply show it: the country code and the last three digits (Slack is not the record). */
export function maskPhone(p: string): string {
  return p.length < 8
    ? p
    : `${p.slice(0, 4)}${"•".repeat(Math.max(p.length - 7, 1))}${p.slice(-3)}`;
}
