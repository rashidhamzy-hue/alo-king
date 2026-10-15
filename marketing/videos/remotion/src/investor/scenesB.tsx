import React from 'react';
import {interpolate, useCurrentFrame} from 'remotion';
import {
  AlarmClock, Bike, BookOpen, BrainCircuit, Camera, Church, ClipboardCheck, Cross, DoorOpen, Hand, KeyRound, ListChecks,
  MapPin, MessageCircle, MonitorSmartphone, Navigation, PhoneCall, Printer, Receipt, School, ShieldCheck, Sparkles, Store,
  Truck, UserRound, Users, Wallet, Wrench, Zap,
} from 'lucide-react';
import {C, T} from '../brand/tokens';
import {MAP_H, MAP_W, NEAR_D, ZONE} from '../brand/chouf';
import {Chip, COL, Edge, Headline, Node, sc, Shot, Sub, Traveller, useSp, w, SPR, Tone} from './kit';

const night = 'night' as const;
const day = 'day' as const;

/** 5 · the brain, memory and agents */
export const Brain: React.FC = () => {
  const frame = useCurrentFrame();
  const orbit = frame * 0.02;
  return (
    <>
      <Shot from="brain">
        <div style={{position: 'absolute', left: 960 - 170, top: 360 - 170, width: 340, height: 340, borderRadius: '50%', background: 'radial-gradient(circle, rgba(244,182,60,0.35), rgba(244,182,60,0) 70%)'}} />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} style={{position: 'absolute', left: 960 + Math.cos(orbit + i * 1.05) * 230 - 9, top: 360 + Math.sin(orbit + i * 1.05) * 120 - 9, width: 18, height: 18, borderRadius: 9, background: C.gold, opacity: 0.7}} />
        ))}
        <div style={{position: 'absolute', left: 960 - 80, top: 360 - 80, width: 160, height: 160, borderRadius: 80, background: C.gold, display: 'grid', placeItems: 'center', boxShadow: '0 0 80px rgba(244,182,60,0.6)'}}>
          <BrainCircuit size={96} color={C.ink} />
        </div>
        <Headline text="The Alo King brain" at={sc('brain').from + 6} tone={night} size={110} y={600} x={0} width={1920} align="center" />
      </Shot>
      <Shot from="paths">
        <Headline text="Fast where it can be. Smart where it must be." at={sc('paths').from + 4} tone={night} size={64} y={190} width={1680} />
        {/* Lane 1: taps and commands, deterministic. */}
        <Node at={w('paths', 'Taps')} x={120} y={360} w={420} tone={night} icon={<Hand size={30} />} title="Taps & commands" sub="buttons, lists, “sold out”" />
        <Edge d="M 550 420 L 1180 420" at={w('paths', 'commands')} tone={night} />
        <Traveller d="M 550 420 L 1180 420" at={w('paths', 'instant')} period={22} />
        <Node at={w('paths', 'instant')} x={1190} y={360} w={610} tone={night} hot icon={<Zap size={30} />} title="0 AI calls" sub="rules + database · instant, nearly free" />
        {/* Lane 2: free text and voice, one model call. */}
        <Node at={w('paths', 'Free', 1)} x={120} y={620} w={420} tone={night} icon={<MessageCircle size={30} />} title="Free text & voice" sub="“bade shi 7arr w rkhis”" />
        <Edge d="M 550 680 L 1180 680" at={w('paths', 'text', 0)} tone={night} />
        <Traveller d="M 550 680 L 1180 680" at={w('paths', 'model')} period={50} />
        <Node at={w('paths', 'one')} x={1190} y={620} w={610} tone={night} icon={<Sparkles size={30} />} title="≤ 1 model call" sub="then typed tools do the work" />
      </Shot>
      <Shot from="tools">
        <Headline text="No invented prices." at={sc('tools').from + 4} tone={night} size={96} y={200} />
        <Node at={w('tools', 'AI')} x={120} y={420} w={420} tone={night} icon={<BrainCircuit size={30} />} title="The AI" sub="chooses a tool" />
        {[
          ['search catalogue', 'item'],
          ['quote basket', 'fee'],
          ['place order', 'time'],
          ['track order', 'database'],
          ['hand to a person', 'typed'],
        ].map(([label, word], i) => (
          <React.Fragment key={label}>
            <Edge d={`M 550 480 C 640 480 640 ${330 + i * 100} 720 ${330 + i * 100}`} at={w('tools', word)} tone={night} width={3} />
            <div style={{position: 'absolute', left: 730, top: 300 + i * 100}}>
              <Chip at={w('tools', word)} tone={night} size={28}><Wrench size={22} /> {label}</Chip>
            </div>
          </React.Fragment>
        ))}
        <Edge d="M 1130 520 L 1300 520" at={w('tools', 'database')} tone={night} />
        <Node at={w('tools', 'database')} x={1310} y={430} w={490} tone={night} hot icon={<ShieldCheck size={30} />} title="Our database" sub="every item, price, fee and time" />
        <div style={{position: 'absolute', left: 1310, top: 640, width: 490}}>
          <Chip at={w('tools', 'invents')} tone={night} style={{textDecoration: 'line-through', opacity: 0.7}}>“about $5, I think”</Chip>
        </div>
      </Shot>
      <Shot from="memory">
        <Headline text="It remembers. They control it." at={sc('memory').from + 4} tone={night} size={92} y={230} />
        <Sub text="Memory lives in our database as dated facts, never in a prompt. Used only to help that customer order: never for marketing, and never shared with merchants beyond what an order needs." at={w('memory', 'see')} tone={night} y={480} size={32} />
      </Shot>
      <Shot from="copilot">
        <Headline text="A copilot for every shop." at={sc('copilot').from + 4} tone={night} size={92} y={230} />
        <div style={{position: 'absolute', left: COL.left, top: 460, display: 'flex', flexWrap: 'wrap', gap: 16, width: 760}}>
          <Chip at={w('copilot', 'availability')} tone={night}>Availability</Chip>
          <Chip at={w('copilot', 'prices')} tone={night}>Prices</Chip>
          <Chip at={w('copilot', 'hours')} tone={night}>Hours</Chip>
          <Chip at={w('copilot', 'offers')} tone={night}>Offers</Chip>
          <Chip at={w('copilot', 'voice')} tone={night}>🎙 By text or voice</Chip>
        </div>
        <div style={{position: 'absolute', left: COL.left, top: 650}}>
          <Chip at={w('copilot', 'nothing')} tone={night} hot size={34}>Nothing changes without the owner's tap</Chip>
        </div>
      </Shot>
      <Shot from="learn">
        <Headline text="It learns Lebanese." at={sc('learn').from + 4} tone={night} size={100} y={200} x={0} width={1920} align="center" />
        <LearnLoop />
      </Shot>
    </>
  );
};

