import React from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {CheckCircle2, Gift, Globe2, Heart, MapPin, MessageCircle, Plane} from 'lucide-react';
import tl1 from '../data/v1.json';
import {C, SPRING, T} from '../brand/tokens';
import {Crown} from '../brand/Crown';
import {Backdrop, Kinetic} from '../components/Backdrop';
import {Captions} from '../components/Captions';
import {Phone3D, Pose} from '../components/Phone3D';
import {BasketCard, Buttons, ListSheet, Meta, Msg, Screen, Status, Typed, VoiceNote, useIn} from '../components/Chat';
import {cueFrame, scene, Timeline} from '../lib/timeline';
import {phonePose} from '../lib/pose';

const tl = tl1 as Timeline;
const cue = (id: string) => cueFrame(tl, id);

const P = (x: number, y: number, z: number, rx: number, ry: number, rz: number, s = 1): Pose => ({x, y, z, rx, ry, rz, s});
const HIDDEN = P(0, -4.4, 0, 0.7, 1.5, 0.25);
const POSES: Record<string, Pose> = {
  'hook-a': HIDDEN,
  'hook-b': P(0, 0.38, 0.2, 0.04, -0.14, 0),
  type: P(0.52, 0.44, 0, 0.03, -0.3, 0),
  voice: P(0.5, 0.46, 0.1, 0.07, -0.18, -0.03),
  tap: P(0.53, 0.43, 0, -0.01, -0.34, 0.02),
  languages: P(-0.6, 0.47, -0.5, 0.05, 0.4, 0, 0.92),
  basket: P(0, 0.39, 0.38, 0.02, -0.06, 0),
  confirm: P(0.02, 0.39, 0.42, -0.03, 0.12, -0.02),
  paytrack: P(0.52, 0.44, 0, 0.03, -0.26, 0),
  abroad: P(2.7, 0.7, -1.2, 0.2, -1.3, 0.25, 0.9),
  sendhome: P(0, 0.41, 0.3, 0.03, 0.1, 0),
  cta: P(0, 4.8, -1.5, -0.6, 0.7, 0),
};

const Thread: React.FC = () => {
  const frame = useCurrentFrame();
  const tone = 'night' as const;
  const typing = frame >= cue('typeStart') && frame < cue('typeSend');
  const sheetOut = scene(tl, 'languages').from;
  return (
    <Screen
      tone={tone}
      draft={typing ? <Typed text="2 shawarma w ayran" from={cue('typeStart')} to={cue('typeSend') - 4} /> : undefined}
      overlay={frame < sheetOut + 12 ? <SheetWithExit /> : null}
    >
      <Msg at={cue('phoneIn') + 8} tone={tone}>
        Alo! What are you craving today?
        <Meta tone={tone} />
      </Msg>
      <Msg at={cue('typeSend')} me tone={tone}>
        2 shawarma w ayran
        <Meta me tone={tone} />
      </Msg>
      <VoiceNote at={cue('voiceNote')} tone={tone} />
      <Msg at={cue('menuTap') + 10} me tone={tone}>
        Shawarma
        <Meta me tone={tone} />
      </Msg>
      <BasketCard at={cue('basket')} confirmAt={cue('confirmTap')} tone={tone} />
      <Msg at={cue('payAsk')} tone={tone}>How would you like to pay?</Msg>
      <Buttons at={cue('payAsk') + 4} tone={tone} labels={['Cash on delivery · USD', 'Cash on delivery · LBP']} pick={0} pickAt={cue('payPick')} />
      <Status at={cue('accepted')} tone={tone} kind="accepted" />
      <Status at={cue('onWay')} tone={tone} kind="way" />
      <Status at={cue('delivered')} tone={tone} kind="delivered" />
      <SendHomeCard />
    </Screen>
  );
};

const SheetWithExit: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const out = spring({frame: frame - (cue('menuTap') + 8), fps, config: SPRING.snappy});
  return (
    <div style={{position: 'absolute', inset: 0, transform: `translateY(${out * 110}%)`}}>
      <ListSheet at={cue('menuSheet')} tapAt={cue('menuTap')} tone="night" />
    </div>
  );
};

