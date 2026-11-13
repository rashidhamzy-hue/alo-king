// Speech-to-text for Lebanese voice notes: two transcripts, one judgement, and a hard check for failure modes.
export interface Transcript { text: string; provider: string }
export interface SttProvider { name: string; transcribe(audio: ArrayBuffer, opts: { keyterms: string[] }): Promise<string> }

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

/** Bias terms for providers that accept them: live brand, product and village names from the database. */
export function buildKeyterms(brands: string[], villages: string[], merchantNames: string[]): string[] {
  return [...new Set([...brands, ...villages, ...merchantNames])].slice(0, 100);
}

// ---------- Build plan 1.7: Kapso's transcript first, a second provider behind a setting, the audio kept privately ----------
// settings.stt: { keep_audio, second_provider }. keep_audio copies the note into the private `media` bucket at once (the
// hand-corrected evaluation, 5.8, needs the audio). second_provider names the provider whose transcript is also taken; the
// worker passes the provider object only when its key is configured, so the setting alone never sends audio anywhere.
// Kapso's own transcription runs through ElevenLabs, which may keep transcripts: whether to say so in the privacy notice or
// to rely on our own provider is the founder's decision (docs/HANDOFF.md). The audio and the transcripts are personal data:
// stored, never logged.
import type { SupabaseClient } from "@supabase/supabase-js";
import { kapsoMediaUrl, MEDIA_BUCKET } from "./payment-proof";

export interface VoiceNote { id: string; kapso: { transcript?: { text: string }; media_url?: string; media_data?: { url: string; content_type?: string; byte_size?: number } } }
export interface SttSettings { keep_audio?: boolean; second_provider?: string | null }
export interface VoiceDeps { db: SupabaseClient; fetchMedia?: (url: string) => Promise<Response>; stt?: SttProvider }
const MAX_AUDIO = 16 * 1024 * 1024;   // WhatsApp's own ceiling for audio
const hexOf = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

/**
 * Reads one voice note: stores it if asked, takes the second transcript if the setting names the provider we have, and judges
 * both. Storage or the second provider failing never loses the note: Kapso's transcript is still judged, and what failed is
 * recorded with the message. Returns what the turn needs; writes the transcripts and the storage key onto wa_messages.
 */
export async function readVoiceNote(deps: VoiceDeps, partyId: string, m: VoiceNote, seconds: number, keyterms: string[] = []):
    Promise<{ verdict: SttVerdict; mediaPath: string | null; second: Transcript | null }> {
  const s = ((await deps.db.rpc("setting", { p_key: "stt" })).data ?? {}) as SttSettings;
  const wantSecond = !!s.second_provider && deps.stt?.name === s.second_provider;
  const kapso: Transcript = { text: m.kapso.transcript?.text ?? "", provider: "kapso" };
  const notes: Record<string, string> = {};
  let mediaPath: string | null = null, audio: ArrayBuffer | null = null, second: Transcript | null = null;

  if (s.keep_audio || wantSecond) {
    const url = kapsoMediaUrl(m);
    if (!url) notes.audio = "no_kapso_media_url";
    else {
      try {
        const res = await (deps.fetchMedia ?? ((u: string) => fetch(u)))(url);
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
  if (wantSecond && audio) {
    try { second = { text: await deps.stt!.transcribe(audio, { keyterms }), provider: deps.stt!.name }; }
    catch (e) { notes.second = String((e as Error).message ?? e).slice(0, 60); }
  }
  const verdict = judge(kapso, second ?? undefined, seconds);
  await deps.db.from("wa_messages").update({
    media_path: mediaPath,
    transcript: { kapso: kapso.text || null, ...(second ? { second: { provider: second.provider, text: second.text } } : {}),
                  chosen: verdict.usable ? verdict.primary.provider : null, ...(Object.keys(notes).length ? { notes } : {}) },
  }).eq("wa_message_id", m.id);
  return { verdict, mediaPath, second };
}