const LearnLoop: React.FC = () => {
  const steps: [string, string, React.ReactNode, number, number][] = [
    ['Voice note', '“ta2ouk w batata”', <MessageCircle size={30} key="a" />, 300, 420],
    ['Correction', 'customer: “no, two”', <ClipboardCheck size={30} key="b" />, 780, 420],
    ['Dictionary', 'ta2ouk → طاووق', <BookOpen size={30} key="c" />, 1260, 420],
    ['Next note', 'understood first time', <Sparkles size={30} key="d" />, 780, 680],
  ];
  const words = ['voice', 'corrected', 'next', 'understand'];
  return (
    <>
      {steps.map(([t, s, icon, x, y], i) => (
        <Node key={t} at={w('learn', words[i])} x={x - 200} y={y} w={400} tone={night} hot={i === 3} icon={icon} title={t} sub={s} size={28} />
      ))}
      <Edge d="M 500 480 L 580 480" at={w('learn', 'corrected')} tone={night} />
      <Edge d="M 980 480 L 1060 480" at={w('learn', 'next', 0, -300)} tone={night} />
      <Edge d="M 1260 560 C 1260 700 1100 740 980 740" at={w('learn', 'next')} tone={night} />
      <Edge d="M 580 740 C 420 740 300 680 300 570" at={w('learn', 'understand')} tone={night} />
    </>
  );
};

