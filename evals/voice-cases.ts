// Voice-note cases written from transcripts: what the provider heard, how long the note was, and the hand-written truth.
// They need no audio, so they run in CI. The 38 real notes (audio, git-ignored) are scored by `npm run eval` on top of these.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { TruthLine } from "./run";

export interface VoiceCase {
  id: string; about: string;
  transcript: string;                 // what the speech-to-text provider returned
  duration_sec: number;
  usable: boolean;                    // false: the transcript must be refused before any model reads it
  truth: {
    intent: string; fulfilment: "delivery" | "pickup" | "unknown";
    lines: (TruthLine & { unit: string })[];
    address: { village: string | null; landmark: string | null; building: string | null; floor: string | null };
    change_for_usd: number | null;
    promised_followup?: "photo" | "address"; needs_clarification?: string[]; repeat_last?: boolean;
  };
}

const dir = fileURLToPath(new URL("./voice_notes/cases/", import.meta.url));
export function loadVoiceCases(): VoiceCase[] {
  return readdirSync(dir).filter((f) => f.endsWith(".json")).sort()
    .map((f) => JSON.parse(readFileSync(dir + f, "utf8")) as VoiceCase);
}
