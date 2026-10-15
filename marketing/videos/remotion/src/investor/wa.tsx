import React from 'react';
import {interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {
  ArrowLeft, Camera, CheckCheck, List, Mic, MoreVertical, Paperclip, Phone, PhoneOff, Play, Search, Smile, Video,
} from 'lucide-react';
import {Crown} from '../brand/Crown';
import {C} from '../brand/tokens';

/**
 * WhatsApp's own light theme (Android), redrawn: colours and layout only, no WhatsApp logo or artwork.
 * Screen units are CSS px on the 345×738 phone screen (components/Phone3D.tsx).
 */
export const WA = {
  header: '#008069',
  status: '#00735C',
  wall: '#EFEAE2',
  out: '#D9FDD3',
  in: '#FFFFFF',
  text: '#111B21',
  meta: '#667781',
  tick: '#53BDEB',
  icon: '#54656F',
  green: '#00A884',
  badge: '#25D366',
  link: '#027EB5',
  font: 'Roboto, "IBM Plex Sans Arabic", sans-serif',
};

export const useSpringIn = (at: number, damping = 15) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return spring({frame: frame - at, fps, config: {damping, stiffness: 170, mass: 0.7}});
};

// Faint doodles on the wallpaper, drawn from simple shapes (not WhatsApp's artwork).
const Doodles: React.FC = () => (
  <svg width="100%" height="100%" style={{position: 'absolute', inset: 0, opacity: 0.5}}>
    <defs>
      <pattern id="wa-doodle" width="86" height="86" patternUnits="userSpaceOnUse">
        <g fill="none" stroke="#D9D2C5" strokeWidth="1.4" strokeLinecap="round">
          <circle cx="14" cy="16" r="6" />
          <path d="M40 10 l8 8 l-8 8" />
          <rect x="60" y="8" width="14" height="10" rx="3" />
          <path d="M10 50 q8 -10 16 0 t16 0" />
          <path d="M58 46 l6 10 l6 -10" />
          <circle cx="76" cy="70" r="3" />
          <path d="M30 70 h12 M36 64 v12" />
        </g>
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#wa-doodle)" />
  </svg>
);