const SendHomeCard: React.FC = () => {
  const frame = useCurrentFrame();
  const at = cue('sendHome');
  if (frame < at) return null;
  const row = (icon: React.ReactNode, a: string, b: string, when: number) => {
    const s = spring({frame: frame - when, fps: 30, config: SPRING.snappy});
    return (
      <div style={{display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid rgba(248,241,231,0.08)', opacity: s, transform: `translateX(${(1 - s) * -20}px)`}}>
        <div style={{width: 30, height: 30, borderRadius: 15, background: 'rgba(244,182,60,0.16)', display: 'grid', placeItems: 'center', flexShrink: 0}}>{icon}</div>
        <div style={{lineHeight: 1.2}}>
          <div style={{fontSize: 12, opacity: 0.65, fontWeight: 600}}>{a}</div>
          <div style={{fontWeight: 800}}>{b}</div>
        </div>
      </div>
    );
  };
  return (
    <Msg at={at} tone="night" width="92%" pad="0">
      <div style={{borderRadius: 18, overflow: 'hidden', border: `1.5px solid ${C.gold}`}}>
        <div style={{background: C.gold, color: C.ink, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8}}>
          <Gift size={22} strokeWidth={2.4} />
          <span style={{fontWeight: 800, fontSize: 17}}>Send Home</span>
        </div>
        <div style={{padding: '4px 14px 10px'}}>
          {row(<Globe2 size={16} color={C.gold} />, 'From', 'You, abroad', at + 6)}
          {row(<MapPin size={16} color={C.gold} />, 'For', 'Mom · Baakline', at + 14)}
          {row(<Heart size={16} color={C.gold} />, 'Gift note', 'Happy birthday, Mama', at + 22)}
          {frame >= cue('sendFamily') ? (
            <div style={{marginTop: 10, padding: '9px 12px', borderRadius: 12, background: 'rgba(123,211,137,0.14)', color: C.okNight, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8, fontSize: 15}}>
              <CheckCircle2 size={18} /> On its way to Mom
            </div>
          ) : null}
        </div>
      </div>
    </Msg>
  );
};

/** "In Arabic, English, French or Arabizi": the §37.3 examples as big bubbles, one per spoken language. */
const LanguageWall: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const sc = scene(tl, 'languages');
  if (frame < sc.from - 2 || frame >= sc.to + 10) return null;
  const out = spring({frame: frame - sc.to, fps, config: SPRING.snappy});
  const items: {label: string; text: string; at: number; rtl?: boolean}[] = [
    {label: 'Arabic', text: 'بدي ٢ شاورما', at: cue('langAr'), rtl: true},
    {label: 'English', text: 'Two shawarma, please', at: cue('langEn')},
    {label: 'French', text: 'Deux manakish zaatar', at: cue('langFr')},
    {label: 'Arabizi', text: 'bade 2 shawarma w ayran', at: cue('langAz')},
  ];
  return (
    <div style={{position: 'absolute', left: 400, top: 340, width: 600, display: 'flex', flexDirection: 'column', gap: 30, opacity: 1 - out}}>
      {items.map((it, i) => {
        const s = spring({frame: frame - it.at, fps, config: SPRING.bouncy});
        if (frame < it.at) return <div key={i} style={{height: 150}} />;
        const active = i === items.filter((x) => frame >= x.at).length - 1;
        return (
          <div key={i} style={{transform: `translateX(${(1 - s) * 120}px) scale(${0.8 + 0.2 * s})`, transformOrigin: '100% 50%', opacity: Math.min(1, s * 1.4), alignSelf: 'flex-end'}}>
            <div style={{fontFamily: T.latin, fontSize: 26, fontWeight: 700, color: active ? C.gold : C.muteNight, textAlign: 'right', marginBottom: 8}}>{it.label}</div>
            <div
              style={{
                background: active ? C.gold : C.ink3,
                color: active ? C.ink : C.textNight,
                fontFamily: it.rtl ? T.arabic : T.latin,
                direction: it.rtl ? 'rtl' : 'ltr',
                fontWeight: 800,
                fontSize: it.rtl ? 48 : 38,
                lineHeight: 1.2,
                padding: '18px 26px',
                borderRadius: 30,
                borderBottomRightRadius: 8,
                whiteSpace: 'nowrap',
              }}
            >
              {it.text}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const ConfirmBurst: React.FC = () => {
  const frame = useCurrentFrame();
  const at = cue('confirmTap');
  if (frame < at || frame > at + 40) return null;
  const t = (frame - at) / 40;
  return (
    <div style={{position: 'absolute', left: 540 - 400, top: 760 - 400, width: 800, height: 800, borderRadius: '50%', border: `${14 * (1 - t)}px solid ${C.gold}`, opacity: 1 - t, transform: `scale(${0.4 + t * 0.9})`}} />
  );
};

const Abroad: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const at = cue('abroad');
  const sc = scene(tl, 'abroad');
  if (frame < at - 2 || frame > sc.to + 14) return null;
  const fly = interpolate(frame, [at, sc.to + 14], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const out = spring({frame: frame - sc.to, fps, config: SPRING.snappy});
  // The plane follows an arc from the top left to the phone's place.
  const px = 120 + fly * 700;
  const py = 560 - Math.sin(fly * Math.PI) * 180;
  return (
    <>
      <Kinetic words={[['Living', at], ['abroad?', at + 5]]} tone="night" size={190} x={80} y={600} width={920} exitAt={sc.to - 2} />
      <svg width={1080} height={1920} style={{position: 'absolute', inset: 0, opacity: 1 - out}}>
        <path d="M 120 560 Q 470 200 820 560" fill="none" stroke={C.gold} strokeWidth={4} strokeDasharray="4 16" strokeLinecap="round" opacity={0.7} pathLength={1} strokeDashoffset={0} style={{clipPath: `inset(0 ${100 - fly * 100}% 0 0)`}} />
      </svg>
      <div style={{position: 'absolute', left: px - 40, top: py - 40, opacity: 1 - out, transform: `rotate(${interpolate(fly, [0, 1], [-35, 35])}deg)`}}>
        <Plane size={80} color={C.gold} fill={C.gold} strokeWidth={1.5} />
      </div>
    </>
  );
};

const EndCard: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const at = cue('ctaCrown');
  if (frame < at - 2) return null;
  const crown = interpolate(frame, [at, at + 24], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const word = spring({frame: frame - at - 6, fps, config: SPRING.soft});
  const btn = spring({frame: frame - cue('ctaButton'), fps, config: SPRING.bouncy});
  const pulse = 1 + 0.03 * Math.max(0, Math.sin((frame - cue('ctaButton') - 20) * 0.18));
  return (
    <AbsoluteFill style={{alignItems: 'center'}}>
      <div style={{position: 'absolute', top: 330, display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
        <div style={{filter: `drop-shadow(0 0 ${30 * crown}px rgba(244,182,60,0.55))`}}>
          <Crown size={250} color={C.gold} draw={crown} />
        </div>
        <div style={{fontFamily: T.latin, fontWeight: 800, fontSize: T.display, letterSpacing: '-0.045em', lineHeight: 0.98, color: C.textNight, marginTop: 26, opacity: word, transform: `translateY(${(1 - word) * 40}px)`}}>Alo King</div>
        <div style={{fontFamily: T.arabic, fontWeight: 700, fontSize: 54, color: C.gold, marginTop: 14, opacity: word, direction: 'rtl'}}>ألو كينغ</div>
        <div
          style={{
            marginTop: 70,
            display: 'flex',
            alignItems: 'center',
            gap: 18,
            padding: '30px 54px',
            borderRadius: 999,
            background: C.gold,
            color: C.ink,
            fontFamily: T.latin,
            fontWeight: 800,
            fontSize: 52,
            letterSpacing: '-0.02em',
            boxShadow: '0 0 0 10px rgba(244,182,60,0.16), 0 0 60px 6px rgba(244,182,60,0.45)',
            opacity: Math.min(1, btn * 1.5),
            transform: `scale(${(0.7 + 0.3 * btn) * pulse})`,
          }}
        >
          <MessageCircle size={54} strokeWidth={2.6} />
          Order on WhatsApp
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Hook: React.FC = () => {
  const at = cue('hookWord');
  return <Kinetic words={[['Hungry?', at - 7]]} tone="night" size={210} x={80} y={600} width={920} align="center" exitAt={cue('phoneIn') + 4} />;
};

const SideWords: React.FC = () => {
  const frame = useCurrentFrame();
  const a = scene(tl, 'type');
  const b = scene(tl, 'paytrack');
  if (frame >= a.from - 2 && frame < scene(tl, 'languages').from + 12) {
    return (
      <Kinetic
        words={[['Type.', cue('typeStart')], ['Talk.', cue('voiceNote')], ['Tap.', cue('menuSheet')]]}
        tone="night"
        size={124}
        x={80}
        y={420}
        width={460}
        gap={10}
        exitAt={scene(tl, 'languages').from}
      />
    );
  }
  if (frame >= b.from - 2 && frame < b.to + 12) {
    return <Kinetic words={[['Pay.', cue('payAsk')], ['Track.', cue('accepted')]]} tone="night" size={124} x={80} y={480} width={460} gap={10} exitAt={b.to} />;
  }
  return null;
};

export const V1Customers: React.FC = () => {
  const frame = useCurrentFrame();
  const pose = phonePose(tl, frame, POSES, HIDDEN);
  const enter = useIn(0, SPRING.soft);
  return (
    <AbsoluteFill style={{background: C.ink, overflow: 'hidden'}}>
      <Backdrop tone="night" />
      <Hook />
      <SideWords />
      <Abroad />
      <ConfirmBurst />
      <Phone3D pose={pose} tone="night" glow={enter}>
        <Thread />
      </Phone3D>
      <LanguageWall />
      <EndCard />
      <Captions tl={tl} tone="night" />
    </AbsoluteFill>
  );
};

export const v1Timeline = tl;
