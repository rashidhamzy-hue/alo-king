import React from 'react';
import {interpolate, useCurrentFrame} from 'remotion';
import {
  BookOpenCheck, CheckCircle2, Database, Lock, Map as MapIcon, Megaphone, Rocket, ShieldCheck, Sparkles, Store, Wallet,
  Gift, UtensilsCrossed, Layers,
} from 'lucide-react';
import {C, T} from '../brand/tokens';
import {Crown} from '../brand/Crown';
import {Chip, COL, Count, Headline, Node, sc, Shot, Sub, useSp, w, SPR} from './kit';
import {ShoufMap} from './scenesB';

const night = 'night' as const;

/** 8 · the database */
export const DatabaseCh: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <>
      <Shot from="db">
        <div style={{position: 'absolute', left: 960 - 110, top: 300, width: 220, height: 220, borderRadius: 60, background: C.gold, display: 'grid', placeItems: 'center', boxShadow: '0 0 90px rgba(244,182,60,0.55)', transform: `scale(${useSp(sc('db').from + 4, SPR.bouncy)})`}}>
          <Database size={120} color={C.ink} />
        </div>
        <Headline text="One source of truth." at={w('db', 'single')} tone={night} size={100} y={600} x={0} width={1920} align="center" />
      </Shot>
      <Shot from="dbstack">
        <Headline text="What's inside" at={sc('dbstack').from + 4} tone={night} size={84} y={190} />
        {[
          ['thousand', <MapIcon size={32} key="a" />, '2,000+ places', 'across Lebanon, in Arabic, English, French and Arabizi spellings'],
          ['dishes', <UtensilsCrossed size={32} key="b" />, '203 Lebanese dishes', 'ingredients, allergens and estimated nutrition'],
          ['versioned', <Layers size={32} key="c" />, 'Versioned menus', 'a changed price re-prices the basket before checkout'],
          ['engine', <ShieldCheck size={32} key="d" />, 'Race-tested order engine', 'concurrent orders race-tested in CI'],
        ].map(([word, icon, t, s], i) => (
          <Node key={i} at={w('dbstack', word as string)} x={120 + (i % 2) * 860} y={340 + Math.floor(i / 2) * 230} w={820} tone={night} hot={i === ['thousand', 'dishes', 'versioned', 'engine'].filter((x) => frame >= w('dbstack', x)).length - 1} icon={icon as React.ReactNode} title={t as string} sub={s as string} size={34} />
        ))}
      </Shot>
      <Shot from="ledger">
        <Headline text="Every dollar, on the ledger." at={sc('ledger').from + 4} tone={night} size={92} y={190} width={1680} />
        <Ledger />
      </Shot>
    </>
  );
};

const Ledger: React.FC = () => {
  const frame = useCurrentFrame();
  const rows: [string, string, string, string][] = [
    ['payment', 'Customer payment · order A27', '+$12.50', '+1,118,750 LBP'],
    ['fee', 'Alo King order fee', '−$1.00', '−89,500 LBP'],
    ['refund', 'Refund · missing ayran', '−$1.00', '−89,500 LBP'],
    ['ledger', 'Merchant settlement', '−$10.50', '−939,750 LBP'],
  ];
  return (
    <div style={{position: 'absolute', left: COL.left, top: 360, width: 1680, fontFamily: T.latin}}>
      {rows.map(([word, label, usd, lbp], i) => {
        const s = useSp(w('ledger', word), SPR.snappy);
        if (frame < w('ledger', word)) return null;
        return (
          <div key={i} style={{display: 'grid', gridTemplateColumns: '70px 1fr 240px 340px', alignItems: 'center', gap: 20, padding: '22px 30px', marginBottom: 12, borderRadius: 22, background: C.ink2, border: '1.5px solid rgba(248,241,231,0.08)', color: C.textNight, fontSize: 34, fontWeight: 700, opacity: s, transform: `translateY(${(1 - s) * 30}px)`}}>
            <Lock size={30} color={C.gold} />
            <span>{label}</span>
            <span style={{textAlign: 'right', color: usd.startsWith('+') ? C.okNight : C.textNight}}>{usd}</span>
            <span style={{textAlign: 'right', color: C.muteNight}}>{lbp}</span>
          </div>
        );
      })}
      <div style={{display: 'flex', gap: 16, marginTop: 20}}>
        <Chip at={w('ledger', 'appendonly')} tone={night} hot>Append-only: nothing is edited</Chip>
        <Chip at={w('ledger', 'lira')} tone={night}>Dollars and lira at the locked rate</Chip>
        <Chip at={w('ledger', 'lira', 0, 500)} tone={night}>Balances are views</Chip>
      </div>
    </div>
  );
};

