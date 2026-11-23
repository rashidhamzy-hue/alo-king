// Speech-to-text for Lebanese voice notes: two transcripts, one judgement, and a hard check for failure modes.
export interface Transcript { text: string; provider: string }
export interface SttProvider { name: string; model?: string; transcribe(audio: ArrayBuffer, opts: { keyterms: string[]; model?: string }): Promise<string> }

/**
 * Generic speech models break on dialect in a specific way: they loop. In our own run, an off-the-shelf
 * Whisper model collapsed into a repeated token on 6 of the 38 sample notes. Catch it before a model reads it.
 */
export function looksLooped(text: string): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < 8) return false;
  let run = 1, longest = 1;
  for (let i = 1; i < words.length; i++) {
    run = words[i] === words[i - 1] ? run + 1 : 1;
    if (run > longest) longest = run;
  }
  if (longest >= 5) return true;
  const unique = new Set(words).size;
  if (words.length >= 20 && unique / words.length < 0.3) return true;
  return /(.)\1{14,}/.test(text);                       // one character repeated: "ووووووو..."
}

/** Words per second outside human range means the model invented or dropped speech. */
export function plausibleRate(text: string, durationSec: number): boolean {
  if (durationSec <= 0) return false;
  const wps = text.trim().split(/\s+/).filter(Boolean).length / durationSec;
  return wps >= 0.4 && wps <= 5;
}

export type SttVerdict =
  | { usable: true; primary: Transcript; secondary?: Transcript }
  | { usable: false; reason: "looped" | "implausible_rate" | "empty" };

export function judge(primary: Transcript, secondary: Transcript | undefined, durationSec: number): SttVerdict {
  const good = (t?: Transcript) => !!t && t.text.trim().length > 0 && !looksLooped(t.text) && plausibleRate(t.text, durationSec);
  if (good(primary)) return { usable: true, primary, secondary: good(secondary) ? secondary : undefined };
  if (good(secondary)) return { usable: true, primary: secondary! };
  if (!primary.text.trim()) return { usable: false, reason: "empty" };
  return { usable: false, reason: looksLooped(primary.text) ? "looped" : "implausible_rate" };
}

// ---------- Build plan 1.7, and VOICE1: our own transcript first (ElevenLabs Scribe), Kapso's as the fallback ----------
// settings.stt: { keep_audio, primary_provider, second_provider, scribe, keyterms_max, daily_cap_usd, keyterms_extra }.
// VOICE1 (0276): when the worker passes a provider whose name is settings.stt.primary_provider ("elevenlabs_scribe", built only when the
// Worker secret ELEVENLABS_API_KEY exists), the note's audio is fetched through Kapso and transcribed by it with keyterms (the places and the
// names customers use for them, everyday item words, the served villages, the brands most ordered: stt_context, 0276); judge() takes ours
// when it is usable and Kapso's otherwise. Over settings.stt.daily_cap_usd, or with no key, Kapso's transcript alone, as before. Each note's
// provider, seconds and cost are written with its transcripts, and its cost to model_costs (workflow "stt"). Before VOICE1 the provider
// could only be a second transcript behind second_provider (null on staging); that path is kept. keep_audio copies the note into the
// private `media` bucket at once. The audio and the transcripts are personal data: stored, never logged.
import type { SupabaseClient } from "@supabase/supabase-js";
import { kapsoMediaUrl, MEDIA_BUCKET } from "./payment-proof";
import { fetchKapsoMedia } from "@ak/wa/media";
import { cleanKeyterms, scribeCostUsd } from "./scribe";

export interface VoiceNote { id: string; kapso: { transcript?: { text: string }; media_url?: string; media_data?: { url: string; content_type?: string; byte_size?: number } } }
export interface SttSettings {
  keep_audio?: boolean; second_provider?: string | null; primary_provider?: string | null;
  scribe?: { model?: string; usd_per_hour?: number; keyterms_usd_per_hour?: number };
  keyterms_max?: number; daily_cap_usd?: number;
}
export interface VoiceDeps { db: SupabaseClient; fetchMedia?: (url: string) => Promise<Response>; stt?: SttProvider & { model?: string } }
const MAX_AUDIO = 16 * 1024 * 1024;   // WhatsApp's own ceiling for audio
const hexOf = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

interface SttContext { settings: SttSettings; keyterms: string[]; spent_today_usd: number }
async function sttContext(db: SupabaseClient, partyId: string): Promise<SttContext> {
  const r = await db.rpc("stt_context", { p_party: partyId });
  if (!r.error && r.data) return r.data as SttContext;
  // a database without 0276: the setting alone, as before
  return { settings: ((await db.rpc("setting", { p_key: "stt" })).data ?? {}) as SttSettings, keyterms: [], spent_today_usd: 0 };
}