/** 6 · the merchants engine (day tone, like the business side of the website). */
export const Merchants: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <>
      <Shot from="listed">
        <Headline text="Every shop, already listed." at={sc('listed').from + 4} tone={day} size={92} y={190} width={1680} />
        <div style={{position: 'absolute', left: COL.left, top: 360, display: 'grid', gridTemplateColumns: 'repeat(4, 400px)', gap: 26}}>
          {[
            ['Grill', 'Baakline', true],
            ['Bakery', 'Deir el Qamar', false],
            ['Sweets', 'Semqanieh', true],
            ['Grocery', 'Barouk', false],
            ['Café', 'Batloun', false],
            ['Butcher', 'Kfarhim', false],
            ['Snack', 'Bakaata', true],
            ['Bakery', 'Ain w Zain', false],
          ].map(([cat, village, menu], i) => (
            <ListingCard key={i} at={sc('listed').from + 10 + i * 4} cat={cat as string} village={village as string} menu={menu as boolean} menuAt={w('listed', 'draft')} ask={frame >= w('listed', 'listed')} />
          ))}
        </div>
      </Shot>
      <Shot from="claim">
        <Headline text="Claimed with a code." at={sc('claim').from + 4} tone={day} size={92} y={230} />
        <div style={{position: 'absolute', left: COL.left, top: 420, display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'flex-start'}}>
          <Chip at={w('claim', 'join')} tone={day}><Users size={26} /> 1 · Customers ask the shop to join</Chip>
          <Chip at={w('claim', 'code')} tone={day}><KeyRound size={26} /> 2 · Code to the shop's own phone</Chip>
          <Chip at={w('claim', 'approves')} tone={day}><ListChecks size={26} /> 3 · Menu approved section by section</Chip>
          <Chip at={w('claim', 'live')} tone={day} hot>4 · Live and taking orders</Chip>
        </div>
      </Shot>
      <Shot from="channels">
        <Headline text="Every kitchen. Every channel." at={sc('channels').from + 4} tone={day} size={84} y={170} width={1680} />
        <Channels />
      </Shot>
      <Shot from="escalate">
        <Headline text="15 · 45 · 75 seconds." at={sc('escalate').from + 4} tone={day} size={84} y={190} width={1680} />
        <Escalation />
      </Shot>
      <Shot from="fee">
        <Headline text="$1. Not 30%." at={sc('fee').from + 4} tone={day} size={130} y={190} width={1680} />
        <FeeBars />
      </Shot>
    </>
  );
};

const ListingCard: React.FC<{at: number; cat: string; village: string; menu: boolean; menuAt: number; ask: boolean}> = ({at, cat, village, menu, menuAt, ask}) => {
  const s = useSp(at, SPR.bouncy);
  const frame = useCurrentFrame();
  return (
    <div style={{height: 230, borderRadius: 26, background: C.paper, border: `1.5px solid ${C.sand}`, padding: '22px 24px', fontFamily: T.latin, color: C.ink, transform: `scale(${0.85 + 0.15 * s})`, opacity: s, position: 'relative', boxShadow: '0 20px 40px -28px rgba(23,19,26,0.4)'}}>
      <div style={{display: 'flex', alignItems: 'center', gap: 12}}>
        <div style={{width: 52, height: 52, borderRadius: 16, background: C.cream2, display: 'grid', placeItems: 'center'}}><Store size={28} /></div>
        <div>
          <div style={{fontSize: 28, fontWeight: 800}}>{cat}</div>
          <div style={{fontSize: 22, fontWeight: 600, color: C.muteCream}}>{village}</div>
        </div>
      </div>
      <div style={{marginTop: 14, fontSize: 20, fontWeight: 700, color: C.muteCream}}>Not on Alo King yet</div>
      {menu && frame >= menuAt ? <div style={{position: 'absolute', right: 18, top: 18, fontSize: 18, fontWeight: 800, background: C.gold, color: C.ink, borderRadius: 999, padding: '4px 12px'}}>draft menu</div> : null}
      <div style={{marginTop: 14, display: 'inline-block', fontSize: 21, fontWeight: 800, borderRadius: 999, padding: '8px 16px', background: ask ? C.ink : C.cream2, color: ask ? C.cream : C.muteCream}}>Ask them to join</div>
    </div>
  );
};

