import React from 'react';
import {interpolate, useCurrentFrame} from 'remotion';
import {
  BadgeCheck, Banknote, Bike, BrainCircuit, Cake, Croissant, Database, Download, Gift, Globe2, Ham, MessageCircle,
  PackageCheck, Phone, Plane, ShieldCheck, ShoppingBasket, Store, UserPlus, Wallet,
} from 'lucide-react';
import {C, T} from '../brand/tokens';
import {Crown} from '../brand/Crown';
import {Chip, COL, Count, cue, Edge, Headline, Node, sc, Shot, Sub, Traveller, useSp, w, SPR, FW} from './kit';

const night = 'night' as const;

/** 0 · the cold open: a ringing call, then ألو lit like a shop sign, then the wordmark. */
export const ColdOpen: React.FC = () => {
  const frame = useCurrentFrame();
  const a = sc('alo').from;
  const glow = useSp(a, SPR.bouncy);
  const out = useSp(sc('promise').from, SPR.snappy);
  return (
    <>
      {frame < sc('promise').from + 14 && frame >= a - 2 ? (
        <div style={{position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', opacity: 1 - out}}>
          <div style={{textAlign: 'center', transform: `scale(${0.7 + 0.3 * glow})`}}>
            <div style={{fontFamily: T.arabic, fontWeight: 700, fontSize: 380, lineHeight: 1, color: C.gold, textShadow: `0 0 ${60 * glow}px rgba(244,182,60,0.65), 0 0 ${140 * glow}px rgba(244,182,60,0.35)`, direction: 'rtl'}}>ألو</div>
            <div style={{fontFamily: T.latin, fontWeight: 700, fontSize: 40, color: C.muteNight, marginTop: 10, letterSpacing: '0.02em'}}>Alo · how Lebanon answers the phone</div>
          </div>
        </div>
      ) : null}
      {frame < a ? <Rings /> : null}
      <Shot from="promise">
        <div style={{position: 'absolute', left: COL.left, top: 250}}>
          <Crown size={170} color={C.gold} draw={interpolate(frame, [sc('promise').from, sc('promise').from + 24], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})} />
        </div>
        <Headline text="Alo King" at={sc('promise').from + 4} tone={night} size={150} y={400} />
        <div style={{position: 'absolute', left: COL.left, top: 570, fontFamily: T.arabic, fontWeight: 700, fontSize: 64, color: C.gold, direction: 'rtl'}}>ألو كينغ</div>
        <Sub text="Food and essentials, ordered in a WhatsApp chat." at={w('promise', 'food')} tone={night} y={690} size={40} width={720} />
      </Shot>
    </>
  );
};

const Rings: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <>
      {[0, 1, 2].map((i) => {
        const t = ((frame + i * 15) % 45) / 45;
        return <div key={i} style={{position: 'absolute', left: FW / 2 - 300, top: 520 - 300, width: 600, height: 600, borderRadius: '50%', border: '3px solid rgba(0,168,132,0.6)', transform: `scale(${0.6 + t * 1.2})`, opacity: 1 - t}} />;
      })}
    </>
  );
};