/**
 * Reads one voice note: stores it if asked, takes our own transcript when the provider is configured (primary), or a second transcript
 * behind the older setting, and judges them with Kapso's. Storage or our provider failing never loses the note: Kapso's transcript is still
 * judged, and what failed is recorded with the message. Returns what the turn needs; writes the transcripts, the provider, the cost and the
 * storage key onto wa_messages. `keyterms` are added to the database's own list (stt_context).
 */
export async function readVoiceNote(deps: VoiceDeps, partyId: string, m: VoiceNote, seconds: number, keyterms: string[] = []):
    Promise<{ verdict: SttVerdict; mediaPath: string | null; second: Transcript | null; ours: Transcript | null; costUsd: number }> {
  const c = await sttContext(deps.db, partyId);
  const s = c.settings ?? {};
  const notes: Record<string, string> = {};
  const capped = s.daily_cap_usd != null && Number(c.spent_today_usd ?? 0) >= Number(s.daily_cap_usd);
  const primary = !!deps.stt && !!s.primary_provider && deps.stt.name === s.primary_provider;
  if (primary && capped) notes.ours = "daily_cap";
  const useOurs = primary && !capped;
  const wantSecond = !useOurs && !primary && !!s.second_provider && deps.stt?.name === s.second_provider;
  const kapso: Transcript = { text: m.kapso.transcript?.text ?? "", provider: "kapso" };
  let mediaPath: string | null = null, audio: ArrayBuffer | null = null, second: Transcript | null = null, ours: Transcript | null = null;
  let costUsd = 0;

  if (s.keep_audio || wantSecond || useOurs) {
    const url = kapsoMediaUrl(m);
    if (!url) notes.audio = "no_kapso_media_url";
    else {
      try {
        const res = await (deps.fetchMedia ?? ((u: string) => fetchKapsoMedia(u)))(url);
        if (!res.ok) throw new Error(`MEDIA_FETCH_${res.status}`);
        const buf = await res.arrayBuffer();
        if (buf.byteLength === 0 || buf.byteLength > MAX_AUDIO) throw new Error("MEDIA_SIZE");
        audio = buf;
        if (s.keep_audio) {
          const path = `voice_notes/${partyId}/${hexOf(await crypto.subtle.digest("SHA-256", buf))}.ogg`;
          const up = await deps.db.storage.from(MEDIA_BUCKET).upload(path, new Uint8Array(buf), { contentType: "audio/ogg", upsert: true });
          if (up.error) throw new Error("MEDIA_STORE_FAILED");
          mediaPath = path;
        }
      } catch (e) { notes.audio = String((e as Error).message ?? e).slice(0, 60); }
    }
  }
  const terms = cleanKeyterms([...(c.keyterms ?? []), ...keyterms], s.keyterms_max ?? 100);
  if ((useOurs || wantSecond) && audio) {
    try {
      const text = await deps.stt!.transcribe(audio, { keyterms: terms, ...(useOurs && s.scribe?.model ? { model: s.scribe.model } : {}) });
      if (useOurs) ours = { text, provider: deps.stt!.name }; else second = { text, provider: deps.stt!.name };
      if (useOurs) {
        costUsd = scribeCostUsd(seconds, s.scribe ?? {}, terms.length);
        await deps.db.rpc("record_stt_cost", { p_wamid: m.id, p_model: s.scribe?.model ?? deps.stt!.model ?? deps.stt!.name, p_seconds: seconds, p_usd: costUsd })
          .then(() => undefined, () => undefined);
      }
    } catch (e) { notes[useOurs ? "ours" : "second"] = String((e as Error).message ?? e).slice(0, 60); }
  }
  // Ours first when it was asked for: judge() keeps it if it is usable, else Kapso's. Otherwise Kapso's first, as before.
  const verdict = useOurs && ours ? judge(ours, kapso, seconds) : judge(kapso, second ?? undefined, seconds);
  await deps.db.from("wa_messages").update({
    media_path: mediaPath,
    transcript: { kapso: kapso.text || null,
                  ...(ours ? { ours: { provider: ours.provider, text: ours.text, seconds, keyterms: terms.length, usd: costUsd } } : {}),
                  ...(second ? { second: { provider: second.provider, text: second.text } } : {}),
                  chosen: verdict.usable ? verdict.primary.provider : null, ...(Object.keys(notes).length ? { notes } : {}) },
  }).eq("wa_message_id", m.id);
  return { verdict, mediaPath, second, ours, costUsd };
}