const Channels: React.FC = () => {
  const hub = {x: 960, y: 560};
  const items: [string, string, React.ReactNode, number, number][] = [
    ['WhatsApp order card', 'WhatsApp', <MessageCircle size={30} key="a" />, 330, 380],
    ['Tablet portal', 'tablet', <MonitorSmartphone size={30} key="b" />, 330, 640],
    ['Kitchen printer', 'printer', <Printer size={30} key="c" />, 1590, 340],
    ['Phone call', 'phone', <PhoneCall size={30} key="d" />, 1590, 560],
    ['Point of sale', 'point', <Receipt size={30} key="e" />, 1590, 780],
  ];
  return (
    <>
      {items.map(([label, word, icon, x, y]) => {
        const d = `M ${hub.x} ${hub.y} C ${(hub.x + x) / 2} ${hub.y} ${(hub.x + x) / 2} ${y} ${x} ${y}`;
        return (
          <React.Fragment key={label}>
            <Edge d={d} at={w('channels', word)} tone={day} width={3} />
            <Traveller d={d} at={w('channels', word) + 18} period={40} color={C.goldText} size={14} />
            <Node at={w('channels', word)} x={x - 210} y={y - 50} w={420} tone={day} icon={icon} title={label} size={28} />
          </React.Fragment>
        );
      })}
      <div style={{position: 'absolute', left: hub.x - 110, top: hub.y - 110, width: 220, height: 220, borderRadius: 110, background: C.ink, color: C.cream, display: 'grid', placeItems: 'center', fontFamily: T.latin, fontWeight: 800, fontSize: 34, textAlign: 'center', boxShadow: '0 0 0 14px rgba(244,182,60,0.35)'}}>
        New
        <br />
        order
      </div>
    </>
  );
};