/** 1 · why not another app */
export const WhyNotApp: React.FC = () => {
  const frame = useCurrentFrame();
  const dl = interpolate(frame, [w('apps', 'download'), w('apps', 'sign')], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const strike = interpolate(frame, [w('apps', 'switch'), w('apps', 'switch') + 10], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return (
    <>
      <Shot from="habit">
        <Headline text="Lebanon already orders on WhatsApp." at={sc('habit').from + 6} tone={night} size={92} y={250} />
        <div style={{position: 'absolute', left: COL.left, top: 560, display: 'flex', gap: 16, flexWrap: 'wrap', width: 760}}>
          <Chip at={w('habit', 'voice')} tone={night}>🎙 Voice notes</Chip>
          <Chip at={w('habit', 'Arabizi')} tone={night}>bade 2 manakish</Chip>
          <Chip at={w('habit', 'water')} tone={night}>💧 Water</Chip>
          <Chip at={w('habit', 'gas')} tone={night}>🔥 Gas</Chip>
        </div>
      </Shot>
      <Shot from="apps">
        <Headline text="Apps ask for more." at={sc('apps').from + 4} tone={night} size={96} y={170} />
        {/* The download-and-sign-up wall. */}
        <div style={{position: 'absolute', left: COL.left, top: 450, width: 620}}>
          <Node at={w('apps', 'download', 0, -150)} x={0} y={0} w={620} tone={night} icon={<Download size={30} />} title="Download a new app" sub={`${Math.round(dl * 100)}% · 120 MB`}>
            <div style={{height: 10, borderRadius: 5, background: 'rgba(248,241,231,0.1)', marginTop: 16}}>
              <div style={{width: `${dl * 100}%`, height: 10, borderRadius: 5, background: C.muteNight}} />
            </div>
          </Node>
          <Node at={w('apps', 'sign')} x={0} y={190} w={620} tone={night} icon={<UserPlus size={30} />} title="Create an account" sub="Email · password · card" />
          <div style={{position: 'absolute', left: -20, top: 150, width: 660 * strike, height: 12, borderRadius: 6, background: C.gold, transform: 'rotate(-8deg)', transformOrigin: '0 50%', boxShadow: '0 0 30px rgba(244,182,60,0.5)'}} />
        </div>
        {/* The commission bite, on a receipt. */}
        <Receipt at={w('apps', 'take')} />
      </Shot>
      <Shot from="shops">
        <Headline text="Village shops: just a phone." at={sc('shops').from + 4} tone={night} size={96} y={230} width={1500} />
        <div style={{position: 'absolute', left: COL.left, top: 470, display: 'flex', gap: 28}}>
          {[
            [<Croissant size={44} key="a" />, 'Bakery'],
            [<Ham size={44} key="b" />, 'Butcher'],
            [<ShoppingBasket size={44} key="c" />, 'Grocery'],
            [<Cake size={44} key="d" />, 'Sweets'],
            [<Store size={44} key="e" />, 'Café'],
          ].map(([icon, label], i) => (
            <ShopTile key={i} at={sc('shops').from + 12 + i * 5} icon={icon as React.ReactNode} label={label as string} />
          ))}
        </div>
      </Shot>
    </>
  );
};

const ShopTile: React.FC<{at: number; icon: React.ReactNode; label: string}> = ({at, icon, label}) => {
  const s = useSp(at, SPR.bouncy);
  return (
    <div style={{width: 300, height: 300, borderRadius: 36, background: C.ink2, border: '1.5px solid rgba(248,241,231,0.1)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, transform: `scale(${0.8 + 0.2 * s})`, opacity: s, color: C.textNight, fontFamily: T.latin}}>
      <div style={{color: C.muteNight}}>{icon}</div>
      <div style={{fontSize: 36, fontWeight: 800}}>{label}</div>
      <div style={{display: 'flex', alignItems: 'center', gap: 8, fontSize: 24, fontWeight: 700, color: C.gold}}>
        <Phone size={24} /> only a phone
      </div>
    </div>
  );
};

const Receipt: React.FC<{at: number}> = ({at}) => {
  const s = useSp(at - 20, SPR.soft);
  const bite = useSp(w('apps', 'percent'), SPR.bouncy);
  return (
    <div style={{position: 'absolute', left: 960, top: 230, width: 840, transform: `translateY(${(1 - s) * 60}px)`, opacity: s, fontFamily: T.latin}}>
      <div style={{background: C.paper, color: C.ink, borderRadius: 18, padding: '34px 40px', boxShadow: '0 40px 80px rgba(0,0,0,0.5)'}}>
        <div style={{fontSize: 30, fontWeight: 800, marginBottom: 16}}>Restaurant payout · example $20 order</div>
        <div style={{display: 'flex', justifyContent: 'space-between', fontSize: 32, fontWeight: 600, padding: '10px 0', borderBottom: `2px dashed ${C.sand}`}}>
          <span>Order</span>
          <span>$20.00</span>
        </div>
        <div style={{display: 'flex', justifyContent: 'space-between', fontSize: 32, fontWeight: 800, padding: '14px 0', color: '#B3261E', opacity: bite, transform: `scale(${0.9 + 0.1 * bite})`, transformOrigin: '0 50%'}}>
          <span>App commission</span>
          <span>−$4.40 to −$6.00</span>
        </div>
      </div>
      <div style={{fontFamily: T.latin, fontWeight: 800, fontSize: 150, color: C.gold, marginTop: 20, letterSpacing: '-0.04em', opacity: bite}}>22–30%</div>
    </div>
  );
};

/** 2 · one chat, one brain */
export const OneChat: React.FC = () => {
  const frame = useCurrentFrame();
  const y = 420;
  const lit = (word: string) => frame >= w('split', word);
  return (
    <>
      <Shot from="answer">
        <Headline text="No app. No sign-up. Just a chat." at={sc('answer').from + 6} tone={night} size={100} y={240} />
        <div style={{position: 'absolute', left: COL.left, top: 600, display: 'flex', gap: 16}}>
          <Chip at={w('answer', 'download')} tone={night} hot>✓ WhatsApp is already on the phone</Chip>
        </div>
      </Shot>
      <Shot from="split">
        <Node at={w('split', 'customer')} x={120} y={y} w={460} tone={night} icon={<MessageCircle size={32} />} title="The customer talks" sub="text · voice · taps" />
        <Edge d={`M 590 ${y + 60} L 720 ${y + 60}`} at={w('split', 'AI', 0, -200)} tone={night} />
        <Node at={w('split', 'AI')} x={730} y={y} w={460} tone={night} icon={<BrainCircuit size={32} />} title="The AI understands" sub="4 languages, mixed" />
        <Edge d={`M 1200 ${y + 60} L 1330 ${y + 60}`} at={w('split', 'server', 0, -200)} tone={night} />
        <Node at={w('split', 'server')} x={1340} y={y} w={460} tone={night} hot icon={<ShieldCheck size={32} />} title="Our server decides" sub="the source of truth" />
        <div style={{position: 'absolute', left: 1340, top: y + 170, width: 460, display: 'flex', flexDirection: 'column', gap: 12}}>
          {[['prices', 'Prices'], ['payments', 'Payments'], ['state', 'Every order state']].map(([k, l]) => (
            <Chip key={k} at={w('split', k)} tone={night} hot={lit(k)} style={{justifyContent: 'center'}}>{l}</Chip>
          ))}
        </div>
        <Headline text="The AI interprets. The server decides." at={sc('split').from + 4} tone={night} size={64} y={220} width={1680} />
        <Traveller d={`M 590 ${y + 60} L 720 ${y + 60} M 1200 ${y + 60} L 1330 ${y + 60}`} at={w('split', 'server')} period={50} />
      </Shot>
    </>
  );
};

/** 3 · the customer: step labels beside the phone. */
export const Customer: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <>
      <Shot from="ways">
        <Headline text="Type." at={w('ways', 'type')} tone={night} size={150} y={230} />
        <Headline text="Talk." at={w('ways', 'voice')} tone={night} size={150} y={400} />
        <Headline text="Tap." at={w('ways', 'tap')} tone={night} size={150} y={570} />
      </Shot>
      <Shot from="langs">
        <Headline text="Speaks Lebanese." at={sc('langs').from + 4} tone={night} size={100} y={230} />
        <div style={{position: 'absolute', left: COL.left, top: 420, display: 'flex', flexWrap: 'wrap', gap: 18, width: 760}}>
          <Chip at={w('langs', 'Arabic')} tone={night} hot={frame < w('langs', 'English')}><span style={{fontFamily: T.arabic}}>عربي</span> Arabic</Chip>
          <Chip at={w('langs', 'English')} tone={night} hot={frame >= w('langs', 'English') && frame < w('langs', 'French')}>English</Chip>
          <Chip at={w('langs', 'French')} tone={night} hot={frame >= w('langs', 'French') && frame < w('langs', 'Arabizi')}>Français</Chip>
          <Chip at={w('langs', 'Arabizi')} tone={night} hot={frame >= w('langs', 'Arabizi') && frame < w('langs', 'mixed')}>3arabizi</Chip>
          <Chip at={w('langs', 'mixed')} tone={night} hot={frame >= w('langs', 'mixed')}>…mixed in one message</Chip>
        </div>
      </Shot>
      <Shot from="search">
        <Headline text="One catalogue. Every shop." at={sc('search').from + 4} tone={night} size={100} y={230} />
        <Sub text="Every orderable menu that delivers to the customer, searched at once: dish, brand, Arabizi spelling, even “spicy and cheap”." at={w('search', 'searches')} tone={night} y={480} size={34} />
      </Shot>
      <Shot from="basket">
        <Headline text="Priced by the server." at={sc('basket').from + 4} tone={night} size={100} y={230} />
        <div style={{position: 'absolute', left: COL.left, top: 470, fontFamily: T.latin, color: C.textNight}}>
          <div style={{fontSize: 96, fontWeight: 800, letterSpacing: '-0.04em', color: C.gold, opacity: useSp(w('basket', 'dollars')), lineHeight: 1}}>$12.50</div>
          <div style={{fontSize: 64, fontWeight: 800, letterSpacing: '-0.03em', marginTop: 10, opacity: useSp(w('basket', 'lira'))}}>1,118,750 LBP</div>
          <div style={{fontSize: 30, fontWeight: 600, color: C.muteNight, marginTop: 14, opacity: useSp(w('basket', 'lira', 0, 300))}}>rate locked on the order · one tap confirms</div>
        </div>
      </Shot>
      <Shot from="pay">
        <Headline text="Cash or Whish." at={sc('pay').from + 4} tone={night} size={110} y={230} />
        <Node at={w('pay', 'cash')} x={COL.left} y={430} w={720} tone={night} hot={frame < cue('payWhish')} icon={<Banknote size={32} />} title="Cash on delivery" sub="in dollars or lira, at the locked rate" />
        <Node at={cue('payWhish') - 6} x={COL.left} y={600} w={720} tone={night} hot={frame >= cue('payWhish')} icon={<Wallet size={32} />} title="Whish checkout" sub="a payment link inside the chat" />
      </Shot>
      <Shot from="track">
        <Headline text="Tracked in the same chat." at={sc('track').from + 4} tone={night} size={96} y={230} />
        <Timeline3 />
      </Shot>
    </>
  );
};

const Timeline3: React.FC = () => {
  const frame = useCurrentFrame();
  const steps: [number, React.ReactNode, string][] = [
    [w('track', 'track'), <BadgeCheck size={30} key="a" />, 'Accepted'],
    [w('track', "driver's", 0, -200), <Bike size={30} key="b" />, 'On the way · live location'],
    [w('track', 'location', 0, 400), <PackageCheck size={30} key="c" />, 'Delivered · Received ✅'],
  ];
  return (
    <div style={{position: 'absolute', left: COL.left, top: 440}}>
      <div style={{position: 'absolute', left: 33, top: 30, width: 4, height: 260, background: 'rgba(248,241,231,0.12)'}} />
      {steps.map(([at, icon, label], i) => {
        const on = frame >= at;
        return (
          <div key={i} style={{display: 'flex', alignItems: 'center', gap: 22, height: 120, fontFamily: T.latin, color: on ? C.textNight : 'rgba(248,241,231,0.35)', fontSize: 40, fontWeight: 800}}>
            <div style={{width: 70, height: 70, borderRadius: 35, background: on ? C.gold : C.ink2, color: on ? C.ink : C.muteNight, display: 'grid', placeItems: 'center', position: 'relative', zIndex: 1}}>{icon}</div>
            {label}
          </div>
        );
      })}
    </div>
  );
};

/** 4 · Send Home: arcs from the diaspora to the Shouf. */
export const SendHome: React.FC = () => {
  const frame = useCurrentFrame();
  const home = {x: 1500, y: 560};
  const cities: [string, number, number][] = [
    ['Paris', 330, 420],
    ['Montréal', 190, 590],
    ['New York', 360, 720],
    ['Dubai', 820, 820],
    ['Abidjan', 560, 900],
    ['Sydney', 1100, 900],
  ];
  const at0 = w('diaspora', 'abroad');
  return (
    <>
      <Shot from="diaspora">
        <Headline text="Send Home" at={sc('diaspora').from + 2} tone={night} size={120} y={150} />
        {cities.map(([name, x, y], i) => {
          const d = `M ${x} ${y} Q ${(x + home.x) / 2} ${Math.min(y, home.y) - 260} ${home.x} ${home.y}`;
          return (
            <React.Fragment key={name}>
              <Edge d={d} at={at0 + i * 6} dur={26} tone={night} dash width={4} />
              <Traveller d={d} at={at0 + i * 6 + 26} period={60 + i * 7} size={14} />
              <div style={{position: 'absolute', left: x - 90, top: y - 26, width: 180, textAlign: 'center'}}>
                <Chip at={at0 + i * 6} tone={night} size={26}><Globe2 size={22} /> {name}</Chip>
              </div>
            </React.Fragment>
          );
        })}
        <div style={{position: 'absolute', left: home.x - 120, top: home.y - 20, width: 360}}>
          <Chip at={w('diaspora', 'family')} tone={night} hot size={32}>🏡 Family in Lebanon</Chip>
        </div>
        <div style={{position: 'absolute', left: home.x - 120, top: home.y + 70, width: 360}}>
          <Chip at={w('diaspora', 'card')} tone={night} size={28}>💳 Paid by card</Chip>
        </div>
      </Shot>
      <Shot from="gift">
        <Headline text="Birthdays, Eid, any day." at={sc('gift').from + 4} tone={night} size={96} y={230} />
        <div style={{position: 'absolute', left: COL.left, top: 470, display: 'flex', flexDirection: 'column', gap: 18, alignItems: 'flex-start'}}>
          <Chip at={w('gift', 'schedule')} tone={night}><Cake size={26} /> Scheduled up to 14 days ahead</Chip>
          <Chip at={w('gift', 'note')} tone={night}><Gift size={26} /> Gift note on the ticket</Chip>
          <Chip at={w('gift', 'follow')} tone={night}><Plane size={26} /> Followed from abroad, in both time zones</Chip>
          <Chip at={w('gift', 'abroad')} tone={night} hot>Recipients never get marketing · STOP anytime</Chip>
        </div>
      </Shot>
    </>
  );
};

export {Database, Count};
