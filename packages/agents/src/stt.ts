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