export const StatusBar: React.FC<{dark?: boolean}> = ({dark}) => (
  <div style={{height: 30, background: dark ? 'transparent' : WA.status, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 18px 0 26px', fontSize: 12.5, fontWeight: 500, fontFamily: WA.font, flexShrink: 0, position: 'relative'}}>
    <span>9:41</span>
    <div style={{position: 'absolute', left: '50%', top: 6, width: 86, height: 22, marginLeft: -43, borderRadius: 14, background: '#000'}} />
    <span style={{letterSpacing: 1}}>▮▮▮ ◔</span>
  </div>
);

export const Avatar: React.FC<{size?: number; brand?: 'customer' | 'merchant'; letter?: string; tint?: string}> = ({size = 36, brand, letter, tint = '#DFE5E7'}) => (
  <div style={{width: size, height: size, borderRadius: size / 2, background: brand === 'customer' ? C.gold : brand === 'merchant' ? C.ink : tint, display: 'grid', placeItems: 'center', flexShrink: 0, color: '#fff', fontWeight: 700, fontSize: size * 0.42, fontFamily: WA.font}}>
    {brand ? <Crown size={size * 0.62} color={brand === 'customer' ? C.ink : C.gold} /> : letter}
  </div>
);

export const ChatScreen: React.FC<{
  title: string;
  subtitle?: string;
  brand?: 'customer' | 'merchant';
  letter?: string;
  draft?: React.ReactNode;
  children: React.ReactNode;
  overlay?: React.ReactNode;
  scroll?: number;
}> = ({title, subtitle = 'online', brand, letter, draft, children, overlay, scroll = 0}) => (
  <div style={{position: 'absolute', inset: 0, background: WA.wall, fontFamily: WA.font, color: WA.text, display: 'flex', flexDirection: 'column'}}>
    <StatusBar />
    <div style={{background: WA.header, color: '#fff', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px 8px 6px', flexShrink: 0}}>
      <ArrowLeft size={20} />
      <Avatar size={34} brand={brand} letter={letter} />
      <div style={{flex: 1, lineHeight: 1.15, minWidth: 0}}>
        <div style={{fontWeight: 500, fontSize: 15.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{title}</div>
        <div style={{fontSize: 11.5, opacity: 0.85}}>{subtitle}</div>
      </div>
      <Video size={19} />
      <Phone size={17} style={{marginLeft: 14}} />
      <MoreVertical size={18} style={{marginLeft: 8}} />
    </div>
    <div style={{flex: 1, position: 'relative', overflow: 'hidden'}}>
      <Doodles />
      <div style={{position: 'absolute', left: 0, right: 0, bottom: 0, padding: '8px 8px 6px', display: 'flex', flexDirection: 'column', gap: 5, transform: `translateY(${-scroll}px)`}}>
        <div style={{alignSelf: 'center', background: '#fff', color: WA.icon, fontSize: 11, padding: '4px 10px', borderRadius: 7, marginBottom: 4, boxShadow: '0 1px 0.5px rgba(11,20,26,.13)'}}>TODAY</div>
        {children}
      </div>
    </div>
    <div style={{display: 'flex', alignItems: 'center', gap: 6, padding: '6px 6px 14px', flexShrink: 0}}>
      <div style={{flex: 1, height: 40, borderRadius: 20, background: '#fff', display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px', color: '#8696A0', fontSize: 15, boxShadow: '0 1px 0.5px rgba(11,20,26,.13)'}}>
        <Smile size={20} />
        <span style={{flex: 1, color: draft ? WA.text : '#8696A0', whiteSpace: 'nowrap', overflow: 'hidden'}}>{draft ?? 'Message'}</span>
        <Paperclip size={18} />
        <Camera size={19} />
      </div>
      <div style={{width: 40, height: 40, borderRadius: 20, background: WA.green, display: 'grid', placeItems: 'center'}}>
        <Mic size={19} color="#fff" />
      </div>
    </div>
    {overlay}
  </div>
);

/** A message bubble with WhatsApp's tail, time and ticks; springs in at `at`. */
export const Bubble: React.FC<{at: number; me?: boolean; children: React.ReactNode; time?: string; width?: number | string; pad?: string; tail?: boolean}> = ({
  at, me, children, time = '12:04', width, pad = '6px 8px 4px 9px', tail = true,
}) => {
  const frame = useCurrentFrame();
  const s = useSpringIn(at);
  if (frame < at) return null;
  const bg = me ? WA.out : WA.in;
  return (
    <div style={{alignSelf: me ? 'flex-end' : 'flex-start', maxWidth: '84%', width, position: 'relative', marginLeft: me ? 0 : 7, marginRight: me ? 7 : 0, transform: `translateY(${(1 - s) * 18}px) scale(${0.94 + 0.06 * s})`, transformOrigin: me ? '100% 100%' : '0 100%', opacity: Math.min(1, s * 1.6)}}>
      {tail ? (
        <svg width="9" height="13" viewBox="0 0 8 13" style={{position: 'absolute', top: 0, [me ? 'right' : 'left']: -8, transform: me ? undefined : 'scaleX(-1)'}}>
          <path d="M0 0 H8 L1.5 8.5 C0.6 9.7 0 10 0 10 Z" fill={bg} />
        </svg>
      ) : null}
      <div style={{background: bg, borderRadius: 8, borderTopRightRadius: me && tail ? 0 : 8, borderTopLeftRadius: !me && tail ? 0 : 8, padding: pad, fontSize: 14.2, lineHeight: 1.32, boxShadow: '0 1px 0.5px rgba(11,20,26,.13)'}}>
        {children}
        <div style={{display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 3, fontSize: 10.5, color: WA.meta, marginTop: 1, marginBottom: -1}}>
          {time}
          {me ? <CheckCheck size={14} color={WA.tick} /> : null}
        </div>
      </div>
    </div>
  );
};

/** Reply buttons attached under a business message (interactive message). `pick` lights one when tapped. */
export const ReplyButtons: React.FC<{at: number; labels: string[]; pick?: number; pickAt?: number; icon?: React.ReactNode}> = ({at, labels, pick, pickAt = 1e9}) => {
  const frame = useCurrentFrame();
  const s = useSpringIn(at);
  if (frame < at) return null;
  return (
    <div style={{display: 'flex', flexDirection: 'column', gap: 3, alignSelf: 'flex-start', width: '84%', marginLeft: 7, marginTop: -2, opacity: s}}>
      {labels.map((l, i) => {
        const on = i === pick && frame >= pickAt;
        const ripple = interpolate(frame, [pickAt, pickAt + 12], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
        return (
          <div key={l} style={{position: 'relative', overflow: 'hidden', background: on ? '#E7F6F1' : '#fff', color: WA.link, textAlign: 'center', fontSize: 14, fontWeight: 500, padding: '8px 0', borderRadius: 8, boxShadow: '0 1px 0.5px rgba(11,20,26,.13)'}}>
            {on ? <div style={{position: 'absolute', left: '50%', top: '50%', width: 8, height: 8, marginLeft: -4, marginTop: -4, borderRadius: 4, background: WA.green, opacity: 0.35 * (1 - ripple), transform: `scale(${1 + ripple * 50})`}} /> : null}
            <span style={{position: 'relative'}}>{l}</span>
          </div>
        );
      })}
    </div>
  );
};

/** The list-message button inside a business bubble ("View menu"). */
export const ListButton: React.FC<{label: string}> = ({label}) => (
  <div style={{borderTop: '1px solid #E9EDEF', margin: '6px -8px -2px -9px', padding: '8px 0 2px', textAlign: 'center', color: WA.link, fontWeight: 500, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6}}>
    <List size={16} /> {label}
  </div>
);

/** The list sheet that slides up from the bottom; one row is tapped at `tapAt`. */
export const ListSheet: React.FC<{at: number; out: number; title: string; rows: [string, string][]; tapped: number; tapAt: number}> = ({at, out, title, rows, tapped, tapAt}) => {
  const frame = useCurrentFrame();
  const s = useSpringIn(at, 20);
  const o = useSpringIn(out, 18);
  if (frame < at) return null;
  return (
    <div style={{position: 'absolute', inset: 0, background: `rgba(11,20,26,${0.4 * s * (1 - o)})`}}>
      <div style={{position: 'absolute', left: 0, right: 0, bottom: 0, background: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: '10px 0 20px', transform: `translateY(${(1 - s + o) * 105}%)`, fontFamily: WA.font}}>
        <div style={{width: 34, height: 4, borderRadius: 2, background: '#D1D7DB', margin: '0 auto 10px'}} />
        <div style={{textAlign: 'center', fontWeight: 500, fontSize: 16, marginBottom: 6}}>{title}</div>
        {rows.map(([t, d], i) => {
          const on = i === tapped && frame >= tapAt;
          return (
            <div key={t} style={{display: 'flex', alignItems: 'center', padding: '10px 18px', borderBottom: '1px solid #F0F2F5', background: on ? '#F0F2F5' : '#fff'}}>
              <div style={{flex: 1}}>
                <div style={{fontSize: 15, color: WA.text}}>{t}</div>
                <div style={{fontSize: 12.5, color: WA.meta}}>{d}</div>
              </div>
              <div style={{width: 20, height: 20, borderRadius: 10, border: `2px solid ${on ? WA.green : '#8696A0'}`, display: 'grid', placeItems: 'center'}}>
                {on ? <div style={{width: 10, height: 10, borderRadius: 5, background: WA.green}} /> : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const WAVE = [30, 52, 74, 40, 86, 58, 34, 70, 92, 50, 36, 76, 60, 28, 66, 88, 46, 34, 72, 54, 38, 80, 52, 30, 62, 42, 26];

export const VoiceBubble: React.FC<{at: number; me?: boolean; seconds?: string}> = ({at, me = true, seconds = '0:21'}) => {
  const frame = useCurrentFrame();
  const play = interpolate(frame, [at + 6, at + 70], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return (
    <Bubble at={at} me={me} width={248}>
      <div style={{display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0'}}>
        <Play size={20} color={WA.icon} fill={WA.icon} />
        <div style={{flex: 1, display: 'flex', alignItems: 'center', gap: 2, height: 26}}>
          {WAVE.map((h, i) => (
            <div key={i} style={{width: 2.6, height: `${h}%`, borderRadius: 2, background: i / WAVE.length < play ? WA.green : '#B3BEC4'}} />
          ))}
        </div>
        <div style={{position: 'relative'}}>
          <Avatar size={34} letter="R" tint="#7FB3A6" />
          <Mic size={14} color={WA.green} style={{position: 'absolute', right: -3, bottom: -2, background: WA.out, borderRadius: 7}} />
        </div>
      </div>
      <div style={{fontSize: 10.5, color: WA.meta, marginTop: -2, marginLeft: 30}}>{seconds}</div>
    </Bubble>
  );
};

/** WhatsApp's chat list (the "Chats" tab). */
export const ChatList: React.FC<{rows: {name: string; msg: string; time: string; unread?: number; letter?: string; tint?: string; brand?: 'customer'; voice?: boolean; at?: number}[]}> = ({rows}) => {
  const frame = useCurrentFrame();
  return (
    <div style={{position: 'absolute', inset: 0, background: '#fff', fontFamily: WA.font, color: WA.text}}>
      <StatusBar />
      <div style={{background: WA.header, color: '#fff', padding: '8px 16px 10px', display: 'flex', alignItems: 'center'}}>
        <div style={{flex: 1, fontSize: 19, fontWeight: 500}}>Chats</div>
        <Camera size={19} />
        <Search size={18} style={{marginLeft: 18}} />
        <MoreVertical size={18} style={{marginLeft: 12}} />
      </div>
      {rows.map((r, i) => {
        const at = r.at ?? -100;
        const s = spring({frame: frame - at, fps: 30, config: {damping: 14, stiffness: 160}});
        if (frame < at) return null;
        return (
          <div key={i} style={{display: 'flex', alignItems: 'center', gap: 12, padding: '9px 14px', opacity: Math.min(1, s * 1.5), transform: `translateY(${(1 - s) * -20}px)`, background: r.brand && frame < at + 40 ? '#E7F6F1' : '#fff'}}>
            <Avatar size={44} letter={r.letter ?? r.name[0]} tint={r.tint} brand={r.brand} />
            <div style={{flex: 1, minWidth: 0, borderBottom: '1px solid #F0F2F5', paddingBottom: 9}}>
              <div style={{display: 'flex', justifyContent: 'space-between'}}>
                <span style={{fontWeight: 500, fontSize: 15.5}}>{r.name}</span>
                <span style={{fontSize: 11.5, color: r.unread ? WA.badge : WA.meta}}>{r.time}</span>
              </div>
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2}}>
                <span style={{fontSize: 13.5, color: WA.meta, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: 4}}>
                  {r.voice ? <Mic size={14} color={WA.green} /> : null}
                  {r.msg}
                </span>
                {r.unread ? <span style={{minWidth: 20, height: 20, borderRadius: 10, background: WA.badge, color: '#fff', fontSize: 11.5, fontWeight: 700, display: 'grid', placeItems: 'center', padding: '0 5px'}}>{r.unread}</span> : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

/** Incoming WhatsApp-style voice call (dark call screen). */
export const CallScreen: React.FC<{name: string; answeredAt: number}> = ({name, answeredAt}) => {
  const frame = useCurrentFrame();
  const ans = frame >= answeredAt;
  const pulse = 1 + 0.08 * Math.sin(frame * 0.35);
  return (
    <div style={{position: 'absolute', inset: 0, background: 'linear-gradient(180deg, #1F3B35 0%, #0B141A 60%)', color: '#E9EDEF', fontFamily: WA.font, textAlign: 'center'}}>
      <StatusBar dark />
      <div style={{marginTop: 30, fontSize: 12, opacity: 0.7}}>🔒 End-to-end encrypted</div>
      <div style={{marginTop: 70, display: 'grid', placeItems: 'center'}}>
        <div style={{transform: `scale(${ans ? 1 : pulse})`, borderRadius: '50%', boxShadow: ans ? 'none' : '0 0 0 14px rgba(0,168,132,0.15), 0 0 0 30px rgba(0,168,132,0.07)'}}>
          <Avatar size={104} letter={name[0]} tint="#6B8F87" />
        </div>
      </div>
      <div style={{marginTop: 26, fontSize: 26, fontWeight: 500}}>{name}</div>
      <div style={{marginTop: 8, fontSize: 14, opacity: 0.75}}>{ans ? '00:01' : 'Incoming voice call'}</div>
      <div style={{position: 'absolute', bottom: 60, left: 0, right: 0, display: 'flex', justifyContent: ans ? 'center' : 'space-around'}}>
        {!ans ? (
          <div style={{width: 62, height: 62, borderRadius: 31, background: '#F15C6D', display: 'grid', placeItems: 'center'}}>
            <PhoneOff size={26} color="#fff" />
          </div>
        ) : null}
        <div style={{width: 62, height: 62, borderRadius: 31, background: ans ? '#F15C6D' : WA.green, display: 'grid', placeItems: 'center', transform: `translateY(${ans ? 0 : -6 * Math.abs(Math.sin(frame * 0.25))}px)`}}>
          {ans ? <PhoneOff size={26} color="#fff" /> : <Phone size={26} color="#fff" />}
        </div>
      </div>
    </div>
  );
};
