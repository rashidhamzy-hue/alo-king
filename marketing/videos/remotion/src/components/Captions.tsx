import React from 'react';
import {spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {C, SPRING, T, Tone, ZONE} from '../brand/tokens';
import type {Timeline, Word} from '../lib/timeline';

/**
 * Word-highlighted captions, timed from the forced-alignment word timestamps. Pages of up to four words, broken at the end
 * of each spoken line and after a comma, colon or question mark. 64 px, inside the safe band (centre y 1338, never below
 * 1440 or over the phone).
 */
type Page = {words: Word[]; start: number; end: number};

export const paginate = (words: Word[], max = 4): Page[] => {
  // Split each spoken line at punctuation, then cut each phrase into balanced pages of at most `max` words,
  // so no page strands a single word ("the" / "menu.").
  const phrases: Word[][] = [];
  let cur: Word[] = [];
  words.forEach((w) => {
    cur.push(w);
    if (w.lastInLine || /[,:?.]$/.test(w.text)) {
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
  // Merge a one-word phrase into the next page when both fit (keeps "In Arabic," with its list).
  for (let i = 0; i < pages.length - 1; i++) {
    const a = pages[i];
    const b = pages[i + 1];
    if (a.words.length === 1 && a.words[0].line === b.words[0].line && a.words.length + b.words.length <= max && !/[?]$/.test(a.words[0].text)) {
      pages.splice(i, 2, {words: [...a.words, ...b.words], start: a.start, end: b.end});
    }
  }
  // Each page stays up until the next one starts, so the band is never empty mid-sentence.
  pages.forEach((p, i) => {
    const next = pages[i + 1];
    p.end = next ? Math.min(next.start, p.end + 700) : p.end + 900;
  });
  return pages;
};

export const Captions: React.FC<{tl: Timeline; tone: Tone}> = ({tl, tone}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const ms = (frame / fps) * 1000;
  const pages = paginate(tl.words);
  const page = pages.find((p) => ms >= p.start - 60 && ms < p.end);
  if (!page) return null;
  const pin = spring({frame: frame - Math.round(((page.start - 60) / 1000) * fps), fps, config: SPRING.snappy});
  const night = tone === 'night';
  return (
    <div
      style={{
        position: 'absolute',
        left: (1080 - ZONE.captionMaxW) / 2,
        width: ZONE.captionMaxW,
        top: ZONE.captionY,
        transform: `translateY(-50%) translateY(${(1 - pin) * 24}px)`,
        opacity: Math.min(1, pin * 1.5),
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        columnGap: 18,
        rowGap: 4,
        fontFamily: T.latin,
        fontWeight: 800,
        fontSize: T.caption,
        lineHeight: 1.12,
        letterSpacing: '-0.02em',
        textAlign: 'center',
      }}
    >
      {page.words.map((w, i) => {
        // Exactly one lit word: the latest one that has started, until shortly after it ends.
        const cur = page.words.reduce((acc, x, j) => (ms >= x.startMs - 40 ? j : acc), -1);
        const active = i === cur && ms < w.endMs + 250;
        const said = ms >= w.startMs - 40;
        const pop = spring({frame: frame - Math.round(((w.startMs - 40) / 1000) * fps), fps, config: SPRING.bouncy});
        const color = night ? (active ? C.ink : said ? C.textNight : 'rgba(248,241,231,0.55)') : active ? C.ink : said ? C.ink : 'rgba(23,19,26,0.45)';
        return (
          <span
            key={i}
            style={{
              position: 'relative',
              padding: '2px 10px',
              color,
              textShadow: night && !active ? '0 2px 18px rgba(0,0,0,0.6)' : undefined,
            }}
          >
            {active ? (
              <span
                style={{
                  position: 'absolute',
                  inset: '4px 0 2px',
                  borderRadius: 14,
                  background: C.gold,
                  transform: `scale(${0.85 + 0.15 * pop})`,
                  zIndex: -1,
                }}
              />
            ) : null}
            <span style={{position: 'relative'}}>{w.text}</span>
          </span>
        );
      })}
    </div>
  );
};