const Escalation: React.FC = () => {
  const frame = useCurrentFrame();
  const x0 = 220;
  const x1 = 1700;
  const marks: [string, string, string, React.ReactNode][] = [
    ['0 s', 'Order sent to the primary channel', 'answer', <Store size={28} key="a" />],
    ['15 s', 'Backup channel fires', 'backup', <MessageCircle size={28} key="b" />],
    ['45 s', "Owner's phone rings", 'rings', <PhoneCall size={28} key="c" />],
    ['75 s', 'A person steps in', 'person', <UserRound size={28} key="d" />],
  ];
  const secs = [0, 15, 45, 75];
  const xs = secs.map((s) => x0 + ((x1 - x0) * s) / 75);
  const playT = interpolate(frame, [w('escalate', 'answer'), w('escalate', 'backup'), w('escalate', 'rings'), w('escalate', 'person')], [0, 15, 45, 75], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const px = x0 + ((x1 - x0) * playT) / 75;
  return (
    <>
      <div style={{position: 'absolute', left: x0, top: 520, width: x1 - x0, height: 8, borderRadius: 4, background: C.sand}} />
      <div style={{position: 'absolute', left: x0, top: 520, width: px - x0, height: 8, borderRadius: 4, background: C.ink}} />
      <div style={{position: 'absolute', left: px - 16, top: 508, width: 32, height: 32, borderRadius: 16, background: C.gold, border: `4px solid ${C.ink}`}} />
      {marks.map(([t, label, word, icon], i) => {
        const on = frame >= w('escalate', word);
        return (
          <div key={t} style={{position: 'absolute', left: xs[i] - 160, top: 380, width: 320, textAlign: 'center', fontFamily: T.latin, color: C.ink, opacity: on ? 1 : 0.35}}>
            <div style={{fontSize: 56, fontWeight: 800, letterSpacing: '-0.03em'}}>{t}</div>
            <div style={{margin: '84px auto 0', width: 64, height: 64, borderRadius: 32, background: on ? C.ink : C.cream2, color: on ? C.gold : C.muteCream, display: 'grid', placeItems: 'center'}}>{icon}</div>
            <div style={{fontSize: 28, fontWeight: 700, marginTop: 14}}>{label}</div>
          </div>
        );
      })}
      <div style={{position: 'absolute', left: x0, top: 820}}>
        <Chip at={w('escalate', 'person', 0, 400)} tone={day}><AlarmClock size={26} /> “Received” counts only when a channel acknowledges</Chip>
      </div>
    </>
  );
};

const FeeBars: React.FC = () => {
  const a = useSp(w('fee', 'flat'), SPR.soft);
  const b = useSp(w('fee', 'flat', 0, 500), SPR.soft);
  const scale = 140; // px per dollar
  return (
    <div style={{position: 'absolute', left: COL.left, top: 470, fontFamily: T.latin, color: C.ink}}>
      <div style={{fontSize: 28, fontWeight: 700, color: C.muteCream, marginBottom: 18}}>What the restaurant pays on an example $20 order</div>
      <div style={{display: 'flex', alignItems: 'center', gap: 24, marginBottom: 26}}>
        <div style={{width: 300, fontSize: 34, fontWeight: 800}}>Alo King</div>
        <div style={{width: scale * 1 * a, height: 74, borderRadius: 14, background: C.gold}} />
        <div style={{fontSize: 44, fontWeight: 800, opacity: a}}>$1.00 flat</div>
      </div>
      <div style={{display: 'flex', alignItems: 'center', gap: 24}}>
        <div style={{width: 300, fontSize: 34, fontWeight: 800, color: C.muteCream}}>App commission</div>
        <div style={{position: 'relative', width: scale * 6 * b, height: 74, borderRadius: 14, background: C.cream3}}>
          <div style={{position: 'absolute', left: 0, top: 0, width: scale * 4.4 * b, height: 74, borderRadius: 14, background: '#D9C6A6'}} />
        </div>
        <div style={{fontSize: 44, fontWeight: 800, color: C.muteCream, opacity: b}}>$4.40–$6.00</div>
      </div>
      <div style={{marginTop: 30}}>
        <Chip at={w('fee', 'thirty')} tone={day} hot>First 30 days free</Chip>
      </div>
    </div>
  );
};

/** The real delivery zone (DECISIONS §39.2), drawn from the site's map data. */
export const ShoufMap: React.FC<{x: number; y: number; scale: number; tone: Tone; lit?: number; children?: React.ReactNode}> = ({x, y, scale, tone, lit = 1, children}) => (
  <div style={{position: 'absolute', left: x, top: y, width: MAP_W * scale, height: MAP_H * scale}}>
    <svg width={MAP_W * scale} height={MAP_H * scale} viewBox={`0 0 ${MAP_W} ${MAP_H}`} style={{position: 'absolute', inset: 0, overflow: 'visible'}}>
      <path d={NEAR_D} fill={tone === 'night' ? 'rgba(248,241,231,0.03)' : 'rgba(23,19,26,0.03)'} stroke={tone === 'night' ? 'rgba(248,241,231,0.08)' : C.sand} strokeWidth={1.2} />
      {ZONE.filter((z) => z.d).map((z, i) => (
        <path key={z.slug} d={z.d} fill={z.role === 'shop_village' ? `rgba(244,182,60,${0.32 * Math.min(1, lit * 1.5 - i / 80)})` : `rgba(244,182,60,${0.1 * lit})`} stroke="rgba(244,182,60,0.45)" strokeWidth={1.4} />
      ))}
    </svg>
    {ZONE.filter((z) => z.role === 'shop_village').map((z) => (
      <div key={z.slug} style={{position: 'absolute', left: z.x * scale - 6, top: z.y * scale - 6, width: 12, height: 12, borderRadius: 6, background: C.gold, boxShadow: '0 0 0 5px rgba(244,182,60,0.16), 0 0 22px 2px rgba(244,182,60,0.55)', opacity: lit}} />
    ))}
    {children}
  </div>
);

export const placeXY = (en: string, scale: number) => {
  const z = ZONE.find((p) => p.en === en);
  if (!z) throw new Error(`no place ${en}`);
  return {x: z.x * scale, y: z.y * scale};
};

/** 7 · drivers and the dispatch brain */
export const Drivers: React.FC = () => {
  const frame = useCurrentFrame();
  const S = 0.8;
  const mx = 960;
  const my = 190;
  const shop = placeXY('Baakline', S);
  const drivers: [string, string, boolean][] = [
    ['Deir Al Qamar', 'd1', true],
    ['Semqanieh', 'd2', false],
    ['Barouk', 'd3', false],
    ['Kfarhim', 'd4', false],
  ];
  const chosen = placeXY('Deir Al Qamar', S);
  const route = `M ${chosen.x} ${chosen.y} C ${chosen.x - 40} ${chosen.y - 60} ${shop.x + 60} ${shop.y + 50} ${shop.x} ${shop.y}`;
  const drop = placeXY('Semqanieh', S);
  const route2 = `M ${shop.x} ${shop.y} C ${shop.x + 80} ${shop.y + 40} ${drop.x - 60} ${drop.y - 40} ${drop.x} ${drop.y}`;
  const tick = (frame - w('dispatch', 'checks')) % 30;
  return (
    <>
      <Shot from="modes">
        <Headline text="One system. Three fleets." at={sc('modes').from + 4} tone={night} size={92} y={200} width={1680} />
        <Node at={w('modes', "merchant's")} x={120} y={430} w={520} tone={night} icon={<Store size={30} />} title="Merchant's own driver" sub="the pilot default" />
        <Node at={w('modes', 'fleet')} x={700} y={430} w={520} tone={night} icon={<Bike size={30} />} title="Alo King fleet" sub="opens where volume pays" />
        <Node at={w('modes', 'partner')} x={1280} y={430} w={520} tone={night} icon={<Truck size={30} />} title="Partner courier" sub="switched on by config" />
        <div style={{position: 'absolute', left: 120, top: 650, width: 1680, textAlign: 'center'}}>
          <Chip at={w('modes', 'partner', 0, 500)} tone={night} hot>One adapter: quote, book, track, proof, cash</Chip>
        </div>
      </Shot>
      <Shot from="dispatch">
        <Headline text="The dispatch brain" at={sc('dispatch').from + 4} tone={night} size={92} y={230} />
        <div style={{position: 'absolute', left: COL.left, top: 420, display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'flex-start'}}>
          <Chip at={w('dispatch', 'closest')} tone={night}>Closest idle driver, by road time</Chip>
          <Chip at={w('dispatch', 'batches')} tone={night}>Batches orders that fit</Chip>
          <Chip at={w('dispatch', 'checks')} tone={night} hot>Checks every active order every 15 s</Chip>
          <Chip at={w('dispatch', 'checks', 0, 600)} tone={night}>Deterministic code, not guesswork</Chip>
        </div>
        <ShoufMap x={mx} y={my} scale={S} tone={night}>
          <Pin at={sc('dispatch').from + 6} x={shop.x} y={shop.y} label="Kitchen" />
          {drivers.map(([place, id, isChosen], i) => {
            const p = placeXY(place, S);
            const on = frame >= w('dispatch', 'closest');
            return <DriverDot key={id} at={sc('dispatch').from + 10 + i * 4} x={p.x} y={p.y} hot={on && isChosen} dim={on && !isChosen} />;
          })}
          <svg width={MAP_W * S} height={MAP_H * S} style={{position: 'absolute', inset: 0, overflow: 'visible'}}>
            {frame >= w('dispatch', 'road') ? <path d={route} stroke={C.gold} strokeWidth={5} fill="none" strokeDasharray="10 10" /> : null}
            {frame >= w('dispatch', 'batches') ? <path d={route2} stroke={C.textNight} strokeWidth={4} fill="none" strokeDasharray="6 10" opacity={0.6} /> : null}
          </svg>
          {frame >= w('dispatch', 'checks') ? (
            <div style={{position: 'absolute', left: shop.x - 200, top: shop.y - 200, width: 400, height: 400, borderRadius: 200, border: '3px solid rgba(244,182,60,0.6)', transform: `scale(${tick / 30})`, opacity: 1 - tick / 30}} />
          ) : null}
        </ShoufMap>
      </Shot>
      <Shot from="driverapp">
        <Headline text="Drivers live on WhatsApp too." at={sc('driverapp').from + 4} tone={night} size={88} y={230} />
        <div style={{position: 'absolute', left: COL.left, top: 470, display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'flex-start'}}>
          <Chip at={w('driverapp', 'WhatsApp')} tone={night}><MessageCircle size={26} /> Job offers as WhatsApp cards</Chip>
          <Chip at={w('driverapp', 'link')} tone={night}><Navigation size={26} /> Live driver link · no install</Chip>
          <Chip at={w('driverapp', 'proof')} tone={night}><Camera size={26} /> Photo, GPS and delivery code</Chip>
          <Chip at={w('driverapp', 'cash')} tone={night}><Wallet size={26} /> Cash in hand tracked per driver</Chip>
        </div>
      </Shot>
      <Shot from="learnmap">
        <Headline text="The map learns." at={sc('learnmap').from + 4} tone={night} size={100} y={230} />
        <div style={{position: 'absolute', left: COL.left, top: 460, display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'flex-start'}}>
          <Chip at={w('learnmap', 'landmarks')} tone={night}><Church size={26} /> Landmarks</Chip>
          <Chip at={w('learnmap', 'door')} tone={night}><DoorOpen size={26} /> Door points</Chip>
          <Chip at={w('learnmap', 'kitchen')} tone={night}><AlarmClock size={26} /> Real kitchen times</Chip>
        </div>
        <ShoufMap x={mx} y={my} scale={S} tone={night}>
          {[
            ['Baakline', <Cross size={20} key="a" />],
            ['Deir Al Qamar', <Church size={20} key="b" />],
            ['Semqanieh', <School size={20} key="c" />],
            ['Kfarhim', <Church size={20} key="d" />],
            ['Barouk', <Cross size={20} key="e" />],
            ['Batloun', <School size={20} key="f" />],
            ['Bakaata', <MapPin size={20} key="g" />],
          ].map(([place, icon], i) => {
            const p = placeXY(place as string, S);
            return <Landmark key={i} at={w('learnmap', 'landmarks') + i * 5} x={p.x + 18} y={p.y - 30} icon={icon as React.ReactNode} />;
          })}
        </ShoufMap>
      </Shot>
    </>
  );
};

const Pin: React.FC<{at: number; x: number; y: number; label: string}> = ({at, x, y, label}) => {
  const s = useSp(at, SPR.bouncy);
  return (
    <div style={{position: 'absolute', left: x - 70, top: y - 92, width: 140, textAlign: 'center', transform: `scale(${s})`, transformOrigin: '50% 100%', fontFamily: T.latin}}>
      <div style={{display: 'inline-block', background: C.gold, color: C.ink, fontWeight: 800, fontSize: 22, borderRadius: 999, padding: '6px 14px'}}>
        <Store size={18} style={{verticalAlign: -3}} /> {label}
      </div>
      <div style={{width: 4, height: 40, background: C.gold, margin: '0 auto'}} />
    </div>
  );
};

const DriverDot: React.FC<{at: number; x: number; y: number; hot: boolean; dim: boolean}> = ({at, x, y, hot, dim}) => {
  const s = useSp(at, SPR.bouncy);
  return (
    <div style={{position: 'absolute', left: x - 26, top: y - 26, width: 52, height: 52, borderRadius: 26, background: hot ? C.gold : C.ink3, border: `3px solid ${hot ? C.goldHi : 'rgba(248,241,231,0.4)'}`, display: 'grid', placeItems: 'center', transform: `scale(${s * (hot ? 1.15 : 1)})`, opacity: dim ? 0.45 : 1, boxShadow: hot ? '0 0 30px rgba(244,182,60,0.7)' : undefined}}>
      <Bike size={28} color={hot ? C.ink : C.textNight} />
    </div>
  );
};

const Landmark: React.FC<{at: number; x: number; y: number; icon: React.ReactNode}> = ({at, x, y, icon}) => {
  const s = useSp(at, SPR.bouncy);
  return <div style={{position: 'absolute', left: x - 22, top: y - 22, width: 44, height: 44, borderRadius: 22, background: C.textNight, color: C.ink, display: 'grid', placeItems: 'center', transform: `scale(${s})`, boxShadow: '0 6px 18px rgba(0,0,0,0.4)'}}>{icon}</div>;
};
