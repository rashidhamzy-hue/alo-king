import React from 'react';
import {interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {C, SPRING, T, Tone, TONE} from '../brand/tokens';
import {CONTOUR_D} from '../brand/contours';

/** Night: ink with the Chouf contour lines lit faintly in gold. Day: cream paper with the same lines in ink. */
export const Backdrop: React.FC<{tone: Tone}> = ({tone}) => {
  const frame = useCurrentFrame();
  const t = TONE[tone];
  const drift = frame * 0.35;
  return (
    <div style={{position: 'absolute', inset: 0, background: tone === 'night' ? `radial-gradient(120% 70% at 50% 38%, ${C.ink2} 0%, ${C.ink} 45%, ${C.ink0} 100%)` : `radial-gradient(120% 70% at 50% 38%, ${C.paper} 0%, ${C.cream} 55%, ${C.cream2} 100%)`}}>
      <svg
        viewBox="0 0 1590 990"
        preserveAspectRatio="xMidYMid slice"
        style={{position: 'absolute', left: -200 - drift, top: 0, width: 2000, height: 1920, opacity: tone === 'night' ? 0.55 : 0.8}}
      >
        <path d={CONTOUR_D} fill="none" stroke={t.line} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {tone === 'night' ? <Lanterns /> : null}
    </div>
  );
};

// A few village lights in the dark: deterministic positions, a slow twinkle.
const LIGHTS = Array.from({length: 26}, (_, i) => {
  const r = (n: number) => {
    const x = Math.sin(i * 127.1 + n * 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  return {x: 40 + r(1) * 1000, y: 1460 + r(2) * 420, s: 3 + r(3) * 5, p: r(4) * 6.28};
});

const Lanterns: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <>
      {LIGHTS.map((l, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: l.x,
            top: l.y,
            width: l.s,
            height: l.s,
            borderRadius: '50%',
            background: C.gold,
            opacity: 0.35 + 0.35 * Math.sin(frame * 0.07 + l.p),
            boxShadow: `0 0 ${l.s * 4}px ${l.s}px rgba(244,182,60,0.35)`,
          }}
        />
      ))}
    </>
  );
};

/** Kinetic type: each word springs up on its own beat. Words are [text, appearFrame]. */
export const Kinetic: React.FC<{
  words: [string, number][];
  tone: Tone;
  size: number;
  x: number;
  y: number;
  align?: 'left' | 'center';
  exitAt?: number;
  width?: number;
  gap?: number;
  dir?: 'ltr' | 'rtl';
  font?: string;
}> = ({words, tone, size, x, y, align = 'left', exitAt, width = 920, gap = 0, font = T.latin}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const out = exitAt === undefined ? 0 : spring({frame: frame - exitAt, fps, config: SPRING.snappy});
  const fg = tone === 'night' ? C.textNight : C.ink;
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width,
        textAlign: align,
        fontFamily: font,
        fontWeight: 800,
        fontSize: size,
        lineHeight: 0.98,
        letterSpacing: '-0.045em',
        color: fg,
        opacity: 1 - out,
        transform: `translateY(${-out * 60}px)`,
      }}
    >
      {words.map(([w, at], i) => {
        const s = spring({frame: frame - at, fps, config: SPRING.bouncy});
        if (frame < at) return <div key={i} style={{height: size * 0.98 + gap, visibility: 'hidden'}}>{w}</div>;
        const clip = interpolate(s, [0, 1], [100, 0], {extrapolateRight: 'clamp'});
        return (
          <div key={i} style={{overflow: 'hidden', paddingBottom: size * 0.08, marginBottom: gap - size * 0.08}}>
            <div style={{transform: `translateY(${clip}%) rotate(${(1 - s) * 4}deg)`, transformOrigin: '0% 100%'}}>{w}</div>
          </div>
        );
      })}
    </div>
  );
};
