// Voice notes are welcome because they are convenient, not because everything must be spoken.
// This decides, before any transcription money is spent, whether a note is processed, and what to say if it is not.
// Limits are product policy (settings.voice_limits), not WhatsApp limits: WhatsApp itself accepts audio up to 16 MB.
export type SenderRole = "customer" | "merchant" | "driver" | "staff";
export interface VoiceLimits { customer: number; merchant: number; driver: number; staff: number; per_sender_seconds_per_hour: number }
export const DEFAULT_VOICE_LIMITS: VoiceLimits = { customer: 180, merchant: 300, driver: 120, staff: 120, per_sender_seconds_per_hour: 900 };

export type VoiceVerdict =
  | { action: "process"; seconds: number }
  | { action: "too_long"; seconds: number; limit: number }
  | { action: "over_budget"; seconds: number }
  | { action: "empty" };

/** Opus voice notes from WhatsApp run near 2.1 kB a second. Use the real duration when the provider gives one. */
export const estimateSeconds = (byteSize: number | undefined, durationSeconds?: number): number =>
  durationSeconds && durationSeconds > 0 ? Math.round(durationSeconds) : Math.max(0, Math.round((byteSize ?? 0) / 2100));

export function voiceVerdict(role: SenderRole, seconds: number, usedThisHour = 0, limits: VoiceLimits = DEFAULT_VOICE_LIMITS): VoiceVerdict {
  if (seconds <= 0) return { action: "empty" };
  if (seconds > limits[role]) return { action: "too_long", seconds, limit: limits[role] };
  if (usedThisHour + seconds > limits.per_sender_seconds_per_hour) return { action: "over_budget", seconds };
  return { action: "process", seconds };
}

/** A typed or spoken word is never enough to move money: riders and staff confirm amounts, payouts and drops with buttons or typed figures. */
export const VOICE_MAY_AUTHORISE_MONEY = false;

export const VOICE_TEXT = {
  tooLong: (limitSeconds: number) =>
    `التسجيل طويل شوي. فيك تبعتو على أكتر من تسجيل قصير (لحد ${Math.round(limitSeconds / 60)} دقايق)، أو تكتب الطلب، أو قلّي «موظف» وبيتواصل معك حدا.`,
  overBudget: "وصلني كتير تسجيلات ورا بعض. اكتبلي الطلب أو قلّي «موظف» وبيتواصل معك حدا من الفريق.",
  riderUseButtons: "للمصاري استعمل الأزرار أو اكتب المبلغ. التسجيل الصوتي ما بيتسجّل كمبلغ.",
};