/** 9 · the business model: the dated launch price table (DECISIONS §20.4, §29.1). */
export const Business: React.FC = () => {
  const frame = useCurrentFrame();
  const cards: [string, React.ReactNode, string, string, string][] = [
    ['flat', <Store size={32} key="a" />, 'Order fee', '$1.00', 'per delivered meal · groceries 2.5%, $1–3'],
    ['promotions', <Megaphone size={32} key="b" />, 'Paid broadcast', '$0.08', 'per delivered message · opted-in customers only'],
    ['sponsored', <Sparkles size={32} key="c" />, 'Sponsored placement', '$0.40', 'per delivered order it brings'],
    ['service', <Gift size={32} key="d" />, 'Send Home', '$1.50', 'service fee per order, paid by the sender'],
  ];
  const cost = useSp(w('cost', 'fifteen'), SPR.soft);
  return (
    <>
      <Shot from="revenue">
        <Headline text="How we earn" at={sc('revenue').from + 4} tone={night} size={92} y={190} />
        {cards.map(([word, icon, t, price, sub], i) => {
          const s = useSp(w('revenue', word), SPR.bouncy);
          if (frame < w('revenue', word)) return null;
          return (
            <div key={i} style={{position: 'absolute', left: 120 + i * 425, top: 380, width: 395, height: 420, borderRadius: 32, background: C.ink2, border: '1.5px solid rgba(248,241,231,0.1)', padding: 32, fontFamily: T.latin, color: C.textNight, transform: `translateY(${(1 - s) * 50}px)`, opacity: s}}>
              <div style={{width: 64, height: 64, borderRadius: 20, background: 'rgba(244,182,60,0.14)', color: C.gold, display: 'grid', placeItems: 'center'}}>{icon}</div>
              <div style={{fontSize: 32, fontWeight: 800, marginTop: 24}}>{t}</div>
              <div style={{fontSize: 92, fontWeight: 800, letterSpacing: '-0.04em', color: C.gold, marginTop: 8}}>{price}</div>
              <div style={{fontSize: 24, fontWeight: 600, color: C.muteNight, marginTop: 8, lineHeight: 1.3}}>{sub}</div>
            </div>
          );
        })}
        <Sub text="Launch prices from our dated price table; they change by config, not code." at={w('revenue', 'service', 0, 600)} tone={night} y={840} size={26} width={1680} />
      </Shot>
      <Shot from="cost">
        <Headline text="About $0.15 to serve an order." at={sc('cost').from + 4} tone={night} size={88} y={200} width={1680} />
        <div style={{position: 'absolute', left: COL.left, top: 420, fontFamily: T.latin, color: C.textNight}}>
          <div style={{display: 'flex', alignItems: 'center', gap: 24, marginBottom: 26}}>
            <div style={{width: 360, fontSize: 34, fontWeight: 800}}>Order fee</div>
            <div style={{width: 1000 * cost, height: 80, borderRadius: 16, background: C.gold}} />
            <div style={{fontSize: 48, fontWeight: 800}}>$1.00</div>
          </div>
          <div style={{display: 'flex', alignItems: 'center', gap: 24}}>
            <div style={{width: 360, fontSize: 34, fontWeight: 800, color: C.muteNight}}>Variable cost</div>
            <div style={{width: 150 * cost, height: 80, borderRadius: 16, background: C.muteNight}} />
            <div style={{fontSize: 48, fontWeight: 800, color: C.muteNight}}>≈ $0.15</div>
          </div>
          <div style={{display: 'flex', gap: 16, marginTop: 34}}>
            <Chip at={w('cost', 'WhatsApp')} tone={night}>WhatsApp messages ≈ $0.12</Chip>
            <Chip at={w('cost', 'AI')} tone={night}>AI ≈ $0.015</Chip>
            <Chip at={w('cost', 'included')} tone={night} hot>Measured from day one in a cost ledger</Chip>
          </div>
        </div>
      </Shot>
    </>
  );
};

