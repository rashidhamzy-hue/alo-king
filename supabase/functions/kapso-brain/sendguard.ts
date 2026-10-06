// Send failures that must stop broadcasts and wake the admin (Meta error codes, from the Kapso WhatsApp docs "prepaid billing" page):
//   131042  Business eligibility payment issue: the payment method / balance check failed. Not proof the balance is empty; an admin must check Billing.
//   130429  Rate limit hit (also HTTP 429): slow down and retry later.
// Meta's advice: do not retry in a tight loop, back off or pause the queue, surface it to the account admin, reconcile against delivery.
// Pure helpers only; the incident state (backoff ladder, alert once) is the atomic SQL function record_send_failure.
export type FailureKind = "payment" | "rate_limit";

export function failureKind(code: number | null | undefined, httpStatus?: number): FailureKind | null {
  if (code === 131042) return "payment";
  if (code === 130429 || httpStatus === 429) return "rate_limit";
  return null;
}

/** A send that was rejected straight away: the HTTP status plus the error code from the JSON body, if any. */
export function failureFromBody(status: number, text: string): { kind: FailureKind; code: number | null } | null {
  let code: number | null = null;
  try { const j = JSON.parse(text); const c = Number(j?.error?.code ?? j?.code); if (Number.isFinite(c)) code = c; } catch { /* not JSON */ }
  const kind = failureKind(code, status);
  return kind ? { kind, code } : null;
}

export const isPaused = (untilIso: string | null | undefined, nowMs: number): boolean => { const t = Date.parse(String(untilIso ?? "")); return Number.isFinite(t) && nowMs < t; };
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Asia/Beirut", hour: "2-digit", minute: "2-digit" });

/** What the admin is told, once per incident. No customer data, no secrets. */
export function incidentAlertText(kind: FailureKind, code: number | null, pausedUntilIso: string): string {
  const what = kind === "payment"
    ? `WhatsApp rejected messages with error ${code ?? 131042} (business eligibility / payment issue). Check the payment method and balance in WhatsApp Manager > Billing.`
    : `WhatsApp is rate-limiting our sending (error ${code ?? 130429}).`;
  return `⚠️ ${what}\nOffers (broadcasts) are paused until ${hhmm(pausedUntilIso)} (Beirut) and sending backs off. Orders and replies are not paused. I'll tell you only once for this incident.`;
}

/** What an owner sees when they try to send a broadcast during a pause (no Meta internals). */
export function pausedNotice(untilIso: string, ar: boolean): string {
  return ar
    ? `إرسال العروض متوقف مؤقتاً لحد الساعة ${hhmm(untilIso)} 🙏 مسودتك محفوظة، جرب بعد هالوقت.`
    : `Sending offers is paused for now, until about ${hhmm(untilIso)} 🙏 Your draft is saved: try again after that.`;
}
