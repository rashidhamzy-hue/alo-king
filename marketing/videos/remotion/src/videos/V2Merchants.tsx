import React from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {BellRing, ChefHat, Clock3, Download, ListChecks, Store, UtensilsCrossed} from 'lucide-react';
import tl2 from '../data/v2.json';
import {C, SPRING, T} from '../brand/tokens';
import {Crown} from '../brand/Crown';
import {Backdrop, Kinetic} from '../components/Backdrop';
import {Captions} from '../components/Captions';
import {Phone3D, Pose} from '../components/Phone3D';
import {Meta, Msg, Screen, useIn} from '../components/Chat';
import {cueFrame, scene, Timeline} from '../lib/timeline';
import {phonePose} from '../lib/pose';

const tl = tl2 as Timeline;
const cue = (id: string) => cueFrame(tl, id);
const P = (x: number, y: number, z: number, rx: number, ry: number, rz: number, s = 1): Pose => ({x, y, z, rx, ry, rz, s});
const HIDDEN = P(0, -4.4, 0, 0.7, -1.4, -0.25);
const POSES: Record<string, Pose> = {
  hook: HIDDEN,
  order: P(0, 0.4, 0.22, 0.04, 0.14, 0),
  ticket: P(-0.62, 0.47, -0.6, 0.05, 0.42, 0, 0.9),
  details: P(-2.8, 0.6, -1.4, 0.2, 1.2, -0.2, 0.9),
  accept: P(0, 0.4, 0.36, 0.03, -0.12, 0),
  noapp: P(2.8, 0.7, -1.2, 0.2, -1.3, 0.25, 0.9),
  dashboard: P(0, 4.8, -1.5, -0.6, 0.7, 0),
  'dashboard-b': P(0, 4.8, -1.5, -0.6, 0.7, 0),
  cta: P(0, 4.8, -1.5, -0.6, 0.7, 0),
};

const sp = (frame: number, at: number, cfg = SPRING.snappy) => spring({frame: frame - at, fps: 30, config: cfg});

/** Hook: the chat list every customer already has open, with an order landing on top. */
const ChatList: React.FC = () => {
  const frame = useCurrentFrame();
  const sc = scene(tl, 'hook');
  if (frame > sc.to + 12) return null;
  const out = sp(frame, sc.to - 4);
  const rows = [
    ['Family', 'Teta sent a voice note', '3'],
    ['Football Sunday', 'Who is bringing the ball?', '12'],
    ['Mom', 'Call me when you land', '1'],
    ['Building committee', 'Generator schedule for this week', '5'],
    ['Work', 'See you at 9', ''],
    ['Cousins', 'Photo', '8'],
  ];
  const hit = cue('hookWord');
  const push = sp(frame, hit, SPRING.bouncy);
  return (
    <div style={{position: 'absolute', left: 80, top: 650, width: 920, opacity: 1 - out, transform: `translateY(${out * 80}px) scale(${1 + 0.05 * push})`, transformOrigin: '50% 0%'}}>
      <div style={{background: C.paper, borderRadius: 40, padding: '12px 0', boxShadow: '0 40px 90px -40px rgba(23,19,26,0.45)', border: `1px solid ${C.sand}`, overflow: 'hidden', fontFamily: T.latin}}>
        {frame >= hit ? <Row key="ak" frame={frame} at={hit} name="Alo King" text="New order from a customer" badge="1" gold /> : null}
        {rows.slice(0, frame >= hit ? 4 : 5).map(([n, t, b], i) => (
          <Row key={n} frame={frame} at={i * 3 - 6} name={n} text={t} badge={b} />
        ))}
      </div>
    </div>
  );
};

