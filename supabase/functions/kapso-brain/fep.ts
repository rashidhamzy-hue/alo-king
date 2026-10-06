// Free entry point (FEP) tracking, observation only: this module never sends anything and never changes how we answer.
// Meta: when a customer messages us from a Click-to-WhatsApp ad or a Facebook Page call-to-action button (Android/iOS app only) and we reply within 24 hours,
// every message we send them for the next 72 hours is free, whatever its category. We record each such referral and the window it opens, so the share of free messages can be reported.
// The window starts when we reply; the bot replies within seconds, so it is taken to open when the referral is processed (a few seconds early at worst: slightly pessimistic about how long it lasts).

const clip = (v: unknown, n: number): string | null => (v == null || v === "" ? null : String(v).slice(0, n));
export const FEP_HOURS = 72;

export type ReferralRecord = { message_id: string; source_type: string | null; source_id: string | null; source_url: string | null; headline: string | null; ctwa_clid: string | null; referral_at: string };

/** The `referral` object Meta puts on the first message of an ad click. Never stores the ad body text. */
export function referralRecord(m: any, evt: any, nowMs: number): ReferralRecord | null {
  const r = [m?.referral, evt?.referral].find((x) => x && typeof x === "object");
  if (!r || (!r.source_id && !r.ctwa_clid && !r.source_url)) return null;
  const id = clip(m?.id, 200);
  if (!id) return null;
  const ts = Number(m?.timestamp);
  return { message_id: id, source_type: clip(r.source_type, 20), source_id: clip(r.source_id, 64), source_url: clip(r.source_url, 300), headline: clip(r.headline, 200), ctwa_clid: clip(r.ctwa_clid, 300),
    referral_at: new Date(Number.isFinite(ts) && ts > 0 ? ts * 1000 : nowMs).toISOString() };
}

export function fepWindow(openedMs: number): { opens_at: string; expires_at: string } {
  return { opens_at: new Date(openedMs).toISOString(), expires_at: new Date(openedMs + FEP_HOURS * 3600_000).toISOString() };
}
export const isFepActive = (w: { opens_at: string; expires_at: string }, nowMs: number) => nowMs >= Date.parse(w.opens_at) && nowMs < Date.parse(w.expires_at);
