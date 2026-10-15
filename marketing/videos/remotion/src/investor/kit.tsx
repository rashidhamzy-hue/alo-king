import React from 'react';
import {interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import invJson from '../data/inv.json';
import cuesJson from '../data/cues.json';
import {C, T} from '../brand/tokens';

/** Timeline, grid and building blocks for the 16:9 investor explainer. */
export type Tone = 'night' | 'day';
export type IWord = {text: string; startMs: number; endMs: number; line: number; lastInLine: boolean};
export type IScene = {id: string; line: number; chapter: number; from: number; to: number};
export type ITimeline = {fps: number; durationInFrames: number; lines: {scene: string; chapter: number; text: string; startMs: number; endMs: number}[]; words: IWord[]; scenes: IScene[]};

export const tl = invJson as unknown as ITimeline;
export const FW = 1920;
export const FH = 1080;
export const M = 120; // side margin
export const COL = {left: M, leftW: 760, right: 1020, rightW: 780, centerR: 1380};

const clean = (s: string) => s.replace(/[^A-Za-z0-9'٠-٩]/g, '').toLowerCase();
export const sc = (id: string): IScene => {
  const s = tl.scenes.find((x) => x.id === id);
  if (!s) throw new Error(`no scene ${id}`);
  return s;
};
/** Frame where the nth occurrence of `word` starts inside a scene's line (plus offset). */
export const w = (sceneId: string, word: string, nth = 0, offsetMs = 0) => {
  const s = sc(sceneId);
  const hits = tl.words.filter((x) => x.line === s.line && clean(x.text) === clean(word));
  if (!hits[nth]) throw new Error(`no "${word}"#${nth} in ${sceneId}`);
  return Math.round(((hits[nth].startMs + offsetMs) / 1000) * tl.fps);
};
type Cue = {id: string; scene: string; word: string; nth?: number; offsetMs?: number; sfx?: string};
/** Named cue from cues.json ("inv"): the mixer puts its sound effect on the same frame. */
export const cue = (id: string) => {
  const c = (cuesJson as unknown as Record<string, Cue[]>).inv.find((x) => x.id === id);
  if (!c) throw new Error(`no cue ${id}`);
  return w(c.scene, c.word, c.nth ?? 0, c.offsetMs ?? 0);
};

export const SPR = {
  snappy: {damping: 15, stiffness: 180, mass: 0.7},
  soft: {damping: 20, stiffness: 110, mass: 0.9},
  bouncy: {damping: 11, stiffness: 160, mass: 0.6},
};
export const useSp = (at: number, cfg = SPR.snappy) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return spring({frame: frame - at, fps, config: cfg});
};

export const toneOf = (chapter: number): Tone => (chapter === 6 ? 'day' : 'night');
export const fg = (t: Tone) => (t === 'night' ? C.textNight : C.ink);
export const mute = (t: Tone) => (t === 'night' ? C.muteNight : C.muteCream);
export const gold = (t: Tone) => (t === 'night' ? C.gold : C.goldText);
export const card = (t: Tone) => (t === 'night' ? C.ink2 : C.paper);
export const line = (t: Tone) => (t === 'night' ? 'rgba(248,241,231,0.10)' : C.sand);

/** A shot lives over one or more scenes: it springs in at its first frame and out at its last. */
export const Shot: React.FC<{from: string; to?: string; children: React.ReactNode; exit?: 'up' | 'fade' | 'left'; enter?: 'up' | 'fade' | 'right'}> = ({from, to, children, exit = 'fade', enter = 'up'}) => {
  const frame = useCurrentFrame();
  const a = sc(from).from;
  const b = sc(to ?? from).to;
  if (frame < a - 2 || frame > b + 14) return null;
  const i = spring({frame: frame - a, fps: 30, config: SPR.soft});
  const o = spring({frame: frame - b, fps: 30, config: SPR.snappy});
  const tx = enter === 'right' ? (1 - i) * 120 : 0;
  const ty = enter === 'up' ? (1 - i) * 50 : 0;
  const ex = exit === 'left' ? -o * 120 : 0;
  const ey = exit === 'up' ? -o * 50 : 0;
  return <div style={{position: 'absolute', inset: 0, opacity: Math.min(1, i * 1.4) * (1 - o), transform: `translate(${tx + ex}px, ${ty + ey}px)`}}>{children}</div>;
};

/** Big display line; words spring up one by one starting at `at`. */
export const Headline: React.FC<{text: string; at: number; tone: Tone; size?: number; x?: number; y?: number; width?: number; color?: string; align?: 'left' | 'center'; font?: string; dir?: 'rtl' | 'ltr'}> = ({
  text, at, tone, size = 96, x = COL.left, y = 250, width = COL.leftW, color, align = 'left', font = T.latin, dir = 'ltr',
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const parts = text.split(' ');
  return (
    <div style={{position: 'absolute', left: x, top: y, width, fontFamily: font, fontWeight: 800, fontSize: size, lineHeight: 1.02, letterSpacing: font === T.latin ? '-0.04em' : 0, color: color ?? fg(tone), textAlign: align, direction: dir, display: 'flex', flexWrap: 'wrap', columnGap: size * 0.26, justifyContent: align === 'center' ? 'center' : 'flex-start'}}>
      {parts.map((p, i) => {
        const s = spring({frame: frame - at - i * 3, fps, config: SPR.bouncy});
        return (
          <span key={i} style={{display: 'inline-block', overflow: 'hidden', paddingBottom: size * 0.1, marginBottom: -size * 0.1}}>
            <span style={{display: 'inline-block', transform: `translateY(${(1 - s) * 105}%)`}}>{p}</span>
          </span>
        );
      })}
    </div>
  );
};

export const Sub: React.FC<{text: string; at: number; tone: Tone; x?: number; y: number; width?: number; size?: number; align?: 'left' | 'center'}> = ({text, at, tone, x = COL.left, y, width = COL.leftW, size = 34, align = 'left'}) => {
  const s = useSp(at, SPR.soft);
  return <div style={{position: 'absolute', left: x, top: y, width, fontFamily: T.latin, fontWeight: 600, fontSize: size, lineHeight: 1.3, color: mute(tone), opacity: s, transform: `translateY(${(1 - s) * 16}px)`, textAlign: align}}>{text}</div>;
};

/** Rounded card / node with an icon, used by every diagram. */
export const Node: React.FC<{at: number; x: number; y: number; w?: number; h?: number; tone: Tone; icon?: React.ReactNode; title: string; sub?: string; hot?: boolean; children?: React.ReactNode; size?: number}> = ({
  at, x, y, w: width = 340, h, tone, icon, title, sub, hot, children, size = 30,
}) => {
  const s = useSp(at, SPR.bouncy);
  const frame = useCurrentFrame();
  if (frame < at) return null;
  return (
    <div style={{position: 'absolute', left: x, top: y, width, height: h, borderRadius: 28, background: hot ? C.gold : card(tone), border: `1.5px solid ${hot ? C.gold : line(tone)}`, color: hot ? C.ink : fg(tone), padding: '22px 26px', fontFamily: T.latin, transform: `scale(${0.85 + 0.15 * s})`, opacity: Math.min(1, s * 1.5), boxShadow: tone === 'night' ? (hot ? '0 0 50px rgba(244,182,60,0.35)' : '0 20px 50px rgba(0,0,0,0.35)') : '0 20px 50px -25px rgba(23,19,26,0.35)'}}>
      <div style={{display: 'flex', alignItems: 'center', gap: 16}}>
        {icon ? <div style={{width: 58, height: 58, borderRadius: 18, background: hot ? C.ink : tone === 'night' ? 'rgba(244,182,60,0.14)' : C.cream2, display: 'grid', placeItems: 'center', flexShrink: 0, color: hot ? C.gold : gold(tone)}}>{icon}</div> : null}
        <div>
          <div style={{fontWeight: 800, fontSize: size, letterSpacing: '-0.02em', lineHeight: 1.1}}>{title}</div>
          {sub ? <div style={{fontWeight: 600, fontSize: size * 0.72, opacity: 0.75, marginTop: 4, lineHeight: 1.25}}>{sub}</div> : null}
        </div>
      </div>
      {children}
    </div>
  );
};

/** A path that draws itself from `at` over `dur` frames, with an optional dot travelling along it. */
export const Edge: React.FC<{d: string; at: number; dur?: number; tone: Tone; width?: number; dash?: boolean; color?: string}> = ({d, at, dur = 18, tone, width = 4, dash, color}) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [at, at + dur], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  if (frame < at) return null;
  const col = color ?? (tone === 'night' ? C.gold : C.ink);
  return (
    <svg width={FW} height={FH} style={{position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none'}}>
      <path d={d} fill="none" stroke={col} strokeOpacity={0.55} strokeWidth={width} strokeLinecap="round" pathLength={1} strokeDasharray={dash ? '0.012 0.012' : `${p} 1`} style={dash ? {clipPath: `inset(0 ${100 - p * 100}% 0 0)`} : undefined} />
    </svg>
  );
};

/** A dot that travels along a path (frame-driven, via CSS offset-path). */
export const Traveller: React.FC<{d: string; at: number; period?: number; color?: string; size?: number}> = ({d, at, period = 45, color = C.gold, size = 18}) => {
  const frame = useCurrentFrame();
  if (frame < at) return null;
  const t = ((frame - at) % period) / period;
  return (
    <div style={{position: 'absolute', left: 0, top: 0, width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2, borderRadius: size / 2, background: color, boxShadow: `0 0 ${size}px ${color}`, offsetPath: `path("${d}")`, offsetDistance: `${t * 100}%`, offsetRotate: '0deg'} as React.CSSProperties} />
  );
};

/** Pill chip. */
export const Chip: React.FC<{at: number; tone: Tone; children: React.ReactNode; hot?: boolean; size?: number; style?: React.CSSProperties}> = ({at, tone, children, hot, size = 30, style}) => {
  const s = useSp(at, SPR.bouncy);
  const frame = useCurrentFrame();
  if (frame < at) return null;
  return (
    <span style={{display: 'inline-flex', alignItems: 'center', gap: 10, padding: `${size * 0.4}px ${size * 0.75}px`, borderRadius: 999, background: hot ? C.gold : card(tone), color: hot ? C.ink : fg(tone), border: `1.5px solid ${hot ? C.gold : line(tone)}`, fontFamily: T.latin, fontWeight: 700, fontSize: size, transform: `scale(${0.8 + 0.2 * s})`, opacity: Math.min(1, s * 1.5), ...style}}>
      {children}
    </span>
  );
};

/** A number that counts up between two frames. */
export const Count: React.FC<{to: number; at: number; dur?: number; prefix?: string; suffix?: string; decimals?: number}> = ({to, at, dur = 30, prefix = '', suffix = '', decimals = 0}) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [at, at + dur], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: (x) => 1 - Math.pow(1 - x, 3)});
  const v = to * p;
  return <span>{prefix}{v.toLocaleString('en-US', {minimumFractionDigits: decimals, maximumFractionDigits: decimals})}{suffix}</span>;
};

export const CHAPTERS = ['Alo', 'Why not another app', 'One chat, one brain', 'The customer', 'Send Home', 'The brain, memory and agents', 'The merchants engine', 'Drivers and dispatch', 'The database', 'The business model', 'Where we are', 'Alo King'];

/** Top-left chapter tag and a thin progress rail across the top. */
export const ChapterRail: React.FC = () => {
  const frame = useCurrentFrame();
  const cur = tl.scenes.find((s) => frame >= s.from && frame < s.to) ?? tl.scenes[tl.scenes.length - 1];
  const ch = cur.chapter;
  if (ch === 0 || ch === 11) return null;
  const t = toneOf(ch);
  const start = tl.scenes.find((s) => s.chapter === ch)!.from;
  const s = spring({frame: frame - start, fps: 30, config: SPR.snappy});
  return (
    <>
      <div style={{position: 'absolute', left: M, top: 64, display: 'flex', alignItems: 'center', gap: 16, fontFamily: T.latin, opacity: s}}>
        <span style={{fontWeight: 800, fontSize: 26, color: t === 'night' ? C.ink : C.cream, background: t === 'night' ? C.gold : C.ink, borderRadius: 10, padding: '4px 12px'}}>{String(ch).padStart(2, '0')}</span>
        <span style={{fontWeight: 700, fontSize: 26, color: mute(t)}}>{CHAPTERS[ch]}</span>
      </div>
      <div style={{position: 'absolute', right: M, top: 76, display: 'flex', gap: 8}}>
        {CHAPTERS.slice(1, 11).map((_, i) => (
          <div key={i} style={{width: i + 1 === ch ? 46 : 14, height: 8, borderRadius: 4, background: i + 1 <= ch ? gold(t) : line(t)}} />
        ))}
      </div>
    </>
  );
};

/** Word-highlighted captions for 16:9: one band at the bottom, phrases of up to six words. */
export const Captions16: React.FC = () => {
  const frame = useCurrentFrame();
  const ms = (frame / 30) * 1000;
  const pages = React.useMemo(() => paginate16(tl.words), []);
  const page = pages.find((p) => ms >= p.start - 60 && ms < p.end);
  if (!page) return null;
  const cur = tl.scenes.find((s) => frame >= s.from && frame < s.to) ?? tl.scenes[0];
  const t = toneOf(cur.chapter);
  const pin = spring({frame: frame - Math.round(((page.start - 60) / 1000) * 30), fps: 30, config: SPR.snappy});
  const idx = page.words.reduce((a, x, j) => (ms >= x.startMs - 40 ? j : a), -1);
  return (
    <div style={{position: 'absolute', left: 240, width: 1440, top: 975, transform: `translateY(-50%) translateY(${(1 - pin) * 14}px)`, opacity: Math.min(1, pin * 1.5), display: 'flex', justifyContent: 'center', flexWrap: 'wrap', columnGap: 12, fontFamily: T.latin, fontWeight: 800, fontSize: 46, letterSpacing: '-0.015em'}}>
      {page.words.map((x, i) => {
        const active = i === idx && ms < x.endMs + 250;
        const said = ms >= x.startMs - 40;
        return (
          <span key={i} style={{position: 'relative', padding: '1px 8px', color: active ? C.ink : said ? fg(t) : t === 'night' ? 'rgba(248,241,231,0.5)' : 'rgba(23,19,26,0.45)'}}>
            {active ? <span style={{position: 'absolute', inset: '3px 0 1px', borderRadius: 10, background: C.gold, zIndex: -1}} /> : null}
            <span style={{position: 'relative'}}>{x.text}</span>
          </span>
        );
      })}
    </div>
  );
};

type Page = {words: IWord[]; start: number; end: number};
const paginate16 = (words: IWord[], max = 7): Page[] => {
  const phrases: IWord[][] = [];
  let cur: IWord[] = [];
  words.forEach((x) => {
    cur.push(x);
    if (x.lastInLine || /[,:?.!]$/.test(x.text)) {
      phrases.push(cur);
      cur = [];
    }
  });
  if (cur.length) phrases.push(cur);
  const pages: Page[] = [];
  phrases.forEach((ph) => {
    const n = Math.ceil(ph.length / max);
    const size = Math.ceil(ph.length / n);
    for (let i = 0; i < ph.length; i += size) {
      const ws = ph.slice(i, i + size);
      pages.push({words: ws, start: ws[0].startMs, end: ws[ws.length - 1].endMs});
    }
  });
  for (let i = 0; i < pages.length - 1; i++) {
    const a = pages[i];
    const b = pages[i + 1];
    if (a.words.length <= 2 && a.words[0].line === b.words[0].line && a.words.length + b.words.length <= max) {
      pages.splice(i, 2, {words: [...a.words, ...b.words], start: a.start, end: b.end});
    }
  }
  pages.forEach((p, i) => {
    const n = pages[i + 1];
    p.end = n ? Math.min(n.start, p.end + 600) : p.end + 900;
  });
  return pages;
};