/** 10 · where we are */
export const Status: React.FC = () => {
  const frame = useCurrentFrame();
  const lit = interpolate(frame, [w('shouf', 'Shouf'), w('shouf', 'sixty')], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return (
    <>
      <Shot from="shouf">
        <Headline text="Starting in the Shouf." at={sc('shouf').from + 4} tone={night} size={88} y={200} />
        <div style={{position: 'absolute', left: COL.left, top: 390, display: 'flex', flexDirection: 'column', gap: 26, fontFamily: T.latin, color: C.textNight}}>
          {[
            ['fourteen', 314, 'merchants already listed'],
            ['twelve', 12, 'shop villages'],
            ['sixty', 61, 'villages in the delivery zone'],
          ].map(([word, n, label]) => (
            <div key={label as string} style={{display: 'flex', alignItems: 'baseline', gap: 22, opacity: useSp(w('shouf', word as string))}}>
              <span style={{fontSize: 110, fontWeight: 800, letterSpacing: '-0.04em', color: C.gold, minWidth: 260}}>
                <Count to={n as number} at={w('shouf', word as string)} dur={24} />
              </span>
              <span style={{fontSize: 36, fontWeight: 700}}>{label}</span>
            </div>
          ))}
        </div>
        <ShoufMap x={960} y={150} scale={0.8} tone={night} lit={lit} />
      </Shot>
      <Shot from="built">
        <Headline text="Built, and tested end to end." at={sc('built').from + 4} tone={night} size={88} y={190} width={1680} />
        <div style={{position: 'absolute', left: COL.left, top: 360, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '18px 60px', width: 1680}}>
          {[
            'WhatsApp ordering bot, four languages',
            'Order engine and merchant notifications',
            'Claims, smart menus, dish library',
            'Customer agent with memory',
            'Merchant copilot',
            'Send Home gift orders',
            'Ledger in dollars and lira',
            'Website with the live delivery map',
          ].map((t, i) => (
            <div key={t} style={{display: 'flex', alignItems: 'center', gap: 16, fontFamily: T.latin, fontSize: 34, fontWeight: 700, color: C.textNight, opacity: useSp(w('built', 'built') + i * 4)}}>
              <CheckCircle2 size={34} color={C.okNight} /> {t}
            </div>
          ))}
        </div>
        <div style={{position: 'absolute', left: COL.left, top: 760}}>
          <Chip at={w('built', 'simulator')} tone={night} hot size={34}><BookOpenCheck size={30} /> Simulator: 11 of 11 conversation scenarios pass</Chip>
        </div>
      </Shot>
      <Shot from="next">
        <Headline text="What comes next" at={sc('next').from + 4} tone={night} size={88} y={200} />
        {[
          ['five', <Rocket size={32} key="a" />, 'Pilot', 'first 5 merchants live, cash on delivery'],
          ['online', <Wallet size={32} key="b" />, 'Online payments', 'Whish and card, on the lawyer’s sign-off'],
          ['growth', <Megaphone size={32} key="c" />, 'Growth', 'paid ads at 15 live merchants and proven reliability'],
        ].map(([word, icon, t, s], i) => (
          <Node key={i} at={w('next', word as string)} x={120 + i * 570} y={420} w={540} tone={night} hot={i === 0} icon={icon as React.ReactNode} title={t as string} sub={s as string} size={34} />
        ))}
      </Shot>
    </>
  );
};

/** 11 · close */
export const Close: React.FC = () => {
  const frame = useCurrentFrame();
  const a = sc('close').from;
  const alo = useSp(a + 4, SPR.bouncy);
  const king = useSp(w('close', 'King'), SPR.soft);
  const crown = interpolate(frame, [w('close', 'King'), w('close', 'King') + 24], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const talk = useSp(w('close', 'order', 0, 500), SPR.bouncy);
  if (frame < a - 2) return null;
  return (
    <div style={{position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingBottom: 140}}>
      <div style={{display: 'flex', alignItems: 'center', gap: 50}}>
        <div style={{fontFamily: T.arabic, fontWeight: 700, fontSize: 240, color: C.gold, lineHeight: 1, textShadow: `0 0 ${60 * alo}px rgba(244,182,60,0.6)`, transform: `scale(${0.7 + 0.3 * alo})`, direction: 'rtl'}}>ألو</div>
        <div style={{opacity: king, transform: `translateX(${(1 - king) * 40}px)`}}>
          <Crown size={150} color={C.gold} draw={crown} />
          <div style={{fontFamily: T.latin, fontWeight: 800, fontSize: 150, letterSpacing: '-0.045em', color: C.textNight, lineHeight: 0.95}}>Alo King</div>
        </div>
      </div>
      <div style={{marginTop: 60, fontFamily: T.latin, fontWeight: 700, fontSize: 40, color: C.muteNight, opacity: king}}>Food and essentials, ordered in a WhatsApp chat.</div>
      <div style={{marginTop: 50, padding: '26px 60px', borderRadius: 999, background: C.gold, color: C.ink, fontFamily: T.latin, fontWeight: 800, fontSize: 54, transform: `scale(${0.7 + 0.3 * talk})`, opacity: talk, boxShadow: '0 0 0 12px rgba(244,182,60,0.16), 0 0 60px rgba(244,182,60,0.45)'}}>Let's talk.</div>
    </div>
  );
};
