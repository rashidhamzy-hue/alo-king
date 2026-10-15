import React from 'react';
import {interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {BadgeCheck, Bike, Check, CheckCheck, ChevronRight, Mic, PackageCheck, Play, Plus} from 'lucide-react';
import {C, SPRING, T, Tone} from '../brand/tokens';
import {Crown} from '../brand/Crown';

/**
 * WhatsApp-style chat, drawn in the Alo King design system (src/design/design.css .ak-bubble): the customer's messages are
 * gold with ink text, Alo King's are ink-3 at night and paper by day. Sizes are CSS px on a 390×834 screen.
 */
export type ChatTone = Tone;

const pal = (tone: ChatTone) =>
  tone === 'night'
    ? {bg: C.ink0, head: C.ink2, bot: C.ink3, botFg: C.textNight, mute: C.muteNight, line: 'rgba(248,241,231,0.08)'}
    : {bg: C.cream, head: C.paper, bot: '#FFFFFF', botFg: C.ink, mute: C.muteCream, line: C.sand};

/** Spring-in from a frame (absolute, in the composition's timeline). */
export const useIn = (at: number, cfg = SPRING.snappy) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return spring({frame: frame - at, fps, config: cfg});
};

export const Screen: React.FC<{tone: ChatTone; title?: string; subtitle?: string; children: React.ReactNode; merchant?: boolean; draft?: React.ReactNode; overlay?: React.ReactNode}> = ({
  tone,
  title = 'Alo King',
  subtitle = 'online',
  children,
  merchant,
  draft,
  overlay,
}) => {
  const p = pal(tone);
  return (
    <div style={{position: 'absolute', inset: 0, background: p.bg, fontFamily: T.latin, color: p.botFg, display: 'flex', flexDirection: 'column'}}>
      {/* Status bar with the camera pill. */}
      <div style={{height: 44, position: 'relative', flexShrink: 0, background: p.head}}>
        <div style={{position: 'absolute', left: '50%', top: 10, width: 104, height: 28, marginLeft: -52, borderRadius: 20, background: '#000'}} />
        <div style={{position: 'absolute', left: 30, top: 13, fontSize: 14, fontWeight: 700}}>9:41</div>
      </div>
      <div style={{display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px 12px', background: p.head, borderBottom: `1px solid ${p.line}`, flexShrink: 0}}>
        <div style={{width: 40, height: 40, borderRadius: 20, background: merchant ? C.ink : C.gold, display: 'grid', placeItems: 'center'}}>
          <Crown size={24} color={merchant ? C.gold : C.ink} />
        </div>
        <div style={{lineHeight: 1.2}}>
          <div style={{fontWeight: 800, fontSize: 17}}>{title}</div>
          <div style={{fontSize: 13, color: p.mute, display: 'flex', alignItems: 'center', gap: 6}}>
            <span style={{width: 7, height: 7, borderRadius: 4, background: C.wa}} />
            {subtitle}
          </div>
        </div>
      </div>
      <div style={{flex: 1, padding: '14px 12px', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 10, overflow: 'hidden'}}>
        {children}
      </div>
      {/* Composer. */}
      <div style={{display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px 26px', background: p.head, flexShrink: 0}}>
        <div style={{flex: 1, height: 42, borderRadius: 21, background: tone === 'night' ? C.ink3 : '#FFFFFF', border: `1px solid ${p.line}`, display: 'flex', alignItems: 'center', padding: '0 16px', color: p.mute, fontSize: 15}}>
          <Plus size={18} style={{marginRight: 10, flexShrink: 0}} />
          {draft ? <span style={{color: tone === 'night' ? C.textNight : C.ink, fontWeight: 600}}>{draft}</span> : 'Message'}
        </div>
        <div style={{width: 42, height: 42, borderRadius: 21, background: C.wa, display: 'grid', placeItems: 'center'}}>
          <Mic size={20} color="#fff" />
        </div>
      </div>
      {overlay}
    </div>
  );
};

/** A message that springs up into the thread at frame `at`. */
export const Msg: React.FC<{at: number; me?: boolean; children: React.ReactNode; tone: ChatTone; width?: number | string; pad?: string}> = ({
  at,
  me,
  children,
  tone,
  width,
  pad = '9px 13px',
}) => {
  const p = pal(tone);
  const s = useIn(at);
  const frame = useCurrentFrame();
  if (frame < at) return null;
  return (
    <div
      style={{
        alignSelf: me ? 'flex-end' : 'flex-start',
        maxWidth: '86%',
        width,
        padding: pad,
        borderRadius: 18,
        borderBottomRightRadius: me ? 5 : 18,
        borderBottomLeftRadius: me ? 18 : 5,
        background: me ? C.gold : p.bot,
        color: me ? C.ink : p.botFg,
        fontSize: 16,
        lineHeight: 1.4,
        fontWeight: 600,
        boxShadow: tone === 'day' && !me ? '0 1px 0 rgba(23,19,26,0.06)' : undefined,
        transform: `translateY(${(1 - s) * 26}px) scale(${0.9 + 0.1 * s})`,
        transformOrigin: me ? '100% 100%' : '0% 100%',
        opacity: Math.min(1, s * 1.6),
      }}
    >
      {children}
    </div>
  );
};

export const Meta: React.FC<{me?: boolean; tone: ChatTone; time?: string}> = ({me, tone, time = '12:04'}) => (
  <span style={{display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, opacity: 0.7, marginTop: 2, color: me ? C.ink : pal(tone).mute}}>
    {time}
    {me ? <CheckCheck size={14} /> : null}
  </span>
);

/** Text that types itself between two frames. */
export const Typed: React.FC<{text: string; from: number; to: number}> = ({text, from, to}) => {
  const frame = useCurrentFrame();
  const n = Math.round(interpolate(frame, [from, to], [0, text.length], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}));
  const caret = frame < to + 6 && Math.floor(frame / 8) % 2 === 0;
  return (
    <span>
      {text.slice(0, n)}
      <span style={{opacity: caret ? 1 : 0}}>|</span>
    </span>
  );
};

// Hand-picked bar heights for a natural speech shape (the site's ChatDemo uses the same idea).
const WAVE = [28, 46, 70, 38, 82, 54, 30, 66, 90, 48, 34, 72, 58, 26, 62, 84, 44, 32, 70, 52, 36, 78, 50, 28, 60, 40];

export const VoiceNote: React.FC<{at: number; tone: ChatTone}> = ({at, tone}) => {
  const frame = useCurrentFrame();
  const play = interpolate(frame, [at + 8, at + 40], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return (
    <Msg at={at} me tone={tone} width={262}>
      <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
        <div style={{width: 34, height: 34, borderRadius: 17, background: C.ink, display: 'grid', placeItems: 'center', flexShrink: 0}}>
          <Play size={16} color={C.gold} fill={C.gold} />
        </div>
        <div style={{display: 'flex', alignItems: 'center', gap: 2.5, height: 30, flex: 1}}>
          {WAVE.map((h, i) => {
            const lit = i / WAVE.length < play;
            const wob = 0.75 + 0.25 * Math.sin(frame * 0.5 + i * 1.3);
            return <div key={i} style={{width: 3, height: `${h * (lit ? wob : 1)}%`, borderRadius: 2, background: C.ink, opacity: lit ? 1 : 0.35}} />;
          })}
        </div>
        <span style={{fontSize: 12, fontWeight: 700}}>0:12</span>
      </div>
    </Msg>
  );
};

/** The interactive list message: a bot prompt with a "Menu" button, then the sheet of sections with one tapped. */
export const ListSheet: React.FC<{at: number; tapAt: number; tone: ChatTone}> = ({at, tapAt, tone}) => {
  const frame = useCurrentFrame();
  const p = pal(tone);
  const s = useIn(at, SPRING.soft);
  const rows = [
    {t: 'Grills', d: 'Shish taouk, kafta'},
    {t: 'Shawarma', d: 'Chicken, meat'},
    {t: 'Manakish', d: 'Zaatar, cheese, kishk'},
    {t: 'Drinks', d: 'Ayran, juices'},
  ];
  const tapped = 1;
  const ripple = interpolate(frame, [tapAt, tapAt + 14], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  if (frame < at) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        background: tone === 'night' ? C.ink2 : C.paper,
        borderTopLeftRadius: 26,
        borderTopRightRadius: 26,
        padding: '12px 18px 34px',
        transform: `translateY(${(1 - s) * 105}%)`,
        boxShadow: '0 -20px 60px rgba(0,0,0,0.45)',
        fontFamily: T.latin,
        color: p.botFg,
      }}
    >
      <div style={{width: 42, height: 5, borderRadius: 3, background: p.mute, opacity: 0.4, margin: '0 auto 14px'}} />
      <div style={{fontWeight: 800, fontSize: 19, marginBottom: 10}}>Menu</div>
      {rows.map((r, i) => {
        const on = i === tapped && frame >= tapAt;
        return (
          <div
            key={r.t}
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '13px 12px',
              borderRadius: 14,
              marginBottom: 6,
              overflow: 'hidden',
              background: on ? (tone === 'night' ? 'rgba(244,182,60,0.16)' : C.cream2) : 'transparent',
              borderBottom: `1px solid ${p.line}`,
            }}
          >
            {i === tapped && frame >= tapAt ? (
              <div style={{position: 'absolute', left: 140, top: 26, width: 10, height: 10, borderRadius: 5, background: C.gold, opacity: 0.5 * (1 - ripple), transform: `scale(${1 + ripple * 40})`}} />
            ) : null}
            <div>
              <div style={{fontWeight: 700, fontSize: 17}}>{r.t}</div>
              <div style={{fontSize: 13, color: p.mute}}>{r.d}</div>
            </div>
            <div style={{width: 22, height: 22, borderRadius: 11, border: `2px solid ${on ? C.gold : p.mute}`, display: 'grid', placeItems: 'center'}}>
              {on ? <div style={{width: 10, height: 10, borderRadius: 5, background: C.gold}} /> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
};

/** The branded basket card (§32.5 visual order card: gold card, items; no amounts, see SCRIPTS.md). */
export const BasketCard: React.FC<{at: number; confirmAt: number; tone: ChatTone}> = ({at, confirmAt, tone}) => {
  const frame = useCurrentFrame();
  const pressed = frame >= confirmAt;
  const press = useIn(confirmAt, SPRING.bouncy);
  const items = [
    ['2', 'Chicken shawarma', 'extra garlic'],
    ['1', 'Manoushe zaatar', ''],
    ['2', 'Ayran', ''],
  ];
  return (
    <Msg at={at} tone={tone} width="92%" pad="0">
      <div style={{borderRadius: 18, overflow: 'hidden', border: `1.5px solid ${C.gold}`}}>
        <div style={{background: C.gold, color: C.ink, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8}}>
          <Crown size={26} color={C.ink} />
          <span style={{fontWeight: 800, fontSize: 17}}>Your basket</span>
        </div>
        <div style={{padding: '8px 14px 4px'}}>
          {items.map(([q, n, o]) => (
            <div key={n} style={{display: 'flex', gap: 10, padding: '7px 0', borderBottom: `1px solid ${pal(tone).line}`}}>
              <span style={{fontWeight: 800, color: tone === 'night' ? C.gold : C.goldText, minWidth: 22}}>{q}×</span>
              <span style={{fontWeight: 700}}>
                {n}
                {o ? <span style={{display: 'block', fontSize: 12, fontWeight: 600, opacity: 0.65}}>{o}</span> : null}
              </span>
            </div>
          ))}
          <div style={{fontSize: 12, fontWeight: 600, opacity: 0.7, padding: '8px 0 6px'}}>Total shown in USD and LBP, rate locked on the order</div>
        </div>
        <div style={{display: 'flex', borderTop: `1px solid ${pal(tone).line}`}}>
          <div style={{flex: 1, textAlign: 'center', padding: '12px 0', fontWeight: 700, opacity: 0.8}}>Change</div>
          <div
            style={{
              flex: 1.3,
              textAlign: 'center',
              padding: '12px 0',
              fontWeight: 800,
              background: pressed ? C.gold : 'transparent',
              color: pressed ? C.ink : tone === 'night' ? C.gold : C.goldText,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              transform: `scale(${pressed ? 1 - 0.08 * Math.sin(Math.min(1, press) * Math.PI) : 1})`,
            }}
          >
            {pressed ? <Check size={18} strokeWidth={3} /> : null}
            {pressed ? 'Confirmed' : 'Confirm'}
          </div>
        </div>
      </div>
    </Msg>
  );
};

export const Buttons: React.FC<{at: number; tone: ChatTone; labels: string[]; pick?: number; pickAt?: number}> = ({at, tone, labels, pick, pickAt = 1e9}) => {
  const frame = useCurrentFrame();
  const s = useIn(at);
  if (frame < at) return null;
  return (
    <div style={{display: 'flex', flexDirection: 'column', gap: 6, alignSelf: 'flex-start', width: '86%', opacity: s, transform: `translateY(${(1 - s) * 18}px)`}}>
      {labels.map((l, i) => {
        const on = i === pick && frame >= pickAt;
        return (
          <div
            key={l}
            style={{
              textAlign: 'center',
              padding: '11px 0',
              borderRadius: 14,
              fontWeight: 800,
              fontSize: 16,
              background: on ? C.gold : pal(tone).bot,
              color: on ? C.ink : tone === 'night' ? C.gold : C.goldText,
            }}
          >
            {l}
          </div>
        );
      })}
    </div>
  );
};

export const Status: React.FC<{at: number; tone: ChatTone; kind: 'accepted' | 'way' | 'delivered'}> = ({at, tone, kind}) => {
  const m = {
    accepted: {icon: BadgeCheck, t: 'Order accepted', d: 'The kitchen is on it'},
    way: {icon: Bike, t: 'On the way', d: 'Tap to track'},
    delivered: {icon: PackageCheck, t: 'Delivered', d: 'Enjoy!'},
  }[kind];
  const Icon = m.icon;
  return (
    <Msg at={at} tone={tone} width="80%">
      <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
        <div style={{width: 34, height: 34, borderRadius: 17, background: C.gold, display: 'grid', placeItems: 'center', flexShrink: 0}}>
          <Icon size={19} color={C.ink} strokeWidth={2.4} />
        </div>
        <div style={{lineHeight: 1.25}}>
          <div style={{fontWeight: 800}}>{m.t}</div>
          <div style={{fontSize: 13, opacity: 0.7, display: 'flex', alignItems: 'center'}}>
            {m.d}
            {kind === 'way' ? <ChevronRight size={14} /> : null}
          </div>
        </div>
      </div>
    </Msg>
  );
};
