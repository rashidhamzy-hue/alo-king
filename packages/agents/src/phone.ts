// A number the rider can call, as a customer types it: "03 123 456", "71123456", "+961 3 123456", "٠٣١٢٣٤٥٦", "00961 70 123 456".
// Returns E.164 or null. Only used when we have just asked for a number, so a quantity is never read as a phone.

const ARABIC_DIGITS = /[٠-٩۰-۹]/g;
const toLatin = (s: string) => s.replace(ARABIC_DIGITS, (d) => String((d.charCodeAt(0) & 0xf) % 10));

/** Lebanese mobile prefixes and landline area codes, without the trunk 0. */
const LB_MOBILE = /^(3\d{6}|(70|71|76|78|79|81)\d{6})$/;
const LB_LANDLINE = /^[1-9]\d{6}$/;           // 01 Beirut, 05 Chouf and Aley, ... written 0X XXX XXX

export function parsePhone(text: string): string | null {
  const t = toLatin(text);
  // The longest run of digits, allowing the separators people type inside a number.
  const runs = t.match(/\+?\d[\d\s\-./()]{5,20}\d/g) ?? [];
  for (const raw of runs.sort((a, b) => b.length - a.length)) {
    const plus = raw.trim().startsWith("+");
    let d = raw.replace(/\D/g, "");
    if (d.startsWith("00")) { d = d.slice(2); return e164Intl(d); }
    if (plus) return e164Intl(d);
    if (d.startsWith("961") && d.length >= 10) d = d.slice(3);
    else if (d.startsWith("0")) d = d.slice(1);
    if (LB_MOBILE.test(d) || (LB_LANDLINE.test(d) && raw.replace(/\D/g, "").startsWith("0"))) return `+961${d}`;
  }
  return null;
}

function e164Intl(d: string): string | null {
  if (d.startsWith("961")) {
    const local = d.slice(3).replace(/^0/, "");
    return LB_MOBILE.test(local) || LB_LANDLINE.test(local) ? `+961${local}` : null;
  }
  return /^[1-9]\d{6,14}$/.test(d) ? `+${d}` : null;
}

/** The message is little more than digits: they meant to send a number, even if we could not read it. */
export function looksLikePhoneAttempt(text: string): boolean {
  const t = toLatin(text).replace(/\s/g, "");
  const digits = t.replace(/\D/g, "").length;
  return digits >= 6 && digits / Math.max(1, t.length) >= 0.6;
}
