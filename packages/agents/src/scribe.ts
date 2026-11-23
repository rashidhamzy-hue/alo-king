// VOICE1: ElevenLabs Scribe, our own speech-to-text for Lebanese voice notes (Arabic, the dialect, and English or French mixed in).
// The worker builds this provider only when the Worker secret ELEVENLABS_API_KEY exists; settings.stt decides whether it is used
// (primary_provider). The audio and the transcript are personal data: sent to ElevenLabs over HTTPS, never logged here.
//   POST https://api.elevenlabs.io/v1/speech-to-text, multipart: file, model_id, keyterms (one part per term), tag_audio_events false.
//   Keyterms: at most 50 characters and 5 words each; none of < > { } [ ] \ ; more than 100 makes every note bill at least 20 s, so
//   the list is cut to settings.stt.keyterms_max (100).
import type { SttProvider } from "./stt";

export const SCRIBE_NAME = "elevenlabs_scribe";
export const SCRIBE_URL = "https://api.elevenlabs.io/v1/speech-to-text";
export const KEYTERM_LIMITS = { max: 100, chars: 50, words: 5 } as const;

/** Keyterms as Scribe accepts them: trimmed, the forbidden characters out, at most 50 characters and 5 words, no repeats, at most `max`. */
export function cleanKeyterms(terms: string[], max: number = KEYTERM_LIMITS.max): string[] {
  const out: string[] = [], seen = new Set<string>();
  for (const t of terms) {
    const s = String(t ?? "").replace(/[<>{}[\]\\]/g, " ").replace(/\s+/g, " ").trim();
    if (!s || s.length > KEYTERM_LIMITS.chars || s.split(" ").length > KEYTERM_LIMITS.words) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k); out.push(s);
    if (out.length >= Math.min(max, KEYTERM_LIMITS.max)) break;
  }
  return out;
}

export interface ScribeOptions { apiKey: string; model?: string; fetch?: typeof fetch; url?: string }

/** The provider. Throws on any error (the caller records what failed and falls back to Kapso's transcript). */
export function scribeProvider(o: ScribeOptions): SttProvider & { model: string } {
  const model = o.model ?? "scribe_v2";
  return {
    name: SCRIBE_NAME, model,
    async transcribe(audio: ArrayBuffer, opts: { keyterms: string[]; model?: string }): Promise<string> {
      const form = new FormData();
      form.append("file", new Blob([audio], { type: "audio/ogg" }), "note.ogg");
      form.append("model_id", opts.model ?? model);
      form.append("tag_audio_events", "false");
      for (const k of cleanKeyterms(opts.keyterms)) form.append("keyterms", k);
      const res = await (o.fetch ?? fetch)(o.url ?? SCRIBE_URL, { method: "POST", headers: { "xi-api-key": o.apiKey }, body: form });
      if (!res.ok) throw new Error(`SCRIBE_${res.status}`);              // never the body: it may echo the request
      const j = (await res.json()) as { text?: unknown };
      if (typeof j.text !== "string") throw new Error("SCRIBE_NO_TEXT");
      return j.text;
    },
  };
}

/** What one note costs at Scribe's price: the base rate plus the keyterm rate when keyterms were sent (USD per hour, settings.stt.scribe). */
export function scribeCostUsd(seconds: number, rate: { usd_per_hour?: number; keyterms_usd_per_hour?: number }, keyterms: number): number {
  const billed = Math.max(0, seconds) / 3600;
  const perHour = Number(rate.usd_per_hour ?? 0.2) + (keyterms > 0 ? Number(rate.keyterms_usd_per_hour ?? 0.05) : 0);
  return Math.round(billed * perHour * 1e6) / 1e6;
}