const Row: React.FC<{frame: number; at: number; name: string; text: string; badge: string; gold?: boolean}> = ({frame, at, name, text, badge, gold}) => {
  const s = sp(frame, at, gold ? SPRING.bouncy : SPRING.snappy);
  return (
    <div style={{display: 'flex', alignItems: 'center', gap: 24, padding: '14px 34px', background: gold ? C.cream2 : 'transparent', borderBottom: `1px solid ${C.sand}`, opacity: Math.min(1, s * 1.5), transform: `translateY(${(1 - s) * 40}px)`}}>
      <div style={{width: 76, height: 76, borderRadius: 38, background: gold ? C.ink : C.cream3, display: 'grid', placeItems: 'center', flexShrink: 0}}>
        {gold ? <Crown size={46} color={C.gold} /> : <span style={{fontSize: 34, fontWeight: 800, color: C.muteCream}}>{name[0]}</span>}
      </div>
      <div style={{flex: 1, minWidth: 0}}>
        <div style={{fontSize: 36, fontWeight: 800, color: C.ink}}>{name}</div>
        <div style={{fontSize: 28, fontWeight: 600, color: C.muteCream, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{text}</div>
      </div>
      {badge ? <div style={{minWidth: 44, height: 44, borderRadius: 22, padding: '0 12px', background: gold ? C.gold : C.wa, color: gold ? C.ink : '#fff', fontSize: 24, fontWeight: 800, display: 'grid', placeItems: 'center'}}>{badge}</div> : null}
    </div>
  );
};

const CustomerThread: React.FC = () => {
  const frame = useCurrentFrame();
  const tone = 'day' as const;
  return (
    <Screen tone={tone} title="Alo King" subtitle="online">
      <Msg at={0} tone={tone}>
        Alo! What would you like today?
        <Meta tone={tone} />
      </Msg>
      <Msg at={cue('orderMsg')} me tone={tone}>
        2 manakish zaatar and 1 kishk with extra cheese, please
        <Meta me tone={tone} />
      </Msg>
      {frame >= cue('newOrder') ? (
        <Msg at={cue('newOrder')} tone={tone}>
          <span style={{display: 'flex', alignItems: 'center', gap: 8}}>
            <BellRing size={18} color={C.okCream} /> Sent to the shop
          </span>
          <Meta tone={tone} />
        </Msg>
      ) : null}
    </Screen>
  );
};

const MerchantThread: React.FC = () => {
  const frame = useCurrentFrame();
  const tone = 'day' as const;
  const accepted = frame >= cue('acceptTap');
  const prep = frame >= cue('prepTap');
  const done = frame >= cue('accepted');
  const press = sp(frame, cue('acceptTap'), SPRING.bouncy);
  return (
    <Screen tone={tone} title="Alo King for business" subtitle="your orders" merchant>
      <Msg at={cue('acceptCard')} tone={tone} width="94%" pad="0">
        <div style={{borderRadius: 18, overflow: 'hidden', border: `1.5px solid ${C.ink}`}}>
          <div style={{background: C.ink, color: C.cream, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8}}>
            <BellRing size={18} color={C.gold} />
            <span style={{fontWeight: 800, fontSize: 21}}>New order · A27</span>
          </div>
          <div style={{padding: '12px 16px', fontSize: 20, lineHeight: 1.35}}>
            <div style={{fontWeight: 800}}>2× Manoushe zaatar</div>
            <div style={{fontWeight: 800}}>1× Manoushe kishk</div>
            <div style={{fontSize: 16, opacity: 0.7, marginTop: 4}}>+ extra cheese · note: no tomatoes</div>
          </div>
          {!accepted ? (
            <div style={{display: 'flex', borderTop: `1px solid ${C.sand}`}}>
              <div style={{flex: 1, textAlign: 'center', padding: '18px 0', fontSize: 20, fontWeight: 800, color: C.muteCream}}>Reject</div>
              <div style={{flex: 1.3, textAlign: 'center', padding: '18px 0', fontSize: 20, fontWeight: 800, background: C.gold, color: C.ink}}>Accept</div>
            </div>
          ) : (
            <div style={{padding: '10px 12px 12px', borderTop: `1px solid ${C.sand}`, transform: `scale(${0.96 + 0.04 * press})`}}>
              <div style={{fontSize: 16, fontWeight: 700, color: C.muteCream, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6}}>
                <Clock3 size={18} /> Prep time
              </div>
              <div style={{display: 'flex', gap: 8}}>
                {['10 min', '20 min', '30 min'].map((m, i) => (
                  <div key={m} style={{flex: 1, textAlign: 'center', padding: '14px 0', borderRadius: 12, fontSize: 18, fontWeight: 800, background: prep && i === 1 ? C.ink : C.cream2, color: prep && i === 1 ? C.cream : C.ink}}>
                    {m}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Msg>
      {done ? (
        <Msg at={cue('accepted')} tone={tone}>
          <span style={{display: 'flex', alignItems: 'center', gap: 8, color: C.okCream, fontWeight: 800, fontSize: 18}}>
            <ChefHat size={20} /> Accepted · the customer is told
          </span>
        </Msg>
      ) : null}
    </Screen>
  );
};

/** The ticket: the design system's receipt (paper, perforated edge), lines lit as the voice names them. */
const Ticket: React.FC = () => {
  const frame = useCurrentFrame();
  const a = scene(tl, 'ticket');
  const b = scene(tl, 'details');
  if (frame < cue('ticketIn') || frame > b.to + 12) return null;
  const s = sp(frame, cue('ticketIn'), SPRING.soft);
  const zoom = sp(frame, b.from, SPRING.soft);
  const out = sp(frame, b.to);
  const lit = (id: string) => frame >= cue(id);
  const line = (on: boolean, children: React.ReactNode) => (
    <div style={{padding: '10px 18px', margin: '0 -18px', borderRadius: 16, background: on ? C.gold : 'transparent', transition: 'none'}}>{children}</div>
  );
  const stamp = sp(frame, cue('kitchen'), SPRING.bouncy);
  const left = interpolate(zoom, [0, 1], [425, 260]);
  const scale = interpolate(zoom, [0, 1], [1, 1.28]);
  const perf = 'radial-gradient(circle at 14px 0, transparent 12px, #FFFDF8 13px) -14px 0 / 28px 100% repeat-x';
  return (
    <div style={{position: 'absolute', left, top: 340, width: 560, transform: `translateY(${(1 - s) * 900 + out * 60}px) scale(${scale}) rotate(${(1 - zoom) * 2.5}deg)`, transformOrigin: '50% 0%', opacity: 1 - out, fontFamily: T.latin, color: C.ink}}>
      <div style={{height: 14, background: perf}} />
      <div style={{background: C.paper, padding: '26px 40px 30px', boxShadow: '0 50px 80px -40px rgba(23,19,26,0.45)'}}>
        <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6}}>
          <div style={{display: 'flex', alignItems: 'center', gap: 12}}>
            <div style={{width: 58, height: 58, borderRadius: 29, background: C.gold, display: 'grid', placeItems: 'center'}}>
              <Crown size={36} color={C.ink} />
            </div>
            <div style={{fontWeight: 800, fontSize: 36, letterSpacing: '-0.02em'}}>Order A27</div>
          </div>
          <div style={{fontWeight: 700, fontSize: 24, color: C.muteCream}}>12:04</div>
        </div>
        <div style={{fontSize: 24, fontWeight: 600, color: C.muteCream, marginBottom: 16}}>Delivery · Baakline</div>
        <div style={{borderTop: `3px dashed ${C.sand}`, margin: '0 0 12px'}} />
        {line(lit('hiItems'), (
          <div style={{fontSize: 34, fontWeight: 800, lineHeight: 1.35}}>
            <div>2× Manoushe zaatar</div>
            <div>1× Manoushe kishk</div>
          </div>
        ))}
        {line(lit('hiOptions'), <div style={{fontSize: 30, fontWeight: 700}}>+ extra cheese</div>)}
        {line(lit('hiNotes'), (
          <div style={{fontSize: 30, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 12}}>
            <ListChecks size={30} /> Note: no tomatoes, please
          </div>
        ))}
        <div style={{borderTop: `3px dashed ${C.sand}`, margin: '14px 0 12px'}} />
        <div style={{fontSize: 24, fontWeight: 700, color: C.muteCream}}>Cash on delivery</div>
      </div>
      <div style={{height: 14, background: perf, transform: 'rotate(180deg)'}} />
      {frame >= cue('kitchen') ? (
        <div style={{position: 'absolute', right: -40, top: -50, padding: '16px 26px', borderRadius: 20, background: C.ink, color: C.cream, fontWeight: 800, fontSize: 30, display: 'flex', alignItems: 'center', gap: 12, transform: `rotate(${8 - 8 * stamp}deg) scale(${0.6 + 0.4 * stamp})`, opacity: Math.min(1, stamp * 2)}}>
          <UtensilsCrossed size={30} color={C.gold} /> Ready for the kitchen
        </div>
      ) : null}
    </div>
  );
};

const NoApp: React.FC = () => {
  const frame = useCurrentFrame();
  const sc = scene(tl, 'noapp');
  if (frame < cue('noApp') - 2 || frame > sc.to + 12) return null;
  const s = sp(frame, cue('noApp'), SPRING.bouncy);
  const strike = interpolate(frame, [cue('strike'), cue('strike') + 8], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const out = sp(frame, sc.to);
  return (
    <div style={{opacity: 1 - out}}>
      <div style={{position: 'absolute', left: 540 - 170, top: 330, width: 340, height: 340, borderRadius: 84, background: C.paper, border: `3px solid ${C.sand}`, display: 'grid', placeItems: 'center', transform: `scale(${s})`, boxShadow: '0 40px 80px -40px rgba(23,19,26,0.4)'}}>
        <Download size={170} color={C.muteCream} strokeWidth={2} />
        <div style={{position: 'absolute', left: 30, top: 160, width: 280 * strike, height: 22, borderRadius: 11, background: C.ink, transform: 'rotate(-45deg)', transformOrigin: '140px 11px', marginLeft: 0}} />
      </div>
      <Kinetic words={[['No app', cue('noApp') + 4], ['to download.', cue('noApp') + 10]]} tone="day" size={118} x={80} y={760} width={920} align="center" />
    </div>
  );
};

/** The ink "counter": one place for orders, menu and hours. */
const Counter: React.FC = () => {
  const frame = useCurrentFrame();
  const a = scene(tl, 'dashboard');
  const b = scene(tl, 'dashboard-b');
  if (frame < a.from - 2 || frame > b.to + 12) return null;
  const s = sp(frame, cue('dash'), SPRING.soft);
  const out = sp(frame, b.to);
  const tab = frame >= cue('dashHours') ? 2 : frame >= cue('dashMenu') ? 1 : 0;
  const tabAt = [cue('dash'), cue('dashMenu'), cue('dashHours')][tab];
  const ts = sp(frame, tabAt);
  const tabs = ['Orders', 'Menu', 'Hours'];
  const lit = frame >= cue('dashOrders') || tab > 0;
  const body = [
    [
      ['A27', 'Manoushe zaatar ×2, kishk', 'New', C.gold, C.ink],
      ['A26', 'Lahm bi ajeen ×4', 'Preparing', C.ink3, C.textNight],
      ['A25', 'Cheese manoushe ×3', 'Ready', 'rgba(123,211,137,0.18)', C.okNight],
      ['A24', 'Zaatar ×6', 'Delivered', 'transparent', C.muteNight],
    ],
    [
      ['', 'Manoushe zaatar', 'On', 'rgba(123,211,137,0.18)', C.okNight],
      ['', 'Manoushe kishk', 'On', 'rgba(123,211,137,0.18)', C.okNight],
      ['', 'Lahm bi ajeen', 'On', 'rgba(123,211,137,0.18)', C.okNight],
      ['', 'Cheese manoushe', 'Sold out', C.ink3, C.muteNight],
    ],
    [
      ['', 'Monday to Saturday', '7:00–14:00', 'transparent', C.textNight],
      ['', 'Sunday', '8:00–13:00', 'transparent', C.textNight],
      ['', 'Pause orders', '30 min', C.ink3, C.gold],
      ['', 'Holiday closure', 'Set dates', C.ink3, C.muteNight],
    ],
  ][tab];
  return (
    <div style={{position: 'absolute', left: 80, top: 330, width: 920, borderRadius: 48, background: C.ink, color: C.textNight, fontFamily: T.latin, padding: '44px 44px 30px', boxShadow: '0 60px 100px -50px rgba(23,19,26,0.7)', transform: `translateY(${(1 - s) * 1200 + out * 60}px)`, opacity: 1 - out}}>
      <div style={{display: 'flex', alignItems: 'center', gap: 18, marginBottom: 34}}>
        <div style={{width: 72, height: 72, borderRadius: 36, background: C.gold, display: 'grid', placeItems: 'center'}}>
          <Store size={38} color={C.ink} />
        </div>
        <div>
          <div style={{fontSize: 40, fontWeight: 800, letterSpacing: '-0.02em'}}>Your shop</div>
          <div style={{fontSize: 26, fontWeight: 600, color: C.muteNight, display: 'flex', alignItems: 'center', gap: 10}}>
            <span style={{width: 12, height: 12, borderRadius: 6, background: C.gold, boxShadow: '0 0 0 5px rgba(244,182,60,0.16), 0 0 22px 2px rgba(244,182,60,0.55)'}} /> Open, taking orders
          </div>
        </div>
      </div>
      <div style={{display: 'flex', gap: 12, marginBottom: 30, background: C.ink2, padding: 8, borderRadius: 999}}>
        {tabs.map((t, i) => (
          <div key={t} style={{flex: 1, textAlign: 'center', padding: '18px 0', borderRadius: 999, fontSize: 32, fontWeight: 800, background: i === tab && lit ? C.gold : 'transparent', color: i === tab && lit ? C.ink : C.muteNight}}>
            {t}
          </div>
        ))}
      </div>
      <div style={{opacity: ts, transform: `translateY(${(1 - ts) * 30}px)`}}>
        {body.map(([code, name, state, bg, fg], i) => (
          <div key={i} style={{display: 'flex', alignItems: 'center', gap: 20, padding: '22px 8px', borderBottom: '1px solid rgba(248,241,231,0.08)'}}>
            {code ? <div style={{fontSize: 28, fontWeight: 800, color: C.gold, width: 76}}>{code}</div> : null}
            <div style={{flex: 1, fontSize: 32, fontWeight: 700}}>{name}</div>
            <div style={{padding: '10px 22px', borderRadius: 999, background: bg, color: fg, fontSize: 26, fontWeight: 800, border: bg === 'transparent' ? `1px solid rgba(248,241,231,0.14)` : 'none'}}>{state}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

const EndCard: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const at = cue('ctaCrown');
  if (frame < at - 2) return null;
  const crown = interpolate(frame, [at, at + 24], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const disc = spring({frame: frame - at, fps, config: SPRING.bouncy});
  const word = spring({frame: frame - at - 6, fps, config: SPRING.soft});
  const btn = spring({frame: frame - cue('ctaButton'), fps, config: SPRING.bouncy});
  const pulse = 1 + 0.03 * Math.max(0, Math.sin((frame - cue('ctaButton') - 20) * 0.18));
  return (
    <AbsoluteFill style={{alignItems: 'center'}}>
      <div style={{position: 'absolute', top: 320, display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
        <div style={{width: 250, height: 250, borderRadius: 125, background: C.gold, display: 'grid', placeItems: 'center', transform: `scale(${disc})`, boxShadow: '0 30px 60px -30px rgba(133,84,0,0.6)'}}>
          <Crown size={170} color={C.ink} draw={crown} />
        </div>
        <div style={{fontFamily: T.latin, fontWeight: 800, fontSize: T.display, letterSpacing: '-0.045em', lineHeight: 0.98, color: C.ink, marginTop: 34, opacity: word, transform: `translateY(${(1 - word) * 40}px)`}}>Alo King</div>
        <div style={{fontFamily: T.latin, fontWeight: 700, fontSize: 44, color: C.muteCream, marginTop: 12, opacity: word}}>for business</div>
        <div
          style={{
            marginTop: 64,
            display: 'flex',
            alignItems: 'center',
            gap: 18,
            padding: '30px 56px',
            borderRadius: 999,
            background: C.ink,
            color: C.cream,
            fontFamily: T.latin,
            fontWeight: 800,
            fontSize: 52,
            letterSpacing: '-0.02em',
            boxShadow: '0 0 0 10px rgba(244,182,60,0.35), 0 30px 60px -30px rgba(23,19,26,0.7)',
            opacity: Math.min(1, btn * 1.5),
            transform: `scale(${(0.7 + 0.3 * btn) * pulse})`,
          }}
        >
          <Store size={52} color={C.gold} strokeWidth={2.4} />
          Claim your shop
        </div>
      </div>
    </AbsoluteFill>
  );
};

const PhoneScreens: React.FC = () => {
  const frame = useCurrentFrame();
  return frame < scene(tl, 'details').from ? <CustomerThread /> : <MerchantThread />;
};

export const V2Merchants: React.FC = () => {
  const frame = useCurrentFrame();
  const pose = phonePose(tl, frame, POSES, HIDDEN);
  const enter = useIn(0, SPRING.soft);
  const hook = scene(tl, 'hook');
  return (
    <AbsoluteFill style={{background: C.cream, overflow: 'hidden'}}>
      <Backdrop tone="day" />
      <Kinetic words={[['Already', -6], ['on WhatsApp.', cue('hookLive')]]} tone="day" size={118} x={80} y={330} width={920} exitAt={hook.to - 4} />
      <ChatList />
      <Phone3D pose={pose} tone="day" glow={enter}>
        <PhoneScreens />
      </Phone3D>
      <Ticket />
      <NoApp />
      <Counter />
      <EndCard />
      <Captions tl={tl} tone="day" />
    </AbsoluteFill>
  );
};

export const v2Timeline = tl;
