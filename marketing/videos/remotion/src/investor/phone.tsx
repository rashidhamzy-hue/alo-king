import React from 'react';
import {interpolate, useCurrentFrame} from 'remotion';
import {Bike, CheckCircle2, Gift, MapPin, Navigation} from 'lucide-react';
import {Phone3D, Pose} from '../components/Phone3D';
import {phonePose} from '../lib/pose';
import type {Timeline} from '../lib/timeline';
import {Avatar, Bubble, CallScreen, ChatList, ChatScreen, ListButton, ListSheet, ReplyButtons, VoiceBubble, WA} from './wa';
import {cue, sc, toneOf, tl, w} from './kit';
import {Crown} from '../brand/Crown';
import {C} from '../brand/tokens';

export const CAM_Z = 4.9; // 16:9: the phone is about 850 px tall
const P = (x: number, y: number, z: number, rx: number, ry: number, rz: number, s = 1): Pose => ({x, y, z, rx, ry, rz, s});
const HIDDEN = P(1.0, -3.6, 0, 0.7, -1.3, 0.25);
const R = (ry = -0.3, rx = 0.03, z = 0, y = 0.1) => P(1.02, y, z, rx, ry, 0);
const POSES: Record<string, Pose> = {
  ring: P(0, 0.08, 0.35, 0.02, -0.08, 0),
  alo: P(0, -3.8, 0, 0.8, 0.4, 0.2),
  promise: R(-0.34),
  habit: R(-0.22, 0.06),
  answer: R(-0.3),
  ways: R(-0.28),
  langs: R(-0.18, 0.06, 0.15),
  search: R(-0.32, 0.02),
  basket: R(-0.22, 0.04, 0.25),
  pay: R(-0.3, 0.02),
  track: R(-0.2, 0.06, 0.15),
  gift: R(-0.28),
  memory: R(-0.26),
  copilot: R(-0.3, 0.05),
  claim: R(-0.26),
  driverapp: R(-0.3),
};

const Small: React.FC<{children: React.ReactNode; color?: string}> = ({children, color = WA.meta}) => <div style={{fontSize: 12, color, marginTop: 2}}>{children}</div>;

