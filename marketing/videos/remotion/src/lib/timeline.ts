import cuesJson from '../data/cues.json';

export type Word = {text: string; startMs: number; endMs: number; line: number; lastInLine: boolean};
export type Line = {scene: string; text: string; startMs: number; endMs: number};
export type Scene = {id: string; line: number; from: number; to: number};
export type Timeline = {
  id: 'v1' | 'v2';
  fps: number;
  durationInFrames: number;
  lines: Line[];
  words: Word[];
  scenes: Scene[];
};
export type Cue = {id: string; line: number; word: string; offsetMs?: number; sfx?: string};

const clean = (s: string) => s.replace(/[^A-Za-z']/g, '').toLowerCase();

export const msToFrame = (ms: number, fps = 30) => Math.round((ms / 1000) * fps);

/** Frame where a word of a line starts (plus an offset). The same rule is used by audio/mix.py for the sound cues. */
export const wordFrame = (tl: Timeline, line: number, word: string, offsetMs = 0) => {
  const w = tl.words.find((x) => x.line === line && clean(x.text) === clean(word));
  if (!w) throw new Error(`no word "${word}" in line ${line} of ${tl.id}`);
  return msToFrame(w.startMs + offsetMs, tl.fps);
};

/** Absolute frame of a named cue from src/data/cues.json. */
export const cueFrame = (tl: Timeline, id: string) => {
  const c = (cuesJson as unknown as Record<string, Cue[]>)[tl.id].find((x) => x.id === id);
  if (!c) throw new Error(`no cue ${id} in ${tl.id}`);
  return wordFrame(tl, c.line, c.word, c.offsetMs ?? 0);
};

export const scene = (tl: Timeline, id: string) => {
  const s = tl.scenes.find((x) => x.id === id);
  if (!s) throw new Error(`no scene ${id} in ${tl.id}`);
  return s;
};
