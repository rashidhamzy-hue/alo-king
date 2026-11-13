// Build plan 1.17: the voice-note policy by sender role, with the limits from settings.voice_limits and the hourly budget
// across turns (migration 0057). The decision itself is voiceVerdict() in @ak/core/voice-policy; this file supplies the
// real numbers: how long the note is, what the role may send, and what this sender already sent in the last hour.
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_VOICE_LIMITS, estimateSeconds, VOICE_TEXT, voiceVerdict, type SenderRole, type VoiceLimits, type VoiceVerdict } from "@ak/core/voice-policy";

/** The fields of an inbound audio message this reads. Kapso passes Meta's message through, plus its own `kapso` block. */
export interface AudioMessage {
  id: string;
  audio?: { duration?: number; seconds?: number } & Record<string, unknown>;
  kapso: { media_data?: { byte_size?: number; duration?: number } & Record<string, unknown>; duration?: number } & Record<string, unknown>;
}

/** The provider's real duration when the payload carries one (any of the places providers put it), else an estimate from the size. */
export function audioSeconds(m: AudioMessage, providerSeconds?: number): number {
  const real = [providerSeconds, m.audio?.duration, m.audio?.seconds, m.kapso.media_data?.duration, m.kapso.duration]
    .find((x): x is number => typeof x === "number" && Number.isFinite(x) && x > 0);
  return Math.max(1, estimateSeconds(m.kapso.media_data?.byte_size ?? 16000, real));
}

/** settings.voice_limits, with the defaults for anything missing or malformed. */
export function limitsFrom(v: unknown): VoiceLimits {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const pick = (k: keyof VoiceLimits) => (typeof o[k] === "number" && (o[k] as number) > 0 ? (o[k] as number) : DEFAULT_VOICE_LIMITS[k]);
  return { customer: pick("customer"), merchant: pick("merchant"), driver: pick("driver"), staff: pick("staff"),
           per_sender_seconds_per_hour: pick("per_sender_seconds_per_hour") };
}

export interface VoiceGate { db: SupabaseClient; partyId: string; line: "customer" | "ops"; role: SenderRole }

/**
 * Decides one note. `earlierThisTurn` is the seconds already accepted in the same burst; `turnIds` are the message ids of the
 * burst, left out of the hour's total so a retried turn decides the same way. A note that is processed is recorded once.
 * If the budget cannot be read, the defaults apply and the note is judged on its own length: a customer is never refused
 * because the database blinked.
 */
export async function decideVoice(g: VoiceGate, m: AudioMessage, earlierThisTurn: number, turnIds: string[], providerSeconds?: number):
    Promise<{ verdict: VoiceVerdict; seconds: number; reply: string | null }> {
  const seconds = audioSeconds(m, providerSeconds);
  const b = await g.db.rpc("voice_budget", { p_party: g.partyId, p_exclude: turnIds });
  const limits = limitsFrom((b.data as { limits?: unknown } | null)?.limits);
  const used = Number((b.data as { used?: number } | null)?.used ?? 0);
  const verdict = voiceVerdict(g.role, seconds, used + earlierThisTurn, limits);
  if (verdict.action === "process") {
    await g.db.rpc("record_voice_usage", { p_party: g.partyId, p_line: g.line, p_role: g.role, p_wamid: m.id, p_seconds: seconds });
  }
  const reply = verdict.action === "too_long" ? VOICE_TEXT.tooLong(verdict.limit)
              : verdict.action === "over_budget" ? VOICE_TEXT.overBudget
              : verdict.action === "empty" ? OPS_VOICE_TEXT.empty : null;
  return { verdict, seconds, reply };
}

/**
 * The ops line (riders and staff). No model reads a rider's message, so a note within the limits is passed to ops to listen to,
 * and the rider is told so, with the reminder that amounts are buttons or typed figures. Over a limit: the polite reply.
 * For apps/gateway/src/ops-turn.ts (lane C) to call; nothing on the ops line may be dropped in silence (invariant 18).
 */
export async function voiceOnOpsLine(g: VoiceGate, m: AudioMessage, earlierThisTurn: number, turnIds: string[]):
    Promise<{ reply: string; forwardToOps: boolean; seconds: number }> {
  const d = await decideVoice(g, m, earlierThisTurn, turnIds);
  if (d.reply) return { reply: d.reply, forwardToOps: false, seconds: d.seconds };
  return { reply: OPS_VOICE_TEXT.received, forwardToOps: true, seconds: d.seconds };
}

export const OPS_VOICE_TEXT = {
  received: `وصل التسجيل، رح يسمعو حدا من الفريق. ${VOICE_TEXT.riderUseButtons}`,
  empty: "ما وصلني شي بالتسجيل. فيك تعيدو أو تكتب.",
  opsAlert: (who: string, seconds: number) => `🎙️ تسجيل صوتي من ${who} (${seconds} ثانية) على خط العمليات: بدو حدا يسمعو.`,
};