const BizCard: React.FC<{at: number; head: React.ReactNode; children: React.ReactNode; width?: string}> = ({at, head, children, width = '88%'}) => (
  <Bubble at={at} width={width} pad="0 0 4px 0">
    <div style={{background: C.gold, color: C.ink, borderTopRightRadius: 8, borderTopLeftRadius: 0, padding: '7px 10px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 7}}>{head}</div>
    <div style={{padding: '6px 10px 0'}}>{children}</div>
  </Bubble>
);

const Row: React.FC<{a: React.ReactNode; b?: React.ReactNode; bold?: boolean}> = ({a, b, bold}) => (
  <div style={{display: 'flex', justifyContent: 'space-between', gap: 8, padding: '4px 0', borderBottom: '1px solid #F0F2F5', fontWeight: bold ? 700 : 400}}>
    <span>{a}</span>
    {b ? <span style={{color: WA.text, whiteSpace: 'nowrap'}}>{b}</span> : null}
  </div>
);

// ---------- chapter 3: one thread from "type" to "delivered" ----------
const OrderThread: React.FC = () => {
  const frame = useCurrentFrame();
  const typeFrom = w('ways', 'type');
  const sent = w('ways', 'voice', 0, -250);
  const menuAt = w('ways', 'tap', 0, -100);
  const tap = w('ways', 'menu');
  const typing = frame >= typeFrom && frame < sent;
  const typed = 'bade 2 shawarma w ayran';
  const n = Math.round(interpolate(frame, [typeFrom, sent - 4], [0, typed.length], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}));
  return (
    <ChatScreen
      title="Alo King"
      subtitle="business account"
      brand="customer"
      draft={typing ? typed.slice(0, n) : undefined}
      overlay={<ListSheet at={menuAt + 8} out={tap + 14} title="Menu" rows={[['Grills', 'Shish taouk, kafta'], ['Shawarma', 'Chicken, meat'], ['Manakish', 'Zaatar, cheese, kishk'], ['Drinks', 'Ayran, juices']]} tapped={1} tapAt={tap} />}
    >
      <Bubble at={-30}>Alo! What would you like today?</Bubble>
      <Bubble at={sent} me>{typed}</Bubble>
      <VoiceBubble at={w('ways', 'voice')} />
      <Bubble at={menuAt}>
        Or pick from the menu
        <ListButton label="View menu" />
      </Bubble>
      <Bubble at={tap + 12} me>Shawarma</Bubble>
      <Bubble at={w('langs', 'Arabic')} me><span style={{fontFamily: '"IBM Plex Sans Arabic"', fontSize: 16, direction: 'rtl', display: 'block'}}>بدي ٢ شاورما</span></Bubble>
      <Bubble at={w('langs', 'English')} me>and a large fries please</Bubble>
      <Bubble at={w('langs', 'French')} me>deux manakish zaatar stp</Bubble>
      <Bubble at={w('langs', 'Arabizi')} me>w 1 kahwe, ma3 sukkar</Bubble>
      <Bubble at={w('langs', 'mixed')} me>deux manakish w ayran 😋</Bubble>
      <Bubble at={w('search', 'smart')} me>bade shi 7arr w rkhis</Bubble>
      <BizCard at={w('search', 'searches')} head={<>🔎 Matches near you</>}>
        <Row a="Spicy chicken shawarma" b="Grill · Baakline" />
        <Row a="Spicy potato wrap" b="Snack · Deir el Qamar" />
        <Row a="Manoushe with chili" b="Bakery · Semqanieh" />
      </BizCard>
      <BizCard at={w('basket', 'basket')} head={<><Crown size={20} color={C.ink} /> Your basket</>}>
        <Row a="2 × Chicken shawarma" />
        <Row a="1 × Large fries" />
        <Row a="2 × Ayran" />
        <Row a="Total" b="$12.50" bold />
        <Small>= 1,118,750 LBP · rate 89,500, locked at order</Small>
      </BizCard>
      <ReplyButtons at={w('basket', 'basket') + 6} labels={['✅ Confirm', '✏️ Change']} pick={0} pickAt={cue('confirmTap')} />
      <Bubble at={w('pay', 'pay', 0, -300)}>How would you like to pay?</Bubble>
      <ReplyButtons at={w('pay', 'pay', 0, -200)} labels={['💵 Cash on delivery', '💳 Pay with Whish']} pick={1} pickAt={cue('payWhish')} />
      <BizCard at={cue('payWhish') + 10} head={<>💳 Whish payment link</>}>
        <Row a="Alo King order" b="$12.50" />
        <div style={{color: WA.link, fontWeight: 500, padding: '6px 0 2px'}}>Tap to pay securely</div>
      </BizCard>
      <Bubble at={w('track', 'track')}>
        <span style={{display: 'flex', alignItems: 'center', gap: 6, fontWeight: 500}}><CheckCircle2 size={16} color={WA.green} /> Paid · order accepted</span>
        <Small>The kitchen is on it.</Small>
      </Bubble>
      <Bubble at={w('track', "driver's", 0, -200)}>
        <span style={{display: 'flex', alignItems: 'center', gap: 6, fontWeight: 500}}><Bike size={16} color={WA.green} /> On the way</span>
        <Small>Ali is sharing his live location with you.</Small>
      </Bubble>
      <LiveLocation at={w('track', 'live')} />
    </ChatScreen>
  );
};

const LiveLocation: React.FC<{at: number}> = ({at}) => {
  const frame = useCurrentFrame();
  const t = Math.max(0, frame - at);
  return (
    <Bubble at={at} width={232} pad="3px 3px 3px 3px">
      <div style={{height: 120, borderRadius: 6, background: '#E8EEDB', position: 'relative', overflow: 'hidden'}}>
        <svg width="100%" height="120" style={{position: 'absolute'}}>
          <path d="M-10 90 C60 70 90 30 160 40 S260 10 300 20" stroke="#fff" strokeWidth="9" fill="none" />
          <path d="M40 -10 L80 130" stroke="#fff" strokeWidth="6" fill="none" />
          <path d="M-10 90 C60 70 90 30 160 40 S260 10 300 20" stroke="#F4D58D" strokeWidth="3" fill="none" />
        </svg>
        <div style={{position: 'absolute', left: 30 + Math.min(t, 90) * 1.4, top: 70 - Math.min(t, 90) * 0.35, width: 18, height: 18, borderRadius: 9, background: WA.green, border: '3px solid #fff', boxShadow: '0 0 0 8px rgba(0,168,132,0.2)'}} />
        <MapPin size={24} color="#E8453C" fill="#E8453C" style={{position: 'absolute', right: 34, top: 8}} />
      </div>
      <div style={{display: 'flex', alignItems: 'center', gap: 6, padding: '5px 6px 0', fontSize: 13, color: WA.text}}>
        <Navigation size={14} color={WA.green} /> Live location · Ali
      </div>
    </Bubble>
  );
};

const PhoneScreen: React.FC = () => {
  const frame = useCurrentFrame();
  const cur = tl.scenes.find((s) => frame >= s.from && frame < s.to) ?? tl.scenes[0];
  // The screen holds the last phone scene's content while the phone moves away.
  const shown = [...tl.scenes].reverse().find((s) => s.from <= frame && POSES[s.id])?.id ?? cur.id;
  switch (shown) {
    case 'ring':
    case 'alo':
      return <CallScreen name="Teta" answeredAt={sc('alo').from - 4} />;
    case 'promise':
      return (
        <ChatScreen title="Alo King" subtitle="business account" brand="customer">
          <Bubble at={w('promise', 'turns')}>Alo! What would you like today?</Bubble>
          <Bubble at={w('promise', 'order')} me>manoushe zaatar w kahwe please</Bubble>
          <Bubble at={w('promise', 'essentials')} me>w ghaloun may 💧</Bubble>
        </ChatScreen>
      );
    case 'habit':
      return (
        <ChatList
          rows={[
            {name: 'Family', msg: 'Voice message (0:34)', time: '12:01', unread: 3, voice: true, tint: '#8FB8AE'},
            {name: 'Mom', msg: 'jebli ghaloun may please', time: '11:58', unread: 1, tint: '#D4A5A5'},
            {name: 'Water delivery', msg: 'tamem, 2 ghaloun 3al 5', time: '11:40', tint: '#8BB4D9'},
            {name: 'Gas cylinder', msg: 'ba3atlak el jarra ba3d el dohr', time: '10:12', tint: '#C9B27C'},
            {name: 'Teta', msg: 'Voice message (1:02)', time: '09:30', unread: 2, voice: true, tint: '#B39DDB'},
            {name: 'Cousins', msg: 'mnetla2a 3al 8? 😂', time: 'Yesterday', tint: '#A5C9A1'},
            {name: 'Building committee', msg: 'Generator schedule this week', time: 'Yesterday', tint: '#BDBDBD'},
          ]}
        />
      );
    case 'answer':
      return (
        <ChatScreen title="Alo King" subtitle="business account" brand="customer">
          <Bubble at={w('answer', 'King')} me>hi</Bubble>
          <Bubble at={w('answer', 'No', 0, -100)}>Alo! I'm Alo King. Order food and essentials right here, in Arabic, English, French or Arabizi.</Bubble>
          <ReplyButtons at={w('answer', 'No', 0, 100)} labels={['🛒 Order', '📦 My order', '👤 A person']} pick={0} pickAt={w('answer', 'chat')} />
        </ChatScreen>
      );
    case 'ways':
    case 'langs':
    case 'search':
    case 'basket':
    case 'pay':
    case 'track':
      return <OrderThread />;
    case 'gift':
      return (
        <ChatScreen title="Alo King" subtitle="business account" brand="customer">
          <Bubble at={sc('gift').from - 20} me>Send Home: manakish breakfast for Mom 🎂</Bubble>
          <BizCard at={w('gift', 'schedule')} head={<><Gift size={17} /> Send Home</>}>
            <Row a="For" b="Mom · Baakline" />
            <Row a="When" b="Sat 9:00 Lebanon" />
            <Small>= 2:00 Montréal time</Small>
            <Row a="Gift note" b="Happy birthday, Mama ❤️" />
            <Row a="Paid by card" b="✓" />
          </BizCard>
          <Bubble at={w('gift', 'follow')}>
            <span style={{fontWeight: 500}}>🛵 On its way to Mom</span>
            <Small>We'll tell you when it's delivered.</Small>
          </Bubble>
        </ChatScreen>
      );
    case 'memory':
      return (
        <ChatScreen title="Alo King" subtitle="business account" brand="customer">
          <Bubble at={sc('memory').from} me>what do you remember about me?</Bubble>
          <BizCard at={w('memory', 'remembers', 0, 150)} head={<>🧠 What I remember</>}>
            <MemRow at={w('memory', 'usual')} k="Usual order" v="2 chicken shawarma, ayran" del={cue('memDelete')} />
            <MemRow at={w('memory', 'addresses')} k="Addresses" v="Home · Baakline" />
            <MemRow at={w('memory', 'language')} k="Language" v="Arabizi and English" />
            <MemRow at={w('memory', 'preferences')} k="You asked for" v="gluten-free" />
          </BizCard>
        </ChatScreen>
      );
    case 'copilot':
      return (
        <ChatScreen title="Alo King for business" subtitle="your shop's assistant" brand="merchant">
          <Bubble at={w('copilot', 'copilot')} me><span style={{fontFamily: '"IBM Plex Sans Arabic"', fontSize: 16, direction: 'rtl', display: 'block'}}>خلصت الكنافة</span></Bubble>
          <Bubble at={w('copilot', 'availability')}>Mark <b>Knefe</b> as sold out until tomorrow's opening?</Bubble>
          <ReplyButtons at={w('copilot', 'availability', 0, 150)} labels={['✅ Confirm', 'Cancel']} pick={0} pickAt={w('copilot', 'confirms', 0, -150)} />
          <VoiceBubble at={w('copilot', 'voice')} seconds="0:04" />
          <Bubble at={w('copilot', 'changes')}>Close at <b>11:00 pm</b> from today? Nothing changes until you confirm.</Bubble>
          <ReplyButtons at={w('copilot', 'changes', 0, 150)} labels={['✅ Confirm', 'Cancel']} />
        </ChatScreen>
      );
    case 'claim':
      return (
        <ChatScreen title="Alo King for business" subtitle="business account" brand="merchant">
          <Bubble at={sc('claim').from - 10} me>join</Bubble>
          <Bubble at={w('claim', 'owner', 0, -200)}>Is this your shop? <b>Grill · Baakline</b></Bubble>
          <ReplyButtons at={w('claim', 'owner')} labels={["Yes, it's mine"]} pick={0} pickAt={w('claim', 'claims')} />
          <Bubble at={w('claim', 'code')}>We sent a 6-digit code to the shop's own phone. Type it here.</Bubble>
          <Bubble at={w('claim', 'phone', 0, 300)} me>482 913</Bubble>
          <Bubble at={w('claim', 'approves')}>✅ Verified. Your draft menu is ready: 4 sections.</Bubble>
          <ReplyButtons at={w('claim', 'menu')} labels={['Approve: Grills', 'Review prices']} pick={0} pickAt={w('claim', 'live', 0, -300)} />
        </ChatScreen>
      );
    case 'driverapp':
      return (
        <ChatScreen title="Alo King for business" subtitle="driver jobs" brand="merchant">
          <BizCard at={w('driverapp', 'Drivers')} head={<>🛵 New job</>}>
            <Row a="Pick up" b="Grill · Baakline" />
            <Row a="Drop" b="Semqanieh" />
            <Row a="Cash to collect" b="$12.50" />
          </BizCard>
          <ReplyButtons at={w('driverapp', 'WhatsApp')} labels={['Accept', 'Decline']} pick={0} pickAt={w('driverapp', 'link', 0, -200)} />
          <Bubble at={w('driverapp', 'link')}>Open your driver link to share your position during the job.<ListButton label="Open driver link" /></Bubble>
          <ReplyButtons at={w('driverapp', 'proof')} labels={['📸 Delivered: add photo', '🔢 Enter delivery code']} />
        </ChatScreen>
      );
    default:
      return <div style={{position: 'absolute', inset: 0, background: WA.wall}} />;
  }
};

const MemRow: React.FC<{at: number; k: string; v: string; del?: number}> = ({at, k, v, del}) => {
  const frame = useCurrentFrame();
  if (frame < at) return null;
  const gone = del !== undefined && frame >= del;
  return (
    <div style={{display: 'flex', alignItems: 'center', gap: 6, padding: '5px 0', borderBottom: '1px solid #F0F2F5', opacity: gone ? 0.35 : 1, textDecoration: gone ? 'line-through' : 'none'}}>
      <div style={{flex: 1}}>
        <div style={{fontSize: 11.5, color: WA.meta}}>{k}</div>
        <div style={{fontWeight: 500}}>{v}</div>
      </div>
      <span style={{fontSize: 11.5, color: gone ? WA.meta : '#E8453C', border: `1px solid ${gone ? '#ccc' : '#F3B3AE'}`, borderRadius: 6, padding: '2px 6px'}}>{gone ? 'deleted' : 'Delete'}</span>
    </div>
  );
};

export const PhoneLayer: React.FC = () => {
  const frame = useCurrentFrame();
  const pose = phonePose(tl as unknown as Timeline, frame, POSES, HIDDEN);
  const cur = tl.scenes.find((s) => frame >= s.from && frame < s.to) ?? tl.scenes[0];
  const ringing = frame < sc('alo').from - 4;
  const shake = ringing ? 0.025 * Math.sin(frame * 1.7) * (Math.floor(frame / 20) % 2) : 0;
  if (pose.y < -3.3 && !POSES[cur.id]) return null;
  return (
    <Phone3D pose={{...pose, rz: pose.rz + shake}} tone={toneOf(cur.chapter)} camZ={CAM_Z}>
      <PhoneScreen />
    </Phone3D>
  );
};

export {Avatar};
